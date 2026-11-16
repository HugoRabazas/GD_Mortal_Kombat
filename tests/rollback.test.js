// Rollback (client/src/net/rollback.js): players on simulated networks -
// late, out of order and lost messages - must end with exactly the fight
// played with every button on time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRollback } from '../client/src/net/rollback.js';
import { createMatch, step } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { fingerprint } from '../shared/fingerprint.js';
import { INPUT } from '../shared/constants.js';

const DELAY = 2; // a press is played this many ticks after it is made

// A restless player: holds a random mix of buttons for a few ticks at a time.
function script(p, t) {
  if (t < DELAY) return 0;
  const k = Math.floor(t / (6 + p * 3));
  let h = Math.imul(k + 1, 2654435761) ^ Math.imul(p + 7, 40503);
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  const pool = [INPUT.LEFT, INPUT.RIGHT, INPUT.UP, INPUT.DOWN, INPUT.PUNCH, INPUT.KICK, INPUT.BLOCK, INPUT.JUMP, INPUT.SPECIAL, INPUT.GRAB];
  let bits = 0;
  for (let i = 0; i < pool.length; i++) if ((h >>> (i * 3)) % 7 === 0) bits |= pool[i];
  return bits;
}

// The fight with its CPU fighters' minds, so a copy carries both.
function newWorld(chars, humans, seed) {
  return { s: createMatch(chars, [], undefined, seed), ais: chars.map((_, i) => (i < humans ? null : createAI('hard', seed * 10 + i))) };
}
const stepWorld = (w, bits) => {
  step(w.s, w.s.f.map((_, i) => (w.ais[i] ? aiInput(w.ais[i], w.s, i) : bits[i])));
  return w.s.ev;
};
const copy = (w) => structuredClone(w);

function reference(chars, humans, seed, ticks) {
  const w = newWorld(chars, humans, seed);
  for (let t = 0; t < ticks; t++) stepWorld(w, Array.from({ length: humans }, (_, p) => script(p, t)));
  return fingerprint(w.s);
}

// Each human on their own device; every message takes 0..maxLate frames and
// some are lost. A message carries every button the receiver has not yet
// confirmed (as the real link will), so a lost one only costs time.
function network(chars, humans, seed, ticks, { maxLate, loss, rand, drift, noReferee }) {
  // (drift: one device's fight goes wrong at one tick - as a bug or a
  // different rounding would make it - for the referee to put right.)
  const drifting = (me) => (w, bits) => {
    if (drift && drift.peer === me && w.s.tick === drift.tick) w.s.f[0].hp -= 9;
    return stepWorld(w, bits);
  };
  const peers = Array.from({ length: humans }, (_, me) => ({
    me,
    rb: createRollback({ world: newWorld(chars, humans, seed), players: humans, mine: [me], step: drifting(me), copy }),
  }));
  let fixes = 0;
  let checked = 0;
  let wire = [];
  let frame = 0;
  for (const peer of peers) for (let t = 0; t < DELAY; t++) peer.rb.local(peer.me, t, 0);
  const sent = peers.map(() => new Map()); // my buttons by tick
  for (let i = 0; i < peers.length; i++) for (let t = 0; t < DELAY; t++) sent[i].set(t, 0);
  while (peers.some((p) => p.rb.tick < ticks || p.rb.sureUpTo() < ticks - 1) && frame < ticks * 20) {
    frame++;
    // deliver what is due
    const due = wire.filter((m) => m.at <= frame);
    wire = wire.filter((m) => m.at > frame);
    for (const m of due) for (const [t, b] of m.inputs) peers[m.to].rb.remote(m.from, t, b);
    for (const peer of peers) {
      const { rb, me } = peer;
      if (rb.tick < ticks && rb.canAdvance()) {
        const t = rb.tick + DELAY;
        const b = script(me, t);
        rb.local(me, t, b);
        sent[me].set(t, b);
        rb.advance();
      } else rb.settle();
      // The referee (player 0, the host): at each sure checkpoint, a device
      // whose fingerprint differs is handed the host's world for that tick.
      if (me > 0 && !noReferee) {
        const k = Math.floor(Math.min(rb.sureUpTo(), peers[0].rb.sureUpTo()) / 120) * 120;
        const mine = rb.savedAt(k);
        const host = peers[0].rb.savedAt(k);
        if (k > (peer.lastK ?? 0) && mine && host) {
          peer.lastK = k;
          checked++;
          if (fingerprint(mine.s) !== fingerprint(host.s) && rb.restore(k, host)) fixes++;
        }
      }
      // send each other player what they have not confirmed (at most 30 ticks)
      for (const other of peers) {
        if (other === peer || rand() < loss) continue;
        const from = other.rb.heard(me) + 1; // (in real play, told by their acknowledgements)
        const inputs = [...sent[me]].filter(([t]) => t >= from && t < from + 30);
        if (inputs.length) wire.push({ to: other.me, from: me, inputs, at: frame + 1 + Math.floor(rand() * maxLate) });
      }
    }
  }
  return { fixes, checked, peers: peers.map((p) => ({ print: fingerprint(p.rb.world.s), stats: p.rb.stats() })) };
}

