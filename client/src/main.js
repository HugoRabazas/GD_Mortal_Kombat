// The app shell: builds the page, runs the frame loop and moves between the
// screens (menu -> fighter select -> fight -> result).

import { FIGHTERS, getFighter } from '../../shared/fighters.js';
import { createAI, aiInput } from '../../shared/ai.js';
import { loadAssets, headUrls } from './assets.js';
import { createStage } from './stage.js';
import { createGame } from './game.js';
import { handleEvents } from './effects.js';
import { initKeyboard, initTouch, readKeys, readTouch, setCapture } from './input.js';
import { unlockAudio, play, isMuted, setMuted } from './audio.js';

const root = document.getElementById('app');
root.innerHTML = `
  <div id="stage">
    <canvas id="gl" aria-hidden="true"></canvas>
    <canvas id="hud" role="img" aria-label="GD Arena fight"></canvas>
    <button id="pause-btn" class="chip" type="button" hidden>Pause</button>
  </div>
  <div id="touch" hidden>
    <div id="stick" aria-label="Move"><div id="knob"></div></div>
    <div id="pad">
      <button type="button" class="tb tb-ult" data-bit="256">ULT</button>
      <button type="button" class="tb tb-sp" data-bit="128">SP</button>
      <button type="button" class="tb tb-blk" data-bit="64">BLK</button>
      <button type="button" class="tb tb-k" data-bit="32">K</button>
      <button type="button" class="tb tb-p" data-bit="16">P</button>
    </div>
  </div>
  <div id="ui"></div>
`;

const $ = (sel) => root.querySelector(sel);
const stageEl = $('#stage');
const ui = $('#ui');
const touchEl = $('#touch');
const pauseBtn = $('#pause-btn');

const app = {
  screen: 'loading',
  mode: 'solo', // 'solo' = against the CPU, 'versus' = two people, one keyboard
  picks: [FIGHTERS[0].id, FIGHTERS[1 % FIGHTERS.length].id],
  level: 'normal',
  game: null, // the fight being played, if any
  demo: null, // the CPU-vs-CPU fight that plays behind the menus
  resultShown: false,
  touch: window.matchMedia?.('(pointer: coarse)').matches || false,
};
let stage = null;

// ---------------------------------------------------------------- layout ---

function layout() {
  const style = getComputedStyle(root);
  const availW = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  let availH = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  const portrait = root.clientHeight > root.clientWidth;
  root.classList.toggle('portrait', portrait);
  // In portrait the touch controls sit under the stage and need their own room.
  if (portrait && !touchEl.hidden) availH -= touchEl.offsetHeight;
  const w = Math.max(160, Math.floor(Math.min(availW, (availH * 16) / 9)));
  const h = Math.floor((w * 9) / 16);
  stageEl.style.width = `${w}px`;
  stageEl.style.height = `${h}px`;
  stage?.resize(w, h);
}

// --------------------------------------------------------------- screens ---

const head = (id, cls = '') => `<img class="head ${cls}" src="${headUrls.get(id)}" alt="" />`;

function menuScreen() {
  return `
    <section class="screen menu">
      <h1 class="brand"><span>GD</span> Arena</h1>
      <p class="tag">Alliance members step into the ring. First to two rounds wins.</p>
      <div class="stack">
        <button type="button" class="btn primary" data-act="solo">1 Player <small>against the CPU</small></button>
        <button type="button" class="btn" data-act="versus">2 Players <small>on one keyboard</small></button>
        <button type="button" class="btn quiet" data-act="help">How to play</button>
      </div>
      <ul class="roster">
        ${FIGHTERS.map((f) => `<li>${head(f.id)}<span>${f.name}</span></li>`).join('')}
      </ul>
      <div class="foot">
        <button type="button" class="link" data-act="mute">${isMuted() ? 'Sound off' : 'Sound on'}</button>
        <button type="button" class="link" data-act="fullscreen">Full screen</button>
      </div>
    </section>`;
}

