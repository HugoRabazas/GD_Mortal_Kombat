// The stage puts a frame on screen. It layers two canvases: the WebGL canvas
// with the 3D arena underneath, and a flat canvas on top for the HUD, hit
// sparks, name tags, announcer banners and the finisher cut-in. If the device
// has no WebGL the flat canvas draws the whole fight on a painted backdrop.

import { ARENA, TIMING } from '../../shared/constants.js';
import { getFighter, dressLineUp, dressColors } from '../../shared/fighters.js';
import { heads } from './assets.js';
import { create3D } from './render/scene3d.js';
import { drawArena, useFlatPhotos } from './render/arena.js';
import stoneUrl from './render/tex/stone_diff.jpg';
import wallUrl from './render/tex/wall_diff.jpg';

useFlatPhotos({ stone: stoneUrl, wall: wallUrl });
import { drawFighter, drawProjectile, resetPoses, setAnnounce } from './render/fighter.js';
import { updateFx, drawFx, drawOverlays, resetFx } from './render/fx.js';
import { drawHud, drawTags, resetHud } from './render/hud.js';

const { W, H } = ARENA;
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The flat fallback's view of the arena: a simple slanted look from above.
const flat = (x, h, z) => ({ x: W / 2 + x * 0.62, y: 372 + z * 0.24 - h * 0.8, k: 1 + z / 2400 });

