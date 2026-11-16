// Sound effects, synthesised on the spot with the Web Audio API so the game
// ships no audio files. Browsers only allow sound after a click or key press,
// so the audio engine starts on the first user action.

let ctx = null;
let master = null;
let sfxBus = null; // every sound effect passes through here, so it has its own volume
let noise = null;
let muted = false;

try {
  muted = localStorage.getItem('gd-arena-muted') === '1';
} catch {
  // storage unavailable: keep the default
}

// Separate volumes for effects and music, 0 to 1, remembered on the device.
const volume = { sfx: 1, music: 1 };
try {
  for (const k of ['sfx', 'music']) {
    const v = Number(localStorage.getItem(`gd-arena-vol-${k}`));
    if (localStorage.getItem(`gd-arena-vol-${k}`) !== null && v >= 0 && v <= 1) volume[k] = v;
  }
} catch {
  // storage unavailable: full volume
}

export const getVolume = (kind) => volume[kind];

export function setVolume(kind, value) {
  volume[kind] = Math.min(1, Math.max(0, value));
  if (kind === 'sfx' && sfxBus) sfxBus.gain.value = volume.sfx;
  if (kind === 'music' && musicBus) musicBus.gain.value = 0.3 * volume.music * (1 - duck * 0.8);
  try {
    localStorage.setItem(`gd-arena-vol-${kind}`, String(volume[kind]));
  } catch {
    // not remembered
  }
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
      sfxBus = ctx.createGain();
      sfxBus.gain.value = volume.sfx;
      sfxBus.connect(master);
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

// Combat sounds are nudged up or down a little each time they play, so a
// flurry of hits does not sound like one sample on repeat.
const VARIED = new Set(['swing', 'hit', 'heavy', 'block', 'jump', 'land', 'thud', 'burn', 'stepStone', 'stepSnow', 'stepSand', 'stepTile']);
let pitch = 1;

function tone(type, from, to, dur, gain, delay = 0) {
  from *= pitch;
  to *= pitch;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function burst(dur, gain, freq, q = 1, delay = 0, type = 'bandpass') {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true; // the noise is one second long; thunder rumbles for longer
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq * pitch;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// Noise swept through a band that slides from one pitch to another: whooshes.
function sweep(dur, gain, from, to, q = 1.2, delay = 0) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from * pitch, t);
  filter.frequency.exponentialRampToValueAtTime(to * pitch, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

// A gust of wind: hiss that swells, whistles a little higher and dies away.
function gust(dur, gain) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.6;
  const low = 260 + Math.random() * 120;
  filter.frequency.setValueAtTime(low, t);
  filter.frequency.linearRampToValueAtTime(low * (2.2 + Math.random()), t + dur * 0.45);
  filter.frequency.linearRampToValueAtTime(low * 1.2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
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
  // A low blow along the floor (slide, guard sweep): a scrape and a thump.
  scrape: () => {
    burst(0.22, 0.6, 420, 0.5);
    tone('sine', 140, 60, 0.18, 0.6);
  },
  // A dive kick landing: a falling crack.
  diveHit: () => {
    burst(0.16, 0.9, 760, 0.6);
    tone('sine', 260, 50, 0.3, 0.9);
    tone('square', 110, 45, 0.1, 0.2);
  },
  block: () => {
    burst(0.07, 0.4, 2600, 2);
    tone('triangle', 520, 300, 0.08, 0.3);
  },
  parry: () => {
    burst(0.05, 0.5, 4200, 3);
    tone('triangle', 1320, 1180, 0.32, 0.4);
    tone('sine', 1980, 1900, 0.22, 0.22, 0.02);
  },
  jump: () => tone('sine', 240, 520, 0.12, 0.18),
  land: () => burst(0.08, 0.3, 300, 0.7, 0, 'lowpass'),
  // Footsteps, by what the arena's floor is: a soft knock on stone, a crunch
  // of snow, a hiss of sand, the tap of a temple's polished stone.
  stepStone: () => burst(0.05, 0.09, 520, 1.2, 0, 'bandpass'),
  stepSnow: () => burst(0.09, 0.08, 3200, 0.6, 0, 'highpass'),
  stepSand: () => burst(0.1, 0.06, 1600, 0.5, 0, 'bandpass'),
  stepTile: () => burst(0.04, 0.08, 1100, 2.2, 0, 'bandpass'),
  thud: () => {
    burst(0.2, 0.7, 220, 0.7, 0, 'lowpass');
    tone('sine', 90, 35, 0.25, 0.8);
  },
  special: () => {
    tone('sawtooth', 220, 880, 0.25, 0.3);
    burst(0.3, 0.35, 3000, 0.5);
  },
  // Each special move has its own voice; the projectile keeps 'special' for
  // its charge and 'bolt' for the shot.
  rush: () => {
    // Crimson Rush: air torn open, rising, with a growl under it.
    sweep(0.38, 1.3, 350, 2600, 1.4);
    tone('sawtooth', 95, 190, 0.3, 0.32);
  },
  flare: () => {
    // Twin Flame Spiral: crackling flame and a tone that climbs with the leap.
    for (let i = 0; i < 5; i++) burst(0.04, 0.55, 2500 + Math.random() * 3000, 2, i * 0.06);
    tone('sine', 300, 1200, 0.45, 0.32);
    sweep(0.5, 0.6, 800, 3200, 0.8);
  },
  heave: () => {
    // Mountain Stomp, winding up: a low effort as the leg goes up.
    tone('sine', 90, 60, 0.32, 0.45);
    sweep(0.3, 0.2, 200, 500, 1);
  },
  quakeBoom: () => {
    // ...and coming down: a deep boom with a long rumble.
    burst(1.1, 0.95, 120, 0.5, 0, 'lowpass');
    tone('sine', 58, 26, 0.9, 0.95);
    tone('square', 70, 35, 0.2, 0.18);
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
  // Each fighter's finisher has a voice of its own, heard over the freeze.
  // The newer fighters' finishers borrow voices that suit them.
  oath: () => SOUNDS.avalanche(),
  crescent: () => SOUNDS.phoenix(),
  cuts: () => SOUNDS.eclipse(),
  sunburst: () => {
    SOUNDS.phoenix();
    tone('sine', 880, 1320, 0.8, 0.2, 0.2);
  },
  howl: () => {
    // Red Moon Howl: a long wolf's howl, rising, wavering and falling away.
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const vib = ctx.createOscillator();
    const depth = ctx.createGain();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.linearRampToValueAtTime(520, t + 0.35);
    osc.frequency.linearRampToValueAtTime(560, t + 0.9);
    osc.frequency.exponentialRampToValueAtTime(300, t + 1.3);
    vib.frequency.value = 6;
    depth.gain.value = 14;
    vib.connect(depth).connect(osc.frequency);
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 1500;
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.2);
    g.gain.linearRampToValueAtTime(0.26, t + 0.95);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.35);
    osc.connect(soft).connect(g).connect(sfxBus);
    osc.start(t);
    vib.start(t);
    osc.stop(t + 1.4);
    vib.stop(t + 1.4);
    tone('sine', 55, 45, 1.2, 0.5);
  },
  eclipse: () => {
    // Total Eclipse: the air pulled away into a low, hollow drone.
    sweep(0.9, 0.9, 3200, 180, 1.6);
    tone('sine', 70, 48, 1.3, 0.7);
    tone('triangle', 140, 96, 1.2, 0.18, 0.1);
    tone('sine', 1760, 1700, 0.9, 0.06, 0.35);
  },
  avalanche: () => {
    // Avalanche Charge: a mountain letting go - a long rumble and rocks.
    burst(1.4, 1, 90, 0.5, 0, 'lowpass');
    tone('sine', 50, 30, 1.3, 0.8);
    for (let i = 0; i < 6; i++) burst(0.12, 0.5, 300 + i * 70, 1.2, 0.15 + i * 0.16, 'lowpass');
  },
  phoenix: () => {
    // Phoenix Dive: a roar of flame climbing into a high cry.
    for (let i = 0; i < 8; i++) burst(0.05, 0.5, 2200 + Math.random() * 3500, 2, i * 0.08);
    sweep(1.0, 0.9, 500, 4200, 0.9);
    tone('sawtooth', 600, 1500, 0.6, 0.16, 0.3);
    tone('sine', 1500, 1900, 0.5, 0.18, 0.55);
  },
  finale: () => {
    // A finisher's last blow: a crack, a deep boom and a long tail.
    burst(0.12, 1, 2400, 0.7);
    tone('sine', 110, 28, 1.2, 1);
    burst(1.2, 0.6, 160, 0.5, 0.05, 'lowpass');
    tone('square', 60, 30, 0.3, 0.2);
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
  // Something new on the Record, or the day's challenge beaten: a quick
  // rising sparkle after the fanfare.
  milestone: () => {
    [1047, 1319, 1568, 2093].forEach((f, i) => tone('sine', f, f, 0.16, 0.16, i * 0.07));
    tone('triangle', 2093, 2637, 0.4, 0.08, 0.3);
  },
  // Life around the arena: a bird's quick chirps (by day) and a cricket's
  // pulsed trill (at night), quiet under the fight.
  chirp: () => {
    const base = 2300 + Math.random() * 1300;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) tone('sine', base, base * 1.35, 0.07, 0.07, i * 0.11);
  },
  cricket: () => {
    for (let i = 0; i < 6; i++) tone('sine', 4700, 4600, 0.025, 0.036, i * 0.05);
  },
  // Online: a soft two-note chime for a chat message from someone else, and
  // a rising one when someone joins your room.
  chime: () => {
    tone('sine', 880, 880, 0.12, 0.12);
    tone('sine', 1320, 1320, 0.18, 0.1, 0.08);
  },
  arrive: () => {
    tone('triangle', 523, 523, 0.1, 0.14);
    tone('triangle', 784, 784, 0.1, 0.14, 0.09);
    tone('triangle', 1047, 1047, 0.2, 0.12, 0.18);
  },
  // The rituals while a round is announced: a big clap, a fist meeting an
  // open palm, a flame stirred up.
  clap: () => {
    burst(0.05, 0.95, 1500, 0.9);
    burst(0.07, 0.5, 2800, 1.4, 0.004);
  },
  palm: () => {
    burst(0.07, 0.7, 520, 0.8, 0, 'lowpass');
    tone('sine', 170, 90, 0.09, 0.3);
  },
  flame: () => sweep(0.75, 0.4, 260, 1700, 1.1),
  // The newer four: Meru's fist on an iron breastplate (a dull ring), the
  // twang of Gleh's bowstring, the hiss of Kichta's blade hand, the whistle
  // of Zelrith's spin and the flourish of the bow that ends it.
  oathRing: () => {
    burst(0.06, 0.6, 400, 0.9, 0, 'lowpass');
    tone('triangle', 220, 216, 0.7, 0.16);
    tone('sine', 523, 515, 0.5, 0.06, 0.01);
  },
  twang: () => {
    tone('triangle', 330, 196, 0.22, 0.3);
    tone('sine', 660, 392, 0.12, 0.08);
    sweep(0.35, 0.18, 2400, 900, 2.5, 0.03);
  },
  slice: () => sweep(0.16, 0.35, 5200, 1900, 3),
  whirl: () => sweep(0.45, 0.22, 700, 2600, 4),
  bowOut: () => {
    tone('triangle', 659, 659, 0.08, 0.12);
    tone('triangle', 988, 988, 0.22, 0.12, 0.08);
  },
  // A match lost at this screen: the fanfare's notes turned downwards, in a
  // minor key, ending on a long note that sags a semitone.
  defeat: () => {
    [440, 349.23, 293.66].forEach((f, i) => tone('triangle', f, f, 0.3, 0.26, i * 0.2));
    tone('triangle', 220, 207.65, 0.9, 0.28, 0.62);
  },
  ui: () => tone('triangle', 700, 900, 0.06, 0.2),
  spawn: () => tone('sine', 900, 1500, 0.18, 0.12),
  pickup: () => {
    tone('triangle', 660, 660, 0.08, 0.3);
    tone('triangle', 990, 990, 0.1, 0.3, 0.07);
    tone('triangle', 1320, 1320, 0.16, 0.3, 0.14);
  },
  // The crowd roaring at a knockout.
  cheer: () => {
    burst(1.5, 0.3, 1100, 0.35);
    burst(1.1, 0.22, 2300, 0.5, 0.08);
    burst(0.9, 0.18, 600, 0.4, 0.15);
  },
  burn: () => {
    burst(0.35, 0.7, 1200, 0.6);
    tone('sawtooth', 300, 80, 0.3, 0.3);
  },
  thunder: () => {
    burst(1.6, 0.9, 140, 0.4, 0.05, 'lowpass');
    burst(0.25, 0.7, 2400, 0.5);
    tone('sine', 70, 28, 1.4, 0.8, 0.05);
  },
  wind: () => gust(2.6 + Math.random() * 1.4, 0.34),
  // A counter hit: a dry crack on top of the blow.
  counter: () => {
    burst(0.05, 0.6, 3200, 1.5);
    tone('square', 880, 440, 0.07, 0.12);
  },
  // A last stand begins: a deep drum and a tone rising into it - the moment
  // a fighter digs in.
  lastStand: () => {
    tone('sine', 70, 40, 0.5, 0.8);
    burst(0.3, 0.5, 180, 0.6, 0, 'lowpass');
    tone('sawtooth', 220, 440, 0.6, 0.12, 0.05);
  },
  // Lub-dub: two low thumps, the second softer.
  heartbeat: () => {
    tone('sine', 64, 40, 0.13, 0.75);
    tone('sine', 58, 36, 0.11, 0.5, 0.17);
  },
};

// ------------------------------------------------------------------ music ---
// A small step sequencer: four bars of drums, bass and a melody, generated
// note by note. 'menu' is a sparse version of the loop, 'fight' the full one,
// and 'final' the fight loop pushed harder, for deciding rounds and the last
// seconds of any round: faster, busier drums, the melody an octave up.
//
// Each arena has its own tune (see setMusicTheme):
//   courtyard - A minor, A minor, F, G at 116 beats a minute: a plucked
//               triangle melody over a sawtooth bass, warm and driving.
//   frost     - D minor, B flat, G minor, A at 104: a bell melody (a pure
//               tone plus the out-of-tune overtone real bells have) over a
//               hollow square bass, softer drums and a high ice chime.
export const MUSIC_THEMES = {
  courtyard: {
    bpm: 116,
    finalBpm: 130,
    bars: [
      { bass: 55, notes: [220, 261.63, 329.63] },
      { bass: 55, notes: [220, 261.63, 329.63] },
      { bass: 43.65, notes: [174.61, 220, 261.63] },
      { bass: 49, notes: [196, 246.94, 293.66] },
    ],
    bass: 'sawtooth',
    bell: false,
    kick: 0.9,
    hat: 7000,
  },
  frost: {
    bpm: 104,
    finalBpm: 120,
    bars: [
      { bass: 73.42, notes: [293.66, 349.23, 440] },
      { bass: 58.27, notes: [233.08, 293.66, 349.23] },
      { bass: 49, notes: [196, 233.08, 293.66] },
      { bass: 55, notes: [220, 277.18, 329.63] },
    ],
    bass: 'square',
    bell: true,
    kick: 0.65,
    hat: 9500,
  },
};
// Dune Ruins: E, F, E, D minor - the half step from E to F is what gives the
// tune its desert colour - at 98, with a reedy lead and a soft triangle bass.
MUSIC_THEMES.dunes = {
  bpm: 98,
  finalBpm: 114,
  bars: [
    { bass: 82.41, notes: [329.63, 415.3, 493.88] },
    { bass: 87.31, notes: [349.23, 440, 523.25] },
    { bass: 82.41, notes: [329.63, 415.3, 493.88] },
    { bass: 73.42, notes: [293.66, 349.23, 440] },
  ],
  bass: 'triangle',
  bell: false,
  reed: true,
  kick: 0.8,
  hat: 6000,
};
// Blossom Terrace: the only tune in a major key - G, E minor, C, D - unhurried
// at 92, a plain triangle lead over a triangle bass, light drums.
MUSIC_THEMES.blossom = {
  bpm: 92,
  finalBpm: 108,
  bars: [
    { bass: 49, notes: [392, 493.88, 587.33] },
    { bass: 41.2, notes: [329.63, 392, 493.88] },
    { bass: 65.41, notes: [329.63, 392, 523.25] },
    { bass: 73.42, notes: [293.66, 369.99, 440] },
  ],
  bass: 'triangle',
  bell: false,
  kick: 0.6,
  hat: 8000,
};
let tune = MUSIC_THEMES.courtyard;
const stepSeconds = () => 60 / (musicMode === 'final' ? tune.finalBpm : tune.bpm) / 4; // a sixteenth note
const BASS_STEPS = [0, 3, 6, 8, 11, 14];
const LEAD_STEPS = [0, 3, 6, 10, 12, 14];
// The answering phrase (bars 5 to 8 of every eight): the lead on another
// rhythm, walking down the chord instead of up, and the last bar closing on
// one long note - so a tune repeats every eight bars, not every four.
const LEAD_STEPS_B = [0, 2, 4, 8, 11, 14];
let musicBus = null;
let duck = 0; // 0 = full music, 1 = pushed right down (see duckMusic)
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

// The lead's note at sixteenth `i` of the eight-bar loop: { freq, held } or
// null for a rest. `held` is the eighth bar's one long closing note.
export function leadNote(theme, step) {
  const i = step % 128;
  const bar = theme.bars[Math.floor(i / 16) % theme.bars.length];
  const s = i % 16;
  const answer = Math.floor(i / 64) % 2 === 1;
  const closing = answer && Math.floor(i / 16) % 4 === 3;
  const steps = answer ? LEAD_STEPS_B : LEAD_STEPS;
  if (!steps.includes(s) || (closing && s > 0)) return null;
  const k = steps.indexOf(s) + Math.floor(i / 16);
  const notes = bar.notes;
  return { freq: notes[answer ? notes.length - 1 - (k % notes.length) : k % notes.length], held: closing };
}

function musicTick(i, t) {
  const bars = tune.bars;
  const bar = bars[Math.floor(i / 16) % bars.length];
  const s = i % 16;
  const final = musicMode === 'final';
  const full = final || musicMode === 'fight';
  if (s % 4 === 0 && (full || s % 8 === 0)) note('sine', 130, t, 0.16, tune.kick, 42); // kick
  if (full && (s === 4 || s === 12)) hiss(t, 0.12, tune.bell ? 0.22 : 0.35, 1800); // snare
  if (final || (full ? s % 2 === 1 : s % 4 === 2)) hiss(t, 0.04, final && s % 2 === 0 ? 0.07 : 0.12, tune.hat); // hat
  if (final && (s === 14 || s === 15)) hiss(t, 0.08, 0.25, 1800); // a snare roll into the next bar
  if (BASS_STEPS.includes(s) && (full || s % 8 === 0)) note(tune.bass, bar.bass, t, full ? 0.2 : 0.5, tune.bass === 'square' ? 0.2 : 0.32);
  const lead = leadNote(tune, i);
  if (lead) {
    const n = lead.freq;
    const closing = lead.held;
    const f = final ? n * (tune.bell ? 2 : 4) : full ? n * 2 : n; // a bell two octaves up would shriek
    if (tune.reed) {
      // A reed: a soft sawtooth with a little sway in its pitch.
      note('sawtooth', f, t, closing ? 1.1 : full ? 0.3 : 0.45, full ? 0.07 : 0.06, f * 1.01);
    } else if (tune.bell) {
      // A bell: the note itself, and a quieter overtone 2.76 times higher that
      // dies away sooner - the clang that tells a bell from a flute.
      note('sine', f, t, closing ? 1.4 : full ? 0.5 : 0.9, full ? 0.16 : 0.13);
      note('sine', f * 2.76, t, 0.25, 0.05);
    } else {
      note('triangle', f, t, closing ? 0.9 : 0.22, full ? 0.16 : 0.12);
    }
  }
  // Ice chime: a high, slow sparkle at the top of every other bar.
  if (tune.bell && s === 0 && Math.floor(i / 16) % 2 === 1) note('sine', bar.notes[2] * 4, t, 1.6, 0.04);
}

// Pull the music down for a dramatic beat (a finisher's freeze, the slow
// motion after a knockout) and let it back up after. 0 to 1.
export function duckMusic(level) {
  const want = Math.max(0, Math.min(1, level));
  if (Math.abs(want - duck) < 0.02) return;
  duck = want;
  if (!musicBus || !ctx) return;
  musicBus.gain.setTargetAtTime(0.3 * volume.music * (1 - duck * 0.8), ctx.currentTime, want > 0 ? 0.05 : 0.4);
}

// Pick the tune of an arena ('courtyard' or 'frost'). The loop carries on
// from the same step, so a change of arena never breaks the beat.
export function setMusicTheme(id) {
  tune = MUSIC_THEMES[id] || MUSIC_THEMES.courtyard;
}

function pumpMusic() {
  if (!ctx || ctx.state !== 'running') return;
  // If the tab slept, do not try to play everything that was missed.
  if (musicNext < ctx.currentTime) musicNext = ctx.currentTime + 0.05;
  while (musicNext < ctx.currentTime + 0.15) {
    if (!muted) musicTick(musicStep, musicNext);
    musicStep = (musicStep + 1) % 128;
    musicNext += stepSeconds();
  }
}

// mode: 'menu', 'fight', 'final' or 'off'
export function setMusic(mode) {
  musicMode = mode;
  if (!ctx) return; // starts once the audio engine is unlocked
  if (!musicBus) {
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.3 * volume.music * (1 - duck * 0.8);
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

// ------------------------------------------------------------------ crowd ---
// The stands, heard: a bed of murmur under the fight - noise shaped into the
// band of many voices, swelling and settling slowly - that roars up when the
// fight gives them something (see crowdLevel in main.js). 0 is silence.
let crowd = null;
export function setCrowd(level) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    if (!crowd) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = 'bandpass';
      low.frequency.value = 650;
      low.Q.value = 0.7;
      const high = ctx.createBiquadFilter();
      high.type = 'bandpass';
      high.frequency.value = 1700;
      high.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // A slow swell, so it breathes like a room full of people.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.23;
      depth.gain.value = 0.25;
      const swell = ctx.createGain();
      swell.gain.value = 1;
      lfo.connect(depth).connect(swell.gain);
      src.connect(low).connect(swell);
      src.connect(high).connect(swell);
      swell.connect(gain).connect(sfxBus);
      src.start();
      lfo.start();
      crowd = { gain, level: -1 };
    }
    const want = Math.max(0, Math.min(1, level));
    if (Math.abs(want - crowd.level) < 0.02) return;
    const rising = want > crowd.level; // a roar comes up fast and dies away slowly
    crowd.level = want;
    crowd.gain.gain.setTargetAtTime(want * 0.22, ctx.currentTime, rising ? 0.08 : 0.6);
  } catch {
    // the crowd stays quiet
  }
}

// ---------------------------------------------------------------- weather ---
// What the weather sounds like, under the fight: rain hissing on stone in the
// courtyard's storm, wind round the summit, sand driven over the ruins. One
// looping noise, shaped per kind, as loud as the weather is strong (0 to 1).
let weather = null;
const WEATHER_SOUND = {
  rain: { type: 'highpass', freq: 1500, q: 0.4, sway: 0, gain: 0.08 },
  snow: { type: 'bandpass', freq: 420, q: 1.2, sway: 240, gain: 0.32 },
  sand: { type: 'bandpass', freq: 1100, q: 0.9, sway: 420, gain: 0.2 },
  petals: { type: 'bandpass', freq: 650, q: 0.8, sway: 300, gain: 0.16 }, // a soft evening wind
};
export function setWeather(kind, level) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    if (!weather) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // A slow wobble of the filter: gusts.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.17;
      lfo.connect(depth).connect(filter.frequency);
      src.connect(filter).connect(gain).connect(sfxBus);
      src.start();
      lfo.start();
      weather = { filter, gain, depth, kind: null, level: -1 };
    }
    const w = WEATHER_SOUND[kind];
    if (w && kind !== weather.kind) {
      weather.kind = kind;
      weather.filter.type = w.type;
      weather.filter.frequency.value = w.freq;
      weather.filter.Q.value = w.q;
      weather.depth.gain.value = w.sway;
    }
    const want = w ? Math.max(0, Math.min(1, level)) * w.gain : 0;
    if (Math.abs(want - weather.level) < 0.004) return;
    weather.level = want;
    weather.gain.gain.setTargetAtTime(want, ctx.currentTime, 1.2);
  } catch {
    // the weather stays silent
  }
}

