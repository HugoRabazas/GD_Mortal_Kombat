// A guest's own blow drawn at once (client/src/net/predict.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttackPredictor } from '../client/src/net/predict.js';
import { INPUT } from '../shared/constants.js';

const idle = { state: 'idle', t: 30, stun: 0, h: 0, x: 0, z: 0 };

test('a punch from standing shows at once, then follows the host without jumping back', () => {
  const p = createAttackPredictor();
  assert.equal(p.note(INPUT.PUNCH, idle, true, 100, 0), 'punch', 'a new guess is announced (for its sound)');
  assert.equal(p.note(INPUT.PUNCH, idle, true, 100, 5), null, 'once');
  assert.equal(p.draw(idle, 0).state, 'attack');
  assert.equal(p.draw(idle, 0).move, 'punch');
  // 100 ms later the host shows the punch at t 2 (it began later there): keep our t 6.
  const host = { ...idle, state: 'attack', move: 'punch', t: 2 };
  p.note(0, host, true, 100, 100);
  assert.equal(p.draw(host, 100).t, 6);
  // The host catches up: its own picture is drawn.
  const later = { ...host, t: 12 };
  p.note(0, later, true, 100, 180);
  assert.equal(p.draw(later, 180), later);
  // The host's punch is over: nothing is guessed any more.
  p.note(0, idle, true, 100, 300);
  assert.equal(p.active(), false);
});

test('a guess the host never shows is dropped', () => {
  const p = createAttackPredictor();
  p.note(INPUT.KICK, idle, true, 80, 0);
  assert.equal(p.draw(idle, 10).move, 'kick');
  p.note(INPUT.KICK, idle, true, 80, 300); // past the round trip and the slack
  assert.equal(p.active(), false);
  // Struck first: dropped at once.
  const q = createAttackPredictor();
  q.note(INPUT.PUNCH, idle, true, 80, 0);
  q.note(0, { ...idle, state: 'hit', stun: 12 }, true, 80, 40);
  assert.equal(q.active(), false);
});

test('only the plain first blow is guessed', () => {
  const cases = [
    [INPUT.PUNCH | INPUT.SPECIAL, idle],
    [INPUT.PUNCH | INPUT.KICK, idle],
    [INPUT.KICK | INPUT.BLOCK, idle],
    [INPUT.PUNCH | INPUT.RIGHT, { ...idle, state: 'walk', t: 20 }], // a lunge
    [INPUT.PUNCH, { ...idle, state: 'attack', move: 'punch', t: 5 }], // a string
    [INPUT.PUNCH, { ...idle, rip: 10 }], // a riposte
    [INPUT.KICK, { ...idle, pursue: 50 }], // a pursuit (tick 40)
    [INPUT.PUNCH, { ...idle, h: 30 }], // in the air
  ];
  for (const [bits, f] of cases) {
    const p = createAttackPredictor();
    p.note(bits, f, true, 80, 0, 40);
    assert.equal(p.active(), false, JSON.stringify([bits, f]));
  }
  const off = createAttackPredictor();
  off.note(INPUT.PUNCH, idle, false, 80, 0); // not while the fight is held
  assert.equal(off.active(), false);
});
