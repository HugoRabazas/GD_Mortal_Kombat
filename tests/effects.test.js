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
