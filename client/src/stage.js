// The stage puts a frame on screen. It layers two canvases: the WebGL canvas
// with the 3D arena underneath, and a flat canvas on top for the HUD, the
// announcer banners and the finisher cut-in. If the device has no WebGL the
// flat canvas draws the whole fight on a painted 2D backdrop instead.

import { ARENA, TIMING } from '../../shared/constants.js';
import { getFighter } from '../../shared/fighters.js';
import { heads } from './assets.js';
import { create3D } from './render/scene3d.js';
import { drawArena } from './render/arena.js';
import { drawFighter, drawProjectile, resetPoses } from './render/fighter.js';
import { updateFx, drawFx, drawOverlays, resetFx } from './render/fx.js';
import { drawHud, resetHud } from './render/hud.js';

const { W, H } = ARENA;
const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// The dramatic pause before a finisher: the screen dims and the attacker's
// portrait slides across with the move's name.
function finisherCutIn(ctx, s) {
  if (s.freeze <= 0 || s.freezeBy < 0) return;
  const k = 1 - s.freeze / TIMING.SUPER_FREEZE;
  const f = s.f[s.freezeBy];
  const char = getFighter(f.char);
  const side = f.slot === 0 ? -1 : 1; // which edge the portrait enters from
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

export function createStage(glCanvas, hudCanvas) {
  const three = create3D(glCanvas);
  if (!three) glCanvas.hidden = true;
  const ctx = hudCanvas.getContext('2d');
  let scale = 1;

  return {
    is3D: !!three,

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

    // view = { state, demo, labels }
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
        drawArena(ctx, now);
        const mirror = s.f[0].char === s.f[1].char;
        const order = s.f[1].state === 'attack' || s.f[1].state === 'airAttack' ? [0, 1] : [1, 0];
        for (const i of order) drawFighter(ctx, s.f[i], getFighter(s.f[i].char), now, mirror && i === 1);
        for (const p of s.proj) drawProjectile(ctx, p, getFighter(p.char), now);
        drawFx(ctx);
        ctx.restore();
      }

      if (!view.demo) {
        finisherCutIn(ctx, s);
        drawHud(ctx, s, view.labels, now);
      }
      drawOverlays(ctx, W, H);
    },
  };
}
