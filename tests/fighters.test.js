// The roster's costumes and who wears what in a line-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGHTERS, dressLineUp, lookColors, lookCount } from '../shared/fighters.js';

test('every fighter has two costumes, and the second really changes the colours', () => {
  for (const f of FIGHTERS) {
    assert.equal(lookCount(f.id), 2, f.id);
    assert.notEqual(lookColors(f.id, 1).primary, lookColors(f.id, 0).primary, f.id);
    assert.equal(lookColors(f.id, 0).primary, f.colors.primary, 'the first is their own colours');
  }
});

test('two copies of a fighter never dress alike', () => {
  assert.deepEqual(dressLineUp(['ruko', 'shadow'], [1, 1]), [1, 1], 'different fighters wear what was picked');
  assert.deepEqual(dressLineUp(['ruko', 'ruko'], [0, 0]), [0, 1], 'a mirror match takes the other costume');
  assert.deepEqual(dressLineUp(['ruko', 'ruko'], [1, 0]), [1, 0]);
  assert.deepEqual(dressLineUp(['ruko', 'ruko', 'ruko', 'pixie']), [0, 1, -1, 0], 'a third copy falls back to plain alternate colours');
  assert.deepEqual(dressLineUp(['jackie'], [7]), [0], 'a costume that does not exist means their own colours');
  assert.deepEqual(dressLineUp(['jackie', 'pixie'], null), [0, 0], 'no choices at all: own colours');
});
