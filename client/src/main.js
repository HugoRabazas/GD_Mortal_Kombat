// The app shell: builds the page, runs the frame loop and moves between the
// screens (menu -> fighter select -> fight -> result).

import { FIGHTERS, getFighter, lookColors, dressColors } from '../../shared/fighters.js';
import { ritualSounds } from './render/fighter.js';
import { awardsFor as brawlAwards } from './awards.js';
import { howWon } from './outcome.js';
import { ARENA, INPUT, MODES, RULES, TICK_RATE } from '../../shared/constants.js';
import { createAI, aiInput } from '../../shared/ai.js';
import { LESSONS, lessonById, stepsDone, tutorPartner, drummer, comboer, partnerTape } from '../../shared/tutorial.js';
import { loadAssets, headUrls } from './assets.js';
import { createStage } from './stage.js';
import { createGame } from './game.js';
import { handleEvents, setBuzz } from './effects.js';
import { initKeyboard, initTouch, readKeys, readTouch, readPad, padStartPressed, padMenu, padStyle, hasPad, setCapture, setTouchLive, lastDevice, buttonChips } from './input.js';
import { createTouchLayout } from './touchLayout.js';
import { unlockAudio, play, isMuted, setMuted, isAnnouncer, setAnnouncer, setMusic, setMusicTheme, setCrowd, duckMusic, setWeather, setAmbience, getVolume, setVolume, STEP_SOUND } from './audio.js';
import { setFloor, showBanner } from './render/fx.js';
import { THEMES } from './render/themes.js';
import { createOnline } from './net/online.js';
import { ARENAS, isArenaId } from './arenas.js';
import { createTape, frameIndex } from './replay.js';

const tape = createTape(); // the last seconds of the fight, for the knockout's replay

// Online play exists only in the web build, which is told where the bus lives
// (see scripts/build.js). Adding ?net=local to the address swaps the internet
// for a same-browser bus, which is what the automated tests use.
const NET = typeof __NET__ === 'undefined' || !__NET__ ? null : new URLSearchParams(location.search).get('net') === 'local' ? { local: true } : __NET__;
const BUILD = typeof __BUILD__ === 'undefined' ? 'dev' : __BUILD__;
// With ?debug in the address, the running game is reachable from the browser
// console (and from the automated checks) as window.gd. Nothing else changes.
const DEBUG = new URLSearchParams(location.search).has('debug');
// An invite link ends in #room-ABCD: opening it takes you straight to that room.
const invited = () => (/^#room-([A-Za-z0-9]{2,8})$/.exec(location.hash) || [])[1] || null;
// While in a room its code stays in the address (#room-ABCD), so a reload -
// easy to do by accident on a phone - comes back to the same room with one
// press, and the address bar itself is an invite. Cleared on leaving.
function roomInAddress(code) {
  try {
    history.replaceState(null, '', location.pathname + location.search + (code ? `#room-${code}` : ''));
  } catch {
    // some viewers do not allow it; the invite button still works
  }
}
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const root = document.getElementById('app');
root.innerHTML = `
  <div id="stage">
    <canvas id="gl" aria-hidden="true"></canvas>
    <canvas id="hud" role="img" aria-label="GD Arena fight"></canvas>
    <button id="pause-btn" class="chip" type="button" hidden>Pause</button>
    <aside id="drill" hidden aria-live="polite"></aside>
  </div>
  <div id="touch" hidden>
    <div id="stickzone" aria-hidden="true"></div>
    <div id="stick" class="ctl" data-ctl="stick" aria-label="Move"><div id="knob"></div></div>
    <button type="button" class="ctl tb tb-ult" data-ctl="ult" data-bit="256">ULT</button>
    <button type="button" class="ctl tb tb-sp" data-ctl="sp" data-bit="128">SP</button>
    <button type="button" class="ctl tb tb-blk" data-ctl="blk" data-bit="64">BLK</button>
    <button type="button" class="ctl tb tb-k" data-ctl="k" data-bit="32">K</button>
    <button type="button" class="ctl tb tb-p" data-ctl="p" data-bit="16">P</button>
    <button type="button" class="ctl tb tb-jmp" data-ctl="jmp" data-bit="512">JMP</button>
    <button type="button" class="ctl tb tb-grb" data-ctl="grb" data-bit="1024">GRAB</button>
    <p id="turn">Turn your phone sideways for a bigger view.</p>
  </div>
  <div id="ui"></div>
  <p id="toast" role="status" hidden></p>
`;

const $ = (sel) => root.querySelector(sel);
const stageEl = $('#stage');
const ui = $('#ui');
const touchEl = $('#touch');
const pauseBtn = $('#pause-btn');
const drillEl = $('#drill');
const toastEl = $('#toast');

// A short line at the top of the screen that goes away by itself.
let toastTimer = 0;
function toast(text, ms = 3600) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

// Controllers: say when one arrives (browsers only report it after a button
// is pressed), and pause a fight if one is unplugged mid-fight - nobody
// should be beaten while reaching for a cable. Online fights cannot pause.
window.addEventListener('gamepadconnected', () => {
  const ok = PAD_NAMES[padStyle()].j;
  toast(`Controller connected. Stick and ${ok} in the menus; Start pauses a fight.`);
});
window.addEventListener('gamepaddisconnected', () => {
  if (app.screen === 'fight' && app.game && app.mode !== 'online') {
    togglePause();
    toast('Controller disconnected: the fight is paused.');
  } else {
    toast('Controller disconnected.');
  }
});
const spBtn = $('.tb-sp');
const ultBtn = $('.tb-ult');

// The arcade ladder: who you meet at each stage and how tough they are.
// Stage three breaks the run of duels: a brawl against every rival at once,
// where only a clear first place goes through.
const STAGES = [
  { level: 'easy', mod: null },
  { level: 'normal', mod: null },
  { level: 'easy', mod: null, brawl: true },
  { level: 'hard', mod: { health: 1.15, power: 1.05 } },
  { level: 'boss', mod: { health: 1.3, power: 1.1, enrage: true }, boss: true },
];

const app = {
  screen: 'loading',
  mode: 'arcade', // 'arcade', 'arena' and 'quick' are single player, 'versus' is two players
  vsArena: false, // in 2-player mode: a duel, or a brawl with two CPU fighters added
  dummy: 'still', // training partner: 'still', 'block', 'beat', 'combo' or 'fight'
  picks: [FIGHTERS[0].id, FIGHTERS[1 % FIGHTERS.length].id],
  level: 'auto', // CPU difficulty: 'auto' follows the player (see stepAutoLevel)
  place: ARENAS[0].id, // the arena the player chose; the fight behind the menus shows it
  fightPlace: ARENAS[0].id, // the arena of the fight being played
  arcade: null, // { ladder, stage, score, retries, gained }
  game: null, // the fight being played, if any
  demo: null, // the CPU-vs-CPU fight that plays behind the menus
  resultShown: false,
  lastIntroPt: -1, // how far into a round's announcement the last frame was (for the rituals' sounds)
  arrangeFrom: 'menu',
  online: null, // the connection to the alliance lobby, once the player goes online
  // Fights won by each player in the current online room, counted on this
  // screen from the results everyone sees: { code, slots, wins: { id: n } }.
  roomWins: { code: '', slots: [], wins: {} },
  nick: '',
  fill: true, // online host option: fill empty places with CPU fighters
  notice: '',
  // On-screen buttons start switched on for phones and tablets. A touch
  // laptop keeps them off until the screen is actually touched. The menu has
  // a switch for anyone the guess gets wrong.
  touch:
    window.matchMedia?.('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(any-pointer: fine)').matches) ||
    false,
};
// The costume picked for each of the two selectable places (see `looks` in
// the roster), remembered on the device.
app.looks = [0, 0];
try {
  const saved = JSON.parse(localStorage.getItem('gd-arena-looks') || '[0,0]');
  if (Array.isArray(saved)) app.looks = [0, 1].map((i) => (Number.isInteger(saved[i]) ? saved[i] : 0));
} catch {
  // the fighters' own colours
}

// Two swatches per costume: the main colour and the accent, as a split disc.
function lookButtons(id, current, act, slot = '') {
  const f = getFighter(id);
  const looks = f.looks || [{ name: 'Standard' }];
  if (looks.length < 2) return '';
  return `<span class="looks" role="group" aria-label="Costume">${looks
    .map((l, i) => {
      const c = lookColors(id, i);
      return `<button type="button" class="look ${i === current ? 'on' : ''}" data-act="${act}" ${slot !== '' ? `data-slot="${slot}"` : ''} data-id="${i}" aria-pressed="${i === current}" title="${l.name}" style="--a:${c.primary};--b:${c.accent}"></button>`;
    })
    .join('')}</span>`;
}

let stage = null;
let touchLayout = null;
if (DEBUG) window.gd = app;
if (DEBUG) window.gdTape = tape;

try {
  const saved = localStorage.getItem('gd-arena-place');
  if (isArenaId(saved)) app.place = saved;
} catch {
  // storage unavailable: the first arena
}

// The row of buttons that picks the arena.
function placePicker() {
  return `<div class="seg places" role="group" aria-label="Arena">${ARENAS.map((a) => `<button type="button" class="${app.place === a.id ? 'on' : ''}" data-act="place" data-id="${a.id}" aria-pressed="${app.place === a.id}" title="${a.name}"><span class="long">${a.name}</span><span class="short">${a.short}</span></button>`).join('')}</div>`;
}

// One tip each time the menu is shown, in turn, so the deeper rules surface
// over time without a manual. Written for the controls in use.
const TIPS = [
  (c) => `Tip: hit a rival while they wind up a blow for a <b>counter</b> - a quarter more damage.`,
  (c) => `Tip: press <kbd>${c.b}</kbd> just before a blow lands for a <b>perfect guard</b>; heavy attackers are left reeling.`,
  (c) => `Tip: under a quarter of your health your energy fills faster. A round is never over until it is over.`,
  (c) => `Tip: <kbd>${c.g}</kbd> is a <b>throw</b>: it lifts the rival over your head, and it goes straight through a guard.`,
  (c) => `Tip: <kbd>${c.b}</kbd> and a direction is a <b>dodge roll</b> - blows pass through you for a moment.`,
  (c) => `Tip: knock a rival into the <b>ring of fire</b> as it closes in for extra damage.`,
  (c) => `Tip: <kbd>${c.g}</kbd> a rival with the fire beyond them for a <b>fire toss</b> into the flames.`,
  (c) => `Tip: gold crystals give energy, green ones health. Walk over one to take it.`,
  (c) => `Tip: a guard only stops what comes from the front. Get behind a blocking rival.`,
  (c) => `Tip: in a brawl, do not stand between two rivals.`,
  (c) => `Tip: <kbd>${c.p}</kbd> <kbd>${c.p}</kbd> <kbd>${c.k}</kbd> launches a rival into the air - hold <kbd>${c.j}</kbd> to chase and <b>juggle</b> them.`,
  (c) => `Tip: hold <kbd>${c.k}</kbd> to charge a <b>guard-breaker</b>; let go and it smashes a guard open.`,
  (c) => `Tip: <kbd>${c.g}</kbd> with the rival out of reach is your fighter's <b>signature move</b> for crossing the gap.`,
  (c) => `Tip: <kbd>${c.s}</kbd> in the air is your special's own <b>air version</b>. With <kbd>${c.p}</kbd> too, and two thirds of the bar: its <b>EX</b> version.`,
  (c) => `Tip: <kbd>${c.p}</kbd> right after a perfect guard is a <b>riposte</b> that opens a combo.`,
  (c) => `Tip: a rival hiding behind a guard? Hold <kbd>${c.b}</kbd>, then <kbd>${c.k}</kbd>: a <b>guard sweep</b> under it.`,
  (c) => `Tip: <kbd>${c.k}</kbd> as a thrown rival lands is a <b>pursuit</b> - and <kbd>${c.b}</kbd> on the floor (a quick rise) escapes one.`,
  (c) => `Tip: getting up, hold <kbd>${c.b}</kbd> and a direction to <b>roll clear</b> as you rise.`,
  (c) => `Tip: caught in a combo? <kbd>${c.b}</kbd> + <kbd>${c.s}</kbd> from its second blow <b>bursts</b> out of it, for half your energy.`,
  (c) => `Tip: new to a move? The <b>Tutorial</b> has a short lesson for it.`,
  () => `Tip: pause and press <b>Photo</b> to turn the camera round the fight and save a picture.`,
  () => `Tip: <b>Quick fight</b> on <b>Survival</b>: rival after rival, each harder. How many in a row can you beat?`,
  () => `Tip: a move that keeps beating you? In <b>Training</b>, pause and <b>Record partner</b>: do it to yourself, then practise against it.`,
  // Only on the website, on a touch screen, when not opened from the home screen.
  () => (NET && app.touch && !installed ? `Tip: add GD Arena to your <b>home screen</b> to play full screen.` : ''),
];
let tipAt = Math.floor(Math.random() * TIPS.length);
function menuTip() {
  // Skip a tip that does not apply here (it says nothing).
  for (let i = 0; i < TIPS.length; i++) {
    tipAt = (tipAt + 1) % TIPS.length;
    const tip = TIPS[tipAt](controlNames());
    if (tip) return tip;
  }
  return '';
}

// True until this device has started its first fight.
// What changed lately, for players coming back: shown in place of the tip
// on the first few visits to the menu after it changes (never to newcomers,
// who get the Tutorial note). Change NEWS.id with the text.
const NEWS = {
  id: 'real-arenas-bodies',
  text: () => `New: arenas of <b>real stone, cloth and light</b> - and try the <b>realistic bodies</b> in Settings (beta).`,
};
function newsLine() {
  try {
    const seen = JSON.parse(localStorage.getItem('gd-arena-news') || '{}');
    const n = seen.id === NEWS.id ? seen.n : 0;
    if (n >= 3) return '';
    if (app.newsShownFor !== NEWS.id) {
      // (counted once per opening of the game, not per redraw)
      app.newsShownFor = NEWS.id;
      localStorage.setItem('gd-arena-news', JSON.stringify({ id: NEWS.id, n: n + 1 }));
    }
    return NEWS.text(controlNames());
  } catch {
    return '';
  }
}

function isNewcomer() {
  try {
    return localStorage.getItem('gd-arena-played') !== '1';
  } catch {
    return false;
  }
}

function bestScore() {
  try {
    return Number(localStorage.getItem('gd-arena-best')) || 0;
  } catch {
    return 0;
  }
}

function saveBest(score) {
  try {
    if (score > bestScore()) localStorage.setItem('gd-arena-best', String(score));
  } catch {
    // not saved on this device
  }
}

// ---------------------------------------------------------------- layout ---

const isPortrait = () => root.clientHeight > root.clientWidth;
const LESSON_ROOM = 86; // px kept under an upright arena for the lesson panel (style.css)

function layout() {
  const style = getComputedStyle(root);
  const availW = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  let availH = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const portrait = isPortrait();
  root.classList.toggle('portrait', portrait);
  // In portrait the touch controls sit under the stage and need their own
  // room - and so does the tutorial's lesson panel, between the two.
  const lesson = portrait && !touchEl.hidden && !drillEl.hidden;
  root.classList.toggle('lessoning', lesson);
  if (portrait && !touchEl.hidden) availH -= 236 + (lesson ? LESSON_ROOM : 0);
  const w = Math.max(160, Math.floor(Math.min(availW, (availH * 16) / 9)));
  const h = Math.floor((w * 9) / 16);
  stageEl.style.width = `${w}px`;
  stageEl.style.height = `${h}px`;
  // Held sideways, the 3D arena reaches past the stage to the screen's edges
  // (an even margin all round the stage, so the view stays centred).
  let fullW = w;
  let fullH = h;
  if (!portrait) {
    const a = root.getBoundingClientRect();
    const r = stageEl.getBoundingClientRect();
    fullW = w + 2 * Math.ceil(Math.max(0, r.left - a.left, a.right - r.right));
    fullH = h + 2 * Math.ceil(Math.max(0, r.top - a.top, a.bottom - r.bottom));
  }
  const wide = stage?.resize(w, h, fullW, fullH);
  root.classList.toggle('bleed', !!wide);
  touchLayout?.apply();
}

// --------------------------------------------------------------- screens ---

