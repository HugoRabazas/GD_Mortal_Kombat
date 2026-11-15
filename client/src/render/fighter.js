// Fighter animation, shared by the 3D rig and the flat 2D fallback.
//
// How the animation works: for every state of the simulation (idle, walking,
// punching, knocked down ...) we describe a *pose* - where the hips, hands and
// feet should be, seen from the fighter's side. The drawing code then works
// out knees and elbows by itself (inverse kinematics) and each frame glides
// the current pose towards the target pose, so movements flow instead of
// snapping. rig3d.js turns the solved pose into a 3D body; drawFighter() below
// draws the same pose flat, for devices without WebGL.

import { MOVES } from '../../../shared/sim.js';
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
    rot: 0, lift: 0,
    ...o,
  };
}

const CROUCH = { hipY: -38, lean: 0.24, hfx: 24, hfy: 4, hbx: 12, hby: 12, ffx: 22, fbx: -24 };
const AIR = { hipY: -64, lean: 0.1, hfx: 20, hfy: -18, hbx: -16, hby: -10, ffx: 12, ffy: -24, fbx: -12, fby: -12 };

function attackPose(f) {
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
    case 'grab': // both hands reach out, then heave
      if (phase === 'pre') return pose({ lean: 0.25, hfx: 30, hfy: -10, hbx: 26, hby: -2 });
      if (phase === 'act') return pose({ lean: 0.45, hipX: 10, hfx: 50, hfy: -10, hbx: 48, hby: 2, fbx: -28 });
      return pose({ lean: -0.2, hfx: 10, hfy: -40, hbx: 4, hby: -34 });
    case 'kick':
      if (phase === 'pre') return pose({ lean: -0.1, ffx: 12, ffy: -34, hfx: 12, hfy: 4 });
      if (phase === 'act') return pose({ lean: -0.34, hipX: 8, ffx: 80, ffy: -84, fbx: -6, hfx: 6, hfy: 8, hbx: -18, hby: 4 });
      return pose({ lean: -0.12, ffx: 34, ffy: -26 });
    case 'dash':
    case 'super':
      if (phase === 'pre') return pose({ hipY: -44, lean: 0.5, hfx: -8, hfy: 6, hbx: -20, hby: 8, ffx: 24, fbx: -32 });
      if (phase === 'act') return pose({ hipX: 10, hipY: -48, lean: 0.78, hfx: 54, hfy: 4, hbx: -30, hby: 10, ffx: 26, ffy: -4, fbx: -46, fby: -10 });
      return pose({ ...CROUCH, lean: 0.3 });
    case 'bolt':
      if (phase === 'pre') return pose({ lean: -0.12, hfx: -12, hfy: -2, hbx: -20, hby: 4 });
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

function targetPose(f, now) {
  const ritual = announce - ENTRANCE_FROM;
  if (ritual >= 0 && ritual < ENTRANCE_TICKS && f.state === 'idle') return entrancePose(f, ritual);
  const air = f.h > 0.5;
  switch (f.state) {
    case 'walk': {
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
    case 'land':
      return pose({ ...CROUCH, hipY: -46 });
    case 'roll':
      // Tucked into a ball, turning head over heels.
      return pose({ hipY: -30, lean: 0.9, tilt: 0.5, hfx: 16, hfy: 22, hbx: 10, hby: 22, ffx: 14, ffy: -8, fbx: -6, fby: -8, rot: f.t * 0.42, lift: -6 });
    case 'jump':
      return f.vh < -3 ? pose({ ...AIR, ffx: 14, ffy: -8, fbx: -10, fby: -2, hfy: -30, hby: -24 }) : pose(AIR);
    case 'airAttack':
      return pose({ hipY: -62, lean: -0.18, ffx: 52, ffy: -16, fbx: -18, fby: -36, hfx: 10, hfy: 0, hbx: -22, hby: -8 });
    case 'attack':
      return attackPose(f);
    case 'block':
      // A perfect guard: both arms shove the blow away before settling back.
      if (f.deflect > 0) return pose({ hipX: 6, hipY: -56, lean: 0.24, hfx: 48, hfy: -24, hbx: 42, hby: -12, ffx: 24, fbx: -28 });
      // Forearms crossed in front of the chest, low enough to be seen below
      // the big head from the camera.
      return pose({ hipY: -58, lean: -0.05, hfx: 30, hfy: -4, hbx: 26, hby: 6, ffx: 16, fbx: -22 });
    case 'hit': {
      if (f.reel > 0) {
        // Thrown off balance by a perfect guard: arms flung wide, swaying on the heels.
        const sway = Math.sin(f.t * 0.45);
        return pose({ hipX: -12 + sway * 4, hipY: -56, lean: -0.5 + sway * 0.14, tilt: -0.35, hfx: -10, hfy: -38 + sway * 6, hbx: -32, hby: -24 - sway * 6, ffx: 22, ffy: -Math.max(0, sway) * 8, fbx: -20 });
      }
      const jolt = f.t < 5 ? 1 : 0.6;
      return pose({ hipX: -6, hipY: -58, lean: -0.4 * jolt, tilt: -0.3 * jolt, hfx: -4, hfy: 12, hbx: -24, hby: 2, ffx: 14, fbx: -18 });
    }
    case 'down':
    case 'ko': {
      const limp = { lean: 0, hfx: 4, hfy: 26, hbx: -8, hby: 24, ffx: 10, fbx: -8, hipY: -64 };
      if (air) return pose({ ...limp, rot: -Math.min(1.3, 0.3 + f.t * 0.11), hfy: -6, hby: -12 });
      return pose({ ...limp, rot: -Math.PI / 2, lift: -15 });
    }
    case 'getup': {
      const k = Math.min(1, f.t / 16);
      return pose({ ...CROUCH, rot: (-Math.PI / 2) * (1 - k) * (1 - k), lift: -15 * (1 - k), hipY: -30 - 20 * k });
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
    default: {
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
  }
}

// Each fighter slot keeps its own smoothed pose between frames.
const smooth = [];

export function resetPoses() {
  smooth.length = 0;
}

// The pose a fighter should be drawn in right now, eased from the last frame.
// Call it once per fighter per frame.
export function currentPose(f, now) {
  const target = targetPose(f, now);
  let cur = smooth[f.slot];
  if (!cur) {
    cur = smooth[f.slot] = { ...target };
    return cur;
  }
  // Attacks snap faster so hits look crisp; everything else eases.
  const k = f.state === 'attack' || f.state === 'hit' || f.state === 'airAttack' ? 0.62 : 0.36;
  for (const key in target) cur[key] += (target[key] - cur[key]) * k;
  if (f.state === 'roll') cur.rot = target.rot; // a spin must not be smoothed away
  else if (Math.abs(cur.rot) > Math.PI) cur.rot = 0; // coming out of a roll: do not unwind it
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
  const D = facing;

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
