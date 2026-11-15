// The stage puts a frame on screen. It layers two canvases: the WebGL canvas
// with the 3D arena underneath, and a flat canvas on top for the HUD, hit
// sparks, name tags, announcer banners and the finisher cut-in. If the device
// has no WebGL the flat canvas draws the whole fight on a painted backdrop.

import { ARENA, TIMING } from '../../shared/constants.js';
import { getFighter } from '../../shared/fighters.js';
import { heads } from './assets.js';
import { create3D } from './render/scene3d.js';
import { drawArena } from './render/arena.js';
import { drawFighter, drawProjectile, resetPoses } from './render/fighter.js';
import { updateFx, drawFx, drawOverlays, resetFx } from './render/fx.js';
import { drawHud, drawTags, resetHud } from './render/hud.js';

const { W, H } = ARENA;
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The flat fallback's view of the arena: a simple slanted look from above.
const flat = (x, h, z) => ({ x: W / 2 + x * 0.62, y: 372 + z * 0.24 - h * 0.8, k: 1 + z / 2400 });

// The dramatic pause before a finisher: the screen dims and the attacker's
// portrait slides across with the move's name.
function finisherCutIn(ctx, s) {
  if (s.freeze <= 0 || s.freezeBy < 0) return;
  const k = 1 - s.freeze / TIMING.SUPER_FREEZE;
  const f = s.f[s.freezeBy];
  const char = getFighter(f.char);
  const side = f.slot % 2 === 0 ? -1 : 1; // which edge the portrait enters from
  const slide = 1 - Math.pow(1 - Math.min(1, k * 2.6), 3);

  ctx.save();
  ctx.fillStyle = `rgba(6,3,10,${0.55 * Math.min(1, k * 5)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * 0.47);
  ctx.rotate(-0.09 * side);
  const band = ctx.createLinearGradient(0, -74, 0, 74);
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(0.12, char.colors.glow);
  band.addColorStop(0.5, char.colors.primary);
  band.addColorStop(0.88, char.colors.glow);
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
  ctx.fillStyle = char.colors.accent;
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
// portrait and name, so everyone knows who is who before the bell.
function lineUp(ctx, s, labels) {
  if (s.round !== 1 || s.phase !== 'intro' || s.pt > 70) return;
  const fade = Math.min(1, s.pt / 10, (70 - s.pt) / 10);
  const n = s.f.length;
  const r = n > 2 ? 42 : 56;
  const gap = n > 2 ? 190 : 380;
  const y = 388;
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
    ctx.fillStyle = char.colors.accent;
    ctx.fill();
    const head = heads.get(char.id);
    if (head) ctx.drawImage(head, x - r + 3, y - r + 3, (r - 3) * 2, (r - 3) * 2);
    ctx.font = `italic 700 ${n > 2 ? 24 : 30}px Teko, Impact, "Arial Black", sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#0b070d';
    ctx.strokeText(char.name, x, y + r + 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(char.name, x, y + r + 20);
    if (labels[f.slot]) {
      ctx.font = '700 11px Barlow, system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeText(labels[f.slot], x, y + r + 40);
      ctx.fillStyle = '#e8b454';
      ctx.fillText(labels[f.slot], x, y + r + 40);
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

export function createStage(glCanvas, hudCanvas) {
  const three = create3D(glCanvas);
  if (!three) glCanvas.hidden = true;
  const ctx = hudCanvas.getContext('2d');
  let scale = 1;

  const project = three ? three.project : flat;

  return {
    is3D: !!three,
    project,
    stats: () => three?.stats() ?? null,

    resize(cssW, cssH) {
      const dpr = window.devicePixelRatio || 1;
      scale = Math.max(0.5, Math.min(2.5, (cssW * dpr) / W));
      hudCanvas.width = Math.round(W * scale);
      hudCanvas.height = Math.round(H * scale);
      three?.resize(cssW, cssH, dpr);
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
      const shake = updateFx();
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
        const seen = new Set();
        const alts = s.f.map((f) => {
          const alt = seen.has(f.char);
          seen.add(f.char);
          return alt;
        });
        for (const f of [...s.f].sort((a, b) => a.z - b.z)) {
          const p = flat(f.x, 0, f.z);
          drawFighter(ctx, f, getFighter(f.char), now, { sx: p.x, sy: p.y, facing: Math.cos(f.dir) >= 0 ? 1 : -1, lift: f.h * 0.8, scale: 0.7 * p.k, alt: alts[f.slot] });
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

      // Sparks, dust and damage numbers sit on the flat layer in both views.
      drawFx(ctx);

      if (!view.demo) {
        const spots = s.f.map((f) => project(f.x, f.h + (three ? three.headTop(f.slot) * 100 - f.h : 150), f.z));
        drawTags(ctx, s, spots, view.labels);
        finisherCutIn(ctx, s);
        drawHud(ctx, s, view.labels, now);
        lineUp(ctx, s, view.labels);
        // A reminder of the controls while the first round is being announced.
        if (view.hint && (view.hintAlways || (s.round === 1 && s.phase === 'intro' && s.pt > 70))) {
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
        // Knocked out of a brawl that is still going: say so, and keep watching.
        if (view.me >= 0 && s.f.length > 2 && s.phase === 'fight' && s.f[view.me].hp <= 0) {
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'italic 700 30px Teko, Impact, "Arial Black", sans-serif';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 6;
          ctx.strokeStyle = '#0b070d';
          ctx.strokeText('YOU ARE OUT · WATCHING THE REST', W / 2, H - 78);
          ctx.fillStyle = '#ff8a5c';
          ctx.fillText('YOU ARE OUT · WATCHING THE REST', W / 2, H - 78);
          ctx.restore();
        }
      }
      drawOverlays(ctx, W, H);
    },
  };
}
