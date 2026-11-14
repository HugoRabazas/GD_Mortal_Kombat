import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, MOVES } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { FIGHTERS } from '../shared/fighters.js';
import { ARENA, INPUT, RULES, TIMING } from '../shared/constants.js';

const ALL = FIGHTERS.map((f) => f.id);
const idle = (s) => s.f.map(() => 0);

function startFight(chars = ['ruko', 'shadow'], mods, mode) {
  const s = createMatch(chars, mods, mode);
  while (s.phase !== 'fight') step(s, idle(s));
  return s;
}

function run(s, ticks, inputs) {
  for (let i = 0; i < ticks; i++) step(s, inputs || idle(s));
}

// Stand fighter 1 just in front of fighter 0, the two facing each other.
function closeUp(s, gap = 60) {
  Object.assign(s.f[0], { x: 0, z: 0, dir: 0 });
  Object.assign(s.f[1], { x: gap, z: 0, dir: Math.PI });
}

// Press buttons for one tick, then let things play out.
function tap(s, inputs, after = 40) {
  step(s, inputs);
  run(s, after);
}

test('a match starts with an intro and then lets fighters move in every direction', () => {
  const s = createMatch(['ruko', 'shadow']);
  assert.equal(s.phase, 'intro');
  const { x, z } = s.f[0];
  run(s, 30, [INPUT.RIGHT, 0]);
  assert.equal(s.f[0].x, x, 'no movement during the intro');
  run(s, TIMING.INTRO);
  assert.equal(s.phase, 'fight');
  run(s, 10, [INPUT.RIGHT, 0]);
  assert.ok(s.f[0].x > x, 'walks right');
  run(s, 10, [INPUT.UP, 0]);
  assert.ok(s.f[0].z < z, 'walks into the depth of the arena');
  run(s, 10, [INPUT.DOWN | INPUT.LEFT, 0]);
  assert.ok(s.f[0].z < z && s.f[0].state === 'walk', 'walks diagonally');
});

test('a punch that connects removes health and builds energy', () => {
  const s = startFight();
  closeUp(s);
  tap(s, [INPUT.PUNCH, 0]);
  assert.ok(s.f[1].hp < s.f[1].maxHp);
  assert.ok(s.f[0].meter > 0);
  assert.equal(s.f[0].hp, s.f[0].maxHp);
});

test('attacks turn towards a nearby rival but miss one who is far away', () => {
  const s = startFight();
  Object.assign(s.f[0], { x: 0, z: 0, dir: 0 });
  Object.assign(s.f[1], { x: 0, z: 70 }); // off to the side, not in front
  tap(s, [INPUT.PUNCH, 0]);
  assert.ok(s.f[1].hp < s.f[1].maxHp, 'aim assist turned the puncher');

  const far = startFight();
  tap(far, [INPUT.PUNCH, 0]);
  assert.equal(far.f[1].hp, far.f[1].maxHp, 'out of reach');
});

test('a guard stops blows from the front but not from behind', () => {
  const front = startFight();
  closeUp(front);
  step(front, [INPUT.KICK, INPUT.BLOCK]);
  run(front, 40, [0, INPUT.BLOCK]);
  const chip = front.f[1].maxHp - front.f[1].hp;
  assert.ok(chip > 0 && chip < MOVES.kick.dmg, `chip damage was ${chip}`);

  const back = startFight();
  closeUp(back);
  back.f[1].state = 'block';
  back.f[1].dir = 0; // guarding the wrong way: their back is to the attacker
  step(back, [INPUT.KICK, 0]);
  run(back, 12);
  assert.ok(back.f[1].maxHp - back.f[1].hp >= MOVES.kick.dmg, 'hit from behind lands in full');
});

test('a blocked hit never knocks out', () => {
  const s = startFight();
  closeUp(s);
  s.f[1].hp = 1;
  step(s, [INPUT.KICK, INPUT.BLOCK]);
  run(s, 40, [0, INPUT.BLOCK]);
  assert.equal(s.f[1].hp, 1);
  assert.equal(s.phase, 'fight');
});

