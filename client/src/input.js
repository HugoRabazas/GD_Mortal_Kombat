// Reads the players' buttons. Keys are identified by their position on the
// keyboard (event.code), so the layout works the same on Spanish, English or
// any other keyboard.

import { INPUT } from '../../shared/constants.js';

const KEYMAPS = {
  // One player: either hand position works.
  solo: {
    LEFT: ['KeyA', 'ArrowLeft'], RIGHT: ['KeyD', 'ArrowRight'], UP: ['KeyW', 'ArrowUp'], DOWN: ['KeyS', 'ArrowDown'],
    JUMP: ['Space', 'KeyU'],
    PUNCH: ['KeyJ', 'KeyF'], KICK: ['KeyK', 'KeyG'], BLOCK: ['KeyL', 'KeyH'], SPECIAL: ['KeyI', 'KeyT'], SUPER: ['KeyO', 'KeyY'],
  },
  // Two players sharing a keyboard.
  p1: {
    LEFT: ['KeyA'], RIGHT: ['KeyD'], UP: ['KeyW'], DOWN: ['KeyS'], JUMP: ['Space'],
    PUNCH: ['KeyF'], KICK: ['KeyG'], BLOCK: ['KeyH'], SPECIAL: ['KeyT'], SUPER: ['KeyY'],
  },
  p2: {
    LEFT: ['ArrowLeft'], RIGHT: ['ArrowRight'], UP: ['ArrowUp'], DOWN: ['ArrowDown'], JUMP: ['KeyU'],
    PUNCH: ['KeyJ'], KICK: ['KeyK'], BLOCK: ['KeyL'], SPECIAL: ['KeyI'], SUPER: ['KeyO'],
  },
};
const GAME_KEYS = new Set(Object.values(KEYMAPS.solo).flat());

const held = new Set();
let touchBits = 0;
let touchLive = true; // false while the player is rearranging the controls
let capture = false; // true while a fight is on screen

export function readKeys(scheme) {
  const map = KEYMAPS[scheme];
  let bits = 0;
  for (const name in map) {
    for (const code of map[name]) {
      if (held.has(code)) {
        bits |= INPUT[name];
        break;
      }
    }
  }
  return bits;
}

export function readTouch() {
  return touchBits;
}

export function setTouchLive(on) {
  touchLive = on;
  touchBits = 0;
}

// Which kind of control the player touched last: 'keys', 'touch' or 'pad'
// (null until they touch anything). The screens name the controls to match.
let device = null;
export const lastDevice = () => device;

// Game controllers. Standard layout: stick or d-pad to move, A/Cross jump,
// X/Square punch, B/Circle kick, LB or LT block, Y/Triangle special, RB or RT
// finisher.
function pad(index) {
  try {
    const pads = [...(navigator.getGamepads?.() || [])].filter((p) => p && p.connected);
    return pads[index] || null;
  } catch {
    return null; // some viewers do not allow controllers
  }
}

// Which family the first controller belongs to, from the name the browser
// reports: 'ps' (PlayStation), 'nintendo' or 'xbox' (also the default). The
// buttons sit in the same places on all of them; only their labels differ.
export function padStyle() {
  const id = pad(0)?.id || '';
  if (/054c|playstation|dualshock|dualsense|sony/i.test(id)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
  return 'xbox';
}

export function readPad(index) {
  const p = pad(index);
  if (!p) return 0;
  const on = (i) => !!p.buttons[i]?.pressed;
  const ax = p.axes[0] || 0;
  const ay = p.axes[1] || 0;
  let bits = 0;
  if (ax < -0.45 || on(14)) bits |= INPUT.LEFT;
  if (ax > 0.45 || on(15)) bits |= INPUT.RIGHT;
  if (ay < -0.45 || on(12)) bits |= INPUT.UP;
  if (ay > 0.45 || on(13)) bits |= INPUT.DOWN;
  if (on(0)) bits |= INPUT.JUMP;
  if (on(2)) bits |= INPUT.PUNCH;
  if (on(1)) bits |= INPUT.KICK;
  if (on(4) || on(6)) bits |= INPUT.BLOCK;
  if (on(3)) bits |= INPUT.SPECIAL;
  if (on(5) || on(7)) bits |= INPUT.SUPER;
  if (bits) device = 'pad';
  return bits;
}

// For moving round the menus with a controller: what was newly pressed since
// the last call. dir is -1 (up / left), 1 (down / right) or 0.
const menuWas = { dir: 0, ok: false, back: false };
export function padMenu() {
  let dir = 0;
  let ok = false;
  let back = false;
  for (let i = 0; i < 4; i++) {
    const p = pad(i);
    if (!p) continue;
    const on = (b) => !!p.buttons[b]?.pressed;
    const ax = p.axes[0] || 0;
    const ay = p.axes[1] || 0;
    if (on(12) || on(14) || ay < -0.6 || ax < -0.6) dir = -1;
    if (on(13) || on(15) || ay > 0.6 || ax > 0.6) dir = 1;
    ok = ok || on(0);
    back = back || on(1);
  }
  if (dir || ok || back) device = 'pad';
  const out = { dir: dir !== menuWas.dir ? dir : 0, ok: ok && !menuWas.ok, back: back && !menuWas.back };
  Object.assign(menuWas, { dir, ok, back });
  return out;
}

// True once each time Start is pressed on any controller.
let startWasDown = false;
export function padStartPressed() {
  let down = false;
  for (let i = 0; i < 4; i++) down = down || !!pad(i)?.buttons[9]?.pressed;
  const pressed = down && !startWasDown;
  startWasDown = down;
  return pressed;
}

export function setCapture(on) {
  capture = on;
  if (!on) {
    held.clear();
    touchBits = 0;
  }
}

export function initKeyboard(onPauseKey) {
  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code) || e.code === 'Escape' || e.code === 'KeyP') device = 'keys';
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!e.repeat) onPauseKey();
      return;
    }
    if (!capture) return;
    if (GAME_KEYS.has(e.code)) {
      held.add(e.code);
      e.preventDefault(); // stop the arrow keys from scrolling the page
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

// Keep receiving a finger's events even if it slides off the control. Some
// browsers refuse this; the control still works without it.
function grab(el, pointerId) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // not supported here
  }
}

