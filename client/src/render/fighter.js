// Fighter animation, shared by the 3D rig and the flat 2D fallback.
//
// How the animation works: for every state of the simulation (idle, walking,
// punching, knocked down ...) we describe a *pose* - where the hips, hands and
// feet should be, seen from the fighter's side. The drawing code then works
// out knees and elbows by itself (inverse kinematics) and each frame glides
// the current pose towards the target pose, so movements flow instead of
// snapping. rig3d.js turns the solved pose into a 3D body; drawFighter() below
// draws the same pose flat, for devices without WebGL.

import { MOVES, THROW } from '../../../shared/sim.js';
import { getFighter, lookColors } from '../../../shared/fighters.js';
import { heads } from '../assets.js';

export const LEN = { thigh: 35, shin: 35, upper: 25, fore: 25, torso: 50, neck: 27, head: 32 };
const OUTLINE = '#0b070d';
export { ALT_COLORS as ALT } from '../../../shared/fighters.js';

// Pose fields. Hands are relative to the shoulder, feet relative to the spot
// on the ground under the fighter. x points the way the fighter is facing,
// y points down (so "up" is negative).
function pose(o) {
  return {
    hipX: 0, hipY: -62, lean: 0.12, tilt: 0,
    hfx: 26, hfy: -4, hbx: 12, hby: 8,
    ffx: 18, ffy: 0, fbx: -20, fby: 0,
    rot: 0, lift: 0, spin: 0,
    ...o,
  };
}

const CROUCH = { hipY: -38, lean: 0.24, hfx: 24, hfy: 4, hbx: 12, hby: 12, ffx: 22, fbx: -24 };
const AIR = { hipY: -64, lean: 0.1, hfx: 20, hfy: -18, hbx: -16, hby: -10, ffx: 12, ffy: -24, fbx: -12, fby: -12 };

// Shadow's finisher: gone from sight between vanishing and reappearing.
export const vanished = (f) =>
  f.state === 'attack' && ((f.move === 'eclipse' && f.t >= 5 && f.t < MOVES.eclipse.blink) || (f.move === 'shadeStep' && f.t >= 2 && f.t < MOVES.shadeStep.blink));

// A whole turn on the spot, over `ticks`: 0 at the start, a full circle at the
// end (which looks the same as no turn, so the next pose follows on).
const FLIP = 16; // ticks of the somersault that opens an air jump
const turnOf = (t, ticks) => Math.min(1, t / ticks) * Math.PI * 2;

// The ordinary blows get anticipation and follow-through on top of their key
// poses: the wind-up builds over the whole startup instead of snapping into
// place, the first tick of the strike overshoots a little, and the recovery
// settles back towards the guard rather than holding the extended pose.
const SHAPED = new Set(['punch', 'punch2', 'punch3', 'hook', 'breaker', 'kick', 'kick2', 'lunge', 'grab', 'launch', 'rollUpper', 'riseKick', 'howl3', 'eclipse3']);
const GUARD = { hipX: 0, hipY: -60, lean: 0.15, tilt: 0, hfx: 26, hfy: -6, hbx: 14, hby: 6, ffx: 18, ffy: 0, fbx: -22, fby: 0, rot: 0, lift: 0, spin: 0 };
function attackPose(f) {
  const key = attackKey(f);
  const m = MOVES[f.move];
  if (!m || !SHAPED.has(f.move)) return key;
  const end = m.startup + m.active;
  let out;
  if (f.t < m.startup) out = mix(GUARD, key, 0.35 + 0.65 * ease((f.t + 1) / m.startup));
  else if (f.t < end) {
    if (f.t - m.startup > 1) return key;
    // The strike's first ticks: thrown a little past its mark.
    out = { ...key, hipX: key.hipX + 4, lean: key.lean * 1.15, hfx: key.hfx * 1.08, ffx: key.ffx * 1.06 };
  } else out = mix(key, GUARD, 0.85 * ease((f.t - end) / Math.max(1, m.recovery)));
  out.spin = key.spin; // a turn on the spot is never blended (it would unwind)
  out.rot = key.rot;
  out.lift = key.lift;
  return out;
}