test('specials need energy; the projectile flies where the fighter faces', () => {
  const s = startFight(['shadow', 'ruko']);
  tap(s, [INPUT.SPECIAL, 0], 5);
  assert.equal(s.proj.length, 0, 'no energy, no special');
  s.f[0].meter = RULES.SPECIAL_COST;
  Object.assign(s.f[0], { x: 0, z: -200 });
  Object.assign(s.f[1], { x: 0, z: 200 }); // straight "down" the arena
  tap(s, [INPUT.SPECIAL, 0], 20);
  assert.equal(s.proj.length, 1);
  assert.ok(s.proj[0].vz > 0 && Math.abs(s.proj[0].vx) < 0.01);
  run(s, 60);
  assert.equal(s.proj.length, 0);
  assert.ok(s.f[1].hp < s.f[1].maxHp);
});

test('the dash special crosses the gap and knocks down', () => {
  const s = startFight(['ruko', 'shadow']);
  Object.assign(s.f[0], { x: -90, z: -90 });
  Object.assign(s.f[1], { x: 40, z: 40 });
  s.f[0].meter = RULES.SPECIAL_COST;
  tap(s, [INPUT.SPECIAL, 0], 24);
  assert.ok(s.f[1].hp < s.f[1].maxHp);
  assert.equal(s.f[1].state, 'down');
});

test('the ground stomp floors everyone nearby except those in the air', () => {
  const s = startFight(['jackie', 'ruko', 'shadow', 'pixie']);
  Object.assign(s.f[0], { x: 0, z: 0 });
  Object.assign(s.f[1], { x: 120, z: 0 });
  Object.assign(s.f[2], { x: -80, z: 90 });
  Object.assign(s.f[3], { x: 0, z: -130 });
  s.f[0].meter = RULES.SPECIAL_COST;
  step(s, [INPUT.SPECIAL, 0, 0, 0]);
  run(s, 3);
  run(s, 3, [0, 0, 0, INPUT.JUMP]); // Pixie jumps as the foot comes down
  run(s, 18);
  assert.equal(s.f[1].state, 'down');
  assert.equal(s.f[2].state, 'down');
  assert.equal(s.f[3].hp, s.f[3].maxHp, 'the jumper is untouched');
});

test('the spinning leap hits rivals on every side', () => {
  const s = startFight(['pixie', 'ruko', 'shadow', 'jackie']);
  Object.assign(s.f[0], { x: 0, z: 0 });
  Object.assign(s.f[1], { x: 60, z: 0 });
  Object.assign(s.f[2], { x: -60, z: 0 });
  Object.assign(s.f[3], { x: 400, z: 300 });
  s.f[0].meter = RULES.SPECIAL_COST;
  tap(s, [INPUT.SPECIAL, 0, 0, 0], 14);
  assert.ok(s.f[1].hp < s.f[1].maxHp && s.f[2].hp < s.f[2].maxHp);
  assert.equal(s.f[3].hp, s.f[3].maxHp);
});

test('the finisher uses the whole bar and freezes the action first', () => {
  const s = startFight();
  Object.assign(s.f[0], { x: -100, z: 0 });
  Object.assign(s.f[1], { x: 120, z: 0 });
  s.f[0].meter = RULES.SUPER_COST;
  step(s, [INPUT.SUPER, 0]);
  assert.equal(s.f[0].meter, 0);
  assert.ok(s.freeze > 0);
  run(s, 90);
  assert.ok(s.f[1].maxHp - s.f[1].hp >= 30);
});

test('fighters cannot overlap or leave the ring, and the ring closes in late', () => {
  const s = startFight();
  run(s, 400, [INPUT.RIGHT, INPUT.RIGHT]);
  for (const f of s.f) assert.ok(Math.hypot(f.x, f.z) <= ARENA.R - 23.9);
  assert.ok(Math.hypot(s.f[1].x - s.f[0].x, s.f[1].z - s.f[0].z) >= 47.9);
  s.timer = 6 * 60;
  run(s, 30, [INPUT.RIGHT, INPUT.LEFT]);
  assert.ok(s.ringR < ARENA.R - 200, 'ring has shrunk');
  for (const f of s.f) assert.ok(Math.hypot(f.x, f.z) <= s.ringR - 23.9);
});