const head = (id, cls = '') => `<img class="head ${cls}" src="${headUrls.get(id)}" alt="" />`;
// Toggles show their state after a colon ("Sound: on"), like "Graphics: auto",
// so the label never reads as an order to switch it.
// (The menu's footer uses the short form, which fits a phone held sideways.)
const touchLabel = (short) => `${short ? 'Touch' : 'Touch buttons'}: ${app.touch ? 'on' : 'off'}`;
const soundLabel = () => `Sound: ${isMuted() ? 'off' : 'on'}`;
const announcerLabel = () => `Announcer: ${isAnnouncer() ? 'on' : 'off'}`;
const points = (n) => n.toLocaleString('en-US');

function buildLadder(playerId) {
  const others = FIGHTERS.filter((f) => f.id !== playerId);
  const pool = others.length ? others : FIGHTERS;
  // Rivals in a fresh random order (never the same ladder twice), then a
  // mirror match if there is a stage left to fill.
  const order = pool.map((f) => f.id).sort(() => Math.random() - 0.5).slice(0, STAGES.length - 1);
  while (order.length < STAGES.length - 1) order.push(order.length % 2 ? playerId : pool[order.length % pool.length].id);
  order.push(order[0]); // the boss is your first rival again, powered up
  return STAGES.map((st, i) => ({ ...st, char: order[i], rivals: st.brawl ? rivalsFor([playerId]) : null }));
}

