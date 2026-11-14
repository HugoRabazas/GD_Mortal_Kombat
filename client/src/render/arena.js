// The arena backdrop: a moonlit courtyard. Everything that never changes is
// painted once into an off-screen canvas; only the torches and drifting embers
// are redrawn each frame.

import { ARENA } from '../../../shared/constants.js';

const { W, H } = ARENA;
const FLOOR = 372; // where the middle of the fighting floor sits on the flat backdrop
const TORCHES = [150, 810];
const HORIZON = FLOOR - 46;

let backdrop = null;
const embers = [];

// Tiny repeatable random so the scenery looks the same on every screen.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function ridge(g, rand, baseY, height, color, step) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, H);
  let y = baseY - rand() * height;
  for (let x = 0; x <= W + step; x += step) {
    g.lineTo(x, y);
    y = baseY - rand() * height;
  }
  g.lineTo(W, H);
  g.closePath();
  g.fill();
}

function banner(g, x, y, w, h, color) {
  g.fillStyle = '#0c0910';
  g.fillRect(x - 3, y - 8, w + 6, 8);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h);
  g.lineTo(x + w / 2, y + h - 18);
  g.lineTo(x, y + h);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,214,130,0.75)';
  g.lineWidth = 2;
  g.strokeRect(x + 5, y + 5, w - 10, h - 34);
  g.fillStyle = 'rgba(255,224,160,0.92)';
  g.font = 'italic 900 30px Teko, Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('GD', x + w / 2, y + (h - 30) / 2 + 4);
}

