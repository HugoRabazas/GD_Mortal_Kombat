import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, MOVES } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { INPUT, RULES, TIMING, ARENA } from '../shared/constants.js';

function startFight(chars = ['ruko', 'shadow']) {
  const s = createMatch(chars);
  while (s.phase !== 'fight') step(s, [0, 0]);
  return s;
}

function run(s, ticks, inputs = [0, 0]) {
  for (let i = 0; i < ticks; i++) step(s, inputs);
}

// Put the two fighters next to each other, facing.
function closeUp(s, gap = 60) {
  s.f[0].x = 400;
  s.f[1].x = 400 + gap;
}

// Press a button for one tick, then run until the dust settles.
function tap(s, bits0, bits1 = 0, after = 40) {
  step(s, [bits0, bits1]);
  run(s, after);
}

test('a match starts with an intro and then lets players fight', () => {
  const s = createMatch(['ruko', 'shadow']);
  assert.equal(s.phase, 'intro');
  const x = s.f[0].x;
  run(s, 30, [INPUT.RIGHT, 0]);
  assert.equal(s.f[0].x, x, 'no movement during the intro');
  run(s, TIMING.INTRO);
  assert.equal(s.phase, 'fight');
  run(s, 10, [INPUT.RIGHT, 0]);
  assert.ok(s.f[0].x > x, 'walks once the fight starts');
});

test('a punch that connects removes health and builds meter', () => {
  const s = startFight();
  closeUp(s);
  tap(s, INPUT.PUNCH);
  assert.ok(s.f[1].hp < s.f[1].maxHp);
  assert.ok(s.f[0].meter > 0);
  assert.equal(s.f[0].hp, s.f[0].maxHp);
});

test('a punch out of range misses', () => {
  const s = startFight();
  tap(s, INPUT.PUNCH);
  assert.equal(s.f[1].hp, s.f[1].maxHp);
});

test('blocking cuts the damage and never knocks out', () => {
  const s = startFight();
  closeUp(s);
  step(s, [INPUT.KICK, INPUT.BLOCK]);
  run(s, 40, [0, INPUT.BLOCK]);
  const chip = s.f[1].maxHp - s.f[1].hp;
  assert.ok(chip > 0 && chip < MOVES.kick.dmg, `chip damage was ${chip}`);

  s.f[1].hp = 1;
  closeUp(s);
  step(s, [INPUT.KICK, INPUT.BLOCK]);
  run(s, 40, [0, INPUT.BLOCK]);
  assert.equal(s.f[1].hp, 1);
  assert.equal(s.phase, 'fight');
});

test('crouching ducks a standing punch but not a kick', () => {
  const s = startFight();
  closeUp(s);
  run(s, 3, [0, INPUT.DOWN]);
  step(s, [INPUT.PUNCH, INPUT.DOWN]);
  run(s, 30, [0, INPUT.DOWN]);
  assert.equal(s.f[1].hp, s.f[1].maxHp, 'punch goes over a crouching fighter');
  step(s, [INPUT.KICK, INPUT.DOWN]);
  run(s, 30, [0, INPUT.DOWN]);
  assert.ok(s.f[1].hp < s.f[1].maxHp, 'kick hits a crouching fighter');
});

test('a sweep knocks the opponent down and they get back up', () => {
  const s = startFight();
  closeUp(s);
  step(s, [INPUT.DOWN | INPUT.KICK, 0]);
  run(s, 14, [INPUT.DOWN, 0]);
  assert.equal(s.f[1].state, 'down');
  run(s, 120);
  assert.equal(s.f[1].state, 'idle');
});

test('specials need meter; the projectile special travels and hits', () => {
  const s = startFight(['shadow', 'ruko']);
  tap(s, INPUT.SPECIAL, 0, 5);
  assert.equal(s.proj.length, 0, 'no meter, no special');
  s.f[0].meter = RULES.SPECIAL_COST;
  tap(s, INPUT.SPECIAL, 0, 20);
  assert.equal(s.proj.length, 1);
  assert.equal(s.f[0].meter, 0);
  run(s, 60);
  assert.equal(s.proj.length, 0);
  assert.ok(s.f[1].hp < s.f[1].maxHp);
});