// Opened from a phone's home screen, the game is full screen already.
const installed = !!window.matchMedia?.('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
// A full-screen switch wherever a player may be (the menu, the lobby, a room,
// the pause screen): someone who came in through an invite link never sees
// the menu. Not offered where the browser cannot do it (an iPhone's Safari).
const canFullscreen = () => !installed && !!(document.fullscreenEnabled || document.documentElement.requestFullscreen);
const fullscreenButton = (cls = 'btn quiet') => (canFullscreen() ? `<button type="button" class="${cls}" data-act="fullscreen">${document.fullscreenElement ? 'Exit full screen' : 'Full screen'}</button>` : '');
// On a phone, going into an online fight (Ready / Start) also goes full
// screen: the tap is the gesture the browser asks for.
function fullscreenForFight() {
  if (!app.touch || document.fullscreenElement || !canFullscreen()) return;
  document.documentElement
    .requestFullscreen?.()
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

function menuScreen() {
  const best = bestScore();
  return `
    <section class="screen menu">
      <h1 class="brand"><span>GD</span> Arena</h1>
      <p class="tag">Alliance members step into the ring. First to two rounds wins.</p>
      <div class="stack">
        ${NET ? '<button type="button" class="btn primary" data-act="online">Online <small>fight the alliance</small></button>' : ''}
        <button type="button" class="btn ${NET ? '' : 'primary'}" data-act="arena">Arena <small>4-fighter brawl · 3 rounds</small></button>
        <button type="button" class="btn" data-act="arcade">Arcade <small>single player · ${STAGES.length} duels</small></button>
        <button type="button" class="btn" data-act="quick">Quick Fight <small>one duel vs CPU</small></button>
        <button type="button" class="btn" data-act="versus">2 Players <small>keyboard or gamepads</small></button>
        <div class="pair">
          <button type="button" class="btn quiet" data-act="tutorial">Tutorial <small>${LESSONS.filter(lessonComplete).length ? `${LESSONS.filter(lessonComplete).length} of ${LESSONS.length} lessons` : 'step by step'}</small></button>
          <button type="button" class="btn quiet" data-act="training">Training <small>free practice</small></button>
        </div>
        <button type="button" class="btn quiet" data-act="help">How to play</button>
      </div>
      ${best ? `<p class="best">Arcade best <b>${points(best)}</b></p>` : ''}
      ${isNewcomer() ? '<p class="note">New here? The <b>Tutorial</b> teaches every move, step by step.</p>' : `<p class="note tip">${newsLine() || menuTip()}</p>`}
      <div class="foot">
        <button type="button" class="link" data-act="settings">Settings</button>
        <button type="button" class="link" data-act="record">Record</button>
        <button type="button" class="link" data-act="touch" data-short="1" aria-pressed="${app.touch}">${touchLabel(true)}</button>
        <button type="button" class="link" data-act="arrange">Arrange buttons</button>
        ${fullscreenButton('link')}
      </div>
      <p class="ver">version ${BUILD}</p>
    </section>`;
}

// Power, speed and health as bars, so fighters can be compared at a glance.
function statBars(f) {
  const bar = (label, k) => `<div><dt>${label}</dt><dd><span class="meter"><i style="width:${Math.round(Math.min(1, Math.max(0.15, k)) * 100)}%"></i></span></dd></div>`;
  return `<dl class="stats">
    ${bar('Power', (f.stats.power - 0.8) / 0.4)}
    ${bar('Speed', (f.stats.speed - 0.7) / 0.6)}
    ${bar('Health', (f.stats.health - 80) / 40)}
  </dl>`;
}

function slotCard(slot, who) {
  const f = getFighter(app.picks[slot]);
  const c = lookColors(f.id, app.looks[slot] ?? 0); // the card wears the chosen costume
  return `
    <div class="slot" style="--tint:${c.primary};--ring:${c.accent}">
      <span class="who">${who}</span>
      ${head(f.id, 'big')}
      <strong class="name">${f.name}</strong>
      <span class="title">${f.title}</span>
      ${statBars(f)}
      <dl class="moves">
        <div><dt>Special</dt><dd>${f.special.name}</dd></div>
        <div><dt>Finisher</dt><dd>${f.super.name}</dd></div>
      </dl>
      <div class="picker" role="group" aria-label="${who} fighter">
        ${FIGHTERS.map(
          (o) => `<button type="button" class="pick ${o.id === f.id ? 'on' : ''}" data-act="pick" data-slot="${slot}" data-id="${o.id}" aria-pressed="${o.id === f.id}" title="${o.name}">${head(o.id)}</button>`,
        ).join('')}
        <button type="button" class="pick rand" data-act="pickRandom" data-slot="${slot}" title="Random fighter" aria-label="Random fighter"><span class="head" aria-hidden="true">?</span></button>
        ${lookButtons(f.id, app.looks[slot] ?? 0, 'look', slot)}
      </div>
    </div>`;
}

function ladderCard() {
  const ladder = buildLadder(app.picks[0]);
  const tag = { easy: 'Easy', normal: 'Normal', hard: 'Hard', boss: 'Boss' };
  return `
    <div class="ladder">
      <span class="who">The ladder</span>
      <ol>
        ${ladder
          .map(
            (st, i) =>
              st.brawl
                ? `<li class="brawl">
              <span class="num">${i + 1}</span><span class="faces">${st.rivals.map((id) => head(id)).join('')}</span>
              <span class="lname">Brawl</span>
              <span class="ltag">All at once</span>
            </li>`
                : `<li class="${st.boss ? 'boss' : ''}">
              <span class="num">${i + 1}</span>${head(st.char)}
              <span class="lname">${getFighter(st.char).name}</span>
              <span class="ltag">${tag[st.level]}</span>
            </li>`,
          )
          .join('')}
      </ol>
    </div>`;
}

// The fighters the CPU will play in a brawl: everyone the humans did not pick.
// With more fighters than places, the rivals come in a shuffled order, drawn
// again after every fight (so the card on the select screen shows who you
// will really meet).
let rivalOrder = [];
function shuffleRivals() {
  rivalOrder = FIGHTERS.map((f) => f.id).sort(() => Math.random() - 0.5);
}
shuffleRivals();

function rivalsFor(taken) {
  const rest = rivalOrder.filter((id) => !taken.includes(id));
  const need = 4 - taken.length;
  while (rest.length < need) rest.push(FIGHTERS[rest.length % FIGHTERS.length].id);
  return rest.slice(0, need);
}

function rivalsCard(taken) {
  return `
    <div class="ladder">
      <span class="who">Your rivals</span>
      <ol>
        ${rivalsFor(taken)
          .map((id) => `<li><span class="num">vs</span>${head(id)}<span class="lname">${getFighter(id).name}</span><span class="ltag">CPU</span></li>`)
          .join('')}
      </ol>
      <p class="rules aside">Everyone fights at once. Three rounds; each round scores by how long you last. Level on points is a shared place.</p>
    </div>`;
}

function selectScreen() {
  const levels = [['auto', `Auto · ${LEVEL_NAMES[autoLevel()]}`], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
  const { mode } = app;
  const names = mode === 'versus' ? ['Player 1', 'Player 2'] : mode === 'training' ? ['You', 'Training partner'] : ['You', 'CPU'];
  const seg = (items, current, act) => `<div class="seg" role="group">${items.map(([id, label]) => `<button type="button" class="${current === id ? 'on' : ''}" data-act="${act}" data-id="${id}" aria-pressed="${current === id}">${label}</button>`).join('')}</div>`;
  let second;
  if (mode === 'arcade') second = ladderCard();
  else if (mode === 'arena') second = rivalsCard([app.picks[0]]);
  else second = `<span class="vs" aria-hidden="true">VS</span>${slotCard(1, names[1])}`;
  return `
    <section class="screen select">
      <h2>${mode === 'arcade' || mode === 'arena' ? 'Choose your fighter' : 'Choose your fighters'}</h2>
      <div class="versus">
        ${slotCard(0, names[0])}
        ${second}
      </div>
      <div class="row">
        ${mode === 'quick' ? seg([...levels, ['survival', 'Survival']], app.level, 'level') : mode === 'arena' ? seg(levels, app.level === 'survival' ? 'auto' : app.level, 'level') : ''}
        ${mode === 'training' ? seg([['still', 'Still'], ['block', 'Blocks'], ['beat', 'Kicks'], ['combo', 'Strings'], ['fight', 'Fights back']], app.dummy, 'dummy') : ''}
        ${mode === 'versus' ? seg([['duel', 'Duel'], ['brawl', 'Brawl with 2 CPU']], app.vsArena ? 'brawl' : 'duel', 'vsKind') : ''}
        ${placePicker()}
      </div>
      ${mode === 'training' ? `<p class="note aside">No clock, and health and energy refill, so you can try every move. ${app.dummy === 'beat' ? 'Your partner walks up and kicks on a steady beat: raise your guard just before the kick lands for a perfect guard, or roll through it.' : app.dummy === 'combo' ? 'Your partner walks up and throws three-punch strings: block them, or from the second punch press block and special together to burst out.' : 'Pause to leave.'}</p>` : ''}
      ${mode === 'versus' && app.touch ? '<p class="note">Two players need a keyboard or gamepads: the on-screen buttons control one fighter only.</p>' : ''}
      ${mode === 'arcade' ? '<p class="note aside">The ladder moves through the arenas, one after another.</p>' : ''}
      <div class="row">
        <button type="button" class="btn quiet" data-act="menu">Back</button>
        <button type="button" class="btn primary" data-act="fight">${mode === 'arcade' ? 'Start' : 'Fight'}</button>
      </div>
    </section>`;
}

function helpScreen() {
  // The column of the controls in use is lit: keyboard, gamepad or the screen.
  const d = lastDevice() ?? (app.touch ? 'touch' : 'keys');
  const lit = d === 'pad' ? 4 : d === 'touch' && app.touch ? 5 : 1;
  const cell = (i, v, tag = 'td') => `<${tag}${i === lit ? ' class="now"' : ''}>${v}</${tag}>`;
  // Yours comes first: on a narrow screen the table scrolls sideways, and the
  // touch column (last) was off the edge of the very phones that use it.
  const order = [lit, ...[1, 2, 3, 4, 5].filter((i) => i !== lit)];
  const row = (what, ...cols) => `<tr><th scope="row">${what}</th>${order.map((i) => cell(i, cols[i - 1])).join('')}</tr>`;
  const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');
  // With a controller connected, its own buttons; otherwise the two common names.
  const pad = hasPad() ? PAD_NAMES[padStyle()] : null;
  const heads = ['Single player', '2P · Player 1', '2P · Player 2', pad ? { xbox: 'Xbox pad', ps: 'PlayStation pad', nintendo: 'Nintendo pad' }[padStyle()] : 'Gamepad', 'Touch'];
  return `
    <section class="screen help">
      <h2>How to play</h2>
      <div class="scroll">
        <table>
          <thead><tr><th></th>${order.map((i) => cell(i, heads[i - 1] + (i === lit ? ' · yours' : ''), 'th')).join('')}</tr></thead>
          <tbody>
            ${row('Walk', `${k('W', 'A', 'S', 'D')} or arrows`, k('W', 'A', 'S', 'D'), 'Arrows', 'Stick / D-pad', 'Stick')}
            ${row('Jump', `${k('Space')} or ${k('U')}`, k('Space'), k('U'), pad ? k(pad.j) : 'A / Cross', k('JMP'))}
            ${row('Punch', `${k('J')} or ${k('F')}`, k('F'), k('J'), pad ? k(pad.p) : 'X / Square', k('P'))}
            ${row('Kick', `${k('K')} or ${k('G')}`, k('G'), k('K'), pad ? k(pad.k) : 'B / Circle', k('K'))}
            ${row('Block', `${k('L')} or ${k('H')}`, k('H'), k('L'), pad ? `${k(pad.b)} or ${k(pad.b2)}` : 'LB / LT', k('BLK'))}
            ${row('Throw', `${k('M')} or ${k('V')}`, k('V'), k('M'), pad ? k(pad.g) : 'R3 / RS', k('GRAB'))}
            ${row('Special', `${k('I')} or ${k('T')}`, k('T'), k('I'), pad ? k(pad.s) : 'Y / Triangle', k('SP'))}
            ${row('Finisher', `${k('O')} or ${k('Y')}`, k('Y'), k('O'), pad ? `${k(pad.u)} or ${k(pad.u2)}` : 'RB / RT', k('ULT'))}
          </tbody>
        </table>
      </div>
      <ul class="tips">
        <li><b>Walk anywhere</b> on the arena: left, right, into the depth and back. Attacks turn you towards the nearest rival, so you do not need perfect aim.</li>
        <li><b>Strings</b>: punch, punch, punch - a <b>jab</b>, a <b>second punch</b> and a <b>third punch</b> - knocks down; punch, punch, kick <b>launches</b> the rival into the air (hold jump to chase and <b>juggle</b> them); punch, kick is a <b>hook kick</b> that spins them round (then punch for a <b>spinning backfist</b>, kick to launch); kick, kick a roundhouse; kick, punch a stepping <b>elbow</b> that carries on into either ender. Each blow must land for the next. A blow that lands can also be <b>cancelled into your special</b>.</li>
        <li><b>On the run</b> (a few steps, the stick still held): punch is a <b>lunging straight</b>, kick a <b>slide</b> along the floor, and jump then kick a <b>flying knee</b>.</li>
        <li><b>In the air</b>: jump again for a <b>double jump</b> (then kick: a <b>dive kick</b> down at the rival, which lands heavily if it misses); punch is a <b>diving punch</b> at the rival, kick is a flying kick, grab a <b>stomp</b> straight down - or, with a rival in the air close by, an <b>air throw</b> that drives them into the floor; an air punch that lands flows into an axe kick, a flying kick into a <b>hammer fist</b> that bounces them; special is your <b>air special</b> (with punch, its EX version).</li>
        <li><b>Grab with the rival out of reach</b> is your fighter's <b>signature move</b> for crossing the gap: ${FIGHTERS.map((f) => `${f.name[0] + f.name.slice(1).toLowerCase()}'s ${f.signature.name}`).join(', ')}.</li>
        <li><b>Hold kick</b> to charge a <b>guard-breaker</b>: let go and it smashes a guard open.</li>
        <li><b>Grab</b> (its own button, or punch + kick together) seizes a rival up close, lifts them over your head and slams them down behind you. Short reach, but it goes straight through a guard; in a brawl, anyone can break it with a blow. Kick as they land: a <b>pursuit</b> onto them (a quick rise escapes it).</li>
        <li><b>Block + a direction</b> is a dodge roll: attacks pass through you for a moment; punch or kick late in it strikes out of it - a <b>rising uppercut</b> or a <b>spinning heel kick</b>. Block with the stick straight away from the rival is a quick <b>back-step</b>.</li>
        <li>Seized? Press <b>grab</b> at once to <b>break the throw</b>: both of you stagger apart.</li>
        <li>Caught in a combo? From its second blow, <b>block and special together</b> <b>burst</b> out of it: half your energy, and a shockwave pushes back and staggers whoever is close (no damage), with a moment in which nothing touches you.</li>
        <li>Knocked down? Press <b>block</b> on the floor for a <b>quick rise</b>: you are back up in a blink. Punch or kick while getting up for a <b>rising sweep</b>.</li>
        <li><b>Taunt</b>: block held and grab, standing still. A little energy, but any blow on you is a counter.</li>
        <li>Hit a rival while they are <b>winding up</b> a blow of their own for a <b>counter</b>: a quarter more damage.</li>
        <li>Two punches or two kicks meeting at the same moment <b>clash</b>: neither lands, and both of you are knocked apart.</li>
        <li><b>Block at the last moment</b>, just before a blow lands, for a perfect guard: it costs no health, gives energy, and a kick or another heavy blow leaves the attacker reeling - stars circle their head while you have the chance to punish. Punch at once after it for a <b>riposte</b>, a palm strike that opens a combo, or kick for the launcher. Hold the guard and it is an ordinary block.</li>
        <li>Hits fill your <b>energy</b> bar. A special costs about a third of it - with punch at the same time, two thirds for its <b>EX</b> version, stronger and able to shrug off one blow as it starts; a finisher needs it full.</li>
        <li>Under a quarter of your health you are in your <b>last stand</b>: the energy bar fills half as fast again. A round is not over until it is over.</li>
        <li><b>Block</b> only stops what comes from the front. Raising it turns you to face whoever is already swinging, but a guard held too early stays put: get behind a blocking rival, or step out of the way of a projectile.</li>
        <li><b>Jump</b> over a ground stomp, a slide or a guard sweep - those two are low and go under an ordinary guard (a perfect one still stops them).</li>
        <li><b>Guard sweep</b>: block held, standing still, then kick - a low sweep out of your guard that floors a rival hiding behind theirs.</li>
        <li><b>Crystals</b> appear on the floor: gold gives energy, green gives health. Walk over one to take it.</li>
        <li>As the clock runs down, a <b>ring of fire</b> closes in. Knock a rival into it for extra damage: knocked down into it, they bounce back off it, open to one more blow. A throw with the flames beyond the rival is a <b>fire toss</b> straight into them.</li>
        <li>Each fighter's <b>finisher</b> is their own: a chain of blows with its own scene, ending in a last blow the camera closes in on. In a brawl, once it has landed the others cannot stop it.</li>
        <li><b>Arcade</b>: ${STAGES.length} fights in a row, the last against a boss - who powers up once a round at half health - moving between the arenas as you climb.</li>
        <li><b>Arena</b>: four fighters at once, three rounds. Each round gives 3, 2, 1 or 0 points by how long you last; level on points means a shared place.</li>
        <li>The <b>Tutorial</b> teaches every move in short lessons, each against a partner who does what the lesson needs (one even throws you down so you can practise getting up).</li>
        <li><b>Training</b> in the menu is a fight with no clock where health and energy refill, against a partner who stands still, blocks, kicks on a beat, throws punch strings at you (to burst out of) or fights back. Free practice, with nothing else on screen.</li>
        <li><b>Photo</b> on the pause screen shows the scene alone: drag (or two fingers, the arrow keys, a gamepad's stick) to turn the camera round the fighters, and <b>Save picture</b>.</li>
        ${NET ? '<li><b>Online</b>: pick a name, then make a room or join one in the lobby; <b>Copy invite link</b> brings friends straight in. The room keeps score of who has won, and a reload brings you back to it.</li>' : ''}
        <li><b>Record</b> at the foot of the menu keeps your lifetime tally on this device: wins, best run, best combo and how you do with each fighter.</li>
        <li>A <b>heartbeat</b> means your fighter is nearly out.</li>
        <li>On a phone, use the stick and the buttons on screen. The stick follows your thumb: touch anywhere free on its side of the screen. <b>Arrange buttons</b> lets you drag them where you like. Every button follows its own finger, so two-button moves work with two fingers: hold BLK and tap GRAB to taunt, hold BLK and tap K for a guard sweep, the stick and BLK to roll, hold K to charge the guard-breaker.</li>
        <li>With a <b>gamepad</b> you can also work the menus: stick or D-pad to move, A / Cross to choose, B / Circle to go back. Hints in a fight name your controller's own buttons (Xbox, PlayStation or Nintendo labels).</li>
        <li>Press <kbd>P</kbd>, <kbd>Esc</kbd> or Start to pause.</li>
      </ul>
      <h3 class="sub-head">The fighters</h3>
      <ul class="roster">
        ${FIGHTERS.map((f) => `<li>${head(f.id)}<div><b>${f.name}</b> <span class="title">${f.title}</span><small>${buildWords(f)} · special <b>${f.special.name}</b>: ${SPECIAL_NOTES[f.special.type]} · finisher <b>${f.super.name}</b>: ${SUPER_NOTES[f.super.move] || 'the finisher'}</small></div></li>`).join('')}
      </ul>
      <div class="row"><button type="button" class="btn primary" data-act="menu">Back</button></div>
    </section>`;
}

// What each kind of special move does, in a few words.
// A fighter's build in a few plain words, from their stats.
function buildWords(f) {
  const { power, speed, health } = f.stats;
  const words = [];
  if (speed >= 1.15) words.push('the quickest');
  else if (speed >= 1.08) words.push('quick');
  else if (speed < 0.9) words.push('slow on the feet');
  if (power >= 1.06) words.push('hits hard');
  else if (power < 0.97) words.push('lighter blows');
  if (health >= 112) words.push('hard to knock out');
  return words.length ? words.join(', ') : 'an all-rounder';
}

// What each fighter's own finisher does (by its first stage, `super.move`).
// What each fighter's signature move does (grab with the rival out of reach).
const SIG_NOTES = {
  clawLeap: 'a leap across the gap that rakes down with the claws',
  shadeStep: 'a step through the shadows to the rival\'s back',
  bellyBump: 'a barge, belly first, that shoves the rival far',
  cartwheel: 'a cartwheel in, untouchable as it starts, ending in a kick',
  shieldRam: 'a shoulder-first ram that shoves the rival back',
  moonVault: 'a high vault at the rival that kicks them from above, from well out of reach',
  bladeDash: 'a long dashing slash',
  spinTop: 'a spin across the floor that strikes all round',
};

const SUPER_NOTES = {
  howl: 'a rush; if it lands, a flurry of claws and an uppercut to the moon',
  eclipse: 'vanishes, reappears behind the rival, a shadow flurry and a kick that sends them flying',
  avalanche: 'a charge that leaves the rival reeling, a leap and a belly-first crash that floors everyone near',
  phoenix: 'soars up in a pillar of flame and dives on the rival; best up close',
  oath: 'a charge, three hammer blows and a slam that floors everyone near',
  crescent: 'leaps high and looses a rain of moonlit arrows, shared among the rivals in range',
  cuts: 'a dash, a storm of cuts too quick to see and a rising slash',
  sunburst: 'climbs in a ball of light, then falls like the sun and bursts',
};

const SPECIAL_NOTES = {
  dash: 'a long lunge from well beyond kick range that knocks down',
  bolt: 'a projectile that flies where you face',
  rise: 'a spinning leap that hits all around you',
  quake: 'a stomp that floors everyone near who is not in the air',
};

// The move list on the pause screen: every move of the fighter being played,
// with the keys (or on-screen buttons) this player is actually using.
// The names of the controls on the device the player is using right now.
// The face and shoulder buttons by controller family (same places, own labels).
const PAD_NAMES = {
  xbox: { p: 'X', k: 'B', b: 'LB', s: 'Y', u: 'RB', j: 'A', b2: 'LT', u2: 'RT', g: 'RS' },
  ps: { p: '□', k: '○', b: 'L1', s: '△', u: 'R1', j: '✕', b2: 'L2', u2: 'R2', g: 'R3' },
  nintendo: { p: 'Y', k: 'A', b: 'L', s: 'X', u: 'R', j: 'B', b2: 'ZL', u2: 'ZR', g: 'R stick' },
};

function controlNames() {
  const d = lastDevice() ?? (app.touch ? 'touch' : 'keys');
  if (d === 'pad') return { ...PAD_NAMES[padStyle()], move: 'the stick', walk: 'Stick' };
  if (d === 'touch' && app.touch) return { p: 'P', k: 'K', b: 'BLK', s: 'SP', u: 'ULT', j: 'JMP', g: 'GRAB', move: 'the stick', walk: 'Stick' };
  return { p: 'J', k: 'K', b: 'L', s: 'I', u: 'O', j: 'Space', g: 'M', move: 'W A S D', walk: 'WASD' };
}

function movesCard() {
  const s = app.game?.state;
  if (!s) return '';
  const two = app.mode === 'versus';
  const key = two && lastDevice() !== 'pad' ? { p: 'F / J', k: 'G / K', b: 'H / L', s: 'T / I', u: 'Y / O', j: 'Space / U', g: 'V / M' } : controlNames();
  const k = (...names) => names.map((n) => `<kbd>${n}</kbd>`).join(' ');
  const slots = two ? [0, 1] : [app.mode === 'online' ? Math.max(0, app.online?.mySlot ?? 0) : 0];
  const own2 = two;
  const own = slots
    .map((slot) => {
      const f = getFighter(s.f[slot].char);
      const who = two ? `${f.name}: ` : '';
      return `
        <dt>${k(key.s)}</dt><dd>${who}<b>${f.special.name}</b> - ${SPECIAL_NOTES[f.special.type] || 'special move'}. Costs a third of the energy bar; with ${k(key.p)} too, two thirds for the <b>EX</b> version.</dd>
        <dt>${k(key.u)}</dt><dd>${who}<b>${f.super.name}</b> - ${SUPER_NOTES[f.super.move] || 'the finisher'}. Needs the whole bar.</dd>`;
    })
    .join('');
  // Many moves: shown a group at a time, chosen with the tabs above the list.
  const groups = {
    basics: ['Basics', `
      <dt>${k(key.p)}</dt><dd><b>Punch</b>: quick. Into a rival <b>winding up</b> a blow it is a <b>counter hit</b>, a quarter more damage.</dd>
      <dt>${k(key.k)}</dt><dd><b>Kick</b>: slower than a punch, heavier, longer reach.</dd>
      <dt>${k(key.g)}</dt><dd><b>Throw</b>: seize, lift and slam. Short reach, goes straight through a guard.</dd>
      <dt>${k(key.g)}, ${k(key.k)}</dt><dd><b>Pursuit</b>: a knee onto a thrown rival. A quick rise escapes it.</dd>
      <dt>${k(key.g)}, far</dt><dd><b>${own2 ? 'Signature move' : esc(getFighter(s.f[slots[0]].char).signature.name)}</b>: grab with the rival out of reach - ${SIG_NOTES[getFighter(s.f[slots[0]].char).signature.move]}.</dd>
      <dt>Hold ${k(key.k)}</dt><dd><b>Guard-breaker</b>: charge a kick, let go - it smashes a guard open. Open to blows while charging.</dd>
      <dt>${k(key.b)} + ${k(key.g)}</dt><dd><b>Taunt</b>: standing still - a little energy, but any blow on you is a counter hit.</dd>
      <dt>Ring of fire</dt><dd>Knocked down into it, a rival <b>bounces</b> back off it. ${k(key.g)} with the flames beyond them: a <b>fire toss</b> in.</dd>`],
    strings: ['Strings', `
      <dt>${k(key.p, key.p, key.p)}</dt><dd><b>Three-punch combo</b>: jab, second punch, third punch - the third knocks down.</dd>
      <dt>${k(key.p, key.p, key.k)}</dt><dd><b>Launcher</b>: the rival goes up. Hold ${k(key.j)} to chase and hit them in the air (a <b>juggle</b>, twice at most).</dd>
      <dt>${k(key.p, key.k)}</dt><dd><b>Hook kick</b>: spins the rival round, back to you. Then ${k(key.p)}: a <b>spinning backfist</b> that floors; ${k(key.k)}: the launcher.</dd>
      <dt>${k(key.k, key.k)}</dt><dd><b>Kick string</b>: into a spinning roundhouse that knocks down.</dd>
      <dt>${k(key.k, key.p)}</dt><dd><b>Kick, elbow</b>: steps back in; then ${k(key.p)} floors, ${k(key.k)} launches.</dd>
      <dt>${k(key.p)}, ${k(key.s)}</dt><dd><b>Special cancel</b>: a blow that lands, cut short by the special - it staggers, and hits softer.</dd>`],
    run: ['On the run', `
      <dt>Run + ${k(key.p)}</dt><dd><b>Lunging straight</b>: punch with the stick held after a few steps. Opens the punch string or the hook kick.</dd>
      <dt>Run + ${k(key.k)}</dt><dd><b>Slide</b>: feet first, sweeps the rival off their feet. Low: it goes <b>under a guard</b> - jump it, roll, or guard perfectly.</dd>
      <dt>Run, ${k(key.j)}, ${k(key.k)}</dt><dd><b>Flying knee</b>: jump out of a run and kick - far, fast, knocks down.</dd>`],
    air: ['Air', `
      <dt>${k(key.j)}, ${k(key.j)}</dt><dd><b>Double jump</b>: press again in the air, with a somersault. Then ${k(key.k)}: a <b>dive kick</b> down at them.</dd>
      <dt>Air ${k(key.p)} / ${k(key.k)}</dt><dd>A <b>diving punch</b> angled down, or a <b>flying kick</b>.</dd>
      <dt>Air ${k(key.p)}, ${k(key.k)}</dt><dd><b>Air string</b>: an air punch that lands, then an axe kick chopped down. Air ${k(key.k)}, ${k(key.p)}: a <b>hammer fist</b> that bounces them.</dd>
      <dt>Air ${k(key.g)}</dt><dd><b>Stomp</b>: feet first onto whoever is below - they bounce off the floor. Rooted if it misses. With a rival in the air beside you: an <b>air throw</b>.</dd>
      <dt>Air ${k(key.s)}</dt><dd><b>Air special</b>: your special's own air version. With ${k(key.p)} too: its <b>EX</b> version.</dd>`],
    defence: ['Defence', `
      <dt>${k(key.b)}</dt><dd><b>Block</b> what comes from the front. Raised just before the blow: a <b>perfect guard</b> - then ${k(key.p)} is a <b>riposte</b>, ${k(key.k)} a launcher.</dd>
      <dt>${k(key.b)}, ${k(key.k)}</dt><dd><b>Guard sweep</b>: low, under a guard. A jump or a perfect guard beats it.</dd>
      <dt>${k(key.b)} + move</dt><dd><b>Dodge roll</b> sideways or forwards: attacks pass through you.</dd>
      <dt>${k(key.b)} + away</dt><dd><b>Back-step</b>: a quick hop back.</dd>
      <dt>Roll, ${k(key.p)} / ${k(key.k)}</dt><dd>Late in a roll: a <b>rising uppercut</b>, or a <b>spinning heel kick</b>.</dd>
      <dt>${k(key.g)}</dt><dd>The moment you are seized: a <b>throw escape</b>.</dd>
      <dt>${k(key.b)} + ${k(key.s)}</dt><dd>Caught in a combo: <b>burst</b> out, for half your energy.</dd>
      <dt>${k(key.b)}</dt><dd>On the floor: a <b>quick rise</b>.</dd>
      <dt>Getting up</dt><dd>${k(key.p)}: a <b>rising sweep</b>. ${k(key.b)} + move: <b>roll clear</b>.</dd>`],
    yours: [two ? 'Fighters' : 'Yours', own],
  };
  const tab = groups[app.moveTab] ? app.moveTab : 'basics';
  return `
    <div class="movetabs">
      <div class="tabs" role="tablist">${Object.entries(groups)
        .map(([id, [name]]) => `<button type="button" role="tab" class="tab${id === tab ? ' on' : ''}" aria-selected="${id === tab}" data-act="moveTab" data-id="${id}">${name}</button>`)
        .join('')}</div>
      <dl class="movelist" aria-label="${groups[tab][0]} moves">${groups[tab][1]}</dl>
    </div>`;
}

function pauseScreen() {
  return `
    <section class="screen pause">
      <h2>Paused</h2>
      <div class="cols">
        <div class="stack">
          <button type="button" class="btn primary" data-act="resume">Resume</button>
          ${app.mode === 'online' ? '' : '<button type="button" class="btn" data-act="rematch">Restart fight</button>'}
          ${app.mode === 'training' ? `<button type="button" class="btn" data-act="recordPartner">${app.tape?.mode === 'play' ? 'Record again' : 'Record partner'}</button>` : ''}
          ${app.mode === 'training' && app.tape?.mode === 'play' ? '<button type="button" class="btn" data-act="stopReplay">Stop replay</button>' : ''}
          <button type="button" class="btn" data-act="settings">Settings</button>
          ${app.mode === 'online' ? '' : '<button type="button" class="btn" data-act="photo">Photo</button>'}
          ${fullscreenButton('btn')}
          ${app.mode === 'online' ? '<button type="button" class="btn quiet" data-act="onBack">Back to the room</button>' : '<button type="button" class="btn quiet" data-act="menu">Quit to menu</button>'}
        </div>
        ${movesCard()}
      </div>
    </section>`;
}

function settingsScreen() {
  const slider = (id, label, value) => `
    <label class="slider" for="${id}"><span>${label}</span>
      <input id="${id}" type="range" min="0" max="100" step="5" value="${Math.round(value * 100)}" data-vol="${id === 'vol-music' ? 'music' : 'sfx'}" />
    </label>`;
  return `
    <section class="screen select narrow">
      <h2>Settings</h2>
      ${slider('vol-music', 'Music', getVolume('music'))}
      ${slider('vol-sfx', 'Effects', getVolume('sfx'))}
      <div class="seg" role="group" aria-label="Graphics">${[['auto', 'Graphics: auto'], ['sharp', 'Sharp'], ['fast', 'Fast']].map(([id, label]) => `<button type="button" class="${app.graphics === id ? 'on' : ''}" data-act="graphics" data-id="${id}" aria-pressed="${app.graphics === id}">${label}</button>`).join('')}</div>
      <p class="note">${{ auto: 'Full detail, lowered by itself if the device struggles.', sharp: 'Full detail always: shadows and full sharpness.', fast: 'For slower phones: no shadows, lower resolution, lighter weather.' }[app.graphics]}</p>
      <div class="row">
        <button type="button" class="btn small" data-act="mute" aria-pressed="${!isMuted()}">${soundLabel()}</button>
        <button type="button" class="btn small" data-act="announcer" aria-pressed="${isAnnouncer()}">${announcerLabel()}</button>
        <button type="button" class="btn small" data-act="touch" aria-pressed="${app.touch}">${touchLabel()}</button>
        ${canVibrate() ? `<button type="button" class="btn small" data-act="vibrate" aria-pressed="${vibrateOn()}">${vibrateLabel()}</button>` : ''}
        <button type="button" class="btn small" data-act="body" aria-pressed="${bodyReal()}">${bodyLabel()}</button>
        <button type="button" class="btn small" data-act="arrange">Arrange buttons</button>
      </div>
      <div class="row"><button type="button" class="btn primary" data-act="settingsDone">Done</button></div>
    </section>`;
}

function arrangeScreen() {
  return `
    <section class="screen arrange">
      <p><b>Drag each control</b> to where your thumbs rest. ${isPortrait() ? 'Upright' : 'Sideways'} layout; the other one is saved separately.</p>
      <div class="row">
        <button type="button" class="btn small" data-act="smaller">Smaller</button>
        <button type="button" class="btn small" data-act="bigger">Bigger</button>
        <button type="button" class="btn small quiet" data-act="resetLayout">Reset</button>
        <button type="button" class="btn small primary" data-act="arrangeDone">Done</button>
      </div>
    </section>`;
}

// Training and the tutorial: no clock, health refills, no record kept.
const practising = () => app.mode === 'training' || app.mode === 'tutorial';

// Vibration: the phone buzzes (and a gamepad rumbles) on the blows that
// matter (effects.js buzz). Settings offers to turn it off where the device
// can buzz and has a touch screen; on unless turned off.
// (Both read once and kept: the fight asks every frame.)
let canVib = null;
const canVibrate = () => (canVib ??= typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
let vibOn = null;
const vibrateOn = () => {
  if (vibOn === null) {
    try {
      vibOn = localStorage.getItem('gd-arena-vibrate') !== '0';
    } catch {
      vibOn = true;
    }
  }
  return vibOn;
};
const vibrateLabel = () => `Vibration: ${vibrateOn() ? 'on' : 'off'}`;
// The realistic body (a beta, see rig3d.js): from the next fight, in 3D.
const bodyReal = () => {
  try {
    return localStorage.getItem('gd-arena-body') === 'real';
  } catch {
    return false;
  }
};
const bodyLabel = () => `Bodies: ${bodyReal() ? 'realistic (beta)' : 'classic'}`;

// -------------------------------------------------------------- tutorial ---
// Lessons of a few steps each (shared/tutorial.js), against a partner who
// does what the lesson needs. Progress is kept per lesson on the device.
let lessonMemo = null;
function lessonsDone() {
  if (!lessonMemo) {
    lessonMemo = {};
    try {
      const saved = JSON.parse(localStorage.getItem('gd-arena-lessons') || '{}');
      // Steps are found by their own id wherever they were saved, so a step
      // that moved to another lesson (Combos split in two) stays done.
      const all = new Set(Object.values(saved).flatMap((ids) => (Array.isArray(ids) ? ids : [])));
      for (const l of LESSONS) lessonMemo[l.id] = new Set(l.steps.map((st) => st.id).filter((id) => all.has(id)));
    } catch {
      // nothing remembered
    }
  }
  for (const l of LESSONS) lessonMemo[l.id] ??= new Set();
  return lessonMemo;
}
const lessonComplete = (l) => l.steps.every((st) => lessonsDone()[l.id].has(st.id));

function saveLessons() {
  try {
    const out = {};
    for (const [id, set] of Object.entries(lessonsDone())) out[id] = [...set];
    localStorage.setItem('gd-arena-lessons', JSON.stringify(out));
  } catch {
    // not remembered
  }
}

function lessonsScreen() {
  const all = lessonsDone();
  const me = getFighter(app.picks[0]);
  const first = LESSONS.findIndex((x) => !lessonComplete(x));
  return `
    <section class="screen select narrow lessons">
      <h2>Tutorial</h2>
      <p class="note">Short lessons, each with a partner who does what the lesson needs. Steps tick themselves off as you do them.</p>
      <div class="row who"><span>Fighting as <b>${me.name}</b></span><button type="button" class="btn small quiet" data-act="tutorFighter">Change</button></div>
      <ol class="lesson-list">
        ${LESSONS.map((l, i) => {
          const n = l.steps.filter((st) => all[l.id].has(st.id)).length;
          const full = n === l.steps.length;
          return `<li><button type="button" class="btn${i === first ? ' primary' : ''}" data-act="lesson" data-id="${l.id}">${full ? '✓ ' : ''}${l.title} <small>${n} / ${l.steps.length}</small></button></li>`;
        }).join('')}
      </ol>
      <button type="button" class="btn quiet" data-act="menu">Back</button>
    </section>`;
}

function lessonDoneScreen() {
  const l = lessonById(app.lesson);
  const next = LESSONS[LESSONS.indexOf(l) + 1];
  return `
    <section class="screen select narrow">
      <h2>Lesson complete</h2>
      <p class="note"><b>${l.title}</b>: every step done.${next ? ` Next: <b>${next.title}</b>.` : ' That was the last lesson - try a Quick Fight or the Arcade.'}</p>
      <div class="stack">
        ${next ? `<button type="button" class="btn primary" data-act="lesson" data-id="${next.id}">Next lesson</button>` : ''}
        <button type="button" class="btn${next ? '' : ' primary'}" data-act="lesson" data-id="${l.id}">Again</button>
        <button type="button" class="btn quiet" data-act="tutorial">All lessons</button>
      </div>
    </section>`;
}

// The lesson panel: the title, the steps (ticked as they are done) and how
// to do the next one, in the controls being used.
function drawLesson(justDone) {
  const l = lessonById(app.lesson);
  if (!l) return;
  const done = lessonsDone()[l.id];
  const names = controlNames();
  const k = (id) => `<kbd>${names[id] ?? id}</kbd>`;
  const next = l.steps.find((st) => !app.lessonRun.has(st.id));
  // With the on-screen buttons out (a phone), the panel keeps to the step in
  // hand, so it stays clear of the stick and the arena.
  if (app.touch) {
    const n = l.steps.filter((st) => app.lessonRun.has(st.id)).length;
    const just = l.steps.find((st) => st.id === justDone);
    drillEl.classList.add('compact');
    drillEl.innerHTML = `
      <b>${l.title} <small>${n} / ${l.steps.length}</small></b>
      ${just ? `<p class="got">✓ ${just.name}</p>` : ''}
      ${next ? `<p class="step">${next.name}<span>${next.how(k, names)}</span></p>` : '<p class="got">Lesson complete!</p>'}`;
    return;
  }
  drillEl.classList.remove('compact');
  drillEl.innerHTML = `
    <b>${l.title}</b>
    ${l.intro ? `<p class="intro">${l.intro}</p>` : ''}
    <ol>${l.steps
      .map((st) => {
        const ok = app.lessonRun.has(st.id);
        return `<li class="${ok ? 'ok' : ''}${st.id === justDone ? ' got' : ''}">${ok ? '✓ ' : done.has(st.id) ? '· ' : ''}${st.name}${st === next ? `<span>${st.how(k, names)}</span>` : ''}</li>`;
      })
      .join('')}</ol>
    ${next ? '' : '<p class="got">Lesson complete!</p>'}`;
}

// Tick off the steps of the lesson being played.
function watchLesson(s, events) {
  const l = lessonById(app.lesson);
  if (!l || s.phase !== 'fight') return;
  const got = stepsDone(l, s, events, app.lessonRun);
  if (!got.length) return;
  for (const id of got) {
    app.lessonRun.add(id);
    lessonsDone()[l.id].add(id);
  }
  saveLessons();
  play('pickup');
  drawLesson(got[got.length - 1]);
  if (l.steps.every((st) => app.lessonRun.has(st.id)) && !app.lessonEnd) app.lessonEnd = performance.now() + 1600;
}

// ------------------------------------------------------------ fight stats ---
// Counted from the fight's own events, so they are the same on every screen
// of an online match: damage dealt, blows landed, the longest combo and the
// perfect guards of each fighter.
function tallyFight(g, events) {
  if (app.statsFor !== g) {
    app.statsFor = g;
    app.stats = g.state.f.map(() => ({ dmg: 0, hits: 0, combo: 0, perfect: 0, kinds: new Set() }));
    app.roundEnds = [];
  }
  for (const e of events) {
    // Each round's end, for the winner's line (howWon).
    if (e.type === 'ko' || e.type === 'timeup') app.roundEnds.push({ winner: e.winner, perfect: !!e.perfect });
    const st = app.stats[e.by];
    if (!st) continue;
    if (e.type === 'hit') {
      st.dmg += e.dealt ?? e.dmg;
      st.hits++;
      st.combo = Math.max(st.combo, e.combo || 1);
      st.kinds.add(e.kind);
    } else if (e.type === 'parry') {
      st.perfect++;
    }
  }
  // The fight's own count, where it keeps one, is the true one (see statsCard).
  const tally = g.state.tally;
  if (Array.isArray(tally)) tally.forEach((t, i) => app.stats[i] && Object.assign(app.stats[i], { dmg: t.dmg, hits: t.hits, combo: t.combo, perfect: t.perfect }));
}

// One line of numbers per fighter, for the result screen of a duel.
function statsCard() {
  const s = app.game?.state;
  if (!s || app.statsFor !== app.game || !app.stats) return '';
  // The fight's own count where it keeps one (the same on every device of an
  // online match); the moves landed still come from the events.
  if (Array.isArray(s.tally)) s.tally.forEach((t, i) => app.stats[i] && Object.assign(app.stats[i], { dmg: t.dmg, hits: t.hits, combo: t.combo, perfect: t.perfect }));
  const who = labels();
  const best = (k) => Math.max(...app.stats.map((st) => st[k]));
  const cell = (st, k) => `<td class="${st[k] > 0 && st[k] === best(k) && app.stats.length > 1 ? 'lead' : ''}">${st[k]}</td>`;
  return `
    <table class="fightstats">
      <thead><tr><th></th><th>Damage</th><th>Hits</th><th>Best combo</th><th>Perfect guards</th></tr></thead>
      <tbody>
        ${s.f
          .map((f, i) => {
            const st = app.stats[i];
            return `<tr><th scope="row">${head(f.char)}<span>${getFighter(f.char).name}<small>${esc(who[i] ?? '')}</small></span></th>${cell(st, 'dmg')}${cell(st, 'hits')}${cell(st, 'combo')}${cell(st, 'perfect')}</tr>`;
          })
          .join('')}
      </tbody>
    </table>`;
}

// In a brawl the numbers ride along in the ranking, under each name.
function statsLine(slot, extra = '') {
  const st = app.statsFor === app.game ? app.stats?.[slot] : null;
  return st ? `<small>${st.dmg} damage · ${st.hits} hits · combo ${st.combo}${st.perfect ? ` · ${st.perfect} perfect` : ''}${extra}</small>` : '';
}

// A brawl's awards (see awards.js), from this fight's numbers.
const awardsFor = (slot) => brawlAwards(app.statsFor === app.game ? app.stats : null, slot);

// The final standings of a brawl, with each fighter's numbers under the name.
function rankingList() {
  const s = app.game.state;
  const who = labels();
  const medal = ['1st', '2nd', '3rd', '4th'];
  return `
    <ol class="ranking">
      ${s.ranking
        .map(
          (r) => `<li class="${r.rank === 1 ? 'top' : ''}">
            <span class="place">${medal[r.rank - 1]}</span>${head(r.char)}
            <span class="lname">${getFighter(r.char).name}${statsLine(r.slot, awardsFor(r.slot).map((n) => ` <span class="award">${n}</span>`).join(''))}</span>
            <span class="ltag">${esc(who[r.slot])}</span>
            <span class="pts">${r.points} pts</span>
          </li>`,
        )
        .join('')}
    </ol>`;
}

// What a finished arcade fight shows: the duel's numbers, or a brawl's standings.
const outcome = () => (app.game.state.mode === 'arena' ? rankingList() : statsCard());

// The winner's own line, shown at the top of the result screen: the one for
// how the match went, if they have one.
function winnerQuote() {
  const s = app.game?.state;
  if (!s || s.matchWinner < 0) return '';
  const f = getFighter(s.f[s.matchWinner].char);
  const how = howWon(s, app.roundEnds || []);
  const line = (how && f.quotes?.[how]) || f.quote;
  return line ? `<p class="quote">“${line}” <span>${f.name}</span></p>` : '';
}

// A milestone reached or a best broken in this fight (see the Record screen),
// as a line in the result card - a notice over the card hid its title or its
// buttons.
// Online: how the match travelled (the trip to the host, lost updates...), so
// a laggy match tells us why.
const netNote = () => (app.mode === 'online' && app.online?.netReport?.() ? `<p class="note netline">${esc(app.online.netReport())}</p>` : '');
const recordNews = () => (app.newBests?.length ? `<p class="note news">New on your Record: ${esc(app.newBests.join(' · '))}</p>` : '');

// The knockout again, slowed (replay.js): offered when the fight ended on one.
const replayBtn = () => (app.koClip ? '<button type="button" class="btn quiet" data-act="replay">Replay KO</button>' : '');
// Photo mode (from the pause screen): the scene alone, the camera turned by
// dragging, the arrow keys or the buttons, and saved as a picture.
const photoScreen = () => `<section class="screen replay photo"><button type="button" class="btn quiet" data-act="photoTurn" data-id="-1" aria-label="Turn left">◀</button><button type="button" class="btn primary" data-act="photoSave">Save picture</button><button type="button" class="btn quiet" data-act="photoTurn" data-id="1" aria-label="Turn right">▶</button><button type="button" class="btn quiet" data-act="photoDone">Back</button></section>`;
const replayScreen = () => '<section class="screen replay"><p class="rtag">REPLAY</p><button type="button" class="btn quiet" data-act="endReplay">Skip</button></section>';

const survivalNote = () => {
  const { wins, best, over, newBest, beaten = [] } = app.surv;
  const run = `${wins} ${wins === 1 ? 'win' : 'wins'}`;
  // The run's rivals, small, on the same line (the last eight of a long one).
  const faces = beaten.length ? ` <span class="runfaces" aria-label="Beaten: ${beaten.map((id) => getFighter(id).name).join(', ')}">${beaten.length > 8 ? '…' : ''}${beaten.slice(-8).map((id) => head(id, 'inline')).join('')}</span>` : '';
  return over
    ? `<p class="note">Survival over: <b>${run}</b> in a row${newBest ? ' - your best yet' : best ? ` (best ${best})` : ''}.${faces}</p>`
    : `<p class="note">Survival: <b>${run}</b> in a row. Next rival on <b>${LEVEL_NAMES[survivalLevel()]}</b>.</p>`;
};

function resultScreen() {
  const s = app.game.state;
  const won = s.matchWinner === 0;
  const again =
    app.mode === 'online'
      ? `<button type="button" class="btn primary" data-act="onBack">Back to the room</button>${replayBtn()}`
      : `<button type="button" class="btn primary" data-act="rematch">Rematch</button>
          <button type="button" class="btn" data-act="select">Change fighter</button>
          ${replayBtn()}<button type="button" class="btn quiet" data-act="menu">Menu</button>`;
  if (app.mode === 'online' && s.mode !== 'arena') return `<section class="screen result">${winnerQuote()}${statsCard()}${roomScoreNote()}${netNote()}${recordNews()}<div class="row">${again}</div></section>`;
  if (s.mode === 'arena' && app.mode !== 'arcade') {
    return `
      <section class="screen result">
        ${winnerQuote()}
        ${rankingList()}
        ${app.mode === 'online' ? roomScoreNote() + netNote() : couchNote()}
        ${app.levelMoved ? `<p class="note">The CPU is now on <b>${LEVEL_NAMES[app.levelMoved]}</b> for your next fight.</p>` : ''}
        ${recordNews()}<div class="row">${again}</div>
      </section>`;
  }
  if (app.mode !== 'arcade') {
    return `
      <section class="screen result">
        ${winnerQuote()}
        ${statsCard()}
        ${app.levelMoved ? `<p class="note">The CPU is now on <b>${LEVEL_NAMES[app.levelMoved]}</b> for your next fight.</p>` : ''}
        ${surviving() ? survivalNote() : couchNote()}
        ${recordNews()}<div class="row">
          ${surviving() ? (app.surv.over ? '<button type="button" class="btn primary" data-act="survAgain">Try again</button>' : '<button type="button" class="btn primary" data-act="survNext">Next rival</button>') : '<button type="button" class="btn primary" data-act="rematch">Rematch</button>'}
          <button type="button" class="btn" data-act="select">Change fighters</button>
          ${replayBtn()}<button type="button" class="btn quiet" data-act="menu">Menu</button>
        </div>
      </section>`;
  }
  const a = app.arcade;
  const total = a.ladder.length;
  if (!won) {
    return `
      <section class="screen result">
        <p class="headline">Stopped at stage ${a.stage + 1} of ${total}</p>
        <p class="sub">${s.mode === 'arena' ? 'Only a clear first place goes through. ' : ''}Score ${points(a.score)}</p>
        ${outcome()}
        ${recordNews()}<div class="row">
          <button type="button" class="btn primary" data-act="retry">Try again</button>
          ${replayBtn()}<button type="button" class="btn quiet" data-act="menu">Menu</button>
        </div>
      </section>`;
  }
  if (a.stage >= total - 1) {
    return `
      <section class="screen result">
        <p class="headline">Arena champion</p>
        <p class="sub">Final score ${points(a.score)}${a.score >= bestScore() ? ' · new best' : ''}</p>
        ${outcome()}
        ${recordNews()}<div class="row">
          <button type="button" class="btn primary" data-act="arcade">Play again</button>
          ${replayBtn()}<button type="button" class="btn quiet" data-act="menu">Menu</button>
        </div>
      </section>`;
  }
  const next = a.ladder[a.stage + 1];
  return `
    <section class="screen result">
      <p class="headline">Stage ${a.stage + 1} cleared · +${points(a.gained)}</p>
      <p class="sub next">Next: ${next.brawl ? `<b>a brawl</b> against ${next.rivals.map((id) => head(id)).join('')} all at once` : `${head(next.char)} <b>${getFighter(next.char).name}</b>${next.boss ? ' · the boss' : ''}`}</p>
      ${outcome()}
      ${recordNews()}<div class="row">
        <button type="button" class="btn primary" data-act="next">Next fight</button>
        ${replayBtn()}<button type="button" class="btn quiet" data-act="menu">Menu</button>
      </div>
    </section>`;
}

// ---------------------------------------------------------- online screens ---

// The chat box shared by the lobby and the rooms.
function chatBox() {
  const lines = app.online.chat.slice(-8);
  return `
    <div class="chat">
      <ol>${lines.length ? lines.map((m) => `<li class="${m.mine ? 'mine' : ''}"><b>${esc(m.name)}</b> ${esc(m.text)}</li>`).join('') : '<li class="dim">Say hello. Messages are not saved.</li>'}</ol>
      <form class="row" data-form="chat">
        <input id="chat" class="field" type="text" maxlength="140" autocomplete="off" placeholder="Message" />
        <button type="submit" class="btn small">Send</button>
      </form>
    </div>`;
}

function nameScreen() {
  return `
    <section class="screen select narrow">
      <h2>Go online</h2>
      <p class="note">Pick the name the alliance will see.</p>
      <form class="row" data-form="nick">
        <input id="nick" class="field" type="text" maxlength="14" autocomplete="off" placeholder="Your name" value="${esc(app.nick)}" />
        <button type="submit" class="btn primary">Enter</button>
      </form>
      ${app.notice ? `<p class="note warn">${esc(app.notice)}</p>` : ''}
      <div class="row"><button type="button" class="btn quiet" data-act="menu">Back</button></div>
    </section>`;
}

function lobbyScreen() {
  const on = app.online;
  const rooms = on.rooms();
  return `
    <section class="screen select lobby">
      <h2>Alliance lobby</h2>
      <div class="versus">
        <div class="ladder">
          <span class="who">Online now · ${on.lobbyPeers.length}</span>
          <ol class="people">
            ${on.lobbyPeers.map((p) => `<li>${head(p.char)}<span class="lname pname"><span class="nm" title="${esc(p.name)}">${esc(p.name)}</span>${p.id === on.me.id ? '<span class="you">(you)</span>' : ''}${p.wins ? ` <span class="wins" title="Fights won, all time">${p.wins} ${p.wins === 1 ? 'win' : 'wins'}</span>` : ''}</span><span class="ltag">${p.playing ? 'fighting' : p.room ? 'in a room' : 'in the lobby'}</span></li>`).join('')}
          </ol>
        </div>
        <div class="ladder">
          <span class="who">Rooms</span>
          <ol class="people">
            ${
              rooms.length
                ? rooms
                    .map((r) => {
                      const full = r.names.length >= on.maxPlayers;
                      return `<li class="roomrow"><span class="faces" aria-hidden="true">${r.chars.slice(0, on.maxPlayers).map((c) => head(c)).join('')}</span><span class="lname">${esc(r.names.slice(0, 3).join(', '))}${r.names.length > 3 ? '…' : ''}<small>${r.playing ? 'fighting now' : full ? 'full' : `${r.names.length} of ${on.maxPlayers}`}${r.arena ? ` · ${ARENAS.find((a) => a.id === r.arena)?.name ?? ''}` : ''}</small></span><button type="button" class="btn small" data-act="joinRoom" data-id="${esc(r.code)}">${r.playing || full ? 'Watch' : 'Join'}</button></li>`;
                    })
                    .join('')
                : '<li class="none"><span class="lname dim">No rooms open yet</span></li>'
            }
          </ol>
          <div class="row">
            <button type="button" class="btn primary" data-act="quickMatch">Quick match</button>
            <button type="button" class="btn" data-act="createRoom">New room</button>
          </div>
          <p class="rules aside">Quick match joins the open room with the most people, or opens one.</p>
        </div>
      </div>
      ${chatBox()}
      ${app.notice ? `<p class="note warn">${esc(app.notice)}</p>` : ''}
      <div class="row acts"><button type="button" class="btn quiet" data-act="offline">Leave online</button>${fullscreenButton()}</div>
    </section>`;
}

// One online fight is over: count it for whoever won, if that was a person.
function countRoomWin(s) {
  const sl = app.roomWins.slots[s.matchWinner];
  if (sl?.id) app.roomWins.wins[sl.id] = (app.roomWins.wins[sl.id] || 0) + 1;
}

// After an online fight: who has won how many in this room, best first.
const couchNote = () => {
  const c = app.mode === 'versus' ? app.couch : null;
  return c && c[0] + c[1] >= 2 ? `<p class="note">This session: P1 <b>${c[0]}</b> · P2 <b>${c[1]}</b></p>` : '';
};

function roomScoreNote() {
  const people = app.roomWins.slots.filter((sl) => sl.id && app.roomWins.wins[sl.id]);
  if (!people.length) return '';
  people.sort((a, b) => app.roomWins.wins[b.id] - app.roomWins.wins[a.id]);
  return `<p class="note">In this room: ${people.map((sl) => `${esc(sl.name)} <b>${app.roomWins.wins[sl.id]}</b>`).join(' · ')}</p>`;
}

// Who would make the best host: the player whose worst trip to the others is
// shortest (each ping in the list is that player's worst). Said only when it
// beats the present host by a clear margin; the host can hand over the role.
function bestHostNote(on, room) {
  const best = on.bestHost();
  const now = on.worstPing(room.hostId);
  if (!best || now === null || best.p.id === room.hostId || now - best.w < 30) return '';
  const button = room.isHost ? ` <button type="button" class="linkish" data-act="handHost" data-id="${esc(best.p.id)}">Make host</button>` : '';
  return `<p class="rules best">Best host: <b>${esc(best.p.name)}</b> · ${best.w} vs ${now} ms.${button}</p>`;
}

function roomScreen() {
  const on = app.online;
  const room = on.room;
  const players = on.players();
  const wins = app.roomWins.code === room.code ? app.roomWins.wins : {};
  const mine = room.peers.find((p) => p.id === on.me.id);
  const watching = room.peers.slice(4);
  const link = on.linkKind();
  return `
    <section class="screen select room">
      <h2>Room ${esc(room.code)}</h2>
      <div class="versus">
        <div class="ladder">
          <span class="who">Fighters · ${players.length} of 4</span>
          <ol class="people">
            ${players
              .map(
                (p) => `<li>${head(p.char)}<span class="lname pname"><span class="nm" title="${esc(p.name)}">${esc(p.name)}</span>${p.id === on.me.id ? '<span class="you">(you)</span>' : ''}${wins[p.id] ? ` <span class="wins" title="Fights won in this room">${wins[p.id]} ${wins[p.id] === 1 ? 'win' : 'wins'}</span>` : ''}</span>
                  <span class="ltag ${p.ready || p.id === room.hostId ? 'ok' : ''}">${p.id === room.hostId ? 'host' : p.ready ? 'ready' : 'choosing'}${on.worstPing(p.id) !== null ? ` <span class="ping" title="Worst ping to the other players">${on.worstPing(p.id)}ms</span>` : ''}</span></li>`,
              )
              .join('')}
          </ol>
          ${watching.length ? `<p class="rules">Watching: ${esc(watching.map((p) => p.name).join(', '))}</p>` : ''}
          ${room.isHost ? '' : `<p class="rules">Arena: <b>${ARENAS.find((a) => a.id === on.arena())?.name ?? ''}</b> (the host chooses)</p>`}
          ${bestHostNote(on, room) || `<p class="rules">${link === 'direct' ? (on.nextByRollback?.() ? 'Direct · rollback.' : 'Connected directly.') : link === 'relayed' ? (on.canLink ? 'Connecting… (relayed for now)' : 'Connected through the server: this browser does not allow direct links, so moves may arrive a little later.') : 'Waiting for others. Share the room name, or start with CPU rivals.'}</p>`}
        </div>
        <div class="slot" style="--tint:${lookColors(room.char, room.look ?? 0).primary};--ring:${lookColors(room.char, room.look ?? 0).accent}">
          <span class="who">Your fighter</span>
          ${head(room.char, 'big')}
          <strong class="name">${getFighter(room.char).name}</strong>
          <span class="title">${getFighter(room.char).title}</span>
          ${statBars(getFighter(room.char))}
          <div class="picker" role="group" aria-label="Your fighter">
            ${FIGHTERS.map((o) => `<button type="button" class="pick ${o.id === room.char ? 'on' : ''}" data-act="onChar" data-id="${o.id}" aria-pressed="${o.id === room.char}" title="${o.name}">${head(o.id)}</button>`).join('')}
            <button type="button" class="pick rand" data-act="onCharRandom" title="Random fighter" aria-label="Random fighter"><span class="head" aria-hidden="true">?</span></button>
            ${lookButtons(room.char, room.look ?? 0, 'onLook')}
          </div>
        </div>
      </div>
      ${room.isHost ? `<div class="row opts"><div class="seg" role="group"><button type="button" class="${app.fill ? 'on' : ''}" data-act="fill" data-id="1">Fill with CPU</button><button type="button" class="${app.fill ? '' : 'on'}" data-act="fill" data-id="0">Players only</button></div>${placePicker()}</div>` : ''}
      ${chatBox()}
      ${room.again ? `<p class="note">${room.isHost ? 'Everyone from the last fight is still ready: start again whenever you like.' : 'Still ready from the last fight. Press Not ready to sit the next one out.'}</p>` : ''}
      ${room.mixed ? '<p class="note warn">Someone here has an older or newer version of the game. Everyone should reload the page before fighting.</p>' : ''}
      ${app.notice ? `<p class="note warn">${esc(app.notice)}</p>` : ''}
      <div class="row acts">
        <button type="button" class="btn quiet" data-act="leaveRoom">Leave room</button>
        <button type="button" class="btn" data-act="invite">Copy invite link</button>
        ${fullscreenButton()}
        ${
          room.isHost
            ? `<button type="button" class="btn primary" data-act="onStart" ${on.canStart() ? '' : 'disabled'}>Start fight</button>`
            : `<button type="button" class="btn primary" data-act="onReady">${mine?.ready ? 'Not ready' : 'Ready'}</button>`
        }
      </div>
    </section>`;
}

const SCREENS = { lessons: lessonsScreen, lessonDone: lessonDoneScreen, record: recordScreen, settings: settingsScreen, menu: menuScreen, select: selectScreen, help: helpScreen, pause: pauseScreen, result: resultScreen, replay: replayScreen, photo: photoScreen, arrange: arrangeScreen, nick: nameScreen, lobby: lobbyScreen, room: roomScreen };

// Keep a phone's screen from dimming or locking in the middle of a fight.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch {
    // not allowed here: the fight goes on, the screen follows the phone's own timer
  }
}

// Do the on-screen controls lie over the arena's bottom corners? (Sideways
// they do; upright they sit under the arena.) The energy bars move up then.
const touchOver = () => !touchEl.hidden && !isPortrait();

// Show the on-screen controls during single-player fights and while arranging.
function refreshTouch() {
  const want = app.screen === 'arrange' || (app.screen === 'fight' && app.touch && app.mode !== 'versus');
  if (touchEl.hidden === want) {
    touchEl.hidden = !want;
    layout();
  }
}

function show(screen) {
  // The lobby and the rooms redraw whenever someone joins or speaks: carry a
  // half-typed chat message (and the cursor) across the redraw.
  const draft = ui.querySelector('#chat');
  const kept = draft ? { value: draft.value, focus: document.activeElement === draft } : null;
  app.screen = screen;
  const inFight = screen === 'fight' || screen === 'pause' || screen === 'result' || screen === 'replay' || screen === 'photo' || ((screen === 'arrange' || screen === 'settings') && app.game);
  ui.innerHTML = SCREENS[screen] ? SCREENS[screen]() : '';
  ui.dataset.screen = screen;
  pauseBtn.hidden = screen !== 'fight';
  // The lesson panel belongs to the tutorial; Training is free practice.
  drillEl.hidden = !(screen === 'fight' && app.mode === 'tutorial');
  if (!drillEl.hidden) drawLesson();
  const lessoned = root.classList.contains('lessoning');
  refreshTouch();
  if (isPortrait() && lessoned !== (!touchEl.hidden && !drillEl.hidden)) layout(); // the panel's room came or went
  touchLayout.setEditing(screen === 'arrange');
  setTouchLive(screen !== 'arrange');
  setCapture(screen === 'fight');
  if (!inFight) app.game = null;
  app.music = screen === 'fight' || screen === 'replay' ? 'fight' : 'menu';
  setMusic(app.music);
  keepAwake(screen === 'fight');
  // The chat's newest lines are the ones to see (it scrolls up for older).
  const log = ui.querySelector('.chat ol');
  if (log) log.scrollTop = log.scrollHeight;
  const chat = ui.querySelector('#chat');
  if (chat && kept) {
    chat.value = kept.value;
    if (kept.focus) chat.focus({ preventScroll: true });
  }
  // On a narrow screen the help table scrolls sideways: bring the column of
  // the controls in use into view (without moving the page up or down).
  if (screen === 'help') {
    const lit = ui.querySelector('.help th.now');
    const box = ui.querySelector('.help .scroll');
    if (lit && box) box.scrollLeft = Math.max(0, lit.offsetLeft + lit.offsetWidth - box.clientWidth + 8);
  }
  if (screen !== 'nick' && !(chat && kept?.focus)) ui.querySelector('.primary:not([disabled])')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- fights ---

function cpu(level) {
  const ai = createAI(level, (Math.random() * 1e9) | 0);
  return (state, slot) => aiInput(ai, state, slot);
}

function startDemo() {
  // A four-fighter brawl plays behind the menus, in a random order.
  const ids = FIGHTERS.map((f) => f.id).sort(() => Math.random() - 0.5);
  while (ids.length < 4) ids.push(FIGHTERS[ids.length % FIGHTERS.length].id);
  const chars = ids.slice(0, 4);
  app.demo = createGame(chars, chars.map(() => cpu('hard')));
}

function startFight() {
  tape.clear();
  app.koClip = null;
  const solo = () => readKeys('solo') | readTouch() | readPad(0);
  const two = [() => readKeys('p1') | readPad(0), () => readKeys('p2') | readPad(1)];
  let chars = app.picks;
  let mods = [];
  let controllers;
  if (app.mode === 'arcade') {
    const st = app.arcade.ladder[app.arcade.stage];
    if (st.brawl) {
      chars = [app.picks[0], ...st.rivals];
      controllers = [solo, ...st.rivals.map(() => cpu(st.level))];
    } else {
      chars = [app.picks[0], st.char];
      mods = [null, st.mod];
      controllers = [solo, cpu(st.level)];
    }
  } else if (app.mode === 'arena') {
    chars = [app.picks[0], ...rivalsFor([app.picks[0]])];
    controllers = [solo, cpu(cpuLevel()), cpu(cpuLevel()), cpu(cpuLevel())];
  } else if (app.mode === 'quick') {
    controllers = [solo, cpu(cpuLevel())];
  } else if (app.mode === 'training') {
    const partner = app.dummy === 'fight' ? cpu('easy') : app.dummy === 'beat' ? drummer() : app.dummy === 'combo' ? comboer() : app.dummy === 'block' ? () => INPUT.BLOCK : () => 0;
    if (app.keepTape && app.tape) app.tape.rewind();
    else app.tape = partnerTape();
    controllers = [watchButtons(app.tape.you(solo)), app.tape.partner(solo, partner)];
  } else if (app.mode === 'tutorial') {
    // The lesson's partner: a fighter other than your own.
    chars = [app.picks[0], FIGHTERS.find((f) => f.id !== app.picks[0]).id];
    controllers = [solo, tutorPartner(lessonById(app.lesson).partner)];
    app.lessonRun = new Set();
    app.lessonEnd = 0;
  } else if (app.vsArena) {
    chars = [...app.picks, ...rivalsFor(app.picks)];
    controllers = [...two, cpu('normal'), cpu('normal')];
  } else {
    controllers = two;
  }
  app.game = createGame(chars, controllers, mods);
  shuffleRivals(); // the next fight's rivals
  // The arcade ladder alternates between the arenas, starting from the chosen one.
  const first = ARENAS.findIndex((a) => a.id === app.place);
  app.fightPlace = app.mode === 'arcade' ? ARENAS[(first + app.arcade.stage) % ARENAS.length].id : app.place;
  try {
    localStorage.setItem('gd-arena-played', '1');
  } catch {
    // not remembered
  }
  app.resultShown = false;
  stage.reset();
  show('fight');
  document.activeElement?.blur?.(); // so Space jumps instead of pressing a button
}

function startArcade() {
  app.arcade = { ladder: buildLadder(app.picks[0]), stage: 0, score: 0, retries: 0, gained: 0 };
  startFight();
}

// Called once when a match ends, before the result screen is drawn.
// Auto difficulty: the CPU level follows the player. Each win moves it one
// step up (to Hard at most), each loss one step down (to Easy at least), so
// everyone in the alliance settles where fights are close. Remembered.
const AUTO_STEPS = ['easy', 'normal', 'hard'];
const LEVEL_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard', boss: 'Boss' };
function autoLevel() {
  try {
    const saved = localStorage.getItem('gd-arena-auto-level');
    return AUTO_STEPS.includes(saved) ? saved : 'normal';
  } catch {
    return 'normal';
  }
}
// Survival (Quick fight): duels in a row against fresh rivals, harder as the
// run grows - Normal for the first two, then Hard, then the boss's mind from
// the sixth; the first defeat ends it. The best run is kept on the Record.
const survivalLevel = () => { const n = app.surv?.wins || 0; return n < 2 ? 'normal' : n < 5 ? 'hard' : 'boss'; };
const surviving = () => app.mode === 'quick' && app.level === 'survival' && !!app.surv;
const cpuLevel = () => (app.level === 'survival' ? (app.mode === 'quick' ? survivalLevel() : autoLevel()) : app.level === 'auto' ? autoLevel() : app.level);
function nextSurvivalRival() {
  const pool = FIGHTERS.map((f) => f.id).filter((id) => id !== app.picks[0] && id !== app.picks[1]);
  return pool[Math.floor(Math.random() * pool.length)] || app.picks[1];
}
function stepAutoLevel(won) {
  app.levelMoved = null;
  if (app.level !== 'auto' || (app.mode !== 'quick' && app.mode !== 'arena')) return;
  const at = AUTO_STEPS.indexOf(autoLevel());
  const next = AUTO_STEPS[Math.max(0, Math.min(AUTO_STEPS.length - 1, at + (won ? 1 : -1)))];
  if (next !== AUTO_STEPS[at]) app.levelMoved = next;
  try {
    localStorage.setItem('gd-arena-auto-level', next);
  } catch {
    // not remembered
  }
}

// ---------------------------------------------------------------- record ---
// A lifetime record of the player's own fights, kept on the device: every
// finished match except Training and two-player games on one device.
const RECORD_KEY = 'gd-arena-record';
function readRecord() {
  try {
    const r = JSON.parse(localStorage.getItem(RECORD_KEY) || 'null');
    if (r && typeof r === 'object' && r.v === 1) return r;
  } catch {
    // start a fresh one
  }
  return { v: 1, fights: 0, wins: 0, streak: 0, bestStreak: 0, bestCombo: 0, perfect: 0, damage: 0, online: 0, by: {} };
}
// Training shows your last buttons under your health bar (each with the
// direction held as it was pressed), to check a string's timing and order.
function watchButtons(read) {
  let was = 0;
  app.pressed = [];
  return (...a) => {
    const b = read(...a);
    const fresh = b & ~was;
    was = b;
    if (fresh & ~15) {
      const at = performance.now();
      for (const c of buttonChips(fresh, b)) app.pressed.push({ ...c, at });
      if (app.pressed.length > 8) app.pressed.splice(0, app.pressed.length - 8);
    }
    return b;
  };
}

// The moves every fighter has, by the name a landed blow carries: the
// Record counts how many of them you have landed at least once.
const MOVE_BOOK = {
  punch: 'Jab', punch2: 'Second punch', punch3: 'Third punch', // (named in How to play's strings) kick: 'Kick', kick2: 'Roundhouse', hook: 'Hook kick',
  backfist: 'Spinning backfist', elbow: 'Elbow', launch: 'Launcher', riposte: 'Riposte', lunge: 'Lunging straight',
  slide: 'Slide', sweep: 'Guard sweep', diveKick: 'Dive kick', grab: 'Throw', pursuit: 'Pursuit', breaker: 'Guard-breaker',
  airPunch: 'Diving punch', airKick: 'Flying kick', flyKnee: 'Flying knee', axeKick: 'Axe kick', hammer: 'Hammer fist',
  stomp: 'Stomp', airThrow: 'Air throw', riseKick: 'Rising sweep', rollUpper: 'Rising uppercut', rollSpin: 'Spinning heel kick',
};
const MOVE_TOTAL = Object.keys(MOVE_BOOK).length;
// Round numbers of wins worth a word when they are reached.
const WIN_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

function noteRecord() {
  if (practising() || app.mode === 'versus') return;
  const s = app.game.state;
  const me = app.mode === 'online' ? app.online?.mySlot ?? -1 : 0;
  if (me < 0 || !s.f[me]) return;
  const r = readRecord();
  const won = s.matchWinner === me;
  const st = app.statsFor === app.game ? app.stats?.[me] : null;
  const char = s.f[me].char;
  // What this fight improved, said on the result screen (see newBestsLine).
  const was = { streak: r.bestStreak, combo: r.bestCombo, played: r.fights };
  r.fights++;
  if (won) r.wins++;
  r.streak = won ? r.streak + 1 : 0;
  r.bestStreak = Math.max(r.bestStreak, r.streak);
  if (surviving()) {
    // The best as it stood when this run began (the Record is updated on
    // every win, so a run would never beat itself).
    app.surv.before ??= r.survival || 0;
    if (won) {
      app.surv.wins++;
      (app.surv.beaten ||= []).push(s.f[1].char);
    } else app.surv.over = true;
    app.surv.best = Math.max(app.surv.before, app.surv.wins);
    app.surv.newBest = app.surv.wins > app.surv.before;
    r.survival = Math.max(r.survival || 0, app.surv.best);
  }
  if (app.mode === 'online') r.online++;
  app.newBests = [];
  if (won && WIN_MILESTONES.includes(r.wins)) app.newBests.push(`${r.wins} wins in all`);
  if (r.bestStreak > was.streak && r.bestStreak >= 2) app.newBests.push(`best streak, ${r.bestStreak} wins in a row`);
  if (st) {
    if (st.combo > was.combo && st.combo >= 3 && was.played > 0) app.newBests.push(`best combo, ${st.combo} hits`);
    r.bestCombo = Math.max(r.bestCombo, st.combo);
    r.perfect += st.perfect;
    r.damage += st.dmg;
    // Moves landed for the first time (those every fighter has).
    const known = new Set(Array.isArray(r.moves) ? r.moves : []);
    const fresh = [...(st.kinds || [])].filter((k) => MOVE_BOOK[k] && !known.has(k));
    if (fresh.length && was.played > 0) app.newBests.push(fresh.length === 1 ? `first ${MOVE_BOOK[fresh[0]]} landed` : `${fresh.length} moves landed for the first time`);
    r.moves = [...known, ...fresh];
  }
  // Flawless wins and comebacks (see outcome.js), the first of each said.
  const how = won ? howWon(s, app.roundEnds || []) : '';
  if (how === 'perfect') {
    r.flawless = (r.flawless || 0) + 1;
    if (r.flawless === 1 && was.played > 0) app.newBests.push('first flawless win');
  } else if (how === 'comeback') {
    r.comebacks = (r.comebacks || 0) + 1;
    if (r.comebacks === 1 && was.played > 0) app.newBests.push('first comeback');
  }
  const f = (r.by[char] = r.by[char] || { fights: 0, wins: 0 });
  f.fights++;
  if (won) f.wins++;
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(r));
  } catch {
    // not remembered
  }
}

// The moves still to land, for the Record's tooltip.
const missingMoves = (r) => {
  const left = Object.keys(MOVE_BOOK).filter((k) => !(r.moves || []).includes(k)).map((k) => MOVE_BOOK[k]);
  return left.length ? `Still to land: ${left.join(', ')}` : 'Every move landed';
};

function recordScreen() {
  const r = readRecord();
  const pct = (w, n) => (n ? `${Math.round((w / n) * 100)}%` : '-');
  const rows = FIGHTERS.map((f) => {
    const x = r.by[f.id] || { fights: 0, wins: 0 };
    return `<li>${head(f.id)}<span class="lname">${f.name}</span><span class="ltag">${x.fights} fights</span><span class="pts">${pct(x.wins, x.fights)}</span></li>`;
  }).join('');
  const fav = FIGHTERS.map((f) => [f, r.by[f.id]?.fights || 0]).sort((a, b) => b[1] - a[1])[0];
  return `
    <section class="screen select narrow record">
      <h2>Your record</h2>
      ${
        r.fights
          ? `<dl class="recordstats">
              <div><dt>Fights</dt><dd>${r.fights}</dd></div>
              <div><dt>Won</dt><dd>${r.wins} · ${pct(r.wins, r.fights)}</dd></div>
              <div><dt>Best run</dt><dd>${r.bestStreak} in a row${r.survival ? ` · survival ${r.survival}` : ''}</dd></div>
              <div><dt>Best combo</dt><dd>${r.bestCombo} hits</dd></div>
              <div><dt>Perfect guards</dt><dd>${r.perfect}</dd></div>
              <div><dt>Flawless · comebacks</dt><dd>${r.flawless || 0} · ${r.comebacks || 0}</dd></div>
              <div><dt>Damage dealt</dt><dd>${points(r.damage)}</dd></div>
              <div><dt>Online fights</dt><dd>${r.online}</dd></div>
              <div title="${esc(missingMoves(r))}"><dt>Moves landed</dt><dd><button type="button" class="linkish" data-act="movesLeft" aria-label="Moves still to land">${(r.moves || []).filter((k) => MOVE_BOOK[k]).length} of ${MOVE_TOTAL} ›</button></dd></div>
              <div><dt>Favourite</dt><dd>${fav[1] ? fav[0].name : '-'}</dd></div>
            </dl>
            <ol class="ranking">${rows}</ol>`
          : '<p class="note">No fights yet. Every finished fight counts here, except the Tutorial, Training and two players on one device.</p>'
      }
      <div class="row"><button type="button" class="btn primary" data-act="menu">Back</button></div>
    </section>`;
}

function scoreMatch() {
  noteRecord();
  // Two players on one device: who has won how many since they sat down
  // (Rematch keeps it; choosing fighters again starts afresh).
  if (app.mode === 'versus') {
    const w = app.game.state.matchWinner;
    app.couch ||= [0, 0];
    if (w === 0 || w === 1) app.couch[w]++;
  }
  stepAutoLevel(app.game.state.matchWinner === 0);
  if (app.mode !== 'arcade') return;
  const a = app.arcade;
  const s = app.game.state;
  a.gained = 0;
  if (s.matchWinner !== 0) return;
  const me = s.f[0];
  // A duel won without dropping a round, or a brawl won with every round on top.
  const flawless = s.mode === 'arena' ? (s.pts[0] === (s.f.length - 1) * s.round ? 500 : 0) : s.pts[1] === 0 ? 500 : 0;
  a.gained = 1000 * (a.stage + 1) + Math.round((me.hp / me.maxHp) * 1000) + Math.ceil(s.timer / TICK_RATE) * 10 + flawless;
  a.score += a.gained;
  if (a.stage >= a.ladder.length - 1) saveBest(a.score);
}

function togglePause() {
  if (!app.game) return;
  if (app.screen === 'fight') {
    app.game.paused = app.mode !== 'online'; // an online fight goes on without you
    show('pause');
  } else if (app.screen === 'pause') {
    app.game.paused = false;
    show('fight');
  }
}

// --------------------------------------------------------------- actions ---

const ACTIONS = {
  arcade() {
    app.mode = 'arcade';
    show('select');
  },
  quick() {
    app.mode = 'quick';
    show('select');
  },
  training() {
    app.mode = 'training';
    show('select');
  },
  // The pause screen's move list: show another group of moves.
  moveTab(el) {
    app.moveTab = el.dataset.id;
    show('pause');
    ui.querySelector(`[data-act=moveTab][data-id=${app.moveTab}]`)?.focus({ preventScroll: true });
  },
  tutorial() {
    app.mode = 'tutorial';
    show('lessons');
  },
  lesson(el) {
    app.mode = 'tutorial';
    app.lesson = el.dataset.id;
    startFight();
  },
  // The tutorial uses the fighter picked last; this steps to the next one.
  tutorFighter() {
    const i = FIGHTERS.findIndex((f) => f.id === app.picks[0]);
    app.picks[0] = FIGHTERS[(i + 1) % FIGHTERS.length].id;
    show('lessons');
  },
  dummy(el) {
    app.dummy = el.dataset.id;
    show('select');
  },
  arena() {
    app.mode = 'arena';
    show('select');
  },
  // --- online ---
  online() {
    app.notice = '';
    if (app.online) return show(app.online.room ? 'room' : 'lobby');
    try {
      app.nick = app.nick || localStorage.getItem('gd-arena-nick') || '';
    } catch {
      // no saved name
    }
    show('nick');
    ui.querySelector('#nick')?.focus();
  },
  async offline() {
    await app.online?.close();
    app.online = null;
    roomInAddress(null);
    show('menu');
  },
  async createRoom() {
    await app.online.createRoom();
    roomInAddress(app.online.room?.code);
    show('room');
  },
  async quickMatch() {
    await app.online.quickMatch();
    roomInAddress(app.online.room?.code);
    show('room');
  },
  async joinRoom(el) {
    await app.online.joinRoom(el.dataset.id);
    roomInAddress(app.online.room?.code);
    show('room');
  },
  async leaveRoom() {
    await app.online.leaveRoom();
    roomInAddress(null); // do not rejoin on reload
    app.notice = '';
    show('lobby');
  },
  // (Your own panel follows your choice at once; the list of fighters
  // follows when the room has heard of it.)
  onChar(el) {
    app.online.setChar(el.dataset.id);
    show('room');
  },
  onCharRandom() {
    const others = FIGHTERS.filter((o) => o.id !== app.online.room?.char);
    app.online.setChar(others[Math.floor(Math.random() * others.length)].id);
    show('room');
  },
  async invite(el) {
    const link = `${location.origin}${location.pathname}#room-${app.online.room.code}`;
    try {
      await navigator.clipboard.writeText(link);
      el.textContent = 'Link copied';
    } catch {
      // Copying is refused in some browsers: show the link so it can be copied by hand.
      app.notice = link;
      show('room');
    }
  },
  onReady() {
    const mine = app.online.room.peers.find((p) => p.id === app.online.me.id);
    if (!mine?.ready) fullscreenForFight();
    app.online.setReady(!mine?.ready);
  },
  onLook(el) {
    if ((Number(el.dataset.id) || 0) === (app.online.room?.look ?? 0)) return; // already worn
    app.looks[0] = Number(el.dataset.id) || 0;
    try {
      localStorage.setItem('gd-arena-looks', JSON.stringify(app.looks));
    } catch {
      // not remembered
    }
    app.online.setLook(app.looks[0]);
    show('room');
  },
  fill(el) {
    app.fill = el.dataset.id === '1';
    show('room');
  },
  place(el) {
    if (!isArenaId(el.dataset.id)) return;
    app.place = el.dataset.id;
    try {
      localStorage.setItem('gd-arena-place', app.place);
    } catch {
      // not remembered
    }
    app.online?.setArena(app.place);
    show(app.screen);
  },
  onStart: () => {
    fullscreenForFight();
    app.online.start({ fill: app.fill, arena: app.place });
  },
  // The Record's moves still to land (a tooltip never shows on a phone).
  movesLeft() {
    toast(missingMoves(readRecord()), 9000);
  },
  handHost(el) {
    app.online?.handHost(el.dataset.id);
  },
  onBack() {
    if (app.online?.game) app.online.endMatch();
    else show(app.online?.room ? 'room' : 'lobby');
  },
  vsKind(el) {
    app.vsArena = el.dataset.id === 'brawl';
    show('select');
  },
  versus() {
    app.mode = 'versus';
    show('select');
  },
  help: () => show('help'),
  menu() {
    stage.reset();
    show('menu');
  },
  select: () => show('select'),
  pick(el) {
    app.picks[Number(el.dataset.slot)] = el.dataset.id;
    show('select');
  },
  // Let fate choose: another fighter than the one shown, in a random costume.
  pickRandom(el) {
    const slot = Number(el.dataset.slot);
    const others = FIGHTERS.filter((o) => o.id !== app.picks[slot]);
    const f = others[Math.floor(Math.random() * others.length)];
    app.picks[slot] = f.id;
    app.looks[slot] = Math.floor(Math.random() * (f.looks?.length || 1));
    try {
      localStorage.setItem('gd-arena-looks', JSON.stringify(app.looks));
    } catch {
      // not remembered
    }
    show('select');
    ui.querySelector(`[data-act=pickRandom][data-slot="${slot}"]`)?.focus({ preventScroll: true });
  },
  look(el) {
    app.looks[Number(el.dataset.slot)] = Number(el.dataset.id) || 0;
    try {
      localStorage.setItem('gd-arena-looks', JSON.stringify(app.looks));
    } catch {
      // not remembered
    }
    show('select');
  },
  level(el) {
    app.level = el.dataset.id;
    show('select');
  },
  fight() {
    app.couch = null;
    app.surv = app.mode === 'quick' && app.level === 'survival' ? { wins: 0 } : null;
    if (app.mode === 'arcade') startArcade();
    else startFight();
  },
  // Survival: a win brings the next rival; a defeat, a fresh run.
  survNext() {
    app.picks[1] = nextSurvivalRival();
    startFight();
  },
  survAgain() {
    app.surv = { wins: 0 };
    startFight();
  },
  rematch() {
    // (Training keeps a recorded partner through a restart.)
    app.keepTape = true;
    startFight();
    app.keepTape = false;
  },
  photo() {
    app.photo = { yaw: 0.3, zoom: 0.8 };
    show('photo');
  },
  photoTurn(el) {
    if (app.photo) app.photo.yaw += Number(el.dataset.id) * 0.35;
  },
  photoSave() {
    app.photoSave = true; // taken right after the next frame is drawn
  },
  photoDone() {
    app.photo = null;
    show('pause');
  },
  replay() {
    if (!app.koClip) return;
    // Who goes down at the end of it (the camera stays on them).
    const end = app.koClip[app.koClip.length - 1].state;
    const out = end.f.filter((f) => f.state === 'ko' || f.hp <= 0).sort((a, b) => (b.outAt ?? 0) - (a.outAt ?? 0))[0];
    app.replay = { clip: app.koClip, t0: performance.now(), last: -1, on: out ? out.slot : -1 };
    stage.reset();
    show('replay');
  },
  endReplay,
  retry() {
    // Trying a stage again costs a slice of the score.
    app.arcade.retries++;
    app.arcade.score = Math.round(app.arcade.score * 0.8);
    startFight();
  },
  next() {
    app.arcade.stage++;
    startFight();
  },
  resume: togglePause,
  // Training: for five seconds you move the partner, then it plays that back.
  recordPartner() {
    app.tape?.record();
    togglePause();
    showBanner('RECORDING', 'YOU MOVE YOUR PARTNER · 5 S', '#ff5a36', 1300);
  },
  stopReplay() {
    app.tape?.stop();
    togglePause();
  },
  arrange() {
    app.arrangeFrom = app.game ? 'pause' : 'menu';
    show('arrange');
  },
  settings() {
    app.settingsFrom = app.game ? 'pause' : 'menu';
    show('settings');
  },
  settingsDone: () => show(app.settingsFrom || 'menu'),
  record: () => show('record'),
  graphics(el) {
    app.graphics = el.dataset.id;
    stage.setGraphics(app.graphics);
    try {
      localStorage.setItem('gd-arena-graphics', app.graphics);
    } catch {
      // not remembered
    }
    show('settings');
  },
  arrangeDone: () => show(app.arrangeFrom),
  smaller: () => touchLayout.resize(-0.1),
  bigger: () => touchLayout.resize(0.1),
  resetLayout: () => touchLayout.reset(),
  body(el) {
    try {
      localStorage.setItem('gd-arena-body', bodyReal() ? 'classic' : 'real');
    } catch {
      // not remembered
    }
    el.textContent = bodyLabel();
    el.setAttribute('aria-pressed', String(bodyReal()));
  },
  vibrate(el) {
    vibOn = !vibrateOn();
    setBuzz(vibOn);
    try {
      localStorage.setItem('gd-arena-vibrate', vibOn ? '1' : '0');
    } catch {
      // not remembered
    }
    el.textContent = vibrateLabel();
    el.setAttribute('aria-pressed', String(vibrateOn()));
    if (vibrateOn()) navigator.vibrate?.(30); // so you feel what it is
  },
  announcer(el) {
    setAnnouncer(!isAnnouncer());
    el.textContent = announcerLabel();
    el.setAttribute('aria-pressed', String(isAnnouncer()));
  },
  mute(el) {
    setMuted(!isMuted());
    el.textContent = soundLabel();
    el.setAttribute('aria-pressed', String(!isMuted()));
  },
  touch(el) {
    app.touch = !app.touch;
    el.textContent = touchLabel(!!el.dataset.short);
    el.setAttribute('aria-pressed', String(app.touch));
  },
  fullscreen(el) {
    // Not every viewer allows this (phones, some apps); it is fine if it fails.
    // On a phone, full screen also holds the screen sideways, the way the game
    // is best played (Android allows it; elsewhere the request just fails).
    const root = document.documentElement;
    const done = () => {
      if (el?.isConnected) el.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    };
    if (document.fullscreenElement) document.exitFullscreen?.().then(done, done);
    else
      root
        .requestFullscreen?.()
        .then(() => {
          done();
          return app.touch ? screen.orientation?.lock?.('landscape') : null;
        })
        .catch(() => {});
  },
};

async function goOnline(name) {
  app.nick = name.trim().slice(0, 14) || 'Fighter';
  try {
    localStorage.setItem('gd-arena-nick', app.nick);
  } catch {
    // not remembered on this device
  }
  ui.innerHTML = '<p class="loading">Connecting…</p>';
  const online = createOnline({
    wins: () => readRecord().wins,
    onHeard: () => play('chime'),
    config: NET,
    name: app.nick,
    version: BUILD,
    char: () => app.picks[0],
    look: () => app.looks[0],
    arena: () => app.place,
    readInput: () => readKeys('solo') | readTouch() | readPad(0),
    // Redraw the lobby or the room whenever someone joins, leaves or changes.
    onChange() {
      if (app.online !== online) return;
      // Someone new in your room (not during a fight): a rising chime.
      const here = online.room && !online.game ? online.room.peers.length : 0;
      if (here > (app.roomCount || 0) && app.roomCount) play('arrive');
      app.roomCount = here;
      if (app.screen === 'lobby' || (app.screen === 'room' && online.room)) show(app.screen);
    },
    onStart(info) {
      app.mode = 'online';
      const code = online.room?.code ?? '';
      if (app.roomWins.code !== code) app.roomWins = { code, slots: [], wins: {} };
      app.roomWins.slots = info?.slots ?? [];
      app.fightPlace = isArenaId(info?.arena) ? info.arena : ARENAS[0].id;
      app.game = online.game;
      app.resultShown = false;
      app.notice = '';
      tape.clear();
      app.koClip = null;
      stage.reset();
      show('fight');
      document.activeElement?.blur?.();
    },
    onEnd(reason) {
      app.game = null;
      app.notice = reason === 'host_left' ? 'The host left, so the fight ended.' : reason === 'player_left' ? 'The other player left, so the fight ended.' : '';
      stage.reset();
      show(online.room ? 'room' : 'lobby');
    },
  });
  try {
    await online.connect();
    // Fights run by rollback wherever every two players are linked directly
    // (see README); ?classic in the address keeps a host's fights the old way.
    online.rollback = !new URLSearchParams(location.search).has('classic');
    app.online = online;
    app.notice = '';
    const code = invited();
    if (code) {
      await online.joinRoom(code);
      show('room');
    } else {
      show('lobby');
    }
  } catch {
    app.notice = 'Could not reach the lobby. Check your connection and try again.';
    show('nick');
  }
}

// Volume sliders act while they are dragged, with a sound to judge by.
ui.addEventListener('input', (e) => {
  const kind = e.target.dataset?.vol;
  if (!kind) return;
  unlockAudio();
  setVolume(kind, Number(e.target.value) / 100);
  if (kind === 'sfx') play('hit');
});

ui.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.dataset.form === 'nick') {
    unlockAudio();
    goOnline(ui.querySelector('#nick').value);
  } else if (e.target.dataset.form === 'chat') {
    // Emptied before it is sent: sending redraws the room at once, and the
    // redraw carries over whatever is in the box.
    const box = ui.querySelector('#chat');
    const text = box.value;
    box.value = '';
    const sent = app.online?.say(text);
    const now = ui.querySelector('#chat');
    if (!now) return;
    if (!sent) now.value = text;
    now.focus({ preventScroll: true });
  }
});