test('duel: a knockout is worth a point and two points win the match', () => {
  const s = startFight();
  for (let round = 1; round <= 2; round++) {
    while (s.phase !== 'fight') step(s, idle(s));
    closeUp(s);
    s.f[1].hp = 1;
    tap(s, [INPUT.KICK, 0], 20);
    assert.equal(s.phase, 'ko');
    assert.equal(s.pts[0], round);
    run(s, TIMING.KO + 20);
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.matchWinner, 0);
});

test('duel: when time runs out the healthier fighter takes the round', () => {
  const s = startFight();
  s.f[0].hp = 40;
  s.timer = 3;
  run(s, 5);
  assert.equal(s.phase, 'ko');
  assert.equal(s.koKind, 'time');
  assert.deepEqual(s.pts, [0, 1]);
});

test('arena: everyone fights at once and points follow the finishing order', () => {
  const s = startFight(ALL);
  assert.equal(s.mode, 'arena');
  // Knock them out one at a time: slot 3 first, then 2, then 1.
  for (const victim of [3, 2, 1]) {
    Object.assign(s.f[0], { x: 0, z: 0 });
    Object.assign(s.f[victim], { x: 60, z: 0, hp: 1, state: 'idle', stun: 0, inv: 0 });
    tap(s, [INPUT.KICK, 0, 0, 0], 30); // long enough for the kick to finish
    assert.equal(s.f[victim].state, 'ko');
    if (victim !== 1) assert.equal(s.phase, 'fight', 'round goes on while two or more stand');
  }
  assert.equal(s.phase, 'ko');
  assert.deepEqual(s.roundPts, [3, 2, 1, 0]);
  assert.equal(s.winner, 0);
});

test('arena: fighters who cannot be separated share a place, and nobody wins a tie', () => {
  const s = startFight(ALL);
  s.f[2].hp = 0;
  s.f[2].state = 'ko';
  s.f[2].outAt = s.tick;
  s.f[3].hp = 0;
  s.f[3].state = 'ko';
  s.f[3].outAt = s.tick;
  s.f[0].hp = s.f[0].maxHp / 2;
  s.f[1].hp = s.f[1].maxHp / 2; // same share of health when the clock stops
  s.timer = 2;
  run(s, 4);
  assert.equal(s.koKind, 'time');
  assert.deepEqual(s.roundPts, [2, 2, 0, 0]);
  assert.equal(s.winner, -1);
});

test('arena: the match is exactly three rounds and ends with a ranking where ties stay ties', () => {
  const s = startFight(ALL);
  for (let round = 1; round <= 3; round++) {
    while (s.phase !== 'fight') step(s, idle(s));
    assert.equal(s.round, round);
    s.timer = 2; // let every round end on the clock with everyone level
    run(s, 4);
    run(s, TIMING.TIMEUP + 10);
  }
  assert.equal(s.phase, 'over');
  assert.equal(s.matchWinner, -1);
  assert.ok(s.ranking.every((r) => r.rank === 1), 'all level: everyone shares first place');
});

test('a boss modifier adds health and power, and survives the round reset', () => {
  const s = createMatch(['shadow', 'ruko'], [null, { health: 1.3, power: 1.5 }]);
  const boosted = Math.round(FIGHTERS.find((f) => f.id === 'ruko').stats.health * 1.3);
  assert.equal(s.f[1].maxHp, boosted);
  while (s.phase !== 'fight') step(s, idle(s));
  closeUp(s);
  tap(s, [0, INPUT.KICK]);
  assert.ok(s.f[0].maxHp - s.f[0].hp > MOVES.kick.dmg);
  closeUp(s);
  s.f[0].hp = 1;
  Object.assign(s.f[0], { state: 'idle', stun: 0 });
  tap(s, [0, INPUT.KICK], 20);
  run(s, TIMING.KO + 20);
  assert.equal(s.round, 2);
  assert.equal(s.f[1].maxHp, boosted, 'boss health kept in round 2');
  assert.equal(s.f[1].pw, 1.5);
});

