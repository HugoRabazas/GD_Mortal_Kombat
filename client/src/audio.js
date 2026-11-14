// Sound effects, synthesised on the spot with the Web Audio API so the game
// ships no audio files. Browsers only allow sound after a click or key press,
// so the audio engine starts on the first user action.

let ctx = null;
let master = null;
let noise = null;
let muted = false;

try {
  muted = localStorage.getItem('gd-arena-muted') === '1';
} catch {
  // storage unavailable: keep the default
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.5;
  try {
    localStorage.setItem('gd-arena-muted', muted ? '1' : '0');
  } catch {
    // ignore
  }
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (musicMode !== 'off' && !musicTimer) setMusic(musicMode);
  } catch {
    ctx = null;
  }
}

function tone(type, from, to, dur, gain, delay = 0) {
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function burst(dur, gain, freq, q = 1, delay = 0, type = 'bandpass') {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  swing: () => burst(0.12, 0.25, 1800, 0.8),
  hit: () => {
    burst(0.1, 0.7, 900, 0.7);
    tone('sine', 190, 60, 0.14, 0.7);
  },
  heavy: () => {
    burst(0.18, 0.9, 600, 0.6);
    tone('sine', 150, 38, 0.26, 1);
    tone('square', 90, 40, 0.12, 0.25);
  },
  block: () => {
    burst(0.07, 0.4, 2600, 2);
    tone('triangle', 520, 300, 0.08, 0.3);
  },
  jump: () => tone('sine', 240, 520, 0.12, 0.18),
  land: () => burst(0.08, 0.3, 300, 0.7, 0, 'lowpass'),
  thud: () => {
    burst(0.2, 0.7, 220, 0.7, 0, 'lowpass');
    tone('sine', 90, 35, 0.25, 0.8);
  },
  special: () => {
    tone('sawtooth', 220, 880, 0.25, 0.3);
    burst(0.3, 0.35, 3000, 0.5);
  },
  bolt: () => {
    tone('square', 900, 180, 0.25, 0.22);
    burst(0.2, 0.3, 4000, 1.5);
  },
  super: () => {
    tone('sawtooth', 110, 1320, 0.6, 0.4);
    tone('sine', 55, 220, 0.6, 0.6);
    burst(0.7, 0.4, 2000, 0.4);
  },
  ko: () => {
    tone('sine', 120, 30, 0.9, 1);
    burst(0.5, 0.8, 400, 0.5);
    tone('sawtooth', 440, 110, 0.7, 0.2, 0.05);
  },
  round: () => {
    tone('triangle', 660, 660, 0.14, 0.35);
    tone('triangle', 880, 880, 0.22, 0.35, 0.15);
  },
  fight: () => {
    tone('square', 330, 330, 0.08, 0.3);
    tone('square', 660, 990, 0.35, 0.35, 0.08);
    burst(0.3, 0.3, 2500, 0.5, 0.08);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.22, 0.35, i * 0.13));
  },
  ui: () => tone('triangle', 700, 900, 0.06, 0.2),
  burn: () => {
    burst(0.35, 0.7, 1200, 0.6);
    tone('sawtooth', 300, 80, 0.3, 0.3);
  },
  thunder: () => {
    burst(1.6, 0.9, 140, 0.4, 0.05, 'lowpass');
    burst(0.25, 0.7, 2400, 0.5);
    tone('sine', 70, 28, 1.4, 0.8, 0.05);
  },
};

// ------------------------------------------------------------------ music ---
// A small step sequencer: four bars (A minor, A minor, F, G) of drums, bass
// and a plucked melody, generated note by note. 'menu' is a sparse version of
// the same loop, 'fight' is the full one.

const BPM = 116;
const STEP = 60 / BPM / 4; // a sixteenth note, in seconds
const BARS = [
  { bass: 55, notes: [220, 261.63, 329.63] },
  { bass: 55, notes: [220, 261.63, 329.63] },
  { bass: 43.65, notes: [174.61, 220, 261.63] },
  { bass: 49, notes: [196, 246.94, 293.66] },
];
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const LEAD_STEPS = [0, 3, 6, 10, 12, 14];
let musicBus = null;
let musicMode = 'off';
let musicTimer = null;
let musicStep = 0;
let musicNext = 0;

function note(type, freq, t, dur, gain, glideTo) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(musicBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function hiss(t, dur, gain, freq) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(musicBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function musicTick(i, t) {
  const bar = BARS[Math.floor(i / 16) % BARS.length];
  const s = i % 16;
  const full = musicMode === 'fight';
  if (s % 4 === 0 && (full || s % 8 === 0)) note('sine', 130, t, 0.16, 0.9, 42); // kick
  if (full && (s === 4 || s === 12)) hiss(t, 0.12, 0.35, 1800); // snare
  if (full ? s % 2 === 1 : s % 4 === 2) hiss(t, 0.04, 0.12, 7000); // hat
  if (BASS_STEPS.includes(s) && (full || s % 8 === 0)) note('sawtooth', bar.bass, t, full ? 0.2 : 0.5, 0.32);
  if (LEAD_STEPS.includes(s)) {
    const n = bar.notes[(LEAD_STEPS.indexOf(s) + Math.floor(i / 16)) % bar.notes.length];
    note('triangle', full ? n * 2 : n, t, 0.22, full ? 0.16 : 0.12);
  }
}

function pumpMusic() {
  if (!ctx || ctx.state !== 'running') return;
  // If the tab slept, do not try to play everything that was missed.
  if (musicNext < ctx.currentTime) musicNext = ctx.currentTime + 0.05;
  while (musicNext < ctx.currentTime + 0.15) {
    if (!muted) musicTick(musicStep, musicNext);
    musicStep = (musicStep + 1) % 64;
    musicNext += STEP;
  }
}

// mode: 'menu', 'fight' or 'off'
export function setMusic(mode) {
  musicMode = mode;
  if (!ctx) return; // starts once the audio engine is unlocked
  if (!musicBus) {
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.3;
    musicBus.connect(master);
  }
  if (mode === 'off') {
    clearInterval(musicTimer);
    musicTimer = null;
  } else if (!musicTimer) {
    musicNext = 0;
    musicTimer = setInterval(pumpMusic, 40);
  }
}

export function play(name) {
  if (!ctx || muted || ctx.state !== 'running') return;
  try {
    SOUNDS[name]?.();
  } catch {
    // a failed sound must never break the game
  }
}