ui.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  unlockAudio();
  play('ui');
  ACTIONS[el.dataset.act]?.(el);
});
pauseBtn.addEventListener('click', togglePause);

// ------------------------------------------------------------ frame loop ---

// What to call each fighter in the HUD and on the floating tags.
function labels() {
  const n = app.game ? app.game.state.f.length : 2;
  if (app.mode === 'online' && app.online?.info) return app.online.info.slots.map((sl) => sl.name.toUpperCase());
  if (app.mode === 'versus') return ['P1', 'P2', 'CPU', 'CPU'].slice(0, n);
  if (practising()) return ['YOU', 'PARTNER'];
  if (app.mode === 'arcade' && app.arcade) {
    const st = app.arcade.ladder[app.arcade.stage];
    if (st.brawl) return ['YOU', ...st.rivals.map(() => 'CPU')];
    return ['YOU', st.boss ? 'BOSS' : `STAGE ${app.arcade.stage + 1}/${app.arcade.ladder.length}`];
  }
  if (surviving()) return ['YOU', `RIVAL ${app.surv.wins + 1}`];
  return ['YOU', 'CPU', 'CPU', 'CPU'].slice(0, n);
}

// The costumes in the fight being played, by slot: the places the players
// chose for, as picked; CPU rivals in their own colours.
function fightLooks() {
  if (app.mode === 'online') return app.online?.info?.slots.map((sl) => sl.look || 0) ?? null;
  if (app.mode === 'versus' || app.mode === 'quick' || practising()) return [app.looks[0], app.looks[1], 0, 0];
  return [app.looks[0], 0, 0, 0];
}

