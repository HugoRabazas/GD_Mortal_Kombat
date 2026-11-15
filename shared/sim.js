// The fight simulation.
//
// This file is the single source of truth for the rules of the game. It knows
// nothing about screens or sound: it takes the current match state plus the
// buttons every fighter is holding, and advances the match by one tick (1/60
// of a second). The same code drives one-on-one duels and the four-fighter
// arena brawl.
//
// The fighting ground is a circle seen from above. Each fighter has a position
// on the floor (x, z), a height above it (h) and a direction it faces (dir,
// an angle). Fighters walk in any direction; an attack hits whoever stands
// inside a wedge in front of the attacker.
//
// The simulation is deterministic: the same inputs always give the same match.

import { ARENA, INPUT, MODES, RULES, TIMING, TICK_RATE } from './constants.js';
import { getFighter } from './fighters.js';

const BODY_R = 24; // radius of a fighter's body on the floor
const BODY_H = 158;
const GRAVITY = 0.75;
const JUMP_V = 14;
const WALK = 3.5;
const AIR_SPEED = 3.7;
// A second jump in the air: a fresh press of jump, once per jump, after the
// first few ticks of rising (`from`), a little lower than the first.
const AIR_JUMP = { from: 4, v: 11.5, buffer: 6 };
// The stomp (grab - or punch and kick together - in the air): a short hang,
// then a plunge feet first.
const STOMP = { fall: -17, rest: 14 };
// The air special each fighter's own special turns into in the air.
export const AIR_SPECIAL = { dash: 'airDash', bolt: 'airBolt', quake: 'bodyPress', rise: 'airSpiral' };
const AIR_MOVES = { airDash: 1, airBolt: 1, bodyPress: 1, airSpiral: 1 };
// The bolt thrown from the air strikes lighter than the one from the ground.
const AIR_BOLT_HIT = { dmg: 10, hitstun: 16, blockstun: 10, push: 6, gain: 6, heavy: true, chip: 0.2 };
// One arrow of Gleh's Crescent Rain (five of them make the finisher).
const RAIN_HIT = { dmg: 5, hitstun: 20, blockstun: 10, push: 3, gain: 0, heavy: true, chip: 0.3, noScale: true, final: true };
// A launched rival can be hit this many more times in the air.
const JUGGLE = 2;
// Kick held down: after `hold` ticks the kick coils into a charge, which is
// let go as the guard-breaking kick when the button is released (no sooner
// than `min` ticks of charging, and on its own at `max`).
const CHARGE = { hold: 8, min: 8, max: 40, reel: 30 };
// The ordinary blows that can be cancelled into a special once they land.
const CANCEL_DMG = 0.6;
const CANCELS = new Set(['punch', 'punch2', 'punch3', 'kick', 'kick2', 'hook', 'lunge', 'slide', 'launch']);
// Grab with no rival within `near`: the signature move instead of a throw.
const SIG = { near: 100 };
// A throw can be broken: grab pressed by the one seized within `window`
// ticks of the thrower's throw. Both are pushed apart and stagger for `stun`
// ticks, the thrower `edge` longer (the escaper moves first).
const ESCAPE = { window: 9, stun: 12, edge: 6 };
// A taunt (block held, grab pressed, standing still): each fighter's own
// gesture for `ticks`; energy is gained at tick `at`, and until it ends any
// blow lands as a counter hit (it is still winding up).
const TAUNT = { ticks: 40, at: 30, gain: 14 };
// A finisher's last blow: a longer hold, then this long for the camera.
const FINALE = { stop: 22, ticks: 48 };
const FRICTION = 0.84;
const BUFFER_TICKS = 8; // how long a button press is remembered
// A throw: seize (the rival is lifted in front), swing (carried up and over
// the thrower's head) and slam (driven into the floor behind). Ticks:
export const THROW = { lift: 7, slam: 19, end: 28, height: 120, reach: 46 };
// Punch and kick pressed together still make a grab when one comes a beat
// after the other (fingers are never exactly together). Kept short: a wider
// window turned deliberate punch-then-kick into grabs that missed, and it
// cost the fastest CPU a sixth of its wins. The GRAB button needs no timing.
const GRAB_WINDOW = 3;
// Walking this long counts as running: punch and kick become the lunge and
// the slide.
const RUN_TICKS = 8;
const DOWN_TICKS = 34; // time spent lying on the floor after a knockdown
const GETUP_TICKS = 18;
// Quick rise: block held while lying on the floor gets a fighter up after
// TECH_TICKS instead of DOWN_TICKS - once per knockdown, and not in the
// last few ticks, when there would be nothing to gain.
const TECH_TICKS = 8;
export const BLOCK_ARC = 1.25; // a block stops attacks coming from within this angle of where you face
const ROLL = { ticks: 15, safe: 11, speed: 8.5, rest: 7 }; // the dodge roll
// Block with the stick pointing straight away from the nearest rival: a hop
// back instead of a roll - shorter, safe for fewer ticks, but over sooner,
// and still facing the rival, ready to answer.
const BACKSTEP = { ticks: 10, safe: 7, speed: 11.5, rest: 3, away: -0.85 };
// Punch or kick late in a roll comes out of it as an attack (from tick
// `from`, when the roll has done most of its travelling); a fighter getting
// up can strike from tick `rise` of the getup.
const OUT_OF = { from: 7, rise: 4 };
const SPLAT = { speed: 3.2, dmg: 5 }; // being knocked into the ring of fire
// ...and thrown back off it: a fighter knocked down into the fire bounces up
// off it (`vh`), open to one more blow in the air before landing; one still
// on their feet is held in the stun a little longer (`stun`).
const BOUNCE = { vh: 7.5, stun: 10 };
// A counter hit: a blow that lands while the rival is still winding up an
// attack of their own (in its startup) does `dmg` times the damage and holds
// the impact a few ticks longer. It rewards reading the rival's move.
const COUNTER = { dmg: 1.25, stop: 3 };
// A perfect guard: the block button pressed in the last `window` ticks before
// a blow lands. It costs no health, and a heavy blow from a rival standing on
// the ground leaves that rival reeling for `stagger` ticks. The guard has to
// be down for `rest` ticks first, so hammering the button does not work.
const GUARD = { window: 5, rest: 20, stagger: 26, gain: 12 };
// Crystals that appear on the floor: walk over one to take it.
const ITEMS = { first: 7, every: [9, 14], life: 12, max: 2, reach: 44, energy: 40, heal: 15 };