test('the dash special crosses the gap and knocks down', () => {
  const s = startFight(['ruko', 'shadow']);
  s.f[0].x = 300;
  s.f[1].x = 480;
  s.f[0].meter = RULES.SPECIAL_COST;
  tap(s, INPUT.SPECIAL, 0, 24);
  assert.ok(s.f[1].hp < s.f[1].maxHp);
  assert.equal(s.f[1].state, 'down');
});

test('the finisher uses the whole meter and freezes the action first', () => {
  const s = startFight();
  s.f[0].x = 300;
  s.f[1].x = 520;
  s.f[0].meter = RULES.SUPER_COST;
  step(s, [INPUT.SUPER, 0]);
  assert.equal(s.f[0].meter, 0);
  assert.ok(s.freeze > 0);
  run(s, 90);
  assert.ok(s.f[1].maxHp - s.f[1].hp >= 30);
});

test('fighters cannot walk through each other or leave the arena', () => {
  const s = startFight();
  run(s, 400, [INPUT.RIGHT, INPUT.RIGHT]);
  assert.ok(s.f[1].x <= ARENA.MAX_X);
  assert.ok(s.f[1].x - s.f[0].x >= 47.9);
  run(s, 600, [INPUT.LEFT, INPUT.LEFT]);
  assert.ok(s.f[0].x >= ARENA.MIN_X);
  assert.ok(s.f[1].x - s.f[0].x >= 47.9);
});

test('a knockout awards the round, and two rounds win the match', () => {
  const s = startFight();
  for (let round = 1; round <= 2; round++) {
    while (s.phase !== 'fight') step(s, [0, 0]);
    s.f[1].hp = 1;
    closeUp(s);
    tap(s, INPUT.KICK, 0, 20);
    assert.equal(s.phase, 'ko');
    assert.equal(s.wins[0], round);
    run(s, TIMING.KO + 20);
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.matchWinner, 0);
});

test('when time runs out the healthier fighter takes the round', () => {
  const s = startFight();
  s.f[0].hp = 40;
  s.timer = 3;
  run(s, 5);
  assert.equal(s.phase, 'ko');
  assert.equal(s.koKind, 'time');
  assert.equal(s.winner, 1);
  assert.deepEqual(s.wins, [0, 1]);
});

test('the simulation is deterministic and CPU matches always finish', () => {
  const play = (seed) => {
    const s = createMatch(['ruko', 'shadow']);
    const a = createAI('hard', seed);
    const b = createAI('normal', seed + 7);
    let n = 0;
    while (s.phase !== 'over' && n++ < 60 * 60 * 8) step(s, [aiInput(a, s, 0), aiInput(b, s, 1)]);
    return s;
  };
  const one = play(42);
  const two = play(42);
  assert.equal(one.phase, 'over', 'match finished');
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = play(seed);
    assert.equal(s.phase, 'over');
    for (const f of s.f) {
      assert.ok(Number.isFinite(f.x) && f.x >= ARENA.MIN_X && f.x <= ARENA.MAX_X);
      assert.ok(f.y <= ARENA.FLOOR);
    }
  }
});

test('a boss modifier adds health and power, and survives the round reset', () => {
  const s = createMatch(['shadow', 'ruko'], [null, { health: 1.3, power: 1.5 }]);
  assert.equal(s.f[1].maxHp, 130);
  while (s.phase !== 'fight') step(s, [0, 0]);
  closeUp(s);
  tap(s, 0, INPUT.KICK);
  const boosted = s.f[0].maxHp - s.f[0].hp;
  assert.ok(boosted > MOVES.kick.dmg, `boosted kick did ${boosted}`);
  s.f[0].hp = 1;
  closeUp(s);
  tap(s, 0, INPUT.KICK, 20);
  run(s, TIMING.KO + 20);
  assert.equal(s.round, 2);
  assert.equal(s.f[1].maxHp, 130, 'boss health kept in round 2');
  assert.equal(s.f[1].pw, 1.5);
});