function slotCard(slot) {
  const f = getFighter(app.picks[slot]);
  const who = slot === 0 ? (app.mode === 'solo' ? 'You' : 'Player 1') : app.mode === 'solo' ? 'CPU' : 'Player 2';
  return `
    <div class="slot" style="--tint:${f.colors.primary};--ring:${f.colors.accent}">
      <span class="who">${who}</span>
      ${head(f.id, 'big')}
      <strong class="name">${f.name}</strong>
      <span class="title">${f.title}</span>
      <dl class="moves">
        <div><dt>Special</dt><dd>${f.special.name}</dd></div>
        <div><dt>Finisher</dt><dd>${f.super.name}</dd></div>
      </dl>
      <div class="picker" role="group" aria-label="${who} fighter">
        ${FIGHTERS.map(
          (o) => `<button type="button" class="pick ${o.id === f.id ? 'on' : ''}" data-act="pick" data-slot="${slot}" data-id="${o.id}" aria-pressed="${o.id === f.id}" title="${o.name}">${head(o.id)}</button>`,
        ).join('')}
      </div>
    </div>`;
}

function selectScreen() {
  const levels = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
  return `
    <section class="screen select">
      <h2>Choose your fighters</h2>
      <div class="versus">
        ${slotCard(0)}
        <span class="vs" aria-hidden="true">VS</span>
        ${slotCard(1)}
      </div>
      ${
        app.mode === 'solo'
          ? `<div class="seg" role="group" aria-label="CPU difficulty">
              ${levels.map(([id, label]) => `<button type="button" class="${app.level === id ? 'on' : ''}" data-act="level" data-id="${id}" aria-pressed="${app.level === id}">${label}</button>`).join('')}
            </div>`
          : ''
      }
      <div class="row">
        <button type="button" class="btn quiet" data-act="menu">Back</button>
        <button type="button" class="btn primary" data-act="fight">Fight</button>
      </div>
    </section>`;
}

