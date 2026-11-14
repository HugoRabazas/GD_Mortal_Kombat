// The CPU opponent used in practice mode (and for the demo fight behind the
// menu). It looks at the match state and answers with the buttons it wants to
// hold, exactly like a human player would.

import { INPUT, RULES, ARENA } from './constants.js';
import { getFighter } from './fighters.js';

const LEVELS = {
  easy: { think: 16, block: 0.25, attack: 0.3, special: 0.02 },
  normal: { think: 8, block: 0.6, attack: 0.58, special: 0.07 },
  hard: { think: 5, block: 0.8, attack: 0.7, special: 0.1 },
  boss: { think: 4, block: 0.84, attack: 0.76, special: 0.14 },
};

export function createAI(level = 'normal', seed = 1) {
  return { cfg: LEVELS[level] || LEVELS.normal, seed: seed >>> 0 || 1, wait: 0, held: 0, tap: 0, tapT: 0 };
}

// Small deterministic random generator (mulberry32).
function rnd(ai) {
  ai.seed = (ai.seed + 0x6d2b79f5) >>> 0;
  let t = ai.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function aiInput(ai, s, me) {
  if (s.phase !== 'fight') return 0;
  const f = s.f[me];
  const o = s.f[1 - me];
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

  const toward = o.x > f.x ? INPUT.RIGHT : INPUT.LEFT;
  const away = o.x > f.x ? INPUT.LEFT : INPUT.RIGHT;
  const dist = Math.abs(o.x - f.x);
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

  // Defence first.
  const incoming = s.proj.find((p) => p.owner !== me && Math.sign(p.vx) === Math.sign(f.x - p.x) && Math.abs(p.x - f.x) < 190);
  const threatened = (o.state === 'attack' || o.state === 'airAttack') && dist < 170;
  if (incoming && rnd(ai) < cfg.block) {
    return rnd(ai) < 0.5 ? hold(INPUT.DOWN, 16) : hold(INPUT.BLOCK, 16);
  }
  if (threatened && rnd(ai) < cfg.block) {
    if (special === 'rise' && o.y < ARENA.FLOOR && f.meter >= RULES.SPECIAL_COST && rnd(ai) < 0.5) {
      return press(INPUT.SPECIAL);
    }
    return hold(INPUT.BLOCK, 12 + Math.floor(rnd(ai) * 8));
  }

  // Finisher and special when they are likely to land.
  if (f.meter >= RULES.SUPER_COST && dist < 330 && o.y >= ARENA.FLOOR && rnd(ai) < cfg.special * 2) {
    return press(INPUT.SUPER);
  }
  if (f.meter >= RULES.SPECIAL_COST && rnd(ai) < cfg.special) {
    if (special === 'bolt' && dist > 230) return press(INPUT.SPECIAL);
    if (special === 'dash' && dist > 110 && dist < 260) return press(INPUT.SPECIAL);
    if (special === 'rise' && dist < 90) return press(INPUT.SPECIAL);
  }

  if (o.state === 'down' || o.state === 'getup') {
    return dist < 120 ? hold(away, 8) : hold(0, 6); // give them room to stand
  }

  if (dist > 118) {
    if (rnd(ai) < 0.06) return hold(toward | INPUT.UP, 3);
    return hold(toward, 6 + Math.floor(rnd(ai) * 8));
  }

  // In range.
  const r = rnd(ai);
  if (r < cfg.attack) {
    const pick = rnd(ai);
    if (pick < 0.4) return press(INPUT.PUNCH);
    if (pick < 0.7) return press(INPUT.KICK);
    if (pick < 0.85) return press(INPUT.KICK, INPUT.DOWN);
    return press(INPUT.PUNCH, INPUT.DOWN);
  }
  if (r < cfg.attack + 0.15) return hold(away, 10);
  if (r < cfg.attack + 0.25) return hold(INPUT.DOWN, 8);
  return hold(0, Math.max(3, cfg.think - 2));
}
