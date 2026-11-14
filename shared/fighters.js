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
//      'bolt' (projectile), 'rise' (spinning leap that hits all around) or
//      'quake' (ground stomp that floors everyone nearby who is not jumping).
//      `build` picks the body: 'standard', 'sumo' (huge) or 'slim'.
//      `gear` adds accessories: 'scarf' (trails behind when moving) and
//      'pads' (shoulder guards).
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
    gear: ['scarf'],
    head: { x: 81, y: 68, r: 30 },
    colors: {
      primary: '#b5122c',
      secondary: '#1b141c',
      accent: '#ff5a36',
      skin: '#e6b594',
      glow: '#ff2b2b',
    },
    stats: { power: 1.03, speed: 1.0, health: 102 },
    special: { type: 'dash', name: 'Crimson Rush' },
    super: { name: 'Red Moon Howl' },
  },
  {
    id: 'shadow',
    name: 'SHADOW',
    title: 'The Silent Storm',
    gear: ['pads'],
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
  {
    id: 'jackie',
    name: 'JACKIE',
    title: 'The Violet Mountain',
    build: 'sumo',
    head: { x: 88, y: 42, r: 40 },
    colors: {
      primary: '#3b2b52',
      secondary: '#15101f',
      accent: '#b44dff',
      skin: '#9a93a6',
      glow: '#c44dff',
    },
    stats: { power: 1.08, speed: 0.82, health: 108 },
    special: { type: 'quake', name: 'Mountain Stomp' },
    super: { name: 'Avalanche Charge' },
  },
  {
    id: 'pixie',
    name: 'PIXIE',
    title: 'The Twin Flame',
    build: 'slim',
    head: { x: 84, y: 94, r: 46 },
    colors: {
      primary: '#7a2fc2',
      secondary: '#231338',
      accent: '#ff8a2a',
      skin: '#f2c6a8',
      glow: '#ff7a1a',
      hair: '#ff8a2a',
    },
    stats: { power: 0.95, speed: 1.18, health: 100 },
    special: { type: 'rise', name: 'Twin Flame Spiral' },
    super: { name: 'Phoenix Dive' },
  },
];

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

export function getFighter(id) {
  return BY_ID.get(id) || FIGHTERS[0];
}

export function isFighterId(id) {
  return BY_ID.has(id);
}
