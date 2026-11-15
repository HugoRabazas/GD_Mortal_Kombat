// The app shell: builds the page, runs the frame loop and moves between the
// screens (menu -> fighter select -> fight -> result).

import { FIGHTERS, getFighter, lookColors, dressColors } from '../../shared/fighters.js';
import { ARENA, INPUT, MODES, RULES, TICK_RATE } from '../../shared/constants.js';
import { createAI, aiInput } from '../../shared/ai.js';
import { loadAssets, headUrls } from './assets.js';
import { createStage } from './stage.js';
import { createGame } from './game.js';
import { handleEvents } from './effects.js';
import { initKeyboard, initTouch, readKeys, readTouch, readPad, padStartPressed, padMenu, setCapture, setTouchLive, lastDevice } from './input.js';
import { createTouchLayout } from './touchLayout.js';
import { unlockAudio, play, isMuted, setMuted, setMusic, setMusicTheme, setCrowd, getVolume, setVolume } from './audio.js';
import { createOnline } from './net/online.js';
import { ARENAS, isArenaId } from './arenas.js';

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
    <p id="turn">Turn your phone sideways for a bigger view.</p>
  </div>
  <div id="ui"></div>
`;

const $ = (sel) => root.querySelector(sel);
const stageEl = $('#stage');
const ui = $('#ui');
const touchEl = $('#touch');
const pauseBtn = $('#pause-btn');
const drillEl = $('#drill');
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
  { level: 'boss', mod: { health: 1.3, power: 1.1 }, boss: true },
];

const app = {
  screen: 'loading',
  mode: 'arcade', // 'arcade', 'arena' and 'quick' are single player, 'versus' is two players
  vsArena: false, // in 2-player mode: a duel, or a brawl with two CPU fighters added
  dummy: 'still', // training partner: 'still', 'block' or 'fight'
  picks: [FIGHTERS[0].id, FIGHTERS[1 % FIGHTERS.length].id],
  level: 'normal',
  place: ARENAS[0].id, // the arena the player chose; the fight behind the menus shows it
  fightPlace: ARENAS[0].id, // the arena of the fight being played
  arcade: null, // { ladder, stage, score, retries, gained }
  game: null, // the fight being played, if any
  demo: null, // the CPU-vs-CPU fight that plays behind the menus
  resultShown: false,
  arrangeFrom: 'menu',
  online: null, // the connection to the alliance lobby, once the player goes online
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

try {
  const saved = localStorage.getItem('gd-arena-place');
  if (isArenaId(saved)) app.place = saved;
} catch {
  // storage unavailable: the first arena
}

// The row of buttons that picks the arena.
function placePicker() {
  return `<div class="seg places" role="group" aria-label="Arena">${ARENAS.map((a) => `<button type="button" class="${app.place === a.id ? 'on' : ''}" data-act="place" data-id="${a.id}" aria-pressed="${app.place === a.id}">${a.name}</button>`).join('')}</div>`;
}

// True until this device has started its first fight.
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

function layout() {
  const style = getComputedStyle(root);
  const availW = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  let availH = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const portrait = isPortrait();
  root.classList.toggle('portrait', portrait);
  // In portrait the touch controls sit under the stage and need their own room.
  if (portrait && !touchEl.hidden) availH -= 236;
  const w = Math.max(160, Math.floor(Math.min(availW, (availH * 16) / 9)));
  const h = Math.floor((w * 9) / 16);
  stageEl.style.width = `${w}px`;
  stageEl.style.height = `${h}px`;
  stage?.resize(w, h);
  touchLayout?.apply();
}

// --------------------------------------------------------------- screens ---

const head = (id, cls = '') => `<img class="head ${cls}" src="${headUrls.get(id)}" alt="" />`;
const touchLabel = () => (app.touch ? 'Touch buttons on' : 'Touch buttons off');
const points = (n) => n.toLocaleString('en-US');

function buildLadder(playerId) {
  const others = FIGHTERS.filter((f) => f.id !== playerId);
  const pool = others.length ? others : FIGHTERS;
  // Every rival once, then a mirror match if there is a stage left to fill.
  const order = pool.map((f) => f.id).slice(0, STAGES.length - 1);
  while (order.length < STAGES.length - 1) order.push(order.length % 2 ? playerId : pool[order.length % pool.length].id);
  order.push(pool[0].id); // the boss is your first rival again, powered up
  return STAGES.map((st, i) => ({ ...st, char: order[i], rivals: st.brawl ? rivalsFor([playerId]) : null }));
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
        <button type="button" class="btn quiet" data-act="training">Training <small>${drillsDone().size ? `${drillsDone().size} of ${DRILLS.length} moves learned` : 'practise your moves'}</small></button>
        <button type="button" class="btn quiet" data-act="help">How to play</button>
      </div>
      ${best ? `<p class="best">Arcade best <b>${points(best)}</b></p>` : ''}
      ${isNewcomer() ? '<p class="note">New here? <b>Training</b> lets you try every move with no clock.</p>' : ''}
      <div class="foot">
        <button type="button" class="link" data-act="settings">Settings</button>
        <button type="button" class="link" data-act="touch">${touchLabel()}</button>
        <button type="button" class="link" data-act="arrange">Arrange buttons</button>
        <button type="button" class="link" data-act="fullscreen">Full screen</button>
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
function rivalsFor(taken) {
  const rest = FIGHTERS.filter((f) => !taken.includes(f.id)).map((f) => f.id);
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
  const levels = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
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
        ${mode === 'quick' || mode === 'arena' ? seg(levels, app.level, 'level') : ''}
        ${mode === 'training' ? seg([['still', 'Still'], ['block', 'Blocks'], ['beat', 'Kicks'], ['fight', 'Fights back']], app.dummy, 'dummy') : ''}
        ${mode === 'versus' ? seg([['duel', 'Duel'], ['brawl', 'Brawl with 2 CPU']], app.vsArena ? 'brawl' : 'duel', 'vsKind') : ''}
        ${placePicker()}
      </div>
      ${mode === 'training' ? `<p class="note">No clock, and health and energy refill, so you can try every move. ${app.dummy === 'beat' ? 'Your partner walks up and kicks on a steady beat: raise your guard just before the kick lands for a perfect guard, or roll through it.' : 'Pause to leave.'}</p>` : ''}
      ${mode === 'versus' && app.touch ? '<p class="note">Two players need a keyboard or gamepads: the on-screen buttons control one fighter only.</p>' : ''}
      ${mode === 'arcade' ? '<p class="note aside">The ladder moves to the other arena after every fight.</p>' : ''}
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
  const row = (what, ...cols) => `<tr><th scope="row">${what}</th>${cols.map((v, i) => cell(i + 1, v)).join('')}</tr>`;
  const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');
  const heads = ['Single player', '2P · Player 1', '2P · Player 2', 'Gamepad', 'Touch'];
  return `
    <section class="screen help">
      <h2>How to play</h2>
      <div class="scroll">
        <table>
          <thead><tr><th></th>${heads.map((h, i) => cell(i + 1, h + (i + 1 === lit ? ' · yours' : ''), 'th')).join('')}</tr></thead>
          <tbody>
            ${row('Walk', `${k('W', 'A', 'S', 'D')} or arrows`, k('W', 'A', 'S', 'D'), 'Arrows', 'Stick / D-pad', 'Stick')}
            ${row('Jump', `${k('Space')} or ${k('U')}`, k('Space'), k('U'), 'A / Cross', k('JMP'))}
            ${row('Punch', `${k('J')} or ${k('F')}`, k('F'), k('J'), 'X / Square', k('P'))}
            ${row('Kick', `${k('K')} or ${k('G')}`, k('G'), k('K'), 'B / Circle', k('K'))}
            ${row('Block', `${k('L')} or ${k('H')}`, k('H'), k('L'), 'LB / LT', k('BLK'))}
            ${row('Special', `${k('I')} or ${k('T')}`, k('T'), k('I'), 'Y / Triangle', k('SP'))}
            ${row('Finisher', `${k('O')} or ${k('Y')}`, k('Y'), k('O'), 'RB / RT', k('ULT'))}
          </tbody>
        </table>
      </div>
      <ul class="tips">
        <li><b>Walk anywhere</b> on the arena: left, right, into the depth and back. Attacks turn you towards the nearest rival, so you do not need perfect aim.</li>
        <li><b>Punch three times</b> for a combo that ends in a knockdown; each punch must land to continue.</li>
        <li><b>Punch + Kick together</b> is a grab: short reach, but it goes straight through a guard.</li>
        <li><b>Block + a direction</b> is a dodge roll: attacks pass through you for a moment.</li>
        <li>Hit a rival while they are <b>winding up</b> a blow of their own for a <b>counter</b>: a quarter more damage.</li>
        <li><b>Block at the last moment</b>, just before a blow lands, for a perfect guard: it costs no health, gives energy, and a kick or another heavy blow leaves the attacker reeling. Hold the guard and it is an ordinary block.</li>
        <li>Hits fill your <b>energy</b> bar. A special costs about a third of it; a finisher needs it full.</li>
        <li>Under a quarter of your health you are in your <b>last stand</b>: the energy bar fills half as fast again. A round is not over until it is over.</li>
        <li><b>Block</b> only stops what comes from the front. Get behind a blocking rival, or step out of the way of a projectile.</li>
        <li><b>Jump</b> over a ground stomp; punch or kick in the air for a diving attack.</li>
        <li><b>Crystals</b> appear on the floor: gold gives energy, green gives health. Walk over one to take it.</li>
        <li>As the clock runs down, a <b>ring of fire</b> closes in. Knock a rival into it for extra damage.</li>
        <li><b>Arcade</b>: ${STAGES.length} fights in a row, the last against a boss, moving between the arenas as you climb.</li>
        <li><b>Arena</b>: four fighters at once, three rounds. Each round gives 3, 2, 1 or 0 points by how long you last; level on points means a shared place.</li>
        <li><b>Training</b> in the menu is a fight with no clock where health and energy refill, against a partner who stands still, blocks, kicks on a beat or fights back. A checklist ticks off each move the first time you really do it.</li>
        <li>A <b>heartbeat</b> means your fighter is nearly out.</li>
        <li>On a phone, use the stick and the buttons on screen. The stick follows your thumb: touch anywhere free on its side of the screen. <b>Arrange buttons</b> lets you drag them where you like.</li>
        <li>With a <b>gamepad</b> you can also work the menus: stick or D-pad to move, A to choose, B to go back.</li>
        <li>Press <kbd>P</kbd>, <kbd>Esc</kbd> or Start to pause.</li>
      </ul>
      <div class="row"><button type="button" class="btn primary" data-act="menu">Back</button></div>
    </section>`;
}

// What each kind of special move does, in a few words.
const SPECIAL_NOTES = {
  dash: 'a lunge across the arena that knocks down',
  bolt: 'a projectile that flies where you face',
  rise: 'a spinning leap that hits all around you',
  quake: 'a stomp that floors everyone near who is not in the air',
};

// The move list on the pause screen: every move of the fighter being played,
// with the keys (or on-screen buttons) this player is actually using.
// The names of the controls on the device the player is using right now.
function controlNames() {
  const d = lastDevice() ?? (app.touch ? 'touch' : 'keys');
  if (d === 'pad') return { p: 'X', k: 'B', b: 'LB', s: 'Y', u: 'RB', j: 'A', move: 'the stick', walk: 'Stick' };
  if (d === 'touch' && app.touch) return { p: 'P', k: 'K', b: 'BLK', s: 'SP', u: 'ULT', j: 'JMP', move: 'the stick', walk: 'Stick' };
  return { p: 'J', k: 'K', b: 'L', s: 'I', u: 'O', j: 'Space', move: 'W A S D', walk: 'WASD' };
}

function movesCard() {
  const s = app.game?.state;
  if (!s) return '';
  const two = app.mode === 'versus';
  const key = two && lastDevice() !== 'pad' ? { p: 'F / J', k: 'G / K', b: 'H / L', s: 'T / I', u: 'Y / O', j: 'Space / U' } : controlNames();
  const k = (...names) => names.map((n) => `<kbd>${n}</kbd>`).join(' ');
  const slots = two ? [0, 1] : [app.mode === 'online' ? Math.max(0, app.online?.mySlot ?? 0) : 0];
  const own = slots
    .map((slot) => {
      const f = getFighter(s.f[slot].char);
      const who = two ? `${f.name}: ` : '';
      return `
        <dt>${k(key.s)}</dt><dd>${who}<b>${f.special.name}</b> - ${SPECIAL_NOTES[f.special.type] || 'special move'}. Costs a third of the energy bar.</dd>
        <dt>${k(key.u)}</dt><dd>${who}<b>${f.super.name}</b> - the finisher. Needs the whole bar.</dd>`;
    })
    .join('');
  return `
    <dl class="movelist" aria-label="Moves">
      <dt>${k(key.p, key.p, key.p)}</dt><dd><b>Three-punch combo</b>; each punch must land, the third knocks down.</dd>
      <dt>${k(key.k)}</dt><dd><b>Kick</b>: slower than a punch, heavier, longer reach.</dd>
      <dt>${k(key.p)} + ${k(key.k)}</dt><dd><b>Grab</b>: short reach, goes straight through a guard.</dd>
      <dt>${k(key.j)}, ${k(key.p)}</dt><dd><b>Diving attack</b> from the air.</dd>
      <dt>${k(key.b)}</dt><dd><b>Block</b> what comes from the front. Raised just before the blow: a <b>perfect guard</b>.</dd>
      <dt>${k(key.b)} + move</dt><dd><b>Dodge roll</b>: attacks pass through you.</dd>
      <dt>${k(key.p)}</dt><dd>Into a rival <b>winding up</b> a blow: a <b>counter hit</b>, a quarter more damage.</dd>
      ${own}
    </dl>`;
}

function pauseScreen() {
  return `
    <section class="screen pause">
      <h2>Paused</h2>
      <div class="cols">
        <div class="stack">
          <button type="button" class="btn primary" data-act="resume">Resume</button>
          ${app.mode === 'online' ? '' : '<button type="button" class="btn" data-act="rematch">Restart fight</button>'}
          <button type="button" class="btn" data-act="settings">Settings</button>
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
      <div class="row">
        <button type="button" class="btn small" data-act="mute">${isMuted() ? 'Sound off' : 'Sound on'}</button>
        <button type="button" class="btn small" data-act="touch">${touchLabel()}</button>
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

