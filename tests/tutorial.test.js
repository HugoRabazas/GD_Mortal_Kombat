// The tutorial: every lesson's partner does what the lesson needs, and the
// steps tick off from what really happens in the fight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step } from '../shared/sim.js';
import { INPUT } from '../shared/constants.js';
import { LESSONS, stepsDone, tutorPartner } from '../shared/tutorial.js';

function lessonFight(kind) {
  const s = createMatch(['ruko', 'shadow']);
  while (s.phase !== 'fight') step(s, [0, 0]);
  const partner = tutorPartner(kind);
  return { s, partner };
}

// Play `ticks` ticks with the player's buttons from `me(s, t)`; collect the
// steps of `lesson` that tick off.
function play(lesson, me, ticks) {
  const { s, partner } = lessonFight(lesson.partner);
  const done = new Set();
  for (let t = 0; t < ticks; t++) {
    step(s, [me(s, t), partner(s, 1)]);
    for (const id of stepsDone(lesson, s, s.ev, done)) done.add(id);
    s.timer = 99 * 60; // as in the game: no clock in a lesson
    for (const f of s.f) if (f.hp < 30) f.hp = f.maxHp;
  }
  return done;
}

test('every lesson has steps with a way to tick them off, and unique ids', () => {
  const ids = new Set();
  for (const l of LESSONS) {
    assert.ok(!ids.has(l.id));
    ids.add(l.id);
    assert.ok(l.steps.length >= 2, l.id);
    const stepIds = new Set(l.steps.map((st) => st.id));
    assert.equal(stepIds.size, l.steps.length, l.id);
    for (const st of l.steps) {
      assert.ok(st.ev || st.st, `${l.id}/${st.id}`);
      assert.equal(typeof st.how((x) => `[${x}]`, { walk: 'WASD' }), 'string');
    }
  }
});

test('the getting-up partner throws you down again and again, so you can quick-rise', () => {
  const lesson = LESSONS.find((l) => l.id === 'getup');
  let downs = 0;
  const { s, partner } = lessonFight('floorer');
  let was = '';
  for (let t = 0; t < 1500; t++) {
    step(s, [0, partner(s, 1)]);
    if (s.f[0].state === 'down' && was !== 'down') downs++;
    was = s.f[0].state;
    for (const f of s.f) f.hp = f.maxHp;
  }
  assert.ok(downs >= 3, `thrown ${downs} times`);
  // Holding block on the floor ticks the quick rise; punching while getting up, the sweep.
  const done = play(lesson, (st) => (st.f[0].state === 'down' ? INPUT.BLOCK : st.f[0].state === 'getup' && st.f[0].t >= 5 ? INPUT.PUNCH : 0), 1500);
  assert.ok(done.has('tech'), 'quick rise');
  assert.ok(done.has('riseKick'), 'rising sweep');
});

test('the kicking partner gives you kicks to block and roll through', () => {
  const lesson = LESSONS.find((l) => l.id === 'defence');
  const blocked = play(lesson, () => INPUT.BLOCK, 600);
  assert.ok(blocked.has('block'), 'a kick is blocked');
  const rolled = play(lesson, (s, t) => (t % 40 < 2 ? INPUT.BLOCK | INPUT.UP : 0), 300);
  assert.ok(rolled.has('roll'));
});

test('the guarding partner shows a punch stopped and a throw going through', () => {
  const lesson = LESSONS.find((l) => l.id === 'throws');
  const done = play(lesson, (s, t) => {
    const dx = s.f[1].x - s.f[0].x;
    if (Math.abs(dx) > 56) return dx > 0 ? INPUT.RIGHT : INPUT.LEFT;
    return t < 200 ? (t % 30 === 0 ? INPUT.PUNCH : 0) : t % 30 === 0 ? INPUT.GRAB : 0;
  }, 400);
  assert.ok(done.has('guarded') && done.has('grab'), [...done].join());
});

