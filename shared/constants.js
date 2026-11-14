// Values shared by the simulation (server + practice mode) and the renderer.

export const TICK_RATE = 60; // simulation steps per second
export const SNAPSHOT_EVERY = 2; // server sends one snapshot every N ticks (30 per second)

// Logical arena size. The canvas is scaled to fit the screen, but the game
// always thinks in these units.
export const ARENA = {
  W: 960,
  H: 540,
  FLOOR: 452,
  MIN_X: 46,
  MAX_X: 914,
};

// One bit per button, so a whole controller state fits in a single small number.
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
};
export const INPUT_MASK = 511;

export const RULES = {
  ROUND_SECONDS: 60,
  ROUNDS_TO_WIN: 2,
  MAX_ROUNDS: 5,
  SPECIAL_COST: 35,
  SUPER_COST: 100,
  METER_MAX: 100,
};

// Phase lengths, in ticks.
export const TIMING = {
  INTRO: 120, // "ROUND 1" ... "FIGHT!"
  INTRO_FIGHT_CALL: 72,
  KO: 200,
  TIMEUP: 170,
  SUPER_FREEZE: 42,
};
