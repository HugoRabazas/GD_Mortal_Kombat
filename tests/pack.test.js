// The packed pictures of the fight (client/src/net/pack.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { createPacker, createUnpacker } from '../client/src/net/pack.js';

const compact = (key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value);
const asSent = (s) => {
  const { ev, ...state } = s;
  return JSON.parse(JSON.stringify(state, compact));
};

test('a packed picture unpacks to the same fight as the old JSON, and is far smaller', () => {
  const chars = ['ruko', 'shadow', 'jackie', 'pixie'];
  const s = createMatch(chars);
  const ais = chars.map((_, i) => createAI('hard', i + 1));
  const pack = createPacker();
  const unpack = createUnpacker();
  let plain = 0;
  let packed = 0;
  let pictures = 0;
  for (let t = 0; t < 60 * 30; t++) {
    step(s, ais.map((ai, j) => aiInput(ai, s, j)));
    if (t % 3) continue;
    const p = JSON.parse(JSON.stringify(pack.pack(s), compact)); // over the wire
    const got = unpack.unpack(p);
    assert.deepEqual(got, asSent(s), `picture at tick ${s.tick}`);
    if (s.phase === 'fight') {
      plain += JSON.stringify(asSent(s)).length;
      packed += JSON.stringify(p).length;
      pictures++;
    }
  }
  const avg = packed / pictures;
  assert.ok(avg < plain / pictures / 2.5, `packed ${Math.round(avg)} B against ${Math.round(plain / pictures)} B`);
});

test('pictures built on a key picture that was lost are skipped until the next key', () => {
  const s = createMatch(['ruko', 'shadow']);
  const pack = createPacker();
  const unpack = createUnpacker();
  const first = pack.pack(s); // a key picture: lost
  assert.ok(first.K);
  step(s, [0, 0]);
  assert.equal(unpack.unpack(JSON.parse(JSON.stringify(pack.pack(s)))), null, 'nothing to build on');
  for (let i = 0; i < 20; i++) {
    step(s, [0, 0]);
    const got = unpack.unpack(JSON.parse(JSON.stringify(pack.pack(s))));
    if (got) {
      assert.equal(got.tick, s.tick);
      return;
    }
  }
  assert.fail('never recovered');
});