function paintBackdrop() {
  const c = document.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  const rand = seeded(7);

  // Sky.
  const sky = g.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#0b0714');
  sky.addColorStop(0.45, '#2a0f2e');
  sky.addColorStop(0.8, '#7a1c2c');
  sky.addColorStop(1, '#d1542b');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, HORIZON + 2);

  // Stars.
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,235,220,${0.25 + rand() * 0.6})`;
    const r = rand() * 1.2 + 0.3;
    g.beginPath();
    g.arc(rand() * W, rand() * 230, r, 0, Math.PI * 2);
    g.fill();
  }

  // Moon with a soft halo.
  const mx = 690;
  const my = 150;
  const halo = g.createRadialGradient(mx, my, 40, mx, my, 240);
  halo.addColorStop(0, 'rgba(255,170,120,0.55)');
  halo.addColorStop(1, 'rgba(255,120,80,0)');
  g.fillStyle = halo;
  g.fillRect(mx - 250, my - 250, 500, 500);
  const moon = g.createRadialGradient(mx - 20, my - 20, 10, mx, my, 86);
  moon.addColorStop(0, '#fff3dc');
  moon.addColorStop(1, '#f2a56b');
  g.fillStyle = moon;
  g.beginPath();
  g.arc(mx, my, 84, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(190,100,70,0.22)';
  for (const [dx, dy, r] of [[-28, -18, 16], [22, 10, 22], [-8, 36, 11], [34, -34, 9]]) {
    g.beginPath();
    g.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
    g.fill();
  }

  // Mountains, far to near.
  ridge(g, rand, HORIZON - 40, 110, '#3b1430', 60);
  ridge(g, rand, HORIZON - 10, 70, '#260d22', 44);

  // Courtyard wall with pillars.
  const wallTop = HORIZON - 118;
  const wall = g.createLinearGradient(0, wallTop, 0, HORIZON);
  wall.addColorStop(0, '#1d1220');
  wall.addColorStop(1, '#120b15');
  g.fillStyle = wall;
  g.fillRect(0, wallTop, W, HORIZON - wallTop);
  g.fillStyle = '#2a1a2b';
  g.fillRect(0, wallTop - 10, W, 12);
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = wallTop + 18; y < HORIZON; y += 22) g.fillRect(0, y, W, 1);
  for (let x = 30; x < W; x += 150) {
    g.fillStyle = '#241626';
    g.fillRect(x, wallTop - 34, 34, HORIZON - wallTop + 34);
    g.fillStyle = '#34203a';
    g.fillRect(x - 6, wallTop - 42, 46, 10);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 24, wallTop - 32, 10, HORIZON - wallTop + 32);
  }

  // Alliance banners.
  banner(g, 262, wallTop - 4, 66, 112, '#8c1226');
  banner(g, 632, wallTop - 4, 66, 112, '#8c1226');

  // Torch posts (the flames are drawn live).
  for (const x of TORCHES) {
    g.fillStyle = '#0d090f';
    g.fillRect(x - 4, HORIZON - 150, 8, 150);
    g.fillStyle = '#3a2a22';
    g.beginPath();
    g.moveTo(x - 16, HORIZON - 162);
    g.lineTo(x + 16, HORIZON - 162);
    g.lineTo(x + 9, HORIZON - 146);
    g.lineTo(x - 9, HORIZON - 146);
    g.closePath();
    g.fill();
  }

  // Stone floor with perspective lines.
  const floor = g.createLinearGradient(0, HORIZON, 0, H);
  floor.addColorStop(0, '#2b1b2a');
  floor.addColorStop(0.35, '#3a2533');
  floor.addColorStop(1, '#170e18');
  g.fillStyle = floor;
  g.fillRect(0, HORIZON, W, H - HORIZON);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1.5;
  const vx = W / 2;
  for (let i = -14; i <= 14; i++) {
    g.beginPath();
    g.moveTo(vx + i * 44, HORIZON);
    g.lineTo(vx + i * 150, H);
    g.stroke();
  }
  let y = HORIZON;
  let gap = 9;
  while (y < H) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    y += gap;
    gap *= 1.45;
  }
  // Moonlight pooling on the floor.
  const pool = g.createRadialGradient(W / 2, FLOOR + 6, 20, W / 2, FLOOR + 6, 520);
  pool.addColorStop(0, 'rgba(255,150,110,0.20)');
  pool.addColorStop(1, 'rgba(255,150,110,0)');
  g.fillStyle = pool;
  g.fillRect(0, HORIZON, W, H - HORIZON);
  g.fillStyle = 'rgba(255,190,150,0.35)';
  g.fillRect(0, HORIZON, W, 1.5);

  // Darkened edges pull the eye to the centre.
  const vig = g.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 620);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
  return c;
}

export function drawArena(ctx, now, theme) {
  if (!backdrop) backdrop = paintBackdrop();
  ctx.drawImage(backdrop, 0, 0, W, H);

  // Torch flames.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const x of TORCHES) {
    const y = HORIZON - 166;
    const flick = Math.sin(now / 90 + x) * 3 + Math.sin(now / 37 + x * 2) * 2;
    const glow = ctx.createRadialGradient(x, y, 4, x, y, 120 + flick * 3);
    glow.addColorStop(0, 'rgba(255,170,70,0.5)');
    glow.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 130, y - 130, 260, 260);
    for (const [w, h, color] of [[13, 34, 'rgba(255,110,30,0.9)'], [8, 22, 'rgba(255,200,90,0.95)'], [4, 12, 'rgba(255,250,220,0.95)']]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w, y - h * 0.6, x + flick * 0.6, y - h - flick);
      ctx.quadraticCurveTo(x + w, y - h * 0.6, x + w, y);
      ctx.quadraticCurveTo(x, y + 8, x - w, y);
      ctx.fill();
    }
  }

  // Embers drifting up.
  if (embers.length < 26 && Math.random() < 0.3) {
    const x = TORCHES[Math.floor(Math.random() * TORCHES.length)];
    embers.push({ x: x + (Math.random() - 0.5) * 16, y: HORIZON - 180, vx: (Math.random() - 0.5) * 0.5, vy: -0.4 - Math.random() * 0.8, life: 1 });
  }
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.x += e.vx + Math.sin(now / 400 + i) * 0.25;
    e.y += e.vy;
    e.life -= 0.006;
    if (e.life <= 0) {
      embers.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(255,${150 + Math.floor(e.life * 80)},70,${e.life * 0.9})`;
    ctx.fillRect(e.x, e.y, 2, 2);
  }
  ctx.restore();

  // The frozen arena is the same picture with every colour turned to ice.
  if (theme === 'frost') {
    ctx.save();
    ctx.globalCompositeOperation = 'hue';
    ctx.fillStyle = '#2f86d8';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
