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
//      `special.style` (optional) draws the special in the fighter's own way:
//      'charge' (behind a raised forearm), 'bow' (an arrow drawn and loosed),
//      'blade' (a rising slash) or 'clap' (hands flung wide and clapped).
//      `build` picks the body: 'standard', 'sumo' (huge) or 'slim'.
//      `gear` adds accessories: 'scarf' (trails behind when moving) and
//      'pads' (shoulder guards). `victory` picks how they celebrate a won
//      match: 'howl' (a fist raised to the sky), 'calm' (arms folded),
//      'stomp' (high stamping steps), 'cheer' (hopping and waving),
//      'salute' (a fist on the chest, then raised), 'volley' (arrows loosed
//      at the sky), 'sheathe' (a turn, then the blade put away) or 'laugh'.
//      `entrance` picks the ritual while a round is announced: 'prowl',
//      'bow', 'clap', 'swirl', 'oath' (up from one knee, a fist on the
//      chest), 'draw' (an arrow shot at the sky), 'flourish' (two cuts of
//      the blade hand) or 'twirl' (two turns and a deep bow).
//      `looks` are the costumes a player can pick: the first is the fighter's
//      own colours, the second changes some of them (any of primary,
//      secondary, accent, glow, hair). `quote` is the line shown on the
//      result screen when they win.
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
    victory: 'howl',
    entrance: 'prowl', // the ritual while a round is announced
    quote: 'The moon saw that one coming. You did not.',
    head: { x: 81, y: 68, r: 30 },
    colors: {
      primary: '#b5122c',
      secondary: '#1b141c',
      accent: '#ff5a36',
      skin: '#e6b594',
      glow: '#ff2b2b',
    },
    looks: [{ name: 'Crimson' }, { name: 'Midnight', colors: { primary: '#28385f', secondary: '#0d111c', accent: '#b9c8ff', glow: '#6f8cff' } }],
    stats: { power: 0.97, speed: 1.0, health: 110 },
    special: { type: 'dash', name: 'Crimson Rush' },
    super: { name: 'Red Moon Howl', move: 'howl' },
    signature: { name: 'Wolf Leap', move: 'clawLeap' },
  },
  {
    id: 'shadow',
    name: 'SHADOW',
    title: 'The Silent Storm',
    gear: ['pads'],
    victory: 'calm',
    entrance: 'bow', // the ritual while a round is announced
    quote: 'Quiet. Quick. Finished.',
    head: { x: 88, y: 99, r: 43 },
    colors: {
      primary: '#2c9a4b',
      secondary: '#16241d',
      accent: '#f2c14e',
      skin: '#f0c8a4',
      glow: '#8f63ff',
    },
    looks: [{ name: 'Storm' }, { name: 'Thunder', colors: { primary: '#5b3fa6', secondary: '#1a1230', accent: '#f2c14e', glow: '#c9a3ff' } }],
    stats: { power: 1.0, speed: 1.1, health: 101 },
    special: { type: 'bolt', name: 'Storm Bolt' },
    super: { name: 'Total Eclipse', move: 'eclipse' },
    signature: { name: 'Shade Step', move: 'shadeStep' },
  },
  {
    id: 'jackie',
    name: 'JACKIE',
    title: 'The Violet Mountain',
    build: 'sumo',
    victory: 'stomp',
    entrance: 'clap', // the ritual while a round is announced
    quote: 'The mountain does not move. You did.',
    head: { x: 88, y: 98, r: 36 }, // the face inside the frame (not the figure on the frame)
    colors: {
      primary: '#3b2b52',
      secondary: '#15101f',
      accent: '#b44dff',
      skin: '#9a93a6',
      glow: '#c44dff',
    },
    looks: [{ name: 'Violet' }, { name: 'Granite', colors: { primary: '#4d525c', secondary: '#1c1d22', accent: '#e0a83c', glow: '#ffcc55' } }],
    stats: { power: 1.08, speed: 0.82, health: 112 },
    special: { type: 'quake', name: 'Mountain Stomp' },
    super: { name: 'Avalanche Charge', move: 'avalanche' },
    signature: { name: 'Belly Bump', move: 'bellyBump' },
  },
  {
    id: 'pixie',
    name: 'PIXIE',
    title: 'The Twin Flame',
    build: 'slim',
    victory: 'cheer',
    entrance: 'swirl', // the ritual while a round is announced
    quote: 'Two flames, one winner!',
    head: { x: 84, y: 94, r: 46 },
    colors: {
      primary: '#7a2fc2',
      secondary: '#231338',
      accent: '#ff8a2a',
      skin: '#f2c6a8',
      glow: '#ff7a1a',
      hair: '#ff8a2a',
    },
    looks: [{ name: 'Flame' }, { name: 'Frost', colors: { primary: '#2a7fb8', secondary: '#0f2236', accent: '#9be7ff', glow: '#7fe0ff', hair: '#bdf0ff' } }],
    stats: { power: 0.93, speed: 1.18, health: 104 },
    special: { type: 'rise', name: 'Twin Flame Spiral' },
    super: { name: 'Phoenix Dive', move: 'phoenix' },
    signature: { name: 'Cartwheel Kick', move: 'cartwheel' },
  },
  {
    id: 'meru',
    name: 'MERU',
    title: 'The Iron Oath',
    gear: ['pads'],
    victory: 'salute',
    entrance: 'oath',
    quote: 'I gave my word. You gave up.',
    head: { x: 170, y: 195, r: 74 }, // the face inside the avatar's frame
    colors: {
      primary: '#3d5a52',
      secondary: '#141c1a',
      accent: '#d8b46a',
      skin: '#e2b896',
      glow: '#5fe0b0',
      hair: '#1a1414',
    },
    looks: [{ name: 'Iron' }, { name: 'Rust', colors: { primary: '#7a3b22', secondary: '#1f120c', accent: '#f0c070', glow: '#ff9a4a' } }],
    stats: { power: 0.97, speed: 1.0, health: 112 },
    special: { type: 'dash', name: 'Iron Charge', style: 'charge' },
    super: { name: 'Last Oath', move: 'oath' },
    signature: { name: 'Shield Ram', move: 'shieldRam' },
  },
  {
    id: 'gleh',
    name: 'GLEH',
    title: 'The Moon Archer',
    build: 'slim',
    victory: 'volley',
    entrance: 'draw',
    quote: 'The moon never misses. Neither do I.',
    head: { x: 193, y: 128, r: 55 }, // the face inside the avatar's frame
    colors: {
      primary: '#6a4fa8',
      secondary: '#1b1430',
      accent: '#e8c46a',
      skin: '#f0c8b0',
      glow: '#c9a8ff',
      hair: '#141018',
    },
    looks: [{ name: 'Moon' }, { name: 'Dawn', colors: { primary: '#c25a7a', secondary: '#2a1220', accent: '#ffd38a', glow: '#ffb0c8' } }],
    stats: { power: 1.05, speed: 1.12, health: 105 },
    special: { type: 'bolt', name: 'Moon Arrow', style: 'bow' },
    super: { name: 'Crescent Rain', move: 'crescent' },
    signature: { name: 'Moon Vault', move: 'moonVault' },
  },
  {
    id: 'kichta',
    name: 'KICHTA',
    title: 'The Rising Blade',
    gear: ['scarf'],
    victory: 'sheathe',
    entrance: 'flourish',
    quote: 'One step ahead. Always.',
    head: { x: 138, y: 116, r: 56 }, // the face inside the avatar's frame
    colors: {
      primary: '#8a6a2a',
      secondary: '#1e1a12',
      accent: '#ffd34d',
      skin: '#e6b594',
      glow: '#ffcf4a',
      hair: '#141414',
    },
    looks: [{ name: 'Gold' }, { name: 'Ash', colors: { primary: '#4a4a52', secondary: '#141418', accent: '#e05a4a', glow: '#ff6a5a' } }],
    stats: { power: 0.95, speed: 1.08, health: 97 },
    special: { type: 'rise', name: 'Rising Edge', style: 'blade' },
    super: { name: 'Thousand Cuts', move: 'cuts' },
    signature: { name: 'Blade Dash', move: 'bladeDash' },
  },
  {
    id: 'zelrith',
    name: 'ZELRITH',
    title: 'The Grinning Storm',
    build: 'slim',
    victory: 'laugh',
    entrance: 'twirl',
    quote: 'Ha! Again, again!',
    head: { x: 133, y: 95, r: 58 }, // the face inside the avatar's frame
    colors: {
      primary: '#2f6fb0',
      secondary: '#101a2a',
      accent: '#ffe066',
      skin: '#f5d0b0',
      glow: '#ffe066',
      hair: '#ffd84a',
    },
    looks: [{ name: 'Sky' }, { name: 'Ember', colors: { primary: '#b0402f', secondary: '#2a100c', accent: '#ffe066', glow: '#ff8a3a' } }],
    stats: { power: 1.09, speed: 1.1, health: 105 },
    special: { type: 'quake', name: 'Storm Clap', style: 'clap' },
    super: { name: 'Sunburst', move: 'sunburst' },
    signature: { name: 'Spin Top', move: 'spinTop' },
  },
];

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