// --------------------------------------------------------------- drills ---
// Training keeps a checklist of every move. Each one ticks itself off the
// first time the player really does it (a combo has to land, a block has to
// stop a blow), and the device remembers the progress.
const DRILLS = [
  { id: 'walk', name: 'Walk', how: () => (controlNames().walk === 'WASD' ? '<kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>' : 'move the stick') },
  { id: 'jump', name: 'Jump', how: (k) => k('j') },
  { id: 'combo', name: 'Three-punch combo', how: (k) => `${k('p')} ${k('p')} ${k('p')}, each punch landing` },
  { id: 'kick', name: 'Land a kick', how: (k) => k('k') },
  { id: 'grab', name: 'Grab', how: (k) => `${k('p')} + ${k('k')} together, up close` },
  { id: 'dive', name: 'Diving attack', how: (k) => `${k('j')}, then ${k('p')} in the air` },
  { id: 'roll', name: 'Dodge roll', how: (k) => `${k('b')} + a direction` },
  { id: 'block', name: 'Block a blow', how: (k) => `${k('b')} as a blow comes (pick a partner who attacks)` },
  { id: 'perfect', name: 'Perfect guard', how: (k) => `${k('b')} just before a blow lands (the Kicks partner helps)` },
  { id: 'counter', name: 'Counter hit', how: (k) => `${k('p')} while the rival winds up a blow (the Kicks partner helps)` },
  { id: 'special', name: 'Special move', how: (k) => `${k('s')} with a third of the energy bar` },
  { id: 'super', name: 'Finisher', how: (k) => `${k('u')} with a full energy bar` },
];

