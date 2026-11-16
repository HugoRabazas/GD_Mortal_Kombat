// The CPU fighter. It looks at the match state and answers with the buttons it
// wants to hold, exactly like a human player would, so it cannot cheat.
//
// Each decision: pick a rival, defend if something is about to land, use the
// special or the finisher when it is likely to connect, otherwise close the
// distance and strike.

import { INPUT, RULES } from './constants.js';
import { getFighter } from './fighters.js';
import { MOVES, markedBy, EX } from './sim.js';

// `parry` is how often the CPU manages a last-moment guard (a perfect guard,
// see GUARD in sim.js). A guard raised that late is always perfect, so when
// the CPU fails this roll it is simply too slow: it rolls away or gets hit.
// `punish` is how often it sees an opening - a rival reeling from a perfect
// guard, or stuck in the recovery of a move that missed - and makes them pay.
const LEVELS = {
  easy: { think: 16, block: 0.25, attack: 0.3, special: 0.02, parry: 0, punish: 0.15 },
  normal: { think: 8, block: 0.6, attack: 0.58, special: 0.07, parry: 0.1, punish: 0.45 },
  hard: { think: 5, block: 0.8, attack: 0.7, special: 0.1, parry: 0.28, punish: 0.75 },
  boss: { think: 4, block: 0.86, attack: 0.78, special: 0.14, parry: 0.58, punish: 0.95 },
};

// Ticks a fighter still has to wait before acting again, if it is recovering
// from a move that has stopped hitting; 0 otherwise.
function recoveryLeft(e) {
  const m = e.state === 'attack' && MOVES[e.move];
  if (!m || e.t < m.startup + m.active) return 0;
  return m.startup + m.active + m.recovery - e.t;
}

// True while an attack can still land: before and during its active frames.
function threatening(e) {
  if (e.state === 'airAttack') return true;
  const m = e.state === 'attack' && MOVES[e.move];
  return !!m && e.t < m.startup + m.active;
}
const LATE = 4; // a guard raised this many ticks before the blow, or fewer, is a perfect guard

// Each kind of fighter has its own way of fighting, keyed by its special move:
//   dash  - a rusher: always pressing forward, quick to strike
//   bolt  - a zoner: backs off to make room, then shoots
//   quake - a bruiser: guards more, walks you down
//   rise  - a skirmisher: rolls round your side, in and out
const SAVE_FROM = 64; // see `saving`

const STYLES = {
  dash: { attack: 0.02, special: 1.15, wary: 0.55 },
  bolt: { special: 1.8, retreat: 0.1 },
  quake: { block: 0.08 },
  rise: { attack: 0.04, circle: 0.07, wary: 0.5 },
};

export function createAI(level = 'normal', seed = 1) {
  return { cfg: LEVELS[level] || LEVELS.normal, seed: seed >>> 0 || 1, wait: 0, held: 0, tap: 0, tapT: 0, target: -1, retarget: 0 };
}