// Training never ends: the clock stays full, energy is always there to spend,
// and anyone who gets low on health is topped up once they are back on their feet.
function keepTraining(s) {
  if (s.phase !== 'fight') return;
  s.timer = MODES.duel.seconds * TICK_RATE;
  if (app.mode === 'training' || lessonById(app.lesson)?.energy) s.f[0].meter = RULES.METER_MAX;
  for (const f of s.f) {
    if (f.hp < f.maxHp * 0.4 && (f.state === 'idle' || f.state === 'walk' || f.state === 'block')) f.hp = f.maxHp;
    else if (f.hp < 8) f.hp = 8; // never actually knocked out
  }
}

// Menus can be worked with a controller: stick or D-pad moves between the
// buttons, A presses, B goes back.
function padMenus() {
  const nav = padMenu();
  if (app.screen === 'fight' || (!nav.dir && !nav.ok && !nav.back)) return; // nothing pressed: no work
  const items = [...ui.querySelectorAll('button:not([disabled]), input')];
  if (!items.length) return;
  if (nav.dir) {
    const at = items.indexOf(document.activeElement);
    items[(at + nav.dir + items.length) % items.length].focus({ preventScroll: true });
  }
  if (nav.ok && items.includes(document.activeElement)) document.activeElement.click();
  if (nav.back) {
    const back = ['photoDone', 'endReplay', 'resume', 'settingsDone', 'arrangeDone', 'leaveRoom', 'offline', 'menu'].map((a) => ui.querySelector(`[data-act=${a}]`)).find(Boolean);
    back?.click();
  }
}