let drillMemo = null;
function drillsDone() {
  if (!drillMemo) {
    drillMemo = new Set();
    try {
      for (const id of JSON.parse(localStorage.getItem('gd-arena-drills') || '[]')) drillMemo.add(id);
    } catch {
      // nothing remembered
    }
  }
  return drillMemo;
}

function markDrill(id) {
  const done = drillsDone();
  if (done.has(id) || !DRILLS.some((d) => d.id === id)) return;
  done.add(id);
  try {
    localStorage.setItem('gd-arena-drills', JSON.stringify([...done]));
  } catch {
    // not remembered
  }
  play('pickup');
  drawDrills(id);
}

// Watch the training fight for moves the player has not ticked off yet.
function watchDrills(s, events) {
  if (s.f[0].state === 'walk') markDrill('walk');
  for (const e of events) {
    if (e.type === 'jump' && e.by === 0) markDrill('jump');
    else if (e.type === 'roll' && e.by === 0) markDrill('roll');
    else if (e.type === 'special' && e.by === 0) markDrill('special');
    else if (e.type === 'super' && e.by === 0) markDrill('super');
    else if (e.type === 'parry' && e.by === 0) markDrill('perfect');
    else if (e.type === 'block' && e.on === 0) markDrill('block');
    else if (e.type === 'hit' && e.by === 0) {
      if (e.counter) markDrill('counter');
      if (e.kind === 'punch3') markDrill('combo');
      else if (e.kind === 'kick') markDrill('kick');
      else if (e.kind === 'grab') markDrill('grab');
      else if (e.kind === 'airKick') markDrill('dive');
    }
  }
}

