// The match's numbers kept in the fight itself (state.tally) agree with the
// events, in ordinary play (online they also survive replays and the referee).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';

test('the tally in the fight matches its hit and parry events', () => {
  for (const chars of [['ruko', 'pixie'], ['shadow', 'jackie', 'meru', 'gleh']]) {
    const s = createMatch(chars, [], undefined, 3);
    const ais = chars.map((_, i) => createAI('hard', i + 5));
    const count = chars.map(() => ({ dmg: 0, hits: 0, combo: 0, perfect: 0 }));
    for (let t = 0; t < 30000 && s.phase !== 'over'; t++) {
      step(s, ais.map((a, i) => aiInput(a, s, i)));
      for (const e of s.ev) {
        if (e.type === 'hit') {
          count[e.by].dmg += e.dealt ?? e.dmg;
          count[e.by].hits++;
          count[e.by].combo = Math.max(count[e.by].combo, e.combo || 1);
        } else if (e.type === 'parry') count[e.by].perfect++;
      }
    }
    assert.equal(s.phase, 'over');
    assert.deepEqual(s.tally, count);
    assert.ok(count.some((c) => c.hits > 10));
  }
});
