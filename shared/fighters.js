// The roster. Every alliance member who should be playable gets one entry here
// plus one picture in client/src/fighters/.
//
// How to add a member:
//   1. Save their picture as client/src/fighters/<id>.png (any size). The file
//      name must match the `id` below.
//   2. Copy one of the entries below and change the fields.
//   3. `head` is the circle cut out of the picture and used as the fighter's
//      head: x / y are the centre of the face in picture pixels, r the radius.
//   4. `special.type` picks the special move: 'dash' (lunging strike),
//      'bolt' (projectile) or 'rise' (rising anti-air strike).
//   5. Run `npm run build` and publish the new page.
//
// Stats are multipliers around 1.0 (health is absolute, 100 is standard).
// Keep them close to 1.0 so nobody is unbeatable. The current values were
// tuned by simulating hundreds of CPU-vs-CPU matches until both fighters won
// about half the time; a special move is worth as much as a stat bonus.

export const FIGHTERS = [
  {
    id: 'ruko',
    name: 'RUKO',
    title: 'The Crimson Wolf',
    head: { x: 81, y: 68, r: 30 },
    colors: {
      primary: '#b5122c',
      secondary: '#1b141c',
      accent: '#ff5a36',
      skin: '#e6b594',
      glow: '#ff2b2b',
    },
    stats: { power: 1.0, speed: 1.0, health: 100 },
    special: { type: 'dash', name: 'Crimson Rush' },
    super: { name: 'Red Moon Howl' },
  },
  {
    id: 'shadow',
    name: 'SHADOW',
    title: 'The Silent Storm',
    head: { x: 88, y: 99, r: 43 },
    colors: {
      primary: '#2c9a4b',
      secondary: '#16241d',
      accent: '#f2c14e',
      skin: '#f0c8a4',
      glow: '#8f63ff',
    },
    stats: { power: 1.0, speed: 1.1, health: 105 },
    special: { type: 'bolt', name: 'Storm Bolt' },
    super: { name: 'Total Eclipse' },
  },
];

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

export function getFighter(id) {
  return BY_ID.get(id) || FIGHTERS[0];
}

export function isFighterId(id) {
  return BY_ID.has(id);
}