// The checklist panel: progress, and the next few moves with how to do them.
function drawDrills(justDone) {
  const done = drillsDone();
  const names = controlNames();
  const k = (id) => `<kbd>${names[id] ?? id}</kbd>`;
  const left = DRILLS.filter((d) => !done.has(d.id));
  const just = DRILLS.find((d) => d.id === justDone);
  drillEl.innerHTML = `
    <b>Moves ${done.size} / ${DRILLS.length}</b>
    ${just ? `<p class="got">✓ ${just.name}</p>` : ''}
    ${
      left.length
        ? `<ol>${left
            .slice(0, 3)
            .map((d, i) => `<li>${d.name}${i === 0 ? `<span>${d.how(k)}</span>` : ''}</li>`)
            .join('')}</ol>`
        : '<p>Every move learned. Try the Fights back partner, or a Quick Fight.</p>'
    }`;
}

// ------------------------------------------------------------ fight stats ---
// Counted from the fight's own events, so they are the same on every screen
// of an online match: damage dealt, blows landed, the longest combo and the
// perfect guards of each fighter.
function tallyFight(g, events) {
  if (app.statsFor !== g) {
    app.statsFor = g;
    app.stats = g.state.f.map(() => ({ dmg: 0, hits: 0, combo: 0, perfect: 0 }));
  }
  for (const e of events) {
    const st = app.stats[e.by];
    if (!st) continue;
    if (e.type === 'hit') {
      st.dmg += e.dealt ?? e.dmg;
      st.hits++;
      st.combo = Math.max(st.combo, e.combo || 1);
    } else if (e.type === 'parry') {
      st.perfect++;
    }
  }
}

// One line of numbers per fighter, for the result screen of a duel.
function statsCard() {
  const s = app.game?.state;
  if (!s || app.statsFor !== app.game || !app.stats) return '';
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
function statsLine(slot) {
  const st = app.statsFor === app.game ? app.stats?.[slot] : null;
  return st ? `<small>${st.dmg} damage · ${st.hits} hits · combo ${st.combo}${st.perfect ? ` · ${st.perfect} perfect` : ''}</small>` : '';
}

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
            <span class="lname">${getFighter(r.char).name}${statsLine(r.slot)}</span>
            <span class="ltag">${esc(who[r.slot])}</span>
            <span class="pts">${r.points} pts</span>
          </li>`,
        )
        .join('')}
    </ol>`;
}