function attackKey(f) {
  const m = MOVES[f.move];
  if (!m) return pose({});
  const phase = f.t < m.startup ? 'pre' : f.t < m.startup + m.active ? 'act' : 'rec';
  switch (f.move) {
    case 'punch':
      if (phase === 'pre') return pose({ lean: 0.02, hfx: 2, hfy: 2 });
      if (phase === 'act') return pose({ lean: 0.34, hipX: 8, hfx: 54, hfy: -6, hbx: -6, hby: 10, fbx: -26 });
      return pose({ lean: 0.2, hfx: 32, hfy: 0 });
    case 'punch2': // the cross: the other hand, with the hips behind it
      if (phase === 'pre') return pose({ lean: 0.18, hbx: -10, hby: 4, hfx: 20, hfy: 2 });
      if (phase === 'act') return pose({ lean: 0.4, hipX: 12, hbx: 56, hby: -8, hfx: 4, hfy: 8, fbx: -30 });
      return pose({ lean: 0.22, hbx: 30, hby: 0 });
    case 'punch3': // the finisher of the string: a rising uppercut
      if (phase === 'pre') return pose({ ...CROUCH, lean: 0.3, hfx: 8, hfy: 28, hbx: -10, hby: 14 });
      if (phase === 'act') return pose({ hipX: 10, hipY: -68, lean: 0.08, hfx: 34, hfy: -50, hbx: -16, hby: 12, ffx: 22, fbx: -20, fby: -6 });
      return pose({ lean: 0.1, hfx: 22, hfy: -28 });
    case 'clawLeap': // Ruko's wolf leap: up with the claws drawn back, then raking down
      if (f.vh > 0) return pose({ hipY: -64, lean: 0.35, hfx: -6, hfy: -30, hbx: -18, hby: -24, ffx: 18, ffy: -30, fbx: -20, fby: -10 });
      return pose({ hipY: -62, lean: 0.6, hfx: 50, hfy: 26, hbx: 30, hby: 30, ffx: 12, ffy: -24, fbx: -24, fby: -12 });
    case 'shadeStep': // Shadow sinks into the shadows and rises behind the rival
      if (f.t < MOVES.shadeStep.blink) return pose({ ...CROUCH, hipY: -40, hfx: 10, hfy: -12, hbx: 14, hby: -14 });
      return pose({ hipY: -56, lean: 0.25, hfx: 26, hfy: -4, hbx: 18, hby: 4, ffx: 20, fbx: -26 });
    case 'bellyBump': // Jackie barging in, belly first, arms swung back
      if (phase === 'pre') return pose({ hipY: -48, lean: -0.1, hfx: -16, hfy: 10, hbx: -24, hby: 12, ffx: 26, fbx: -30 });
      if (phase === 'act') return pose({ hipX: 18, hipY: -50, lean: -0.32, hfx: -24, hfy: 6, hbx: -30, hby: 10, ffx: 34, fbx: -34 });
      return pose({ hipY: -50, lean: 0.1, hfx: 16, hfy: 10, hbx: 6, hby: 14, ffx: 26, fbx: -30 });
    case 'cartwheel': { // Pixie wheels in on her hands and comes out of it with a kick
      if (phase === 'pre') {
        const rot = Math.min(1, f.t / m.startup) * Math.PI * 2;
        return pose({ hipY: -58, lean: 0.4, hfx: 30, hfy: 30, hbx: 18, hby: 34, ffx: 18, ffy: -40, fbx: -18, fby: -40, rot, lift: -58 * (1 - Math.cos(rot)) });
      }
      if (phase === 'act') return pose({ hipX: 6, hipY: -62, lean: -0.45, ffx: 80, ffy: -70, fbx: -8, hfx: -10, hfy: 0, hbx: -26, hby: 6 });
      return pose({ lean: -0.15, ffx: 30, ffy: -20, hfx: 8, hfy: 6 });
    }
    case 'taunt': // each fighter's own gesture: their victory move, in brief
      return victoryPose(f);
    case 'charge': { // kick held: coiled on the back leg, the knee drawn up, trembling with it
      const shake = Math.sin(f.t * 2.1) * Math.min(1, f.t / 20) * 2;
      return pose({ hipX: -6 + shake, hipY: -56, lean: -0.22, tilt: -0.08, ffx: 14, ffy: -52, fbx: -24, hfx: 22, hfy: -10, hbx: 10, hby: -2 });
    }
    case 'breaker': // let go: a driving side kick, the whole body behind the heel
      if (phase === 'pre') return pose({ hipY: -58, lean: -0.3, ffx: 30, ffy: -56, fbx: -26, hfx: 18, hfy: -8, hbx: -4, hby: 4 });
      if (phase === 'act') return pose({ hipX: 12, hipY: -62, lean: -0.62, tilt: 0.12, ffx: 96, ffy: -64, fbx: -12, hfx: -10, hfy: 6, hbx: -30, hby: 8 });
      return pose({ lean: -0.2, ffx: 34, ffy: -18, hfx: 8, hfy: 6 });
    case 'hook': { // punch, kick: the knee chambered across, then the heel swung round at the head
      if (phase === 'pre') return pose({ hipY: -60, lean: -0.15, tilt: -0.12, ffx: 6, ffy: -54, fbx: -20, hfx: 16, hfy: -6, hbx: -10, hby: 6 });
      if (phase === 'act') return pose({ hipX: 4, hipY: -62, lean: -0.5, tilt: 0.3, ffx: 76, ffy: -92, fbx: -10, hfx: -12, hfy: -2, hbx: -28, hby: 6 });
      return pose({ lean: -0.18, ffx: 30, ffy: -26, hfx: 8, hfy: 4 });
    }
    case 'launch': { // the end of punch, punch, kick: a rising kick straight up under the chin
      if (phase === 'pre') return pose({ ...CROUCH, hipY: -42, lean: 0.34, ffx: 4, ffy: -6, hfx: 10, hfy: 10, hbx: -12, hby: 14 });
      if (phase === 'act') return pose({ hipX: -4, hipY: -66, lean: -0.42, ffx: 38, ffy: -116, fbx: -14, hfx: -8, hfy: -10, hbx: -28, hby: -4, lift: -8 });
      return pose({ lean: -0.18, ffx: 26, ffy: -40, hfx: 10, hfy: 0 });
    }
    case 'kick2': { // kick, kick: a full turn into a roundhouse at head height
      const spin = turnOf(f.t, m.startup + 1);
      if (phase === 'pre') return pose({ spin, lean: 0.24, ffx: 2, ffy: -12, fbx: -26, fby: -20, hfx: -16, hfy: 6, hbx: 18, hby: 2 });
      if (phase === 'act') return pose({ spin, hipY: -60, lean: -0.52, tilt: 0.3, ffx: 88, ffy: -78, fbx: -6, hfx: -16, hfy: -8, hbx: -30, hby: 0 });
      return pose({ lean: -0.18, ffx: 34, ffy: -24, hfx: 6, hfy: 6 });
    }
    case 'lunge': { // a straight thrown on the run: the whole body behind the fist
      if (phase === 'pre') return pose({ hipY: -56, lean: 0.42, hfx: 6, hfy: 4, hbx: -14, hby: 8, ffx: 26, fbx: -30 });
      if (phase === 'act') return pose({ hipX: 14, hipY: -58, lean: 0.62, hfx: 66, hfy: -8, hbx: -22, hby: 12, ffx: 30, fbx: -44, fby: -8 });
      return pose({ lean: 0.3, hfx: 36, hfy: 0, ffx: 22, fbx: -26 });
    }
    case 'slide': { // feet first along the floor, leaning back, arms out for balance
      if (phase === 'pre') return pose({ hipY: -44, lean: -0.15, ffx: 30, ffy: -10, fbx: -18, hfx: 8, hfy: 10, hbx: -20, hby: 6 });
      if (phase === 'act') return pose({ hipX: -6, hipY: -22, lean: -0.62, ffx: 76, ffy: -2, fbx: 14, fby: -4, hfx: -14, hfy: -18, hbx: -34, hby: 6 });
      return pose({ hipY: -34, lean: -0.3, ffx: 40, ffy: -2, fbx: 6, hfx: -6, hfy: 10, hbx: -24, hby: 10 });
    }
    case 'rollUpper': { // springing up out of the roll, the fist driven skywards
      if (phase === 'pre') return pose({ hipY: -34, lean: 0.48, hfx: 4, hfy: 30, hbx: -8, hby: 18, ffx: 20, fbx: -24 });
      if (phase === 'act') return pose({ hipX: 6, hipY: -70, lean: -0.04, hfx: 24, hfy: -62, hbx: -18, hby: 8, ffx: 12, ffy: -16, fbx: -22, fby: -4, lift: -14 });
      return pose({ lean: 0.06, hfx: 22, hfy: -34 });
    }
    case 'rollSpin': { // a full turn on the spot, the heel whipping round at head height
      const spin = turnOf(f.t, m.startup + 2);
      if (phase === 'pre') return pose({ spin, lean: 0.3, ffx: 4, ffy: -8, fbx: -30, fby: -28, hfx: -18, hfy: 8, hbx: 20, hby: 2 });
      if (phase === 'act') return pose({ spin, hipY: -60, lean: -0.5, tilt: 0.25, ffx: 86, ffy: -68, fbx: -8, hfx: -14, hfy: -6, hbx: -30, hby: 2 });
      return pose({ lean: -0.16, ffx: 32, ffy: -20, hfx: 6, hfy: 6 });
    }
    case 'riseKick': { // off the floor with a low sweeping turn, a hand on the ground
      const spin = turnOf(f.t, m.startup + 3);
      if (phase === 'pre') return pose({ spin, hipY: -26, lean: 0.55, tilt: 0.2, hfx: 18, hfy: 46, hbx: -4, hby: 30, ffx: 16, ffy: -6, fbx: -28, fby: -4 });
      if (phase === 'act') return pose({ spin, hipY: -28, lean: 0.1, tilt: -0.2, ffx: 84, ffy: -10, fbx: -18, hfx: 14, hfy: 44, hbx: -26, hby: 12 });
      return pose({ ...CROUCH, ffx: 30 });
    }
    case 'grab': // both hands reach out, then heave
      if (phase === 'pre') return pose({ lean: 0.25, hfx: 30, hfy: -10, hbx: 26, hby: -2 });
      if (phase === 'act') return pose({ lean: 0.45, hipX: 10, hfx: 50, hfy: -10, hbx: 48, hby: 2, fbx: -28 });
      return pose({ lean: -0.2, hfx: 10, hfy: -40, hbx: 4, hby: -34 });
    case 'kick':
      if (phase === 'pre') return pose({ lean: -0.1, ffx: 12, ffy: -34, hfx: 12, hfy: 4 });
      if (phase === 'act') return pose({ lean: -0.34, hipX: 8, ffx: 80, ffy: -84, fbx: -6, hfx: 6, hfy: 8, hbx: -18, hby: 4 });
      return pose({ lean: -0.12, ffx: 34, ffy: -26 });
    case 'howl2': // claws raking left and right, a blow every few ticks
    case 'eclipse2': { // fists and a knee in turn, too fast to follow
      const a = Math.floor(f.t / 2) % 2;
      const knee = f.move === 'eclipse2' && Math.floor(f.t / 2) % 3 === 2;
      return pose({ lean: 0.36, hipX: 8, hfx: a ? 60 : 12, hfy: a ? -14 : 4, hbx: a ? 2 : 58, hby: a ? 10 : -12, fbx: -28, ffx: knee ? 34 : 20, ffy: knee ? -52 : 0, tilt: a ? 0.08 : -0.08 });
    }
    case 'howl3': // the uppercut to the moon: off the floor, the fist past the head
      if (phase === 'pre') return pose({ ...CROUCH, hipY: -34, lean: 0.4, hfx: 6, hfy: 32, hbx: -12, hby: 16 });
      if (phase === 'act') return pose({ hipX: 10, hipY: -70, lean: -0.1, hfx: 30, hfy: -70, hbx: -20, hby: 10, ffx: 20, ffy: -18, fbx: -22, fby: -8, lift: -22 });
      return pose({ lean: 0.04, hfx: 22, hfy: -46, lift: -6 });
    case 'eclipse': // arms crossed while the body fades, then a palm thrust from behind
      if (f.t < m.blink) return pose({ hipY: -52, lean: 0.12, hfx: 10, hfy: -12, hbx: 16, hby: -14, ffx: 14, fbx: -16 });
      if (phase === 'pre') return pose({ hipY: -50, lean: 0.3, hfx: 2, hfy: 4, hbx: -18, hby: 6, ffx: 24, fbx: -30 });
      if (phase === 'act') return pose({ hipX: 12, hipY: -56, lean: 0.55, hfx: 62, hfy: -6, hbx: -24, hby: 10, ffx: 28, fbx: -42, fby: -6 });
      return pose({ lean: 0.24, hfx: 36, hfy: 0 });
    case 'eclipse3': { // a full turn into a kick that sends the rival flying
      const spin = turnOf(f.t, m.startup + 1);
      if (phase === 'pre') return pose({ spin, lean: 0.26, ffx: 2, ffy: -12, fbx: -26, fby: -22, hfx: -16, hfy: 6, hbx: 18, hby: 2 });
      if (phase === 'act') return pose({ spin, hipY: -58, lean: -0.55, tilt: 0.3, ffx: 90, ffy: -60, fbx: -6, hfx: -16, hfy: -8, hbx: -30, hby: 0 });
      return pose({ lean: -0.2, ffx: 34, ffy: -22, hfx: 6, hfy: 6 });
    }
    case 'avalanche': // head down behind a shoulder, arms braced: the sumo charge
      if (phase === 'pre') return pose({ ...CROUCH, hipY: -40, lean: 0.5, hfx: 26, hfy: 14, hbx: 22, hby: 18, ffx: 26, fbx: -30 });
      return pose({ hipX: 8, hipY: -46, lean: 0.72, hfx: 40, hfy: 12, hbx: 32, hby: 20, ffx: 30, ffy: -6, fbx: -40, fby: -8 });
    case 'avalanche2': // arms flung up on the leap, then a belly-first fall, arms spread
      if (phase === 'pre') return pose({ hipY: -64, lean: -0.12, hfx: 22, hfy: -54, hbx: -22, hby: -52, ffx: 16, ffy: -30, fbx: -14, fby: -26 });
      return pose({ hipY: -60, lean: 1.25, hfx: 44, hfy: 30, hbx: -8, hby: 34, ffx: -14, ffy: -22, fbx: -32, fby: -12 });
    case 'phoenix': // spinning up inside the flame, arms raised like wings
      if (phase === 'pre') return pose({ ...CROUCH, hipY: -36, hfx: 4, hfy: 24, hbx: -6, hby: 24 });
      return pose({ spin: (f.t * 0.55) % (Math.PI * 2), hipY: -68, lean: -0.05, hfx: 22, hfy: -58, hbx: -18, hby: -56, ffx: 6, ffy: 2, fbx: -6, fby: 4 });
    case 'phoenix2': // the dive: stretched out head first, arms ahead like a beak
      return pose({ hipY: -62, lean: 1.0, hfx: 52, hfy: 12, hbx: 48, hby: 18, ffx: -22, ffy: -12, fbx: -36, fby: -18 });
    case 'dash':
    case 'howl':
    case 'super':
      if (phase === 'pre') return pose({ hipY: -44, lean: 0.5, hfx: -8, hfy: 6, hbx: -20, hby: 8, ffx: 24, fbx: -32 });
      if (phase === 'act') return pose({ hipX: 10, hipY: -48, lean: 0.78, hfx: 54, hfy: 4, hbx: -30, hby: 10, ffx: 26, ffy: -4, fbx: -46, fby: -10 });
      return pose({ ...CROUCH, lean: 0.3 });
    case 'bolt':
      // Cupped hands in front while the bolt gathers between them, then both
      // palms thrust out.
      if (phase === 'pre') return pose({ hipY: -56, lean: 0.06, hfx: 18, hfy: 2, hbx: 15, hby: 7, ffx: 22, fbx: -26, tilt: Math.sin(f.t * 1.3) * 0.04 });
      return pose({ lean: 0.3, hipX: 6, hfx: 52, hfy: -4, hbx: 46, hby: 6, fbx: -28 });
    case 'rise':
      if (phase === 'pre') return pose({ ...CROUCH });
      if (f.vh > -2) return pose({ hipY: -64, lean: 0.12, hfx: 14, hfy: -52, hbx: -10, hby: 10, ffx: 10, ffy: -22, fbx: -12, fby: -4 });
      return pose({ ...AIR });
    case 'quake':
      // The sumo stomp: one leg swung high, then driven into the floor.
      if (phase === 'pre') return pose({ hipX: -6, hipY: -52, lean: -0.2, ffx: 30, ffy: -74, fbx: -22, hfx: 20, hfy: 26, hbx: -20, hby: 24 });
      return pose({ hipY: -34, lean: 0.3, ffx: 34, fbx: -34, hfx: 30, hfy: 24, hbx: -6, hby: 26 });
    default:
      return pose({});
  }
}

