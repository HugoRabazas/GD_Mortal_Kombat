// The daily challenge: the same fight for everyone in the alliance on a given
// day (by the UTC date, so the whole world shares it) - your fighter, the
// rival, the arena and the CPU's level - drawn from the date alone, with no
// server. Beat it once to tick the day off.

import { FIGHTERS } from '../../shared/fighters.js';
import { ARENAS } from './arenas.js';

// 'YYYY-MM-DD' of a moment, in UTC.
export const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// A small deterministic hash of the day's key (FNV-1a), stirred.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function dailyChallenge(key = dayKey()) {
  const h = hash('gd-daily:' + key);
  const ids = FIGHTERS.map((f) => f.id);
  const you = ids[h % ids.length];
  const others = ids.filter((id) => id !== you);
  const rival = others[Math.floor(h / ids.length) % others.length];
  const arena = ARENAS[Math.floor(h / 97) % ARENAS.length].id;
  const level = Math.floor(h / 7919) % 3 === 0 ? 'normal' : 'hard';
  return { key, you, rival, arena, level };
}

// The run of days in a row once `key` is beaten, given the last day beaten
// and the run it had: the day after carries it on, anything else starts again.
export function runAfter(lastKey, run, key) {
  if (lastKey === key) return run || 1;
  const yesterday = dayKey(Date.parse(key + 'T12:00:00Z') - 864e5);
  return lastKey === yesterday ? (run || 1) + 1 : 1;
}
