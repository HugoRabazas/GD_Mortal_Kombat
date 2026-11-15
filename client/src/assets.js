// Loads each fighter's picture and cuts the round head out of it once, so the
// renderer can stamp it every frame without re-cropping.

import { FIGHTERS } from '../../shared/fighters.js';

// Every picture in ./fighters is embedded into the page at build time, keyed
// by its file name (ruko.png -> 'ruko'). They are just the head squares, cut
// from the full pictures in art/fighters by scripts/crop-heads.py (using
// `head` in the roster), so the page carries nothing it does not show.
const pictures = import.meta.glob('./fighters/*.png', { eager: true, query: '?inline', import: 'default' });
const pictureOf = (id) => pictures[`./fighters/${id}.png`];

const HEAD_PX = 192;
export const heads = new Map(); // fighter id -> canvas with the circular head
export const headUrls = new Map(); // fighter id -> data URL, for use in menus

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function placeholder(f) {
  const c = document.createElement('canvas');
  c.width = c.height = HEAD_PX;
  const g = c.getContext('2d');
  g.fillStyle = f.colors.primary;
  g.beginPath();
  g.arc(HEAD_PX / 2, HEAD_PX / 2, HEAD_PX / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${HEAD_PX * 0.5}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(f.name[0], HEAD_PX / 2, HEAD_PX / 2 + 6);
  return c;
}

export async function loadAssets() {
  await Promise.all(
    FIGHTERS.map(async (f) => {
      let canvas;
      try {
        const img = await loadImage(pictureOf(f.id));
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = HEAD_PX;
        const g = canvas.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.beginPath();
        g.arc(HEAD_PX / 2, HEAD_PX / 2, HEAD_PX / 2, 0, Math.PI * 2);
        g.clip();
        g.drawImage(img, 0, 0, img.width, img.height, 0, 0, HEAD_PX, HEAD_PX);
      } catch {
        canvas = placeholder(f);
      }
      heads.set(f.id, canvas);
      headUrls.set(f.id, canvas.toDataURL('image/png'));
    }),
  );
}