export function getFighter(id) {
  return BY_ID.get(id) || FIGHTERS[0];
}

export function isFighterId(id) {
  return BY_ID.has(id);
}

// How many costumes a fighter has (at least one: their own colours).
export const lookCount = (id) => getFighter(id).looks?.length || 1;

// What a copy of a fighter with no costume left wears (a third copy in a
// line-up): plain blues over their own colours.
export const ALT_COLORS = { primary: '#2456c9', secondary: '#101a33', accent: '#7fd4ff', glow: '#59b7ff' };

// The colours of one costume; -1 is the plain alternate.
export function lookColors(id, look = 0) {
  const f = getFighter(id);
  if (look < 0) return { ...f.colors, ...ALT_COLORS };
  return { ...f.colors, ...(f.looks?.[look]?.colors || null) };
}

// Who wears what in a line-up. `looks[i]` is the costume picked for slot i.
// Two copies of a fighter never dress alike: the second takes the other
// costume, and a copy with no costume left gets -1 (plain alternate colours,
// see ALT in client/src/render/fighter.js).
export function dressLineUp(chars, looks) {
  const taken = new Set();
  looks = looks || []; // no choices (the fight behind the menus): everyone's own colours
  return chars.map((id, i) => {
    const n = lookCount(id);
    const wanted = Number.isInteger(looks[i]) && looks[i] >= 0 && looks[i] < n ? looks[i] : 0;
    for (let k = 0; k < n; k++) {
      const look = (wanted + k) % n;
      if (!taken.has(`${id}:${look}`)) {
        taken.add(`${id}:${look}`);
        return look;
      }
    }
    return -1;
  });
}

// The colours every fighter in a line-up really wears, by slot. Everything
// that paints a fighter's colour - body, scoreboard, sparks, trails - reads
// it from here, so a costume is worn everywhere at once.
export function dressColors(chars, looks) {
  const dressed = dressLineUp(chars, looks);
  return chars.map((id, i) => lookColors(id, dressed[i]));
}
