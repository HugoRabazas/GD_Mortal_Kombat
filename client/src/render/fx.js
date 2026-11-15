// Visual effects that live only on the screen: hit sparks, dust, floating
// damage numbers, big announcer banners and camera shake. The simulation
// reports *what happened* as events; this file decides how it looks.

const particles = [];
const texts = [];
let banner = null;
let shake = 0;
let flash = 0;

// Bursts of light for the 3D arena to pick up (one per landed hit).
let flashes = [];
export function takeFlashes() {
  if (!flashes.length) return flashes;
  const out = flashes;
  flashes = [];
  return out;
}

export function resetFx() {
  particles.length = 0;
  texts.length = 0;
  banner = null;
  shake = 0;
  flash = 0;
}

// True while there is anything to draw, so idle frames can skip the work.
export function fxActive() {
  return particles.length > 0 || texts.length > 0;
}

export function addShake(amount) {
  shake = Math.max(shake, amount);
}

export function addFlash(amount) {
  flash = Math.max(flash, amount);
}

// Tell the 3D arena's crowd that a fighter gave their supporters something to
// cheer about (k: 0 to 1).
let cheers = [];
export function cheerFor(slot, k) {
  if (slot >= 0) cheers.push({ slot, k });
}
export function takeCheers() {
  if (!cheers.length) return cheers;
  const out = cheers;
  cheers = [];
  return out;
}

// Ask the 3D arena for a burst of light at a point of the arena floor.
export function lightFlash(x, h, z, color, heavy) {
  flashes.push({ x, h, z, color, heavy });
}

export function hitSpark(x, y, color, heavy) {
  const n = heavy ? 18 : 10;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (heavy ? 5 : 3.5) + Math.random() * (heavy ? 7 : 4);
    particles.push({ kind: 'streak', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, decay: 0.05 + Math.random() * 0.04, color, size: heavy ? 3 : 2 });
  }
  particles.push({ kind: 'burst', x, y, life: 1, decay: heavy ? 0.09 : 0.13, color: '#ffffff', size: heavy ? 46 : 30 });
}

export function blockSpark(x, y) {
  particles.push({ kind: 'ring', x, y, life: 1, decay: 0.1, color: '#9fd8ff', size: 26 });
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    particles.push({ kind: 'streak', x, y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, life: 1, decay: 0.09, color: '#cfeaff', size: 2 });
  }
}

export function dust(x, y, amount = 6) {
  for (let i = 0; i < amount; i++) {
    particles.push({ kind: 'dust', x: x + (Math.random() - 0.5) * 30, y: y + 2, vx: (Math.random() - 0.5) * 2.4, vy: -Math.random() * 1.2, life: 1, decay: 0.035 + Math.random() * 0.02, color: '#c9b0a8', size: 5 + Math.random() * 6 });
  }
}

// A match won: confetti in the winner's colours drifts down over the arena
// (fewer pieces, falling slower, for anyone who asked for less motion).
const calmMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export function confetti(width, colors) {
  const n = calmMotion ? 24 : 90;
  for (let i = 0; i < n; i++) {
    particles.push({
      kind: 'confetti',
      x: Math.random() * width,
      y: -10 - Math.random() * 140,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (calmMotion ? 1 : 1.6) + Math.random() * 1.2, // about 100-170 px a second at 60 frames
      life: 1,
      decay: 0.0028 + Math.random() * 0.0008, // five to six seconds: long enough to cross the screen
      color: colors[i % colors.length],
      size: 5 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.24,
      sway: Math.random() * Math.PI * 2,
    });
  }
}

export function floatText(x, y, text, color, size = 22) {
  texts.push({ x, y, text, color, size, life: 1 });
}

export function showBanner(text, sub, color, ms = 1400) {
  banner = { text, sub, color, born: performance.now(), ms };
}

// Called once per frame before drawing; returns the camera shake offset.
// Advance the effects by `dt` milliseconds of real time (a 60 fps frame is
// 16.7), so sparks fly and confetti falls at the same speed on a phone that
// draws fewer frames. Long stalls (a tab in the background) count as at most
// four frames.
export function updateFx(dt = 1000 / 60) {
  const k = Math.min(4, Math.max(0, dt / (1000 / 60)));
  const damp = Math.pow(0.9, k);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= p.decay * k;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    if (p.vx !== undefined) {
      p.x += p.vx * k;
      p.y += p.vy * k;
      if (p.kind === 'streak') {
        p.vx *= damp;
        p.vy = p.vy * damp + 0.25 * k;
      } else if (p.kind === 'confetti') {
        p.sway += 0.07 * k;
        p.x += Math.sin(p.sway) * 0.7 * k;
        p.rot += p.spin * k;
      }
    }
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= 0.022 * k;
    t.y -= 0.9 * k;
    if (t.life <= 0) texts.splice(i, 1);
  }
  const s = shake;
  shake *= Math.pow(0.86, k);
  if (shake < 0.3) shake = 0;
  flash *= Math.pow(0.85, k);
  if (flash < 0.02) flash = 0;
  return { x: (Math.random() - 0.5) * s * 2, y: (Math.random() - 0.5) * s * 2 };
}

export function drawFx(ctx) {
  ctx.save();
  for (const p of particles) {
    if (p.kind === 'confetti') {
      // A flat scrap turning over: its width swings with the turn.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, p.life * 3);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size * Math.abs(Math.cos(p.sway * 1.7)) + 1, p.size * 0.6);
      ctx.restore();
      continue;
    }
    if (p.kind === 'dust') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = p.life * 0.35;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - p.life * 0.6), 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = p.life;
    if (p.kind === 'streak') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.size;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
      ctx.stroke();
    } else if (p.kind === 'burst') {
      // A spiky star that pops and fades.
      const r = p.size * (1.25 - p.life * 0.6);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const rr = i % 2 ? r * 0.38 : r;
        ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 4 * p.life;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.4 - p.life), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = `italic 900 ${t.size}px Teko, Impact, "Arial Black", sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#0b070d';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.restore();
}

export function drawOverlays(ctx, W, H) {
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (!banner) return;
  const age = performance.now() - banner.born;
  if (age > banner.ms) {
    banner = null;
    return;
  }
  const inK = Math.min(1, age / 160);
  const outK = Math.min(1, (banner.ms - age) / 220);
  const scale = 1 + (1 - inK) * 1.6;
  ctx.save();
  ctx.globalAlpha = Math.min(inK, outK);
  ctx.translate(W / 2, H * 0.4);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(-W / 2, -62, W, 124);
  ctx.fillStyle = banner.color;
  ctx.fillRect(-W / 2, -62, W, 3);
  ctx.fillRect(-W / 2, 59, W, 3);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 900 84px Teko, Impact, "Arial Black", sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#0b070d';
  ctx.strokeText(banner.text, 0, banner.sub ? -8 : 2);
  const grad = ctx.createLinearGradient(0, -44, 0, 44);
  grad.addColorStop(0, '#fff6dc');
  grad.addColorStop(0.5, banner.color);
  grad.addColorStop(1, '#fff6dc');
  ctx.fillStyle = grad;
  ctx.fillText(banner.text, 0, banner.sub ? -8 : 2);
  if (banner.sub) {
    ctx.font = 'italic 900 26px Teko, Impact, "Arial Black", sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeText(banner.sub, 0, 42);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(banner.sub, 0, 42);
  }
  ctx.restore();
}
