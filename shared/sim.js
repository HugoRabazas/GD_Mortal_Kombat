// The fight simulation.
//
// This file is the single source of truth for the rules of the game. It has no
// idea about screens, networks or Discord: it takes the current match state
// plus the buttons each player is holding, and advances the match by one tick
// (1/60 of a second). The server runs it for online fights; the browser runs
// the very same code for practice fights against the CPU.
//
// The simulation is deterministic: the same inputs always give the same match.

import { ARENA, INPUT, RULES, TIMING, TICK_RATE } from './constants.js';
import { getFighter } from './fighters.js';

const { FLOOR, MIN_X, MAX_X } = ARENA;

const HALF_W = 24; // half the width of a fighter's body
const STAND_H = 158;
const CROUCH_H = 98; // low enough to duck punches and projectiles
const GRAVITY = 0.75;
const JUMP_VY = -14;
const JUMP_VX = 3.7;
const WALK_FWD = 3.5;
const WALK_BACK = 2.7;
const FRICTION = 0.84;
const BUFFER_TICKS = 8; // how long a button press is remembered
const DOWN_TICKS = 34; // time spent lying on the floor after a knockdown
const GETUP_TICKS = 18;

// Every attack is a row of numbers:
//   startup  - ticks before it can hit
//   active   - ticks during which it can hit
//   recovery - ticks after, during which the attacker is vulnerable
//   box      - hit area relative to the fighter's feet, mirrored by facing
export const MOVES = {
  punch: {
    startup: 4, active: 3, recovery: 8, dmg: 6,
    box: { x: 8, y: -136, w: 76, h: 34 },
    hitstun: 15, blockstun: 9, push: 5, gain: 9,
  },
  kick: {
    startup: 8, active: 4, recovery: 13, dmg: 10,
    box: { x: 8, y: -118, w: 94, h: 48 },
    hitstun: 19, blockstun: 12, push: 8, gain: 12, heavy: true,
  },
  lowPunch: {
    startup: 4, active: 3, recovery: 8, dmg: 5, low: true,
    box: { x: 8, y: -84, w: 76, h: 38 },
    hitstun: 14, blockstun: 9, push: 5, gain: 8,
  },
  sweep: {
    startup: 9, active: 4, recovery: 19, dmg: 9, low: true,
    box: { x: 8, y: -40, w: 88, h: 40 },
    hitstun: 0, blockstun: 12, push: 6, gain: 11, knockdown: true, heavy: true,
  },
  airKick: {
    startup: 5, active: 999, recovery: 0, dmg: 9,
    box: { x: -4, y: -74, w: 76, h: 70 },
    hitstun: 18, blockstun: 11, push: 6, gain: 10, heavy: true,
  },
  // --- specials (cost RULES.SPECIAL_COST meter) ---
  dash: {
    startup: 9, active: 13, recovery: 20, dmg: 14, speed: 13,
    box: { x: 0, y: -132, w: 78, h: 90 },
    hitstun: 0, blockstun: 16, push: 9, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  bolt: {
    startup: 12, active: 1, recovery: 14, dmg: 14,
    hitstun: 18, blockstun: 11, push: 7, gain: 6, heavy: true, chip: 0.25,
  },
  rise: {
    startup: 5, active: 14, recovery: 999, dmg: 15, vy: -13.5, vx: 3,
    box: { x: -6, y: -176, w: 76, h: 130 },
    hitstun: 0, blockstun: 14, push: 6, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  // --- finisher (costs the whole meter) ---
  super: {
    startup: 6, active: 16, recovery: 26, dmg: 32, speed: 21,
    box: { x: 0, y: -140, w: 86, h: 110 },
    hitstun: 0, blockstun: 20, push: 12, gain: 0, knockdown: true, heavy: true, chip: 0.3,
  },
};

const PROJECTILE = { speed: 9.5, r: 15 };

// `mod` optionally strengthens a fighter (used for arcade bosses):
// { health: 1.3, power: 1.15 } means 30% more health and 15% harder hits.
function newFighter(charId, slot, mod) {
  const c = getFighter(charId);
  const health = Math.round(c.stats.health * (mod?.health ?? 1));
  return {
    char: c.id,
    slot,
    pw: mod?.power ?? 1,
    x: slot === 0 ? 310 : 650,
    y: FLOOR,
    vx: 0,
    vy: 0,
    facing: slot === 0 ? 1 : -1,
    hp: health,
    maxHp: health,
    meter: 0,
    state: 'idle',
    t: 0, // ticks spent in the current state
    move: null, // key into MOVES while attacking
    hit: false, // has the current attack already connected?
    stun: 0,
    inv: 0, // invulnerability ticks
    crouching: false,
    prev: 0, // buttons held on the previous tick
    buf: 0, // remembered attack presses
    bufT: 0,
    taken: 0, // hits taken in the current combo
  };
}

export function createMatch(charIds, mods = [null, null]) {
  return {
    mods,
    tick: 0,
    phase: 'intro', // intro -> fight -> ko -> (intro | over)
    pt: 0, // ticks spent in the current phase
    round: 1,
    timer: RULES.ROUND_SECONDS * TICK_RATE,
    f: [newFighter(charIds[0], 0, mods[0]), newFighter(charIds[1], 1, mods[1])],
    proj: [],
    wins: [0, 0],
    hitstop: 0,
    freeze: 0,
    freezeBy: -1,
    winner: -1, // winner of the round that just ended (-1 = draw)
    koKind: null, // 'ko' | 'time'
    matchWinner: -2, // -2 = not decided yet, -1 = draw, 0/1 = player
    ev: [], // events produced by the latest tick (sounds, sparks, banners)
    evSeq: 0,
    projSeq: 0,
  };
}

function emit(s, type, data) {
  s.ev.push({ id: ++s.evSeq, type, ...data });
}

function setState(f, state) {
  if (f.state !== state) {
    f.state = state;
    f.t = 0;
  }
}

function speedOf(f) {
  return getFighter(f.char).stats.speed;
}

function startAttack(s, f, move) {
  f.state = 'attack';
  f.move = move;
  f.t = 0;
  f.hit = false;
  f.vx = 0;
  f.buf = 0;
  f.crouching = !!MOVES[move].low;
  emit(s, 'swing', { by: f.slot, move });
}

function rememberPresses(f, inp) {
  const pressed = inp & ~f.prev & (INPUT.PUNCH | INPUT.KICK | INPUT.SPECIAL | INPUT.SUPER);
  if (pressed) {
    f.buf |= pressed;
    f.bufT = BUFFER_TICKS;
  } else if (f.bufT > 0 && --f.bufT === 0) {
    f.buf = 0;
  }
}

// Turn a remembered button press into an attack, if the fighter can afford it.
function tryAttack(s, f, inp) {
  const b = f.buf;
  const low = (inp & INPUT.DOWN) !== 0;
  if (b & INPUT.SUPER && f.meter >= RULES.SUPER_COST) {
    f.meter = 0;
    startAttack(s, f, 'super');
    s.freeze = TIMING.SUPER_FREEZE;
    s.freezeBy = f.slot;
    emit(s, 'super', { by: f.slot });
    return true;
  }
  if (b & INPUT.SPECIAL && f.meter >= RULES.SPECIAL_COST) {
    f.meter -= RULES.SPECIAL_COST;
    const type = getFighter(f.char).special.type;
    startAttack(s, f, type);
    if (type === 'rise') f.inv = MOVES.rise.startup + 6;
    emit(s, 'special', { by: f.slot, move: type });
    return true;
  }
  if (b & INPUT.KICK) {
    startAttack(s, f, low ? 'sweep' : 'kick');
    return true;
  }
  if (b & INPUT.PUNCH) {
    startAttack(s, f, low ? 'lowPunch' : 'punch');
    return true;
  }
  f.buf = 0;
  return false;
}

// Decide what a fighter does this tick, from its state and the held buttons.
function control(s, f, o, inp) {
  const held = (bit) => (inp & bit) !== 0;
  switch (f.state) {
    case 'idle':
    case 'walk':
    case 'crouch':
    case 'block': {
      if (f.stun > 0) {
        f.stun--; // still absorbing a blocked hit
        break;
      }
      f.taken = 0;
      if (o.x !== f.x) f.facing = o.x > f.x ? 1 : -1;
      if (f.buf && tryAttack(s, f, inp)) break;
      if (held(INPUT.BLOCK)) {
        setState(f, 'block');
        f.crouching = held(INPUT.DOWN);
        f.vx = 0;
        break;
      }
      if (held(INPUT.UP)) {
        const dir = (held(INPUT.RIGHT) ? 1 : 0) - (held(INPUT.LEFT) ? 1 : 0);
        setState(f, 'jump');
        f.crouching = false;
        f.vy = JUMP_VY;
        f.vx = dir * JUMP_VX * speedOf(f);
        emit(s, 'jump', { by: f.slot });
        break;
      }
      if (held(INPUT.DOWN)) {
        setState(f, 'crouch');
        f.crouching = true;
        f.vx = 0;
        break;
      }
      f.crouching = false;
      const dir = (held(INPUT.RIGHT) ? 1 : 0) - (held(INPUT.LEFT) ? 1 : 0);
      if (dir !== 0) {
        setState(f, 'walk');
        f.vx = dir * (dir === f.facing ? WALK_FWD : WALK_BACK) * speedOf(f);
      } else {
        setState(f, 'idle');
        f.vx = 0;
      }
      break;
    }
    case 'jump': {
      if (f.buf & (INPUT.PUNCH | INPUT.KICK)) {
        f.state = 'airAttack';
        f.move = 'airKick';
        f.t = 0;
        f.hit = false;
        f.buf = 0;
        emit(s, 'swing', { by: f.slot, move: 'airKick' });
      }
      break;
    }
    case 'attack': {
      const m = MOVES[f.move];
      const t = f.t;
      const activeEnd = m.startup + m.active;
      if (f.move === 'dash' || f.move === 'super') {
        f.vx = t >= m.startup && t < activeEnd ? f.facing * m.speed : 0;
      } else if (f.move === 'rise') {
        if (t === m.startup) {
          f.vy = m.vy;
          f.vx = f.facing * m.vx;
        }
      } else if (f.move === 'bolt' && t === m.startup) {
        s.proj.push({
          id: ++s.projSeq,
          owner: f.slot,
          char: f.char,
          x: f.x + f.facing * 52,
          y: f.y - 122,
          vx: f.facing * PROJECTILE.speed,
        });
        emit(s, 'bolt', { by: f.slot });
      }
      if (t >= activeEnd + m.recovery) {
        f.move = null;
        setState(f, f.crouching && held(INPUT.DOWN) ? 'crouch' : 'idle');
      }
      break;
    }
    case 'hit': {
      if (--f.stun <= 0) {
        f.stun = 0;
        setState(f, 'idle');
      }
      break;
    }
    case 'land': {
      if (--f.stun <= 0) {
        f.stun = 0;
        setState(f, 'idle');
      }
      break;
    }
    case 'down': {
      if (f.y >= FLOOR && f.vy === 0 && --f.stun <= 0) {
        f.stun = 0;
        setState(f, 'getup');
        f.inv = GETUP_TICKS;
      }
      break;
    }
    case 'getup': {
      if (f.t >= GETUP_TICKS) setState(f, 'idle');
      break;
    }
    default:
      break; // airAttack, ko, win, lose: nothing to decide
  }
}

function land(s, f) {
  f.vy = 0;
  switch (f.state) {
    case 'jump':
      setState(f, 'idle');
      f.vx = 0;
      emit(s, 'land', { by: f.slot, x: f.x });
      break;
    case 'airAttack':
      f.move = null;
      setState(f, 'land');
      f.stun = 4;
      f.vx = 0;
      emit(s, 'land', { by: f.slot, x: f.x });
      break;
    case 'attack': // the rising special coming back down
      f.move = null;
      setState(f, 'land');
      f.stun = 14;
      f.vx = 0;
      emit(s, 'land', { by: f.slot, x: f.x });
      break;
    case 'down':
      f.stun = DOWN_TICKS;
      emit(s, 'thud', { by: f.slot, x: f.x });
      break;
    case 'ko':
      emit(s, 'thud', { by: f.slot, x: f.x });
      break;
    default:
      break;
  }
}

function physics(s, f) {
  const wasAir = f.y < FLOOR || f.vy < 0;
  f.x += f.vx;
  if (wasAir) {
    f.vy += GRAVITY;
    f.y += f.vy;
    if (f.y >= FLOOR) {
      f.y = FLOOR;
      land(s, f);
    }
  } else if (
    f.state === 'hit' ||
    f.state === 'down' ||
    f.state === 'ko' ||
    f.state === 'land' ||
    (f.state === 'block' && f.stun > 0)
  ) {
    f.vx *= FRICTION;
    if (Math.abs(f.vx) < 0.15) f.vx = 0;
  }
  if (f.x < MIN_X) f.x = MIN_X;
  if (f.x > MAX_X) f.x = MAX_X;
}

function isSolid(f) {
  return f.state !== 'down' && f.state !== 'ko' && f.state !== 'getup';
}

// Fighters cannot stand inside each other.
function separate(a, b) {
  if (!isSolid(a) || !isSolid(b)) return;
  if (Math.abs(a.y - b.y) > 90) return; // one is jumping over the other
  const dx = b.x - a.x;
  const overlap = HALF_W * 2 - Math.abs(dx);
  if (overlap <= 0) return;
  const dir = dx === 0 ? (a.slot === 0 ? 1 : -1) : Math.sign(dx);
  a.x -= (dir * overlap) / 2;
  b.x += (dir * overlap) / 2;
  // If one was pushed into a wall, the other takes the whole correction.
  for (const [p, q] of [[a, b], [b, a]]) {
    if (p.x < MIN_X) {
      q.x += MIN_X - p.x;
      p.x = MIN_X;
    } else if (p.x > MAX_X) {
      q.x -= p.x - MAX_X;
      p.x = MAX_X;
    }
  }
}

function attackBox(f) {
  let m;
  if (f.state === 'attack') {
    m = MOVES[f.move];
    if (!m.box || f.t < m.startup || f.t >= m.startup + m.active) return null;
  } else if (f.state === 'airAttack') {
    m = MOVES.airKick;
    if (f.t < m.startup) return null;
  } else {
    return null;
  }
  if (f.hit) return null;
  const x0 = f.x + f.facing * m.box.x;
  const x1 = f.x + f.facing * (m.box.x + m.box.w);
  return {
    l: Math.min(x0, x1),
    r: Math.max(x0, x1),
    t: f.y + m.box.y,
    b: f.y + m.box.y + m.box.h,
    m,
  };
}

function hurtBox(f) {
  if (f.inv > 0 || f.state === 'down' || f.state === 'getup' || f.state === 'ko') return null;
  const h = f.crouching && f.y >= FLOOR ? CROUCH_H : STAND_H;
  return { l: f.x - HALF_W, r: f.x + HALF_W, t: f.y - h, b: f.y };
}

function overlaps(a, b) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

function addMeter(f, amount) {
  f.meter = Math.min(RULES.METER_MAX, f.meter + amount);
}

// Apply one connected attack. `fromX` is where the blow comes from, which
// decides the push direction and whether the defender is facing it.
function applyHit(s, att, def, m, fromX, kind) {
  const dir = def.x === fromX ? att.facing : Math.sign(def.x - fromX);
  const blocked = def.state === 'block' && def.facing === -dir;
  const power = getFighter(att.char).stats.power * att.pw;
  const px = (Math.max(def.x - HALF_W, Math.min(def.x + HALF_W, fromX)) + def.x) / 2;
  const py = def.y - (m.low ? 50 : 110);

  if (blocked) {
    const chip = Math.max(1, Math.round(m.dmg * power * (m.chip ?? 0.15)));
    def.hp = Math.max(1, def.hp - chip); // a blocked hit never knocks out
    def.stun = m.blockstun;
    def.vx = dir * m.push * 0.8;
    addMeter(att, m.gain * 0.5);
    addMeter(def, m.gain * 0.5);
    s.hitstop = 3;
    emit(s, 'block', { by: att.slot, x: px, y: py, dmg: chip });
    return;
  }

  def.taken++;
  const scale = Math.max(0.5, 1 - 0.12 * (def.taken - 1)); // long combos hit softer
  const dmg = Math.max(1, Math.round(m.dmg * power * scale));
  def.hp = Math.max(0, def.hp - dmg);
  addMeter(att, m.gain);
  addMeter(def, m.gain * 0.6 + dmg * 0.4);
  def.move = null;
  def.crouching = false;
  def.buf = 0;

  if (def.hp <= 0) {
    def.state = 'ko';
    def.t = 0;
    def.vy = -9.5;
    def.vx = dir * 6;
    def.koBy = kind;
  } else if (m.knockdown || def.y < FLOOR) {
    def.state = 'down';
    def.t = 0;
    def.stun = DOWN_TICKS;
    def.vy = kind === 'super' ? -10 : -7.5;
    def.vx = dir * (kind === 'super' ? 8 : 5);
  } else {
    def.state = 'hit';
    def.t = 0;
    def.stun = m.hitstun;
    def.vx = dir * m.push;
  }
  s.hitstop = kind === 'super' ? 12 : m.heavy ? 7 : 4;
  emit(s, 'hit', {
    by: att.slot,
    x: px,
    y: py,
    dmg,
    heavy: !!m.heavy,
    kind,
    combo: def.taken,
  });
}

function resolveHits(s) {
  const [a, b] = s.f;
  // Work out every hit first, then apply them, so two fighters who strike on
  // the same tick both get hit (a "trade") instead of player 1 always winning.
  const pending = [];
  for (const [att, def] of [[a, b], [b, a]]) {
    const box = attackBox(att);
    if (!box) continue;
    const hurt = hurtBox(def);
    if (hurt && overlaps(box, hurt)) pending.push({ att, def, m: box.m, fromX: att.x, kind: att.move });
  }
  for (const h of pending) h.att.hit = true;
  for (const h of pending) applyHit(s, h.att, h.def, h.m, h.fromX, h.kind);

  // Projectiles.
  for (const p of s.proj) {
    p.x += p.vx;
    if (p.x < -40 || p.x > ARENA.W + 40) p.dead = true;
  }
  for (let i = 0; i < s.proj.length; i++) {
    for (let j = i + 1; j < s.proj.length; j++) {
      const p = s.proj[i];
      const q = s.proj[j];
      if (!p.dead && !q.dead && p.owner !== q.owner && Math.abs(p.x - q.x) < PROJECTILE.r * 2) {
        p.dead = q.dead = true;
        emit(s, 'clash', { x: (p.x + q.x) / 2, y: p.y });
      }
    }
  }
  for (const p of s.proj) {
    if (p.dead) continue;
    const def = s.f[1 - p.owner];
    const hurt = hurtBox(def);
    const box = { l: p.x - PROJECTILE.r, r: p.x + PROJECTILE.r, t: p.y - PROJECTILE.r, b: p.y + PROJECTILE.r };
    if (hurt && overlaps(box, hurt)) {
      p.dead = true;
      applyHit(s, s.f[p.owner], def, MOVES.bolt, p.x - Math.sign(p.vx) * 30, 'bolt');
    }
  }
  s.proj = s.proj.filter((p) => !p.dead);
}

function endRound(s, winner, kind) {
  s.phase = 'ko';
  s.pt = 0;
  s.winner = winner;
  s.koKind = kind;
  s.proj = [];
  if (winner >= 0) s.wins[winner]++;
  const w = winner >= 0 ? s.f[winner] : null;
  emit(s, kind === 'ko' ? 'ko' : 'timeup', {
    winner,
    perfect: !!w && w.hp === w.maxHp,
    finisher: kind === 'ko' && winner >= 0 && s.f[1 - winner].koBy === 'super',
  });
}

function resetRound(s) {
  const chars = [s.f[0].char, s.f[1].char];
  const meters = [s.f[0].meter, s.f[1].meter];
  s.f = [newFighter(chars[0], 0, s.mods[0]), newFighter(chars[1], 1, s.mods[1])];
  s.f[0].meter = meters[0];
  s.f[1].meter = meters[1];
  s.proj = [];
  s.timer = RULES.ROUND_SECONDS * TICK_RATE;
  s.phase = 'intro';
  s.pt = 0;
  s.koKind = null;
  s.winner = -1;
}

function canCelebrate(f) {
  return f.y >= FLOOR && (f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'block');
}

// Advance the match by one tick. `inputs` is [player1Buttons, player2Buttons].
export function step(s, inputs) {
  s.ev = [];
  s.tick++;
  const [a, b] = s.f;
  const fighting = s.phase === 'fight';
  const inp = [fighting ? inputs[0] | 0 : 0, fighting ? inputs[1] | 0 : 0];

  if (fighting) {
    rememberPresses(a, inp[0]);
    rememberPresses(b, inp[1]);
  }
  a.prev = inp[0];
  b.prev = inp[1];

  // Dramatic pauses: the whole world stops for a few ticks.
  if (s.freeze > 0) {
    s.freeze--;
    return s;
  }
  if (s.hitstop > 0) {
    s.hitstop--;
    return s;
  }

  s.pt++;

  if (s.phase === 'intro') {
    if (s.pt === 1) emit(s, 'round', { round: s.round });
    if (s.pt === TIMING.INTRO_FIGHT_CALL) emit(s, 'fight', {});
    a.t++;
    b.t++;
    if (s.pt >= TIMING.INTRO) {
      s.phase = 'fight';
      s.pt = 0;
    }
    return s;
  }

  if (s.phase === 'over') {
    a.t++;
    b.t++;
    return s;
  }

  // Slow motion right after a knockout.
  if (s.phase === 'ko' && s.koKind === 'ko' && s.pt < 60 && s.pt % 2 === 0) return s;

  control(s, a, b, inp[0]);
  control(s, b, a, inp[1]);
  physics(s, a);
  physics(s, b);
  separate(a, b);

  if (fighting) {
    resolveHits(s);
    if (a.inv > 0) a.inv--;
    if (b.inv > 0) b.inv--;
  }
  a.t++;
  b.t++;

  if (fighting) {
    const aOut = a.hp <= 0;
    const bOut = b.hp <= 0;
    if (aOut || bOut) {
      endRound(s, aOut && bOut ? -1 : aOut ? 1 : 0, 'ko');
    } else if (--s.timer <= 0) {
      s.timer = 0;
      const ra = a.hp / a.maxHp;
      const rb = b.hp / b.maxHp;
      endRound(s, ra === rb ? -1 : ra > rb ? 0 : 1, 'time');
    }
    return s;
  }

  // phase === 'ko'
  if (s.pt > 50 && s.winner >= 0) {
    const w = s.f[s.winner];
    const l = s.f[1 - s.winner];
    if (w.state !== 'win' && canCelebrate(w)) {
      setState(w, 'win');
      w.vx = 0;
    }
    if (s.koKind === 'time' && l.state !== 'lose' && canCelebrate(l)) {
      setState(l, 'lose');
      l.vx = 0;
    }
  }
  if (s.pt >= (s.koKind === 'ko' ? TIMING.KO : TIMING.TIMEUP)) {
    const lead = s.wins[0] === s.wins[1] ? -1 : s.wins[0] > s.wins[1] ? 0 : 1;
    if (s.winner >= 0 && s.wins[s.winner] >= RULES.ROUNDS_TO_WIN) {
      s.phase = 'over';
      s.pt = 0;
      s.matchWinner = s.winner;
      emit(s, 'matchEnd', { winner: s.winner });
    } else if (s.round >= RULES.MAX_ROUNDS) {
      s.phase = 'over';
      s.pt = 0;
      s.matchWinner = lead;
      emit(s, 'matchEnd', { winner: lead });
    } else {
      s.round++;
      resetRound(s);
    }
  }
  return s;
}
