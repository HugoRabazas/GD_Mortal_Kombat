// The heads-up display: health bars, names, points, timer, the energy meters
// that pay for specials and finishers, and the name tags that float over each
// fighter. Two fighters get big bars across the top; a four-fighter brawl gets
// one compact panel each.

import { ARENA, MODES, RULES, TICK_RATE } from '../../../shared/constants.js';
import { getFighter } from '../../../shared/fighters.js';
import { heads } from '../assets.js';

const { W } = ARENA;
const FONT = 'Teko, Impact, "Arial Black", sans-serif';
const BODY = 'Barlow, system-ui, sans-serif';
export const SLOT_COLORS = ['#ffd34d', '#59c7ff', '#ff6ad5', '#8be04e'];
const ghost = [1, 1, 1, 1]; // the pale bar that trails behind real health

export function resetHud() {
  ghost.fill(1);
}

// A slanted bar. `dir` 1 grows rightwards from x, -1 grows leftwards.
function slantBar(ctx, x, y, w, h, dir) {
  const s = Math.min(10, h * 0.45);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dir * w, y);
  ctx.lineTo(x + dir * (w - s), y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function outlined(ctx, text, x, y, fill, width = 4) {
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b070d';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function healthBar(ctx, f, x, y, w, h, dir, now) {
  const ratio = Math.max(0, f.hp / f.maxHp);
  ghost[f.slot] = ratio < ghost[f.slot] ? Math.max(ratio, ghost[f.slot] - 0.006) : ratio;
  slantBar(ctx, x, y, w, h, dir);
  ctx.fillStyle = 'rgba(10,6,12,0.85)';
  ctx.fill();
  slantBar(ctx, x, y, w * ghost[f.slot], h, dir);
  ctx.fillStyle = '#f4e6c8';
  ctx.fill();
  slantBar(ctx, x, y, w * ratio, h, dir);
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  if (ratio < 0.25 && Math.floor(now / 160) % 2) {
    grad.addColorStop(0, '#ff8a6b');
    grad.addColorStop(1, '#c81e1e');
  } else {
    grad.addColorStop(0, ratio > 0.5 ? '#ffe37a' : '#ffb347');
    grad.addColorStop(1, ratio > 0.5 ? '#f08a1c' : '#e0531a');
  }
  ctx.fillStyle = grad;
  ctx.fill();
  slantBar(ctx, x, y, w, h, dir);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#0b070d';
  ctx.stroke();
}

function energyBar(ctx, f, glow, x, y, w, h, dir, now) {
  const full = f.meter >= RULES.SUPER_COST;
  slantBar(ctx, x, y, w, h, dir);
  ctx.fillStyle = 'rgba(10,6,12,0.85)';
  ctx.fill();
  slantBar(ctx, x, y, w * (f.meter / RULES.METER_MAX), h, dir);
  ctx.globalAlpha = full ? 0.75 + 0.25 * Math.sin(now / 90) : 1;
  ctx.fillStyle = full ? '#ffffff' : glow;
  ctx.fill();
  ctx.globalAlpha = 1;
  slantBar(ctx, x, y, w, h, dir);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0b070d';
  ctx.stroke();
  // Tick marks showing how many specials the bar can pay for.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  for (let c = RULES.SPECIAL_COST; c < RULES.METER_MAX; c += RULES.SPECIAL_COST) {
    ctx.fillRect(x + dir * w * (c / RULES.METER_MAX) - 1, y, 2, h);
  }
}

function portrait(ctx, char, x, y, r, ring) {
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = '#0b070d';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  const head = heads.get(char.id);
  if (head) ctx.drawImage(head, x - r + 3, y - r + 3, (r - 3) * 2, (r - 3) * 2);
}