// What a finished arcade fight shows: the duel's numbers, or a brawl's standings.
const outcome = () => (app.game.state.mode === 'arena' ? rankingList() : statsCard());

function resultScreen() {
  const s = app.game.state;
  const won = s.matchWinner === 0;
  const again =
    app.mode === 'online'
      ? '<button type="button" class="btn primary" data-act="onBack">Back to the room</button>'
      : `<button type="button" class="btn primary" data-act="rematch">Rematch</button>
          <button type="button" class="btn" data-act="select">Change fighter</button>
          <button type="button" class="btn quiet" data-act="menu">Menu</button>`;
  if (app.mode === 'online' && s.mode !== 'arena') return `<section class="screen result">${statsCard()}<div class="row">${again}</div></section>`;
  if (s.mode === 'arena' && app.mode !== 'arcade') {
    return `
      <section class="screen result">
        ${rankingList()}
        <div class="row">${again}</div>
      </section>`;
  }
  if (app.mode !== 'arcade') {
    return `
      <section class="screen result">
        ${statsCard()}
        <div class="row">
          <button type="button" class="btn primary" data-act="rematch">Rematch</button>
          <button type="button" class="btn" data-act="select">Change fighters</button>
          <button type="button" class="btn quiet" data-act="menu">Menu</button>
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
        <div class="row">
          <button type="button" class="btn primary" data-act="retry">Try again</button>
          <button type="button" class="btn quiet" data-act="menu">Menu</button>
        </div>
      </section>`;
  }
  if (a.stage >= total - 1) {
    return `
      <section class="screen result">
        <p class="headline">Arena champion</p>
        <p class="sub">Final score ${points(a.score)}${a.score >= bestScore() ? ' · new best' : ''}</p>
        ${outcome()}
        <div class="row">
          <button type="button" class="btn primary" data-act="arcade">Play again</button>
          <button type="button" class="btn quiet" data-act="menu">Menu</button>
        </div>
      </section>`;
  }
  const next = a.ladder[a.stage + 1];
  return `
    <section class="screen result">
      <p class="headline">Stage ${a.stage + 1} cleared · +${points(a.gained)}</p>
      <p class="sub next">Next: ${next.brawl ? `<b>a brawl</b> against ${next.rivals.map((id) => head(id)).join('')} all at once` : `${head(next.char)} <b>${getFighter(next.char).name}</b>${next.boss ? ' · the boss' : ''}`}</p>
      ${outcome()}
      <div class="row">
        <button type="button" class="btn primary" data-act="next">Next fight</button>
        <button type="button" class="btn quiet" data-act="menu">Menu</button>
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
            ${on.lobbyPeers.map((p) => `<li>${head(p.char)}<span class="lname">${esc(p.name)}${p.id === on.me.id ? ' (you)' : ''}</span><span class="ltag">${p.playing ? 'fighting' : p.room ? 'in a room' : 'in the lobby'}</span></li>`).join('')}
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
                      return `<li class="roomrow"><span class="faces" aria-hidden="true">${r.chars.slice(0, on.maxPlayers).map((c) => head(c)).join('')}</span><span class="lname">${esc(r.names.slice(0, 3).join(', '))}${r.names.length > 3 ? '…' : ''}<small>${r.playing ? 'fighting now' : full ? 'full' : `${r.names.length} of ${on.maxPlayers}`}</small></span><button type="button" class="btn small" data-act="joinRoom" data-id="${esc(r.code)}">${r.playing || full ? 'Watch' : 'Join'}</button></li>`;
                    })
                    .join('')
                : '<li><span class="lname dim">No rooms open yet</span></li>'
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
      <div class="row"><button type="button" class="btn quiet" data-act="offline">Leave online</button></div>
    </section>`;
}

