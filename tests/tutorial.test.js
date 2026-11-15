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
  const rolled = play(lesson, (s, t) => (t % 40 < 2 ? INPUT.BLOCK | INPUT.LEFT : 0), 300);
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

test('the combo lesson ticks a launcher and a juggle', () => {
  const lesson = LESSONS.find((l) => l.id === 'combos');
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