// Every attack is a row of numbers:
//   startup / active / recovery - ticks before it can hit, while it hits, after
//   reach - how far in front it lands (centre to centre, plus body size)
//   arc   - half-width of the wedge it covers, in radians (PI = all around)
//   y0,y1 - the band of height it covers, measured from the attacker's feet
//   aim   - within this distance the attacker turns to the nearest rival first
export const MOVES = {
  // Punch, punch, punch is a three-hit string: each blow that connects can be
  // followed by the next (`next`), and the third one knocks down.
  punch: {
    startup: 4, active: 3, recovery: 8, dmg: 6, reach: 84, arc: 0.85, y0: 70, y1: 150, aim: 190,
    hitstun: 15, blockstun: 9, push: 4, gain: 9, next: 'punch2', nextK: 'hook',
  },
  // Punch, kick: a hook kick swung round from the side that spins the rival
  // round (`turn`), leaving their back to you for a moment.
  hook: {
    startup: 6, active: 4, recovery: 15, dmg: 7, reach: 96, arc: 1.2, y0: 60, y1: 170, aim: 190,
    hitstun: 22, blockstun: 12, push: 3, gain: 10, heavy: true, turn: true,
  },
  punch2: {
    startup: 4, active: 3, recovery: 10, dmg: 6, reach: 88, arc: 0.85, y0: 70, y1: 150, aim: 190,
    hitstun: 16, blockstun: 10, push: 4, gain: 9, next: 'punch3', nextK: 'launch',
  },
  // Punch, punch, kick: the string ends in a rising kick that throws the
  // rival up into the air (`launch` is their upward speed) instead of down.
  // A launched rival can be struck JUGGLE more times before they land, and a
  // launcher that connects can be cancelled straight into a jump to chase.
  launch: {
    startup: 6, active: 4, recovery: 14, dmg: 7, reach: 86, arc: 0.9, y0: 30, y1: 170, aim: 190,
    hitstun: 0, blockstun: 12, push: 3, gain: 10, knockdown: true, heavy: true, launch: 12.5, speed: 4, go: [0, 7],
  },
  punch3: {
    startup: 6, active: 4, recovery: 17, dmg: 9, reach: 92, arc: 0.9, y0: 40, y1: 170, aim: 190,
    hitstun: 0, blockstun: 14, push: 9, gain: 11, knockdown: true, heavy: true,
  },
  kick: {
    startup: 8, active: 4, recovery: 13, dmg: 10, reach: 104, arc: 0.75, y0: 30, y1: 140, aim: 210,
    hitstun: 19, blockstun: 12, push: 9, gain: 12, heavy: true, nextK: 'kick2',
  },
  // --- signature moves: grab with the rival out of throw reach (SIG) ---
  // Ruko leaps across the gap and claws down; Shadow steps through the
  // shadows to the rival's back; Jackie barges in belly first, shoving them
  // far; Pixie cartwheels in (untouchable as it starts) and kicks.
  clawLeap: {
    startup: 8, active: 999, recovery: 0, dmg: 7, speed: 9, reach: 78, arc: 1.0, y0: -80, y1: 130, aim: 320,
    hitstun: 18, blockstun: 11, push: 6, gain: 9, heavy: true, leap: 8,
  },
  shadeStep: {
    startup: 12, active: 0, recovery: 4, dmg: 0, aim: 320, blink: 5, vanish: 9,
  },
  bellyBump: {
    startup: 9, active: 5, recovery: 16, dmg: 6, reach: 72, arc: 1.0, y0: 20, y1: 150, aim: 320,
    hitstun: 16, blockstun: 12, push: 20, gain: 9, heavy: true, speed: 7, go: [0, 12],
  },
  cartwheel: {
    startup: 10, active: 4, recovery: 16, dmg: 7, reach: 88, arc: 0.9, y0: 30, y1: 150, aim: 320,
    hitstun: 18, blockstun: 11, push: 7, gain: 9, heavy: true, speed: 6, go: [0, 11], vanish: 6,
  },
  // A taunt: no blow at all (see TAUNT).
  taunt: {
    startup: 40, active: 0, recovery: 0, dmg: 0, aim: 400,
  },
  // Kick held: coiled (open to any blow while it charges)...
  charge: {
    startup: 999, active: 0, recovery: 0, dmg: 0, aim: 210,
  },
  // ...and let go: a heavy kick that breaks a guard, leaving the one behind
  // it reeling and open (`breaks`). A perfect guard still turns it away.
  breaker: {
    startup: 5, active: 4, recovery: 22, dmg: 12, reach: 108, arc: 0.8, y0: 30, y1: 150, aim: 210,
    hitstun: 0, blockstun: 0, push: 12, gain: 12, knockdown: true, heavy: true, breaks: true,
  },
  // Kick, kick: a kick that lands flows into a spinning roundhouse that
  // knocks down, stepping in after the rival the first kick pushed away.
  kick2: {
    startup: 7, active: 4, recovery: 18, dmg: 8, reach: 108, arc: 1.1, y0: 50, y1: 160, aim: 210,
    hitstun: 0, blockstun: 13, push: 10, gain: 11, knockdown: true, heavy: true, speed: 6, go: [0, 9],
  },
  // Punch on the move: a lunging straight that carries the body forward
  // (`speed` from tick go[0] to go[1]), reaching further than a jab but
  // slower to start. It can still open the punch string.
  lunge: {
    startup: 6, active: 4, recovery: 12, dmg: 7, reach: 92, arc: 0.8, y0: 70, y1: 150, aim: 240,
    hitstun: 17, blockstun: 10, push: 6, gain: 10, next: 'punch2', nextK: 'hook', speed: 5.5, go: [0, 10],
  },
  // Kick on the move: a slide along the floor, feet first. Low, so a rival
  // in the air is over it; it sweeps whoever it catches off their feet, but
  // a slide that misses leaves the slider lying open.
  slide: {
    startup: 7, active: 9, recovery: 20, dmg: 6, reach: 66, arc: 0.6, y0: -20, y1: 60, aim: 220,
    hitstun: 0, blockstun: 12, push: 6, gain: 10, knockdown: true, speed: 7.5, go: [7, 16],
  },
  // Out of a dodge roll: punch springs up into a rising uppercut that knocks
  // down, kick whips round into a spinning heel kick with a wide arc. The
  // roll is what makes them safe to start; they are slow to recover.
  rollUpper: {
    startup: 5, active: 4, recovery: 18, dmg: 8, reach: 80, arc: 0.9, y0: 50, y1: 200, aim: 200,
    hitstun: 0, blockstun: 12, push: 7, gain: 10, knockdown: true, heavy: true, speed: 3, go: [0, 7],
  },
  rollSpin: {
    startup: 6, active: 5, recovery: 16, dmg: 7, reach: 100, arc: 1.4, y0: 30, y1: 150, aim: 220,
    hitstun: 20, blockstun: 12, push: 13, gain: 10, heavy: true,
  },
  // Getting up with punch or kick: a low sweeping kick off the floor. It
  // cannot be hit while it starts, so it breaks a rival waiting over you,
  // but it is slow to recover if guarded.
  riseKick: {
    startup: 7, active: 4, recovery: 20, dmg: 7, reach: 92, arc: 1.3, y0: -10, y1: 100, aim: 200,
    hitstun: 16, blockstun: 12, push: 14, gain: 8,
  },
  // Punch and kick together: a grab. Short reach and slow to recover if it
  // misses, but a guard does not stop it - the answer to a rival who only blocks.
  grab: {
    startup: 7, active: 3, recovery: 24, dmg: 10, reach: 62, arc: 0.7, y0: 40, y1: 150, aim: 150,
    hitstun: 0, blockstun: 0, push: 6, gain: 10, knockdown: true, heavy: true, unblockable: true,
  },
  // In the air each button has its own move: punch is a quick fist angled
  // down at whoever is below and in front, kick the heavier flying kick, and
  // grab (or punch and kick together) a stomp straight down that knocks over
  // whoever it lands on - but leaves the stomper rooted if it misses.
  airPunch: {
    startup: 3, active: 999, recovery: 0, dmg: 7, reach: 72, arc: 1.0, y0: -50, y1: 100, aim: 0,
    hitstun: 16, blockstun: 10, push: 5, gain: 9,
  },
  airKick: {
    startup: 5, active: 999, recovery: 0, dmg: 9, reach: 80, arc: 1.0, y0: -20, y1: 90, aim: 0,
    hitstun: 18, blockstun: 11, push: 6, gain: 10, heavy: true,
  },
  // An air punch that lands can be followed in the same jump by kick: an
  // axe kick brought straight down that knocks over.
  axeKick: {
    startup: 4, active: 999, recovery: 0, dmg: 7, reach: 78, arc: 1.1, y0: -90, y1: 80, aim: 0,
    hitstun: 0, blockstun: 12, push: 6, gain: 10, knockdown: true, heavy: true,
  },
  // Jumping out of a run, kick is a flying knee: fast, far and it knocks down.
  flyKnee: {
    startup: 3, active: 999, recovery: 0, dmg: 9, reach: 80, arc: 1.0, y0: -10, y1: 140, aim: 0,
    hitstun: 0, blockstun: 12, push: 8, gain: 10, knockdown: true, heavy: true,
  },
  // --- air specials (special pressed in the air, costs the same) ---
  // Ruko rushes diagonally down at the rival; Shadow throws the bolt angled
  // down; Jackie drops belly-first and the landing floors those around;
  // Pixie twirls in a spiral of flame that strikes all round.
  airDash: {
    startup: 4, active: 999, recovery: 0, dmg: 11, speed: 11, reach: 84, arc: 1.1, y0: -60, y1: 140, aim: 400,
    hitstun: 0, blockstun: 14, push: 9, gain: 6, knockdown: true, heavy: true, chip: 0.25, fall: 7,
  },
  airBolt: {
    startup: 7, active: 999, recovery: 0, dmg: 0, aim: 600,
  },
  bodyPress: {
    startup: 7, active: 999, recovery: 0, dmg: 12, reach: 60, arc: Math.PI, y0: -140, y1: 30, aim: 0,
    hitstun: 0, blockstun: 14, push: 8, gain: 6, knockdown: true, heavy: true, chip: 0.25, fall: 15, crash: 115,
  },
  airSpiral: {
    startup: 3, active: 999, recovery: 0, dmg: 11, reach: 98, arc: Math.PI, y0: -60, y1: 150, aim: 0,
    hitstun: 0, blockstun: 12, push: 7, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  stomp: {
    startup: 5, active: 999, recovery: 0, dmg: 10, reach: 44, arc: Math.PI, y0: -110, y1: 30, aim: 0,
    hitstun: 0, blockstun: 14, push: 7, gain: 10, knockdown: true, heavy: true, bounce: 6.5,
  },
  // --- specials (cost RULES.SPECIAL_COST energy) ---
  dash: {
    startup: 9, active: 13, recovery: 20, dmg: 14, speed: 13, reach: 82, arc: 1.1, y0: 10, y1: 150, aim: 340,
    hitstun: 0, blockstun: 16, push: 9, gain: 6, knockdown: true, heavy: true, chip: 0.25, rush: true,
  },
  bolt: {
    startup: 12, active: 1, recovery: 14, dmg: 14, aim: 900,
    hitstun: 18, blockstun: 11, push: 7, gain: 6, heavy: true, chip: 0.25,
  },
  rise: {
    startup: 5, active: 14, recovery: 999, dmg: 14, vh: 13.5, reach: 74, arc: Math.PI, y0: 0, y1: 190, aim: 0,
    hitstun: 0, blockstun: 14, push: 6, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  quake: {
    startup: 20, active: 3, recovery: 28, dmg: 11, reach: 150, arc: Math.PI, y0: -5, y1: 30, aim: 0,
    hitstun: 0, blockstun: 14, push: 8, gain: 6, knockdown: true, heavy: true, chip: 0.25,
  },
  // --- finisher (costs the whole energy bar) ---
  super: {
    startup: 6, active: 16, recovery: 26, dmg: 32, speed: 21, reach: 86, arc: 1.2, y0: 0, y1: 160, aim: 420,
    hitstun: 0, blockstun: 20, push: 12, gain: 0, knockdown: true, heavy: true, chip: 0.3, rush: true,
  },
  // --- each fighter's own finisher: a chain of stages ---
  // A stage that has landed a blow (not a guarded one) flows into `then` at
  // tick `thenAt` (or when its hits end); `every` lets a flurry strike the
  // same rival again every few ticks; `noScale` keeps long-combo damage
  // scaling off (the finisher is one move); `light` marks the small hits of
  // a flurry. Each is worth about 32 in all.
  //
  // Ruko - Red Moon Howl: a rush, a flurry of claws, an uppercut to the moon.
  howl: {
    startup: 6, active: 16, recovery: 24, dmg: 8, speed: 19, reach: 86, arc: 1.2, y0: 0, y1: 160, aim: 420,
    hitstun: 30, blockstun: 20, push: 1, gain: 0, heavy: true, chip: 0.3, rush: true, ult: true, noScale: true,
    then: 'howl2', thenAt: 0,
  },
  howl2: {
    startup: 3, active: 16, recovery: 4, dmg: 3, reach: 92, arc: 1.1, y0: 30, y1: 180, aim: 160,
    hitstun: 16, blockstun: 8, push: 0.6, gain: 0, chip: 0.3, ult: true, noScale: true, light: true, every: 4,
    then: 'howl3',
  },
  howl3: {
    startup: 5, active: 4, recovery: 24, dmg: 13, reach: 96, arc: 1.1, y0: 20, y1: 220, aim: 160,
    hitstun: 0, blockstun: 16, push: 4, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    launch: 14, final: true,
  },
  // Shadow - Total Eclipse: vanishes, reappears behind the rival, a shadow
  // flurry, a turning kick that sends them flying.
  eclipse: {
    startup: 14, active: 4, recovery: 22, dmg: 8, reach: 112, arc: 1.5, y0: 20, y1: 170, aim: 900,
    hitstun: 30, blockstun: 16, push: 1, gain: 0, heavy: true, chip: 0.3, ult: true, noScale: true,
    blink: 10, vanish: 14, then: 'eclipse2', thenAt: 0,
  },
  eclipse2: {
    startup: 3, active: 12, recovery: 4, dmg: 4, reach: 92, arc: 2, y0: 30, y1: 170, aim: 160,
    hitstun: 16, blockstun: 8, push: 0.6, gain: 0, chip: 0.3, ult: true, noScale: true, light: true, every: 4,
    then: 'eclipse3',
  },
  eclipse3: {
    startup: 6, active: 4, recovery: 22, dmg: 12, reach: 104, arc: 2, y0: 30, y1: 170, aim: 160,
    hitstun: 0, blockstun: 16, push: 14, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    final: true,
  },
  // Jackie - Avalanche Charge: a charge that leaves the rival reeling, then
  // a leap and a belly-first crash that shakes everyone near off their feet.
  avalanche: {
    startup: 8, active: 22, recovery: 24, dmg: 10, speed: 12, reach: 100, arc: 1.35, y0: 0, y1: 170, aim: 420,
    hitstun: 50, blockstun: 20, push: 2, gain: 0, heavy: true, chip: 0.3, rush: true, ult: true, noScale: true,
    then: 'avalanche2', thenAt: 0,
  },
  avalanche2: {
    startup: 14, active: 999, recovery: 0, dmg: 20, speed: 6, reach: 74, arc: Math.PI, y0: -170, y1: 40, aim: 600,
    hitstun: 0, blockstun: 18, push: 8, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    leap: 13, crash: 95, final: true,
  },
  // Pixie - Phoenix Dive: soars up inside a pillar of flame, then dives on
  // the rival like a falling star and bursts on the floor.
  phoenix: {
    startup: 6, active: 30, recovery: 999, dmg: 3, vh: 15, drift: 3, reach: 90, arc: Math.PI, y0: -10, y1: 230, aim: 0,
    hitstun: 18, blockstun: 10, push: 0.5, gain: 0, chip: 0.3, ult: true, noScale: true, light: true, every: 6,
    apex: 'phoenix2',
  },
  phoenix2: {
    startup: 2, active: 999, recovery: 0, dmg: 15, speed: 8, reach: 80, arc: 1.5, y0: -170, y1: 60, aim: 900,
    hitstun: 0, blockstun: 18, push: 10, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    dive: 13, crash: 90, final: true,
  },
  // Meru - Last Oath: a charge, three hammering blows, a slam that shakes
  // the floor under everyone near.
  oath: {
    startup: 8, active: 16, recovery: 24, dmg: 8, speed: 16, reach: 88, arc: 1.2, y0: 0, y1: 170, aim: 420,
    hitstun: 30, blockstun: 20, push: 1, gain: 0, heavy: true, chip: 0.3, rush: true, ult: true, noScale: true,
    then: 'oath2', thenAt: 0,
  },
  oath2: {
    startup: 4, active: 15, recovery: 4, dmg: 4, reach: 92, arc: 2, y0: 30, y1: 180, aim: 160,
    hitstun: 18, blockstun: 8, push: 0.6, gain: 0, chip: 0.3, ult: true, noScale: true, light: true, every: 5,
    then: 'oath3',
  },
  oath3: {
    startup: 10, active: 999, recovery: 0, dmg: 12, speed: 3, reach: 80, arc: Math.PI, y0: -150, y1: 40, aim: 300,
    hitstun: 0, blockstun: 16, push: 8, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    leap: 9, crash: 150, final: true,
  },
  // Gleh - Crescent Rain: a leap high above the arena, then a rain of
  // moonlit arrows loosed down on the rival (`volley` shots).
  crescent: {
    startup: 6, active: 30, recovery: 999, dmg: 0, vh: 15, aim: 0, ult: true, apex: 'crescent2',
  },
  crescent2: {
    startup: 4, active: 999, recovery: 0, dmg: 0, aim: 900, ult: true, volley: 5,
  },
  // Kichta - Thousand Cuts: a dash, a storm of cuts too quick to see, and a
  // rising slash that throws the rival up.
  cuts: {
    startup: 5, active: 14, recovery: 24, dmg: 6, speed: 21, reach: 86, arc: 1.2, y0: 0, y1: 160, aim: 420,
    hitstun: 30, blockstun: 20, push: 1, gain: 0, heavy: true, chip: 0.3, rush: true, ult: true, noScale: true,
    then: 'cuts2', thenAt: 0,
  },
  cuts2: {
    startup: 2, active: 18, recovery: 3, dmg: 2, reach: 94, arc: Math.PI, y0: 30, y1: 180, aim: 160,
    hitstun: 14, blockstun: 6, push: 0.4, gain: 0, chip: 0.3, ult: true, noScale: true, light: true, every: 3,
    then: 'cuts3',
  },
  cuts3: {
    startup: 4, active: 4, recovery: 24, dmg: 12, reach: 96, arc: 2.2, y0: 20, y1: 220, aim: 160,
    hitstun: 0, blockstun: 16, push: 4, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    launch: 13, final: true,
  },
  // Zelrith - Sunburst: up into a ball of light that strikes all round as it
  // climbs, then down like a falling sun and a burst on the floor.
  sunburst: {
    startup: 6, active: 30, recovery: 999, dmg: 4, vh: 14, drift: 4, reach: 100, arc: Math.PI, y0: -20, y1: 230, aim: 0,
    hitstun: 18, blockstun: 10, push: 0.5, gain: 0, chip: 0.3, ult: true, noScale: true, light: true, every: 7,
    apex: 'sunburst2',
  },
  sunburst2: {
    startup: 3, active: 999, recovery: 0, dmg: 16, speed: 8, reach: 90, arc: Math.PI, y0: -170, y1: 60, aim: 900,
    hitstun: 0, blockstun: 18, push: 10, gain: 0, knockdown: true, heavy: true, chip: 0.3, ult: true, noScale: true,
    dive: 14, crash: 115, final: true,
  },
  // --- the newer fighters' signature moves (grab out of reach) ---
  shieldRam: {
    startup: 8, active: 5, recovery: 16, dmg: 6, reach: 74, arc: 1.0, y0: 20, y1: 160, aim: 320,
    hitstun: 18, blockstun: 12, push: 16, gain: 9, heavy: true, speed: 7.5, go: [0, 12],
  },
  moonVault: {
    startup: 9, active: 999, recovery: 0, dmg: 6, speed: 11, reach: 76, arc: Math.PI, y0: -90, y1: 130, aim: 320,
    hitstun: 16, blockstun: 10, push: 5, gain: 9, leap: 8.5, over: 1.7,
  },
  bladeDash: {
    startup: 7, active: 6, recovery: 16, dmg: 7, reach: 90, arc: 0.9, y0: 40, y1: 160, aim: 320,
    hitstun: 18, blockstun: 11, push: 6, gain: 9, heavy: true, speed: 10, go: [3, 13],
  },
  spinTop: {
    startup: 7, active: 10, recovery: 16, dmg: 6, reach: 82, arc: Math.PI, y0: 20, y1: 160, aim: 320,
    hitstun: 16, blockstun: 10, push: 8, gain: 9, speed: 6, go: [0, 15],
  },
};
// The finisher's opening stage, by fighter (see `super.move` in the roster).
export const ULT_MOVES = new Set(Object.keys(MOVES).filter((k) => MOVES[k].ult));

const PROJECTILE = { speed: 9.5, r: 15, h: 100, life: 150 };

// Where fighters start a round, by slot.
const SPAWNS = {
  2: [[-170, 0], [170, 0]],
  3: [[-280, 60], [280, 60], [0, -260]],
  4: [[-300, 0], [300, 0], [0, -270], [0, 250]],
};

const angleTo = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax);
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// `mod` optionally strengthens a fighter (used for arcade bosses):
// { health: 1.3, power: 1.15 } means 30% more health and 15% harder hits.
function newFighter(charId, slot, count, mod) {
  const c = getFighter(charId);
  const health = Math.round(c.stats.health * (mod?.health ?? 1));
  const [x, z] = SPAWNS[count][slot];
  return {
    char: c.id,
    slot,
    pw: mod?.power ?? 1,
    x,
    z,
    h: 0,
    vx: 0,
    vz: 0,
    vh: 0,
    dir: Math.atan2(-z, -x), // face the centre
    hp: health,
    maxHp: health,
    meter: 0,
    state: 'idle',
    t: 0, // ticks spent in the current state
    move: null, // key into MOVES while attacking
    hits: [], // slots already struck by the current attack
    stun: 0,
    stop: 0, // ticks this fighter is frozen by the impact of a hit
    inv: 0, // invulnerability ticks
    rollOk: true, // the block button must be released before the next roll
    guard: 0, // ticks left in which a blocked blow counts as a perfect guard
    open: 99, // ticks since this fighter last had the guard up
    deflect: 0, // ticks left of the shove that follows a perfect guard (for show)
    reel: 0, // ticks left staggering after a heavy blow was guarded perfectly
    prev: 0, // buttons held on the previous tick
    held: -1, // slot of the rival being thrown, or -1
    jumpT: 0, // ticks left on a remembered press of jump (for the air jump)
    runJump: false, // the jump was taken out of a run (kick is a flying knee)
    juggle: 0, // hits a launched fighter can still take before landing
    holdK: 0, // ticks the kick button has been held
    hitsAt: -1, // the tick of a flurry on which it last struck afresh
    ultOn: -1, // slot of the rival this finisher has landed on, or -1
    shrug: 0, // blows from others shrugged off during this finisher
    air2: false, // the air jump is spent
    buf: 0, // remembered attack presses
    bufT: 0,
    taken: 0, // hits taken in the current combo
    outAt: -1, // tick at which this fighter was knocked out this round
  };
}

// chars: 2 to 4 fighter ids. mode: 'duel' or 'arena'.
// `seed` decides where and when crystals appear; the same seed gives the same match.
export function createMatch(chars, mods = [], mode = chars.length > 2 ? 'arena' : 'duel', seed = 1) {
  const n = chars.length;
  const rules = MODES[mode];
  return {
    mode,
    mods,
    tick: 0,
    phase: 'intro', // intro -> fight -> ko -> (intro | over)
    pt: 0, // ticks spent in the current phase
    round: 1,
    timer: rules.seconds * TICK_RATE,
    ringR: ARENA.R,
    f: chars.map((c, i) => newFighter(c, i, n, mods[i])),
    proj: [],
    items: [], // crystals lying on the floor
    itemSeq: 0,
    nextItem: ITEMS.first * TICK_RATE,
    seed: seed >>> 0 || 1,
    pts: chars.map(() => 0), // match points per fighter
    roundPts: chars.map(() => 0), // points handed out by the round that just ended
    hitstop: 0,
    finale: 0, // ticks left of a finisher's closing shot (the camera's cue)
    finaleOn: -1,
    freeze: 0,
    freezeBy: -1,
    winner: -1, // winner of the round that just ended (-1 = shared)
    koKind: null, // 'ko' | 'time'
    matchWinner: -2, // -2 = not decided, -1 = tie at the top, otherwise a slot
    ranking: null, // final standings once the match is over
    ev: [], // events produced by the latest tick (sounds, sparks, banners)
    evSeq: 0,
    projSeq: 0,
  };
}

// The match's own random numbers (deterministic, kept in the state).
function random(s) {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

function updateItems(s) {
  if (--s.nextItem <= 0) {
    s.nextItem = Math.round((ITEMS.every[0] + random(s) * (ITEMS.every[1] - ITEMS.every[0])) * TICK_RATE);
    if (s.items.length < ITEMS.max) {
      const a = random(s) * Math.PI * 2;
      const r = Math.sqrt(random(s)) * (s.ringR - 90);
      const item = { id: ++s.itemSeq, kind: random(s) < 0.6 ? 'energy' : 'heal', x: Math.cos(a) * r, z: Math.sin(a) * r, life: ITEMS.life * TICK_RATE };
      s.items.push(item);
      emit(s, 'spawn', { kind: item.kind, x: item.x, z: item.z });
    }
  }
  for (const it of s.items) {
    if (--it.life <= 0 || Math.hypot(it.x, it.z) > s.ringR - 20) {
      it.gone = true;
      continue;
    }
    for (const f of s.f) {
      if (isOut(f) || f.h > 40 || f.state === 'down' || Math.hypot(f.x - it.x, f.z - it.z) > ITEMS.reach) continue;
      if (it.kind === 'energy') addMeter(f, ITEMS.energy);
      else f.hp = Math.min(f.maxHp, f.hp + ITEMS.heal);
      it.gone = true;
      emit(s, 'pickup', { slot: f.slot, kind: it.kind, x: it.x, z: it.z });
      break;
    }
  }
  s.items = s.items.filter((it) => !it.gone);
}

function emit(s, type, data) {
  s.ev.push({ id: ++s.evSeq, type, ...data });
}

function setState(f, state) {
  if (f.state !== state) {
    f.state = state;
    f.t = 0;
  }
}

const speedOf = (f) => getFighter(f.char).stats.speed;
const isOut = (f) => f.hp <= 0;

function nearestRival(s, f, range) {
  let best = null;
  let bestD = range;
  for (const o of s.f) {
    if (o === f || isOut(o)) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// Turn towards the nearest rival in range, so attacks do not need pixel-perfect aim.
// (A finisher that has landed stays on its victim while they are in range,
// rather than turning to whoever has come nearest.)
function markOf(s, f, range) {
  const o = f.state === 'attack' && MOVES[f.move]?.ult && f.ultOn >= 0 ? s.f[f.ultOn] : null;
  if (o && !isOut(o) && Math.hypot(o.x - f.x, o.z - f.z) < range) return o;
  return nearestRival(s, f, range);
}
function aim(s, f, range) {
  if (range <= 0) return;
  const o = markOf(s, f, range);
  if (o && (o.x !== f.x || o.z !== f.z)) f.dir = angleTo(f.x, f.z, o.x, o.z);
}

// Raising a guard turns it towards the rival whose blow is on its way (the
// nearest one swinging, within reach), and only failing that towards the
// nearest rival - in a brawl the nearest is often not the one attacking.
function aimGuard(s, f) {
  let best = null;
  let bestD = 260;
  for (const o of s.f) {
    if (o === f || isOut(o) || (o.state !== 'attack' && o.state !== 'airAttack')) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  if (best) f.dir = angleTo(f.x, f.z, best.x, best.z);
  else aim(s, f, 360);
}

function startAttack(s, f, move) {
  const m = MOVES[move];
  f.cancelled = !!f.cancel; // a special cancelled out of a blow hits softer (CANCEL_DMG)
  f.state = 'attack';
  f.move = move;
  f.t = 0;
  f.hits = [];
  f.hitsAt = -1;
  f.landed = 0;
  f.vx = 0;
  f.vz = 0;
  f.buf = 0;
  aim(s, f, m.aim);
  if (m.leap || m.dive) {
    // A leap or a dive aimed to come down on the nearest rival (or on the
    // one the finisher has already caught).
    const o = markOf(s, f, m.aim);
    const d = o ? Math.hypot(o.x - f.x, o.z - f.z) : 0;
    const flight = m.leap ? (2 * m.leap) / GRAVITY : Math.max(1, f.h / m.dive);
    const v = Math.min(m.speed, (d * (m.over || 1)) / flight); // `over`: land beyond them
    f.vx = Math.cos(f.dir) * v;
    f.vz = Math.sin(f.dir) * v;
    f.vh = m.leap || -m.dive;
  }
  emit(s, 'swing', { by: f.slot, move });
}

// Vanish and reappear just behind the nearest rival (or a long step ahead).
function blink(s, f) {
  const o = nearestRival(s, f, 900);
  const x0 = f.x;
  const z0 = f.z;
  if (o) {
    f.x = o.x - Math.cos(o.dir) * 66;
    f.z = o.z - Math.sin(o.dir) * 66;
    f.dir = angleTo(f.x, f.z, o.x, o.z);
    // A guard already raised turns to meet the shadow (so it can be blocked
    // like any finisher); one caught open is struck from behind.
    if (o.state === 'block') o.dir = angleTo(o.x, o.z, f.x, f.z);
  } else {
    f.x += Math.cos(f.dir) * 200;
    f.z += Math.sin(f.dir) * 200;
  }
  keepInside(s, f);
  emit(s, 'blink', { by: f.slot, x0, z0, x: f.x, z: f.z });
}

// A press is remembered for BUFFER_TICKS of the fighter's own time: while
// the action is held still by a blow's impact, the memory does not run out
// (a follow-up pressed during the impact still comes out).
function rememberPresses(f, inp, frozen) {
  const pressed = inp & ~f.prev & (INPUT.PUNCH | INPUT.KICK | INPUT.SPECIAL | INPUT.SUPER | INPUT.GRAB);
  if (pressed) {
    f.buf |= pressed;
    f.bufT = BUFFER_TICKS;
  } else if (f.bufT > 0 && !frozen && --f.bufT === 0) {
    f.buf = 0;
  }
}

// Turn a remembered button press into an attack, if the fighter can afford it.
function tryAttack(s, f, inp = 0) {
  const b = f.buf;
  if (b & INPUT.SUPER && f.meter >= RULES.SUPER_COST) {
    f.meter = 0;
    const ult = getFighter(f.char).super.move || 'super';
    f.ultOn = -1;
    f.shrug = 0;
    startAttack(s, f, ult);
    if (MOVES[ult].vanish) f.inv = MOVES[ult].vanish;
    s.freeze = TIMING.SUPER_FREEZE;
    s.freezeBy = f.slot;
    emit(s, 'super', { by: f.slot });
    return true;
  }
  if (b & INPUT.SPECIAL && f.meter >= RULES.SPECIAL_COST) {
    f.meter -= RULES.SPECIAL_COST;
    const type = getFighter(f.char).special.type;
    startAttack(s, f, type);
    if (type === 'rise') f.inv = MOVES.rise.startup + 6;
    emit(s, 'special', { by: f.slot, move: type, cancel: !!f.cancel });
    return true;
  }
  if (b & INPUT.GRAB || (b & INPUT.KICK && b & INPUT.PUNCH)) {
    // Grab with nobody in reach of a throw: the fighter's signature move.
    const sig = b & INPUT.GRAB && !nearestRival(s, f, SIG.near) && getFighter(f.char).signature;
    if (sig) {
      startAttack(s, f, sig.move);
      if (MOVES[sig.move].vanish) f.inv = MOVES[sig.move].vanish;
      emit(s, 'signature', { by: f.slot, move: sig.move });
      return true;
    }
    startAttack(s, f, 'grab');
    return true;
  }
  // On the run, the same buttons give the moving versions: after a few steps
  // (a jab from a shuffle stays a jab) and with the stick still held (letting
  // go of it gives the standing move).
  const moving = f.state === 'walk' && f.t >= RUN_TICKS && !!stick(inp);
  if (b & INPUT.KICK) {
    startAttack(s, f, moving ? 'slide' : 'kick');
    return true;
  }
  if (b & INPUT.PUNCH) {
    startAttack(s, f, moving ? 'lunge' : 'punch');
    return true;
  }
  f.buf = 0;
  return false;
}

// The direction the stick is pushed, as a unit vector (or null when centred).
function stick(inp) {
  const mx = (inp & INPUT.RIGHT ? 1 : 0) - (inp & INPUT.LEFT ? 1 : 0);
  const mz = (inp & INPUT.DOWN ? 1 : 0) - (inp & INPUT.UP ? 1 : 0);
  if (!mx && !mz) return null;
  const len = Math.hypot(mx, mz);
  return { x: mx / len, z: mz / len };
}

// Decide what a fighter does this tick, from its state and the held buttons.
function control(s, f, inp) {
  const held = (bit) => (inp & bit) !== 0;
  if (f.guard > 0) f.guard--;
  if (f.deflect > 0) f.deflect--;
  if (f.reel > 0) f.reel--;
  if (f.state === 'block') f.open = 0;
  else if (f.open < 99) f.open++;
  switch (f.state) {
    case 'idle':
    case 'walk':
    case 'block': {
      if (f.stun > 0) {
        f.stun--; // still absorbing a blocked hit
        break;
      }
      f.taken = 0;
      // Block held and grab pressed, standing still: a taunt.
      if (f.buf & INPUT.GRAB && held(INPUT.BLOCK) && !stick(inp)) {
        startAttack(s, f, 'taunt');
        break;
      }
      if (f.buf && tryAttack(s, f, inp)) break;
      const dir = stick(inp);
      if (!held(INPUT.BLOCK)) f.rollOk = true;
      if (held(INPUT.BLOCK)) {
        // Block pressed while pushing a direction is a dodge roll that way:
        // quick, and nothing can hit you for most of it.
        if (dir && f.rollOk && f.state !== 'block') {
          f.rollOk = false;
          const o = nearestRival(s, f, 400);
          const d = o ? Math.hypot(o.x - f.x, o.z - f.z) || 1 : 1;
          if (o && (dir.x * (o.x - f.x) + dir.z * (o.z - f.z)) / d < BACKSTEP.away) {
            setState(f, 'backstep');
            f.dir = angleTo(f.x, f.z, o.x, o.z);
            f.vx = dir.x * BACKSTEP.speed;
            f.vz = dir.z * BACKSTEP.speed;
            f.inv = BACKSTEP.safe;
            emit(s, 'backstep', { by: f.slot, x: f.x, z: f.z });
            break;
          }
          setState(f, 'roll');
          f.dir = Math.atan2(dir.z, dir.x);
          f.vx = dir.x * ROLL.speed;
          f.vz = dir.z * ROLL.speed;
          f.inv = ROLL.safe;
          emit(s, 'roll', { by: f.slot });
          break;
        }
        if (f.state !== 'block') {
          aimGuard(s, f);
          f.guard = f.open >= GUARD.rest ? GUARD.window : 0;
        }
        setState(f, 'block');
        f.vx = 0;
        f.vz = 0;
        break;
      }
      if (held(INPUT.JUMP)) {
        f.runJump = f.state === 'walk' && f.t >= RUN_TICKS && !!dir; // a jump out of a run
        setState(f, 'jump');
        f.vh = JUMP_V;
        f.jumpT = 0; // this press is the take-off, not an air jump
        f.air2 = false;
        f.vx = dir ? dir.x * AIR_SPEED * speedOf(f) : 0;
        f.vz = dir ? dir.z * AIR_SPEED * speedOf(f) : 0;
        if (dir) f.dir = Math.atan2(dir.z, dir.x);
        emit(s, 'jump', { by: f.slot });
        break;
      }
      if (dir) {
        setState(f, 'walk');
        f.vx = dir.x * WALK * speedOf(f);
        f.vz = dir.z * WALK * speedOf(f);
        f.dir = Math.atan2(dir.z, dir.x);
      } else {
        setState(f, 'idle');
        f.vx = 0;
        f.vz = 0;
      }
      break;
    }
    case 'backstep': {
      f.vx *= 0.88;
      f.vz *= 0.88;
      if (f.t >= BACKSTEP.ticks) {
        setState(f, 'land');
        f.stun = BACKSTEP.rest;
        f.vx = f.vz = 0;
      }
      break;
    }
    case 'roll': {
      if (f.t >= OUT_OF.from && f.buf & (INPUT.PUNCH | INPUT.KICK)) {
        startAttack(s, f, f.buf & INPUT.KICK ? 'rollSpin' : 'rollUpper');
        break;
      }
      if (f.t >= ROLL.ticks) {
        setState(f, 'land');
        f.stun = ROLL.rest;
        f.vx = f.vz = 0;
      }
      break;
    }
    case 'jump': {
      const b = f.buf;
      if (b & INPUT.SPECIAL && f.meter >= RULES.SPECIAL_COST) {
        const move = AIR_SPECIAL[getFighter(f.char).special.type];
        f.meter -= RULES.SPECIAL_COST;
        airAttack(s, f, move);
        if (move === 'airSpiral') f.vh = Math.max(f.vh, 4); // a lift into the twirl
        emit(s, 'special', { by: f.slot, move });
        break;
      }
      if (b & (INPUT.PUNCH | INPUT.KICK | INPUT.GRAB)) {
        const kick = f.runJump && !f.air2 && f.t < 16 ? 'flyKnee' : 'airKick';
        airAttack(s, f, b & INPUT.GRAB || (b & INPUT.PUNCH && b & INPUT.KICK) ? 'stomp' : b & INPUT.KICK ? kick : 'airPunch');
        break;
      }
      if (f.jumpT > 0 && !f.air2 && f.t >= AIR_JUMP.from) {
        // The air jump: up again, and steered anew by the stick.
        const dir = stick(inp);
        f.air2 = true;
        f.jumpT = 0;
        f.t = 0;
        f.vh = AIR_JUMP.v;
        f.vx = dir ? dir.x * AIR_SPEED * speedOf(f) : f.vx * 0.5;
        f.vz = dir ? dir.z * AIR_SPEED * speedOf(f) : f.vz * 0.5;
        if (dir) f.dir = Math.atan2(dir.z, dir.x);
        emit(s, 'jump2', { by: f.slot, x: f.x, z: f.z, h: f.h });
      }
      break;
    }
    case 'airAttack': {
      // The other button a beat after the first makes a stomp, as on the ground.
      if (f.move !== 'stomp' && f.t < GRAB_WINDOW && f.buf & (f.move === 'airPunch' ? INPUT.KICK : INPUT.PUNCH)) {
        airAttack(s, f, 'stomp');
        break;
      }
      // An air punch that landed: kick follows it with the axe kick.
      if (f.move === 'airPunch' && f.hits.length && f.t >= GRAB_WINDOW && f.buf & INPUT.KICK) {
        airAttack(s, f, 'axeKick');
        break;
      }
      const am = MOVES[f.move];
      if (am.fall && f.t === am.startup) {
        // A dive at the rival (or straight down): the drop of the air specials.
        f.vh = -am.fall;
        if (am.speed) {
          aim(s, f, am.aim);
          f.vx = Math.cos(f.dir) * am.speed;
          f.vz = Math.sin(f.dir) * am.speed;
        } else f.vx = f.vz = 0;
      } else if (am.fall && f.t < am.startup) {
        f.vh = GRAVITY; // a beat's hang before the drop
        f.vx *= 0.5;
        f.vz *= 0.5;
      }
      if (f.move === 'airBolt' && f.t === am.startup) {
        // The bolt thrown down and forward from the air.
        s.proj.push({
          id: ++s.projSeq,
          owner: f.slot,
          char: f.char,
          x: f.x + Math.cos(f.dir) * 40,
          z: f.z + Math.sin(f.dir) * 40,
          h: f.h + 70,
          vh: -3.6,
          vx: Math.cos(f.dir) * PROJECTILE.speed * 0.85,
          vz: Math.sin(f.dir) * PROJECTILE.speed * 0.85,
          life: PROJECTILE.life,
        });
        emit(s, 'bolt', { by: f.slot });
      }
      if (f.move === 'stomp') {
        if (f.t < MOVES.stomp.startup) {
          f.vh = GRAVITY; // hang in the air (gravity takes this back off)
          f.vx = f.vz = 0;
        } else if (f.t === MOVES.stomp.startup) f.vh = STOMP.fall;
      }
      break;
    }
    case 'attack': {
      const m = MOVES[f.move];
      const t = f.t;
      const activeEnd = m.startup + m.active;
      // The other button soon after a punch or a kick turns it into a grab.
      const punchy = f.move === 'punch' || f.move === 'lunge';
      const kicky = f.move === 'kick' || f.move === 'slide';
      if (t < GRAB_WINDOW && ((punchy && f.buf & INPUT.KICK) || (kicky && f.buf & INPUT.PUNCH))) {
        startAttack(s, f, 'grab');
        break;
      }
      // A kick still held after its first ticks coils into a charge; the
      // charge lets go as the guard-breaker on release (or when full).
      if (f.move === 'kick' && t >= 5 && t < m.startup && f.holdK >= CHARGE.hold) {
        startAttack(s, f, 'charge');
        break;
      }
      if (f.move === 'taunt' && t === TAUNT.at) {
        addMeter(f, TAUNT.gain);
        emit(s, 'taunt', { by: f.slot, x: f.x, z: f.z });
      }
      if (f.move === 'charge') {
        if ((t >= CHARGE.min && !held(INPUT.KICK)) || t >= CHARGE.max) startAttack(s, f, 'breaker');
        break;
      }
      if (m.rush) {
        const going = t >= m.startup && t < activeEnd;
        f.vx = going ? Math.cos(f.dir) * m.speed : 0;
        f.vz = going ? Math.sin(f.dir) * m.speed : 0;
      } else if (m.go) {
        // Moves that travel: full speed through their stretch, then braking.
        const going = t >= m.go[0] && t < m.go[1];
        const v = going ? m.speed : t >= m.go[1] ? Math.hypot(f.vx, f.vz) * 0.75 : 0;
        f.vx = Math.cos(f.dir) * v;
        f.vz = Math.sin(f.dir) * v;
      } else if (m.vh) {
        if (t === m.startup) {
          f.vh = m.vh;
          // Drifting towards the rival on the way up (the phoenix's climb).
          const o = m.drift && markOf(s, f, 600);
          if (o) {
            const v = Math.min(m.drift, Math.max(0, Math.hypot(o.x - f.x, o.z - f.z) - 40) / 12);
            f.dir = angleTo(f.x, f.z, o.x, o.z);
            f.vx = Math.cos(f.dir) * v;
            f.vz = Math.sin(f.dir) * v;
          }
        }
      } else if (f.move === 'quake') {
        if (t === m.startup) emit(s, 'quake', { by: f.slot, x: f.x, z: f.z, r: m.reach + BODY_R });
      } else if (f.move === 'bolt' && t === m.startup) {
        s.proj.push({
          id: ++s.projSeq,
          owner: f.slot,
          char: f.char,
          x: f.x + Math.cos(f.dir) * 50,
          z: f.z + Math.sin(f.dir) * 50,
          h: PROJECTILE.h,
          vx: Math.cos(f.dir) * PROJECTILE.speed,
          vz: Math.sin(f.dir) * PROJECTILE.speed,
          life: PROJECTILE.life,
        });
        emit(s, 'bolt', { by: f.slot });
      }
      // Finisher stages: vanish and reappear, strike again, rise to the top
      // of a leap and dive, or flow into the next stage once a blow lands.
      if (m.blink && t === m.blink) blink(s, f);
      if (m.volley && t === m.startup) {
        // A rain of shots loosed down at the rivals in range, shared out
        // among them nearest first (all at the one rival in a duel), and
        // fanned out a little.
        const marks = s.f
          .filter((o) => o !== f && !isOut(o))
          .map((o) => ({ o, d: Math.hypot(o.x - f.x, o.z - f.z) }))
          .filter((k) => k.d < 900)
          .sort((p, q) => p.d - q.d);
        for (let i = 0; i < m.volley; i++) {
          const mark = marks.length ? marks[i % marks.length] : null;
          const d = mark ? mark.d : 200;
          const per = marks.length ? Math.ceil((m.volley - (i % marks.length)) / marks.length) : m.volley; // arrows this rival gets
          const nth = marks.length ? Math.floor(i / marks.length) : i;
          const a = (mark ? angleTo(f.x, f.z, mark.o.x, mark.o.z) : f.dir) + (nth - (per - 1) / 2) * 0.08;
          // Each arrow drops just enough to meet the rival at chest height.
          const fall = (f.h + 60 - 90) / Math.max(4, d / (PROJECTILE.speed * 0.9));
          s.proj.push({
            id: ++s.projSeq,
            owner: f.slot,
            char: f.char,
            x: f.x,
            z: f.z,
            h: f.h + 60,
            vh: -Math.min(14, Math.max(0.5, fall)),
            vx: Math.cos(a) * PROJECTILE.speed * 0.9,
            vz: Math.sin(a) * PROJECTILE.speed * 0.9,
            life: PROJECTILE.life,
            rain: true,
          });
        }
        emit(s, 'bolt', { by: f.slot });
      }
      // (Once per tick of the move: a fighter held still by the pause of a
      // blow in a brawl keeps the same tick, and must not strike on it again.)
      if (m.every && t > m.startup && (t - m.startup) % m.every === 0 && f.hitsAt !== t) {
        f.hits = [];
        f.hitsAt = t;
      }
      if (m.apex && t > m.startup && f.vh <= 0) {
        startAttack(s, f, m.apex);
        break;
      }
      if (m.then && f.landed > 0 && t >= (m.thenAt ?? activeEnd)) {
        startAttack(s, f, m.then);
        break;
      }
      // A blow that connected can flow straight into the next one of its
      // string: punch for `next`, kick for `nextK` - or be cancelled into the
      // special (or the finisher) at once, energy allowing.
      if (f.hits.length && t >= activeEnd && f.landed > 0 && f.buf & (INPUT.SPECIAL | INPUT.SUPER) && CANCELS.has(f.move)) {
        f.cancel = true;
        const ok = tryAttack(s, f, inp);
        f.cancel = false;
        if (ok) break;
      }
      if (f.hits.length && t >= activeEnd) {
        const nx = f.buf & INPUT.KICK ? m.nextK : f.buf & INPUT.PUNCH ? m.next : null;
        if (nx) {
          startAttack(s, f, nx);
          break;
        }
        // A launcher that landed: jump straight after the rival.
        if (m.launch && held(INPUT.JUMP)) {
          setState(f, 'jump');
          f.move = null;
          f.vh = JUMP_V;
          f.vx = Math.cos(f.dir) * AIR_SPEED;
          f.vz = Math.sin(f.dir) * AIR_SPEED;
          f.jumpT = 0;
          f.air2 = false;
          emit(s, 'jump', { by: f.slot });
          break;
        }
      }
      if (t >= activeEnd + m.recovery) {
        f.move = null;
        setState(f, 'idle');
      }
      break;
    }
    case 'hit':
    case 'land': {
      if (--f.stun <= 0) {
        f.stun = 0;
        setState(f, 'idle');
      }
      break;
    }
    case 'down': {
      if (f.h <= 0 && f.vh === 0 && held(INPUT.BLOCK) && !f.teched && f.stun > TECH_TICKS + 4) {
        f.teched = true;
        f.stun = TECH_TICKS;
        emit(s, 'tech', { by: f.slot });
      }
      if (f.h <= 0 && f.vh === 0 && --f.stun <= 0) {
        f.stun = 0;
        setState(f, 'getup');
        f.inv = GETUP_TICKS;
      }
      break;
    }
    case 'getup': {
      if (f.t >= OUT_OF.rise && f.buf & (INPUT.PUNCH | INPUT.KICK)) {
        startAttack(s, f, 'riseKick');
        f.inv = MOVES.riseKick.startup;
        break;
      }
      if (f.t >= GETUP_TICKS) setState(f, 'idle');
      break;
    }
    case 'throw':
      carryThrow(s, f);
      break;
    case 'held': {
      // Seized: a fresh press of grab in the first moments breaks the hold.
      // Both stagger apart, the thrower a little longer.
      const by = s.f.find((o) => o.held === f.slot && o.state === 'throw');
      if (by && by.t < ESCAPE.window && f.buf & INPUT.GRAB) {
        const a = angleTo(by.x, by.z, f.x, f.z);
        by.held = -1;
        for (const [who, away, stun] of [[by, -1, ESCAPE.stun + ESCAPE.edge], [f, 1, ESCAPE.stun]]) {
          who.state = 'hit';
          who.t = 0;
          who.move = null;
          who.buf = 0;
          who.h = 0;
          who.vh = 0;
          who.stun = stun;
          who.vx = Math.cos(a) * 5 * away;
          who.vz = Math.sin(a) * 5 * away;
        }
        emit(s, 'escape', { by: f.slot, on: by.slot, x: (f.x + by.x) / 2, z: (f.z + by.z) / 2, h: 100 });
      }
      break;
    }
    default:
      break; // airAttack, ko, win, lose: nothing to decide
  }
}

// A seized rival is carried by the thrower: lifted in front, swung up and
// over the head, and driven into the floor behind, where the blow lands.
function carryThrow(s, f) {
  const def = s.f[f.held];
  f.vx = f.vz = 0;
  if (!def || def.state !== 'held') {
    setState(f, 'idle');
    f.held = -1;
    return;
  }
  const t = f.t;
  // Angle round the thrower: 0 = in front, PI = behind.
  const k = t < THROW.lift ? 0 : Math.min(1, (t - THROW.lift) / (THROW.slam - THROW.lift));
  const turn = k * Math.PI;
  const lift = t < THROW.lift ? (t / THROW.lift) * 0.45 : Math.sin(k * Math.PI) * 0.55 + 0.45 * (1 - k);
  def.x = f.x + Math.cos(f.dir + turn) * THROW.reach * Math.max(0.35, Math.abs(Math.cos(turn)));
  def.z = f.z + Math.sin(f.dir + turn) * THROW.reach * Math.max(0.35, Math.abs(Math.cos(turn)));
  def.h = THROW.height * lift;
  def.vx = def.vz = def.vh = 0;
  def.dir = f.dir + Math.PI; // facing the thrower all the way round
  if (t === THROW.slam) {
    def.h = 0;
    def.state = 'idle'; // let the blow land on them like any other
    f.held = -1;
    if (s.phase === 'fight') {
      applyHit(s, f, def, MOVES.grab, f.x, f.z, 'grab');
    } else {
      def.state = 'down';
      def.t = 0;
      def.stun = DOWN_TICKS;
    }
    emit(s, 'slam', { by: f.slot, on: def.slot, x: def.x, z: def.z });
  }
  if (t >= THROW.end) setState(f, 'idle');
}

function airAttack(s, f, move) {
  if (move === 'flyKnee') {
    // The knee drives on along the run.
    const v = Math.max(Math.hypot(f.vx, f.vz), AIR_SPEED * 1.6);
    f.vx = Math.cos(f.dir) * v;
    f.vz = Math.sin(f.dir) * v;
  }
  f.state = 'airAttack';
  f.move = move;
  f.t = 0;
  f.hits = [];
  f.hitsAt = -1;
  f.buf = 0;
  aim(s, f, 200);
  emit(s, 'swing', { by: f.slot, move });
}

function land(s, f) {
  f.vh = 0;
  const here = { by: f.slot, x: f.x, z: f.z };
  switch (f.state) {
    case 'jump':
      setState(f, 'idle');
      f.vx = f.vz = 0;
      emit(s, 'land', here);
      break;
    case 'airAttack': {
      const m = MOVES[f.move];
      if (m && m.crash) {
        // The body press: everyone close by on the floor goes down.
        for (const o of s.f) {
          if (o === f || f.hits.includes(o.slot) || !canBeHit(o) || o.h > 20) continue;
          if (Math.hypot(o.x - f.x, o.z - f.z) > m.crash) continue;
          f.hits.push(o.slot);
          applyHit(s, f, o, m, f.x, f.z, f.move);
        }
        emit(s, 'quake', { by: f.slot, x: f.x, z: f.z, r: m.crash });
      }
      const special = f.move in AIR_MOVES;
      setState(f, 'land');
      f.stun = f.move === 'stomp' ? STOMP.rest : special ? 12 : 4;
      f.vx = f.vz = 0;
      emit(s, f.move === 'stomp' || f.move === 'bodyPress' ? 'stompLand' : 'land', here);
      f.move = null;
      break;
    }
    case 'attack': { // a rising special or a finisher's leap coming back down
      const m = MOVES[f.move];
      if (m && m.crash) {
        // The crash: everyone close by on the floor is knocked off their feet.
        for (const o of s.f) {
          if (o === f || f.hits.includes(o.slot) || !canBeHit(o) || o.h > 20) continue;
          if (Math.hypot(o.x - f.x, o.z - f.z) > m.crash) continue;
          f.hits.push(o.slot);
          applyHit(s, f, o, m, f.x, f.z, 'super');
        }
        emit(s, 'crash', { by: f.slot, x: f.x, z: f.z, r: m.crash, move: f.move });
      } else emit(s, 'land', here);
      f.move = null;
      setState(f, 'land');
      f.stun = 14;
      f.vx = f.vz = 0;
      break;
    }
    case 'down':
      f.stun = DOWN_TICKS;
      f.teched = false;
      f.juggle = 0;
      emit(s, 'thud', here);
      break;
    case 'ko':
      emit(s, 'thud', here);
      break;
    default:
      break;
  }
}

function physics(s, f) {
  if (f.state === 'held') return; // carried by the thrower (see carryThrow)
  const wasAir = f.h > 0 || f.vh > 0;
  f.x += f.vx;
  f.z += f.vz;
  if (wasAir) {
    f.vh -= GRAVITY;
    f.h += f.vh;
    if (f.h <= 0) {
      f.h = 0;
      land(s, f);
    }
  } else if (f.state === 'hit' || f.state === 'down' || f.state === 'ko' || f.state === 'land' || (f.state === 'block' && f.stun > 0)) {
    f.vx *= FRICTION;
    f.vz *= FRICTION;
    if (Math.abs(f.vx) < 0.15) f.vx = 0;
    if (Math.abs(f.vz) < 0.15) f.vz = 0;
  }
}

// Nobody leaves the ring. A fighter who is knocked into its edge is scorched
// by the ring of fire and bounced back in.
function keepInside(s, f) {
  const limit = s.ringR - BODY_R;
  const r = Math.hypot(f.x, f.z);
  if (r <= limit) return;
  const nx = f.x / r;
  const nz = f.z / r;
  f.x = nx * limit;
  f.z = nz * limit;
  const outward = f.vx * nx + f.vz * nz;
  const flung = f.state === 'hit' || f.state === 'down';
  if (flung && outward > SPLAT.speed && s.phase === 'fight' && !f.scorched) {
    f.scorched = true; // once per knockback
    f.vx -= nx * outward * 1.7;
    f.vz -= nz * outward * 1.7;
    f.hp = Math.max(1, f.hp - SPLAT.dmg); // the fire hurts but never finishes a fighter
    const bounce = f.state === 'down';
    if (bounce) {
      // Flung back towards the middle, as hard as they came in.
      f.vx = -nx * (outward + 2);
      f.vz = -nz * (outward + 2);
      f.vh = Math.max(f.vh, BOUNCE.vh);
      f.h = Math.max(f.h, 1);
      f.juggle = Math.max(f.juggle || 0, 1);
    } else f.stun += BOUNCE.stun;
    emit(s, 'burn', { slot: f.slot, x: f.x, z: f.z, dmg: SPLAT.dmg, bounce });
  }
}

const isSolid = (f) => f.state !== 'down' && f.state !== 'ko' && f.state !== 'getup' && f.state !== 'held' && f.state !== 'throw';

// Fighters cannot stand inside each other. If one of them is backed against
// the edge of the ring, the other gives way instead.
function separate(s, a, b) {
  if (!isSolid(a) || !isSolid(b)) return;
  if (Math.abs(a.h - b.h) > 90) return; // one is jumping over the other
  const split = (p, q, share) => {
    let dx = q.x - p.x;
    let dz = q.z - p.z;
    let d = Math.hypot(dx, dz);
    const overlap = BODY_R * 2 - d;
    if (overlap <= 0) return;
    if (d < 0.001) {
      dx = p.slot < q.slot ? 1 : -1; // exactly on top of each other: split sideways
      dz = 0;
      d = 1;
    }
    p.x -= (dx / d) * overlap * (1 - share);
    p.z -= (dz / d) * overlap * (1 - share);
    q.x += (dx / d) * overlap * share;
    q.z += (dz / d) * overlap * share;
  };
  split(a, b, 0.5);
  // Whoever ended up outside the ring is put back, and the other takes the
  // whole correction.
  for (const [p, q] of [[a, b], [b, a]]) {
    if (Math.hypot(p.x, p.z) > s.ringR - BODY_R) {
      keepInside(s, p);
      split(p, q, 1);
    }
  }
}

function canBeHit(f) {
  // Both fighters in a throw can be hit by others: grabbing in a crowd is a
  // risk, and being thrown is no shelter. A hit on either ends the throw.
  // A fighter on the way down from a launcher can still be juggled.
  const juggled = f.state === 'down' && f.h > 0 && f.juggle > 0;
  return f.inv <= 0 && (f.state !== 'down' || juggled) && f.state !== 'getup' && f.state !== 'ko';
}

// Is `def` inside the wedge of `att`'s current attack?
function inWedge(att, def, m) {
  const dx = def.x - att.x;
  const dz = def.z - att.z;
  const d = Math.hypot(dx, dz);
  if (d > m.reach + BODY_R) return false;
  if (att.h + m.y1 < def.h || att.h + m.y0 > def.h + BODY_H) return false;
  return d < BODY_R || m.arc >= Math.PI || angleDiff(Math.atan2(dz, dx), att.dir) <= m.arc;
}

function activeMove(f) {
  if (f.state === 'attack') {
    const m = MOVES[f.move];
    if (!m.reach || f.t < m.startup || f.t >= m.startup + m.active) return null;
    return m;
  }
  if (f.state === 'airAttack') {
    const m = MOVES[f.move];
    return !m.reach || f.t < m.startup ? null : m;
  }
  return null;
}

// Last stand: a fighter under a quarter of their health fills the energy bar
// half as fast again, so the one behind gets a special or a finisher sooner
// and a round is not over before it is over.
const LAST_STAND = { below: 0.25, gain: 1.5 };
const lastStand = (f) => f.hp > 0 && f.hp < f.maxHp * LAST_STAND.below;

function addMeter(f, amount) {
  f.meter = Math.min(RULES.METER_MAX, f.meter + amount * (lastStand(f) ? LAST_STAND.gain : 1));
}

// Apply one connected attack. (fromX, fromZ) is where the blow comes from,
// which decides the push direction and whether the defender's guard faces it.
function applyHit(s, att, def, m, fromX, fromZ, kind) {
  let dx = def.x - fromX;
  let dz = def.z - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 0.001) {
    dx = Math.cos(att.dir);
    dz = Math.sin(att.dir);
  } else {
    dx /= d;
    dz /= d;
  }
  const blocked = !m.unblockable && def.state === 'block' && angleDiff(def.dir, Math.atan2(-dz, -dx)) <= BLOCK_ARC;
  const power = getFighter(att.char).stats.power * att.pw;
  const at = { x: def.x - dx * 14, z: def.z - dz * 14, h: def.h + (m.y1 < 60 ? 30 : 105) };

  if (blocked && def.guard > 0) {
    // Perfect guard: nothing gets through, and a heavy blow thrown from the
    // ground bounces off and leaves its owner open.
    def.guard = 0;
    def.deflect = 14;
    def.stun = 3;
    addMeter(def, GUARD.gain);
    const stagger = !!m.heavy && kind !== 'bolt' && kind !== 'super' && att.h <= 0 && !isOut(att);
    if (stagger) {
      att.state = 'hit';
      att.t = 0;
      att.move = null;
      att.buf = 0;
      att.stun = GUARD.stagger;
      att.reel = GUARD.stagger;
      att.vx = -dx * 5;
      att.vz = -dz * 5;
    }
    if (s.f.length === 2) s.hitstop = 8;
    else att.stop = def.stop = 5;
    emit(s, 'parry', { by: def.slot, on: att.slot, ...at, stagger });
    return;
  }
  if (blocked && m.breaks) {
    // The guard is broken: no damage gets through, but the one behind it is
    // left reeling, arms flung wide, open to the next blow.
    def.state = 'hit';
    def.t = 0;
    def.move = null;
    def.buf = 0;
    def.stun = CHARGE.reel;
    def.reel = CHARGE.reel;
    def.vx = dx * 6;
    def.vz = dz * 6;
    if (s.f.length === 2) s.hitstop = 9;
    else att.stop = def.stop = 6;
    emit(s, 'guardBreak', { by: att.slot, on: def.slot, ...at });
    return;
  }
  if (blocked) {
    const chip = Math.max(1, Math.round(m.dmg * power * (m.chip ?? 0.15)));
    def.hp = Math.max(1, def.hp - chip); // a blocked hit never knocks out
    def.stun = m.blockstun;
    def.vx = dx * m.push * 0.8;
    def.vz = dz * m.push * 0.8;
    addMeter(att, m.gain * 0.5);
    addMeter(def, m.gain * 0.5);
    if (s.f.length === 2) s.hitstop = 3;
    emit(s, 'block', { by: att.slot, on: def.slot, ...at, dmg: chip });
    return;
  }

  // A finisher that has landed is not broken by anyone but its victim (or
  // by another finisher): the others' blows hurt, but the chain goes on, and
  // a throw finds no hold. A blow that would knock out still does.
  if (def.state === 'attack' && MOVES[def.move]?.ult && def.ultOn >= 0 && def.ultOn !== att.slot && kind !== 'super') {
    if (kind === 'grab') return;
    const dmg = Math.max(1, Math.round(m.dmg * power));
    if (dmg < def.hp) {
      const wasStanding = lastStand(def);
      def.hp -= dmg;
      if (!wasStanding && lastStand(def)) emit(s, 'lastStand', { slot: def.slot });
      addMeter(att, m.gain);
      if (att.state === 'attack') att.landed = (att.landed || 0) + 1;
      att.stop = 3;
      emit(s, 'armour', { by: def.slot, from: att.slot, ...at, dmg, first: def.shrug++ === 0 });
      return;
    }
  }

  // A grab that connects seizes the rival: the throw itself (carryThrow)
  // lands the blow on the slam.
  if (kind === 'grab' && att.state === 'attack' && def.h <= 0) {
    att.state = 'throw';
    att.t = 0;
    att.move = null;
    att.held = def.slot;
    def.state = 'held';
    def.t = 0;
    def.move = null;
    def.buf = 0;
    def.stun = 0;
    if (s.f.length === 2) s.hitstop = 4;
    emit(s, 'seize', { by: att.slot, on: def.slot, x: def.x, z: def.z, h: 90 });
    return;
  }

  // A rival struck while being carried is torn loose: the thrower lets go.
  if (def.state === 'held') {
    const thrower = s.f.find((o) => o.held === def.slot);
    if (thrower) {
      thrower.held = -1;
      setState(thrower, 'idle');
    }
  }
  // A thrower who is hit lets go: the rival drops to the floor unhurt.
  if (def.state === 'throw' && def.held >= 0) {
    const dropped = s.f[def.held];
    def.held = -1;
    if (dropped && dropped.state === 'held') {
      dropped.state = 'down';
      dropped.t = 0;
      dropped.stun = DOWN_TICKS;
      dropped.vh = 0;
    }
  }

  if (att.state === 'attack') att.landed = (att.landed || 0) + 1; // a blow that got through
  if (m.ult && att.state === 'attack') att.ultOn = def.slot; // the finisher has its victim
  const juggled = def.state === 'down'; // struck in the air after a launcher
  // Caught winding up? (Checked before the hit wipes out their move.)
  const wound = def.state === 'attack' && MOVES[def.move];
  const counter = !!wound && def.t < wound.startup;
  def.taken++;
  def.reel = 0;
  def.scorched = false;
  const scale = m.noScale ? 1 : Math.max(0.5, 1 - 0.12 * (def.taken - 1)); // long combos hit softer
  const soft = att.cancelled && att.state === 'attack' ? CANCEL_DMG : 1;
  const dmg = Math.max(1, Math.round(m.dmg * power * scale * soft * (counter ? COUNTER.dmg : 1)));
  const dealt = Math.min(dmg, def.hp); // a finishing blow cannot take more than is left
  const wasStanding = lastStand(def);
  // A finisher's flurry never knocks out: that is left to its last blow.
  def.hp = Math.max(m.ult && m.light ? Math.min(1, def.hp) : 0, def.hp - dmg);
  if (!wasStanding && lastStand(def)) emit(s, 'lastStand', { slot: def.slot });
  addMeter(att, m.gain);
  addMeter(def, m.gain * 0.6 + dmg * 0.4);
  def.move = null;
  def.buf = 0;
  if (m.turn && def.hp > 0) def.dir += Math.PI; // spun round: back to the attacker
  const big = kind === 'super' && !m.light;

  if (def.hp <= 0) {
    def.state = 'ko';
    def.t = 0;
    def.vh = 9.5;
    def.vx = dx * 6;
    def.vz = dz * 6;
    def.koBy = kind;
    def.outAt = s.tick;
    emit(s, 'out', { slot: def.slot, by: att.slot });
  } else if ((m.knockdown && soft === 1) || def.h > 0) {
    def.state = 'down';
    def.t = 0;
    def.stun = DOWN_TICKS;
    def.vh = m.launch || m.bounce || (big ? 10 : juggled ? 6.5 : 7.5);
    const away = m.launch ? 1.2 : big ? 8 : 5; // a launcher keeps them close to chase
    def.vx = dx * away;
    def.vz = dz * away;
    // A launcher opens a juggle; a stomp bounces its victim off the floor
    // for one blow more.
    def.juggle = m.launch ? JUGGLE : m.bounce ? 1 : juggled ? def.juggle - 1 : 0;
  } else {
    def.state = 'hit';
    def.t = 0;
    def.stun = soft === 1 ? m.hitstun : 16; // a cancelled special staggers instead of flooring
    def.vx = dx * m.push;
    def.vz = dz * m.push;
  }
  // The impact of a hit freezes the action for a beat. In a duel the whole
  // world stops; in a brawl only the two fighters involved do, so the others
  // are not made to stutter (the finisher still stops everyone).
  const extra = counter ? COUNTER.stop : 0;
  if (s.f.length === 2) s.hitstop = (big ? 12 : m.heavy ? 7 : 4) + extra;
  else if (big) s.hitstop = 6;
  else att.stop = def.stop = (m.heavy ? 5 : 3) + extra;
  // A finisher's last blow: the world holds still a moment longer while the
  // camera closes in on it.
  if (m.final && !s.finale) {
    s.hitstop = s.f.length === 2 ? FINALE.stop : FINALE.stop / 2;
    s.finale = FINALE.ticks;
    s.finaleOn = def.slot;
  }
  emit(s, 'hit', { by: att.slot, on: def.slot, ...at, dmg, dealt, heavy: !!m.heavy, kind, combo: def.taken, counter, juggle: juggled, light: !!m.light, stage: m.ult ? att.move : undefined, final: !!m.final });
}

function resolveHits(s) {
  // Work out every hit first, then apply them, so fighters who strike on the
  // same tick all get hit (a "trade") instead of the lower slot always winning.
  const pending = [];
  for (const att of s.f) {
    const m = activeMove(att);
    if (!m) continue;
    for (const def of s.f) {
      if (def === att || att.hits.includes(def.slot) || !canBeHit(def)) continue;
      if (inWedge(att, def, m)) pending.push({ att, def, m, x: att.x, z: att.z, kind: m.ult ? 'super' : att.move });
    }
  }
  for (const p of pending) p.att.hits.push(p.def.slot);
  for (const p of pending) if (canBeHit(p.def) || p.def.state === 'ko') applyHitOnce(s, p);

  // Projectiles.
  for (const p of s.proj) {
    p.x += p.vx;
    p.z += p.vz;
    if (p.vh) {
      // Thrown from the air: it flies down until it meets the floor.
      p.h += p.vh;
      if (p.h <= PROJECTILE.r) {
        p.dead = true;
        emit(s, 'clash', { x: p.x, z: p.z, h: 10 });
      }
    }
    if (--p.life <= 0 || Math.hypot(p.x, p.z) > s.ringR + 40) p.dead = true;
  }
  for (let i = 0; i < s.proj.length; i++) {
    for (let j = i + 1; j < s.proj.length; j++) {
      const p = s.proj[i];
      const q = s.proj[j];
      if (!p.dead && !q.dead && p.owner !== q.owner && Math.hypot(p.x - q.x, p.z - q.z) < PROJECTILE.r * 2) {
        p.dead = q.dead = true;
        emit(s, 'clash', { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, h: p.h });
      }
    }
  }
  for (const p of s.proj) {
    if (p.dead) continue;
    for (const def of s.f) {
      if (def.slot === p.owner || !canBeHit(def)) continue;
      if (Math.hypot(def.x - p.x, def.z - p.z) > PROJECTILE.r + BODY_R) continue;
      if (p.h + PROJECTILE.r < def.h || p.h - PROJECTILE.r > def.h + BODY_H) continue;
      p.dead = true;
      applyHit(s, s.f[p.owner], def, p.rain ? RAIN_HIT : p.vh ? AIR_BOLT_HIT : MOVES.bolt, p.x - p.vx * 3, p.z - p.vz * 3, 'bolt');
      break;
    }
  }
  s.proj = s.proj.filter((p) => !p.dead);
}

// A fighter already knocked out by an earlier hit on this same tick is left alone.
function applyHitOnce(s, p) {
  if (p.def.state === 'ko') return;
  applyHit(s, p.att, p.def, p.m, p.x, p.z, p.kind);
}

// Hand out the points for a finished round.
//   Standing fighters come first (the healthier the better), then the fallen,
//   the last to fall first. Fighters who cannot be separated share a place,
//   and a shared place is worth the lowest position in the group - so a tie
//   never crowns a winner.
function scoreRound(s) {
  const n = s.f.length;
  const key = (f) => (isOut(f) ? f.outAt : 1e9 + f.hp / f.maxHp);
  const order = [...s.f].sort((a, b) => key(b) - key(a));
  s.roundPts = s.f.map(() => 0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && key(order[j + 1]) === key(order[i])) j++;
    for (let k = i; k <= j; k++) s.roundPts[order[k].slot] = s.mode === 'duel' ? (j === 0 ? 1 : 0) : n - 1 - j;
    i = j + 1;
  }
  const best = Math.max(...s.roundPts);
  const top = s.roundPts.filter((p) => p === best).length;
  s.winner = best > 0 && top === 1 ? s.roundPts.indexOf(best) : -1;
  for (let k = 0; k < n; k++) s.pts[k] += s.roundPts[k];
}

function endRound(s, kind) {
  s.phase = 'ko';
  s.pt = 0;
  s.koKind = kind;
  s.proj = [];
  s.items = [];
  scoreRound(s);
  const w = s.winner >= 0 ? s.f[s.winner] : null;
  const last = s.f.filter(isOut).sort((a, b) => b.outAt - a.outAt)[0];
  emit(s, kind === 'ko' ? 'ko' : 'timeup', {
    winner: s.winner,
    perfect: !!w && w.hp === w.maxHp,
    finisher: kind === 'ko' && !!last && last.koBy === 'super',
  });
}

function standings(s) {
  const order = s.f.map((f) => ({ slot: f.slot, char: f.char, points: s.pts[f.slot] })).sort((a, b) => b.points - a.points);
  order.forEach((r, i) => {
    r.rank = i > 0 && order[i - 1].points === r.points ? order[i - 1].rank : i + 1;
  });
  return order;
}

function endMatch(s) {
  s.phase = 'over';
  s.pt = 0;
  s.ranking = standings(s);
  const leaders = s.ranking.filter((r) => r.rank === 1);
  s.matchWinner = leaders.length === 1 ? leaders[0].slot : -1;
  for (const f of s.f) if (!isOut(f)) setState(f, f.slot === s.matchWinner ? 'win' : s.matchWinner >= 0 ? 'lose' : 'idle');
  emit(s, 'matchEnd', { winner: s.matchWinner });
}

function resetRound(s) {
  const n = s.f.length;
  s.f = s.f.map((old, i) => {
    const f = newFighter(old.char, i, n, s.mods[i]);
    f.meter = old.meter;
    return f;
  });
  s.proj = [];
  s.items = [];
  s.nextItem = ITEMS.first * TICK_RATE;
  s.timer = MODES[s.mode].seconds * TICK_RATE;
  s.ringR = ARENA.R;
  s.phase = 'intro';
  s.pt = 0;
  s.koKind = null;
  s.winner = -1;
}

const canCelebrate = (f) => f.h <= 0 && (f.state === 'idle' || f.state === 'walk' || f.state === 'block');

// Advance the match by one tick. `inputs` holds one button state per fighter.
export function step(s, inputs) {
  s.ev = [];
  s.tick++;
  if (s.finale > 0) s.finale--;
  const fighting = s.phase === 'fight';
  const rules = MODES[s.mode];

  for (const f of s.f) {
    const inp = fighting && !isOut(f) ? inputs[f.slot] | 0 : 0;
    if (fighting) rememberPresses(f, inp, s.hitstop > 0 || s.freeze > 0 || f.stop > 0);
    f.holdK = inp & INPUT.KICK ? (f.holdK || 0) + 1 : 0; // how long kick has been held
    if (fighting && inp & INPUT.JUMP && !(f.prev & INPUT.JUMP)) f.jumpT = AIR_JUMP.buffer;
    else if (f.jumpT > 0) f.jumpT--;
    f.prev = inp;
  }

  // Dramatic pauses: the whole world stops for a few ticks.
  if (s.freeze > 0) {
    s.freeze--;
    return s;
  }
  if (s.hitstop > 0) {
    s.hitstop--;
    return s;
  }

  s.pt++;

  if (s.phase === 'intro') {
    if (s.pt === 1) emit(s, 'round', { round: s.round });
    if (s.pt === TIMING.INTRO_FIGHT_CALL) emit(s, 'fight', {});
    for (const f of s.f) f.t++;
    if (s.pt >= TIMING.INTRO) {
      s.phase = 'fight';
      s.pt = 0;
    }
    return s;
  }

  if (s.phase === 'over') {
    for (const f of s.f) {
      physics(s, f);
      f.t++;
    }
    return s;
  }

  // Slow motion right after the knockout that ends a round: a third of the
  // speed while the beaten fighter falls, then half, then full.
  if (s.phase === 'ko' && s.koKind === 'ko' && ((s.pt < 30 && s.pt % 3 !== 0) || (s.pt >= 30 && s.pt < 66 && s.pt % 2 === 0))) return s;

  // The ring of fire closes in as the clock runs down.
  if (fighting) {
    const shrinkAt = rules.shrinkAt * TICK_RATE;
    const k = Math.min(1, Math.max(0, (shrinkAt - s.timer) / (shrinkAt - 5 * TICK_RATE)));
    s.ringR = ARENA.R - (ARENA.R - ARENA.R_MIN) * k;
  }

  for (const f of s.f) if (f.stop <= 0) control(s, f, f.prev);
  for (const f of s.f) if (f.stop <= 0) physics(s, f);
  for (let i = 0; i < s.f.length; i++) for (let j = i + 1; j < s.f.length; j++) separate(s, s.f[i], s.f[j]);
  for (const f of s.f) keepInside(s, f);

  if (fighting) {
    resolveHits(s);
    updateItems(s);
    for (const f of s.f) if (f.inv > 0) f.inv--;
  }
  for (const f of s.f) {
    if (f.stop > 0) f.stop--;
    else f.t++;
  }

  if (fighting) {
    const standing = s.f.filter((f) => !isOut(f));
    if (standing.length <= 1) {
      endRound(s, 'ko');
    } else if (--s.timer <= 0) {
      s.timer = 0;
      endRound(s, 'time');
    }
    return s;
  }

  // phase === 'ko': the round is decided, let the dust settle.
  if (s.pt > 50) {
    for (const f of s.f) {
      if (isOut(f) || !canCelebrate(f)) continue;
      const mood = f.slot === s.winner ? 'win' : s.koKind === 'time' && s.winner >= 0 ? 'lose' : null;
      if (mood && f.state !== mood) {
        setState(f, mood);
        f.vx = f.vz = 0;
      }
    }
  }
  if (s.pt >= (s.koKind === 'ko' ? TIMING.KO : TIMING.TIMEUP)) {
    const decided = Math.max(...s.pts) >= rules.pointsToWin && s.pts.filter((p) => p >= rules.pointsToWin).length === 1;
    if (decided || s.round >= rules.maxRounds) {
      endMatch(s);
    } else {
      s.round++;
      resetRound(s);
    }
  }
  return s;
}