// On-screen controls: a thumb stick to walk in any direction, and six buttons.
export function initTouch(root) {
  const stick = root.querySelector('#stick');
  const knob = root.querySelector('#knob');
  const MOVE = INPUT.LEFT | INPUT.RIGHT | INPUT.UP | INPUT.DOWN;
  let stickId = null;

  const moveStick = (e) => {
    const r = stick.getBoundingClientRect();
    const half = r.width / 2;
    let dx = (e.clientX - (r.left + half)) / half;
    let dy = (e.clientY - (r.top + half)) / half;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.transform = `translate(${dx * half * 0.55}px, ${dy * half * 0.55}px)`;
    let bits = 0;
    if (dx < -0.35) bits |= INPUT.LEFT;
    if (dx > 0.35) bits |= INPUT.RIGHT;
    if (dy < -0.35) bits |= INPUT.UP;
    if (dy > 0.35) bits |= INPUT.DOWN;
    touchBits = (touchBits & ~MOVE) | bits;
  };
  const releaseStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob.style.transform = '';
    stick.style.translate = '';
    stick.classList.remove('floating');
    touchBits &= ~MOVE;
  };

  // A floating stick: a thumb that lands anywhere free on the stick's half of
  // the screen brings the stick to it, so a fight never stalls because the
  // thumb missed the circle by a finger. Let go and it goes home.
  const zone = root.querySelector('#stickzone');
  zone?.addEventListener('pointerdown', (e) => {
    if (!touchLive || stickId !== null) return;
    stick.style.translate = '';
    const home = stick.getBoundingClientRect();
    const area = root.getBoundingClientRect();
    const mid = area.left + area.width / 2;
    const cx = home.left + home.width / 2;
    if (e.clientX < mid !== cx < mid) return; // the other half is not the stick's
    stick.style.translate = `${e.clientX - cx}px ${e.clientY - (home.top + home.height / 2)}px`;
    stick.classList.add('floating');
    stickId = e.pointerId;
    grab(zone, e.pointerId);
    moveStick(e);
    e.preventDefault();
  });
  zone?.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) moveStick(e);
  });
  zone?.addEventListener('pointerup', releaseStick);
  zone?.addEventListener('pointercancel', releaseStick);
  root.addEventListener('pointerdown', () => {
    device = 'touch';
  });
  stick.addEventListener('pointerdown', (e) => {
    if (!touchLive) return;
    stickId = e.pointerId;
    grab(stick, e.pointerId);
    moveStick(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) moveStick(e);
  });
  stick.addEventListener('pointerup', releaseStick);
  stick.addEventListener('pointercancel', releaseStick);

  for (const btn of root.querySelectorAll('[data-bit]')) {
    const bit = Number(btn.dataset.bit);
    const off = () => {
      touchBits &= ~bit;
      btn.classList.remove('on');
    };
    btn.addEventListener('pointerdown', (e) => {
      if (!touchLive) return;
      touchBits |= bit;
      btn.classList.add('on');
      // A faint tick under the thumb, so a press is felt (where phones allow).
      try {
        navigator.vibrate?.(7);
      } catch {
        // not available here
      }
      grab(btn, e.pointerId);
      e.preventDefault();
    });
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());
}