// Is there a sound by this name? (play() ignores unknown names quietly.)
export const hasSound = (name) => Object.hasOwn(SOUNDS, name);
// Each arena's footstep (by what its floor is).
export const STEP_SOUND = { courtyard: 'stepStone', frost: 'stepSnow', dunes: 'stepSand', blossom: 'stepTile' };

export function play(name) {
  if (!ctx || muted || ctx.state !== 'running') return;
  try {
    pitch = VARIED.has(name) ? 0.9 + Math.random() * 0.2 : 1;
    SOUNDS[name]?.();
  } catch {
    // a failed sound must never break the game
  }
}

// ------------------------------------------------------------ announcer ---
// A voice that calls the fight - "Round two", "Fight!", "K.O.", "Ruko wins!" -
// spoken by the browser's own speech synthesis, so it costs nothing and works
// offline; how it sounds depends on the device's voices. It can be switched
// off in Settings, and it is silent when the sound is off.
let announcer = true;
try {
  announcer = localStorage.getItem('gd-arena-announcer') !== 'off';
} catch {
  // remembered nowhere: on by default
}
export const isAnnouncer = () => announcer;
export function setAnnouncer(on) {
  announcer = on;
  try {
    localStorage.setItem('gd-arena-announcer', on ? 'on' : 'off');
    if (!on) window.speechSynthesis?.cancel();
  } catch {
    // not remembered
  }
}
let voice = null;
export function announce(text) {
  if (!announcer || muted || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // the newest call wins: never a queue of stale ones
    if (!voice) {
      const all = synth.getVoices();
      voice = all.find((v) => /^en[-_]GB/i.test(v.lang)) || all.find((v) => /^en/i.test(v.lang)) || null;
    }
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-GB';
    u.rate = 1.05;
    u.pitch = 0.7; // a deeper voice, closer to an arena announcer
    u.volume = Math.min(1, volume.sfx * 1.1);
    synth.speak(u);
  } catch {
    // no voice here; the banners still say it
  }
}

// ------------------------------------------------------------- ambience ---
// Now and then a bird (by day) or a cricket (at night) is heard around the
// arena: 'birds', 'crickets' or null, set every frame like the weather.
let nextLife = 0;
export function setAmbience(kind) {
  if (!kind || !ctx || ctx.state !== 'running' || muted) return;
  const now = ctx.currentTime;
  if (now < nextLife) return;
  if (nextLife === 0) {
    nextLife = now + 1 + Math.random() * 2; // not the very moment it starts
    return;
  }
  play(kind === 'birds' ? 'chirp' : 'cricket');
  nextLife = now + (kind === 'birds' ? 2.5 + Math.random() * 5 : 1.2 + Math.random() * 2.4);
}
