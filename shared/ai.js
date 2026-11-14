// The CPU fighter. It looks at the match state and answers with the buttons it
// wants to hold, exactly like a human player would, so it cannot cheat.
//
// Each decision: pick a rival, defend if something is about to land, use the
// special or the finisher when it is likely to connect, otherwise close the
// distance and strike.

import { INPUT, RULES } from './constants.js';
import { getFighter } from './fighters.js';

const LEVELS = {
  easy: { think: 16, block: 0.25, attack: 0.3, special: 0.02 },
  normal: { think: 8, block: 0.6, attack: 0.58, special: 0.07 },
  hard: { think: 5, block: 0.8, attack: 0.7, special: 0.1 },
  boss: { think: 4, block: 0.84, attack: 0.76, special: 0.14 },
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

function pickTarget(ai, s, f) {
  let best = -1;
  let bestScore = Infinity;
  const rivals = s.f.filter((o) => o !== f && o.hp > 0);
  const lead = Math.max(...rivals.map((o) => s.pts[o.slot]));
  const fittest = Math.max(...rivals.map((o) => o.hp / o.maxHp));
  for (const o of rivals) {
    // Whoever is close comes first. In a brawl the pack also turns on whoever
    // is ahead on points or still fresh, the way players gang up on a leader,
    // and a rival who is nearly beaten is worth finishing.
    let score = Math.hypot(o.x - f.x, o.z - f.z) + rnd(ai) * 80;
    if (rivals.length > 1) {
      if (s.pts[o.slot] === lead && lead > s.pts[f.slot]) score -= 110;
      if (o.hp / o.maxHp === fittest) score -= 70;
      if (o.hp / o.maxHp < 0.25) score -= 60;
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
  if (ai.wait > 0) {
    ai.wait--;
    return ai.held | tap;
  }

  if (ai.target < 0 || s.f[ai.target].hp <= 0 || --ai.retarget <= 0) {
    ai.target = pickTarget(ai, s, f);
    ai.retarget = 10;
  }
  if (ai.target < 0) return 0;
  const o = s.f[ai.target];
  const dx = o.x - f.x;
  const dz = o.z - f.z;
  const dist = Math.hypot(dx, dz);
  const special = getFighter(f.char).special.type;

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
  for (const e of s.f) {
    if (e === f || e.hp <= 0) continue;
    const ex = f.x - e.x;
    const ez = f.z - e.z;
    const ed = Math.hypot(ex, ez);
    const winding = e.state === 'attack' || e.state === 'airAttack';
    if (!winding) continue;
    // A ground stomp cannot be blocked well: jump over it.
    if (e.move === 'quake' && ed < 230 && rnd(ai) < cfg.block) return hold(INPUT.JUMP, 4);
    const facingMe = angleDiff(Math.atan2(ez, ex), e.dir) < 0.9;
    if (ed < 190 && facingMe && rnd(ai) < cfg.block) {
      if (special === 'rise' && f.meter >= RULES.SPECIAL_COST && ed < 90 && rnd(ai) < 0.4) return press(INPUT.SPECIAL);
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
    if (miss < 50 && rnd(ai) < cfg.block) {
      // Step sideways out of its path, or put the guard up.
      if (rnd(ai) < 0.6) return hold(toward(-p.vz, p.vx), 10);
      return hold(INPUT.BLOCK, 14);
    }
  }

  // --- stay inside the ring of fire ---
  const r = Math.hypot(f.x, f.z);
  if (r > s.ringR - 70 && dist > 120) return hold(toward(-f.x, -f.z), 8);

  // --- finisher and special when they are likely to land ---
  if (f.meter >= RULES.SUPER_COST && dist < 340 && o.h <= 0 && rnd(ai) < cfg.special * 2) return press(INPUT.SUPER);
  if (f.meter >= RULES.SPECIAL_COST && rnd(ai) < cfg.special) {
    if (special === 'bolt' && dist > 200) return press(INPUT.SPECIAL);
    if (special === 'dash' && dist > 110 && dist < 280) return press(INPUT.SPECIAL);
    if (special === 'rise' && dist < 85) return press(INPUT.SPECIAL);
    if (special === 'quake' && dist < 170 && o.h <= 0) return press(INPUT.SPECIAL);
  }

  if (o.state === 'down' || o.state === 'getup') {
    return dist < 120 ? hold(toward(-dx, -dz), 8) : hold(0, 6); // give them room to stand
  }

  if (dist > 112) {
    if (rnd(ai) < 0.05) return hold(toward(dx, dz) | INPUT.JUMP, 3);
    return hold(toward(dx, dz), 5 + Math.floor(rnd(ai) * 7));
  }

  // --- in range ---
  const roll = rnd(ai);
  if (roll < cfg.attack) return press(rnd(ai) < 0.55 ? INPUT.PUNCH : INPUT.KICK);
  if (roll < cfg.attack + 0.15) return hold(toward(-dx, -dz), 10); // back off
  if (roll < cfg.attack + 0.3) return hold(toward(-dz, dx), 9); // circle round
  return hold(0, Math.max(3, cfg.think - 2));
}
