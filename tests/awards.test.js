// A brawl's awards go to whoever alone led the way; ties earn nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { awardsFor } from '../client/src/awards.js';

const st = (dmg, combo, perfect) => ({ dmg, hits: 0, combo, perfect });

test('each award goes to the one fighter who led, and a low place can still earn one', () => {
  const all = [st(60, 3, 0), st(95, 2, 2), st(40, 2, 0), st(20, 1, 0)];
  assert.deepEqual(awardsFor(all, 0), ['Combo master']);
  assert.deepEqual(awardsFor(all, 1), ['Heavy hitter', 'Iron guard']);
  assert.deepEqual(awardsFor(all, 2), []);
  assert.deepEqual(awardsFor(all, 3), []);
});

test('ties and small numbers earn nothing', () => {
  const tied = [st(50, 3, 1), st(50, 3, 1), st(10, 1, 0), st(0, 0, 0)];
  for (let k = 0; k < 4; k++) assert.deepEqual(awardsFor(tied, k), [], `slot ${k}`);
  const quiet = [st(0, 2, 0), st(0, 1, 0), st(0, 0, 0), st(0, 0, 0)];
  assert.deepEqual(awardsFor(quiet, 0), [], 'a 2-hit combo and no damage are not worth an award');
  assert.deepEqual(awardsFor(null, 0), [], 'no numbers, no awards');
});
