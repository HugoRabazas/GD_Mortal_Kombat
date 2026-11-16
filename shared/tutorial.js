// The tutorial: lessons of a few steps each, against a partner who does what
// the lesson needs - stands still, kicks on a beat, holds a guard up, or
// walks up and throws you so you can practise getting up. Each step ticks
// itself off from the fight's own events (or its state), the same way on
// every device. Pure logic, shared with the tests.
import { INPUT } from './constants.js';

// Steps: `ev(e)` is true for an event of the fight that completes the step,
// `st(s)` for a state that does (checked every tick). `how(k, names)` says
// how, with `k(id)` drawing a control's key and `names` the control names.
const hit = (kind) => (e) => e.type === 'hit' && e.by === 0 && e.kind === kind;
const swing = (move) => (e) => e.type === 'swing' && e.by === 0 && e.move === move;
const mine = (type) => (e) => e.type === type && e.by === 0;

export const LESSONS = [
  {
    id: 'basics',
    title: 'Basics',
    partner: 'still',
    steps: [
      { id: 'walk', name: 'Walk', how: (k, n) => (n.walk === 'WASD' ? `${k('W')} ${k('A')} ${k('S')} ${k('D')}` : 'push the stick'), st: (s) => s.f[0].state === 'walk' },
      { id: 'jump', name: 'Jump', how: (k) => k('j'), ev: mine('jump') },
      { id: 'combo', name: 'Three-punch combo', how: (k) => `${k('p')} ${k('p')} ${k('p')} up close, each punch landing`, ev: hit('punch3') },
      { id: 'kick', name: 'Land a kick', how: (k) => `${k('k')}: slower than a punch, longer reach`, ev: hit('kick') },
    ],
  },
  {
    id: 'defence',
    title: 'Defence',
    partner: 'kicker',
    intro: 'Your partner walks up and kicks on a steady beat.',
    steps: [
      { id: 'block', name: 'Block a kick', how: (k) => `hold ${k('b')} as the kick comes`, ev: (e) => e.type === 'block' && e.on === 0 },
      { id: 'perfect', name: 'Perfect guard', how: (k) => `press ${k('b')} just before the kick lands`, ev: mine('parry') },
      { id: 'riposte', name: 'Riposte', how: (k) => `after a perfect guard, ${k('p')} at once: a palm strike while they are still open (${k('k')}: a launcher)`, ev: hit('riposte') },
      { id: 'roll', name: 'Dodge roll', how: (k) => `${k('b')} + a direction sideways or forwards: the kick passes through you`, ev: mine('roll') },
      { id: 'backstep', name: 'Back-step', how: (k) => `${k('b')} + the stick away from the partner: a quick hop back out of reach`, ev: mine('backstep') },
    ],
  },
  {
    id: 'getup',
    title: 'Getting up',
    partner: 'floorer',
    intro: 'Your partner walks up and throws you to the floor, again and again.',
    steps: [
      { id: 'tech', name: 'Quick rise', how: (k) => `${k('b')} while lying on the floor`, ev: mine('tech') },
      { id: 'escape', name: 'Throw escape', how: (k) => `${k('g')} the moment you are seized: the throw is broken`, ev: mine('escape') },
      { id: 'wakeRoll', name: 'Rolling rise', how: (k) => `hold ${k('b')} + a direction as you get up: you roll clear as you rise`, ev: (e) => e.type === 'roll' && e.by === 0 && e.wake },
      { id: 'riseKick', name: 'Rising sweep', how: (k) => `${k('p')} or ${k('k')} while getting up: it cannot be hit as it starts`, ev: swing('riseKick') },
    ],
  },
  {
    id: 'throws',
    title: 'Guards',
    partner: 'blocker',
    intro: 'Your partner keeps a guard up.',
    steps: [
      { id: 'guarded', name: 'Punch the guard', how: (k) => `${k('p')}: a guard stops blows from the front`, ev: (e) => e.type === 'block' && e.by === 0 },
      { id: 'grab', name: 'Throw through the guard', how: (k) => `${k('g')} up close: a throw goes straight through a guard`, ev: mine('seize') },
      { id: 'signature', name: 'Your signature move', how: (k) => `${k('g')} with the partner out of reach: each fighter's own move to cross the gap`, ev: mine('signature') },
      { id: 'taunt', name: 'Taunt', how: (k) => `hold ${k('b')} and press ${k('g')}, standing still: energy, but any blow is a counter hit`, ev: swing('taunt') },
      { id: 'lowSlide', name: 'Under the guard', how: (k) => `walk a few steps, then ${k('k')}: the slide is low and goes under a guard`, ev: (e) => e.type === 'hit' && e.by === 0 && e.kind === 'slide' && e.under },
      { id: 'breaker', name: 'Break the guard', how: (k) => `hold ${k('k')} to charge, let go: the kick smashes the guard open`, ev: mine('guardBreak') },
    ],
  },
  {
    id: 'moving',
    title: 'On the run',
    partner: 'still',
    steps: [
      { id: 'lunge', name: 'Lunging straight', how: (k) => `walk a few steps, then ${k('p')} with the stick still held`, ev: swing('lunge') },
      { id: 'slide', name: 'Slide', how: (k) => `walk a few steps, then ${k('k')}: a sweep along the floor`, ev: hit('slide') },
      { id: 'flyKnee', name: 'Flying knee', how: (k) => `walk a few steps, ${k('j')} with the stick still held, then ${k('k')}`, ev: hit('flyKnee') },
    ],
  },
  {
    id: 'air',
    title: 'In the air',
    partner: 'still',
    steps: [
      { id: 'jump2', name: 'Double jump', how: (k) => `${k('j')}, then ${k('j')} again in the air`, ev: mine('jump2') },
      { id: 'airPunch', name: 'Diving punch', how: (k) => `${k('p')} in the air, near the partner`, ev: hit('airPunch') },
      { id: 'airKick', name: 'Flying kick', how: (k) => `from a standstill, ${k('j')} then ${k('k')} in the air`, ev: hit('airKick') },
      { id: 'stomp', name: 'Stomp', how: (k) => `${k('g')} in the air, right above the partner`, ev: hit('stomp') },
    ],
  },
  {
    id: 'combos',
    title: 'Combos',
    partner: 'still',
    steps: [
      { id: 'launch', name: 'Launcher', how: (k) => `${k('p')} ${k('p')} ${k('k')}: the kick throws the partner up`, ev: hit('launch') },
      { id: 'kick2', name: 'Kick string', how: (k) => `${k('k')} ${k('k')}: a kick that lands flows into a roundhouse`, ev: hit('kick2') },
      { id: 'elbow', name: 'Kick, elbow', how: (k) => `${k('k')} ${k('p')}: a kick that lands flows into a stepping elbow - then ${k('p')} floors, ${k('k')} launches`, ev: hit('elbow') },
      { id: 'hook', name: 'Hook kick', how: (k) => `${k('p')} ${k('k')}: the kick spins the partner round`, ev: hit('hook') },
      { id: 'backfist', name: 'Spinning backfist', how: (k) => `${k('p')} ${k('k')} ${k('p')}: with their back turned, a backfist floors them`, ev: hit('backfist') },
    ],
  },
  {
    id: 'aircombos',
    title: 'Air combos',
    partner: 'still',
    energy: true,
    intro: 'Your energy bar stays full in this lesson.',
    steps: [
      { id: 'juggle', name: 'Juggle', how: (k) => `after the launcher, hold ${k('j')} to jump after them and ${k('p')} in the air`, ev: (e) => e.type === 'hit' && e.by === 0 && e.juggle },
      { id: 'airThrow', name: 'Air throw', how: (k) => `after the launcher, hold ${k('j')} to jump after them, then ${k('g')}: seized in the air and driven into the floor`, ev: hit('airThrow') },
      { id: 'hammer', name: 'Hammer fist', how: (k) => `${k('j')}, ${k('k')} in the air and, once it lands, ${k('p')}: they bounce off the floor`, ev: hit('hammer') },
      { id: 'axeKick', name: 'Air string', how: (k) => `${k('j')}, ${k('p')} in the air and, once it lands, ${k('k')}: an axe kick`, ev: hit('axeKick') },
      { id: 'exAir', name: 'EX air special', how: (k) => `${k('j')}, then ${k('s')} and ${k('p')} together in the air: the air special, stronger, and it shrugs off a blow`, ev: (e) => e.type === 'special' && e.by === 0 && e.ex && ['airDash', 'airBolt', 'bodyPress', 'airSpiral'].includes(e.move) },
    ],
  },
  {
    id: 'counters',
    title: 'Counters',
    partner: 'kicker',
    intro: 'Your partner walks up and kicks on a steady beat.',
    steps: [
      { id: 'counter', name: 'Counter hit', how: (k) => `${k('p')} while the partner winds up the kick`, ev: (e) => e.type === 'hit' && e.by === 0 && e.counter },
      { id: 'rollUpper', name: 'Uppercut out of a roll', how: (k) => `${k('b')} + a direction sideways, then ${k('p')} late in the roll`, ev: swing('rollUpper') },
      { id: 'rollSpin', name: 'Spinning heel kick', how: (k) => `${k('b')} + a direction sideways, then ${k('k')} late in the roll`, ev: swing('rollSpin') },
    ],
  },
  {
    id: 'ring',
    title: 'Fire',
    partner: 'edger',
    intro: 'Your partner waits by the ring of fire.',
    steps: [
      { id: 'burn', name: 'Into the flames', how: (k) => `${k('k')} with the partner between you and the fire: a blow that drives them in burns them`, ev: (e) => e.type === 'burn' && e.slot === 1 },
      { id: 'fireToss', name: 'Fire toss', how: (k) => `${k('g')} up close, the fire beyond them: flung into the flames, not over your head`, ev: mine('fireToss') },
    ],
  },
  {
    id: 'specials',
    title: 'Specials',
    partner: 'still',
    energy: true,
    intro: 'Your energy bar stays full in this lesson.',
    steps: [
      { id: 'special', name: 'Special move', how: (k) => `${k('s')}: costs a third of the energy bar`, ev: mine('special') },
      { id: 'airSpecial', name: 'Air special', how: (k) => `${k('j')}, then ${k('s')} in the air: your special's own air version`, ev: (e) => e.type === 'special' && e.by === 0 && ['airDash', 'airBolt', 'bodyPress', 'airSpiral'].includes(e.move) },
      { id: 'exSpecial', name: 'EX special', how: (k) => `${k('s')} and ${k('p')} together, with two thirds of the bar: stronger, and it shrugs off a blow as it starts`, ev: (e) => e.type === 'special' && e.by === 0 && e.ex },
      { id: 'cancel', name: 'Special cancel', how: (k) => `${k('p')} up close and, as it lands, ${k('s')}: the special comes out at once`, ev: (e) => e.type === 'special' && e.by === 0 && e.cancel },
      { id: 'super', name: 'Finisher', how: (k) => `${k('u')} with a full bar`, ev: mine('super') },
      { id: 'final', name: 'Land the finisher', how: (k) => `${k('u')} close to the partner, all the way to its last blow`, ev: (e) => e.type === 'hit' && e.by === 0 && e.final },
    ],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id);

// Which steps of a lesson does this tick complete? (ids, not yet in `done`)
export function stepsDone(lesson, s, events, done) {
  const out = [];
  for (const step of lesson.steps) {
    if (done.has(step.id)) continue;
    if ((step.st && step.st(s)) || (step.ev && events.some(step.ev))) out.push(step.id);
  }
  return out;
}

// ------------------------------------------------------------- partners ---

// Turn a direction into stick bits.
function walk(dx, dz) {
  const d = Math.hypot(dx, dz) || 1;
  let bits = 0;
  if (dx / d < -0.38) bits |= INPUT.LEFT;
  if (dx / d > 0.38) bits |= INPUT.RIGHT;
  if (dz / d < -0.38) bits |= INPUT.UP;
  if (dz / d > 0.38) bits |= INPUT.DOWN;
  return bits;
}

// A partner who kicks on a steady beat, so guards, perfect guards and rolls
// can be practised against a known rhythm. It stands on the outer side of
// the player, so every kick pushes them towards the middle of the arena and
// never into the ring of fire. The beat is counted in real ticks (hit pauses
// included), so it stays steady to the ear.
export const BEAT = 100;
export function drummer() {
  let beat = BEAT;
  return (s, slot) => {
    const me = s.f[slot];
    const you = s.f[0];
    if (beat > 0) beat--;
    const r = Math.hypot(you.x, you.z);
    const gap = Math.hypot(you.x - me.x, you.z - me.z) || 1;
    // Away from the middle, take the outer side; near it, any side will do.
    const out = r > 150;
    const vx = out ? you.x / r : (me.x - you.x) / gap;
    const vz = out ? you.z / r : (me.z - you.z) / gap;
    if (out && ((me.x - you.x) * vx + (me.z - you.z) * vz) / gap < 0.5) {
      // Not on the outer side yet: walk round the player, not into them.
      const sgn = (me.x - you.x) * -vz + (me.z - you.z) * vx >= 0 ? 1 : -1;
      return walk(you.x - vz * sgn * 115 + vx * 95 - me.x, you.z + vx * sgn * 115 + vz * 95 - me.z);
    }
    let tx = you.x + vx * 80;
    let tz = you.z + vz * 80;
    const limit = s.ringR - 50;
    const tr = Math.hypot(tx, tz);
    const clamped = tr > limit;
    if (clamped) {
      tx *= limit / tr;
      tz *= limit / tr;
    }
    const there = Math.hypot(tx - me.x, tz - me.z) < 20 || (clamped && gap < 105);
    if (!there) return walk(tx - me.x, tz - me.z);
    // Never kick a player towards the fire from the inside.
    const inside = (me.x - you.x) * you.x + (me.z - you.z) * you.z < 0;
    const risky = inside && r > s.ringR - 160;
    if (beat === 0 && gap < 105 && !risky && (me.state === 'idle' || me.state === 'walk')) {
      beat = BEAT;
      return INPUT.KICK;
    }
    return 0;
  };
}

// A partner who walks up to a standing player and throws them, then waits
// for them to get up and stand a moment before the next throw.
export const REST = 90;
export function floorer() {
  let rest = 40;
  return (s, slot) => {
    const me = s.f[slot];
    const you = s.f[0];
    const standing = you.state === 'idle' || you.state === 'walk' || you.state === 'block';
    if (!standing) {
      rest = REST;
      return 0;
    }
    if (rest > 0) {
      rest--;
      return 0;
    }
    const gap = Math.hypot(you.x - me.x, you.z - me.z);
    if (gap > 58) return walk(you.x - me.x, you.z - me.z);
    if (me.state === 'idle' || me.state === 'walk') {
      rest = REST;
      return INPUT.GRAB;
    }
    return 0;
  };
}

// A partner who walks to the edge of the ring of fire and waits there,
// facing the middle - and walks back to it after every blow.
export function edger() {
  return (s, slot) => {
    const me = s.f[slot];
    if (me.state !== 'idle' && me.state !== 'walk') return 0;
    const tx = s.ringR - 48; // close enough that a kick drives them into it
    if (Math.hypot(tx - me.x, me.z) > 8) return walk(tx - me.x, -me.z);
    return 0;
  };
}

// The partner a lesson asks for, as a controller: (state, slot) -> buttons.
export function tutorPartner(kind) {
  if (kind === 'kicker') return drummer();
  if (kind === 'floorer') return floorer();
  if (kind === 'edger') return edger();
  if (kind === 'blocker') return () => INPUT.BLOCK;
  return () => 0;
}
