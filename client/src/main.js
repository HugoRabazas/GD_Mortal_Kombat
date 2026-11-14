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
import { createOnline } from './net/online.js';

// Online play exists only in the web build, which is told where the bus lives
// (see scripts/build.js). Adding ?net=local to the address swaps the internet
// for a same-browser bus, which is what the automated tests use.
const NET = typeof __NET__ === 'undefined' || !__NET__ ? null : new URLSearchParams(location.search).get('net') === 'local' ? { local: true } : __NET__;
const BUILD = typeof __BUILD__ === 'undefined' ? 'dev' : __BUILD__;
// An invite link ends in #room-ABCD: opening it takes you straight to that room.
const invited = () => (/^#room-([A-Za-z0-9]{2,8})$/.exec(location.hash) || [])[1] || null;
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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
  mode: 'arcade', // 'arcade', 'arena' and 'quick' are single player, 'versus' is two players
  vsArena: false, // in 2-player mode: a duel, or a brawl with two CPU fighters added
  picks: [FIGHTERS[0].id, FIGHTERS[1 % FIGHTERS.length].id],
  level: 'normal',
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
  // Every rival once, then a mirror match if there is a stage left to fill.
  const order = pool.map((f) => f.id).slice(0, STAGES.length - 1);
  while (order.length < STAGES.length - 1) order.push(order.length % 2 ? playerId : pool[order.length % pool.length].id);
  order.push(pool[0].id); // the boss is your first rival again, powered up
  return STAGES.map((st, i) => ({ ...st, char: order[i] }));
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
  return `
    <div class="slot" style="--tint:${f.colors.primary};--ring:${f.colors.accent}">
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
      <p class="rules">Everyone fights at once. Three rounds; each round scores by how long you last. Level on points is a shared place.</p>
    </div>`;
}