test('the combo lessons tick a launcher (Combos) and a juggle (Air combos)', () => {
  const both = ['combos', 'aircombos'].map((id) => LESSONS.find((l) => l.id === id));
  const lesson = { ...both[0], steps: both.flatMap((l) => l.steps) };
  const seq = { 0: INPUT.PUNCH, 9: INPUT.PUNCH, 19: INPUT.KICK };
  let pressedAir = false;
  const done = play(lesson, (s, t) => {
    if (t === 0) {
      Object.assign(s.f[0], { x: 0, z: 0, dir: 0 });
      Object.assign(s.f[1], { x: 60, z: 0, dir: Math.PI });
    }
    const me = s.f[0];
    const o = s.f[1];
    let b = seq[t] || 0;
    if (me.move === 'launch' && me.hits.length) b |= INPUT.JUMP;
    if (me.state === 'jump' && o.h > 0 && Math.abs(me.h - o.h) < 60 && !pressedAir) {
      pressedAir = true;
      b |= INPUT.PUNCH;
    }
    return b;
  }, 120);
  assert.ok(done.has('launch') && done.has('juggle'), [...done].join());
});

// ------------------------------------------------- every step, played ---
// A scripted player for each step, against that lesson's own partner: if a
// step cannot be done this way, a person cannot be expected to do it either.
const toward = (s, near) => {
  const dx = s.f[1].x - s.f[0].x;
  const dz = s.f[1].z - s.f[0].z;
  const d = Math.hypot(dx, dz);
  if (d <= near) return 0;
  let b = 0;
  if (dx / d > 0.38) b |= INPUT.RIGHT;
  if (dx / d < -0.38) b |= INPUT.LEFT;
  if (dz / d > 0.38) b |= INPUT.DOWN;
  if (dz / d < -0.38) b |= INPUT.UP;
  return b;
};
const gap = (s) => Math.hypot(s.f[1].x - s.f[0].x, s.f[1].z - s.f[0].z);
// A routine that repeats every `every` ticks once in place (within `near`).
const routine = (near, every, at) => {
  let t0 = -1;
  return (s, t) => {
    const me = s.f[0];
    if (t0 < 0) {
      const b = toward(s, near);
      if (b || me.state !== 'idle') return b; // (stop first: a jump out of a walk is a running jump)
      t0 = t;
    }
    const k = (t - t0) % every;
    if (k === every - 1) t0 = -1; // walk back into place for the next go
    return at(k, s) || 0;
  };
};
// Run up from a distance, then act (`at(k)` with k ticks since the run began).
const runUp = (at) => {
  let t0 = -1;
  return (s, t) => {
    if (t0 < 0 || t - t0 > 70) {
      // Back off to a run-up distance first.
      if (gap(s) < 200) {
        const b = toward(s, 0);
        return ((b & INPUT.RIGHT) ? INPUT.LEFT : 0) | ((b & INPUT.LEFT) ? INPUT.RIGHT : 0) | ((b & INPUT.UP) ? INPUT.DOWN : 0) | ((b & INPUT.DOWN) ? INPUT.UP : 0);
      }
      t0 = t;
    }
    return at(t - t0, s);
  };
};
const runIn = (near, at) => {
  let hit = -1;
  return runUp((k, s) => {
    if (hit < 0) {
      if (k >= 9 && gap(s) < near) hit = k;
      else return toward(s, 0);
    }
    return at(k - hit, s);
  });
};
const BOTS = {
  walk: () => () => INPUT.RIGHT,
  jump: () => (s, t) => (t % 40 === 0 ? INPUT.JUMP : 0),
  combo: () => routine(55, 50, (k) => (k === 0 || k === 9 || k === 18 ? INPUT.PUNCH : 0)),
  kick: () => routine(80, 40, (k) => (k === 0 ? INPUT.KICK : 0)),
  block: () => () => INPUT.BLOCK,
  perfect: () => (s) => (s.f[1].state === 'attack' && s.f[1].move === 'kick' && s.f[1].t >= 4 ? INPUT.BLOCK : 0),
  riposte: () => (s) => (s.f[0].rip > 0 ? INPUT.PUNCH : s.f[1].state === 'attack' && s.f[1].move === 'kick' && s.f[1].t >= 4 ? INPUT.BLOCK : 0),
  roll: () => (s, t) => (t % 40 < 2 ? INPUT.BLOCK | INPUT.UP : 0),
  backstep: () => (s, t) => (t % 40 < 2 ? INPUT.BLOCK | (s.f[1].x > s.f[0].x ? INPUT.LEFT : INPUT.RIGHT) : 0),
  tech: () => (s) => (s.f[0].state === 'down' ? INPUT.BLOCK : 0),
  escape: () => (s) => (s.f[0].state === 'held' ? INPUT.GRAB : 0),
  wakeRoll: () => (s) => (s.f[0].state === 'getup' ? INPUT.BLOCK | INPUT.UP : 0),
  riseKick: () => (s) => (s.f[0].state === 'getup' && s.f[0].t >= 5 ? INPUT.PUNCH : 0),
  guarded: () => routine(60, 30, (k) => (k === 0 ? INPUT.PUNCH : 0)),
  grab: () => routine(50, 40, (k) => (k === 0 ? INPUT.GRAB : 0)),
  signature: () => (s, t) => (gap(s) > 120 ? (t % 40 === 0 ? INPUT.GRAB : 0) : t % 2 ? (s.f[1].x > s.f[0].x ? INPUT.LEFT : INPUT.RIGHT) : 0),
  breaker: () => routine(85, 60, (k) => (k < 25 ? INPUT.KICK : 0)),
  // Run in, and strike once close enough (`at` ticks after reaching `near`).
  lunge: () => runIn(150, (k, s) => (k === 0 ? toward(s, 0) | INPUT.PUNCH : 0)),
  slide: () => runIn(130, (k, s) => (k === 0 ? toward(s, 0) | INPUT.KICK : 0)),
  flyKnee: () => runIn(210, (k, s) => (k === 0 ? toward(s, 0) | INPUT.JUMP : k === 3 ? INPUT.KICK : 0)),
  jump2: () => (s, t) => (t % 60 === 0 || t % 60 === 12 ? INPUT.JUMP : 0),
  airPunch: () => routine(70, 60, (k, s) => (k === 0 ? INPUT.JUMP | toward(s, 0) : k === 10 ? INPUT.PUNCH : 0)),
  airKick: () => routine(80, 60, (k, s) => (k === 0 ? INPUT.JUMP | toward(s, 0) : k === 8 ? INPUT.KICK : 0)),
  stomp: () => routine(55, 60, (k) => (k === 0 ? INPUT.JUMP : k === 12 ? INPUT.GRAB : 0)),
  launch: () => routine(55, 70, (k) => (k === 0 || k === 9 ? INPUT.PUNCH : k === 19 ? INPUT.KICK : 0)),
  juggle: () => {
    let air = false;
    const r = routine(55, 90, (k) => (k === 0 || k === 9 ? INPUT.PUNCH : k === 19 ? INPUT.KICK : 0));
    return (s, t) => {
      const me = s.f[0];
      const o = s.f[1];
      if (me.move === 'launch' && me.hits.length) {
        air = false;
        return INPUT.JUMP;
      }
      if (me.state === 'jump' && o.h > 0 && Math.abs(me.h - o.h) < 60 && !air) {
        air = true;
        return INPUT.PUNCH;
      }
      return me.state === 'jump' || me.state === 'airAttack' ? 0 : r(s, t);
    };
  },
  kick2: () => routine(80, 50, (k) => (k === 0 || k === 11 ? INPUT.KICK : 0)),
  elbow: () => routine(80, 50, (k) => (k === 0 ? INPUT.KICK : k === 11 ? INPUT.PUNCH : 0)),
  burn: () => routine(85, 60, (k) => (k === 0 ? INPUT.KICK : 0)),
  fireToss: () => routine(50, 60, (k) => (k === 0 ? INPUT.GRAB : 0)),
  airThrow: () => {
    // Like the juggle, but the grab in the air once level with them.
    let air = false;
    const r = routine(55, 90, (k) => (k === 0 || k === 9 ? INPUT.PUNCH : k === 19 ? INPUT.KICK : 0));
    return (s, t) => {
      const me = s.f[0];
      const o = s.f[1];
      if (me.move === 'launch' && me.hits.length) {
        air = false;
        return INPUT.JUMP;
      }
      if (me.state === 'jump' && o.h > 25 && Math.abs(me.h - o.h) < 60 && !air) {
        air = true;
        return INPUT.GRAB;
      }
      return me.state === 'jump' || me.state === 'airAttack' ? 0 : r(s, t);
    };
  },
  backfist: () => routine(55, 60, (k) => (k === 0 ? INPUT.PUNCH : k === 9 ? INPUT.KICK : k === 20 ? INPUT.PUNCH : 0)),
  hook: () => routine(55, 50, (k) => (k === 0 ? INPUT.PUNCH : k === 9 ? INPUT.KICK : 0)),
  hammer: () => routine(70, 60, (k, s) => (k === 0 ? INPUT.JUMP | toward(s, 0) : k === 10 ? INPUT.KICK : k === 17 ? INPUT.PUNCH : 0)),
  axeKick: () => routine(70, 60, (k, s) => (k === 0 ? INPUT.JUMP | toward(s, 0) : k === 10 ? INPUT.PUNCH : k === 16 ? INPUT.KICK : 0)),
  counter: () => (s) => (s.f[1].state === 'attack' && s.f[1].move === 'kick' && s.f[1].t <= 2 && gap(s) < 100 ? INPUT.PUNCH : 0),
  rollUpper: () => (s, t) => (t % 50 < 2 ? INPUT.BLOCK | INPUT.UP : s.f[0].state === 'roll' && s.f[0].t >= 7 ? INPUT.PUNCH : 0),
  rollSpin: () => (s, t) => (t % 50 < 2 ? INPUT.BLOCK | INPUT.UP : s.f[0].state === 'roll' && s.f[0].t >= 7 ? INPUT.KICK : 0),
  special: () => (s, t) => (t % 60 === 0 ? INPUT.SPECIAL : 0),
  airSpecial: () => (s, t) => (t % 60 === 0 ? INPUT.JUMP : t % 60 === 8 ? INPUT.SPECIAL : 0),
  cancel: () => routine(55, 70, (k) => (k === 0 ? INPUT.PUNCH : k === 5 ? INPUT.SPECIAL : 0)),
  taunt: () => (s, t) => INPUT.BLOCK | (t % 30 === 5 ? INPUT.GRAB : 0),
  super: () => (s, t) => (t % 120 === 0 ? INPUT.SUPER : 0),
  final: () => routine(60, 300, (k) => (k === 0 ? INPUT.SUPER : 0)),
};

for (const lesson of LESSONS) {
  test(`every step of the "${lesson.title}" lesson can be done against its partner`, () => {
    for (const st of lesson.steps) {
      assert.ok(BOTS[st.id], `a scripted player for ${st.id}`);
      const { s, partner } = lessonFight(lesson.partner);
      const bot = BOTS[st.id]();
      const done = new Set();
      let t = 0;
      for (; t < 2400 && !done.has(st.id); t++) {
        // As in the game: no clock, health refills, energy only where the lesson gives it.
        s.timer = 99 * 60;
        if (lesson.energy) s.f[0].meter = 100;
        for (const f of s.f) if (f.hp < f.maxHp * 0.4 && f.state !== 'down') f.hp = f.maxHp;
        step(s, [bot(s, t), partner(s, 1)]);
        for (const id of stepsDone(lesson, s, s.ev, done)) done.add(id);
      }
      assert.ok(done.has(st.id), `${lesson.id}/${st.id} not done in ${t} ticks`);
    }
  });
}

test('step ids are unique across lessons (saved progress finds a step that moved lesson)', () => {
  const ids = LESSONS.flatMap((l) => l.steps.map((st) => st.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(LESSONS.every((l) => l.steps.length <= 6), 'every lesson stays short');
});
