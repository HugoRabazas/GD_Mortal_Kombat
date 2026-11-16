// The rules must come out the same, to the last bit, on every device (for
// online rollback - see README). Two checks: no engine-dependent maths in
// shared/, and the same seeded matches run in V8 (Node) and in QuickJS - a
// different JavaScript engine with its own maths library - end with the same
// fingerprints. (With Math.sin and friends they parted at once: 1 match of
// 12 ended the same.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getQuickJS } from 'quickjs-emscripten';
import { createMatch, step } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { fingerprint } from '../shared/fingerprint.js';

const SHARED = path.join(import.meta.dirname, '..', 'shared');

test('the rules use none of the engine-dependent maths', () => {
  const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|cbrt|hypot)\b|\*\*/;
  for (const file of fs.readdirSync(SHARED).filter((f) => f.endsWith('.js') && f !== 'dmath.js')) {
    const lines = fs.readFileSync(path.join(SHARED, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      assert.ok(!banned.test(code), `${file}:${i + 1} uses engine-dependent maths: ${line.trim()}`);
    });
  }
});

// The same matches, run by the same code in either engine.
const RUN = `
  export function run(n) {
    const out = [];
    const roster = ['ruko', 'shadow', 'jackie', 'pixie', 'meru', 'gleh', 'kichta', 'zelrith'];
    for (let m = 0; m < n; m++) {
      const chars = [0, 1, 2, 3].map((i) => roster[(m * 3 + i * 5) % 8]);
      const s = createMatch(m % 2 ? chars : chars.slice(0, 2), [], undefined, m + 1);
      const ais = s.f.map((_, i) => createAI('hard', m * 10 + i + 1));
      let t = 0;
      while (s.phase !== 'over' && t < 20000) {
        step(s, ais.map((a, i) => aiInput(a, s, i)));
        t++;
        if (t % 300 === 0) out.push(fingerprint(s));
      }
      out.push(fingerprint(s), t);
    }
    return out.join(' ');
  }`;

test('V8 and QuickJS play the same matches to the same end', async () => {
  const N = 3;
  const here = new Function('createMatch', 'step', 'createAI', 'aiInput', 'fingerprint', RUN.replace('export ', '') + '; return run;')(createMatch, step, createAI, aiInput, fingerprint);
  const v8 = here(N);

  const QJS = await getQuickJS();
  const runtime = QJS.newRuntime();
  runtime.setMemoryLimit(512 * 1024 * 1024);
  runtime.setModuleLoader((name) => fs.readFileSync(path.join(SHARED, path.basename(name)), 'utf8'));
  const vm = runtime.newContext();
  const mod = vm.evalCode(
    `import { createMatch, step } from './sim.js';
     import { createAI, aiInput } from './ai.js';
     import { fingerprint } from './fingerprint.js';
     ${RUN.replace('export function run', 'function run')}
     globalThis.result = run(${N});`,
    'run.js',
    { type: 'module' },
  );
  if (mod.error) throw new Error(JSON.stringify(vm.dump(mod.error)));
  mod.value.dispose();
  runtime.executePendingJobs();
  const res = vm.getProp(vm.global, 'result');
  const qjs = vm.getString(res);
  res.dispose();
  vm.dispose();
  runtime.dispose();
  assert.ok(v8.split(' ').length > 3 * N, 'fingerprints taken along the way');
  assert.equal(qjs, v8);
});
