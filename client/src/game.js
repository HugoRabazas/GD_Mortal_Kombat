// One running fight. It owns the match state, asks each controller (a human's
// keys or the CPU) for its buttons, and advances the simulation in fixed
// steps of 1/60 s no matter how fast the screen refreshes.

import { createMatch, step } from '../../shared/sim.js';
import { TICK_RATE } from '../../shared/constants.js';

const TICK_MS = 1000 / TICK_RATE;

// `controllers` is a pair of functions (state, slot) => button bits.
export function createGame(chars, controllers) {
  let last = null;
  let acc = 0;
  let events = [];
  const game = {
    state: createMatch(chars),
    paused: false,
    update(now) {
      const dt = last === null ? 0 : now - last;
      last = now;
      if (game.paused) return;
      // Cap the catch-up so a tab that was in the background does not replay
      // seconds of fight in one frame.
      acc += Math.min(dt, 100);
      while (acc >= TICK_MS) {
        acc -= TICK_MS;
        const s = game.state;
        step(s, [controllers[0](s, 0), controllers[1](s, 1)]);
        if (s.ev.length) events.push(...s.ev);
      }
    },
    // Hand over everything that happened since the last call.
    drain() {
      const out = events;
      events = [];
      return out;
    },
  };
  return game;
}