test('the simulation is deterministic and CPU matches always finish, duel and arena', () => {
  const play = (chars, seed) => {
    const s = createMatch(chars);
    const ais = chars.map((_, i) => createAI(i % 2 ? 'normal' : 'hard', seed + i * 7));
    let n = 0;
    while (s.phase !== 'over' && n++ < 60 * 60 * 12) step(s, ais.map((ai, i) => aiInput(ai, s, i)));
    return s;
  };
  assert.equal(JSON.stringify(play(ALL, 42)), JSON.stringify(play(ALL, 42)));
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const chars of [['ruko', 'shadow'], ['jackie', 'pixie'], ALL]) {
      const s = play(chars, seed);
      assert.equal(s.phase, 'over', `${chars.join(' v ')} seed ${seed} finished`);
      assert.equal(s.ranking.length, chars.length);
      for (const f of s.f) {
        assert.ok(Number.isFinite(f.x) && Number.isFinite(f.z) && Math.hypot(f.x, f.z) <= ARENA.R);
        assert.ok(f.h >= 0);
      }
    }
  }
});

test('three punches in a row chain into a knockdown, but only if they connect', () => {
  const s = startFight();
  closeUp(s);
  for (let i = 0; i < 3; i++) {
    step(s, [INPUT.PUNCH, 0]);
    run(s, 9);
  }
  run(s, 8);
  assert.equal(s.f[1].state, 'down', 'the third punch floors the rival');
  assert.ok(s.f[1].maxHp - s.f[1].hp >= 17, 'all three landed');

  const air = startFight(); // nobody in reach: the string never starts
  step(air, [INPUT.PUNCH, 0]);
  run(air, 9);
  step(air, [INPUT.PUNCH, 0]);
  run(air, 3);
  assert.equal(air.f[0].move, 'punch');
});

test('block plus a direction is a dodge roll that attacks pass through', () => {
  const s = startFight();
  closeUp(s, 70);
  step(s, [INPUT.KICK, 0]);
  run(s, 5);
  step(s, [0, INPUT.BLOCK | INPUT.UP]); // roll away as the kick comes out
  assert.equal(s.f[1].state, 'roll');
  run(s, 10, [0, INPUT.BLOCK | INPUT.UP]);
  assert.equal(s.f[1].hp, s.f[1].maxHp, 'the kick missed');
  assert.ok(s.f[1].z < -50, 'and the roll covered ground');
  run(s, 30, [0, INPUT.BLOCK | INPUT.UP]);
  assert.equal(s.f[1].state, 'block', 'holding block afterwards guards instead of rolling again');
});

test('being knocked into the ring of fire burns and bounces back', () => {
  const s = startFight();
  Object.assign(s.f[0], { x: ARENA.R - 140, z: 0, dir: 0 });
  Object.assign(s.f[1], { x: ARENA.R - 70, z: 0, dir: Math.PI });
  s.f[0].meter = RULES.SPECIAL_COST;
  step(s, [INPUT.SPECIAL, 0]); // the dash throws them at the edge
  run(s, 40);
  const lost = s.f[1].maxHp - s.f[1].hp;
  assert.ok(lost > MOVES.dash.dmg, `dash plus burn cost ${lost}`);
  assert.ok(Math.hypot(s.f[1].x, s.f[1].z) <= ARENA.R - 23.9);
});

test('crystals appear on the floor and give energy or health to whoever walks over them', () => {
  const s = startFight();
  run(s, 60 * 8);
  assert.equal(s.items.length, 1, 'the first crystal has appeared');
  const it = s.items[0];
  it.kind = 'energy';
  Object.assign(s.f[0], { x: it.x, z: it.z });
  run(s, 2);
  assert.equal(s.items.length, 0);
  assert.equal(s.f[0].meter, 40);

  s.items.push({ id: 99, kind: 'heal', x: s.f[1].x, z: s.f[1].z, life: 600 });
  s.f[1].hp = 50;
  run(s, 2);
  assert.equal(s.f[1].hp, 65);
});

