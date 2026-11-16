import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Record counts the moves in MOVE_BOOK; How to play (or the pause
// screen's move list) must name each of them, or a player could not find
// out how to land it. (main.js runs only in a browser: read its text.)
test('every move the Record counts is named in the help', () => {
  const src = readFileSync(new URL('../client/src/main.js', import.meta.url), 'utf8');
  const start = src.indexOf('const MOVE_BOOK = {');
  const end = src.indexOf('};', start);
  const names = [...src.slice(start, end).matchAll(/\w+: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 27, `found ${names.length}`);
  const rest = (src.slice(0, start) + src.slice(end)).toLowerCase();
  for (const name of names) assert.ok(rest.includes(name.toLowerCase()), name);
});
