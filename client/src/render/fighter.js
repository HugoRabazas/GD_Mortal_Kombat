// Draws a fighter: an animated body built from simple limbs, with the alliance
// member's picture as the head.
//
// How the animation works: for every state of the simulation (idle, walking,
// punching, knocked down ...) we describe a *pose* - where the hips, hands and
// feet should be. The drawing code then works out knees and elbows by itself
// (inverse kinematics) and each frame glides the current pose towards the
// target pose, so movements flow instead of snapping.

import { ARENA } from '../../../shared/constants.js';
import { MOVES } from '../../../shared/sim.js';
import { heads } from '../assets.js';

const { FLOOR } = ARENA;
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
    case 'kick':
      if (phase === 'pre') return pose({ lean: -0.1, ffx: 12, ffy: -34, hfx: 12, hfy: 4 });
      if (phase === 'act') return pose({ lean: -0.34, hipX: 8, ffx: 80, ffy: -84, fbx: -6, hfx: 6, hfy: 8, hbx: -18, hby: 4 });
      return pose({ lean: -0.12, ffx: 34, ffy: -26 });
    case 'lowPunch':
      if (phase === 'act') return pose({ ...CROUCH, lean: 0.4, hipX: 6, hfx: 54, hfy: 8, hbx: -4, hby: 12 });
      return pose({ ...CROUCH, hfx: phase === 'pre' ? 2 : 30 });
    case 'sweep':
      if (phase === 'act') return pose({ hipX: 2, hipY: -30, lean: -0.28, ffx: 76, ffy: -8, fbx: -24, hfx: -6, hfy: 12, hbx: -22, hby: 6 });
      return pose({ ...CROUCH, lean: 0.05 });
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
      if (f.vy < 2) return pose({ hipY: -64, lean: 0.12, hfx: 14, hfy: -52, hbx: -10, hby: 10, ffx: 10, ffy: -22, fbx: -12, fby: -4 });
      return pose({ ...AIR });
    default:
      return pose({});
  }
}

