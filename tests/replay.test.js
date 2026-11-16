// The knockout's replay (client/src/replay.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTape, frameIndex, REPLAY_SPEED } from '../client/src/replay.js';

const run = (tape, phases) => phases.forEach(([phase, at, koKind]) => tape.push({ phase, koKind, f: [{ x: at }] }, at % 500 === 0 ? [{ type: 'hit', at }] : [], at));

test('the clip is the stretch round the last knockout, copied', () => {
  const tape = createTape();
  const frames = [];
  for (let at = 0; at < 11000; at += 16) frames.push([at < 4000 ? 'fight' : at < 9000 ? 'ko' : 'over', at, 'ko']); // (a knockout lasts ~5 s)
  run(tape, frames);
  const clip = tape.clip();
  assert.ok(clip);
  const ko = clip.find((c) => c.state.phase === 'ko').at;
  assert.ok(ko >= 4000 && ko < 4016);
  assert.ok(clip[0].at >= ko - 1700 && clip[0].at < ko - 1650, 'from 1.7 s before');
  assert.ok(clip[clip.length - 1].at <= ko + 1300, 'to 1.3 s after');
  assert.ok(clip.some((c) => c.events.length), 'with the events of its frames');
});

test('no clip when the clock ran out, or nothing was taped', () => {
  const tape = createTape();
  assert.equal(tape.clip(), null);
  const frames = [];
  for (let at = 0; at < 3000; at += 16) frames.push([at < 2000 ? 'fight' : 'ko', at, 'time']);
  run(tape, frames);
  assert.equal(tape.clip(), null);
});

test('it plays at half speed and ends', () => {
  const clip = [0, 100, 200, 300].map((at) => ({ at, state: {}, events: [] }));
  assert.equal(REPLAY_SPEED, 0.5);
  assert.equal(frameIndex(clip, 0), 0);
  assert.equal(frameIndex(clip, 250), 1);
  assert.equal(frameIndex(clip, 600), 3);
  assert.equal(frameIndex(clip, 700), -1);
});
