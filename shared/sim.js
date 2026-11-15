// The fight simulation.
//
// This file is the single source of truth for the rules of the game. It knows
// nothing about screens or sound: it takes the current match state plus the
// buttons every fighter is holding, and advances the match by one tick (1/60
// of a second). The same code drives one-on-one duels and the four-fighter
// arena brawl.
//
// The fighting ground is a circle seen from above. Each fighter has a position
// on the floor (x, z), a height above it (h) and a direction it faces (dir,
// an angle). Fighters walk in any direction; an attack hits whoever stands
// inside a wedge in front of the attacker.
//
// The simulation is deterministic: the same inputs always give the same match.

import { ARENA, INPUT, MODES, RULES, TIMING, TICK_RATE } from './constants.js';
import { getFighter } from './fighters.js';

const BODY_R = 24; // radius of a fighter's body on the floor
const BODY_H = 158;
const GRAVITY = 0.75;
const JUMP_V = 14;
const WALK = 3.5;
const AIR_SPEED = 3.7;
// A second jump in the air: a fresh press of jump, once per jump, after the
// first few ticks of rising (`from`), a little lower than the first.
const AIR_JUMP = { from: 4, v: 11.5, buffer: 6 };
// The stomp (grab - or punch and kick together - in the air): a short hang,
// then a plunge feet first.
const STOMP = { fall: -17, rest: 14 };
// A launched rival can be hit this many more times in the air.
const JUGGLE = 2;
const FRICTION = 0.84;
const BUFFER_TICKS = 8; // how long a button press is remembered
// A throw: seize (the rival is lifted in front), swing (carried up and over
// the thrower's head) and slam (driven into the floor behind). Ticks:
export const THROW = { lift: 7, slam: 19, end: 28, height: 120, reach: 46 };
// Punch and kick pressed together still make a grab when one comes a beat
// after the other (fingers are never exactly together). Kept short: a wider
// window turned deliberate punch-then-kick into grabs that missed, and it
// cost the fastest CPU a sixth of its wins. The GRAB button needs no timing.
const GRAB_WINDOW = 3;
// Walking this long counts as running: punch and kick become the lunge and
// the slide.
const RUN_TICKS = 8;
const DOWN_TICKS = 34; // time spent lying on the floor after a knockdown
const GETUP_TICKS = 18;
// Quick rise: block held while lying on the floor gets a fighter up after
// TECH_TICKS instead of DOWN_TICKS - once per knockdown, and not in the
// last few ticks, when there would be nothing to gain.
const TECH_TICKS = 8;
export const BLOCK_ARC = 1.25; // a block stops attacks coming from within this angle of where you face
const ROLL = { ticks: 15, safe: 11, speed: 8.5, rest: 7 }; // the dodge roll
// Punch or kick late in a roll comes out of it as an attack (from tick
// `from`, when the roll has done most of its travelling); a fighter getting
// up can strike from tick `rise` of the getup.
const OUT_OF = { from: 7, rise: 4 };
const SPLAT = { speed: 3.2, dmg: 5 }; // being knocked into the ring of fire
// A counter hit: a blow that lands while the rival is still winding up an
// attack of their own (in its startup) does `dmg` times the damage and holds
// the impact a few ticks longer. It rewards reading the rival's move.
const COUNTER = { dmg: 1.25, stop: 3 };
// A perfect guard: the block button pressed in the last `window` ticks before
// a blow lands. It costs no health, and a heavy blow from a rival standing on
// the ground leaves that rival reeling for `stagger` ticks. The guard has to
// be down for `rest` ticks first, so hammering the button does not work.
const GUARD = { window: 5, rest: 20, stagger: 26, gain: 12 };
// Crystals that appear on the floor: walk over one to take it.
const ITEMS = { first: 7, every: [9, 14], life: 12, max: 2, reach: 44, energy: 40, heal: 15 };