// The replay of the knockout: its frames drawn again at half speed, with
// their sounds and sparks; back to the result screen at the end.
function replayFrame(now) {
  const r = app.replay;
  const i = r && app.screen === 'replay' ? frameIndex(r.clip, now - r.t0) : -1;
  if (i < 0) return endReplay();
  const st = r.clip[i].state;
  const worn = dressColors(st.f.map((f) => f.char), fightLooks());
  const mine = app.mode === 'online' ? app.online?.mySlot ?? -1 : app.mode !== 'versus' ? 0 : -1;
  for (let k = r.last + 1; k <= i; k++) handleEvents(r.clip[k].events, r.clip[k].state, { quiet: false, project: stage.project, me: mine, colors: worn });
  r.last = i;
  const tags = labels();
  const humans = app.mode === 'online' ? tags.map((_, i) => i === mine) : tags.map((t) => t === 'YOU' || t === 'P1' || t === 'P2');
  stage.render({ state: st, theme: app.fightPlace, looks: fightLooks(), demo: false, labels: tags, boss: null, humans, me: mine, net: '', hint: '', clearCorners: touchOver(), noTags: false, replay: { on: r.on } }, now);
}

function endReplay() {
  app.replay = null;
  stage.reset();
  if (app.screen === 'replay') show('result');
}