function selectScreen() {
  const levels = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
  const { mode } = app;
  const names = mode === 'versus' ? ['Player 1', 'Player 2'] : ['You', 'CPU'];
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
      ${mode === 'quick' || mode === 'arena' ? seg(levels, app.level, 'level') : ''}
      ${mode === 'versus' ? seg([['duel', 'Duel'], ['brawl', 'Brawl with 2 CPU']], app.vsArena ? 'brawl' : 'duel', 'vsKind') : ''}
      ${mode === 'versus' && app.touch ? '<p class="note">Two players need a keyboard or gamepads: the on-screen buttons control one fighter only.</p>' : ''}
      <div class="row">
        <button type="button" class="btn quiet" data-act="menu">Back</button>
        <button type="button" class="btn primary" data-act="fight">${mode === 'arcade' ? 'Start' : 'Fight'}</button>
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
            ${row('Walk', `${k('W', 'A', 'S', 'D')} or arrows`, k('W', 'A', 'S', 'D'), 'Arrows', 'Stick / D-pad')}
            ${row('Jump', `${k('Space')} or ${k('U')}`, k('Space'), k('U'), 'A / Cross')}
            ${row('Punch', `${k('J')} or ${k('F')}`, k('F'), k('J'), 'X / Square')}
            ${row('Kick', `${k('K')} or ${k('G')}`, k('G'), k('K'), 'B / Circle')}
            ${row('Block', `${k('L')} or ${k('H')}`, k('H'), k('L'), 'LB / LT')}
            ${row('Special', `${k('I')} or ${k('T')}`, k('T'), k('I'), 'Y / Triangle')}
            ${row('Finisher', `${k('O')} or ${k('Y')}`, k('Y'), k('O'), 'RB / RT')}
          </tbody>
        </table>
      </div>
      <ul class="tips">
        <li><b>Walk anywhere</b> on the arena: left, right, into the depth and back. Attacks turn you towards the nearest rival, so you do not need perfect aim.</li>
        <li><b>Punch three times</b> for a combo that ends in a knockdown; each punch must land to continue.</li>
        <li><b>Block + a direction</b> is a dodge roll: attacks pass through you for a moment.</li>
        <li>Hits fill your <b>energy</b> bar. A special costs about a third of it; a finisher needs it full.</li>
        <li><b>Block</b> only stops what comes from the front. Get behind a blocking rival, or step out of the way of a projectile.</li>
        <li><b>Jump</b> over a ground stomp; punch or kick in the air for a diving attack.</li>
        <li><b>Crystals</b> appear on the floor: gold gives energy, green gives health. Walk over one to take it.</li>
        <li>As the clock runs down, a <b>ring of fire</b> closes in. Knock a rival into it for extra damage.</li>
        <li><b>Arena</b>: four fighters at once, three rounds. Each round gives 3, 2, 1 or 0 points by how long you last; level on points means a shared place.</li>
        <li>On a phone, use the stick and the buttons on screen. <b>Arrange buttons</b> lets you drag them where you like.</li>
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
        ${app.mode === 'online' ? '' : '<button type="button" class="btn" data-act="rematch">Restart fight</button>'}
        ${app.touch ? '<button type="button" class="btn" data-act="arrange">Arrange buttons</button>' : ''}
        ${app.mode === 'online' ? '<button type="button" class="btn quiet" data-act="onBack">Back to the room</button>' : '<button type="button" class="btn quiet" data-act="menu">Quit to menu</button>'}
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
  const again =
    app.mode === 'online'
      ? '<button type="button" class="btn primary" data-act="onBack">Back to the room</button>'
      : `<button type="button" class="btn primary" data-act="rematch">Rematch</button>
          <button type="button" class="btn" data-act="select">Change fighter</button>
          <button type="button" class="btn quiet" data-act="menu">Menu</button>`;
  if (app.mode === 'online' && s.mode !== 'arena') return `<section class="screen result"><div class="row">${again}</div></section>`;
  if (s.mode === 'arena') {
    const who = labels();
    const medal = ['1st', '2nd', '3rd', '4th'];
    return `
      <section class="screen result">
        <ol class="ranking">
          ${s.ranking
            .map(
              (r) => `<li class="${r.rank === 1 ? 'top' : ''}">
                <span class="place">${medal[r.rank - 1]}</span>${head(r.char)}
                <span class="lname">${getFighter(r.char).name}</span>
                <span class="ltag">${esc(who[r.slot])}</span>
                <span class="pts">${r.points} pts</span>
              </li>`,
            )
            .join('')}
        </ol>
        <div class="row">${again}</div>
      </section>`;
  }
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

// ---------------------------------------------------------- online screens ---

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
    <section class="screen select">
      <h2>Alliance lobby</h2>
      <div class="versus">
        <div class="ladder">
          <span class="who">Online now · ${on.lobbyPeers.length}</span>
          <ol class="people">
            ${on.lobbyPeers.map((p) => `<li><span class="lname">${esc(p.name)}${p.id === on.me.id ? ' (you)' : ''}</span><span class="ltag">${p.playing ? 'fighting' : p.room ? 'in a room' : 'in the lobby'}</span></li>`).join('')}
          </ol>
        </div>
        <div class="ladder">
          <span class="who">Rooms</span>
          <ol class="people">
            ${
              rooms.length
                ? rooms.map((r) => `<li><span class="lname">${esc(r.names.slice(0, 3).join(', '))}${r.names.length > 3 ? '…' : ''}</span><button type="button" class="btn small" data-act="joinRoom" data-id="${esc(r.code)}">${r.playing ? 'Watch' : 'Join'} · ${r.names.length}</button></li>`).join('')
                : '<li><span class="lname dim">No rooms open yet</span></li>'
            }
          </ol>
          <button type="button" class="btn primary" data-act="createRoom">Create a room</button>
        </div>
      </div>
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
          <p class="rules">${link === 'direct' ? 'Connected directly.' : link === 'relayed' ? 'Connecting… (relayed for now)' : 'Waiting for others. Share the room name, or start with CPU rivals.'}</p>
        </div>
        <div class="slot" style="--tint:${getFighter(room.char).colors.primary};--ring:${getFighter(room.char).colors.accent}">
          <span class="who">Your fighter</span>
          ${head(room.char, 'big')}
          <strong class="name">${getFighter(room.char).name}</strong>
          <span class="title">${getFighter(room.char).title}</span>
          ${statBars(getFighter(room.char))}
          <div class="picker" role="group" aria-label="Your fighter">
            ${FIGHTERS.map((o) => `<button type="button" class="pick ${o.id === room.char ? 'on' : ''}" data-act="onChar" data-id="${o.id}" aria-pressed="${o.id === room.char}" title="${o.name}">${head(o.id)}</button>`).join('')}
          </div>
        </div>
      </div>
      ${room.isHost ? `<div class="seg" role="group"><button type="button" class="${app.fill ? 'on' : ''}" data-act="fill" data-id="1">Fill with CPU</button><button type="button" class="${app.fill ? '' : 'on'}" data-act="fill" data-id="0">Players only</button></div>` : ''}
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

const SCREENS = { menu: menuScreen, select: selectScreen, help: helpScreen, pause: pauseScreen, result: resultScreen, arrange: arrangeScreen, nick: nameScreen, lobby: lobbyScreen, room: roomScreen };

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
  if (screen !== 'nick') ui.querySelector('.primary:not([disabled])')?.focus({ preventScroll: true });
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
  const solo = () => readKeys('solo') | readTouch() | readPad(0);
  const two = [() => readKeys('p1') | readPad(0), () => readKeys('p2') | readPad(1)];
  let chars = app.picks;
  let mods = [];
  let controllers;
  if (app.mode === 'arcade') {
    const st = app.arcade.ladder[app.arcade.stage];
    chars = [app.picks[0], st.char];
    mods = [null, st.mod];
    controllers = [solo, cpu(st.level)];
  } else if (app.mode === 'arena') {
    chars = [app.picks[0], ...rivalsFor([app.picks[0]])];
    controllers = [solo, cpu(app.level), cpu(app.level), cpu(app.level)];
  } else if (app.mode === 'quick') {
    controllers = [solo, cpu(app.level)];
  } else if (app.vsArena) {
    chars = [...app.picks, ...rivalsFor(app.picks)];
    controllers = [...two, cpu('normal'), cpu('normal')];
  } else {
    controllers = two;
  }
  app.game = createGame(chars, controllers, mods);
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
  const flawless = s.pts[1] === 0 ? 500 : 0; // did not drop a round
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
  fill(el) {
    app.fill = el.dataset.id === '1';
    show('room');
  },
  onStart: () => app.online.start({ fill: app.fill }),
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
    readInput: () => readKeys('solo') | readTouch() | readPad(0),
    // Redraw the lobby or the room whenever someone joins, leaves or changes.
    onChange() {
      if (app.online !== online) return;
      if (app.screen === 'lobby' || (app.screen === 'room' && online.room)) show(app.screen);
    },
    onStart() {
      app.mode = 'online';
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

ui.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.dataset.form === 'nick') {
    unlockAudio();
    goOnline(ui.querySelector('#nick').value);
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
  if (app.mode === 'arcade' && app.arcade) {
    const st = app.arcade.ladder[app.arcade.stage];
    return ['YOU', st.boss ? 'BOSS' : `STAGE ${app.arcade.stage + 1}/${app.arcade.ladder.length}`];
  }
  return ['YOU', 'CPU', 'CPU', 'CPU'].slice(0, n);
}

function frame(now) {
  requestAnimationFrame(frame);
  const playing = app.game;
  const g = playing || app.demo;
  if (!g || !stage) return;
  if (padStartPressed()) togglePause();
  g.update(now);
  const self = app.mode === 'online' ? app.online?.mySlot ?? -1 : playing && app.mode !== 'versus' ? 0 : -1;
  handleEvents(g.drain(), g.state, { quiet: !playing, project: stage.project, me: self });

  const boss = playing && app.mode === 'arcade' ? [false, !!app.arcade.ladder[app.arcade.stage].boss] : null;
  const tags = playing ? labels() : [];
  const mine = app.mode === 'online' ? app.online?.mySlot ?? -1 : playing && app.mode !== 'versus' ? 0 : -1;
  const humans = app.mode === 'online' ? tags.map((_, i) => i === mine) : tags.map((t) => t === 'YOU' || t === 'P1' || t === 'P2');
  const net = app.mode === 'online' && playing ? app.online?.status() : '';
  const hint = !playing || !touchEl.hidden
    ? ''
    : app.mode === 'versus'
      ? 'P1: WASD move · Space jump · F G punch kick · H block · T Y special finisher     P2: arrows · U · J K · L · I O'
      : 'WASD move · Space jump · J punch (x3 combo) · K kick · L block (+move = roll) · I special · O finisher';
  stage.render({ state: g.state, demo: !playing, labels: tags, boss, humans, me: mine, net, hint }, now);

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
  if (NET && invited()) ACTIONS.online();
}

boot();