// Every attack is a row of numbers:
//   startup / active / recovery - ticks before it can hit, while it hits, after
//   reach - how far in front it lands (centre to centre, plus body size)
//   arc   - half-width of the wedge it covers, in radians (PI = all around)
//   y0,y1 - the band of height it covers, measured from the attacker's feet
//   aim   - within this distance the attacker turns to the nearest rival first
export const MOVES = {
  // Punch, punch, punch is a three-hit string: each blow that connects can be
  // followed by the next (`next`), and the third one knocks down.
  punch: {
    startup: 4, active: 3, recovery: 8, dmg: 6, reach: 84, arc: 0.85, y0: 70, y1: 150, aim: 190,
    hitstun: 15, blockstun: 9, push: 4, gain: 9, next: 'punch2',
  },
  punch2: {
    startup: 4, active: 3, recovery: 10, dmg: 6, reach: 88, arc: 0.85, y0: 70, y1: 150, aim: 190,
    hitstun: 16, blockstun: 10, push: 4, gain: 9, next: 'punch3', nextK: 'launch',
  },
  // Punch, punch, kick: the string ends in a rising kick that throws the
  // rival up into the air (`launch` is their upward speed) instead of down.
  // A launched rival can be struck JUGGLE more times before they land, and a
  // launcher that connects can be cancelled straight into a jump to chase.
  launch: {
    startup: 6, active: 4, recovery: 14, dmg: 7, reach: 86, arc: 0.9, y0: 30, y1: 170, aim: 190,
    hitstun: 0, blockstun: 12, push: 3, gain: 10, knockdown: true, heavy: true, launch: 12.5, speed: 4, go: [0, 7],
  },
  punch3: {
    startup: 6, active: 4, recovery: 17, dmg: 9, reach: 92, arc: 0.9, y0: 40, y1: 170, aim: 190,
    hitstun: 0, blockstun: 14, push: 9, gain: 11, knockdown: true, heavy: true,
  },
  kick: {
    startup: 8, active: 4, recovery: 13, dmg: 10, reach: 104, arc: 0.75, y0: 30, y1: 140, aim: 210,
    hitstun: 19, blockstun: 12, push: 9, gain: 12, heavy: true, nextK: 'kick2',
  },
  // Kick, kick: a kick that lands flows into a spinning roundhouse that
  // knocks down, stepping in after the rival the first kick pushed away.
  kick2: {
    startup: 7, active: 4, recovery: 18, dmg: 8, reach: 108, arc: 1.1, y0: 50, y1: 160, aim: 210,
    hitstun: 0, blockstun: 13, push: 10, gain: 11, knockdown: true, heavy: true, speed: 6, go: [0, 9],
  },
  // Punch on the move: a lunging straight that carries the body forward
  // (`speed` from tick go[0] to go[1]), reaching further than a jab but
  // slower to start. It can still open the punch string.
  lunge: {
    startup: 6, active: 4, recovery: 12, dmg: 7, reach: 92, arc: 0.8, y0: 70, y1: 150, aim: 240,
    hitstun: 17, blockstun: 10, push: 6, gain: 10, next: 'punch2', speed: 5.5, go: [0, 10],
  },
  // Kick on the move: a slide along the floor, feet first. Low, so a rival
  // in the air is over it; it sweeps whoever it catches off their feet, but
  // a slide that misses leaves the slider lying open.
  slide: {
    startup: 7, active: 9, recovery: 20, dmg: 6, reach: 66, arc: 0.6, y0: -20, y1: 60, aim: 220,
    hitstun: 0, blockstun: 12, push: 6, gain: 10, knockdown: true, speed: 7.5, go: [7, 16],
  },
  // Out of a dodge roll: punch springs up into a rising uppercut that knocks
  // down, kick whips round into a spinning heel kick with a wide arc. The
  // roll is what makes them safe to start; they are slow to recover.
  rollUpper: {
    startup: 5, active: 4, recovery: 18, dmg: 8, reach: 80, arc: 0.9, y0: 50, y1: 200, aim: 200,
    hitstun: 0, blockstun: 12, push: 7, gain: 10, knockdown: true, heavy: true, speed: 3, go: [0, 7],
  },
  rollSpin: {
    startup: 6, active: 5, recovery: 16, dmg: 7, reach: 100, arc: 1.4, y0: 30, y1: 150, aim: 220,
    hitstun: 20, blockstun: 12, push: 13, gain: 10, heavy: true,
  },
  // Getting up with punch or kick: a low sweeping kick off the floor. It
  // cannot be hit while it starts, so it breaks a rival waiting over you,
  // but it is slow to recover if guarded.
  riseKick: {
    startup: 7, active: 4, recovery: 20, dmg: 7, reach: 92, arc: 1.3, y0: -10, y1: 100, aim: 200,
    hitstun: 16, blockstun: 12, push: 14, gain: 8,
  },
  // Punch and kick together: a grab. Short reach and slow to recover if it
  // misses, but a guard does not stop it - the answer to a rival who only blocks.
  grab: {
    startup: 7, active: 3, recovery: 24, dmg: 10, reach: 62, arc: 0.7, y0: 40, y1: 150, aim: 150,
    hitstun: 0, blockstun: 0, push: 6, gain: 10, knockdown: true, heavy: true, unblockable: true,
  },
  // In the air each button has its own move: punch is a quick fist angled
  // down at whoever is below and in front, kick the heavier flying kick, and
  // grab (or punch and kick together) a stomp straight down that knocks over
  // whoever it lands on - but leaves the stomper rooted if it misses.
  airPunch: {
    startup: 3, active: 999, recovery: 0, dmg: 7, reach: 72, arc: 1.0, y0: -50, y1: 100, aim: 0,
    hitstun: 16, blockstun: 10, push: 5, gain: 9,
  },
  airKick: {
    startup: 5, active: 999, recovery: 0, dmg: 9, reach: 80, arc: 1.0, y0: -20, y1: 90, aim: 0,
    hitstun: 18, blockstun: 11, push: 6, gain: 10, heavy: true,
  },
  stomp: {
    startup: 5, active: 999, recovery: 0, dmg: 10, reach: 44, arc: Math.PI, y0: -110, y1: 30, aim: 0,
    hitstun: 0, blockstun: 14, push: 7, gain: 10, knockdown: true, heavy: true,
  },
  // --- specials (cost RULES.SPECIAL_COST energy) ---
  dash: {
    startup: 9, active: 13, recovery: 20, dmg: 14, speed: 13, reach: 82, arc: 1.1, y0: 10, y1: 150, aim: 340,
    hitstun: 0, blockstun: 16, push: 9, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  bolt: {
    startup: 12, active: 1, recovery: 14, dmg: 14, aim: 900,
    hitstun: 18, blockstun: 11, push: 7, gain: 6, heavy: true, chip: 0.25,
  },
  rise: {
    startup: 5, active: 14, recovery: 999, dmg: 14, vh: 13.5, reach: 74, arc: Math.PI, y0: 0, y1: 190, aim: 0,
    hitstun: 0, blockstun: 14, push: 6, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  quake: {
    startup: 20, active: 3, recovery: 28, dmg: 11, reach: 150, arc: Math.PI, y0: -5, y1: 30, aim: 0,
    hitstun: 0, blockstun: 14, push: 8, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  // --- finisher (costs the whole energy bar) ---
  super: {
    startup: 6, active: 16, recovery: 26, dmg: 32, speed: 21, reach: 86, arc: 1.2, y0: 0, y1: 160, aim: 420,
    hitstun: 0, blockstun: 20, push: 12, gain: 0, knockdown: true, heavy: true, chip: 0.3,
  },
};

const PROJECTILE = { speed: 9.5, r: 15, h: 100, life: 150 };

// Where fighters start a round, by slot.
const SPAWNS = {
  2: [[-170, 0], [170, 0]],
  3: [[-280, 60], [280, 60], [0, -260]],
  4: [[-300, 0], [300, 0], [0, -270], [0, 250]],
};

const angleTo = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax);
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// `mod` optionally strengthens a fighter (used for arcade bosses):
// { health: 1.3, power: 1.15 } means 30% more health and 15% harder hits.
function newFighter(charId, slot, count, mod) {
  const c = getFighter(charId);
  const health = Math.round(c.stats.health * (mod?.health ?? 1));
  const [x, z] = SPAWNS[count][slot];
  return {
    char: c.id,
    slot,
    pw: mod?.power ?? 1,
    x,
    z,
    h: 0,
    vx: 0,
    vz: 0,
    vh: 0,
    dir: Math.atan2(-z, -x), // face the centre
    hp: health,
    maxHp: health,
    meter: 0,
    state: 'idle',
    t: 0, // ticks spent in the current state
    move: null, // key into MOVES while attacking
    hits: [], // slots already struck by the current attack
    stun: 0,
    stop: 0, // ticks this fighter is frozen by the impact of a hit
    inv: 0, // invulnerability ticks
    rollOk: true, // the block button must be released before the next roll
    guard: 0, // ticks left in which a blocked blow counts as a perfect guard
    open: 99, // ticks since this fighter last had the guard up
    deflect: 0, // ticks left of the shove that follows a perfect guard (for show)
    reel: 0, // ticks left staggering after a heavy blow was guarded perfectly
    prev: 0, // buttons held on the previous tick
    held: -1, // slot of the rival being thrown, or -1
    jumpT: 0, // ticks left on a remembered press of jump (for the air jump)
    juggle: 0, // hits a launched fighter can still take before landing
    air2: false, // the air jump is spent
    buf: 0, // remembered attack presses
    bufT: 0,
    taken: 0, // hits taken in the current combo
    outAt: -1, // tick at which this fighter was knocked out this round
  };
}

// chars: 2 to 4 fighter ids. mode: 'duel' or 'arena'.
// `seed` decides where and when crystals appear; the same seed gives the same match.
export function createMatch(chars, mods = [], mode = chars.length > 2 ? 'arena' : 'duel', seed = 1) {
  const n = chars.length;
  const rules = MODES[mode];
  return {
    mode,
    mods,
    tick: 0,
    phase: 'intro', // intro -> fight -> ko -> (intro | over)
    pt: 0, // ticks spent in the current phase
    round: 1,
    timer: rules.seconds * TICK_RATE,
    ringR: ARENA.R,
    f: chars.map((c, i) => newFighter(c, i, n, mods[i])),
    proj: [],
    items: [], // crystals lying on the floor
    itemSeq: 0,
    nextItem: ITEMS.first * TICK_RATE,
    seed: seed >>> 0 || 1,
    pts: chars.map(() => 0), // match points per fighter
    roundPts: chars.map(() => 0), // points handed out by the round that just ended
    hitstop: 0,
    freeze: 0,
    freezeBy: -1,
    winner: -1, // winner of the round that just ended (-1 = shared)
    koKind: null, // 'ko' | 'time'
    matchWinner: -2, // -2 = not decided, -1 = tie at the top, otherwise a slot
    ranking: null, // final standings once the match is over
    ev: [], // events produced by the latest tick (sounds, sparks, banners)
    evSeq: 0,
    projSeq: 0,
  };
}

// The match's own random numbers (deterministic, kept in the state).
function random(s) {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

function updateItems(s) {
  if (--s.nextItem <= 0) {
    s.nextItem = Math.round((ITEMS.every[0] + random(s) * (ITEMS.every[1] - ITEMS.every[0])) * TICK_RATE);
    if (s.items.length < ITEMS.max) {
      const a = random(s) * Math.PI * 2;
      const r = Math.sqrt(random(s)) * (s.ringR - 90);
      const item = { id: ++s.itemSeq, kind: random(s) < 0.6 ? 'energy' : 'heal', x: Math.cos(a) * r, z: Math.sin(a) * r, life: ITEMS.life * TICK_RATE };
      s.items.push(item);
      emit(s, 'spawn', { kind: item.kind, x: item.x, z: item.z });
    }
  }
  for (const it of s.items) {
    if (--it.life <= 0 || Math.hypot(it.x, it.z) > s.ringR - 20) {
      it.gone = true;
      continue;
    }
    for (const f of s.f) {
      if (isOut(f) || f.h > 40 || f.state === 'down' || Math.hypot(f.x - it.x, f.z - it.z) > ITEMS.reach) continue;
      if (it.kind === 'energy') addMeter(f, ITEMS.energy);
      else f.hp = Math.min(f.maxHp, f.hp + ITEMS.heal);
      it.gone = true;
      emit(s, 'pickup', { slot: f.slot, kind: it.kind, x: it.x, z: it.z });
      break;
    }
  }
  s.items = s.items.filter((it) => !it.gone);
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

const speedOf = (f) => getFighter(f.char).stats.speed;
const isOut = (f) => f.hp <= 0;

function nearestRival(s, f, range) {
  let best = null;
  let bestD = range;
  for (const o of s.f) {
    if (o === f || isOut(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// Turn towards the nearest rival in range, so attacks do not need pixel-perfect aim.
function aim(s, f, range) {
  if (range <= 0) return;
  const o = nearestRival(s, f, range);
  if (o && (o.x !== f.x || o.z !== f.z)) f.dir = angleTo(f.x, f.z, o.x, o.z);
}

// Raising a guard turns it towards the rival whose blow is on its way (the
// nearest one swinging, within reach), and only failing that towards the
// nearest rival - in a brawl the nearest is often not the one attacking.
function aimGuard(s, f) {
  let best = null;
  let bestD = 260;
  for (const o of s.f) {
    if (o === f || isOut(o) || (o.state !== 'attack' && o.state !== 'airAttack')) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  if (best) f.dir = angleTo(f.x, f.z, best.x, best.z);
  else aim(s, f, 360);
}

function startAttack(s, f, move) {
  f.state = 'attack';
  f.move = move;
  f.t = 0;
  f.hits = [];
  f.vx = 0;
  f.vz = 0;
  f.buf = 0;
  aim(s, f, MOVES[move].aim);
  emit(s, 'swing', { by: f.slot, move });
}

function rememberPresses(f, inp) {
  const pressed = inp & ~f.prev & (INPUT.PUNCH | INPUT.KICK | INPUT.SPECIAL | INPUT.SUPER | INPUT.GRAB);
  if (pressed) {
    f.buf |= pressed;
    f.bufT = BUFFER_TICKS;
  } else if (f.bufT > 0 && --f.bufT === 0) {
    f.buf = 0;
  }
}

// Turn a remembered button press into an attack, if the fighter can afford it.
function tryAttack(s, f, inp = 0) {
  const b = f.buf;
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
  if (b & INPUT.GRAB || (b & INPUT.KICK && b & INPUT.PUNCH)) {
    startAttack(s, f, 'grab');
    return true;
  }
  // On the run, the same buttons give the moving versions: after a few steps
  // (a jab from a shuffle stays a jab) and with the stick still held (letting
  // go of it gives the standing move).
  const moving = f.state === 'walk' && f.t >= RUN_TICKS && !!stick(inp);
  if (b & INPUT.KICK) {
    startAttack(s, f, moving ? 'slide' : 'kick');
    return true;
  }
  if (b & INPUT.PUNCH) {
    startAttack(s, f, moving ? 'lunge' : 'punch');
    return true;
  }
  f.buf = 0;
  return false;
}

// The direction the stick is pushed, as a unit vector (or null when centred).
function stick(inp) {
  const mx = (inp & INPUT.RIGHT ? 1 : 0) - (inp & INPUT.LEFT ? 1 : 0);
  const mz = (inp & INPUT.DOWN ? 1 : 0) - (inp & INPUT.UP ? 1 : 0);
  if (!mx && !mz) return null;
  const len = Math.hypot(mx, mz);
  return { x: mx / len, z: mz / len };
}

// Decide what a fighter does this tick, from its state and the held buttons.
function control(s, f, inp) {
  const held = (bit) => (inp & bit) !== 0;
  if (f.guard > 0) f.guard--;
  if (f.deflect > 0) f.deflect--;
  if (f.reel > 0) f.reel--;
  if (f.state === 'block') f.open = 0;
  else if (f.open < 99) f.open++;
  switch (f.state) {
    case 'idle':
    case 'walk':
    case 'block': {
      if (f.stun > 0) {
        f.stun--; // still absorbing a blocked hit
        break;
      }
      f.taken = 0;
      if (f.buf && tryAttack(s, f, inp)) break;
      const dir = stick(inp);
      if (!held(INPUT.BLOCK)) f.rollOk = true;
      if (held(INPUT.BLOCK)) {
        // Block pressed while pushing a direction is a dodge roll that way:
        // quick, and nothing can hit you for most of it.
        if (dir && f.rollOk && f.state !== 'block') {
          f.rollOk = false;
          setState(f, 'roll');
          f.dir = Math.atan2(dir.z, dir.x);
          f.vx = dir.x * ROLL.speed;
          f.vz = dir.z * ROLL.speed;
          f.inv = ROLL.safe;
          emit(s, 'roll', { by: f.slot });
          break;
        }
        if (f.state !== 'block') {
          aimGuard(s, f);
          f.guard = f.open >= GUARD.rest ? GUARD.window : 0;
        }
        setState(f, 'block');
        f.vx = 0;
        f.vz = 0;
        break;
      }
      if (held(INPUT.JUMP)) {
        setState(f, 'jump');
        f.vh = JUMP_V;
        f.jumpT = 0; // this press is the take-off, not an air jump
        f.air2 = false;
        f.vx = dir ? dir.x * AIR_SPEED * speedOf(f) : 0;
        f.vz = dir ? dir.z * AIR_SPEED * speedOf(f) : 0;
        if (dir) f.dir = Math.atan2(dir.z, dir.x);
        emit(s, 'jump', { by: f.slot });
        break;
      }
      if (dir) {
        setState(f, 'walk');
        f.vx = dir.x * WALK * speedOf(f);
        f.vz = dir.z * WALK * speedOf(f);
        f.dir = Math.atan2(dir.z, dir.x);
      } else {
        setState(f, 'idle');
        f.vx = 0;
        f.vz = 0;
      }
      break;
    }
    case 'roll': {
      if (f.t >= OUT_OF.from && f.buf & (INPUT.PUNCH | INPUT.KICK)) {
        startAttack(s, f, f.buf & INPUT.KICK ? 'rollSpin' : 'rollUpper');
        break;
      }
      if (f.t >= ROLL.ticks) {
        setState(f, 'land');
        f.stun = ROLL.rest;
        f.vx = f.vz = 0;
      }
      break;
    }
    case 'jump': {
      const b = f.buf;
      if (b & (INPUT.PUNCH | INPUT.KICK | INPUT.GRAB)) {
        airAttack(s, f, b & INPUT.GRAB || (b & INPUT.PUNCH && b & INPUT.KICK) ? 'stomp' : b & INPUT.KICK ? 'airKick' : 'airPunch');
        break;
      }
      if (f.jumpT > 0 && !f.air2 && f.t >= AIR_JUMP.from) {
        // The air jump: up again, and steered anew by the stick.
        const dir = stick(inp);
        f.air2 = true;
        f.jumpT = 0;
        f.t = 0;
        f.vh = AIR_JUMP.v;
        f.vx = dir ? dir.x * AIR_SPEED * speedOf(f) : f.vx * 0.5;
        f.vz = dir ? dir.z * AIR_SPEED * speedOf(f) : f.vz * 0.5;
        if (dir) f.dir = Math.atan2(dir.z, dir.x);
        emit(s, 'jump2', { by: f.slot, x: f.x, z: f.z, h: f.h });
      }
      break;
    }
    case 'airAttack': {
      // The other button a beat after the first makes a stomp, as on the ground.
      if (f.move !== 'stomp' && f.t < GRAB_WINDOW && f.buf & (f.move === 'airPunch' ? INPUT.KICK : INPUT.PUNCH)) {
        airAttack(s, f, 'stomp');
        break;
      }
      if (f.move === 'stomp') {
        if (f.t < MOVES.stomp.startup) {
          f.vh = GRAVITY; // hang in the air (gravity takes this back off)
          f.vx = f.vz = 0;
        } else if (f.t === MOVES.stomp.startup) f.vh = STOMP.fall;
      }
      break;
    }
    case 'attack': {
      const m = MOVES[f.move];
      const t = f.t;
      const activeEnd = m.startup + m.active;
      // The other button soon after a punch or a kick turns it into a grab.
      const punchy = f.move === 'punch' || f.move === 'lunge';
      const kicky = f.move === 'kick' || f.move === 'slide';
      if (t < GRAB_WINDOW && ((punchy && f.buf & INPUT.KICK) || (kicky && f.buf & INPUT.PUNCH))) {
        startAttack(s, f, 'grab');
        break;
      }
      if (f.move === 'dash' || f.move === 'super') {
        const going = t >= m.startup && t < activeEnd;
        f.vx = going ? Math.cos(f.dir) * m.speed : 0;
        f.vz = going ? Math.sin(f.dir) * m.speed : 0;
      } else if (m.go) {
        // Moves that travel: full speed through their stretch, then braking.
        const going = t >= m.go[0] && t < m.go[1];
        const v = going ? m.speed : t >= m.go[1] ? Math.hypot(f.vx, f.vz) * 0.75 : 0;
        f.vx = Math.cos(f.dir) * v;
        f.vz = Math.sin(f.dir) * v;
      } else if (f.move === 'rise') {
        if (t === m.startup) f.vh = m.vh;
      } else if (f.move === 'quake') {
        if (t === m.startup) emit(s, 'quake', { by: f.slot, x: f.x, z: f.z, r: m.reach + BODY_R });
      } else if (f.move === 'bolt' && t === m.startup) {
        s.proj.push({
          id: ++s.projSeq,
          owner: f.slot,
          char: f.char,
          x: f.x + Math.cos(f.dir) * 50,
          z: f.z + Math.sin(f.dir) * 50,
          h: PROJECTILE.h,
          vx: Math.cos(f.dir) * PROJECTILE.speed,
          vz: Math.sin(f.dir) * PROJECTILE.speed,
          life: PROJECTILE.life,
        });
        emit(s, 'bolt', { by: f.slot });
      }
      // A blow that connected can flow straight into the next one of its
      // string: punch for `next`, kick for `nextK`.
      if (f.hits.length && t >= activeEnd) {
        const nx = f.buf & INPUT.KICK ? m.nextK : f.buf & INPUT.PUNCH ? m.next : null;
        if (nx) {
          startAttack(s, f, nx);
          break;
        }
        // A launcher that landed: jump straight after the rival.
        if (m.launch && held(INPUT.JUMP)) {
          setState(f, 'jump');
          f.move = null;
          f.vh = JUMP_V;
          f.vx = Math.cos(f.dir) * AIR_SPEED;
          f.vz = Math.sin(f.dir) * AIR_SPEED;
          f.jumpT = 0;
          f.air2 = false;
          emit(s, 'jump', { by: f.slot });
          break;
        }
      }
      if (t >= activeEnd + m.recovery) {
        f.move = null;
        setState(f, 'idle');
      }
      break;
    }
    case 'hit':
    case 'land': {
      if (--f.stun <= 0) {
        f.stun = 0;
        setState(f, 'idle');
      }
      break;
    }
    case 'down': {
      if (f.h <= 0 && f.vh === 0 && held(INPUT.BLOCK) && !f.teched && f.stun > TECH_TICKS + 4) {
        f.teched = true;
        f.stun = TECH_TICKS;
        emit(s, 'tech', { by: f.slot });
      }
      if (f.h <= 0 && f.vh === 0 && --f.stun <= 0) {
        f.stun = 0;
        setState(f, 'getup');
        f.inv = GETUP_TICKS;
      }
      break;
    }
    case 'getup': {
      if (f.t >= OUT_OF.rise && f.buf & (INPUT.PUNCH | INPUT.KICK)) {
        startAttack(s, f, 'riseKick');
        f.inv = MOVES.riseKick.startup;
        break;
      }
      if (f.t >= GETUP_TICKS) setState(f, 'idle');
      break;
    }
    case 'throw':
      carryThrow(s, f);
      break;
    default:
      break; // airAttack, ko, win, lose: nothing to decide
  }
}

// A seized rival is carried by the thrower: lifted in front, swung up and
// over the head, and driven into the floor behind, where the blow lands.
function carryThrow(s, f) {
  const def = s.f[f.held];
  f.vx = f.vz = 0;
  if (!def || def.state !== 'held') {
    setState(f, 'idle');
    f.held = -1;
    return;
  }
  const t = f.t;
  // Angle round the thrower: 0 = in front, PI = behind.
  const k = t < THROW.lift ? 0 : Math.min(1, (t - THROW.lift) / (THROW.slam - THROW.lift));
  const turn = k * Math.PI;
  const lift = t < THROW.lift ? (t / THROW.lift) * 0.45 : Math.sin(k * Math.PI) * 0.55 + 0.45 * (1 - k);
  def.x = f.x + Math.cos(f.dir + turn) * THROW.reach * Math.max(0.35, Math.abs(Math.cos(turn)));
  def.z = f.z + Math.sin(f.dir + turn) * THROW.reach * Math.max(0.35, Math.abs(Math.cos(turn)));
  def.h = THROW.height * lift;
  def.vx = def.vz = def.vh = 0;
  def.dir = f.dir + Math.PI; // facing the thrower all the way round
  if (t === THROW.slam) {
    def.h = 0;
    def.state = 'idle'; // let the blow land on them like any other
    f.held = -1;
    if (s.phase === 'fight') {
      applyHit(s, f, def, MOVES.grab, f.x, f.z, 'grab');
    } else {
      def.state = 'down';
      def.t = 0;
      def.stun = DOWN_TICKS;
    }
    emit(s, 'slam', { by: f.slot, on: def.slot, x: def.x, z: def.z });
  }
  if (t >= THROW.end) setState(f, 'idle');
}

function airAttack(s, f, move) {
  f.state = 'airAttack';
  f.move = move;
  f.t = 0;
  f.hits = [];
  f.buf = 0;
  aim(s, f, 200);
  emit(s, 'swing', { by: f.slot, move });
}

function land(s, f) {
  f.vh = 0;
  const here = { by: f.slot, x: f.x, z: f.z };
  switch (f.state) {
    case 'jump':
      setState(f, 'idle');
      f.vx = f.vz = 0;
      emit(s, 'land', here);
      break;
    case 'airAttack':
      setState(f, 'land');
      f.stun = f.move === 'stomp' ? STOMP.rest : 4;
      f.vx = f.vz = 0;
      emit(s, f.move === 'stomp' ? 'stompLand' : 'land', here);
      f.move = null;
      break;
    case 'attack': // the rising special coming back down
      f.move = null;
      setState(f, 'land');
      f.stun = 14;
      f.vx = f.vz = 0;
      emit(s, 'land', here);
      break;
    case 'down':
      f.stun = DOWN_TICKS;
      f.teched = false;
      f.juggle = 0;
      emit(s, 'thud', here);
      break;
    case 'ko':
      emit(s, 'thud', here);
      break;
    default:
      break;
  }
}

function physics(s, f) {
  if (f.state === 'held') return; // carried by the thrower (see carryThrow)
  const wasAir = f.h > 0 || f.vh > 0;
  f.x += f.vx;
  f.z += f.vz;
  if (wasAir) {
    f.vh -= GRAVITY;
    f.h += f.vh;
    if (f.h <= 0) {
      f.h = 0;
      land(s, f);
    }
  } else if (f.state === 'hit' || f.state === 'down' || f.state === 'ko' || f.state === 'land' || (f.state === 'block' && f.stun > 0)) {
    f.vx *= FRICTION;
    f.vz *= FRICTION;
    if (Math.abs(f.vx) < 0.15) f.vx = 0;
    if (Math.abs(f.vz) < 0.15) f.vz = 0;
  }
}

// Nobody leaves the ring. A fighter who is knocked into its edge is scorched
// by the ring of fire and bounced back in.
function keepInside(s, f) {
  const limit = s.ringR - BODY_R;
  const r = Math.hypot(f.x, f.z);
  if (r <= limit) return;
  const nx = f.x / r;
  const nz = f.z / r;
  f.x = nx * limit;
  f.z = nz * limit;
  const outward = f.vx * nx + f.vz * nz;
  const flung = f.state === 'hit' || f.state === 'down';
  if (flung && outward > SPLAT.speed && s.phase === 'fight' && !f.scorched) {
    f.scorched = true; // once per knockback
    f.vx -= nx * outward * 1.7;
    f.vz -= nz * outward * 1.7;
    f.hp = Math.max(1, f.hp - SPLAT.dmg); // the fire hurts but never finishes a fighter
    emit(s, 'burn', { slot: f.slot, x: f.x, z: f.z, dmg: SPLAT.dmg });
  }
}

const isSolid = (f) => f.state !== 'down' && f.state !== 'ko' && f.state !== 'getup' && f.state !== 'held' && f.state !== 'throw';

// Fighters cannot stand inside each other. If one of them is backed against
// the edge of the ring, the other gives way instead.
function separate(s, a, b) {
  if (!isSolid(a) || !isSolid(b)) return;
  if (Math.abs(a.h - b.h) > 90) return; // one is jumping over the other
  const split = (p, q, share) => {
    let dx = q.x - p.x;
    let dz = q.z - p.z;
    let d = Math.hypot(dx, dz);
    const overlap = BODY_R * 2 - d;
    if (overlap <= 0) return;
    if (d < 0.001) {
      dx = p.slot < q.slot ? 1 : -1; // exactly on top of each other: split sideways
      dz = 0;
      d = 1;
    }
    p.x -= (dx / d) * overlap * (1 - share);
    p.z -= (dz / d) * overlap * (1 - share);
    q.x += (dx / d) * overlap * share;
    q.z += (dz / d) * overlap * share;
  };
  split(a, b, 0.5);
  // Whoever ended up outside the ring is put back, and the other takes the
  // whole correction.
  for (const [p, q] of [[a, b], [b, a]]) {
    if (Math.hypot(p.x, p.z) > s.ringR - BODY_R) {
      keepInside(s, p);
      split(p, q, 1);
    }
  }
}

function canBeHit(f) {
  // Both fighters in a throw can be hit by others: grabbing in a crowd is a
  // risk, and being thrown is no shelter. A hit on either ends the throw.
  // A fighter on the way down from a launcher can still be juggled.
  const juggled = f.state === 'down' && f.h > 0 && f.juggle > 0;
  return f.inv <= 0 && (f.state !== 'down' || juggled) && f.state !== 'getup' && f.state !== 'ko';
}

// Is `def` inside the wedge of `att`'s current attack?
function inWedge(att, def, m) {
  const dx = def.x - att.x;
  const dz = def.z - att.z;
  const d = Math.hypot(dx, dz);
  if (d > m.reach + BODY_R) return false;
  if (att.h + m.y1 < def.h || att.h + m.y0 > def.h + BODY_H) return false;
  return d < BODY_R || m.arc >= Math.PI || angleDiff(Math.atan2(dz, dx), att.dir) <= m.arc;
}

function activeMove(f) {
  if (f.state === 'attack') {
    const m = MOVES[f.move];
    if (!m.reach || f.t < m.startup || f.t >= m.startup + m.active) return null;
    return m;
  }
  if (f.state === 'airAttack') return f.t < MOVES[f.move].startup ? null : MOVES[f.move];
  return null;
}

// Last stand: a fighter under a quarter of their health fills the energy bar
// half as fast again, so the one behind gets a special or a finisher sooner
// and a round is not over before it is over.
const LAST_STAND = { below: 0.25, gain: 1.5 };
const lastStand = (f) => f.hp > 0 && f.hp < f.maxHp * LAST_STAND.below;

function addMeter(f, amount) {
  f.meter = Math.min(RULES.METER_MAX, f.meter + amount * (lastStand(f) ? LAST_STAND.gain : 1));
}

// Apply one connected attack. (fromX, fromZ) is where the blow comes from,
// which decides the push direction and whether the defender's guard faces it.
function applyHit(s, att, def, m, fromX, fromZ, kind) {
  let dx = def.x - fromX;
  let dz = def.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 0.001) {
    dx = Math.cos(att.dir);
    dz = Math.sin(att.dir);
  } else {
    dx /= d;
    dz /= d;
  }
  const blocked = !m.unblockable && def.state === 'block' && angleDiff(def.dir, Math.atan2(-dz, -dx)) <= BLOCK_ARC;
  const power = getFighter(att.char).stats.power * att.pw;
  const at = { x: def.x - dx * 14, z: def.z - dz * 14, h: def.h + (m.y1 < 60 ? 30 : 105) };

  if (blocked && def.guard > 0) {
    // Perfect guard: nothing gets through, and a heavy blow thrown from the
    // ground bounces off and leaves its owner open.
    def.guard = 0;
    def.deflect = 14;
    def.stun = 3;
    addMeter(def, GUARD.gain);
    const stagger = !!m.heavy && kind !== 'bolt' && kind !== 'super' && att.h <= 0 && !isOut(att);
    if (stagger) {
      att.state = 'hit';
      att.t = 0;
      att.move = null;
      att.buf = 0;
      att.stun = GUARD.stagger;
      att.reel = GUARD.stagger;
      att.vx = -dx * 5;
      att.vz = -dz * 5;
    }
    if (s.f.length === 2) s.hitstop = 8;
    else att.stop = def.stop = 5;
    emit(s, 'parry', { by: def.slot, on: att.slot, ...at, stagger });
    return;
  }
  if (blocked) {
    const chip = Math.max(1, Math.round(m.dmg * power * (m.chip ?? 0.15)));
    def.hp = Math.max(1, def.hp - chip); // a blocked hit never knocks out
    def.stun = m.blockstun;
    def.vx = dx * m.push * 0.8;
    def.vz = dz * m.push * 0.8;
    addMeter(att, m.gain * 0.5);
    addMeter(def, m.gain * 0.5);
    if (s.f.length === 2) s.hitstop = 3;
    emit(s, 'block', { by: att.slot, on: def.slot, ...at, dmg: chip });
    return;
  }

  // A grab that connects seizes the rival: the throw itself (carryThrow)
  // lands the blow on the slam.
  if (kind === 'grab' && att.state === 'attack' && def.h <= 0) {
    att.state = 'throw';
    att.t = 0;
    att.move = null;
    att.held = def.slot;
    def.state = 'held';
    def.t = 0;
    def.move = null;
    def.buf = 0;
    def.stun = 0;
    if (s.f.length === 2) s.hitstop = 4;
    emit(s, 'seize', { by: att.slot, on: def.slot, x: def.x, z: def.z, h: 90 });
    return;
  }

  // A rival struck while being carried is torn loose: the thrower lets go.
  if (def.state === 'held') {
    const thrower = s.f.find((o) => o.held === def.slot);
    if (thrower) {
      thrower.held = -1;
      setState(thrower, 'idle');
    }
  }
  // A thrower who is hit lets go: the rival drops to the floor unhurt.
  if (def.state === 'throw' && def.held >= 0) {
    const dropped = s.f[def.held];
    def.held = -1;
    if (dropped && dropped.state === 'held') {
      dropped.state = 'down';
      dropped.t = 0;
      dropped.stun = DOWN_TICKS;
      dropped.vh = 0;
    }
  }

  const juggled = def.state === 'down'; // struck in the air after a launcher
  // Caught winding up? (Checked before the hit wipes out their move.)
  const wound = def.state === 'attack' && MOVES[def.move];
  const counter = !!wound && def.t < wound.startup;
  def.taken++;
  def.reel = 0;
  def.scorched = false;
  const scale = Math.max(0.5, 1 - 0.12 * (def.taken - 1)); // long combos hit softer
  const dmg = Math.max(1, Math.round(m.dmg * power * scale * (counter ? COUNTER.dmg : 1)));
  const dealt = Math.min(dmg, def.hp); // a finishing blow cannot take more than is left
  const wasStanding = lastStand(def);
  def.hp = Math.max(0, def.hp - dmg);
  if (!wasStanding && lastStand(def)) emit(s, 'lastStand', { slot: def.slot });
  addMeter(att, m.gain);
  addMeter(def, m.gain * 0.6 + dmg * 0.4);
  def.move = null;
  def.buf = 0;
  const big = kind === 'super';

  if (def.hp <= 0) {
    def.state = 'ko';
    def.t = 0;
    def.vh = 9.5;
    def.vx = dx * 6;
    def.vz = dz * 6;
    def.koBy = kind;
    def.outAt = s.tick;
    emit(s, 'out', { slot: def.slot, by: att.slot });
  } else if (m.knockdown || def.h > 0) {
    def.state = 'down';
    def.t = 0;
    def.stun = DOWN_TICKS;
    def.vh = m.launch || (big ? 10 : juggled ? 6.5 : 7.5);
    const away = m.launch ? 1.2 : big ? 8 : 5; // a launcher keeps them close to chase
    def.vx = dx * away;
    def.vz = dz * away;
    def.juggle = m.launch ? JUGGLE : juggled ? def.juggle - 1 : 0;
  } else {
    def.state = 'hit';
    def.t = 0;
    def.stun = m.hitstun;
    def.vx = dx * m.push;
    def.vz = dz * m.push;
  }
  // The impact of a hit freezes the action for a beat. In a duel the whole
  // world stops; in a brawl only the two fighters involved do, so the others
  // are not made to stutter (the finisher still stops everyone).
  const extra = counter ? COUNTER.stop : 0;
  if (s.f.length === 2) s.hitstop = (big ? 12 : m.heavy ? 7 : 4) + extra;
  else if (big) s.hitstop = 6;
  else att.stop = def.stop = (m.heavy ? 5 : 3) + extra;
  emit(s, 'hit', { by: att.slot, on: def.slot, ...at, dmg, dealt, heavy: !!m.heavy, kind, combo: def.taken, counter, juggle: juggled });
}

function resolveHits(s) {
  // Work out every hit first, then apply them, so fighters who strike on the
  // same tick all get hit (a "trade") instead of the lower slot always winning.
  const pending = [];
  for (const att of s.f) {
    const m = activeMove(att);
    if (!m) continue;
    for (const def of s.f) {
      if (def === att || att.hits.includes(def.slot) || !canBeHit(def)) continue;
      if (inWedge(att, def, m)) pending.push({ att, def, m, x: att.x, z: att.z, kind: att.move });
    }
  }
  for (const p of pending) p.att.hits.push(p.def.slot);
  for (const p of pending) if (canBeHit(p.def) || p.def.state === 'ko') applyHitOnce(s, p);

  // Projectiles.
  for (const p of s.proj) {
    p.x += p.vx;
    p.z += p.vz;
    if (--p.life <= 0 || Math.hypot(p.x, p.z) > s.ringR + 40) p.dead = true;
  }
  for (let i = 0; i < s.proj.length; i++) {
    for (let j = i + 1; j < s.proj.length; j++) {
      const p = s.proj[i];
      const q = s.proj[j];
      if (!p.dead && !q.dead && p.owner !== q.owner && Math.hypot(p.x - q.x, p.z - q.z) < PROJECTILE.r * 2) {
        p.dead = q.dead = true;
        emit(s, 'clash', { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, h: p.h });
      }
    }
  }
  for (const p of s.proj) {
    if (p.dead) continue;
    for (const def of s.f) {
      if (def.slot === p.owner || !canBeHit(def)) continue;
      if (Math.hypot(def.x - p.x, def.z - p.z) > PROJECTILE.r + BODY_R) continue;
      if (p.h + PROJECTILE.r < def.h || p.h - PROJECTILE.r > def.h + BODY_H) continue;
      p.dead = true;
      applyHit(s, s.f[p.owner], def, MOVES.bolt, p.x - p.vx * 3, p.z - p.vz * 3, 'bolt');
      break;
    }
  }
  s.proj = s.proj.filter((p) => !p.dead);
}

// A fighter already knocked out by an earlier hit on this same tick is left alone.
function applyHitOnce(s, p) {
  if (p.def.state === 'ko') return;
  applyHit(s, p.att, p.def, p.m, p.x, p.z, p.kind);
}

// Hand out the points for a finished round.
//   Standing fighters come first (the healthier the better), then the fallen,
//   the last to fall first. Fighters who cannot be separated share a place,
//   and a shared place is worth the lowest position in the group - so a tie
//   never crowns a winner.
function scoreRound(s) {
  const n = s.f.length;
  const key = (f) => (isOut(f) ? f.outAt : 1e9 + f.hp / f.maxHp);
  const order = [...s.f].sort((a, b) => key(b) - key(a));
  s.roundPts = s.f.map(() => 0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && key(order[j + 1]) === key(order[i])) j++;
    for (let k = i; k <= j; k++) s.roundPts[order[k].slot] = s.mode === 'duel' ? (j === 0 ? 1 : 0) : n - 1 - j;
    i = j + 1;
  }
  const best = Math.max(...s.roundPts);
  const top = s.roundPts.filter((p) => p === best).length;
  s.winner = best > 0 && top === 1 ? s.roundPts.indexOf(best) : -1;
  for (let k = 0; k < n; k++) s.pts[k] += s.roundPts[k];
}

function endRound(s, kind) {
  s.phase = 'ko';
  s.pt = 0;
  s.koKind = kind;
  s.proj = [];
  s.items = [];
  scoreRound(s);
  const w = s.winner >= 0 ? s.f[s.winner] : null;
  const last = s.f.filter(isOut).sort((a, b) => b.outAt - a.outAt)[0];
  emit(s, kind === 'ko' ? 'ko' : 'timeup', {
    winner: s.winner,
    perfect: !!w && w.hp === w.maxHp,
    finisher: kind === 'ko' && !!last && last.koBy === 'super',
  });
}

function standings(s) {
  const order = s.f.map((f) => ({ slot: f.slot, char: f.char, points: s.pts[f.slot] })).sort((a, b) => b.points - a.points);
  order.forEach((r, i) => {
    r.rank = i > 0 && order[i - 1].points === r.points ? order[i - 1].rank : i + 1;
  });
  return order;
}

function endMatch(s) {
  s.phase = 'over';
  s.pt = 0;
  s.ranking = standings(s);
  const leaders = s.ranking.filter((r) => r.rank === 1);
  s.matchWinner = leaders.length === 1 ? leaders[0].slot : -1;
  for (const f of s.f) if (!isOut(f)) setState(f, f.slot === s.matchWinner ? 'win' : s.matchWinner >= 0 ? 'lose' : 'idle');
  emit(s, 'matchEnd', { winner: s.matchWinner });
}

function resetRound(s) {
  const n = s.f.length;
  s.f = s.f.map((old, i) => {
    const f = newFighter(old.char, i, n, s.mods[i]);
    f.meter = old.meter;
    return f;
  });
  s.proj = [];
  s.items = [];
  s.nextItem = ITEMS.first * TICK_RATE;
  s.timer = MODES[s.mode].seconds * TICK_RATE;
  s.ringR = ARENA.R;
  s.phase = 'intro';
  s.pt = 0;
  s.koKind = null;
  s.winner = -1;
}

const canCelebrate = (f) => f.h <= 0 && (f.state === 'idle' || f.state === 'walk' || f.state === 'block');

// Advance the match by one tick. `inputs` holds one button state per fighter.
export function step(s, inputs) {
  s.ev = [];
  s.tick++;
  const fighting = s.phase === 'fight';
  const rules = MODES[s.mode];

  for (const f of s.f) {
    const inp = fighting && !isOut(f) ? inputs[f.slot] | 0 : 0;
    if (fighting) rememberPresses(f, inp);
    if (fighting && inp & INPUT.JUMP && !(f.prev & INPUT.JUMP)) f.jumpT = AIR_JUMP.buffer;
    else if (f.jumpT > 0) f.jumpT--;
    f.prev = inp;
  }

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
    for (const f of s.f) f.t++;
    if (s.pt >= TIMING.INTRO) {
      s.phase = 'fight';
      s.pt = 0;
    }
    return s;
  }

  if (s.phase === 'over') {
    for (const f of s.f) {
      physics(s, f);
      f.t++;
    }
    return s;
  }

  // Slow motion right after the knockout that ends a round.
  if (s.phase === 'ko' && s.koKind === 'ko' && s.pt < 60 && s.pt % 2 === 0) return s;

  // The ring of fire closes in as the clock runs down.
  if (fighting) {
    const shrinkAt = rules.shrinkAt * TICK_RATE;
    const k = Math.min(1, Math.max(0, (shrinkAt - s.timer) / (shrinkAt - 5 * TICK_RATE)));
    s.ringR = ARENA.R - (ARENA.R - ARENA.R_MIN) * k;
  }

  for (const f of s.f) if (f.stop <= 0) control(s, f, f.prev);
  for (const f of s.f) if (f.stop <= 0) physics(s, f);
  for (let i = 0; i < s.f.length; i++) for (let j = i + 1; j < s.f.length; j++) separate(s, s.f[i], s.f[j]);
  for (const f of s.f) keepInside(s, f);

  if (fighting) {
    resolveHits(s);
    updateItems(s);
    for (const f of s.f) if (f.inv > 0) f.inv--;
  }
  for (const f of s.f) {
    if (f.stop > 0) f.stop--;
    else f.t++;
  }

  if (fighting) {
    const standing = s.f.filter((f) => !isOut(f));
    if (standing.length <= 1) {
      endRound(s, 'ko');
    } else if (--s.timer <= 0) {
      s.timer = 0;
      endRound(s, 'time');
    }
    return s;
  }

  // phase === 'ko': the round is decided, let the dust settle.
  if (s.pt > 50) {
    for (const f of s.f) {
      if (isOut(f) || !canCelebrate(f)) continue;
      const mood = f.slot === s.winner ? 'win' : s.koKind === 'time' && s.winner >= 0 ? 'lose' : null;
      if (mood && f.state !== mood) {
        setState(f, mood);
        f.vx = f.vz = 0;
      }
    }
  }
  if (s.pt >= (s.koKind === 'ko' ? TIMING.KO : TIMING.TIMEUP)) {
    const decided = Math.max(...s.pts) >= rules.pointsToWin && s.pts.filter((p) => p >= rules.pointsToWin).length === 1;
    if (decided || s.round >= rules.maxRounds) {
      endMatch(s);
    } else {
      s.round++;
      resetRound(s);
    }
  }
  return s;
}