// Each fighter celebrates a won match in their own way (`victory` in the roster).
function victoryPose(f) {
  const t = f.t;
  switch (getFighter(f.char).victory) {
    case 'howl': {
      // Leaning back, one fist thrust up at the sky, the other arm flung back.
      const pump = Math.max(0, Math.sin(t * 0.09)) * 8;
      return pose({ hipY: -63, lean: -0.32, tilt: 0.06, hfx: 24, hfy: -54 - pump, hbx: -26, hby: 6, ffx: 22, fbx: -22 }); // the fist clears the head
    }
    case 'calm': {
      // Arms folded, feet planted, breathing slowly. Nothing to prove.
      const breathe = Math.sin(t * 0.05) * 1.2;
      return pose({ hipY: -62 + breathe, lean: -0.06, hfx: 6, hfy: 2 + breathe, hbx: 16, hby: -2 + breathe, ffx: 14, fbx: -16 });
    }
    case 'stomp': {
      // High stamping steps, one leg then the other, hands on the knees.
      const k = t % 80;
      const up = (from) => Math.max(0, Math.sin(((k - from) / 30) * Math.PI)) * (k >= from && k < from + 30 ? 1 : 0);
      const front = up(0);
      const back = up(40);
      return pose({ hipX: (back - front) * 6, hipY: -46 + (front + back) * 6, lean: 0.18, tilt: (front - back) * 0.18, hfx: 22, hfy: 20, hbx: -2, hby: 22, ffx: 26 + front * 12, ffy: -front * 70, fbx: -26 - back * 12, fby: -back * 70 });
    }
    default: {
      // cheer: little hops, arms up in a V and waving in turn.
      const hop = Math.abs(Math.sin(t * 0.13)) * 9;
      const wave = Math.sin(t * 0.2) * 10;
      return pose({ hipY: -62 - hop, lean: -0.05, hfx: 30 + wave, hfy: -40 - wave * 0.5, hbx: -28 - wave, hby: -40 + wave * 0.5, ffy: -hop, fby: -hop }); // arms in a wide V, clear of the head
    }
  }
}