// Two fighters: big bars across the top, energy along the bottom - or, with
// the on-screen controls lying over the bottom corners (`top`), right under
// each fighter's name.
function duelPanel(ctx, s, side, label, now, worn, top) {
  const f = s.f[side];
  const char = getFighter(f.char);
  const dir = side === 0 ? 1 : -1;
  const edge = side === 0 ? 74 : W - 74;
  const y = 26;
  healthBar(ctx, f, edge, y, 340, 22, dir, now);
  portrait(ctx, char, side === 0 ? 40 : W - 40, 40, 28, worn.accent);

  ctx.textBaseline = 'middle';
  ctx.textAlign = side === 0 ? 'left' : 'right';
  ctx.font = `italic 700 22px ${FONT}`;
  outlined(ctx, char.name, edge + dir * 4, y + 37, '#ffffff');
  if (label) {
    const nameW = ctx.measureText(char.name).width;
    ctx.font = `600 12px ${BODY}`;
    outlined(ctx, label.slice(0, 22), edge + dir * (nameW + 16), y + 37, SLOT_COLORS[side]);
  }
  // Points won so far.
  for (let i = 0; i < MODES.duel.pointsToWin; i++) {
    const cx = edge + dir * (316 - i * 22);
    ctx.beginPath();
    ctx.arc(cx, y + 36, 7, 0, Math.PI * 2);
    ctx.fillStyle = i < s.pts[side] ? '#ffd34d' : 'rgba(10,6,12,0.75)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = i < s.pts[side] ? '#fff3c0' : 'rgba(255,255,255,0.35)';
    ctx.stroke();
  }
  if (s.phase === 'over') return; // the match is decided: the result card has that corner
  const full = f.meter >= RULES.SUPER_COST;
  const ready = f.meter >= RULES.SPECIAL_COST;
  const word = full ? 'FINISHER READY' : ready ? 'SPECIAL READY' : 'ENERGY';
  const ink = full ? '#ffe37a' : ready ? '#ffffff' : 'rgba(255,255,255,0.55)';
  if (top) {
    energyBar(ctx, f, worn.glow, edge, y + 52, 210, 11, dir, now);
    ctx.font = `italic 700 13px ${FONT}`;
    outlined(ctx, word, edge + dir * 220, y + 58, ink);
    return;
  }
  const my = ARENA.H - 30;
  const mEdge = side === 0 ? 24 : W - 24;
  energyBar(ctx, f, worn.glow, mEdge, my, 250, 14, dir, now);
  ctx.font = `italic 700 14px ${FONT}`;
  outlined(ctx, word, mEdge + dir * 2, my - 11, ink);
}

// A brawl: one compact panel per fighter, two either side of the timer.
// Text cut short with an ellipsis to fit a width (in the current font).
function cutToWidth(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function arenaPanel(ctx, s, slot, label, now, worn) {
  const f = s.f[slot];
  const char = getFighter(f.char);
  const x = [8, 216, 548, 756][slot];
  const out = f.hp <= 0;
  ctx.save();
  ctx.globalAlpha = out ? 0.5 : 1;
  ctx.fillStyle = 'rgba(10,6,12,0.6)';
  ctx.fillRect(x, 10, 196, 56);
  ctx.fillStyle = SLOT_COLORS[slot];
  ctx.fillRect(x, 10, 4, 56);
  portrait(ctx, char, x + 32, 38, 21, SLOT_COLORS[slot]);
  healthBar(ctx, f, x + 60, 36, 96, 11, 1, now);
  energyBar(ctx, f, worn.glow, x + 60, 51, 96, 7, 1, now);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // The fighter's name and the player's (a nickname online, up to 14
  // letters) share the room left of the points: the name shrinks a little,
  // then the nickname is cut short, rather than run into the next panel.
  const tag = out ? 'OUT' : label || '';
  const room = 98;
  ctx.font = `700 10px ${BODY}`;
  const tagW = ctx.measureText(tag).width;
  let size = 20;
  let nameW;
  for (;;) {
    ctx.font = `italic 700 ${size}px ${FONT}`;
    nameW = ctx.measureText(char.name).width;
    if (size <= 15 || nameW + 6 + tagW <= room) break;
    size--;
  }
  outlined(ctx, char.name, x + 60, 25, '#ffffff', 3);
  ctx.font = `700 10px ${BODY}`;
  outlined(ctx, cutToWidth(ctx, tag, room - nameW - 6), x + 66 + nameW, 25, out ? '#ff5a36' : SLOT_COLORS[slot], 3);
  // Match points.
  ctx.textAlign = 'center';
  ctx.font = `700 30px ${FONT}`;
  outlined(ctx, String(s.pts[slot]), x + 176, 37, '#ffd34d', 4);
  ctx.font = `700 9px ${BODY}`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('PTS', x + 176, 56);
  ctx.restore();
}

// Floating tags over the fighters: who is who, and in a brawl their health.
// `spots` holds one projected point per fighter, at the top of the head.
export function drawTags(ctx, s, spots, labels) {
  const arena = s.f.length > 2;
  // Once the match is decided the tags fade away: the winner's pose and the
  // result screen have the stage to themselves.
  const fade = s.phase === 'over' ? 1 - s.pt / 40 : 1;
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of s.f) {
    const p = spots[f.slot];
    if (!p || f.hp <= 0 || !labels[f.slot]) continue;
    const k = Math.min(1.25, Math.max(0.7, p.k));
    const color = SLOT_COLORS[f.slot];
    const y = p.y - 12 * k;
    ctx.font = `700 ${Math.round(13 * k)}px ${BODY}`;
    outlined(ctx, labels[f.slot], p.x, y, color, 3);
    // Arrow pointing down at the fighter.
    ctx.beginPath();
    ctx.moveTo(p.x - 5 * k, y + 9 * k);
    ctx.lineTo(p.x + 5 * k, y + 9 * k);
    ctx.lineTo(p.x, y + 15 * k);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0b070d';
    ctx.stroke();
    if (arena) {
      const w = 46 * k;
      ctx.fillStyle = 'rgba(10,6,12,0.85)';
      ctx.fillRect(p.x - w / 2 - 1, y - 16 * k, w + 2, 6 * k);
      ctx.fillStyle = f.hp / f.maxHp > 0.3 ? '#ffb347' : '#ff5a36';
      ctx.fillRect(p.x - w / 2, y - 16 * k + 1, w * (f.hp / f.maxHp), 6 * k - 2);
    }
  }
  ctx.restore();
}