function helpScreen() {
  const row = (what, a, b, c) => `<tr><th scope="row">${what}</th><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
  const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');
  return `
    <section class="screen help">
      <h2>How to play</h2>
      <div class="scroll">
        <table>
          <thead><tr><th></th><th>1 Player</th><th>2P · Player 1</th><th>2P · Player 2</th></tr></thead>
          <tbody>
            ${row('Move', `${k('A', 'D')} or ${k('←', '→')}`, k('A', 'D'), k('←', '→'))}
            ${row('Jump', `${k('W')} or ${k('↑')}`, k('W'), k('↑'))}
            ${row('Crouch', `${k('S')} or ${k('↓')}`, k('S'), k('↓'))}
            ${row('Punch', `${k('J')} or ${k('F')}`, k('F'), k('J'))}
            ${row('Kick', `${k('K')} or ${k('G')}`, k('G'), k('K'))}
            ${row('Block', `${k('L')} or ${k('H')}`, k('H'), k('L'))}
            ${row('Special', `${k('I')} or ${k('T')}`, k('T'), k('I'))}
            ${row('Finisher', `${k('O')} or ${k('Y')}`, k('Y'), k('O'))}
          </tbody>
        </table>
      </div>
      <ul class="tips">
        <li>Hits fill your <b>energy</b> bar. A special costs about a third of it; a finisher needs it full.</li>
        <li>Hold <b>Block</b> to take a fraction of the damage. A blocked hit never knocks you out.</li>
        <li><b>Crouch</b> to duck punches and projectiles. Crouch + Kick is a sweep that knocks down.</li>
        <li>Punch or kick in the air for a jumping attack.</li>
        <li>On a phone, use the stick and the buttons on screen. Turn the phone sideways for a bigger view.</li>
        <li>Press <kbd>P</kbd> or <kbd>Esc</kbd> to pause.</li>
      </ul>
      <div class="row"><button type="button" class="btn primary" data-act="menu">Back</button></div>
    </section>`;
}

function pauseScreen() {
  return `
    <section class="screen pause">
      <h2>Paused</h2>
      <div class="stack">
        <button type="button" class="btn primary" data-act="resume">Resume</button>
        <button type="button" class="btn" data-act="rematch">Restart fight</button>
        <button type="button" class="btn quiet" data-act="menu">Quit to menu</button>
      </div>
    </section>`;
}

function resultScreen() {
  return `
    <section class="screen result">
      <div class="row">
        <button type="button" class="btn primary" data-act="rematch">Rematch</button>
        <button type="button" class="btn" data-act="select">Change fighters</button>
        <button type="button" class="btn quiet" data-act="menu">Menu</button>
      </div>
    </section>`;
}

const SCREENS = { menu: menuScreen, select: selectScreen, help: helpScreen, pause: pauseScreen, result: resultScreen };

function show(screen) {
  app.screen = screen;
  const inFight = screen === 'fight' || screen === 'pause' || screen === 'result';
  ui.innerHTML = SCREENS[screen] ? SCREENS[screen]() : '';
  ui.dataset.screen = screen;
  pauseBtn.hidden = screen !== 'fight';
  const wantTouch = screen === 'fight' && app.touch && app.mode === 'solo';
  if (touchEl.hidden === wantTouch) {
    touchEl.hidden = !wantTouch;
    layout();
  }
  setCapture(screen === 'fight');
  if (!inFight) app.game = null;
  ui.querySelector('.primary')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- fights ---

function cpu(level) {
  const ai = createAI(level, (Math.random() * 1e9) | 0);
  return (state, slot) => aiInput(ai, state, slot);
}

function startDemo() {
  const a = FIGHTERS[(Math.random() * FIGHTERS.length) | 0].id;
  const others = FIGHTERS.filter((f) => f.id !== a);
  const b = (others[(Math.random() * others.length) | 0] || FIGHTERS[0]).id;
  app.demo = createGame([a, b], [cpu('hard'), cpu('hard')]);
}

function startFight() {
  const controllers =
    app.mode === 'solo'
      ? [() => readKeys('solo') | readTouch(), cpu(app.level)]
      : [() => readKeys('p1'), () => readKeys('p2')];
  app.game = createGame(app.picks, controllers);
  app.resultShown = false;
  stage.reset();
  show('fight');
}

function togglePause() {
  if (!app.game) return;
  if (app.screen === 'fight') {
    app.game.paused = true;
    show('pause');
  } else if (app.screen === 'pause') {
    app.game.paused = false;
    show('fight');
  }
}

// --------------------------------------------------------------- actions ---

const ACTIONS = {
  solo() {
    app.mode = 'solo';
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
  level(el) {
    app.level = el.dataset.id;
    show('select');
  },
  fight: startFight,
  rematch: startFight,
  resume: togglePause,
  mute(el) {
    setMuted(!isMuted());
    el.textContent = isMuted() ? 'Sound off' : 'Sound on';
  },
  fullscreen() {
    // Not every viewer allows this (phones, some apps); it is fine if it fails.
    const el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  },
};

ui.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  unlockAudio();
  play('ui');
  ACTIONS[el.dataset.act]?.(el);
});
pauseBtn.addEventListener('click', togglePause);

// ------------------------------------------------------------ frame loop ---

function frame(now) {
  requestAnimationFrame(frame);
  const playing = app.game;
  const g = playing || app.demo;
  if (!g || !stage) return;
  g.update(now);
  handleEvents(g.drain(), g.state, !playing);

  const labels = app.mode === 'solo' ? ['YOU', 'CPU'] : ['PLAYER 1', 'PLAYER 2'];
  stage.render({ state: g.state, demo: !playing, labels }, now);

  const s = g.state;
  if (playing) {
    if (s.phase === 'over' && !app.resultShown && s.pt > 150) {
      app.resultShown = true;
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
  initKeyboard(togglePause);
  initTouch(touchEl);
  window.addEventListener('resize', layout);
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') app.touch = true;
    unlockAudio();
  });
  window.addEventListener('keydown', unlockAudio);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && app.screen === 'fight') togglePause();
  });

  startDemo();
  show('menu');
  layout();
  requestAnimationFrame(frame);
}

boot();
