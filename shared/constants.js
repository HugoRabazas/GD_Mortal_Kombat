// Values shared by the simulation and the renderer.

export const TICK_RATE = 60; // simulation steps per second

// The fighting ground is a circle seen from above. Positions are in "arena
// pixels" (100 px = 1 unit in the 3D world): x runs left-right, z runs from
// the back of the arena (negative) towards the camera (positive), and h is
// height above the floor. W and H are only the size of the flat HUD layer.
export const ARENA = {
  W: 960,
  H: 540,
  R: 600, // radius fighters can roam at the start of a round
  R_MIN: 300, // radius once the ring of fire has fully closed in
};

// One bit per button, so a whole controller state fits in a single number.
// UP means "away from the camera", DOWN means "towards the camera".
export const INPUT = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  PUNCH: 16,
  KICK: 32,
  BLOCK: 64,
  SPECIAL: 128,
  SUPER: 256,
  JUMP: 512,
  GRAB: 1024, // its own button, so a throw never needs two buttons at once
};
export const INPUT_MASK = 2047;

export const RULES = {
  SPECIAL_COST: 35,
  SUPER_COST: 100,
  METER_MAX: 100,
};

// The two kinds of match.
//   duel:  two fighters, a round win is 1 point, first to 2 points.
//   arena: everyone at once, exactly 3 rounds, points by finishing position.
export const MODES = {
  duel: { seconds: 60, pointsToWin: 2, maxRounds: 5, shrinkAt: 20 },
  arena: { seconds: 75, pointsToWin: Infinity, maxRounds: 3, shrinkAt: 40 },
};

// Phase lengths, in ticks.
export const TIMING = {
  INTRO: 120, // "ROUND 1" ... "FIGHT!"
  INTRO_FIGHT_CALL: 72,
  KO: 200,
  TIMEUP: 170,
  SUPER_FREEZE: 42,
};