// The picture: the 3D scene and the effects layer over it, as one PNG
// (read straight after drawing, while the 3D canvas still holds the frame).
function savePicture() {
  const gl = $('#gl');
  const hud = $('#hud');
  const c = document.createElement('canvas');
  const src = gl && !gl.hidden && gl.width ? gl : hud;
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  if (src === gl) g.drawImage(gl, 0, 0, c.width, c.height);
  g.drawImage(hud, 0, 0, c.width, c.height);
  c.toBlob(async (blob) => {
    if (!blob) return;
    const filename = `gd-arena-${app.fightPlace || 'arena'}.png`;
    // Inside a claude.ai Artifact a page may not download by itself: the
    // viewer is offered the file through the 'downloads' capability (and
    // confirms it). On the website, a plain download.
    const viewer = typeof window !== 'undefined' && window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (viewer) {
      viewer.save({ filename, data: blob }).catch(() => {}); // (declined or unavailable: nothing to do)
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
}

// Photo mode: drag anywhere off the buttons, or the arrow keys, to turn
// the camera; up and down move it in and out.
if (typeof window !== 'undefined') {
  // One finger (or the mouse) turns; two fingers pinch to move in and out.
  let dragX = null;
  const fingers = new Map();
  let pinch = null;
  const spread = () => {
    const [a, b] = [...fingers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  window.addEventListener('pointerdown', (e) => {
    if (app.screen !== 'photo' || e.target.closest?.('button')) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragX = fingers.size === 1 ? e.clientX : null;
    pinch = fingers.size === 2 ? { d: spread(), zoom: app.photo?.zoom ?? 1 } : null;
  });
  window.addEventListener('pointermove', (e) => {
    if (!app.photo || !fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && fingers.size === 2) {
      app.photo.zoom = Math.max(0.45, Math.min(1.6, (pinch.zoom * pinch.d) / Math.max(20, spread())));
    } else if (dragX !== null) {
      app.photo.yaw += (e.clientX - dragX) * 0.008;
      dragX = e.clientX;
    }
  });
  const lift = (e) => {
    fingers.delete(e.pointerId);
    dragX = null;
    pinch = null;
  };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  window.addEventListener('keydown', (e) => {
    if (app.screen !== 'photo' || !app.photo) return;
    if (e.key === 'ArrowLeft') app.photo.yaw -= 0.2;
    else if (e.key === 'ArrowRight') app.photo.yaw += 0.2;
    else if (e.key === 'ArrowUp') app.photo.zoom = Math.max(0.45, app.photo.zoom - 0.08);
    else if (e.key === 'ArrowDown') app.photo.zoom = Math.min(1.6, app.photo.zoom + 0.08);
  });
}

let lastFrameAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // Real time since the last frame, in 60 fps frames (at most four), so the
  // crowd settles at the same pace on a slower screen.
  const frames = lastFrameAt ? Math.min(4, (now - lastFrameAt) / (1000 / 60)) : 1;
  lastFrameAt = now;
  padMenus();
  const playing = app.game;
  const g = playing || app.demo;
  if (!g || !stage) return;
  // A replay ends at once when something else takes the screen (online: the
  // host starts the next fight, or the room closes).
  if (app.replay && app.screen !== 'replay') app.replay = null;
  // Photo mode with a gamepad: the stick turns the camera and moves it in
  // and out (A presses the focused button: Save picture, Back...).
  if (app.screen === 'photo' && app.photo) {
    const pad = readPad(0);
    if (pad & INPUT.LEFT) app.photo.yaw -= 0.03;
    if (pad & INPUT.RIGHT) app.photo.yaw += 0.03;
    if (pad & INPUT.UP) app.photo.zoom = Math.max(0.45, app.photo.zoom - 0.012);
    if (pad & INPUT.DOWN) app.photo.zoom = Math.min(1.6, app.photo.zoom + 0.012);
  }
  if (app.replay) {
    // Online, the match's own upkeep goes on underneath (its messages and
    // pings); what it would draw is the replay's.
    if (app.mode === 'online') {
      g.update(now);
      g.drain();
    }
    return replayFrame(now);
  }
  if (padStartPressed()) togglePause();
  g.update(now);
  if (playing && practising()) keepTraining(g.state);
  if (playing && app.screen === 'fight') {
    // The music pushes harder when the ring is closing or the round decides the match.
    const st = g.state;
    const deciding = st.mode === 'arena' ? st.round === MODES.arena.maxRounds : st.pts[0] === 1 && st.pts[1] === 1;
    // ...and when a player's own fighter is down to a last stand.
    const ownSlots = app.mode === 'versus' ? [0, 1] : app.mode === 'online' ? [app.online?.mySlot ?? -1] : [0];
    const atTheEdge = ownSlots.some((i) => st.f[i] && st.f[i].hp > 0 && st.f[i].hp < st.f[i].maxHp * 0.25);
    const want = st.phase === 'fight' && !practising() && (st.ringR < ARENA.R - 1 || deciding || atTheEdge) ? 'final' : 'fight';
    if (want !== app.music) {
      app.music = want;
      setMusic(want);
    }
  }
  const self = app.mode === 'online' ? app.online?.mySlot ?? -1 : playing && app.mode !== 'versus' ? 0 : -1;
  const events = g.drain();
  if (playing) tallyFight(g, events);
  if (playing && app.screen === 'fight' && !practising()) tape.push(g.state, events, now);
  if (playing && app.mode === 'tutorial') {
    watchLesson(g.state, events);
    // Every step done: a moment to see the last tick, then the lesson's end.
    if (app.lessonEnd && performance.now() >= app.lessonEnd && app.screen === 'fight') {
      app.lessonEnd = 0;
      g.paused = true;
      show('lessonDone');
    }
  }
  // A change of controller renames the controls in the lesson panel at once.
  if (playing && !drillEl.hidden && lastDevice() !== app.drillDevice) {
    app.drillDevice = lastDevice();
    drawLesson();
  }
  // Footsteps of the walking fighters, by what the floor is made of (one
  // step every 14 ticks of a walk; brawls only the player's own, so four
  // pairs of feet do not patter).
  // The recording is over: the partner plays it back from now on.
  if (app.tape && app.tape.mode !== app.tapeWas) {
    if (app.tapeWas === 'rec' && app.tape.mode === 'play') showBanner('REPLAY', 'YOUR PARTNER REPEATS IT · PAUSE TO STOP', '#7fe0ff', 1300);
    app.tapeWas = app.tape.mode;
  }
  if (playing && app.screen === 'fight' && g.state.phase === 'fight') {
    const sound = STEP_SOUND[app.fightPlace] || 'stepStone';
    g.state.f.forEach((f, i) => {
      if (f.state !== 'walk' || f.h > 0 || (g.state.f.length > 2 && i !== self)) return;
      const step = Math.floor(f.t / 14);
      if (step !== app.lastStep?.[i]) {
        (app.lastStep ||= [])[i] = step;
        if (f.t > 0) play(sound);
      }
    });
  }
  // A heartbeat when a player's fighter is nearly out: tension, and a warning
  // that reaches the player even when their eyes are off the health bar.
  if (playing && g.state.phase === 'fight' && !practising() && !g.paused) {
    const players = app.mode === 'versus' ? [0, 1] : self >= 0 ? [self] : [];
    const low = players.some((i) => g.state.f[i] && g.state.f[i].hp > 0 && g.state.f[i].hp < g.state.f[i].maxHp * 0.25);
    if (low && now >= (app.nextBeat || 0)) {
      play('heartbeat');
      app.nextBeat = now + 900;
    }
  }
  const worn = playing ? dressColors(g.state.f.map((f) => f.char), fightLooks()) : null;
  // The crowd: a low murmur while a fight is on, roaring at big moments and
  // settling back down. Silent in the menus and in Training.
  for (const e of playing ? events : []) {
    if (e.type === 'hit') app.roar = Math.min(1, (app.roar || 0) + (e.kind === 'super' ? 0.6 : e.heavy ? 0.18 : 0.05));
    else if (e.type === 'ko' || e.type === 'out' || e.type === 'parry') app.roar = Math.min(1, (app.roar || 0) + (e.type === 'parry' ? 0.25 : 0.7));
  }
  app.roar = (app.roar || 0) * Math.pow(0.985, frames);
  const crowdOn = playing && !practising() && g.state.phase !== 'over' && !app.game?.paused;
  setCrowd(crowdOn ? 0.18 + app.roar * 0.82 : 0);
  // The weather, heard: as strong as the round's mood makes it (see THEMES).
  const sky = THEMES[app.fightPlace] || THEMES.courtyard;
  const mood = sky.moods[Math.min(2, Math.max(0, g.state.round - 1))];
  setWeather(sky.weather, crowdOn ? mood.rain : 0);
  // Life around the arena, while the weather is calm: birds in the daylight
  // arenas' first two rounds, crickets in the courtyard's night round.
  const round = g.state.round;
  setAmbience(crowdOn && mood.rain < 0.5 ? (sky.sun && round < 3 ? 'birds' : app.fightPlace === 'courtyard' && round === 2 ? 'crickets' : null) : null);
  // The music holds its breath for a finisher's freeze and the slow motion
  // after a knockout, then comes back.
  const st = g.state;
  // Paused, it steps back too, so the pause screen is a breather.
  duckMusic(playing && (app.screen === 'pause' ? 0.6 : st.freeze > 0 ? 1 : st.phase === 'ko' && st.koKind === 'ko' && st.pt < 60 ? 0.7 : 0));
  // (How the match was won, for the banner and the announcer at its end.)
  const how = playing && events.some((e) => e.type === 'matchEnd') ? howWon(g.state, app.roundEnds || []) : '';
  handleEvents(events, g.state, { quiet: !playing, project: stage.project, me: self, colors: worn, how });
  // The sounds of each fighter's ritual while a round is announced.
  if (playing && st.phase === 'intro') {
    for (const f of st.f) for (const name of ritualSounds(getFighter(f.char).entrance, app.lastIntroPt, st.pt)) play(name);
  }
  app.lastIntroPt = st.phase === 'intro' ? st.pt : -1;

  const boss = playing && app.mode === 'arcade' ? [false, !!app.arcade.ladder[app.arcade.stage].boss] : null;
  const tags = playing ? labels() : [];
  const mine = app.mode === 'online' ? app.online?.mySlot ?? -1 : playing && app.mode !== 'versus' ? 0 : -1;
  const humans = app.mode === 'online' ? tags.map((_, i) => i === mine) : tags.map((t) => t === 'YOU' || t === 'P1' || t === 'P2');
  const net = app.mode === 'online' && playing ? app.online?.status() : '';
  const wait = app.mode === 'online' && playing ? app.online?.waiting?.() ?? '' : '';
  const hint = !playing || !touchEl.hidden || app.screen !== 'fight' // (not through the pause screen)
    ? ''
    : app.mode === 'versus' && lastDevice() === 'pad'
      ? (({ p, k, b, s, u, j, g }) => `Pad 1 and pad 2: stick move · ${j} jump · ${p} punch · ${k} kick · ${g} throw · ${b} block · ${s} special · ${u} finisher`)(PAD_NAMES[padStyle()])
      : app.mode === 'versus'
      ? 'P1: WASD move · Space jump · F G punch kick · V throw · H block · T Y special finisher     P2: arrows · U · J K · M · L · I O'
      : (({ p, k, b, s, u, j, g, walk }) => `${walk} move · ${j} jump · ${p} punch (x3 combo) · ${k} kick · ${g} throw · ${b} block (+move = roll) · ${s} special · ${u} finisher`)(controlNames());
  const place = playing ? app.fightPlace : app.place;
  setMusicTheme(place);
  setFloor(place);
  // Behind the menus (and the pause and result screens) the arena is drawn
  // on every other frame: thirty a second is plenty for a backdrop, and a
  // phone stays cooler and lasts longer while someone reads. (Everything
  // still runs on the clock, so nothing slows down.)
  if (!playing || app.screen !== 'fight') {
    app.demoSkip = !app.demoSkip;
    if (app.demoSkip) return;
  }
  // An online host whose drawing is slow draws less often (about ten times a
  // second), so its device has time left to run the fight and send it to the
  // guests: they see the fight through the host's updates, not its screen.
  if (app.mode === 'online' && playing && app.online?.isHosting?.() && app.hostDrawMs > 30 && now - (app.lastDrawAt || 0) < 90) return;
  const drawStart = performance.now();
  stage.render({ state: g.state, theme: place, looks: playing ? fightLooks() : null, demo: !playing, photo: app.screen === 'photo' ? app.photo : null, labels: tags, boss, humans, me: mine, net, wait, hint, hintAlways: practising(), clearCorners: touchOver(), noTags: app.screen === 'pause', inputs: playing && app.mode === 'training' && app.screen === 'fight' ? app.pressed : null }, now);
  if (app.photoSave) {
    app.photoSave = false;
    savePicture();
  }
  app.hostDrawMs = (app.hostDrawMs || 16) + (performance.now() - drawStart - (app.hostDrawMs || 16)) * 0.1;
  app.lastDrawAt = now;

  const s = g.state;
  if (playing && !touchEl.hidden) {
    // Thumbs can cover the energy bar, so the buttons themselves light up
    // when the special and the finisher can be used.
    const own = s.f[Math.max(0, mine)];
    spBtn.classList.toggle('ready', own.meter >= RULES.SPECIAL_COST);
    ultBtn.classList.toggle('ready', own.meter >= RULES.SUPER_COST);
  }
  if (playing) {
    if (s.phase === 'over' && !app.resultShown && s.pt > 150) {
      app.resultShown = true;
      if (app.mode === 'online') countRoomWin(s);
      app.newBests = [];
      scoreMatch();
      app.koClip = tape.clip();
      tape.clear();
      show('result'); // (the card says what is new on the Record)
    }
  } else if (s.phase === 'over' && s.pt > 200) {
    startDemo();
    stage.reset();
  }
}

async function boot() {
  setBuzz(vibrateOn()); // (the vibration setting, as last left)
  ui.innerHTML = '<p class="loading">Entering the arena…</p>';
  layout();
  // Text painted on canvases needs the fonts ready first; never wait long.
  const fonts = document.fonts
    ? Promise.all([document.fonts.load('700 40px Teko'), document.fonts.load('600 14px Barlow')]).catch(() => {})
    : Promise.resolve();
  await Promise.all([loadAssets(), Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))])]);

  stage = createStage($('#gl'), $('#hud'));
  if (DEBUG) window.gdStage = stage;
  try {
    app.graphics = localStorage.getItem('gd-arena-graphics') || 'auto';
  } catch {
    app.graphics = 'auto';
  }
  stage.setGraphics(app.graphics);
  touchLayout = createTouchLayout(touchEl, isPortrait);
  initKeyboard(togglePause);
  initTouch(touchEl);
  window.addEventListener('resize', layout);
  window.addEventListener('pointerdown', (e) => {
    // The first real touch switches the on-screen buttons on, even mid-fight.
    if (e.pointerType === 'touch' && !app.touch) {
      app.touch = true;
      refreshTouch();
    }
    unlockAudio();
  });
  window.addEventListener('keydown', unlockAudio);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (app.screen === 'fight') togglePause();
      setMusic('off');
    } else {
      setMusic(app.screen === 'fight' ? 'fight' : 'menu');
      keepAwake(app.screen === 'fight'); // the lock is dropped whenever the page is hidden
    }
  });

  startDemo();
  show('menu');
  layout();
  requestAnimationFrame(frame);
  if (NET && invited()) ACTIONS.online();
}

boot();
