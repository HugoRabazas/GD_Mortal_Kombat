// The app shell: builds the page, runs the frame loop and moves between the
// screens (menu -> fighter select -> fight -> result).

import { FIGHTERS, getFighter } from '../../shared/fighters.js';
import { RULES, TICK_RATE } from '../../shared/constants.js';
import { createAI, aiInput } from '../../shared/ai.js';
import { loadAssets, headUrls } from './assets.js';
import { createStage } from './stage.js';
import { createGame } from './game.js';
import { handleEvents } from './effects.js';
import { initKeyboard, initTouch, readKeys, readTouch, readPad, padStartPressed, setCapture, setTouchLive } from './input.js';
import { createTouchLayout } from './touchLayout.js';
import { unlockAudio, play, isMuted, setMuted, setMusic } from './audio.js';

const root = document.getElementById('app');
root.innerHTML = `
  <div id="stage">
    <canvas id="gl" aria-hidden="true"></canvas>
    <canvas id="hud" role="img" aria-label="GD Arena fight"></canvas>
    <button id="pause-btn" class="chip" type="button" hidden>Pause</button>
  </div>
  <div id="touch" hidden>
    <div id="stick" class="ctl" data-ctl="stick" aria-label="Move"><div id="knob"></div></div>
    <button type="button" class="ctl tb tb-ult" data-ctl="ult" data-bit="256">ULT</button>
    <button type="button" class="ctl tb tb-sp" data-ctl="sp" data-bit="128">SP</button>
    <button type="button" class="ctl tb tb-blk" data-ctl="blk" data-bit="64">BLK</button>
    <button type="button" class="ctl tb tb-k" data-ctl="k" data-bit="32">K</button>
    <button type="button" class="ctl tb tb-p" data-ctl="p" data-bit="16">P</button>
    <p id="turn">Turn your phone sideways for a bigger view.</p>
  </div>
  <div id="ui"></div>
`;

const $ = (sel) => root.querySelector(sel);
const stageEl = $('#stage');
const ui = $('#ui');
const touchEl = $('#touch');
const pauseBtn = $('#pause-btn');
const spBtn = $('.tb-sp');
const ultBtn = $('.tb-ult');

// The arcade ladder: who you meet at each stage and how tough they are.
const STAGES = [
  { level: 'easy', mod: null },
  { level: 'normal', mod: null },
  { level: 'normal', mod: { health: 1.1, power: 1 } },
  { level: 'hard', mod: { health: 1.15, power: 1.05 } },
  { level: 'boss', mod: { health: 1.3, power: 1.1 }, boss: true },
];

const app = {
  screen: 'loading',
  mode: 'arcade', // 'arcade' and 'quick' are single player, 'versus' is two players
  picks: [FIGHTERS[0].id, FIGHTERS[1 % FIGHTERS.length].id],
  level: 'normal',
  arcade: null, // { ladder, stage, score, retries, gained }
  game: null, // the fight being played, if any
  demo: null, // the CPU-vs-CPU fight that plays behind the menus
  resultShown: false,
  arrangeFrom: 'menu',
  // On-screen buttons start switched on for phones and tablets. A touch
  // laptop keeps them off until the screen is actually touched. The menu has
  // a switch for anyone the guess gets wrong.
  touch:
    window.matchMedia?.('(pointer: coarse)').matches ||
    (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(any-pointer: fine)').matches) ||
    false,
};
let stage = null;
let touchLayout = null;

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
  // Rivals first; with a small roster, mirror matches fill the gaps.
  const order = [];
  for (let i = 0; order.length < STAGES.length - 1; i++) {
    order.push(pool[i % pool.length].id);
    if (pool.length < STAGES.length - 1 && order.length < STAGES.length - 1) order.push(playerId);
  }
  order.push(pool[0].id); // the boss is your main rival, powered up
  return STAGES.map((st, i) => ({ ...st, char: order[i] }));
}

function menuScreen() {
  const best = bestScore();
  return `
    <section class="screen menu">
      <h1 class="brand"><span>GD</span> Arena</h1>
      <p class="tag">Alliance members step into the ring. First to two rounds wins.</p>
      <div class="stack">
        <button type="button" class="btn primary" data-act="arcade">Arcade <small>single player · ${STAGES.length} fights</small></button>
        <button type="button" class="btn" data-act="quick">Quick Fight <small>single player vs CPU</small></button>
        <button type="button" class="btn" data-act="versus">2 Players <small>keyboard or gamepads</small></button>
        <button type="button" class="btn quiet" data-act="help">How to play</button>
      </div>
      ${best ? `<p class="best">Arcade best <b>${points(best)}</b></p>` : ''}
      <div class="foot">
        <button type="button" class="link" data-act="mute">${isMuted() ? 'Sound off' : 'Sound on'}</button>
        <button type="button" class="link" data-act="touch">${touchLabel()}</button>
        <button type="button" class="link" data-act="arrange">Arrange buttons</button>
        <button type="button" class="link" data-act="fullscreen">Full screen</button>
      </div>
    </section>`;
}