test('in a brawl a hit freezes only the two fighters involved', () => {
  const s = startFight(ALL);
  Object.assign(s.f[0], { x: 0, z: 0 });
  Object.assign(s.f[1], { x: 60, z: 0 });
  Object.assign(s.f[2], { x: -300, z: -300 });
  step(s, [INPUT.KICK, 0, INPUT.RIGHT, 0]);
  let frozeBoth = false;
  let bystanderMoved = true;
  for (let i = 0; i < 16; i++) {
    const before = s.f[2].x;
    step(s, [0, 0, INPUT.RIGHT, 0]);
    if (s.f[0].stop > 0 && s.f[1].stop > 0) frozeBoth = true;
    if (s.f[2].x === before) bystanderMoved = false;
  }
  assert.ok(frozeBoth, 'attacker and victim paused on impact');
  assert.ok(bystanderMoved, 'a fighter elsewhere kept walking');
  assert.equal(s.hitstop, 0, 'the world did not stop');
});

test('punch and kick together is a grab that goes through a guard, but not through the air', () => {
  const s = startFight();
  closeUp(s, 56);
  step(s, [INPUT.PUNCH | INPUT.KICK, INPUT.BLOCK]);
  run(s, 14, [0, INPUT.BLOCK]);
  assert.equal(s.f[0].move === 'grab' || s.f[1].state === 'down', true);
  assert.equal(s.f[1].state, 'down', 'the blocker is thrown');
  assert.ok(s.f[1].maxHp - s.f[1].hp >= MOVES.grab.dmg - 1);

  const far = startFight();
  closeUp(far, 120);
  step(far, [INPUT.PUNCH | INPUT.KICK, 0]);
  run(far, 14);
  assert.equal(far.f[1].hp, far.f[1].maxHp, 'out of reach: the grab misses');
  assert.equal(far.f[0].state, 'attack', 'and leaves the grabber open');
});

test('random button mashing never breaks the match (duel and arena)', () => {
  // A deterministic stream of random controller states, held for random spans.
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const STATES = new Set(['idle', 'walk', 'jump', 'airAttack', 'attack', 'block', 'roll', 'hit', 'land', 'down', 'getup', 'ko', 'win', 'lose']);
  for (const chars of [['ruko', 'shadow'], ['jackie', 'pixie'], ALL, ['pixie', 'pixie', 'jackie']]) {
    for (let game = 0; game < 6; game++) {
      const s = createMatch(chars, [], undefined, game + 1);
      const held = chars.map(() => 0);
      const until = chars.map(() => 0);
      let ticks = 0;
      while (s.phase !== 'over' && ticks++ < 60 * 60 * 12) {
        for (let i = 0; i < chars.length; i++) {
          if (ticks >= until[i]) {
            held[i] = Math.floor(rnd() * 1024);
            if (rnd() < 0.5) held[i] &= ~64; // do not sit in block all day
            until[i] = ticks + 1 + Math.floor(rnd() * 14);
          }
        }
        step(s, held);
        // A fighter with a full bar gets one each time, to exercise finishers too.
        if (ticks % 400 === 0) for (const f of s.f) f.meter = 100;
        for (const f of s.f) {
          assert.ok(STATES.has(f.state), `known state, got ${f.state}`);
          assert.ok(Number.isFinite(f.x) && Number.isFinite(f.z) && Number.isFinite(f.h) && Number.isFinite(f.dir), 'finite position');
          assert.ok(Math.hypot(f.x, f.z) <= s.ringR + 0.01, 'inside the ring');
          assert.ok(f.h >= 0 && f.h < 400, `sane height ${f.h}`);
          assert.ok(f.hp >= 0 && f.hp <= f.maxHp, 'health in range');
          assert.ok(f.meter >= 0 && f.meter <= 100, 'energy in range');
          assert.ok(f.state !== 'attack' || MOVES[f.move], 'an attacking fighter has a move');
        }
        assert.ok(s.proj.length <= 12 && s.items.length <= 2);
      }
      assert.equal(s.phase, 'over', `${chars.join(' v ')} game ${game} finished`);
      assert.equal(s.ranking.length, chars.length);
      assert.equal(s.pts.reduce((a, b) => a + b, 0) > 0 || s.matchWinner === -1, true);
    }
  }
});
