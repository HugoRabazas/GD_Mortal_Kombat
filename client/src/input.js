// Reads the players' buttons. Keys are identified by their position on the
// keyboard (event.code), so the layout works the same on Spanish, English or
// any other keyboard.

import { INPUT } from '../../shared/constants.js';

const KEYMAPS = {
  // One player: either hand position works.
  solo: {
    LEFT: ['KeyA', 'ArrowLeft'], RIGHT: ['KeyD', 'ArrowRight'], UP: ['KeyW', 'ArrowUp'], DOWN: ['KeyS', 'ArrowDown'],
    PUNCH: ['KeyJ', 'KeyF'], KICK: ['KeyK', 'KeyG'], BLOCK: ['KeyL', 'KeyH'], SPECIAL: ['KeyI', 'KeyT'], SUPER: ['KeyO', 'KeyY'],
  },
  // Two players sharing a keyboard.
  p1: {
    LEFT: ['KeyA'], RIGHT: ['KeyD'], UP: ['KeyW'], DOWN: ['KeyS'],
    PUNCH: ['KeyF'], KICK: ['KeyG'], BLOCK: ['KeyH'], SPECIAL: ['KeyT'], SUPER: ['KeyY'],
  },
  p2: {
    LEFT: ['ArrowLeft'], RIGHT: ['ArrowRight'], UP: ['ArrowUp'], DOWN: ['ArrowDown'],
    PUNCH: ['KeyJ'], KICK: ['KeyK'], BLOCK: ['KeyL'], SPECIAL: ['KeyI'], SUPER: ['KeyO'],
  },
};
const GAME_KEYS = new Set(Object.values(KEYMAPS.solo).flat());

const held = new Set();
let touchBits = 0;
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

export function setCapture(on) {
  capture = on;
  if (!on) {
    held.clear();
    touchBits = 0;
  }
}

export function initKeyboard(onPauseKey) {
  window.addEventListener('keydown', (e) => {
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

// On-screen controls: a thumb stick on the left, five buttons on the right.
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
    if (dy < -0.45) bits |= INPUT.UP;
    if (dy > 0.45) bits |= INPUT.DOWN;
    touchBits = (touchBits & ~MOVE) | bits;
  };
  const releaseStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob.style.transform = '';
    touchBits &= ~MOVE;
  };
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
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
      touchBits |= bit;
      btn.classList.add('on');
      btn.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
  }
  root.addEventListener('contextmenu', (e) => e.preventDefault());
}