function targetPose(f, now) {
  const air = f.y < FLOOR - 0.5;
  switch (f.state) {
    case 'walk': {
      const p = f.t * 0.3;
      return pose({
        hipY: -61 + Math.abs(Math.sin(p)) * 1.5,
        ffx: 16 + 15 * Math.sin(p), ffy: -Math.max(0, Math.cos(p)) * 9,
        fbx: -16 - 15 * Math.sin(p), fby: -Math.max(0, -Math.cos(p)) * 9,
      });
    }
    case 'crouch':
      return pose(CROUCH);
    case 'land':
      return pose({ ...CROUCH, hipY: -46 });
    case 'jump':
      return f.vy > 3 ? pose({ ...AIR, ffx: 14, ffy: -8, fbx: -10, fby: -2, hfy: -30, hby: -24 }) : pose(AIR);
    case 'airAttack':
      return pose({ hipY: -62, lean: -0.18, ffx: 52, ffy: -16, fbx: -18, fby: -36, hfx: 10, hfy: 0, hbx: -22, hby: -8 });
    case 'attack':
      return attackPose(f);
    case 'block':
      return pose({
        hipY: f.crouching ? -38 : -60, lean: -0.1,
        hfx: 22, hfy: -18, hbx: 18, hby: -8,
        ffx: f.crouching ? 22 : 16, fbx: f.crouching ? -24 : -22,
      });
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
const smooth = [null, null];

export function resetPoses() {
  smooth[0] = smooth[1] = null;
}

function glide(slot, target, f) {
  let cur = smooth[slot];
  if (!cur || cur.state === undefined) {
    cur = smooth[slot] = { ...target, state: f.state };
    return cur;
  }
  // Attacks snap faster so hits look crisp; everything else eases.
  const k = f.state === 'attack' || f.state === 'hit' || f.state === 'airAttack' ? 0.62 : 0.36;
  for (const key in target) cur[key] += (target[key] - cur[key]) * k;
  cur.state = f.state;
  return cur;
}

// The pose a fighter should be drawn in right now, eased from the last frame.
// Call it once per fighter per frame.
export function currentPose(f, now) {
  return glide(f.slot, targetPose(f, now), f);
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

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * amount)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// Speed streaks trailing behind a dashing fighter.
export function drawStreaks(ctx, f, color) {
  if (!(f.state === 'attack' && (f.move === 'dash' || f.move === 'super') && f.vx !== 0)) return;
  const D = f.facing;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const y = f.y - 20 - i * 19;
    const len = 90 + ((i * 53) % 70) + (f.move === 'super' ? 80 : 0);
    const grad = ctx.createLinearGradient(f.x, 0, f.x - D * len, 0);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = grad;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(f.x - D * 10, y);
    ctx.lineTo(f.x - D * len, y);
    ctx.stroke();
  }
  ctx.restore();
}

// `char` is the roster entry, `alt` recolours the outfit for a mirror match.
export function drawFighter(ctx, f, char, now, alt = false, flatShadow = true) {
  const col = alt ? { ...char.colors, ...ALT } : char.colors;
  const p = currentPose(f, now);
  const D = f.facing;
  const special = f.state === 'attack' && (f.move === 'dash' || f.move === 'super' || f.move === 'rise' || f.move === 'bolt');

  // Shadow on the floor.
  if (flatShadow) {
    const height = Math.max(0, FLOOR - f.y);
    ctx.fillStyle = `rgba(0,0,0,${0.42 - Math.min(0.25, height / 500)})`;
    ctx.beginPath();
    ctx.ellipse(f.x, FLOOR + 5, 40 - Math.min(16, height / 10), 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawStreaks(ctx, f, col.glow);

  ctx.save();
  ctx.translate(f.x, f.y + p.lift);
  ctx.rotate(p.rot * D);

  const hipX = p.hipX * D;
  const hipY = p.hipY;
  const shX = hipX + Math.sin(p.lean) * LEN.torso * D;
  const shY = hipY - Math.cos(p.lean) * LEN.torso;
  const hdX = shX + Math.sin(p.lean + p.tilt) * LEN.neck * D;
  const hdY = shY - Math.cos(p.lean + p.tilt) * LEN.neck;

  // Glow around a fighter using a special move.
  if (special) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const aura = ctx.createRadialGradient(hipX, hipY - 30, 10, hipX, hipY - 30, 120);
    aura.addColorStop(0, col.glow);
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(now / 40);
    ctx.fillStyle = aura;
    ctx.fillRect(hipX - 130, hipY - 160, 260, 260);
    ctx.restore();
  }

  const legB = joint(hipX - 5 * D, hipY, p.fbx * D, p.fby, LEN.thigh, LEN.shin, -D);
  const legF = joint(hipX + 5 * D, hipY, p.ffx * D, p.ffy, LEN.thigh, LEN.shin, -D);
  const armB = joint(shX - 7 * D, shY + 6, shX + p.hbx * D, shY + p.hby, LEN.upper, LEN.fore, D);
  const armF = joint(shX + 7 * D, shY + 6, shX + p.hfx * D, shY + p.hfy, LEN.upper, LEN.fore, D);

  // Far side first, so the near limbs overlap it.
  limb(ctx, shX - 7 * D, shY + 6, armB.jx, armB.jy, armB.ex, armB.ey, 10, shade(col.skin, 0.72));
  blob(ctx, armB.ex, armB.ey, 8, 8, shade(col.accent, 0.7));
  limb(ctx, hipX - 5 * D, hipY, legB.jx, legB.jy, legB.ex, legB.ey - 4, 14, shade(col.secondary, 0.75));
  blob(ctx, legB.ex + 4 * D, legB.ey - 4, 12, 6.5, shade(col.accent, 0.7));

  // Torso.
  limb(ctx, hipX, hipY - 4, (hipX + shX) / 2, (hipY + shY) / 2, shX, shY + 4, 32, col.primary);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = col.accent; // belt
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(hipX - 17, hipY - 6);
  ctx.lineTo(hipX + 17, hipY - 6);
  ctx.stroke();
  ctx.strokeStyle = shade(col.primary, 0.62); // lapel
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(shX + 8 * D, shY + 4);
  ctx.lineTo(hipX - 4 * D, hipY - 12);
  ctx.stroke();

  limb(ctx, hipX + 5 * D, hipY, legF.jx, legF.jy, legF.ex, legF.ey - 4, 15, col.secondary);
  blob(ctx, legF.ex + 4 * D, legF.ey - 4, 12.5, 7, col.accent);

  // Head: the member's picture inside a coloured ring.
  const head = heads.get(char.id);
  ctx.beginPath();
  ctx.arc(hdX, hdY, LEN.head + 4, 0, Math.PI * 2);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hdX, hdY, LEN.head + 1.5, 0, Math.PI * 2);
  ctx.fillStyle = col.accent;
  ctx.fill();
  if (head) {
    ctx.save();
    ctx.translate(hdX, hdY);
    ctx.rotate((p.lean + p.tilt) * 0.35 * D);
    ctx.drawImage(head, -LEN.head + 1.5, -LEN.head + 1.5, (LEN.head - 1.5) * 2, (LEN.head - 1.5) * 2);
    ctx.restore();
  }

  limb(ctx, shX + 7 * D, shY + 6, armF.jx, armF.jy, armF.ex, armF.ey, 11, col.skin);
  blob(ctx, armF.ex, armF.ey, 9, 9, col.accent);

  ctx.restore();
}

export function drawProjectile(ctx, p, char, now) {
  const col = char.colors;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dir = Math.sign(p.vx);
  for (let i = 5; i >= 0; i--) {
    const x = p.x - dir * i * 12;
    const r = 20 - i * 2.6;
    const g = ctx.createRadialGradient(x, p.y, 1, x, p.y, r * 1.8);
    g.addColorStop(0, i === 0 ? '#ffffff' : col.glow);
    g.addColorStop(0.4, col.glow);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 1 - i * 0.15;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, p.y, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Crackling arcs around the core.
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = col.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = now / 60 + i * 2.1;
    ctx.moveTo(p.x + Math.cos(a) * 8, p.y + Math.sin(a) * 8);
    ctx.lineTo(p.x + Math.cos(a + 0.5) * 24, p.y + Math.sin(a + 0.9) * 22);
  }
  ctx.stroke();
  ctx.restore();
}
