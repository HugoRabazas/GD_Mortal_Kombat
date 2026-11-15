// The places a fight can be held in. They differ only in how they look: the
// rules, the size of the floor and the ring of fire are the same everywhere.
// The paint itself lives with the 3D scene (render/scene3d.js, THEMES).

export const ARENAS = [
  { id: 'courtyard', name: 'Ember Courtyard' },
  { id: 'frost', name: 'Frost Summit' },
  { id: 'dunes', name: 'Dune Ruins' },
];

export const isArenaId = (id) => ARENAS.some((a) => a.id === id);
