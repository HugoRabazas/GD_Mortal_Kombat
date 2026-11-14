// The heads-up display: health bars, names, round markers, timer and the
// energy meters that pay for specials and finishers.

import { ARENA, RULES, TICK_RATE } from '../../../shared/constants.js';
import { getFighter } from '../../../shared/fighters.js';
import { heads } from '../assets.js';

const { W } = ARENA;
const FONT = 'Teko, Impact, "Arial Black", sans-serif';
const BAR_W = 340;
const ghost = [1, 1]; // the pale bar that trails behind real health

export function resetHud() {
  ghost[0] = ghost[1] = 1;
}

// A slanted bar. `side` 0 grows from the left edge inward, 1 mirrors it.
function slantBar(ctx, x, y, w, h, side) {
  const s = 10;
  ctx.beginPath();
  if (side === 0) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - s, y + h);
    ctx.lineTo(x, y + h);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x - w, y);
    ctx.lineTo(x - w + s, y + h);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
}

function outlined(ctx, text, x, y, fill) {
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b070d';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function playerPanel(ctx, s, side, label, now) {
  const f = s.f[side];
  const char = getFighter(f.char);
  const ratio = Math.max(0, f.hp / f.maxHp);
  ghost[side] = ratio < ghost[side] ? Math.max(ratio, ghost[side] - 0.006) : ratio;
  const edge = side === 0 ? 74 : W - 74;
  const dir = side === 0 ? 1 : -1;
  const y = 26;

  // Health bar: dark track, pale ghost, coloured health.
  slantBar(ctx, edge, y, BAR_W, 22, side);
  ctx.fillStyle = 'rgba(10,6,12,0.85)';
  ctx.fill();
  slantBar(ctx, edge, y, BAR_W * ghost[side], 22, side);
  ctx.fillStyle = '#f4e6c8';
  ctx.fill();
  slantBar(ctx, edge, y, BAR_W * ratio, 22, side);
  const low = ratio < 0.25;
  const grad = ctx.createLinearGradient(0, y, 0, y + 22);
  if (low && Math.floor(now / 160) % 2) {
    grad.addColorStop(0, '#ff8a6b');
    grad.addColorStop(1, '#c81e1e');
  } else {
    grad.addColorStop(0, ratio > 0.5 ? '#ffe37a' : '#ffb347');
    grad.addColorStop(1, ratio > 0.5 ? '#f08a1c' : '#e0531a');
  }
  ctx.fillStyle = grad;
  ctx.fill();
  slantBar(ctx, edge, y, BAR_W, 22, side);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#0b070d';
  ctx.stroke();

  // Portrait.
  const px = side === 0 ? 40 : W - 40;
  ctx.beginPath();
  ctx.arc(px, 40, 31, 0, Math.PI * 2);
  ctx.fillStyle = '#0b070d';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(px, 40, 28, 0, Math.PI * 2);
  ctx.fillStyle = char.colors.accent;
  ctx.fill();
  const head = heads.get(char.id);
  if (head) ctx.drawImage(head, px - 25, 15, 50, 50);

  // Names.
  ctx.textBaseline = 'middle';
  ctx.textAlign = side === 0 ? 'left' : 'right';
  ctx.font = `italic 900 20px ${FONT}`;
  outlined(ctx, char.name, edge + dir * 4, y + 36, '#ffffff');
  if (label) {
    ctx.font = `600 12px Barlow, system-ui, sans-serif`;
    const nameW = ctx.measureText(char.name).width;
    ctx.font = `600 12px Barlow, system-ui, sans-serif`;
    outlined(ctx, label.slice(0, 22), edge + dir * (nameW * 1.75 + 14), y + 37, 'rgba(255,255,255,0.8)');
  }

  // Round markers.
  for (let i = 0; i < RULES.ROUNDS_TO_WIN; i++) {
    const cx = edge + dir * (BAR_W - 24 - i * 22);
    ctx.beginPath();
    ctx.arc(cx, y + 36, 7, 0, Math.PI * 2);
    ctx.fillStyle = i < s.wins[side] ? '#ffd34d' : 'rgba(10,6,12,0.75)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = i < s.wins[side] ? '#fff3c0' : 'rgba(255,255,255,0.35)';
    ctx.stroke();
  }

  // Energy meter along the bottom.
  const my = ARENA.H - 30;
  const mEdge = side === 0 ? 24 : W - 24;
  const mW = 250;
  const full = f.meter >= RULES.SUPER_COST;
  slantBar(ctx, mEdge, my, mW, 14, side);
  ctx.fillStyle = 'rgba(10,6,12,0.85)';
  ctx.fill();
  slantBar(ctx, mEdge, my, mW * (f.meter / RULES.METER_MAX), 14, side);
  const pulse = 0.75 + 0.25 * Math.sin(now / 90);
  ctx.globalAlpha = full ? pulse : 1;
  ctx.fillStyle = full ? '#ffffff' : char.colors.glow;
  ctx.fill();
  ctx.globalAlpha = 1;
  slantBar(ctx, mEdge, my, mW, 14, side);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0b070d';
  ctx.stroke();
  // Tick marks showing how many specials the meter can pay for.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (let c = RULES.SPECIAL_COST; c < RULES.METER_MAX; c += RULES.SPECIAL_COST) {
    ctx.fillRect(mEdge + dir * mW * (c / RULES.METER_MAX) - 1, my, 2, 14);
  }
  ctx.font = `italic 900 13px ${FONT}`;
  ctx.textAlign = side === 0 ? 'left' : 'right';
  outlined(ctx, full ? 'FINISHER READY' : f.meter >= RULES.SPECIAL_COST ? 'SPECIAL READY' : 'ENERGY', mEdge + dir * 2, my - 11, full ? '#ffe37a' : f.meter >= RULES.SPECIAL_COST ? '#ffffff' : 'rgba(255,255,255,0.55)');
}

export function drawHud(ctx, s, labels, now) {
  ctx.save();
  playerPanel(ctx, s, 0, labels[0], now);
  playerPanel(ctx, s, 1, labels[1], now);

  // Timer.
  const secs = Math.ceil(s.timer / TICK_RATE);
  ctx.beginPath();
  ctx.moveTo(W / 2 - 40, 14);
  ctx.lineTo(W / 2 + 40, 14);
  ctx.lineTo(W / 2 + 28, 64);
  ctx.lineTo(W / 2 - 28, 64);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,6,12,0.88)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#d9a441';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 900 36px ${FONT}`;
  ctx.fillStyle = secs <= 10 && s.phase === 'fight' && Math.floor(now / 250) % 2 ? '#ff5a36' : '#fff3d6';
  ctx.fillText(String(secs).padStart(2, '0'), W / 2 - 1, 41);
  ctx.font = `700 11px Barlow, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`ROUND ${s.round}`, W / 2, 76);
  ctx.restore();
}
