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

test('training button chips: each new button, with the direction held', async () => {
  const { buttonChips } = await import('../client/src/input.js');
  const { INPUT } = await import('../shared/constants.js');
  assert.deepEqual(buttonChips(INPUT.PUNCH, INPUT.PUNCH), [{ dir: '', name: 'P' }]);
  assert.deepEqual(buttonChips(INPUT.KICK, INPUT.KICK | INPUT.DOWN | INPUT.RIGHT), [{ dir: '↘', name: 'K' }]);
  assert.deepEqual(buttonChips(INPUT.PUNCH | INPUT.KICK, INPUT.PUNCH | INPUT.KICK | INPUT.LEFT).map((c) => c.dir + c.name), ['←P', '←K']);
});

test('training partner tape: records your buttons, then plays them back in a loop', async () => {
  const { partnerTape } = await import('../shared/tutorial.js');
  const tape = partnerTape({ length: 3, gap: 2 });
  let pressed = 0;
  const yours = () => pressed;
  const you = tape.you(yours);
  const partner = tape.partner(yours, () => 99);
  assert.equal(partner(), 99); // off: the chosen partner
  tape.record();
  const got = [];
  for (const b of [1, 2, 4]) {
    pressed = b;
    assert.equal(you(), 0); // you stand still while recording
    got.push(partner());
  }
  assert.deepEqual(got, [1, 2, 4]);
  assert.equal(tape.mode, 'play');
  pressed = 8;
  assert.equal(you(), 8);
  assert.deepEqual(Array.from({ length: 7 }, () => partner()), [1, 2, 4, 0, 0, 1, 2]);
  tape.rewind(); // Restart fight: from the top again
  assert.equal(partner({ phase: 'intro' }), 0); // the round's opening does not use it up
  assert.deepEqual([partner({ phase: 'fight' }), partner()], [1, 2]);
  tape.stop();
  assert.equal(partner(), 99);
});

test('a run\'s heading replaces the first round\'s banner and call (Survival: RIVAL 4)', () => {
  said.length = 0;
  const s = createMatch(['ruko', 'shadow']);
  handleEvents([{ type: 'round', round: 1 }], s, { quiet: false, project: () => ({ x: 0, y: 0 }), heading: ['RIVAL 4', 'ROUND 1 · CPU ON HARD'] });
  assert.equal(said.at(-1), 'Rival 4');
  handleEvents([{ type: 'round', round: 2 }], s, { quiet: false, project: () => ({ x: 0, y: 0 }), heading: ['RIVAL 4', 'ROUND 1 · CPU ON HARD'] });
  assert.equal(said.at(-1), 'Round two');
});

test('the daily challenge is the same for a day, differs across days, and is a fair fight', async () => {
  const { dailyChallenge, dayKey } = await import('../client/src/daily.js');
  const a = dailyChallenge('2026-11-16');
  assert.deepEqual(dailyChallenge('2026-11-16'), a);
  assert.notEqual(a.you, a.rival);
  const days = Array.from({ length: 30 }, (_, i) => dailyChallenge(dayKey(Date.UTC(2026, 10, 1 + i))));
  assert.ok(new Set(days.map((d) => d.you + d.rival + d.arena)).size > 20, 'varied');
  assert.ok(days.every((d) => d.you !== d.rival && ['normal', 'hard'].includes(d.level)));
  assert.equal(dayKey(Date.UTC(2026, 10, 16, 23, 59)), '2026-11-16');
});

test('the daily challenge run: the day after carries it on, a gap starts again', async () => {
  const { runAfter } = await import('../client/src/daily.js');
  assert.equal(runAfter('2026-11-15', 2, '2026-11-16'), 3);
  assert.equal(runAfter('2026-10-31', 5, '2026-11-01'), 6); // across a month
  assert.equal(runAfter('2026-11-10', 4, '2026-11-16'), 1);
  assert.equal(runAfter(undefined, undefined, '2026-11-16'), 1);
  assert.equal(runAfter('2026-11-16', 3, '2026-11-16'), 3); // the same day again
});

test('the milestone sound (a new best, the day\'s challenge beaten) exists', async () => {
  const { hasSound } = await import('../client/src/audio.js');
  assert.ok(hasSound('milestone'));
});