// Small deterministic random generator (mulberry32).
function rnd(ai) {
  ai.seed = (ai.seed + 0x6d2b79f5) >>> 0;
  let t = ai.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// The stick position (as button bits) that walks along (dx, dz).
function toward(dx, dz) {
  const d = Math.hypot(dx, dz) || 1;
  let bits = 0;
  if (dx / d < -0.38) bits |= INPUT.LEFT;
  if (dx / d > 0.38) bits |= INPUT.RIGHT;
  if (dz / d < -0.38) bits |= INPUT.UP;
  if (dz / d > 0.38) bits |= INPUT.DOWN;
  return bits;
}

// A rival whose finisher is after someone else (caught, or set out after)
// cannot be stopped by this fighter's blows (see applyHit): a waste.
const unstoppable = (o, f) => o.state === 'attack' && !!MOVES[o.move]?.ult && markedBy(o) >= 0 && markedBy(o) !== f.slot;

function pickTarget(ai, s, f) {
  let best = -1;
  let bestScore = Infinity;
  const rivals = s.f.filter((o) => o !== f && o.hp > 0);
  const lead = Math.max(...rivals.map((o) => s.pts[o.slot]));
  const fittest = Math.max(...rivals.map((o) => o.hp)); // the most health left, not the fullest bar: the big ones draw the pack
  for (const o of rivals) {
    // Whoever is close comes first. In a brawl the pack also turns on whoever
    // is ahead on points or still fresh, the way players gang up on a leader,
    // and a rival who is nearly beaten is worth finishing.
    let score = Math.hypot(o.x - f.x, o.z - f.z) + rnd(ai) * 80;
    if (rivals.length > 1) {
      if (s.pts[o.slot] === lead && lead > s.pts[f.slot]) score -= 110;
      if (o.hp === fittest) score -= 70;
      if (o.hp / o.maxHp < 0.25) score -= 60;
      // (Easy does not know better.)
      if (ai.cfg.parry > 0 && unstoppable(o, f)) score += 400;
    }
    if (score < bestScore) {
      bestScore = score;
      best = o.slot;
    }
  }
  return best;
}

export function aiInput(ai, s, me) {
  const f = s.f[me];
  if (s.phase !== 'fight' || f.hp <= 0) return 0;
  const cfg = ai.cfg;

  // Attack buttons are tapped (held 2 ticks) so each decision is one press.
  let tap = 0;
  if (ai.tapT > 0) {
    ai.tapT--;
    tap = ai.tap;
  }
  // Keep a string going once a blow has landed (one decision per blow):
  // the next punch, the kick that ends it, or - after a launcher - a jump
  // to chase the rival into the air.
  const sm = f.state === 'attack' && MOVES[f.move];
  if (sm && f.hits.length && ai.tapT === 0 && ai.chained !== f.move && (sm.next || sm.nextK || sm.launch)) {
    ai.chained = f.move;
    // With energy in hand, a blow that landed is sometimes cancelled into
    // the special (as often as it punishes, by half).
    if (!sm.launch && f.meter >= RULES.SPECIAL_COST && rnd(ai) < cfg.punish * 0.15) {
      ai.tap = INPUT.SPECIAL;
      ai.tapT = 2;
      return INPUT.SPECIAL;
    }
    // How reliably it finishes a string is a matter of skill (like punishing).
    if (sm.launch) {
      if (rnd(ai) < cfg.punish) {
        ai.held = INPUT.JUMP;
        ai.wait = 4;
        return INPUT.JUMP;
      }
    } else if (rnd(ai) < cfg.punish + 0.1) {
      ai.tap = sm.nextK && (!sm.next || rnd(ai) < 0.35) ? INPUT.KICK : INPUT.PUNCH;
      ai.tapT = 2;
      return ai.tap;
    }
  }
  if (f.state !== 'attack') ai.chained = false;
  // Seized: break the throw, as often as it manages a perfect guard (decided once).
  if (f.state === 'held') {
    if (!ai.heldSeen) {
      ai.heldSeen = true;
      if (rnd(ai) < cfg.parry) {
        ai.tap = INPUT.GRAB;
        ai.tapT = 2;
        return INPUT.GRAB;
      }
    }
  } else ai.heldSeen = false;
  // A perfect guard just made: answer with the riposte (or the launcher), as
  // often as it punishes (decided once per guard).
  if (f.rip > 0 && !ai.ripSeen) {
    ai.ripSeen = true;
    if (rnd(ai) < cfg.punish) {
      ai.tap = rnd(ai) < 0.35 ? INPUT.KICK : INPUT.PUNCH; // the palm strike, or the launcher
      ai.tapT = 2;
      return ai.tap;
    }
  } else if (f.rip <= 0) ai.ripSeen = false;
  // Getting up with a rival close: now and then roll clear instead.
  if (f.state === 'getup' && f.t === 4 && ai.target >= 0) {
    const o = s.f[ai.target];
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (o.hp > 0 && d < 130 && rnd(ai) < cfg.block * 0.25) {
      // Away from them, but never out towards the fire.
      let wx = f.x - o.x;
      let wz = f.z - o.z;
      if (Math.hypot(f.x + (wx / (d || 1)) * 130, f.z + (wz / (d || 1)) * 130) > s.ringR - 60) [wx, wz] = [-wz, wx];
      ai.held = toward(wx, wz) | INPUT.BLOCK;
      ai.wait = 3;
      return ai.held;
    }
  }
  // Out of a roll, or getting up, with a rival close: sometimes strike
  // (decided once, at the tick the move becomes possible).
  if ((f.state === 'roll' && f.t === 7) || (f.state === 'getup' && f.t === 4)) {
    const o = ai.target >= 0 ? s.f[ai.target] : null;
    const near = o && o.hp > 0 && Math.hypot(o.x - f.x, o.z - f.z) < (f.state === 'roll' ? 150 : 115);
    if (near && rnd(ai) < cfg.attack * (f.state === 'roll' ? 0.45 : 0.4)) {
      ai.tap = f.state === 'roll' && rnd(ai) < 0.5 ? INPUT.PUNCH : INPUT.KICK;
      ai.tapT = 2;
      return ai.tap;
    }
  }
  // In the air: now and then a second jump at the top of the first, and a
  // stomp on a rival found right underneath (each decided once per jump).
  // An air punch that landed: follow it with the axe kick (as often as it punishes).
  if (f.state === 'airAttack' && f.move === 'airPunch' && f.hits.length && f.t >= 3 && ai.airPlan < 4) {
    ai.airPlan = 4;
    if (rnd(ai) < cfg.punish) {
      ai.tap = INPUT.KICK;
      ai.tapT = 2;
      return INPUT.KICK;
    }
  }
  // A flying kick that landed: the hammer fist after it (as often as it punishes).
  if (f.state === 'airAttack' && f.move === 'airKick' && f.hits.length && f.t >= 3 && ai.airPlan < 4) {
    ai.airPlan = 4;
    if (rnd(ai) < cfg.punish) {
      ai.tap = INPUT.PUNCH;
      ai.tapT = 2;
      return INPUT.PUNCH;
    }
  }
  if (f.state !== 'jump' && f.state !== 'airAttack') {
    ai.airPlan = 0;
    ai.airSpecial = false;
  }
  // In the air with energy and a rival in reach of the air special: now and
  // then use it (decided once per jump, apart from the other air plans).
  if (f.state === 'jump' && f.t >= 6 && !ai.airSpecial && f.meter >= RULES.SPECIAL_COST && ai.target >= 0) {
    const o = s.f[ai.target];
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    ai.airSpecial = true;
    if (d < 170 && o.h <= 0 && rnd(ai) < cfg.punish * 0.4) {
      // Now and then the EX version, as on the ground.
      const ex = cfg.parry >= 0.28 && f.meter >= EX.cost && f.meter < RULES.SUPER_COST && rnd(ai) < 0.35;
      ai.tap = ex ? INPUT.SPECIAL | INPUT.PUNCH : INPUT.SPECIAL;
      ai.tapT = 2;
      return ai.tap;
    }
  }
  else if (f.state === 'jump' && ai.target >= 0 && f.runJump && f.t >= 2 && f.t < 12 && ai.airPlan < 2) {
    // A jump out of a run: the flying knee once the rival is in reach.
    const o = s.f[ai.target];
    if (Math.hypot(o.x - f.x, o.z - f.z) < 150) {
      ai.airPlan = 2;
      ai.tap = INPUT.KICK;
      ai.tapT = 2;
      return INPUT.KICK;
    }
  }
  if (f.state === 'jump' && ai.target >= 0) {
    const o = s.f[ai.target];
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (!f.air2 && f.t === 9 && !ai.airPlan) {
      ai.airPlan = 1;
      if (d < 260 && rnd(ai) < 0.25) {
        ai.held = toward(o.x - f.x, o.z - f.z) | INPUT.JUMP;
        ai.wait = 3;
        return ai.held;
      }
    }
    // A rival launched into the air: strike them before they land.
    if (o.state === 'down' && o.h > 0 && o.juggle > 0 && d < 95 && f.t >= 3 && ai.airPlan < 3) {
      ai.airPlan = 3;
      const r = rnd(ai);
      ai.tap = r < 0.45 ? INPUT.GRAB : r < 0.75 ? INPUT.PUNCH : INPUT.KICK; // the air throw ends a juggle too
      ai.tapT = 2;
      return ai.tap;
    }
    // A rival in the air alongside: an air throw, as often as it punishes.
    if ((o.state === 'jump' || o.state === 'airAttack') && o.h > 25 && d < 90 && Math.abs(o.h - f.h) < 100 && ai.airPlan < 3) {
      ai.airPlan = 3;
      if (rnd(ai) < cfg.punish * 0.6) {
        ai.tap = INPUT.GRAB;
        ai.tapT = 2;
        return INPUT.GRAB;
      }
    }
    if (f.vh < 0 && d < 50 && o.h <= 0 && ai.airPlan < 2) {
      ai.airPlan = 2;
      if (rnd(ai) < cfg.attack * 0.7) {
        ai.tap = INPUT.GRAB;
        ai.tapT = 2;
        return INPUT.GRAB;
      }
    }
  }
  if (ai.wait > 0) {
    ai.wait--;
    return ai.held | tap;
  }

  if (ai.target < 0 || s.f[ai.target].hp <= 0 || --ai.retarget <= 0 || (ai.cfg.parry > 0 && unstoppable(s.f[ai.target], f))) {
    ai.target = pickTarget(ai, s, f);
    ai.retarget = 10;
  }
  if (ai.target < 0) return 0;
  const o = s.f[ai.target];
  const dx = o.x - f.x;
  const dz = o.z - f.z;
  const dist = Math.hypot(dx, dz);
  const special = getFighter(f.char).special.type;
  const style = STYLES[special] || {};
  const blockChance = cfg.block + (style.block || 0);
  const specialChance = cfg.special * (style.special || 1);
  // In a brawl a dasher close to a full bar keeps it for the finisher rather
  // than spend a third of it on one more dash (they ran out of finishers).
  const saving = s.f.length > 2 && special === 'dash' && f.meter >= SAVE_FROM && f.meter < RULES.SUPER_COST;
  // The special, or now and then its EX version when there is energy for it
  // (not on Easy; never with the finisher's full bar in hand).
  const sp = () => press(cfg.parry > 0 && f.meter >= EX.cost && f.meter < RULES.SUPER_COST && rnd(ai) < 0.35 ? INPUT.SPECIAL | INPUT.PUNCH : INPUT.SPECIAL);

  const press = (bits, extra = 0) => {
    ai.tap = bits;
    ai.tapT = 2;
    ai.held = extra;
    ai.wait = cfg.think;
    return bits | extra;
  };
  const hold = (bits, ticks) => {
    ai.held = bits;
    ai.wait = ticks;
    return bits;
  };

  // --- defence ---
  // Is it too late to guard in the ordinary way? If the blow is `due` within
  // the perfect-guard window and the guard has been down long enough to earn
  // one, raising it now would be a perfect guard - which takes skill.
  const fumbles = (due) => f.state !== 'block' && f.open >= 20 && due <= LATE && rnd(ai) >= cfg.parry;
  for (const e of s.f) {
    if (e === f || e.hp <= 0) continue;
    const ex = f.x - e.x;
    const ez = f.z - e.z;
    const ed = Math.hypot(ex, ez);
    if (!threatening(e)) continue; // a move already spent is an opening, not a threat
    // A ground stomp cannot be blocked well: jump over it.
    if (e.move === 'quake' && ed < 230 && rnd(ai) < blockChance) return hold(INPUT.JUMP, 4);
    // A slide goes under a guard: jump it.
    if (e.move === 'slide' && ed < 200 && rnd(ai) < blockChance) return hold(INPUT.JUMP, 4);
    const facingMe = angleDiff(Math.atan2(ez, ex), e.dir) < 0.9;
    if (ed < 190 && facingMe && rnd(ai) < blockChance) {
      // Sometimes roll round to the attacker's side instead of blocking.
      if (rnd(ai) < 0.22) return hold(toward(-ez, ex) | INPUT.BLOCK, 3);
      // ...or hop straight back out of reach.
      if (rnd(ai) < 0.12) return hold(toward(ex, ez) | INPUT.BLOCK, 3);
      if (fumbles((MOVES[e.move]?.startup ?? 0) - e.t)) {
        if (rnd(ai) < 0.5) return hold(toward(-ez, ex) | INPUT.BLOCK, 3);
        continue; // caught flat-footed
      }
      if (special === 'rise' && f.meter >= RULES.SPECIAL_COST && ed < 90 && rnd(ai) < 0.4) return sp();
      return hold(INPUT.BLOCK, 12 + Math.floor(rnd(ai) * 8));
    }
  }
  for (const p of s.proj) {
    if (p.owner === me) continue;
    const px = f.x - p.x;
    const pz = f.z - p.z;
    const along = px * p.vx + pz * p.vz; // > 0 when it is flying towards us
    const pd = Math.hypot(px, pz);
    if (along <= 0 || pd > 260) continue;
    const speed = Math.hypot(p.vx, p.vz);
    const miss = Math.abs(px * p.vz - pz * p.vx) / speed; // how far off to the side it will pass
    if (miss < 50 && rnd(ai) < blockChance) {
      // Roll or step sideways out of its path, or put the guard up.
      const side = rnd(ai) < 0.5 ? 1 : -1;
      const roll = rnd(ai);
      if (roll < 0.35) return hold(toward(-p.vz * side, p.vx * side) | INPUT.BLOCK, 3);
      if (roll < 0.7) return hold(toward(-p.vz * side, p.vx * side), 10);
      if (fumbles((pd - 45) / speed)) return hold(toward(-p.vz * side, p.vx * side) | INPUT.BLOCK, 3);
      return hold(INPUT.BLOCK, 14);
    }
  }

  // --- in a brawl, do not stand between two rivals ---
  if (s.f.length > 2) {
    let near = 0;
    let cx = 0;
    let cz = 0;
    for (const e of s.f) {
      if (e === f || e.hp <= 0 || Math.hypot(e.x - f.x, e.z - f.z) > 150) continue;
      near++;
      cx += e.x;
      cz += e.z;
    }
    if (near >= 2 && rnd(ai) < (style.wary ?? 0.25)) return hold(toward(f.x - cx / near, f.z - cz / near), 10);
  }

  // --- stay inside the ring of fire ---
  const r = Math.hypot(f.x, f.z);
  if (r > s.ringR - 70 && dist > 120) return hold(toward(-f.x, -f.z), 8);

  // --- punish an opening ---
  // A rival reeling from a perfect guard, or still recovering from a move,
  // cannot block: step in and hit them before they can act again.
  const left = recoveryLeft(o);
  const reeling = o.state === 'hit' && o.reel > 0;
  if ((reeling || left >= 10) && o.h <= 0 && rnd(ai) < cfg.punish) {
    if (dist < 90) return press(reeling || left < 14 ? INPUT.PUNCH : INPUT.KICK);
    if (special === 'dash' && !saving && f.meter >= RULES.SPECIAL_COST && dist > 110 && dist < 280) return sp();
    if (dist < 230) return hold(toward(dx, dz), 4);
  }

  // --- grab a crystal when it is worth it and nobody is on top of us ---
  if (dist > 130) {
    for (const it of s.items) {
      const wants = it.kind === 'energy' ? f.meter < RULES.METER_MAX : f.hp < f.maxHp * 0.75;
      const id = Math.hypot(it.x - f.x, it.z - f.z);
      if (wants && id < 300 && id < dist) return hold(toward(it.x - f.x, it.z - f.z), 6);
    }
  }

  // --- finisher and special when they are likely to land ---
  // (The phoenix climbs nearly straight up, so it waits until the rival is close.)
  const ultRange = getFighter(f.char).super.move === 'phoenix' ? 150 : 340;
  if (f.meter >= RULES.SUPER_COST && dist < ultRange && o.h <= 0 && rnd(ai) < cfg.special * 2) return press(INPUT.SUPER);
  // A zoner with a shot in hand steps back to make the room to use it.
  if (style.retreat && dist > 100 && dist < 190 && o.state !== 'attack' && f.meter >= RULES.SPECIAL_COST && r < s.ringR - 120 && rnd(ai) < style.retreat) return hold(toward(-dx, -dz), 10);
  if (f.meter >= RULES.SPECIAL_COST && rnd(ai) < specialChance) {
    if (special === 'bolt' && dist > 200) return sp();
    if (special === 'dash' && !saving && dist > 110 && dist < 280) return sp();
    if (special === 'rise' && dist < 85) return sp();
    if (special === 'quake' && dist < 170 && o.h <= 0) return sp();
  }

  // Knocked down: a quick rise (block on the floor) as often as a guard.
  if (f.state === 'down') return f.h <= 0 && rnd(ai) < blockChance * 0.5 ? hold(INPUT.BLOCK, 4) : hold(0, 4);

  if (o.state === 'down' || o.state === 'getup') {
    // A rival floored and out of reach: now and then a taunt.
    if (dist > 140 && f.state === 'idle' && f.meter < RULES.SUPER_COST && rnd(ai) < 0.12) return press(INPUT.GRAB, INPUT.BLOCK);
    return dist < 120 ? hold(toward(-dx, -dz), 8) : hold(0, 6); // give them room to stand
  }

  if (dist > 112) {
    // Running in from just out of reach: a lunging straight or a slide.
    if (dist < 170 && f.state === 'walk' && f.t >= 8 && o.h <= 0 && rnd(ai) < cfg.attack * 0.3) return press(rnd(ai) < 0.6 ? INPUT.PUNCH : INPUT.KICK, toward(dx, dz));
    // ...or the fighter's signature move to cross the gap (grab out of reach).
    if (dist > 130 && dist < 240 && o.h <= 0 && rnd(ai) < cfg.attack * 0.08) return press(INPUT.GRAB);
    // ...or a jump out of the run for a flying knee.
    if (dist < 240 && f.state === 'walk' && f.t >= 8 && o.h <= 0 && rnd(ai) < cfg.attack * 0.1) return hold(toward(dx, dz) | INPUT.JUMP, 2);
    if (rnd(ai) < 0.05) return hold(toward(dx, dz) | INPUT.JUMP, 3);
    return hold(toward(dx, dz), 5 + Math.floor(rnd(ai) * 7));
  }

  // A skirmisher likes to roll round to the rival's side before striking.
  if (style.circle && dist < 220 && rnd(ai) < style.circle) return hold(toward(-dz, dx) | INPUT.BLOCK, 3);

  // A rival hiding behind a guard: now and then the charged kick that breaks it.
  if (o.state === 'block' && dist < 110 && rnd(ai) < cfg.attack * 0.3) return hold(INPUT.KICK, 18);
  // A rival hiding behind a guard gets grabbed.
  if (o.state === 'block' && dist < 84 && rnd(ai) < cfg.attack * 0.35) return press(INPUT.GRAB);

  // A rival standing by the fire with the flames beyond them: a fire toss.
  const ro = Math.hypot(o.x, o.z) || 1;
  if (dist < 70 && o.h <= 0 && s.ringR - ro < 110 && (dx * o.x + dz * o.z) / (dist * ro || 1) > 0.55 && rnd(ai) < cfg.punish * 0.3) return press(INPUT.GRAB);

  // --- in range ---
  const roll = rnd(ai);
  if (roll < cfg.attack + (style.attack || 0)) return press(rnd(ai) < 0.55 ? INPUT.PUNCH : INPUT.KICK);
  if (roll < cfg.attack + 0.15) return hold(toward(-dx, -dz), 10); // back off
  if (roll < cfg.attack + 0.3) return hold(toward(-dz, dx), 9); // circle round
  return hold(0, Math.max(3, cfg.think - 2));
}