// Behind each finisher's cut-in, a scene of its own while the world holds
// still: Ruko's red moon rising, Shadow's eclipse, Jackie's avalanche,
// Pixie's bird of flame. `k` runs from 0 to 1 over the freeze.
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
function ultBackdrop(ctx, move, k, col) {
  ctx.save();
  if (move === 'howl') {
    const rise = ease(k * 1.5);
    const cx = W * 0.5;
    const cy = H * 1.15 - rise * H * 0.72;
    const r = 170 + rise * 30;
    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.2);
    glow.addColorStop(0, 'rgba(255,60,40,0.55)');
    glow.addColorStop(1, 'rgba(120,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    const moon = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    moon.addColorStop(0, '#ffd2c0');
    moon.addColorStop(0.45, '#ff5a3c');
    moon.addColorStop(1, '#8c0d14');
    ctx.fillStyle = moon;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(110,8,16,0.35)'; // craters
    for (const [dx, dy, cr] of [[-0.35, -0.2, 0.18], [0.3, 0.1, 0.12], [0.05, 0.42, 0.1], [-0.1, 0.05, 0.07], [0.42, -0.36, 0.08]]) {
      ctx.beginPath();
      ctx.arc(cx + dx * r, cy + dy * r, cr * r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (move === 'oath') {
    // Meru's oath: a great iron shield rising, cracks of light spreading.
    const up = ease(k * 1.4);
    const cx = W * 0.5;
    const cy = H * 0.95 - up * H * 0.55;
    ctx.translate(cx, cy);
    ctx.scale(0.8 + up * 0.4, 0.8 + up * 0.4);
    ctx.beginPath();
    ctx.moveTo(0, -150);
    ctx.quadraticCurveTo(130, -140, 130, -40);
    ctx.quadraticCurveTo(120, 90, 0, 160);
    ctx.quadraticCurveTo(-120, 90, -130, -40);
    ctx.quadraticCurveTo(-130, -140, 0, -150);
    const iron = ctx.createLinearGradient(0, -150, 0, 160);
    iron.addColorStop(0, '#9fb3ad');
    iron.addColorStop(1, '#2c3a36');
    ctx.fillStyle = iron;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#d8b46a';
    ctx.stroke();
    ctx.strokeStyle = `rgba(150,255,210,${0.9 * up})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      let a = (i / 7) * Math.PI * 2 + 0.3;
      let x = 0;
      let y = 0;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let j = 0; j < 4 * up; j++) {
        a += Math.sin(i * 5 + j * 3) * 0.5;
        x += Math.cos(a) * 30;
        y += Math.sin(a) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (move === 'crescent') {
    // Gleh's crescent moon, and a rain of light falling past it.
    const up = ease(k * 1.4);
    const cx = W * 0.5;
    const cy = H * 0.3 + (1 - up) * 140;
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, cy, 20, cx, cy, 260);
    halo.addColorStop(0, 'rgba(200,170,255,0.55)');
    halo.addColorStop(1, 'rgba(80,40,160,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4ecff';
    ctx.beginPath();
    ctx.arc(cx, cy, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(6,3,10,0.92)';
    ctx.beginPath();
    ctx.arc(cx + 50, cy - 26, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,200,255,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const x = ((i * 97.7) % W);
      const y = ((i * 61 + k * 1400) % (H + 80)) - 40;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 10, y - 46);
      ctx.stroke();
    }
  } else if (move === 'cuts') {
    // Kichta's thousand cuts: slashes of gold flashing across the screen.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const n = Math.floor(4 + k * 26);
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996;
      const cx = W / 2 + Math.cos(a * 1.7) * W * 0.35;
      const cy = H / 2 + Math.sin(a * 1.3) * H * 0.3;
      const len = 120 + (i % 5) * 40;
      const fade = Math.max(0.15, 1 - (n - i) / 14);
      ctx.strokeStyle = `rgba(255,${200 + (i % 3) * 20},90,${fade})`;
      ctx.lineWidth = 2 + (i % 3) * 2;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(a) * len, cy - Math.sin(a) * len);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
  } else if (move === 'sunburst') {
    // Zelrith's sun: a blazing ball rising, rays turning round it.
    const up = ease(k * 1.4);
    const cx = W * 0.5;
    const cy = H * 0.85 - up * H * 0.5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.rotate(k * 1.5);
    for (let i = 0; i < 16; i++) {
      ctx.rotate(Math.PI / 8);
      ctx.fillStyle = `rgba(255,${200 + (i % 2) * 40},80,0.45)`;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(0, -(260 + (i % 3) * 60) * up);
      ctx.lineTo(14, 0);
      ctx.fill();
    }
    const sun = ctx.createRadialGradient(0, 0, 10, 0, 0, 120);
    sun.addColorStop(0, '#fffbe0');
    sun.addColorStop(0.5, '#ffe066');
    sun.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(0, 0, 120, 0, Math.PI * 2);
    ctx.fill();
  } else if (move === 'eclipse') {
    ctx.fillStyle = `rgba(4,0,10,${0.4 * ease(k * 2)})`;
    ctx.fillRect(0, 0, W, H);
    const cx = W * 0.5;
    const cy = H * 0.3;
    const r = 120;
    const cover = ease(k * 1.4);
    // The corona flares as the dark disc covers the sun.
    ctx.globalCompositeOperation = 'lighter';
    const corona = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * (1.6 + cover));
    corona.addColorStop(0, `rgba(190,120,255,${0.9 * cover})`);
    corona.addColorStop(1, 'rgba(80,0,160,0)');
    ctx.fillStyle = corona;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(220,180,255,${0.5 * cover})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + k * 0.8;
      const len = r * (1.25 + 0.35 * ((i * 7) % 3));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#f4e8ff';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05010b';
    ctx.beginPath();
    ctx.arc(cx + (1 - cover) * r * 2.1, cy - (1 - cover) * r * 0.3, r * 1.01, 0, Math.PI * 2);
    ctx.fill();
  } else if (move === 'avalanche') {
    // Snow and rock pouring down the screen, the whole frame shaking.
    const shake = Math.sin(k * 90) * 6 * (1 - k * 0.5);
    ctx.translate(shake, Math.cos(k * 77) * 4);
    const haze = ctx.createLinearGradient(0, H * 0.4, 0, H);
    haze.addColorStop(0, 'rgba(230,240,255,0)');
    haze.addColorStop(1, `rgba(230,240,255,${0.45 * ease(k * 2)})`);
    ctx.fillStyle = haze;
    ctx.fillRect(-20, 0, W + 40, H);
    ctx.strokeStyle = 'rgba(245,250,255,0.75)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const speed = 0.7 + (i % 5) * 0.18;
      const x = ((i * 137.5) % (W + 300)) - 150 + k * 260 * speed;
      const y = (((i * 53.7 + k * 1100 * speed) % (H + 120)) - 60);
      ctx.lineWidth = 1.5 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 14 * speed, y - 26 * speed);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const t = (k * 1.3 + i / 12) % 1;
      const x = -60 + t * (W + 120) * 0.7 + (i % 4) * 90;
      const y = -40 + t * (H + 80);
      const r = 10 + (i % 4) * 7;
      ctx.fillStyle = i % 2 ? '#8d8f99' : '#6b6d78';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (move === 'phoenix') {
    // A bird of flame rising, wings beating, embers falling off it.
    const up = ease(k * 1.3);
    const cx = W * 0.5;
    const cy = H * 0.62 - up * H * 0.3;
    const sc = 0.6 + up * 0.7;
    const flap = Math.sin(k * 26) * 0.35;
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 300 * sc);
    halo.addColorStop(0, 'rgba(255,200,80,0.6)');
    halo.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    const fire = ctx.createLinearGradient(0, -120, 0, 160);
    fire.addColorStop(0, '#fff3b0');
    fire.addColorStop(0.4, '#ffb020');
    fire.addColorStop(1, 'rgba(255,40,0,0.2)');
    ctx.fillStyle = fire;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(-flap);
      ctx.beginPath();
      ctx.moveTo(10, -10);
      ctx.bezierCurveTo(80, -110, 200, -120, 290, -60);
      ctx.bezierCurveTo(220, -50, 240, -10, 170, 0);
      ctx.bezierCurveTo(200, 20, 140, 40, 100, 30);
      ctx.bezierCurveTo(70, 40, 30, 30, 10, 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); // body, head and a long forked tail
    ctx.ellipse(0, 10, 26, 60, 0, 0, Math.PI * 2);
    ctx.moveTo(0, -60);
    ctx.arc(0, -66, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 60);
    ctx.quadraticCurveTo(-60, 150, -30, 200);
    ctx.quadraticCurveTo(0, 130, 0, 90);
    ctx.quadraticCurveTo(0, 130, 30, 200);
    ctx.quadraticCurveTo(60, 150, 14, 60);
    ctx.fill();
    ctx.restore();
    for (let i = 0; i < 40; i++) {
      const x = cx + (((i * 97.3) % 520) - 260) * sc;
      const y = cy + 80 + ((i * 41 + k * 600) % 300);
      ctx.fillStyle = `rgba(255,${150 + (i % 4) * 25},40,${0.8 - ((i * 41 + k * 600) % 300) / 380})`;
      ctx.beginPath();
      ctx.arc(x, y, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// A finisher's last blow: the frame darkens at the edges and speed lines
// burst from the centre while the camera closes in.
function finaleOverlay(ctx, s, worn) {
  if (!(s.finale > 0) || s.finaleOn < 0) return;
  const k = 1 - s.finale / 48;
  const a = Math.min(1, (1 - k) * 2.2);
  ctx.save();
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${0.7 * a})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = `rgba(255,255,255,${0.35 * a})`;
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2 + i * 0.37;
    const r0 = W * (0.32 + ((i * 13) % 7) * 0.025) + k * 60;
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(ang) * r0, H / 2 + Math.sin(ang) * r0 * 0.6);
    ctx.lineTo(W / 2 + Math.cos(ang) * W, H / 2 + Math.sin(ang) * W * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

// The dramatic pause before a finisher: the screen dims and the attacker's
// portrait slides across with the move's name.
function finisherCutIn(ctx, s, worn) {
  if (s.freeze <= 0 || s.freezeBy < 0) return;
  const k = 1 - s.freeze / TIMING.SUPER_FREEZE;
  const f = s.f[s.freezeBy];
  const char = getFighter(f.char);
  const col = worn[f.slot]; // in the costume being worn
  const side = f.slot % 2 === 0 ? -1 : 1; // which edge the portrait enters from
  const slide = 1 - Math.pow(1 - Math.min(1, k * 2.6), 3);

  ctx.save();
  ctx.fillStyle = `rgba(6,3,10,${0.55 * Math.min(1, k * 5)})`;
  ctx.fillRect(0, 0, W, H);
  if (!calm) ultBackdrop(ctx, char.super.move, k, col);
  ctx.translate(W / 2, H * 0.47);
  ctx.rotate(-0.09 * side);
  const band = ctx.createLinearGradient(0, -74, 0, 74);
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(0.12, col.glow);
  band.addColorStop(0.5, col.primary);
  band.addColorStop(0.88, col.glow);
  band.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.9 * slide;
  ctx.fillStyle = band;
  ctx.fillRect(-W, -74, W * 2, 148);
  ctx.globalAlpha = 1;

  const px = side * (W / 2 + 140) * (1 - slide) + side * 300 * slide;
  ctx.beginPath();
  ctx.arc(px, 0, 96, 0, Math.PI * 2);
  ctx.fillStyle = '#0b070d';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, 0, 90, 0, Math.PI * 2);
  ctx.fillStyle = col.accent;
  ctx.fill();
  const head = heads.get(char.id);
  if (head) ctx.drawImage(head, px - 84, -84, 168, 168);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = slide;
  ctx.font = 'italic 700 64px Teko, Impact, "Arial Black", sans-serif';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#0b070d';
  const tx = -side * 110;
  ctx.strokeText(char.super.name.toUpperCase(), tx, 4);
  ctx.fillStyle = '#fff6dc';
  ctx.fillText(char.super.name.toUpperCase(), tx, 4);
  ctx.font = '700 15px Barlow, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`${char.name}  ·  FINISHER`, tx, -44);
  ctx.restore();
}

// The line-up shown while the first round is announced: every fighter's
// portrait and name, so everyone knows who is who before the bell - and in
// a duel, each fighter's challenge.
// With the on-screen controls in the bottom corners (`clear`), it sits
// higher and closer in, clear of the buttons, and a duel's challenges go
// under the titles (the YOU / CPU tags are on the bars above anyway).
function lineUp(ctx, s, labels, worn, clear) {
  if (s.round !== 1 || s.phase !== 'intro' || s.pt > 70) return;
  const fade = Math.min(1, s.pt / 10, (70 - s.pt) / 10);
  const n = s.f.length;
  const r = n > 2 ? (clear ? 36 : 42) : clear ? 50 : 56;
  const gap = n > 2 ? (clear ? 128 : 190) : clear ? 260 : 380;
  const y = clear ? (n > 2 ? 314 : 292) : 388;
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const f of s.f) {
    const char = getFighter(f.char);
    // Portraits slide in from the sides.
    const x = W / 2 + (f.slot - (n - 1) / 2) * gap + (f.slot < n / 2 ? -1 : 1) * (1 - Math.min(1, s.pt / 14)) * 120;
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.fillStyle = '#0b070d';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = worn[f.slot].accent;
    ctx.fill();
    const head = heads.get(char.id);
    if (head) ctx.drawImage(head, x - r + 3, y - r + 3, (r - 3) * 2, (r - 3) * 2);
    ctx.font = `italic 700 ${n > 2 ? 24 : 30}px Teko, Impact, "Arial Black", sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#0b070d';
    ctx.strokeText(char.name, x, y + r + 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(char.name, x, y + r + 20);
    // The fighter's title.
    ctx.font = `italic 600 ${n > 2 ? 11 : 13}px Barlow, system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeText(char.title, x, y + r + 39, gap - 16);
    ctx.fillStyle = '#f3d9a8';
    ctx.fillText(char.title, x, y + r + 39, gap - 16);
    // In a duel, the fighter's challenge above the portrait (under the title
    // when the controls are showing).
    if (n === 2 && char.challenge) {
      const cy = clear ? y + r + 57 : y - r - 18;
      ctx.font = `italic 600 ${clear ? 14 : 15}px Barlow, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeText(`\u201c${char.challenge}\u201d`, x, cy, gap - 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`\u201c${char.challenge}\u201d`, x, cy, gap - 10);
    }
    if (labels[f.slot] && !(clear && n === 2)) {
      ctx.font = '700 11px Barlow, system-ui, sans-serif';
      ctx.strokeText(labels[f.slot], x, y + r + 56);
      ctx.fillStyle = '#e8b454';
      ctx.fillText(labels[f.slot], x, y + r + 56);
    }
  }
  if (n === 2) {
    ctx.font = 'italic 700 54px Teko, Impact, "Arial Black", sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#0b070d';
    ctx.strokeText('VS', W / 2, y + 4);
    ctx.fillStyle = '#ff5a36';
    ctx.fillText('VS', W / 2, y + 4);
  }
  ctx.restore();
}

// Reeling from a perfect guard (the moment to punish): three small stars
// circle above the head until the fighter recovers.
// `headAt(f, back)` is where the head's crown lands on screen with the body
// leaning `back` arena pixels away from where it faces (a reeling fighter
// sways back on the heels).
function dizzyStars(ctx, s, headAt, now) {
  for (const f of s.f) {
    if (f.reel <= 0 || f.hp <= 0) continue;
    const p = headAt(f, 26);
    const fade = Math.min(1, f.reel / 6);
    for (let i = 0; i < 3; i++) {
      const a = now / 140 + (i * Math.PI * 2) / 3;
      const x = p.x + Math.cos(a) * 24;
      const y = p.y + 12 + Math.sin(a) * 7; // round the crown of the head
      const front = Math.sin(a) > 0; // the near side of the circle is brighter
      ctx.save();
      ctx.globalAlpha = fade * (front ? 1 : 0.55);
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 3 : 7.5;
        const t = (k / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r);
      }
      ctx.closePath();
      ctx.fillStyle = '#ffd34d';
      ctx.strokeStyle = '#0b070d';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

export function createStage(glCanvas, hudCanvas) {
  const three = create3D(glCanvas);
  if (!three) glCanvas.hidden = true;
  const ctx = hudCanvas.getContext('2d');
  let scale = 1;
  let lastNow = 0; // when the last frame was drawn, for the effects' time step

  const project = three ? three.project : flat;

  return {
    is3D: !!three,
    project,
    stats: () => three?.stats() ?? null,
    setGraphics: (mode) => three?.setGraphics(mode),

    // fullW x fullH: how far the 3D arena may reach round the stage (it
    // fills a wide phone's sides; the HUD keeps to the stage).
    resize(cssW, cssH, fullW = cssW, fullH = cssH) {
      const dpr = window.devicePixelRatio || 1;
      scale = Math.max(0.5, Math.min(2.5, (cssW * dpr) / W));
      hudCanvas.width = Math.round(W * scale);
      hudCanvas.height = Math.round(H * scale);
      const wide = !!three && (fullW > cssW + 1 || fullH > cssH + 1);
      glCanvas.style.left = wide ? `${-(fullW - cssW) / 2}px` : '';
      glCanvas.style.top = wide ? `${-(fullH - cssH) / 2}px` : '';
      glCanvas.style.width = wide ? `${fullW}px` : '';
      glCanvas.style.height = wide ? `${fullH}px` : '';
      three?.resize(cssW, cssH, dpr, wide ? fullW : cssW, wide ? fullH : cssH);
      return wide;
    },

    // Call when a new fight starts so nothing carries over from the last one.
    reset() {
      resetPoses();
      resetFx();
      resetHud();
      three?.snapCamera();
    },

    // view = { state, demo, labels, boss, humans, me }
    render(view, now) {
      const s = view.state;
      const worn = dressColors(s.f.map((f) => f.char), view.looks);
      setAnnounce(s.phase === 'intro' && !view.demo ? s.pt : -1);
      const shake = updateFx(lastNow ? now - lastNow : undefined);
      lastNow = now;
      if (calm) {
        shake.x *= 0.25;
        shake.y *= 0.25;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, W, H);

      if (three) {
        three.render(view, now, shake);
      } else {
        ctx.save();
        ctx.translate(shake.x, shake.y);
        drawArena(ctx, now, view.theme);
        // Far fighters first, so nearer ones overlap them.
        const looks = dressLineUp(s.f.map((f) => f.char), view.looks);
        for (const f of [...s.f].sort((a, b) => a.z - b.z)) {
          const p = flat(f.x, 0, f.z);
          drawFighter(ctx, f, getFighter(f.char), now, { sx: p.x, sy: p.y, facing: Math.cos(f.dir) >= 0 ? 1 : -1, lift: f.h * 0.8, scale: 0.7 * p.k, look: looks[f.slot] });
        }
        for (const p of s.proj) {
          const q = flat(p.x, p.h, p.z);
          drawProjectile(ctx, q.x, q.y, getFighter(p.char));
        }
        for (const it of s.items) {
          const q = flat(it.x, 50, it.z);
          drawProjectile(ctx, q.x, q.y, { colors: { glow: it.kind === 'energy' ? '#ffd34d' : '#5dff8f' } });
        }
        ctx.restore();
      }

      // Sparks, dust and damage numbers sit on the flat layer in both views;
      // floating texts keep clear of the name tags over the fighters.
      const spots = view.demo ? [] : s.f.map((f) => project(f.x, f.h + (three ? three.headTop(f.slot) * 100 - f.h : 150), f.z));
      // Two fighters one over the other (a throw, a crowd): their tags would
      // print on top of each other, so the higher one steps up a line.
      const tagBox = (f) => { const p = spots[f.slot]; const k = Math.min(1.25, Math.max(0.7, p.k)); return { x: p.x, y: p.y - 8 * k, w: (view.labels[f.slot]?.length ?? 0) * 9 * k + 8, h: 26 * k }; };
      const settled = [];
      for (const f of s.f.filter((f) => spots[f.slot] && f.hp > 0 && view.labels?.[f.slot]).sort((a, b) => spots[b.slot].y - spots[a.slot].y)) {
        const p = spots[f.slot];
        for (let n = 0; n < 3; n++) {
          const me = tagBox(f);
          if (!settled.some((o) => Math.abs(o.x - me.x) * 2 < o.w + me.w && Math.abs(o.y - me.y) * 2 < o.h + me.h)) break;
          spots[f.slot] = { ...p, y: spots[f.slot].y - me.h * 0.8 };
        }
        settled.push(tagBox(f));
      }
      const tagged = !view.demo && !view.photo && !view.noTags && s.phase !== 'over';
      const avoid = tagged ? settled : [];
      // ...and the YOU ARE OUT line of a brawl (drawn below).
      const out = view.me >= 0 && s.f.length > 2 && s.phase === 'fight' && s.f[view.me]?.hp <= 0;
      if (out) avoid.push({ x: W / 2, y: view.clearCorners ? 128 : H - 78, w: 440, h: 36 });
      drawFx(ctx, !!view.clearCorners, avoid);

      // (A photo shows the scene alone: no bars, tags or captions.)
      if (!view.demo && !view.photo) {
        if (!view.noTags) drawTags(ctx, s, spots, view.labels);
        dizzyStars(ctx, s, (f, back) => project(f.x - Math.cos(f.dir) * back, three ? three.headTop(f.slot) * 100 : 150, f.z - Math.sin(f.dir) * back), now);
        finaleOverlay(ctx, s, worn);
        finisherCutIn(ctx, s, worn);
        drawHud(ctx, s, view.labels, now, worn, view.clearCorners);
        lineUp(ctx, s, view.labels, worn, !!view.clearCorners);
        // A reminder of the controls while the first round is being announced.
        // (Never on top of the line-up, which has the screen's lower half to itself.)
        const lineUpShown = s.round === 1 && s.phase === 'intro' && s.pt <= 70;
        if (view.hint && !lineUpShown && (view.hintAlways || (s.round === 1 && s.phase === 'intro'))) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '600 13px Barlow, system-ui, sans-serif';
          const w = Math.min(W - 40, ctx.measureText(view.hint).width + 36);
          ctx.fillStyle = 'rgba(10,6,12,0.78)';
          ctx.fillRect(W / 2 - w / 2, H - 76, w, 26);
          ctx.fillStyle = '#f6ead8';
          ctx.fillText(view.hint, W / 2, H - 62, W - 60);
          ctx.restore();
        }
        // Online: how the fight is reaching this screen, and how long the trip takes.
        if (view.net) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '700 10px Barlow, system-ui, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fillText(view.net, W / 2, 90);
          ctx.restore();
        }
        // Online, a fight standing still for a player who went quiet or left
        // the app: why, large in the middle (it would look frozen otherwise).
        if (view.wait) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.font = 'italic 700 34px Teko, Impact, "Arial Black", sans-serif';
          ctx.lineWidth = 6;
          ctx.strokeStyle = '#0b070d';
          ctx.strokeText(view.wait, W / 2, H / 2 - 30);
          ctx.fillStyle = '#ffd36a';
          ctx.fillText(view.wait, W / 2, H / 2 - 30);
          ctx.font = '600 14px Barlow, system-ui, sans-serif';
          ctx.lineWidth = 4;
          ctx.strokeText('The fight goes on when they are back', W / 2, H / 2);
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillText('The fight goes on when they are back', W / 2, H / 2);
          ctx.restore();
        }
        // Knocked out of a brawl that is still going: say so, and keep watching.
        if (view.me >= 0 && s.f.length > 2 && s.phase === 'fight' && s.f[view.me].hp <= 0) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'italic 700 30px Teko, Impact, "Arial Black", sans-serif';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 6;
          ctx.strokeStyle = '#0b070d';
          // (Under the bars at the top when the on-screen controls fill the
          // bottom corners: low down, it ran under GRAB.)
          const oy = view.clearCorners ? 128 : H - 78;
          ctx.strokeText('YOU ARE OUT · WATCHING THE REST', W / 2, oy);
          ctx.fillStyle = '#ff8a5c';
          ctx.fillText('YOU ARE OUT · WATCHING THE REST', W / 2, oy);
          ctx.restore();
        }
      }
      drawOverlays(ctx, W, H);
    },
  };
}