function roomScreen() {
  const on = app.online;
  const room = on.room;
  const players = on.players();
  const mine = room.peers.find((p) => p.id === on.me.id);
  const watching = room.peers.slice(4);
  const link = on.linkKind();
  return `
    <section class="screen select">
      <h2>Room ${esc(room.code)}</h2>
      <div class="versus">
        <div class="ladder">
          <span class="who">Fighters · ${players.length} of 4</span>
          <ol class="people">
            ${players
              .map(
                (p) => `<li>${head(p.char)}<span class="lname">${esc(p.name)}${p.id === on.me.id ? ' (you)' : ''}</span>
                  <span class="ltag ${p.ready || p.id === room.hostId ? 'ok' : ''}">${p.id === room.hostId ? 'host' : p.ready ? 'ready' : 'choosing'}</span></li>`,
              )
              .join('')}
          </ol>
          ${watching.length ? `<p class="rules">Watching: ${esc(watching.map((p) => p.name).join(', '))}</p>` : ''}
          <p class="rules">${link === 'direct' ? 'Connected directly.' : link === 'relayed' ? (on.canLink ? 'Connecting… (relayed for now)' : 'Connected through the server: this browser does not allow direct links, so moves may arrive a little later.') : 'Waiting for others. Share the room name, or start with CPU rivals.'}</p>
        </div>
        <div class="slot" style="--tint:${lookColors(room.char, room.look ?? 0).primary};--ring:${lookColors(room.char, room.look ?? 0).accent}">
          <span class="who">Your fighter</span>
          ${head(room.char, 'big')}
          <strong class="name">${getFighter(room.char).name}</strong>
          <span class="title">${getFighter(room.char).title}</span>
          ${statBars(getFighter(room.char))}
          <div class="picker" role="group" aria-label="Your fighter">
            ${FIGHTERS.map((o) => `<button type="button" class="pick ${o.id === room.char ? 'on' : ''}" data-act="onChar" data-id="${o.id}" aria-pressed="${o.id === room.char}" title="${o.name}">${head(o.id)}</button>`).join('')}
            ${lookButtons(room.char, room.look ?? 0, 'onLook')}
          </div>
        </div>
      </div>
      ${room.isHost ? `<div class="row"><div class="seg" role="group"><button type="button" class="${app.fill ? 'on' : ''}" data-act="fill" data-id="1">Fill with CPU</button><button type="button" class="${app.fill ? '' : 'on'}" data-act="fill" data-id="0">Players only</button></div>${placePicker()}</div>` : `<p class="note">Arena: <b>${ARENAS.find((a) => a.id === on.arena())?.name ?? ''}</b> (the host chooses)</p>`}
      ${chatBox()}
      ${room.again ? `<p class="note">${room.isHost ? 'Everyone from the last fight is still ready: start again whenever you like.' : 'Still ready from the last fight. Press Not ready to sit the next one out.'}</p>` : ''}
      ${room.mixed ? '<p class="note warn">Someone here has an older or newer version of the game. Everyone should reload the page before fighting.</p>' : ''}
      ${app.notice ? `<p class="note warn">${esc(app.notice)}</p>` : ''}
      <div class="row">
        <button type="button" class="btn quiet" data-act="leaveRoom">Leave room</button>
        <button type="button" class="btn" data-act="invite">Copy invite link</button>
        ${
          room.isHost
            ? `<button type="button" class="btn primary" data-act="onStart" ${on.canStart() ? '' : 'disabled'}>Start fight</button>`
            : `<button type="button" class="btn primary" data-act="onReady">${mine?.ready ? 'Not ready' : 'Ready'}</button>`
        }
      </div>
    </section>`;
}

const SCREENS = { settings: settingsScreen, menu: menuScreen, select: selectScreen, help: helpScreen, pause: pauseScreen, result: resultScreen, arrange: arrangeScreen, nick: nameScreen, lobby: lobbyScreen, room: roomScreen };

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
  const inFight = screen === 'fight' || screen === 'pause' || screen === 'result' || ((screen === 'arrange' || screen === 'settings') && app.game);
  ui.innerHTML = SCREENS[screen] ? SCREENS[screen]() : '';
  ui.dataset.screen = screen;
  pauseBtn.hidden = screen !== 'fight';
  drillEl.hidden = !(screen === 'fight' && app.mode === 'training');
  if (!drillEl.hidden) drawDrills();
  refreshTouch();
  touchLayout.setEditing(screen === 'arrange');
  setTouchLive(screen !== 'arrange');
  setCapture(screen === 'fight');
  if (!inFight) app.game = null;
  app.music = screen === 'fight' ? 'fight' : 'menu';
  setMusic(app.music);
  keepAwake(screen === 'fight');
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

// A training partner who kicks on a steady beat, so guards, perfect guards and
// rolls can be practised against a known rhythm. It stands on the outer side
// of the player, so every kick pushes them towards the middle of the arena
// and never into the ring of fire. The beat is counted in real ticks (hit
// pauses included), so it stays steady to the ear.
const BEAT = 100;
function drummer() {
  let beat = BEAT;
  const walk = (dx, dz) => {
    const d = Math.hypot(dx, dz) || 1;
    let bits = 0;
    if (dx / d < -0.38) bits |= INPUT.LEFT;
    if (dx / d > 0.38) bits |= INPUT.RIGHT;
    if (dz / d < -0.38) bits |= INPUT.UP;
    if (dz / d > 0.38) bits |= INPUT.DOWN;
    return bits;
  };
  return (s, slot) => {
    const me = s.f[slot];
    const you = s.f[0];
    if (beat > 0) beat--;
    const r = Math.hypot(you.x, you.z);
    const gap = Math.hypot(you.x - me.x, you.z - me.z) || 1;
    // Away from the middle, take the outer side; near it, any side will do.
    const out = r > 150;
    const vx = out ? you.x / r : (me.x - you.x) / gap;
    const vz = out ? you.z / r : (me.z - you.z) / gap;
    if (out && ((me.x - you.x) * vx + (me.z - you.z) * vz) / gap < 0.5) {
      // Not on the outer side yet: walk round the player, not into them.
      const sgn = (me.x - you.x) * -vz + (me.z - you.z) * vx >= 0 ? 1 : -1;
      return walk(you.x - vz * sgn * 115 + vx * 95 - me.x, you.z + vx * sgn * 115 + vz * 95 - me.z);
    }
    let tx = you.x + vx * 80;
    let tz = you.z + vz * 80;
    const limit = s.ringR - 50;
    const tr = Math.hypot(tx, tz);
    const clamped = tr > limit;
    if (clamped) {
      tx *= limit / tr;
      tz *= limit / tr;
    }
    const there = Math.hypot(tx - me.x, tz - me.z) < 20 || (clamped && gap < 105);
    if (!there) return walk(tx - me.x, tz - me.z);
    // Never kick a player towards the fire from the inside.
    const inside = (me.x - you.x) * you.x + (me.z - you.z) * you.z < 0;
    const risky = inside && r > s.ringR - 160;
    if (beat === 0 && gap < 105 && !risky && (me.state === 'idle' || me.state === 'walk')) {
      beat = BEAT;
      return INPUT.KICK;
    }
    return 0;
  };
}