// `worn`: the colours each slot really wears (costumes included). `top`:
// keep the bottom corners clear (the on-screen controls lie over them).
export function drawHud(ctx, s, labels, now, worn, top) {
  const arena = s.f.length > 2;
  const colorsOf = (slot) => worn?.[slot] ?? getFighter(s.f[slot].char).colors;
  ctx.save();
  if (arena) for (const f of s.f) arenaPanel(ctx, s, f.slot, labels[f.slot], now, colorsOf(f.slot));
  else for (const side of [0, 1]) duelPanel(ctx, s, side, labels[side], now, colorsOf(side), top);

  // Timer.
  const secs = Math.ceil(s.timer / TICK_RATE);
  const closing = s.ringR < ARENA.R - 1;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 40, 14);
  ctx.lineTo(W / 2 + 40, 14);
  ctx.lineTo(W / 2 + 28, 64);
  ctx.lineTo(W / 2 - 28, 64);
  ctx.closePath();
  ctx.fillStyle = 'rgba(10,6,12,0.88)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = closing ? '#ff5a36' : '#d9a441';
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 700 40px ${FONT}`;
  ctx.fillStyle = secs <= 10 && s.phase === 'fight' && Math.floor(now / 250) % 2 ? '#ff5a36' : '#fff3d6';
  ctx.fillText(String(secs).padStart(2, '0'), W / 2 - 1, 42);
  ctx.font = `700 11px ${BODY}`;
  ctx.fillStyle = closing ? '#ff8a5c' : 'rgba(255,255,255,0.75)';
  ctx.fillText(closing && s.phase === 'fight' ? 'RING CLOSING' : arena ? `ROUND ${s.round} / ${MODES.arena.maxRounds}` : `ROUND ${s.round}`, W / 2, 76);
  ctx.restore();
}

// Training: your last buttons, oldest first, under your health bar (below the
// energy bar when that is up there too). Each fades after a few seconds.
const CHIP_INK = { P: '#c62a3a', K: '#9c1f30', GRAB: '#a86a1f', BLK: '#4a3a52', SP: '#7a2a8a', ULT: '#b8862a', JMP: '#2856a8' };
export function drawInputs(ctx, list, top) {
  const now = performance.now();
  let x = 24;
  const y = top ? 104 : 84;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const c of list) {
    const age = now - c.at;
    if (age > 4000) continue;
    ctx.globalAlpha = Math.min(1, (4000 - age) / 800);
    ctx.font = `italic 700 18px ${FONT}`;
    const label = c.dir + c.name;
    const w = ctx.measureText(label).width + 14;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, 24, 6) : ctx.rect(x, y, w, 24);
    ctx.fillStyle = CHIP_INK[c.name] || '#444';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 7, y + 13);
    x += w + 5;
  }
  ctx.restore();
}
