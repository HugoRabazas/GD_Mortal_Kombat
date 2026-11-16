// How a duel was won picks the winner's line (client/src/outcome.js) - and
// every fighter has a line for each way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { howWon } from '../client/src/outcome.js';
import { FIGHTERS } from '../shared/fighters.js';

const duel = (winner, hp = 60) => ({ mode: 'duel', matchWinner: winner, f: [{ hp: winner === 0 ? hp : 0, maxHp: 120 }, { hp: winner === 1 ? hp : 0, maxHp: 120 }] });

test('the way a duel was won', () => {
  assert.equal(howWon(duel(0), [{ winner: 0 }, { winner: 0, perfect: true }]), 'perfect');
  assert.equal(howWon(duel(0), [{ winner: 1 }, { winner: 0 }, { winner: 0, perfect: true }]), 'comeback');
  assert.equal(howWon(duel(0), [{ winner: 0 }, { winner: 1 }, { winner: 0 }]), 'close');
  assert.equal(howWon(duel(0, 20), [{ winner: 0 }, { winner: 0 }]), 'close', 'won with little health left');
  assert.equal(howWon(duel(0), [{ winner: 0 }, { winner: 0 }]), '');
  assert.equal(howWon({ ...duel(0), mode: 'arena' }, [{ winner: 0 }]), '', 'brawls are not told apart');
  assert.equal(howWon({ ...duel(0), matchWinner: -1 }, []), '');
});

test('every fighter has a line for each way of winning', () => {
  for (const f of FIGHTERS) for (const how of ['perfect', 'comeback', 'close']) assert.ok(f.quotes?.[how]?.length > 5, `${f.id} ${how}`);
});