// While a round is announced each fighter goes through a short ritual of
// their own (`entrance` in the roster), then settles into the stance.
// stage.js says how far into the announcement the round is (-1 when not).
let announce = -1;
export function setAnnounce(pt) {
  announce = pt;
}
// It plays in the second half of the announcement, once the camera has come
// down from the sky (and the first round's line-up card has gone), and ends
// a few ticks before the fight so the stance is ready in time.
const ENTRANCE_FROM = 44;
const ENTRANCE_TICKS = 66;
const ease = (x) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};
const mix = (a, b, k) => {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out[key] = (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * k;
  return out;
};

// The moments in each ritual that make a sound (ticks into the ritual):
// Jackie's two claps, Shadow's fist meeting the open hand, Pixie's flame.
const RITUAL_BEATS = { clap: [[8, 'clap'], [26, 'clap']], bow: [[44, 'palm']], swirl: [[2, 'flame']] };

// The sounds due in a ritual between two moments of the announcement.
export function ritualSounds(entrance, fromPt, toPt) {
  return (RITUAL_BEATS[entrance] || []).filter(([t]) => fromPt < ENTRANCE_FROM + t && toPt >= ENTRANCE_FROM + t).map(([, name]) => name);
}

function entrancePose(f, t) {
  switch (getFighter(f.char).entrance) {
    case 'prowl': {
      // Low to the ground, hands near the floor, then rising tall, chin up.
      const low = { hipY: -36, lean: 0.55, hfx: 30, hfy: 30, hbx: 12, hby: 30, ffx: 22, fbx: -30 };
      const tall = { hipY: -63, lean: -0.22, hfx: 20, hfy: -12, hbx: -8, hby: 10, ffx: 14, fbx: -18 };
      return pose(mix(low, tall, ease((t - 30) / 22)));
    }
    case 'bow': {
      // Upright, a slow bow, then a fist pressed into the open hand.
      const still = { hipY: -63, hfx: 4, hfy: 24, hbx: -4, hby: 24, ffx: 10, fbx: -12 };
      const bowed = { ...still, hipY: -60, lean: 0.62 };
      const fist = { hipY: -63, hfx: 22, hfy: -6, hbx: 22, hby: -4, ffx: 12, fbx: -14 };
      return pose(t < 36 ? mix(still, bowed, ease((t - 6) / 14) - ease((t - 26) / 10)) : mix(still, fist, ease((t - 36) / 10)));
    }
    case 'clap': {
      // A wide, low stance; two big claps in front, then the arms opened wide.
      const base = { hipY: -48, lean: 0.12, ffx: 30, fbx: -32 };
      if (t >= 44) return pose({ ...base, hfx: 36, hfy: -20, hbx: -34, hby: -20 });
      const shut = Math.max(0, Math.cos(((t - 8) / 18) * Math.PI * 2)); // 1 at each clap
      const k = t < 8 ? 0 : shut;
      return pose({ ...base, hfx: 40 - 8 * k, hfy: -18, hbx: -24 + 56 * k, hby: -18 }); // at chest height, clear of the belly
    }
    default: {
      // swirl: light on the toes, both hands circling as if stirring a flame.
      const a = t * 0.2;
      const b = Math.abs(Math.sin(t * 0.12)) * 3;
      return pose({ hipY: -63 - b, lean: 0.04, ffy: -b, fby: -b, hfx: 24 + 11 * Math.cos(a), hfy: -14 + 11 * Math.sin(a), hbx: 20 + 11 * Math.cos(a + Math.PI), hby: -14 + 11 * Math.sin(a + Math.PI) });
    }
  }
}

// Was this fighter's last fall a throw? (Then they lie the other way round.)
const thrown = [];

// How each build walks (the pose, before the lean of setting off).
function walkPose(f) {
  // Each build walks its own way: the heavy fighter waddles - wide, low,
  // rocking side to side on slower steps; the slim one goes on light,
  // quick, springy steps; everyone else strides evenly.
  const build = getFighter(f.char).build;
  if (build === 'sumo') {
    const p = f.t * 0.22;
    return pose({
      hipY: -50 + Math.abs(Math.sin(p)) * 2.5, tilt: Math.sin(p) * 0.12,
      ffx: 26 + 10 * Math.sin(p), ffy: -Math.max(0, Math.cos(p)) * 6,
      fbx: -28 - 10 * Math.sin(p), fby: -Math.max(0, -Math.cos(p)) * 6,
      hfx: 28 - 6 * Math.sin(p), hfy: 10, hbx: 14 + 6 * Math.sin(p), hby: 14,
      lean: 0.18,
    });
  }
  if (build === 'slim') {
    const p = f.t * 0.38;
    return pose({
      hipY: -63 - Math.abs(Math.sin(p)) * 3,
      ffx: 14 + 15 * Math.sin(p), ffy: -Math.max(0, Math.cos(p)) * 12,
      fbx: -14 - 15 * Math.sin(p), fby: -Math.max(0, -Math.cos(p)) * 12,
      hfx: 22 - 12 * Math.sin(p), hfy: -4, hbx: 8 + 12 * Math.sin(p), hby: 4,
      lean: 0.24,
    });
  }
  const p = f.t * 0.3;
  return pose({
    hipY: -61 + Math.abs(Math.sin(p)) * 1.5,
    ffx: 16 + 15 * Math.sin(p), ffy: -Math.max(0, Math.cos(p)) * 9,
    fbx: -16 - 15 * Math.sin(p), fby: -Math.max(0, -Math.cos(p)) * 9,
    // Arms swing against the legs, the way people walk.
    hfx: 24 - 12 * Math.sin(p), hfy: 2, hbx: 6 + 12 * Math.sin(p), hby: 10,
    lean: 0.2,
  });
}

// The first ticks of walking lean into the step; the first ticks of standing
// still after it settle back a little, a small dip of the hips.
function startLean(p, t) {
  const k = Math.max(0, 1 - t / 7);
  return { ...p, lean: p.lean + 0.18 * k, hipX: p.hipX + 4 * k };
}

// Standing at ease, in each build's own stance (before the flourishes).
function idleBase(f, now) {
  // idle: a gentle breathing bounce, in each build's own stance - the
  // sumo low and wide, breathing slowly; the slim fighter light on the
  // toes, bouncing quicker; everyone else square and ready.
  const build = getFighter(f.char).build;
  if (build === 'sumo') {
    const b = Math.sin(now / 420 + f.slot * 2);
    return pose({ hipY: -50 + b * 1.2, lean: 0.2, ffx: 28, fbx: -30, hfx: 26, hfy: 6 + b, hbx: 14, hby: 12 + b });
  }
  if (build === 'slim') {
    const b = Math.abs(Math.sin(now / 170 + f.slot * 2));
    return pose({ hipY: -63 - b * 3, lean: 0.08, ffy: -b * 2, fby: -b * 3, hfx: 22, hfy: -10 + b, hbx: 8, hby: 2 - b });
  }
  const b = Math.sin(now / 240 + f.slot * 2);
  return pose({ hipY: -62 + b * 1.6, hfy: -4 + b, hby: 8 - b });
}

// Standing still for a while, each fighter does something now and then (a
// little over a second every seven): the standard build rolls the shoulders
// and shakes out the hands, the sumo slaps the thighs and sinks, the slim
// fighter switches feet with a hop. Having just stopped walking, the body
// settles back a touch first.
function idlePose(f, now) {
  const p = idleBase(f, now);
  if (f.t < 8) {
    const k = 1 - f.t / 8;
    return { ...p, lean: p.lean - 0.1 * k, hipY: p.hipY + 3 * k };
  }
  if (f.t < 90) return p;
  const cycle = (now / 1000 + f.slot * 2.3) % 7;
  if (cycle > 1.3) return p;
  const k = Math.sin((cycle / 1.3) * Math.PI); // in and out
  const build = getFighter(f.char).build;
  if (build === 'sumo') return mix(p, { ...p, hipY: p.hipY + 8, lean: 0.4, hfx: 18, hfy: 34, hbx: 6, hby: 34 }, k);
  if (build === 'slim') {
    const hop = Math.abs(Math.sin(cycle * 7)) * 6;
    return mix(p, { ...p, hipY: p.hipY - hop, ffx: p.fbx + 4, fbx: p.ffx - 4, ffy: -hop * 0.6, fby: -hop * 0.6 }, k);
  }
  const roll = Math.sin(cycle * 9);
  return mix(p, { ...p, tilt: 0.08 * roll, hfx: 12, hfy: 18 + roll * 4, hbx: -4, hby: 20 - roll * 4, lean: 0.05 }, k);
}

// Each build guards its own way: the sumo low and wide behind both forearms,
// the slim fighter high and light, bobbing behind the hands.
function guardPose(f) {
  const build = getFighter(f.char).build;
  if (build === 'sumo') return pose({ hipY: -48, lean: 0.18, hfx: 34, hfy: 2, hbx: 30, hby: 12, ffx: 28, fbx: -30 });
  if (build === 'slim') {
    const b = Math.sin(f.t * 0.3) * 1.5;
    return pose({ hipY: -60 + b, lean: -0.02, hfx: 24, hfy: -16 + b, hbx: 22, hby: -6 + b, ffx: 14, ffy: -2, fbx: -20 });
  }
  return pose({ hipY: -58, lean: -0.05, hfx: 30, hfy: -4, hbx: 26, hby: 6, ffx: 16, fbx: -22 });
}

// A guard shoved back by a blow: leaning away, the arms pressed in, the
// back foot braced.
function recoil(p, k) {
  return { ...p, lean: p.lean - 0.2 * k, hipX: p.hipX - 7 * k, hfx: p.hfx - 8 * k, hbx: p.hbx - 6 * k, fbx: p.fbx - 8 * k };
}

function targetPose(f, now) {
  if (f.state === 'held') thrown[f.slot] = true;
  else if (f.state !== 'down' && f.state !== 'ko' && f.state !== 'getup') thrown[f.slot] = false;
  const ritual = announce - ENTRANCE_FROM;
  if (ritual >= 0 && ritual < ENTRANCE_TICKS && f.state === 'idle') return entrancePose(f, ritual);
  const air = f.h > 0.5;
  switch (f.state) {
    case 'walk':
      // Setting off, the body leans into the first few steps.
      return startLean(walkPose(f), f.t);
    case 'land': {
      // Landing: squashed low on touching down, then rising out of it.
      const k = ease(f.t / 7);
      return pose({ ...CROUCH, hipY: -34 - 16 * k, lean: 0.34 - 0.12 * k, hfx: 28, hfy: 10 - 8 * k, hbx: 8, hby: 16 - 6 * k, ffx: 26, fbx: -28 });
    }
    case 'backstep': {
      // A hop back, still facing the rival: off the floor, guard up.
      const k = Math.sin(Math.min(1, f.t / 9) * Math.PI);
      return pose({ hipX: -4, hipY: -60 - 8 * k, lean: -0.2, ffx: 14, ffy: -10 * k, fbx: -26, fby: -14 * k, hfx: 26, hfy: -10, hbx: 20, hby: 0 });
    }
    case 'roll':
      // Tucked into a ball, turning head over heels.
      return pose({ hipY: -30, lean: 0.9, tilt: 0.5, hfx: 16, hfy: 22, hbx: 10, hby: 22, ffx: 14, ffy: -8, fbx: -6, fby: -8, rot: f.t * 0.42, lift: -6 });
    case 'jump':
      if (f.air2 && f.t < FLIP) {
        // The air jump: tucked into a forward somersault, turned about the
        // hips (the lift keeps them where the rules put the fighter).
        const rot = (f.t / FLIP) * Math.PI * 2;
        return pose({ hipY: -48, lean: 0.7, hfx: 18, hfy: 20, hbx: 10, hby: 22, ffx: 18, ffy: -22, fbx: 4, fby: -20, rot, lift: -48 * (1 - Math.cos(rot)) });
      }
      // Pushing off (legs straight, arms thrown up), tucked at the top, then
      // reaching down for the floor on the way back.
      if (f.t < 4 && f.vh > 6) return pose({ hipY: -66, lean: 0.04, ffx: 6, ffy: 2, fbx: -10, fby: 4, hfx: 18, hfy: -40, hbx: -12, hby: -34 });
      if (Math.abs(f.vh) < 3) return pose({ ...AIR, ffx: 16, ffy: -30, fbx: -6, fby: -24, hfx: 22, hfy: -10, hbx: -14, hby: -4 });
      return f.vh < -3 ? pose({ ...AIR, ffx: 14, ffy: -8, fbx: -10, fby: -2, hfy: -30, hby: -24 }) : pose(AIR);
    case 'airAttack': {
      const pre = f.t < (MOVES[f.move]?.startup ?? 0);
      if (f.move === 'airPunch') {
        // A fist driven down and forward at whoever is below.
        if (pre) return pose({ hipY: -62, lean: 0.2, hfx: 2, hfy: -14, hbx: -16, hby: 2, ffx: 12, ffy: -24, fbx: -14, fby: -14 });
        return pose({ hipY: -62, lean: 0.5, hfx: 46, hfy: 30, hbx: -22, hby: -8, ffx: 8, ffy: -28, fbx: -24, fby: -14 });
      }
      if (f.move === 'airDash') {
        // The air rush: stretched out, diving fist first at the rival.
        if (pre) return pose({ hipY: -62, lean: 0.3, hfx: -8, hfy: -6, hbx: -20, hby: 4, ffx: 10, ffy: -26, fbx: -16, fby: -16 });
        return pose({ hipX: 10, hipY: -60, lean: 0.95, hfx: 56, hfy: 6, hbx: -28, hby: 8, ffx: -20, ffy: -14, fbx: -40, fby: -20 });
      }
      if (f.move === 'airBolt') {
        // Both palms thrust down and forward.
        if (pre) return pose({ hipY: -64, lean: -0.1, hfx: 6, hfy: -20, hbx: 2, hby: -14, ffx: 12, ffy: -24, fbx: -12, fby: -14 });
        return pose({ hipY: -62, lean: 0.4, hfx: 46, hfy: 22, hbx: 42, hby: 28, ffx: 6, ffy: -26, fbx: -20, fby: -14 });
      }
      if (f.move === 'bodyPress') {
        // Arms flung up, then dropping belly first, arms spread.
        if (pre) return pose({ hipY: -66, lean: -0.15, hfx: 22, hfy: -52, hbx: -22, hby: -50, ffx: 14, ffy: -30, fbx: -14, fby: -26 });
        return pose({ hipY: -60, lean: 1.25, hfx: 44, hfy: 30, hbx: -8, hby: 34, ffx: -14, ffy: -22, fbx: -32, fby: -12 });
      }
      if (f.move === 'airSpiral') {
        // A twirl in the air, arms out, the flames following them round.
        return pose({ spin: (f.t * 0.6) % (Math.PI * 2), hipY: -64, lean: 0.05, hfx: 36, hfy: -16, hbx: -36, hby: -16, ffx: 10, ffy: -20, fbx: -10, fby: -12 });
      }
      if (f.move === 'axeKick') {
        // The leg thrown up over the head, then chopped straight down.
        if (pre) return pose({ hipY: -64, lean: -0.3, ffx: 26, ffy: -126, fbx: -14, fby: -20, hfx: 14, hfy: -20, hbx: -18, hby: -10 });
        return pose({ hipY: -62, lean: 0.35, ffx: 48, ffy: 8, fbx: -18, fby: -28, hfx: 18, hfy: 6, hbx: -24, hby: -12 });
      }
      if (f.move === 'flyKnee') {
        // Driving forward off the run: the knee up in front, the arms pulled back.
        if (pre) return pose({ hipY: -64, lean: 0.1, ffx: 12, ffy: -24, fbx: -24, fby: -10, hfx: 20, hfy: -16, hbx: 6, hby: -10 });
        return pose({ hipX: 6, hipY: -66, lean: 0.2, ffx: 16, ffy: -44, fbx: -32, fby: -6, hfx: -6, hfy: -20, hbx: -22, hby: -8 });
      }
      if (f.move === 'stomp') {
        // Knees drawn up while hanging, then both feet driven straight down.
        if (pre) return pose({ hipY: -72, lean: 0.12, ffx: 18, ffy: -42, fbx: -8, fby: -38, hfx: 22, hfy: -30, hbx: -14, hby: -30 });
        return pose({ hipY: -68, lean: -0.04, ffx: 10, ffy: 0, fbx: -10, fby: 0, hfx: 14, hfy: -48, hbx: -18, hby: -46 });
      }
      return pose({ hipY: -62, lean: -0.18, ffx: 52, ffy: -16, fbx: -18, fby: -36, hfx: 10, hfy: 0, hbx: -22, hby: -8 });
    }
    case 'attack':
      return attackPose(f);
    case 'block':
      // A perfect guard: both arms shove the blow away before settling back.
      if (f.deflect > 0) return pose({ hipX: 6, hipY: -56, lean: 0.24, hfx: 48, hfy: -24, hbx: 42, hby: -12, ffx: 24, fbx: -28 });
      // Forearms crossed in front of the chest, low enough to be seen below
      // the big head from the camera.
      // A blow taken on the guard shoves it back (while the block stun lasts).
      if (f.stun > 0) return recoil(guardPose(f), Math.min(1, f.stun / 12));
      return guardPose(f);
    case 'throw': {
      // Seize low with both hands, heave the rival up and over the head
      // (leaning back into it), then drive them down behind: bent double.
      const t = f.t;
      if (t < THROW.lift) return pose({ hipY: -50, lean: 0.35, hfx: 40, hfy: 4, hbx: 36, hby: 10, ffx: 22, fbx: -24 });
      if (t < THROW.slam) {
        const k = (t - THROW.lift) / (THROW.slam - THROW.lift);
        return pose({ hipY: -58 + k * 4, lean: 0.2 - k * 0.65, tilt: -0.1 * k, hfx: 30 - k * 46, hfy: -10 - k * 52, hbx: 24 - k * 44, hby: -4 - k * 52, ffx: 20, fbx: -26 });
      }
      const k = Math.min(1, (t - THROW.slam) / 4);
      return pose({ hipY: -48, lean: -0.45 + k * 0.95, hfx: -20 + k * 4, hfy: 20, hbx: -26 + k * 6, hby: 24, ffx: 26, fbx: -30 });
    }
    case 'held': {
      // Lifted and turned head over heels on the way over, arms flailing.
      const t = f.t;
      const k = Math.min(1, Math.max(0, (t - THROW.lift) / (THROW.slam - THROW.lift)));
      const flail = Math.sin(t * 0.9) * 12;
      // Tipped head-first over the thrower: upright when seized, flat at the
      // top, head down behind for the slam. The body turns about the feet, so
      // it is raised by as much as the turn lowers the hips - they stay where
      // the rules carry them.
      const rot = t < THROW.lift ? (t / THROW.lift) * 0.25 : 0.25 + k * 2.3;
      return pose({ hipY: -60, lean: -0.2, hfx: 10 + flail, hfy: -30, hbx: -16 - flail, hby: -26, ffx: 16 - flail * 0.5, ffy: -10, fbx: -12 + flail * 0.5, fby: -16, rot, lift: -60 * (1 - Math.cos(rot)) });
    }
    case 'hit': {
      if (f.reel > 0) {
        // Thrown off balance by a perfect guard: arms flung wide, swaying on the heels.
        const sway = Math.sin(f.t * 0.45);
        return pose({ hipX: -12 + sway * 4, hipY: -56, lean: -0.5 + sway * 0.14, tilt: -0.35, hfx: -10, hfy: -38 + sway * 6, hbx: -32, hby: -24 - sway * 6, ffx: 22, ffy: -Math.max(0, sway) * 8, fbx: -20 });
      }
      // Which way the blow came from, read from the push at the moment it
      // landed (it fades during the stun, so it is remembered): struck from
      // behind, the body is thrown forward instead of back. How hard it was
      // shows too: a light blow is a flinch, a heavy one a stagger with the
      // arms flung and a foot lifted, and the head snaps to alternate sides
      // as blows keep landing. Both ease off as the stun runs out.
      if (f.t < 3 || hitFrom[f.slot] === undefined) {
        hitFrom[f.slot] = Math.cos(f.dir) * (f.vx || 0) + Math.sin(f.dir) * (f.vz || 0) > 0.5;
        hitLen[f.slot] = Math.max(hitLen[f.slot] && f.t > 0 ? hitLen[f.slot] : 0, f.stun + f.t);
      }
      const heavy = hitLen[f.slot] >= 18;
      const k = Math.min(1, f.t / Math.max(6, hitLen[f.slot] || 12));
      const amt = (heavy ? 1.25 : 0.8) * (1 - 0.65 * ease(k));
      const side = (f.taken || 1) % 2 ? 1 : -1;
      if (hitFrom[f.slot]) return pose({ hipX: 6 * amt, hipY: -57, lean: 0.55 * amt, tilt: 0.25 * amt * side, hfx: 22, hfy: 16, hbx: -20 - (heavy ? 12 * amt : 0), hby: -10, ffx: 20, fbx: -20 });
      return pose({
        hipX: -7 * amt - (heavy ? 5 * amt : 0), hipY: -58 + (heavy ? 3 : 0), lean: -0.45 * amt, tilt: -0.32 * amt * side,
        hfx: heavy ? -16 * amt : -4, hfy: heavy ? -14 * amt : 12, hbx: -24 - (heavy ? 8 * amt : 0), hby: heavy ? -6 * amt : 2,
        ffx: 14 + (heavy ? 12 * amt : 0), ffy: heavy ? -10 * amt : 0, fbx: -18 - (heavy ? 8 * amt : 0),
      });
    }
    case 'down':
    case 'ko': {
      // A thrown fighter went over head-first, so lies the other way round.
      const way = thrown[f.slot] ? 1 : -1;
      const limp = { lean: 0, hfx: 4, hfy: 26, hbx: -8, hby: 24, ffx: 10, fbx: -8, hipY: -64 };
      if (air) return pose({ ...limp, rot: thrown[f.slot] ? 1.45 : -Math.min(1.3, 0.3 + f.t * 0.11), hfy: -6, hby: -12 });
      // On the floor: a bounce as the body hits it (the first ticks after
      // landing), rocking a little, then still.
      const since = 34 - (f.stun || 0);
      if (f.state === 'down' && since >= 0 && since < 12) {
        const k = since / 12;
        const b = Math.sin(k * Math.PI) * (1 - k * 0.4);
        return pose({ ...limp, rot: (way * Math.PI) / 2 + way * 0.22 * b, lift: -15 - 16 * b, hfy: 26 - 20 * b, ffy: -14 * b });
      }
      return pose({ ...limp, rot: (way * Math.PI) / 2, lift: -15 });
    }
    case 'getup': {
      // Each build gets up its own way: the sumo heaves up slowly, pushing on
      // the floor; the slim fighter springs up with a little hop at the end.
      const build = getFighter(f.char).build;
      const k = Math.min(1, f.t / (build === 'sumo' ? 18 : build === 'slim' ? 12 : 16));
      const base = pose({ ...CROUCH, rot: ((thrown[f.slot] ? 1 : -1) * Math.PI / 2) * (1 - k) * (1 - k), lift: -15 * (1 - k), hipY: -30 - 20 * k });
      if (build === 'sumo') return { ...base, hfx: 20, hfy: 40 - 20 * k, hbx: 6, hby: 40 - 20 * k, lean: base.lean + 0.15 * (1 - k) };
      if (build === 'slim' && k >= 1) {
        const hop = Math.sin(Math.min(1, (f.t - 12) / 5) * Math.PI) * 8;
        return { ...base, hipY: base.hipY - hop, ffy: -hop * 0.7, fby: -hop * 0.7, hfy: -10, hby: -8 };
      }
      return base;
    }
    case 'win':
      return victoryPose(f);
    case 'lose': {
      // Beaten, each build in its own way: the heavy fighter sits down hard,
      // legs out, leaning back on the hands; the slim one drops to a knee,
      // head bowed; everyone else stands slumped, arms hanging.
      const build = getFighter(f.char).build;
      if (build === 'sumo') return pose({ hipY: -22, lean: -0.3, ffx: 40, ffy: -6, fbx: 26, fby: -4, hfx: -18, hfy: 30, hbx: -30, hby: 26 });
      if (build === 'slim') return pose({ hipY: -40, lean: 0.42, tilt: 0.12, ffx: 22, fbx: -24, fby: -2, hfx: 16, hfy: 30, hbx: -6, hby: 34 });
      return pose({ hipY: -54, lean: 0.48, tilt: 0.4, hfx: 6, hfy: 36, hbx: -4, hby: 36 });
    }
    default:
      return idlePose(f, now);
  }
}

// Each fighter slot keeps its own smoothed pose between frames.
const smooth = [];
const lastAt = []; // when each slot's pose was last eased
const hitFrom = []; // per slot: was the last blow taken from behind?
const hitLen = []; // per slot: how long the current stun lasts (its strength)
const rolled = []; // per slot: was the fighter rolling last frame?
const TAU = Math.PI * 2;

export function resetPoses() {
  smooth.length = 0;
  lastAt.length = 0;
  hitFrom.length = 0;
  hitLen.length = 0;
  thrown.length = 0;
  rolled.length = 0;
}

// The pose a fighter should be drawn in right now, eased from the last frame.
// Call it once per fighter per frame.
export function currentPose(f, now) {
  const target = targetPose(f, now);
  let cur = smooth[f.slot];
  if (!cur) {
    cur = smooth[f.slot] = { ...target };
    lastAt[f.slot] = now;
    return cur;
  }
  // Attacks snap faster so hits look crisp; everything else eases. The rates
  // are per 60 fps frame, scaled by the real time since the last frame so a
  // slower phone sees the same timing (a long stall counts as four frames).
  const frames = Math.min(4, Math.max(0, (now - (lastAt[f.slot] ?? now)) / (1000 / 60)));
  lastAt[f.slot] = now;
  // (The first ticks of being hit snap hardest, so the impact reads.)
  const rate = f.state === 'hit' && f.t < 3 ? 0.8 : f.state === 'attack' || f.state === 'hit' || f.state === 'airAttack' ? 0.62 : 0.36;
  const k = 1 - Math.pow(1 - rate, frames);
  for (const key in target) cur[key] += (target[key] - cur[key]) * k;
  cur.spin = target.spin; // a turn on the spot is drawn as it is: easing would unwind it
  if (f.state === 'roll' || (f.state === 'jump' && f.air2)) {
    cur.rot = target.rot; // a spin must not be smoothed away
    rolled[f.slot] = true;
  } else if (rolled[f.slot]) {
    // Coming out of a roll: carry on turning the same way to upright (an
    // attack out of the roll starts with the body upside down), never unwind.
    rolled[f.slot] = false;
    const r = ((cur.rot % TAU) + TAU) % TAU;
    cur.rot = r < 0.6 ? r : r - TAU;
  }
  return cur;
}

// Two-bone inverse kinematics: given where a limb starts and where it should
// end, find the middle joint (knee or elbow). `bend` picks the bending side.
export function joint(ax, ay, bx, by, l1, l2, bend) {
  let dx = bx - ax;
  let dy = by - ay;
  let d = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2 - 0.5;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return {
    jx: ax + (a * dx) / d + (bend * h * -dy) / d,
    jy: ay + (a * dy) / d + (bend * h * dx) / d,
    ex: ax + dx,
    ey: ay + dy,
  };
}

// ------------------------------------------------- flat 2D fallback only ---

function limb(ctx, x1, y1, x2, y2, x3, y3, width, color) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + 5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function blob(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

// Draws a fighter standing at screen point (sx, sy), facing left (-1) or
// right (1), `lift` pixels above the floor.
export function drawFighter(ctx, f, char, now, { sx, sy, facing, lift = 0, scale = 1, look = 0 }) {
  const col = lookColors(char.id, look);
  const wide = char.build === 'sumo' ? 1.45 : char.build === 'slim' ? 0.82 : 1;
  const p = currentPose(f, now);
  if (vanished(f)) return;
  const D = Math.cos(p.spin) < 0 ? -facing : facing; // half way round a turn: seen from behind

  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 4, 40 * scale * wide, 9 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(sx, sy - lift + p.lift * scale);
  ctx.scale(scale, scale);
  ctx.rotate(p.rot * D);

  const hipX = p.hipX * D;
  const hipY = p.hipY;
  const shX = hipX + Math.sin(p.lean) * LEN.torso * D;
  const shY = hipY - Math.cos(p.lean) * LEN.torso;
  const hdX = shX + Math.sin(p.lean + p.tilt) * LEN.neck * D;
  const hdY = shY - Math.cos(p.lean + p.tilt) * LEN.neck;
  const legB = joint(hipX - 5 * D, hipY, p.fbx * D, p.fby, LEN.thigh, LEN.shin, -D);
  const legF = joint(hipX + 5 * D, hipY, p.ffx * D, p.ffy, LEN.thigh, LEN.shin, -D);
  const armB = joint(shX - 7 * D, shY + 6, shX + p.hbx * D, shY + p.hby, LEN.upper, LEN.fore, D);
  const armF = joint(shX + 7 * D, shY + 6, shX + p.hfx * D, shY + p.hfy, LEN.upper, LEN.fore, D);

  limb(ctx, shX - 7 * D, shY + 6, armB.jx, armB.jy, armB.ex, armB.ey, 10 * wide, col.skin);
  blob(ctx, armB.ex, armB.ey, 8, 8, col.accent);
  limb(ctx, hipX - 5 * D, hipY, legB.jx, legB.jy, legB.ex, legB.ey - 4, 14 * wide, col.secondary);
  blob(ctx, legB.ex + 4 * D, legB.ey - 4, 12, 6.5, col.accent);
  limb(ctx, hipX, hipY - 4, (hipX + shX) / 2, (hipY + shY) / 2, shX, shY + 4, 32 * wide, char.build === 'sumo' ? col.skin : col.primary);
  limb(ctx, hipX + 5 * D, hipY, legF.jx, legF.jy, legF.ex, legF.ey - 4, 15 * wide, col.secondary);
  blob(ctx, legF.ex + 4 * D, legF.ey - 4, 12.5, 7, col.accent);

  ctx.beginPath();
  ctx.arc(hdX, hdY, LEN.head + 4, 0, Math.PI * 2);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hdX, hdY, LEN.head + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = col.accent;
  ctx.fill();
  const head = heads.get(char.id);
  if (head) ctx.drawImage(head, hdX - LEN.head + 1.5, hdY - LEN.head + 1.5, (LEN.head - 1.5) * 2, (LEN.head - 1.5) * 2);

  limb(ctx, shX + 7 * D, shY + 6, armF.jx, armF.jy, armF.ex, armF.ey, 11 * wide, col.skin);
  blob(ctx, armF.ex, armF.ey, 9, 9, col.accent);
  ctx.restore();
}

export function drawProjectile(ctx, x, y, char) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 1, x, y, 30);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, char.colors.glow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
