// What the screen layer makes of rule events: here, what the announcer says.
// Speech is caught by a fake speech engine; Node has no browser voices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../shared/sim.js';

const said = [];
globalThis.window = { speechSynthesis: { speak: (u) => said.push(u.text), cancel: () => {}, getVoices: () => [] } };
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
  }
};
const { handleEvents } = await import('../client/src/effects.js');
const project = () => ({ x: 0, y: 0, k: 1 });

test('the announcer calls a duel, names the winner in words, and is silent in the demo', () => {
  const s = createMatch(['ruko', 'jackie']);
  said.length = 0;
  handleEvents([{ type: 'round', round: 1 }, { type: 'fight' }, { type: 'ko', winner: 0 }, { type: 'matchEnd', winner: 0 }], s, { quiet: false, project });
  assert.deepEqual(said, ['Round one', 'Fight!', 'K. O.!', 'Ruko wins!']);
  said.length = 0;
  handleEvents([{ type: 'round', round: 2 }, { type: 'fight' }], s, { quiet: true, project });
  assert.deepEqual(said, [], 'the fight behind the menus never speaks');
});

test('the announcer says "takes it" in a brawl and "Final round" when a duel is level at one each', () => {
  const brawl = createMatch(['ruko', 'shadow', 'jackie', 'pixie'], [], 'arena');
  said.length = 0;
  handleEvents([{ type: 'ko', winner: 1 }], brawl, { quiet: false, project });
  assert.deepEqual(said, ['Shadow takes it']);
  const duel = createMatch(['ruko', 'jackie']);
  duel.pts = [1, 1];
  said.length = 0;
  handleEvents([{ type: 'round', round: 3 }], duel, { quiet: false, project });
  assert.deepEqual(said, ['Final round']);
});

test('every sound a ritual asks for exists (a wrong name would be silent)', async () => {
  const { hasSound } = await import('../client/src/audio.js');
  const { readFileSync } = await import('node:fs');
  // (fighter.js cannot be loaded outside the browser build: read its table.)
  const src = readFileSync(new URL('../client/src/render/fighter.js', import.meta.url), 'utf8');
  const table = src.slice(src.indexOf('const RITUAL_BEATS = {'), src.indexOf('};', src.indexOf('const RITUAL_BEATS = {')));
  const names = [...table.matchAll(/\[\d+, '(\w+)'\]/g)].map((m) => m[1]);
  assert.ok(names.length >= 11, `found ${names.length}`);
  for (const name of names) assert.ok(hasSound(name), name);
  for (const name of ['oathRing', 'twang', 'slice', 'whirl', 'bowOut']) assert.ok(names.includes(name), `${name} is used`);
});

test('the blows with a sound of their own name sounds that exist', async () => {
  const { hasSound } = await import('../client/src/audio.js');
  const { HIT_SOUND } = await import('../client/src/effects.js');
  for (const [kind, name] of Object.entries(HIT_SOUND)) assert.ok(hasSound(name), `${kind}: ${name}`);
});

test("the boss's second wind is called out", () => {
  const s = createMatch(['ruko', 'jackie'], [null, { health: 1.3, power: 1.1, enrage: true }]);
  said.length = 0;
  handleEvents([{ type: 'enrage', slot: 1, x: 0, z: 0 }], s, { quiet: false, project });
  assert.deepEqual(said, ['Second wind!']);
});

test('the end of a match says how it was won', () => {
  const s = createMatch(['ruko', 'jackie']);
  said.length = 0;
  handleEvents([{ type: 'matchEnd', winner: 0 }], s, { quiet: false, project, how: 'comeback' });
  handleEvents([{ type: 'matchEnd', winner: 1 }], s, { quiet: false, project });
  assert.equal(said.length, 2);
  assert.match(said[0], /wins! What a comeback!$/);
  assert.match(said[1], /wins!$/);
});

test('every arena has a footstep sound that exists', async () => {
  const { hasSound, STEP_SOUND } = await import('../client/src/audio.js');
  const { ARENAS } = await import('../client/src/arenas.js');
  for (const a of ARENAS) assert.ok(hasSound(STEP_SOUND[a.id]), a.id);
});

test('every arena floor kicks up its own dust', async () => {
  const { FLOOR_DUST } = await import('../client/src/render/fx.js');
  const { ARENAS } = await import('../client/src/arenas.js');
  for (const a of ARENAS) assert.match(FLOOR_DUST[a.id]?.color ?? '', /^#[0-9a-f]{6}$/, a.id);
});