function startDemo() {
  // A four-fighter brawl plays behind the menus, in a random order.
  const ids = FIGHTERS.map((f) => f.id).sort(() => Math.random() - 0.5);
  while (ids.length < 4) ids.push(FIGHTERS[ids.length % FIGHTERS.length].id);
  const chars = ids.slice(0, 4);
  app.demo = createGame(chars, chars.map(() => cpu('hard')));
}

function startFight() {
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
    controllers = [solo, cpu(app.level), cpu(app.level), cpu(app.level)];
  } else if (app.mode === 'quick') {
    controllers = [solo, cpu(app.level)];
  } else if (app.mode === 'training') {
    const partner = app.dummy === 'fight' ? cpu('easy') : app.dummy === 'beat' ? drummer() : app.dummy === 'block' ? () => INPUT.BLOCK : () => 0;
    controllers = [solo, partner];
  } else if (app.vsArena) {
    chars = [...app.picks, ...rivalsFor(app.picks)];
    controllers = [...two, cpu('normal'), cpu('normal')];
  } else {
    controllers = two;
  }
  app.game = createGame(chars, controllers, mods);
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
function scoreMatch() {
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
    show('menu');
  },
  async createRoom() {
    await app.online.createRoom();
    show('room');
  },
  async quickMatch() {
    await app.online.quickMatch();
    show('room');
  },
  async joinRoom(el) {
    await app.online.joinRoom(el.dataset.id);
    show('room');
  },
  async leaveRoom() {
    await app.online.leaveRoom();
    if (invited()) history.replaceState(null, '', location.pathname + location.search); // do not rejoin on reload
    app.notice = '';
    show('lobby');
  },
  onChar: (el) => app.online.setChar(el.dataset.id),
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
    app.online.setReady(!mine?.ready);
  },
  onLook(el) {
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
  onStart: () => app.online.start({ fill: app.fill, arena: app.place }),
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
    if (app.mode === 'arcade') startArcade();
    else startFight();
  },
  rematch: startFight,
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
  arrange() {
    app.arrangeFrom = app.game ? 'pause' : 'menu';
    show('arrange');
  },
  settings() {
    app.settingsFrom = app.game ? 'pause' : 'menu';
    show('settings');
  },
  settingsDone: () => show(app.settingsFrom || 'menu'),
  arrangeDone: () => show(app.arrangeFrom),
  smaller: () => touchLayout.resize(-0.1),
  bigger: () => touchLayout.resize(0.1),
  resetLayout: () => touchLayout.reset(),
  mute(el) {
    setMuted(!isMuted());
    el.textContent = isMuted() ? 'Sound off' : 'Sound on';
  },
  touch(el) {
    app.touch = !app.touch;
    el.textContent = touchLabel();
  },
  fullscreen() {
    // Not every viewer allows this (phones, some apps); it is fine if it fails.
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
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
      if (app.screen === 'lobby' || (app.screen === 'room' && online.room)) show(app.screen);
    },
    onStart(info) {
      app.mode = 'online';
      app.fightPlace = isArenaId(info?.arena) ? info.arena : ARENAS[0].id;
      app.game = online.game;
      app.resultShown = false;
      app.notice = '';
      stage.reset();
      show('fight');
      document.activeElement?.blur?.();
    },
    onEnd(reason) {
      app.game = null;
      app.notice = reason === 'host_left' ? 'The host left, so the fight ended.' : '';
      stage.reset();
      show(online.room ? 'room' : 'lobby');
    },
  });
  try {
    await online.connect();
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
    const box = ui.querySelector('#chat');
    if (app.online?.say(box.value)) {
      box.value = '';
      box.focus({ preventScroll: true });
    }
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
  if (app.mode === 'training') return ['YOU', 'PARTNER'];
  if (app.mode === 'arcade' && app.arcade) {
    const st = app.arcade.ladder[app.arcade.stage];
    if (st.brawl) return ['YOU', ...st.rivals.map(() => 'CPU')];
    return ['YOU', st.boss ? 'BOSS' : `STAGE ${app.arcade.stage + 1}/${app.arcade.ladder.length}`];
  }
  return ['YOU', 'CPU', 'CPU', 'CPU'].slice(0, n);
}