function slotCard(slot, who) {
  const f = getFighter(app.picks[slot]);
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

function ladderCard() {
  const ladder = buildLadder(app.picks[0]);
  const tag = { easy: 'Easy', normal: 'Normal', hard: 'Hard', boss: 'Boss' };
  return `
    <div class="ladder">
      <span class="who">The ladder</span>
      <ol>
        ${ladder
          .map(
            (st, i) => `<li class="${st.boss ? 'boss' : ''}">
              <span class="num">${i + 1}</span>${head(st.char)}
              <span class="lname">${getFighter(st.char).name}</span>
              <span class="ltag">${tag[st.level]}</span>
            </li>`,
          )
          .join('')}
      </ol>
    </div>`;
}

function selectScreen() {
  const levels = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
  const arcade = app.mode === 'arcade';
  const names = app.mode === 'versus' ? ['Player 1', 'Player 2'] : ['You', 'CPU'];
  return `
    <section class="screen select">
      <h2>${arcade ? 'Choose your fighter' : 'Choose your fighters'}</h2>
      <div class="versus">
        ${slotCard(0, names[0])}
        ${arcade ? ladderCard() : `<span class="vs" aria-hidden="true">VS</span>${slotCard(1, names[1])}`}
      </div>
      ${
        app.mode === 'quick'
          ? `<div class="seg" role="group" aria-label="CPU difficulty">
              ${levels.map(([id, label]) => `<button type="button" class="${app.level === id ? 'on' : ''}" data-act="level" data-id="${id}" aria-pressed="${app.level === id}">${label}</button>`).join('')}
            </div>`
          : app.mode === 'versus' && app.touch
            ? '<p class="note">Two players need a keyboard or gamepads: the on-screen buttons control one fighter only.</p>'
            : ''
      }
      <div class="row">
        <button type="button" class="btn quiet" data-act="menu">Back</button>
        <button type="button" class="btn primary" data-act="fight">${arcade ? 'Start' : 'Fight'}</button>
      </div>
    </section>`;
}

function helpScreen() {
  const row = (what, a, b, c, d) => `<tr><th scope="row">${what}</th><td>${a}</td><td>${b}</td><td>${c}</td><td>${d}</td></tr>`;
  const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join(' ');
  return `
    <section class="screen help">
      <h2>How to play</h2>
      <div class="scroll">
        <table>
          <thead><tr><th></th><th>Single player</th><th>2P · Player 1</th><th>2P · Player 2</th><th>Gamepad</th></tr></thead>
          <tbody>
            ${row('Move', `${k('A', 'D')} or ${k('←', '→')}`, k('A', 'D'), k('←', '→'), 'Stick / D-pad')}
            ${row('Jump', `${k('W')} or ${k('↑')}`, k('W'), k('↑'), 'Up')}
            ${row('Crouch', `${k('S')} or ${k('↓')}`, k('S'), k('↓'), 'Down')}
            ${row('Punch', `${k('J')} or ${k('F')}`, k('F'), k('J'), 'X / Square')}
            ${row('Kick', `${k('K')} or ${k('G')}`, k('G'), k('K'), 'A / Cross')}
            ${row('Block', `${k('L')} or ${k('H')}`, k('H'), k('L'), 'B / Circle')}
            ${row('Special', `${k('I')} or ${k('T')}`, k('T'), k('I'), 'Y / Triangle')}
            ${row('Finisher', `${k('O')} or ${k('Y')}`, k('Y'), k('O'), 'RB / RT')}
          </tbody>
        </table>
      </div>
      <ul class="tips">
        <li>Hits fill your <b>energy</b> bar. A special costs about a third of it; a finisher needs it full.</li>
        <li>Hold <b>Block</b> to take a fraction of the damage. A blocked hit never knocks you out.</li>
        <li><b>Crouch</b> to duck punches and projectiles. Crouch + Kick is a sweep that knocks down.</li>
        <li>Punch or kick in the air for a jumping attack.</li>
        <li>On a phone, use the stick and the buttons on screen. <b>Arrange buttons</b> in the menu lets you drag them where you like.</li>
        <li>Press <kbd>P</kbd>, <kbd>Esc</kbd> or Start to pause.</li>
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
        ${app.touch ? '<button type="button" class="btn" data-act="arrange">Arrange buttons</button>' : ''}
        <button type="button" class="btn quiet" data-act="menu">Quit to menu</button>
      </div>
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

function resultScreen() {
  const s = app.game.state;
  const won = s.matchWinner === 0;
  if (app.mode !== 'arcade') {
    return `
      <section class="screen result">
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
        <p class="sub">Score ${points(a.score)}</p>
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
      <p class="sub next">Next: ${head(next.char)} <b>${getFighter(next.char).name}</b>${next.boss ? ' · the boss' : ''}</p>
      <div class="row">
        <button type="button" class="btn primary" data-act="next">Next fight</button>
        <button type="button" class="btn quiet" data-act="menu">Menu</button>
      </div>
    </section>`;
}

const SCREENS = { menu: menuScreen, select: selectScreen, help: helpScreen, pause: pauseScreen, result: resultScreen, arrange: arrangeScreen };

// Show the on-screen controls during single-player fights and while arranging.
function refreshTouch() {
  const want = app.screen === 'arrange' || (app.screen === 'fight' && app.touch && app.mode !== 'versus');
  if (touchEl.hidden === want) {
    touchEl.hidden = !want;
    layout();
  }
}

function show(screen) {
  app.screen = screen;
  const inFight = screen === 'fight' || screen === 'pause' || screen === 'result' || (screen === 'arrange' && app.game);
  ui.innerHTML = SCREENS[screen] ? SCREENS[screen]() : '';
  ui.dataset.screen = screen;
  pauseBtn.hidden = screen !== 'fight';
  refreshTouch();
  touchLayout.setEditing(screen === 'arrange');
  setTouchLive(screen !== 'arrange');
  setCapture(screen === 'fight');
  if (!inFight) app.game = null;
  setMusic(screen === 'fight' ? 'fight' : 'menu');
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
  const solo = () => readKeys('solo') | readTouch() | readPad(0);
  let chars = app.picks;
  let mods = [null, null];
  let controllers;
  if (app.mode === 'arcade') {
    const st = app.arcade.ladder[app.arcade.stage];
    chars = [app.picks[0], st.char];
    mods = [null, st.mod];
    controllers = [solo, cpu(st.level)];
  } else if (app.mode === 'quick') {
    controllers = [solo, cpu(app.level)];
  } else {
    controllers = [() => readKeys('p1') | readPad(0), () => readKeys('p2') | readPad(1)];
  }
  app.game = createGame(chars, controllers, mods);
  app.resultShown = false;
  stage.reset();
  show('fight');
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
  const flawless = s.wins[1] === 0 ? 500 : 0; // did not drop a round
  a.gained = 1000 * (a.stage + 1) + Math.round((me.hp / me.maxHp) * 1000) + Math.ceil(s.timer / TICK_RATE) * 10 + flawless;
  a.score += a.gained;
  if (a.stage >= a.ladder.length - 1) saveBest(a.score);
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
  arcade() {
    app.mode = 'arcade';
    show('select');
  },
  quick() {
    app.mode = 'quick';
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

ui.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  unlockAudio();
  play('ui');
  ACTIONS[el.dataset.act]?.(el);
});
pauseBtn.addEventListener('click', togglePause);

// ------------------------------------------------------------ frame loop ---

function labels() {
  if (app.mode === 'versus') return ['PLAYER 1', 'PLAYER 2'];
  if (app.mode === 'arcade' && app.arcade) {
    const st = app.arcade.ladder[app.arcade.stage];
    return ['YOU', st.boss ? 'BOSS' : `STAGE ${app.arcade.stage + 1}/${app.arcade.ladder.length}`];
  }
  return ['YOU', 'CPU'];
}

function frame(now) {
  requestAnimationFrame(frame);
  const playing = app.game;
  const g = playing || app.demo;
  if (!g || !stage) return;
  if (padStartPressed()) togglePause();
  g.update(now);
  handleEvents(g.drain(), g.state, !playing);

  const boss = playing && app.mode === 'arcade' ? [false, !!app.arcade.ladder[app.arcade.stage].boss] : null;
  stage.render({ state: g.state, demo: !playing, labels: playing ? labels() : ['', ''], boss }, now);

  const s = g.state;
  if (playing && !touchEl.hidden) {
    // Thumbs can cover the energy bar, so the buttons themselves light up
    // when the special and the finisher can be used.
    spBtn.classList.toggle('ready', s.f[0].meter >= RULES.SPECIAL_COST);
    ultBtn.classList.toggle('ready', s.f[0].meter >= RULES.SUPER_COST);
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
    }
  });

  startDemo();
  show('menu');
  layout();
  requestAnimationFrame(frame);
}

boot();
