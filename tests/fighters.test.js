// The roster's costumes and who wears what in a line-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIGHTERS, dressColors, dressLineUp, lookColors, lookCount } from '../shared/fighters.js';

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

test('every slot gets the colours it really wears, for the scoreboard and the effects too', () => {
  const [a, b] = dressColors(['ruko', 'ruko'], [1, 1]);
  assert.equal(a.primary, lookColors('ruko', 1).primary, 'the first copy wears what was picked');
  assert.equal(b.primary, lookColors('ruko', 0).primary, 'the mirror copy wears the other costume');
  assert.notEqual(a.glow, b.glow, 'their sparks and trails differ too');
});

test('every fighter is complete: picture circle, special, costumes, a celebration and a winning line', () => {
  for (const f of FIGHTERS) {
    assert.ok(f.head && f.head.r > 0, `${f.id} head`);
    assert.ok(['dash', 'bolt', 'rise', 'quake'].includes(f.special.type), `${f.id} special`);
    assert.ok(['howl', 'calm', 'stomp', 'cheer'].includes(f.victory), `${f.id} celebration`);
    assert.ok(['prowl', 'bow', 'clap', 'swirl'].includes(f.entrance), `${f.id} entrance`);
    assert.ok(typeof f.quote === 'string' && f.quote.length > 0 && f.quote.length <= 60, `${f.id} quote fits the result screen`);
    for (const k of ['primary', 'secondary', 'accent', 'skin', 'glow']) assert.match(f.colors[k], /^#[0-9a-f]{6}$/i, `${f.id} ${k}`);
  }
});
