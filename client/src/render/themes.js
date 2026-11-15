// What each arena looks like: paint, light and weather. Pure data, so the
// tests can check that every arena in arenas.js has all of it (see
// tests/arenas.test.js); scene3d.js turns it into a scene.

// The arenas. Every arena is the same place built from the same shapes; what
// changes is the paint, the light and the weather.
//
// `moods` says how the light and weather look at each time of the fight:
//   sky: tint of the far backdrop; hemi: [sky colour, ground colour, strength];
//   key / moon: [colour, strength]; fog: [colour, density]; torch: strength of
//   the torches; rain: how hard it rains (or snows), 0 to 1.
export const THEMES = {
  // A walled courtyard at dusk, then night, then a thunderstorm.
  courtyard: {
    sky: ['#07050f', '#2a0f2e', '#7a1c2c', '#d1542b', '#e9823a'],
    stars: '255,236,224',
    moon: { halo: ['255,176,124', '255,120,80'], disc: ['#fff4de', '#f2a56b'], marks: '190,100,70' },
    aurora: false,
    ridges: [['#3d1532', null], ['#260d22', null]],
    ground: [48, 30, 44],
    dais: [84, 52, 70],
    daisSide: 0x4a2c40,
    snow: false,
    wall: 0x4c3352,
    trim: 0x634568,
    banner: ['#8c1226', 'rgba(255,214,130,0.85)', 'rgba(255,226,165,0.95)'],
    flame: ['255,250,220', '255,190,80', '255,90,30', '255,60,20'],
    torch: 0xffa050,
    ember: 0xffa040,
    cloaks: [0x5a1626, 0x2a1a3a, 0x3a2a1a, 0x1f2f3f, 0x6a4a1a, 0x3a1a2a],
    weather: 'rain',
    lightning: true,
    moods: [
      { sky: [1, 1, 1], hemi: [0xb890c8, 0x3a2030, 0.42], key: [0xffe2cf, 1.5], moon: [0xffb58a, 0.6], fog: [0x2a1030, 0.018], torch: 1.5, rain: 0 }, // dusk
      { sky: [0.34, 0.42, 0.78], hemi: [0x7f9ad8, 0x141828, 0.5], key: [0xcfe0ff, 1.2], moon: [0x9fc0ff, 0.95], fog: [0x0e1630, 0.02], torch: 2.4, rain: 0 }, // night
      { sky: [0.3, 0.3, 0.38], hemi: [0x8a8fa8, 0x15121c, 0.42], key: [0xe6ecff, 1.0], moon: [0x8892b8, 0.35], fog: [0x181824, 0.028], torch: 3.0, rain: 1 }, // storm
    ],
  },
  // A shrine on a frozen peak: northern lights, then deep night, then a blizzard.
  frost: {
    sky: ['#02040d', '#081a3a', '#14406a', '#3f86a6', '#b9e2ea'],
    stars: '226,240,255',
    moon: { halo: ['170,220,255', '110,170,255'], disc: ['#ffffff', '#b8d8f4'], marks: '110,150,200' },
    aurora: true,
    ridges: [['#31476e', '#dcecff'], ['#18243e', '#9db8dc']],
    ground: [56, 64, 80],
    dais: [100, 110, 128],
    daisSide: 0x34425e,
    snow: true,
    wall: 0x3a4660,
    trim: 0x566a8e,
    banner: ['#12397c', 'rgba(205,232,255,0.85)', 'rgba(228,243,255,0.95)'],
    flame: ['240,255,255', '120,225,255', '40,130,255', '20,70,255'],
    torch: 0x66c8ff,
    ember: 0x9fdcff,
    cloaks: [0x1c3a5c, 0x2a2a4a, 0x4a5a6a, 0x16303a, 0x5a3a5a, 0x2c4a44],
    weather: 'snow',
    lightning: false,
    moods: [
      { sky: [1, 1, 1], hemi: [0xa8b8cc, 0x1c2838, 0.44], key: [0xfff4ea, 1.4], moon: [0x7fe8cc, 0.75], fog: [0x0c1c30, 0.018], torch: 1.6, rain: 0.12 }, // northern lights
      { sky: [0.5, 0.58, 0.9], hemi: [0x7c8cb8, 0x10182c, 0.44], key: [0xd4dcf4, 1.15], moon: [0x8fb8ff, 0.95], fog: [0x0a1228, 0.021], torch: 2.4, rain: 0.35 }, // deep night
      { sky: [0.62, 0.68, 0.78], hemi: [0xb8c6dc, 0x1a2232, 0.5], key: [0xf0f4ff, 1.0], moon: [0xa0b0c8, 0.35], fog: [0x2c3848, 0.034], torch: 3.0, rain: 1 }, // blizzard
    ],
  },
  // Sandstone ruins in the desert: bright day, a golden sunset, then a
  // sandstorm that hides the sun and drives grit sideways across the floor.
  dunes: {
    sky: ['#2f5f9e', '#5b8fca', '#a9cbe4', '#f3d6a0', '#f2b26a'],
    stars: null, // daytime: no stars, and a sun instead of a moon
    sun: true,
    moon: { halo: ['255,236,190', '255,200,120'], disc: ['#fffbea', '#ffd98a'], marks: null },
    aurora: false,
    ridges: [['#c08a55', null], ['#94643c', null]],
    ground: [146, 128, 104],
    dais: [176, 158, 128],
    daisSide: 0x8a7050,
    snow: false,
    wall: 0xa77d52,
    trim: 0xc89c68,
    banner: ['#1f6e6e', 'rgba(255,214,130,0.85)', 'rgba(255,232,170,0.95)'],
    flame: ['255,250,220', '255,190,80', '255,90,30', '255,60,20'],
    torch: 0xffa050,
    ember: 0xffb060,
    cloaks: [0xc2703a, 0x6b4a2a, 0x2e5e6b, 0x8a2a2a, 0xd9b26f, 0x4a3a2a],
    weather: 'sand',
    lightning: false,
    moods: [
      { sky: [1, 1, 1], hemi: [0xd8e8ff, 0x7a6e60, 0.66], key: [0xfff8ee, 1.5], moon: [0xffe2b8, 0.45], fog: [0xd9c8aa, 0.008], torch: 0.7, rain: 0 }, // midday
      { sky: [1, 0.76, 0.58], hemi: [0xffc89a, 0x5a3a2a, 0.5], key: [0xffb070, 1.5], moon: [0xff8a50, 0.85], fog: [0xc98a5a, 0.012], torch: 1.6, rain: 0.12 }, // sunset
      { sky: [0.72, 0.56, 0.4], hemi: [0xd9b080, 0x4a3220, 0.58], key: [0xffd8a8, 1.0], moon: [0xc9a070, 0.3], fog: [0xc09a68, 0.07], torch: 2.4, rain: 1 }, // sandstorm
    ],
  },
};