const lcg = (seed) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

for (const [name, chars, humans, opts] of [
  ['a duel on a good line', ['ruko', 'pixie'], 2, { maxLate: 4, loss: 0 }],
  ['a duel across the world, with losses', ['zelrith', 'gleh'], 2, { maxLate: 14, loss: 0.15 }],
  ['four players', ['shadow', 'jackie', 'meru', 'kichta'], 4, { maxLate: 10, loss: 0.1 }],
  ['two players and two CPU fighters', ['ruko', 'shadow', 'jackie', 'pixie'], 2, { maxLate: 10, loss: 0.1 }],
]) {
  test(`rollback: ${name} ends exactly as played on time`, () => {
    const TICKS = 1500;
    const want = reference(chars, humans, 7, TICKS);
    const run = network(chars, humans, 7, TICKS, { ...opts, rand: lcg(99) });
    const got = run.peers;
    assert.ok(run.checked >= 10, 'fingerprints compared along the way');
    assert.equal(run.fixes, 0, 'nothing drifted');
    for (const g of got) {
      assert.equal(g.stats.tick, TICKS);
      assert.equal(g.print, want, JSON.stringify(g.stats));
    }
    if (opts.maxLate > 4) assert.ok(got.some((g) => g.stats.rollbacks > 10), 'guesses were made and corrected');
  });
}

test('a replayed tick plays only the events that are new', async () => {
  const { createEventFilter } = await import('../client/src/net/rollback.js');
  const f = createEventFilter();
  const swing = { type: 'swing', by: 0, move: 'punch', id: 1 };
  const hit = { type: 'hit', by: 0, to: 1, kind: 'punch', id: 2 };
  assert.deepEqual(f.pass([{ tick: 10, events: [swing], replay: false }]), [swing]);
  // The guess was wrong: replayed, the same swing comes a tick later (not
  // played again) and now it lands (played).
  const again = f.pass([
    { tick: 10, events: [], replay: true },
    { tick: 11, events: [{ ...swing, id: 7 }], replay: true },
    { tick: 14, events: [{ ...hit, id: 8 }], replay: false },
  ]);
  assert.deepEqual(again.map((e) => e.type), ['hit']);
  // A second replay of the same ticks plays nothing new.
  assert.deepEqual(f.pass([{ tick: 11, events: [swing], replay: true }, { tick: 14, events: [hit], replay: true }]), []);
});

test('rollback: a device whose fight drifts is put right by the host', () => {
  const chars = ['meru', 'kichta'];
  const TICKS = 1500;
  const want = reference(chars, 2, 7, TICKS);
  const run = network(chars, 2, 7, TICKS, { maxLate: 8, loss: 0.1, rand: lcg(5), drift: { peer: 1, tick: 400 } });
  assert.ok(run.fixes >= 1, 'the drift was found and fixed');
  for (const g of run.peers) assert.equal(g.print, want);
  // ...and without the referee it would have stayed wrong
  const unfixed = network(chars, 2, 7, TICKS, { maxLate: 8, loss: 0.1, rand: lcg(5), drift: { peer: 1, tick: 400 }, noReferee: true });
  assert.notEqual(unfixed.peers[1].print, want);
});
