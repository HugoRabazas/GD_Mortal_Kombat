// The CPU's difficulty ladder: each level must really be harder than the one
// below it, or the Auto difficulty and the arcade climb mean nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { FIGHTERS } from '../shared/fighters.js';

// Mirror duels (both fighters the same, so only the level differs), the
// stronger level on each side in turn. Returns the stronger level's share.
function share(lo, hi, perFighter = 16) {
  let won = 0;
  let played = 0;
  for (const f of FIGHTERS) {
    for (let i = 0; i < perFighter; i++) {
      const hiSlot = i % 2;
      const s = createMatch([f.id, f.id]);
      const ais = [0, 1].map((slot) => createAI(slot === hiSlot ? hi : lo, i * 7 + slot + 1));
      for (let k = 0; s.phase !== 'over' && k < 60 * 60 * 15; k++) step(s, ais.map((ai, j) => aiInput(ai, s, j)));
      played++;
      if (s.matchWinner === hiSlot) won++;
    }
  }
  return won / played;
}

test('each CPU level beats the one below it more often than not', () => {
  const steps = [
    ['easy', 'normal', 0.9],
    ['normal', 'hard', 0.65],
    ['hard', 'boss', 0.5],
  ];
  for (const [lo, hi, least] of steps) {
    const k = share(lo, hi);
    assert.ok(k > least, `${hi} beats ${lo} in ${Math.round(k * 100)} % of mirror duels (needs over ${least * 100} %)`);
  }
});

test('in a brawl the CPU leaves alone a rival whose finisher has caught someone else', () => {
  const pick = (level) => {
    const s = createMatch(['ruko', 'shadow', 'jackie', 'pixie']);
    while (s.phase !== 'fight') step(s, [0, 0, 0, 0]);
    Object.assign(s.f[0], { x: 0, z: 0 });
    // Shadow, right beside, is in a finisher that has landed on Jackie.
    Object.assign(s.f[1], { x: 70, z: 0, state: 'attack', move: 'eclipse2', t: 1, ultOn: 2 });
    Object.assign(s.f[2], { x: 140, z: 0 });
    Object.assign(s.f[3], { x: -260, z: 0 });
    const ai = createAI(level, 7);
    aiInput(ai, s, 0);
    return ai.target;
  };
  assert.notEqual(pick('hard'), 1, 'Hard picks someone it can stop');
  assert.notEqual(pick('boss'), 1);
  // Not caught yet (or caught on this very fighter): an ordinary target.
  const s = createMatch(['ruko', 'shadow', 'jackie', 'pixie']);
  while (s.phase !== 'fight') step(s, [0, 0, 0, 0]);
  Object.assign(s.f[0], { x: 0, z: 0 });
  Object.assign(s.f[1], { x: 60, z: 0, state: 'attack', move: 'eclipse2', t: 1, ultOn: 0 });
  Object.assign(s.f[2], { x: 400, z: 300 });
  Object.assign(s.f[3], { x: -400, z: 300 });
  const ai = createAI('hard', 7);
  aiInput(ai, s, 0);
  assert.equal(ai.target, 1);
});
