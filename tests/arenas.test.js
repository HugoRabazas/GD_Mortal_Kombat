// Every arena in the picker must be complete: a 3D theme with its three
// moods, its own music, and a look for the flat fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENAS } from '../client/src/arenas.js';
import { THEMES } from '../client/src/render/themes.js';
import { MUSIC_THEMES } from '../client/src/audio.js';
import { FLAT_TINTS } from '../client/src/render/arena.js';

const COLOR = /^#[0-9a-f]{6}$/i;

test('every arena has a 3D theme, music and a flat look, and nothing is left over', () => {
  const ids = ARENAS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'no arena listed twice');
  assert.deepEqual(Object.keys(THEMES).sort(), [...ids].sort(), 'themes match the arena list');
  assert.deepEqual(Object.keys(MUSIC_THEMES).sort(), [...ids].sort(), 'music matches the arena list');
  for (const id of ids) assert.ok(id in FLAT_TINTS, `${id} has a flat look`);
});

test('each theme is complete: sky, three moods, weather the scene knows', () => {
  for (const [id, th] of Object.entries(THEMES)) {
    assert.equal(th.sky.length, 5, `${id} sky stops`);
    for (const c of th.sky) assert.match(c, COLOR, `${id} sky colour`);
    assert.equal(th.moods.length, 3, `${id} has dusk/night/storm-like moods for three rounds`);
    for (const m of th.moods) {
      for (const k of ['sky', 'hemi', 'key', 'moon', 'fog']) assert.ok(Array.isArray(m[k]), `${id} mood ${k}`);
      assert.ok(m.rain >= 0 && m.rain <= 1, `${id} weather strength`);
    }
    assert.ok(['rain', 'snow', 'sand'].includes(th.weather), `${id} weather kind`);
    assert.equal(th.ridges.length, 2, `${id} two mountain ranges`);
    assert.ok(th.cloaks.length > 0 && th.flame.length === 4, `${id} crowd and flame`);
  }
});

test('each tune has four bars and sane tempos', () => {
  for (const [id, t] of Object.entries(MUSIC_THEMES)) {
    assert.equal(t.bars.length, 4, id);
    for (const b of t.bars) assert.equal(b.notes.length, 3, id);
    assert.ok(t.bpm >= 80 && t.bpm < t.finalBpm && t.finalBpm <= 150, `${id} tempo`);
  }
});
