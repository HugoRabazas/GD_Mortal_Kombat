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
import { heads } from '../assets.js';

export const LEN = { thigh: 35, shin: 35, upper: 25, fore: 25, torso: 50, neck: 27, head: 32 };
const OUTLINE = '#0b070d';
export const ALT = { primary: '#2456c9', secondary: '#101a33', accent: '#7fd4ff', glow: '#59b7ff' };

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

function targetPose(f, now) {
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
      return pose({ hipY: -58, lean: -0.1, hfx: 22, hfy: -18, hbx: 18, hby: -8, ffx: 16, fbx: -22 });
    case 'hit': {
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
    case 'win': {
      const hop = Math.abs(Math.sin(f.t * 0.13)) * 9;
      return pose({ hipY: -62 - hop, lean: -0.05, hfx: 12, hfy: -48, hbx: -10, hby: -48, ffy: -hop, fby: -hop });
    }
    case 'lose':
      return pose({ hipY: -54, lean: 0.48, tilt: 0.4, hfx: 6, hfy: 36, hbx: -4, hby: 36 });
    default: {
      // idle: a gentle breathing bounce
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
export function drawFighter(ctx, f, char, now, { sx, sy, facing, lift = 0, scale = 1, alt = false }) {
  const col = alt ? { ...char.colors, ...ALT } : char.colors;
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
