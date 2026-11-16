// A guest's own blow, drawn at once.
//
// Online, the host decides everything; a guest's press travels to the host and
// the host's picture of the swing travels back - a whole round trip, plus the
// wait for the next picture, before the guest saw their own punch start.
// Between friends far apart that is a fifth of a second or more: the fighter
// felt as if it barely answered.
//
// Now a plain punch or kick pressed while the fighter is free (standing, or a
// step or two into a walk) starts on the guest's screen at once. Only the
// drawing is ahead: whether the blow lands is still the host's to say. When
// the host's picture shows the same blow, the drawing keeps whichever of the
// two is further along, so the swing never jumps back; if the host never
// shows it (the press came too late, a hit arrived first) it is dropped.

import { MOVES } from '../../../shared/sim.js';
import { INPUT } from '../../../shared/constants.js';

const TICK = 1000 / 60;
const SLACK = 160; // ms past the round trip to wait for the host to show it

const total = (move) => MOVES[move].startup + MOVES[move].active + MOVES[move].recovery;

export function createAttackPredictor() {
  let prevBits = 0;
  let guess = null; // { move, at, seen }
  return {
    // Each frame: the buttons now down, our fighter as the host last showed
    // it, whether the fight is on, our ping (ms), the time and the host's tick.
    note(bits, f, fighting, ping, now, tick = 0) {
      const pressed = bits & ~prevBits;
      prevBits = bits;
      if (guess) {
        const same = f.state === 'attack' && f.move === guess.move;
        if (same) guess.seen = true;
        const hurt = ['hit', 'down', 'held', 'ko'].includes(f.state) || (f.stun || 0) > 0;
        const late = now - guess.at > (ping ?? 120) + SLACK;
        // Shown and over (or turned into the next blow of a string); or never
        // shown - struck first, or the press did not become this blow.
        if (guess.seen ? !same : hurt || late) guess = null;
      }
      if (!guess && fighting && pressed & (INPUT.PUNCH | INPUT.KICK)) {
        // Only the plain first blow: anything with another button (special,
        // grab, super), a moving or guarded press, a riposte or a pursuit is
        // left to the host.
        const other = bits & (INPUT.SPECIAL | INPUT.SUPER | INPUT.GRAB | INPUT.BLOCK);
        const both = (bits & INPUT.PUNCH) && (bits & INPUT.KICK);
        // (With the stick held, a walk soon makes the blow a lunge or a
        // slide: only a press from standing is surely the plain one.)
        const stick = bits & (INPUT.LEFT | INPUT.RIGHT | INPUT.UP | INPUT.DOWN);
        const still = f.state === 'idle' || (f.state === 'walk' && !stick);
        const free = still && !(f.stun > 0) && !(f.rip > 0) && !(f.h > 0) && !((f.pursue ?? -1) >= tick);
        if (!other && !both && free) guess = { move: pressed & INPUT.KICK ? 'kick' : 'punch', at: now, seen: false };
      }
    },
    // Our fighter as it should be drawn.
    draw(f, now) {
      if (!guess) return f;
      const ticks = Math.min(total(guess.move) - 1, Math.floor((now - guess.at) / TICK));
      const hostShows = f.state === 'attack' && f.move === guess.move;
      if (hostShows && f.t >= ticks) return f;
      return { ...f, state: 'attack', move: guess.move, t: ticks, vx: 0, vz: 0 };
    },
    active: () => !!guess,
  };
}