// The costumes in the fight being played, by slot: the places the players
// chose for, as picked; CPU rivals in their own colours.
function fightLooks() {
  if (app.mode === 'online') return app.online?.info?.slots.map((sl) => sl.look || 0) ?? null;
  if (app.mode === 'versus' || app.mode === 'quick' || app.mode === 'training') return [app.looks[0], app.looks[1], 0, 0];
  return [app.looks[0], 0, 0, 0];
}

// Training never ends: the clock stays full, energy is always there to spend,
// and anyone who gets low on health is topped up once they are back on their feet.
function keepTraining(s) {
  if (s.phase !== 'fight') return;
  s.timer = MODES.duel.seconds * TICK_RATE;
  s.f[0].meter = RULES.METER_MAX;
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
    const back = ['resume', 'settingsDone', 'arrangeDone', 'leaveRoom', 'offline', 'menu'].map((a) => ui.querySelector(`[data-act=${a}]`)).find(Boolean);
    back?.click();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  padMenus();
  const playing = app.game;
  const g = playing || app.demo;
  if (!g || !stage) return;
  if (padStartPressed()) togglePause();
  g.update(now);
  if (playing && app.mode === 'training') keepTraining(g.state);
  if (playing && app.screen === 'fight') {
    // The music pushes harder when the ring is closing or the round decides the match.
    const st = g.state;
    const deciding = st.mode === 'arena' ? st.round === MODES.arena.maxRounds : st.pts[0] === 1 && st.pts[1] === 1;
    const want = st.phase === 'fight' && app.mode !== 'training' && (st.ringR < ARENA.R - 1 || deciding) ? 'final' : 'fight';
    if (want !== app.music) {
      app.music = want;
      setMusic(want);
    }
  }
  const self = app.mode === 'online' ? app.online?.mySlot ?? -1 : playing && app.mode !== 'versus' ? 0 : -1;
  const events = g.drain();
  if (playing) tallyFight(g, events);
  if (playing && app.mode === 'training') watchDrills(g.state, events);
  // A change of controller renames the controls in the checklist at once.
  if (playing && app.mode === 'training' && !drillEl.hidden && lastDevice() !== app.drillDevice) {
    app.drillDevice = lastDevice();
    drawDrills();
  }
  // A heartbeat when a player's fighter is nearly out: tension, and a warning
  // that reaches the player even when their eyes are off the health bar.
  if (playing && g.state.phase === 'fight' && app.mode !== 'training') {
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
  app.roar = (app.roar || 0) * 0.985;
  const crowdOn = playing && app.mode !== 'training' && g.state.phase !== 'over' && !app.game?.paused;
  setCrowd(crowdOn ? 0.18 + app.roar * 0.82 : 0);
  handleEvents(events, g.state, { quiet: !playing, project: stage.project, me: self, colors: worn });

  const boss = playing && app.mode === 'arcade' ? [false, !!app.arcade.ladder[app.arcade.stage].boss] : null;
  const tags = playing ? labels() : [];
  const mine = app.mode === 'online' ? app.online?.mySlot ?? -1 : playing && app.mode !== 'versus' ? 0 : -1;
  const humans = app.mode === 'online' ? tags.map((_, i) => i === mine) : tags.map((t) => t === 'YOU' || t === 'P1' || t === 'P2');
  const net = app.mode === 'online' && playing ? app.online?.status() : '';
  const hint = !playing || !touchEl.hidden
    ? ''
    : app.mode === 'versus' && lastDevice() === 'pad'
      ? 'Pad 1 and pad 2: stick move · A jump · X punch · B kick · X+B grab · LB block · Y special · RB finisher'
      : app.mode === 'versus'
      ? 'P1: WASD move · Space jump · F G punch kick · H block · T Y special finisher     P2: arrows · U · J K · L · I O'
      : (({ p, k, b, s, u, j, walk }) => `${walk} move · ${j} jump · ${p} punch (x3 combo) · ${k} kick · ${p}+${k} grab · ${b} block (+move = roll) · ${s} special · ${u} finisher`)(controlNames());
  const place = playing ? app.fightPlace : app.place;
  setMusicTheme(place);
  stage.render({ state: g.state, theme: place, looks: playing ? fightLooks() : null, demo: !playing, labels: tags, boss, humans, me: mine, net, hint, hintAlways: app.mode === 'training' }, now);

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
      scoreMatch();
      show('result');
    }
  } else if (s.phase === 'over' && s.pt > 200) {
    startDemo();
    stage.reset();
  }
}

async function boot() {
  ui.innerHTML = '<p class="loading">Entering the arena…</p>';
  layout();
  // Text painted on canvases needs the fonts ready first; never wait long.
  const fonts = document.fonts
    ? Promise.all([document.fonts.load('700 40px Teko'), document.fonts.load('600 14px Barlow')]).catch(() => {})
    : Promise.resolve();
  await Promise.all([loadAssets(), Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))])]);

  stage = createStage($('#gl'), $('#hud'));
  if (DEBUG) window.gdStage = stage;
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
