// Lets the player put the on-screen controls wherever is comfortable.
//
// Every control has a position stored as a fraction of the touch area (0 = left
// or top edge, 1 = right or bottom edge), so a layout keeps its shape on any
// screen size. Portrait and landscape are stored separately because the touch
// area is a different shape in each. The layout is saved in the browser, so it
// is remembered on that device.

const STORE = 'gd-arena-touch-v2';
const IDS = ['stick', 'p', 'k', 'jmp', 'blk', 'sp', 'ult'];

const DEFAULTS = {
  size: 1,
  land: { stick: [0.11, 0.74], jmp: [0.93, 0.86], k: [0.845, 0.86], p: [0.76, 0.86], blk: [0.93, 0.64], sp: [0.845, 0.64], ult: [0.76, 0.64] },
  port: { stick: [0.2, 0.36], jmp: [0.89, 0.45], k: [0.715, 0.45], p: [0.54, 0.45], blk: [0.89, 0.2], sp: [0.715, 0.2], ult: [0.54, 0.2] },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function load() {
  const layout = clone(DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') {
      if (Number.isFinite(saved.size)) layout.size = Math.min(1.5, Math.max(0.7, saved.size));
      for (const mode of ['land', 'port']) {
        for (const id of IDS) {
          const pos = saved[mode]?.[id];
          if (Array.isArray(pos) && pos.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) layout[mode][id] = [pos[0], pos[1]];
        }
      }
    }
  } catch {
    // nothing saved, or storage is unavailable: use the defaults
  }
  return layout;
}

export function createTouchLayout(touchEl, isPortrait) {
  const layout = load();
  const els = Object.fromEntries(IDS.map((id) => [id, touchEl.querySelector(`[data-ctl="${id}"]`)]));
  let editing = false;

  const mode = () => (isPortrait() ? 'port' : 'land');

  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(layout));
    } catch {
      // not saved; the layout still applies until the page is closed
    }
  };

  const apply = () => {
    touchEl.style.setProperty('--ts', String(layout.size));
    const set = layout[mode()];
    for (const id of IDS) {
      els[id].style.left = `${set[id][0] * 100}%`;
      els[id].style.top = `${set[id][1] * 100}%`;
    }
  };

  // Dragging, only while arranging.
  for (const id of IDS) {
    const el = els[id];
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (!editing) return;
      const pos = layout[mode()][id];
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos[0], py: pos[1] };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // dragging still works while the finger stays on the control
      }
      el.classList.add('dragging');
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const area = touchEl.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      // Keep the whole control inside the touch area.
      const mx = Math.min(0.5, box.width / 2 / area.width);
      const my = Math.min(0.5, box.height / 2 / area.height);
      const x = Math.min(1 - mx, Math.max(mx, drag.px + (e.clientX - drag.x) / area.width));
      const y = Math.min(1 - my, Math.max(my, drag.py + (e.clientY - drag.y) / area.height));
      layout[mode()][id] = [x, y];
      el.style.left = `${x * 100}%`;
      el.style.top = `${y * 100}%`;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      el.classList.remove('dragging');
      save();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  apply();

  return {
    apply,
    setEditing(on) {
      editing = on;
      touchEl.classList.toggle('arranging', on);
    },
    resize(delta) {
      layout.size = Math.min(1.5, Math.max(0.7, Math.round((layout.size + delta) * 100) / 100));
      apply();
      save();
    },
    // Put the current orientation's controls (and the size) back to the defaults.
    reset() {
      layout.size = DEFAULTS.size;
      layout[mode()] = clone(DEFAULTS[mode()]);
      apply();
      save();
    },
  };
}
