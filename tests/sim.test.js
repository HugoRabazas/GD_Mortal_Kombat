import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, MOVES, AIR_SPECIAL, THROW } from '../shared/sim.js';
import { createAI, aiInput } from '../shared/ai.js';
import { FIGHTERS } from '../shared/fighters.js';
import { ARENA, INPUT, RULES, TIMING } from '../shared/constants.js';

const ALL = FIGHTERS.map((f) => f.id);
const BRAWL = ALL.slice(0, 4); // an arena holds four fighters
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

test('a guard raised just before the blow is a perfect guard; a held or hammered guard is not', () => {
  // Kick first, guard at the last moment: no damage, and the kicker reels.
  const s = startFight();
  closeUp(s);
  step(s, [INPUT.KICK, 0]);
  run(s, MOVES.kick.startup - 3);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    step(s, [0, INPUT.BLOCK]);
    seen.push(...s.ev.map((e) => e.type));
  }
  assert.ok(seen.includes('parry'), 'a parry was announced');
  assert.ok(!seen.includes('block'));
  assert.equal(s.f[1].hp, s.f[1].maxHp, 'no chip damage');
  assert.equal(s.f[0].state, 'hit', 'the attacker is left open');
  assert.equal(s.f[0].move, null);
  assert.ok(s.f[1].meter > 0);

  // A light punch can be guarded perfectly too, but its owner is not staggered.
  const light = startFight();
  closeUp(light);
  step(light, [INPUT.PUNCH, 0]);
  run(light, MOVES.punch.startup - 2);
  run(light, 3, [0, INPUT.BLOCK]);
  assert.equal(light.f[1].hp, light.f[1].maxHp);
  assert.notEqual(light.f[0].state, 'hit');

  // Letting go and pressing again at once does not earn a second window.
  const mash = startFight();
  closeUp(mash);
  run(mash, 6, [0, INPUT.BLOCK]);
  run(mash, 2);
  step(mash, [INPUT.KICK, 0]);
  run(mash, MOVES.kick.startup - 3);
  run(mash, 12, [0, INPUT.BLOCK]);
  assert.ok(mash.f[1].hp < mash.f[1].maxHp, 'an ordinary block: chip damage');
  assert.notEqual(mash.f[0].state, 'hit');
});

test('a blow that lands while the rival winds up is a counter hit: more damage', () => {
  // Fighter 1 starts a slow kick; fighter 0 punches into its startup.
  const s = startFight();
  closeUp(s);
  step(s, [0, INPUT.KICK]);
  step(s, [INPUT.PUNCH, 0]);
  const hits = [];
  for (let i = 0; i < 20; i++) {
    step(s, idle(s));
    hits.push(...s.ev.filter((e) => e.type === 'hit'));
  }
  const counter = hits.find((e) => e.by === 0);
  assert.ok(counter, 'the punch landed');
  assert.equal(counter.counter, true);
  assert.ok(!hits.some((e) => e.by === 1), 'the kick was knocked out of its startup');

  // The same punch on a rival standing still is an ordinary hit.
  const plain = startFight();
  closeUp(plain);
  tap(plain, [INPUT.PUNCH, 0]);
  const normal = plain.f[1].maxHp - plain.f[1].hp;
  assert.ok(counter.dmg > normal, `counter ${counter.dmg} beats ordinary ${normal}`);
});

test('a fighter under a quarter of their health fills the energy bar half as fast again', () => {
  const gainFrom = (hp) => {
    const s = startFight();
    closeUp(s);
    s.f[1].hp = hp;
    const events = [];
    step(s, [INPUT.PUNCH, 0]);
    for (let i = 0; i < 30; i++) {
      step(s, idle(s));
      events.push(...s.ev);
    }
    return { meter: s.f[1].meter, events };
  };
  const healthy = gainFrom(100);
  const low = gainFrom(20);
  assert.ok(Math.abs(low.meter / healthy.meter - 1.5) < 0.01, `${low.meter} against ${healthy.meter}`);
  const crossing = gainFrom(30); // a punch takes this fighter under a quarter
  assert.ok(crossing.events.some((e) => e.type === 'lastStand' && e.slot === 1), 'crossing the line is announced');
  assert.ok(!low.events.some((e) => e.type === 'lastStand'), 'only once, when it begins');
});

test('block held on the floor is a quick rise, once per knockdown', () => {
  const downTime = (inputs) => {
    const s = startFight();
    closeUp(s);
    s.f[1].hp = 100;
    step(s, [INPUT.PUNCH | INPUT.KICK, 0]); // a grab knocks down
    let downAt = -1;
    for (let t = 0; t < 120; t++) {
      step(s, [0, inputs]);
      if (s.f[1].state === 'down' && s.f[1].h <= 0 && downAt < 0) downAt = t;
      if (downAt >= 0 && s.f[1].state === 'getup') return { ticks: t - downAt, events: s };
    }
    return { ticks: Infinity };
  };
  const lying = downTime(0);
  const rising = downTime(INPUT.BLOCK);
  assert.ok(rising.ticks < lying.ticks - 15, `quick rise ${rising.ticks} against ${lying.ticks} ticks on the floor`);
});

test('a guard raised in a brawl turns to the rival who is swinging, not the nearest one', () => {
  const s = startFight(['ruko', 'shadow', 'jackie', 'pixie'], [], 'arena');
  // Fighter 0 in the middle; fighter 1 close by doing nothing; fighter 2
  // further away, on the other side, already winding up a kick.
  Object.assign(s.f[0], { x: 0, z: 0, dir: 0 });
  Object.assign(s.f[1], { x: 60, z: 0, dir: Math.PI });
  Object.assign(s.f[2], { x: -110, z: 0, dir: 0 });
  Object.assign(s.f[3], { x: 0, z: 400 });
  step(s, [0, 0, INPUT.KICK, 0]);
  step(s, [INPUT.BLOCK, 0, 0, 0]);
  assert.equal(s.f[0].state, 'block');
  assert.ok(Math.abs(Math.abs(s.f[0].dir) - Math.PI) < 0.2, `guard faces the kicker (dir ${s.f[0].dir.toFixed(2)})`);
});

test('a hit reports the health it really took, never more than was left', () => {
  const s = startFight();
  closeUp(s);
  s.f[1].hp = 3;
  step(s, [INPUT.KICK, 0]);
  const hits = [];
  for (let i = 0; i < 30; i++) {
    step(s, idle(s));
    hits.push(...s.ev.filter((e) => e.type === 'hit'));
  }
  assert.equal(hits.length, 1);
  assert.ok(hits[0].dmg > 3, 'the kick itself is stronger than what was left');
  assert.equal(hits[0].dealt, 3);
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
  run(s, 200);
  assert.ok(s.f[1].maxHp - s.f[1].hp >= 30);
});

test('each fighter has a finisher of their own: a chain of stages worth about 30 up close', () => {
  const seen = new Set();
  for (const id of ALL) {
    const s = startFight([id, 'shadow']);
    Object.assign(s.f[0], { x: -60, z: 0, dir: 0, meter: RULES.SUPER_COST });
    Object.assign(s.f[1], { x: 60, z: 0, dir: Math.PI });
    step(s, [INPUT.SUPER, 0]);
    const stages = [];
    for (let i = 0; i < 260; i++) {
      step(s, idle(s));
      if (s.f[0].move && stages.at(-1) !== s.f[0].move) stages.push(s.f[0].move);
    }
    const dmg = s.f[1].maxHp - s.f[1].hp;
    assert.ok(stages.length >= 2, `${id}: ${stages.join(' > ')}`);
    assert.ok(dmg >= 24 && dmg <= 36, `${id}: ${dmg}`);
    seen.add(stages[0]);
  }
  assert.equal(seen.size, ALL.length, 'all different');
  // A guard raised in time stops it, even Shadow's strike from behind.
  for (const id of ALL) {
    const s = startFight([id, 'shadow']);
    Object.assign(s.f[0], { x: -100, z: 0, dir: 0, meter: RULES.SUPER_COST });
    Object.assign(s.f[1], { x: 100, z: 0, dir: Math.PI });
    step(s, [INPUT.SUPER, INPUT.BLOCK]);
    run(s, 260, [0, INPUT.BLOCK]);
    assert.ok(s.f[1].maxHp - s.f[1].hp <= 10, `${id} blocked`);
  }
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
  const s = startFight(BRAWL);
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
  const s = startFight(BRAWL);
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
  const s = startFight(BRAWL);
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
  assert.equal(JSON.stringify(play(BRAWL, 42)), JSON.stringify(play(BRAWL, 42)));
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const chars of [['ruko', 'shadow'], ['jackie', 'pixie'], BRAWL, ALL.slice(4)]) {
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

test('block with the stick straight away from the rival is a quick back-step, still facing them', () => {
  const s = startFight();
  closeUp(s, 70);
  step(s, [INPUT.BLOCK | INPUT.LEFT, 0]);
  assert.equal(s.f[0].state, 'backstep');
  const x0 = s.f[0].x;
  run(s, 12);
  assert.ok(x0 - s.f[0].x > 40, `hopped back (${(x0 - s.f[0].x).toFixed(0)})`);
  assert.ok(Math.cos(s.f[0].dir) > 0.9, 'still facing the rival');
  assert.ok(['land', 'idle'].includes(s.f[0].state));
  // Out of the way of a kick coming out.
  const k = startFight();
  closeUp(k, 70);
  step(k, [0, INPUT.KICK]);
  run(k, 2);
  step(k, [INPUT.BLOCK | INPUT.LEFT, 0]);
  run(k, 20);
  assert.equal(k.f[0].hp, k.f[0].maxHp, 'the kick missed');
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
  const s = startFight(BRAWL);
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

test('the slide is low: it goes under an ordinary guard, not a perfect one, and not a jump', () => {
  const slideAt = (defend) => {
    const s = startFight();
    Object.assign(s.f[0], { x: -150, z: 0, dir: 0 });
    Object.assign(s.f[1], { x: 0, z: 0, dir: Math.PI });
    const seen = [];
    for (let t = 0; t < 70; t++) {
      // Run a few steps, then kick with the stick still held: the slide.
      const me = t < 12 ? INPUT.RIGHT : t === 12 ? INPUT.RIGHT | INPUT.KICK : 0;
      step(s, [me, defend(s, t)]);
      seen.push(...s.ev);
    }
    return { hit: seen.find((e) => e.type === 'hit' && e.by === 0 && e.kind === 'slide'), parried: seen.some((e) => e.type === 'parry' && e.by === 1) };
  };
  const held = slideAt(() => INPUT.BLOCK);
  assert.ok(held.hit, 'it lands on a guard held all along');
  assert.ok(held.hit.under, 'under the guard');
  // A guard raised just before it lands: a perfect guard stops it.
  const perfect = slideAt((s) => (s.f[0].state === 'attack' && s.f[0].move === 'slide' && s.f[0].t >= MOVES.slide.startup && Math.hypot(s.f[1].x - s.f[0].x, s.f[1].z - s.f[0].z) < 110 ? INPUT.BLOCK : 0));
  assert.ok(perfect.parried && !perfect.hit, 'a perfect guard stops it');
  const jumped = slideAt((s) => (s.f[0].state === 'attack' && s.f[0].move === 'slide' && s.f[0].t < 4 ? INPUT.JUMP : 0));
  assert.ok(!jumped.hit, 'a jump clears it');
});

test('special and punch together is the EX special: twice the energy, more damage, a blow shrugged off', () => {
  const special = (bits, first = 0) => {
    const s = startFight(['jackie', 'shadow']); // Jackie's special is the stomp: it reaches all round
    closeUp(s, 80);
    s.f[0].meter = 100;
    const hp = s.f[1].hp;
    step(s, [first || bits, 0]);
    if (first) step(s, [bits, 0]);
    const ex = s.f[0].ex;
    run(s, 60);
    return { ex, lost: hp - s.f[1].hp, meter: s.f[0].meter };
  };
  const plain = special(INPUT.SPECIAL);
  const ex = special(INPUT.SPECIAL | INPUT.PUNCH);
  assert.equal(plain.ex, false);
  assert.equal(ex.ex, true);
  assert.ok(ex.lost > plain.lost, `EX ${ex.lost} against ${plain.lost}`);
  assert.ok(plain.meter > ex.meter, 'and it costs more');
  // A moment apart, either way round.
  assert.equal(special(INPUT.PUNCH, INPUT.SPECIAL).ex, true, 'special a tick after the punch');
  assert.equal(special(INPUT.SPECIAL, INPUT.PUNCH).ex, true, 'punch a tick after the special');
  // Not enough energy: the ordinary special.
  const s = startFight(['jackie', 'shadow']);
  closeUp(s, 80);
  s.f[0].meter = 50;
  step(s, [INPUT.SPECIAL | INPUT.PUNCH, 0]);
  assert.equal(s.f[0].ex, false);

  // Its armour: a jab into its start does not stop it.
  const t = startFight(['jackie', 'shadow']);
  closeUp(t, 60);
  t.f[0].meter = 100;
  step(t, [INPUT.SPECIAL | INPUT.PUNCH, 0]);
  step(t, [0, INPUT.PUNCH]);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    step(t, idle(t));
    seen.push(...t.ev);
  }
  assert.ok(seen.some((e) => e.type === 'armour' && e.by === 0 && e.ex), 'the jab is shrugged off');
  assert.ok(seen.some((e) => e.type === 'hit' && e.by === 0 && e.kind === 'quake'), 'and the stomp lands');
});

test('block, then a direction a moment later, still rolls; a guard held a while does not', () => {
  const tryRoll = (gap) => {
    const s = startFight();
    Object.assign(s.f[0], { x: 0, z: 0, dir: 0 });
    Object.assign(s.f[1], { x: 300, z: 0 });
    for (let i = 0; i < gap; i++) step(s, [INPUT.BLOCK, 0]);
    step(s, [INPUT.BLOCK | INPUT.DOWN, 0]);
    return s.f[0].state;
  };
  assert.equal(tryRoll(0), 'roll', 'pressed together');
  assert.equal(tryRoll(3), 'roll', 'the direction three ticks late');
  assert.equal(tryRoll(20), 'block', 'a guard already held stays a guard');
});

test('a punch right after a perfect guard is a riposte; later it is a punch again', () => {
  const guardThen = (wait) => {
    const s = startFight();
    closeUp(s, 64);
    step(s, [0, INPUT.PUNCH]);
    let parried = false;
    for (let i = 0; i < 12 && !parried; i++) {
      step(s, [s.f[1].t >= MOVES.punch.startup - 2 ? INPUT.BLOCK : 0, 0]);
      parried = s.ev.some((e) => e.type === 'parry' && e.by === 0);
    }
    assert.ok(parried, 'the punch met a perfect guard');
    run(s, wait);
    const hp = s.f[1].hp;
    const seen = [];
    step(s, [INPUT.PUNCH, 0]);
    let move = s.f[0].move; // (the press may wait out the pause of the guard)
    for (let i = 0; i < 24; i++) {
      step(s, idle(s));
      move ||= s.f[0].move;
      seen.push(...s.ev);
    }
    return { move, lost: hp - s.f[1].hp, hit: seen.find((e) => e.type === 'hit' && e.by === 0) };
  };
  const quick = guardThen(3);
  assert.equal(quick.move, 'riposte');
  assert.equal(quick.hit?.kind, 'riposte', 'it lands while the rival is still open');
  assert.ok(quick.lost >= 8, `worth more than a jab: ${quick.lost}`);
  assert.equal(guardThen(30).move, 'punch', 'the chance passes');
});

test('kick, punch is a stepping elbow that carries on into either ender; a guard then kick launches', () => {
  const string = (third) => {
    const s = startFight();
    closeUp(s, 80);
    const kinds = [];
    const press = [INPUT.KICK, INPUT.PUNCH, third];
    let n = 0;
    step(s, [press[n++], 0]);
    for (let i = 0; i < 90; i++) {
      const hit = s.ev.find((e) => e.type === 'hit' && e.by === 0);
      if (hit) kinds.push(hit.kind);
      step(s, [hit && n < press.length ? press[n++] : 0, 0]);
    }
    return { kinds, rival: s.f[1] };
  };
  const up = string(INPUT.KICK);
  assert.deepEqual(up.kinds.slice(0, 3), ['kick', 'elbow', 'launch']);
  const down = string(INPUT.PUNCH);
  assert.deepEqual(down.kinds, ['kick', 'elbow', 'punch3']);
  assert.ok(['down', 'getup'].includes(down.rival.state), 'the third punch floors them');

  // Kick right after a perfect guard is the launcher at once.
  const s = startFight();
  closeUp(s, 64);
  step(s, [0, INPUT.PUNCH]);
  let parried = false;
  for (let i = 0; i < 12 && !parried; i++) {
    step(s, [s.f[1].t >= MOVES.punch.startup - 2 ? INPUT.BLOCK : 0, 0]);
    parried = s.ev.some((e) => e.type === 'parry' && e.by === 0);
  }
  assert.ok(parried);
  run(s, 3);
  step(s, [INPUT.KICK, 0]);
  let move = s.f[0].move;
  let launched = false;
  for (let i = 0; i < 30; i++) {
    step(s, idle(s));
    move ||= s.f[0].move;
    launched ||= s.ev.some((e) => e.type === 'hit' && e.by === 0 && e.kind === 'launch');
  }
  assert.equal(move, 'launch');
  assert.ok(launched, 'and it lands');
});

test('a throw by the fire with the flames beyond the rival is a fire toss; elsewhere the usual throw', () => {
  const throwAt = (x, facing = 1) => {
    const s = startFight();
    Object.assign(s.f[0], { x: x - 55 * facing, z: 0, dir: facing > 0 ? 0 : Math.PI });
    Object.assign(s.f[1], { x, z: 0, dir: facing > 0 ? Math.PI : 0 });
    const hp = s.f[1].hp;
    const seen = [];
    step(s, [INPUT.GRAB, 0]);
    for (let i = 0; i < 90; i++) {
      step(s, idle(s));
      seen.push(...s.ev);
    }
    return { toss: seen.some((e) => e.type === 'fireToss'), burnt: seen.some((e) => e.type === 'burn' && e.slot === 1), lost: hp - s.f[1].hp };
  };
  const edge = throwAt(ARENA.R - 70);
  assert.ok(edge.toss && edge.burnt, 'flung into the fire');
  assert.ok(edge.lost >= 14, `the throw and the burn: ${edge.lost}`);
  const middle = throwAt(60);
  assert.ok(!middle.toss && !middle.burnt, 'in the middle: over the head as ever');
  // By the fire but facing away from it (the fire behind the thrower): the
  // usual throw, over the head - which is where the fire is.
  const back = throwAt(ARENA.R - 140, -1);
  assert.ok(!back.toss);
});

test('grab in the air: an air throw with a rival in the air close by, the stomp with them on the ground', () => {
  // Both jump together, face to face: grab at the top.
  const s = startFight();
  closeUp(s, 62);
  step(s, [INPUT.JUMP, INPUT.JUMP]);
  run(s, 8);
  assert.ok(s.f[1].h > 25, 'the rival is up too');
  step(s, [INPUT.GRAB, 0]);
  assert.equal(s.f[0].move, 'airThrow');
  const hp = s.f[1].hp;
  const seen = [];
  for (let i = 0; i < 60; i++) {
    step(s, idle(s));
    seen.push(...s.ev);
  }
  const hit = seen.find((e) => e.type === 'hit' && e.by === 0);
  assert.equal(hit?.kind, 'airThrow');
  assert.ok(hp - s.f[1].hp >= 10, 'it hurts');
  assert.ok(['down', 'getup'].includes(s.f[1].state), 'driven into the floor');
  // The rival on the ground: grab in the air is the stomp, as before.
  const t = startFight();
  closeUp(t, 40);
  step(t, [INPUT.JUMP, 0]);
  run(t, 8);
  step(t, [INPUT.GRAB, 0]);
  assert.equal(t.f[0].move, 'stomp');
  // After a launcher the launched rival can be thrown out of the air.
  const u = startFight();
  closeUp(u, 70);
  const presses = [INPUT.PUNCH, INPUT.PUNCH, INPUT.KICK];
  let n = 0;
  let thrown = false;
  step(u, [presses[n++], 0]);
  for (let i = 0; i < 160 && !thrown; i++) {
    const me = u.f[0];
    const landed = u.ev.some((e) => e.type === 'hit' && e.by === 0);
    let b = landed && n < presses.length ? presses[n++] : 0;
    if (me.move === 'launch' && me.hits.length) b = INPUT.JUMP;
    if (me.state === 'jump' && u.f[1].h > 25 && Math.abs(me.h - u.f[1].h) < 60) b = INPUT.GRAB;
    step(u, [b, 0]);
    thrown = u.ev.some((e) => e.type === 'hit' && e.by === 0 && e.kind === 'airThrow');
  }
  assert.ok(thrown, 'launcher, jump, air throw');
});

test('punch, kick, punch ends the hook kick in a backfist that floors; punch, kick, kick launches', () => {
  const string = (presses) => {
    const s = startFight();
    closeUp(s, 70);
    const kinds = [];
    let n = 0;
    step(s, [presses[n++], 0]);
    for (let i = 0; i < 100; i++) {
      const hit = s.ev.find((e) => e.type === 'hit' && e.by === 0);
      if (hit) kinds.push(hit.kind);
      step(s, [hit && n < presses.length ? presses[n++] : 0, 0]);
    }
    return { kinds, rival: s.f[1] };
  };
  const back = string([INPUT.PUNCH, INPUT.KICK, INPUT.PUNCH]);
  assert.deepEqual(back.kinds, ['punch', 'hook', 'backfist']);
  assert.ok(['down', 'getup'].includes(back.rival.state), 'the backfist floors them');
  const up = string([INPUT.PUNCH, INPUT.KICK, INPUT.KICK]);
  assert.deepEqual(up.kinds.slice(0, 3), ['punch', 'hook', 'launch']);
});

test('block with a direction while getting up rolls clear of the rise', () => {
  const s = startFight();
  closeUp(s);
  Object.assign(s.f[0], { state: 'down', t: 0, stun: 3, h: 0, vh: 0 });
  let rolled = null;
  for (let i = 0; i < 40 && !rolled; i++) {
    step(s, [INPUT.BLOCK | INPUT.LEFT, 0]);
    rolled = s.ev.find((e) => e.type === 'roll' && e.by === 0) || null;
  }
  assert.ok(rolled?.wake, 'a roll straight out of getting up');
  assert.equal(s.f[0].state, 'roll');
  const x = s.f[0].x;
  run(s, 12, [INPUT.BLOCK | INPUT.LEFT, 0]);
  assert.ok(s.f[0].x < x - 50, 'away from where they lay');
  // Without the direction they simply stand up (and may raise a guard).
  const t = startFight();
  closeUp(t);
  Object.assign(t.f[0], { state: 'down', t: 0, stun: 3, h: 0, vh: 0 });
  let any = false;
  for (let i = 0; i < 40; i++) {
    step(t, [INPUT.BLOCK, 0]);
    any ||= t.ev.some((e) => e.type === 'roll');
  }
  assert.ok(!any);
});

// A finisher thrown at fighter 1 from up close, the others (if any) far away.
function finisherAt(chars) {
  const s = startFight(chars);
  Object.assign(s.f[0], { x: -60, z: 0, dir: 0, meter: RULES.SUPER_COST });
  Object.assign(s.f[1], { x: 60, z: 0, dir: Math.PI });
  for (let k = 2; k < chars.length; k++) Object.assign(s.f[k], { x: k === 2 ? -260 : 260, z: 320, dir: -Math.PI / 2 });
  step(s, [INPUT.SUPER, ...chars.slice(1).map(() => 0)]);
  return s;
}

test('in a brawl a finisher is worth what it is in a duel: its flurry strikes no more often', () => {
  // (The pause of a blow holds only the two involved in a brawl; a flurry
  // must not strike again on the tick it is held on.)
  for (const id of ['ruko', 'shadow', 'kichta', 'pixie', 'zelrith']) {
    const worth = (chars) => {
      const s = finisherAt(chars);
      run(s, 300);
      return s.f[1].maxHp - s.f[1].hp;
    };
    const rivals = ALL.filter((x) => x !== id);
    const duel = worth([id, rivals[0]]);
    const brawl = worth([id, rivals[0], rivals[1], rivals[2]]);
    assert.ok(duel >= 24, `${id} in a duel: ${duel}`);
    assert.ok(Math.abs(brawl - duel) <= 4, `${id}: ${brawl} in a brawl, ${duel} in a duel`);
  }
});

test('a finisher that has landed is not broken by the others in a brawl, only hurt', () => {
  const s = finisherAt(['ruko', 'shadow', 'jackie', 'pixie']);
  while (s.f[0].ultOn !== 1) step(s, idle(s));
  // Jackie, right behind Ruko, punches into the flurry.
  Object.assign(s.f[2], { x: s.f[0].x - 58, z: s.f[0].z, dir: 0 });
  const hp = s.f[0].hp;
  const seen = [];
  step(s, [0, 0, INPUT.PUNCH, 0]);
  for (let i = 0; i < 160; i++) {
    step(s, idle(s));
    seen.push(...s.ev);
    if (i < 12) assert.equal(s.f[0].state, 'attack', 'the finisher goes on');
  }
  assert.ok(seen.some((e) => e.type === 'armour' && e.by === 0 && e.from === 2 && e.first), 'the blow is shrugged off');
  assert.ok(s.f[0].hp < hp, 'but it hurts');
  assert.ok(seen.some((e) => e.type === 'hit' && e.by === 0 && e.on === 1 && e.final), 'and the last blow lands');

  // Before it has landed, a blow still stops it.
  const t = startFight(['ruko', 'shadow', 'jackie', 'pixie']);
  Object.assign(t.f[0], { x: -200, z: 0, dir: 0, meter: RULES.SUPER_COST });
  Object.assign(t.f[1], { x: 300, z: 0, dir: Math.PI });
  Object.assign(t.f[2], { x: -258, z: 0, dir: 0 });
  Object.assign(t.f[3], { x: 0, z: 350 });
  step(t, [INPUT.SUPER, 0, INPUT.PUNCH, 0]);
  let stopped = false;
  for (let i = 0; i < 60 && !stopped; i++) {
    step(t, [0, 0, INPUT.PUNCH, 0]);
    stopped = t.f[0].state === 'hit';
  }
  assert.ok(stopped, 'struck out of the finisher before it landed');
});

test('in a brawl a rush finisher is only stopped on its way by the rival it set out after', () => {
  // Ruko rushes at Shadow; Jackie, close behind, punches into the rush
  // before it has reached anyone.
  const s = startFight(['ruko', 'shadow', 'jackie', 'pixie']);
  Object.assign(s.f[0], { x: -150, z: 0, dir: 0, meter: RULES.SUPER_COST });
  Object.assign(s.f[1], { x: 90, z: 0, dir: Math.PI });
  Object.assign(s.f[2], { x: -150, z: 300, dir: 0 });
  Object.assign(s.f[3], { x: 0, z: 380 });
  step(s, [INPUT.SUPER, 0, 0, 0]);
  assert.equal(s.f[0].ultAim, 1, 'it set out after Shadow, the nearest');
  Object.assign(s.f[2], { x: s.f[0].x - 55, z: s.f[0].z, dir: 0 }); // then Jackie steps in behind
  const seen = [];
  for (let i = 0; i < 200; i++) {
    step(s, [0, 0, i < 12 ? INPUT.PUNCH : 0, 0]);
    seen.push(...s.ev);
  }
  const shrug = seen.find((e) => e.type === 'armour' && e.by === 0 && e.from === 2);
  assert.ok(shrug, "Jackie's punch is shrugged off");
  assert.ok(seen.findIndex((e) => e === shrug) < seen.findIndex((e) => e.type === 'hit' && e.by === 0 && e.on === 1), 'before the rush had landed');
  assert.ok(seen.some((e) => e.type === 'hit' && e.by === 0 && e.on === 1 && e.final), 'and the finisher went all the way');
});

test('a finisher\'s flurry never knocks out: its last blow does', () => {
  for (const id of ['ruko', 'kichta', 'meru']) {
    const s = finisherAt([id, 'shadow']);
    s.f[1].hp = 12; // the flurry alone would be enough
    let out = null;
    for (let i = 0; i < 300 && !out; i++) {
      step(s, idle(s));
      if (s.ev.some((e) => e.type === 'out')) out = s.ev;
      else if (s.f[1].state !== 'ko') assert.ok(s.f[1].hp >= 1, `${id}: still standing through the flurry`);
    }
    assert.ok(out, `${id}: knocked out in the end`);
    assert.ok(out.some((e) => e.type === 'hit' && e.final), `${id}: by the last blow`);
  }
});

test('Crescent Rain shares its arrows among the rivals of a brawl', () => {
  const s = startFight(['gleh', 'ruko', 'shadow', 'jackie']);
  Object.assign(s.f[0], { x: 0, z: 0, dir: 0, meter: RULES.SUPER_COST });
  Object.assign(s.f[1], { x: 220, z: 0, dir: Math.PI });
  Object.assign(s.f[2], { x: -200, z: 120, dir: 0 });
  Object.assign(s.f[3], { x: -40, z: -260, dir: Math.PI / 2 });
  step(s, [INPUT.SUPER, 0, 0, 0]);
  run(s, 260);
  for (const k of [1, 2, 3]) assert.ok(s.f[k].hp < s.f[k].maxHp, `${s.f[k].char} was rained on`);
  // In a duel all five come down on the one rival.
  const d = finisherAt(['gleh', 'ruko']);
  run(d, 260);
  assert.ok(d.f[1].maxHp - d.f[1].hp >= 20, 'all five arrows on the one rival');
});

test('punch and kick together is a grab that goes through a guard, but not through the air', () => {
  const s = startFight();
  closeUp(s, 56);
  step(s, [INPUT.PUNCH | INPUT.KICK, INPUT.BLOCK]);
  run(s, 50, [0, INPUT.BLOCK]);
  assert.equal(s.f[1].state, 'down', 'the blocker is thrown');
  assert.ok(s.f[1].maxHp - s.f[1].hp >= MOVES.grab.dmg - 1);

  const far = startFight();
  closeUp(far, 120);
  step(far, [INPUT.PUNCH | INPUT.KICK, 0]);
  run(far, 14);
  assert.equal(far.f[1].hp, far.f[1].maxHp, 'out of reach: the grab misses');
  assert.equal(far.f[0].state, 'attack', 'and leaves the grabber open');
});

test('punch on the move is a lunging straight that travels and reaches further than a jab', () => {
  const still = startFight();
  closeUp(still, 150);
  step(still, [INPUT.PUNCH, 0]);
  run(still, 20);
  assert.equal(still.f[1].hp, still.f[1].maxHp, 'a jab from a standstill does not reach');

  const s = startFight();
  closeUp(s, 180);
  run(s, 9, [INPUT.RIGHT, 0]); // running in
  const gap = s.f[1].x - s.f[0].x;
  assert.ok(gap > 84 + 34, `still out of a jab's reach (${gap.toFixed(0)})`);
  assert.equal(s.f[0].state, 'walk');
  const x0 = s.f[0].x;
  step(s, [INPUT.RIGHT | INPUT.PUNCH, 0]);
  assert.equal(s.f[0].move, 'lunge');
  run(s, 14);
  assert.ok(s.f[0].x - x0 > 40, `the lunge carries forward (${(s.f[0].x - x0).toFixed(0)})`);
  assert.ok(s.f[1].hp < s.f[1].maxHp, 'and lands from where a jab would not');
});

test('a punch from a single step is still a jab', () => {
  const s = startFight();
  closeUp(s, 120);
  run(s, 2, [INPUT.RIGHT, 0]);
  step(s, [INPUT.RIGHT | INPUT.PUNCH, 0]);
  assert.equal(s.f[0].move, 'punch');
});

test('kick on the move is a slide that sweeps a standing rival but passes under a jump', () => {
  const s = startFight();
  closeUp(s, 175);
  run(s, 9, [INPUT.RIGHT, 0]);
  step(s, [INPUT.RIGHT | INPUT.KICK, 0]);
  assert.equal(s.f[0].move, 'slide');
  run(s, 18);
  assert.equal(s.f[1].state === 'down' || s.f[1].state === 'getup', true, 'swept off the feet');

  const air = startFight();
  closeUp(air, 175);
  run(air, 9, [INPUT.RIGHT, 0]);
  step(air, [INPUT.RIGHT | INPUT.KICK, INPUT.JUMP]);
  run(air, 18);
  assert.equal(air.f[1].hp, air.f[1].maxHp, 'a rival in the air is over the slide');
});

test('punch late in a roll springs into an uppercut that knocks down; kick, a spinning heel kick', () => {
  for (const [button, move] of [[INPUT.PUNCH, 'rollUpper'], [INPUT.KICK, 'rollSpin']]) {
    const s = startFight();
    closeUp(s, 150);
    run(s, 6, [INPUT.RIGHT | INPUT.BLOCK, 0]);
    assert.equal(s.f[0].state, 'roll');
    step(s, [INPUT.RIGHT | INPUT.BLOCK | button, 0]);
    run(s, 2);
    assert.equal(s.f[0].move, move, 'out of the roll');
    run(s, 12);
    assert.ok(s.f[1].hp < s.f[1].maxHp, `${move} lands`);
    if (move === 'rollUpper') assert.equal(s.f[1].state, 'down');
  }
  // Too early in the roll the press waits; the roll still carries on first.
  const early = startFight();
  closeUp(early, 300);
  step(early, [INPUT.RIGHT | INPUT.BLOCK, 0]);
  step(early, [INPUT.RIGHT | INPUT.BLOCK | INPUT.PUNCH, 0]);
  run(early, 3, [INPUT.RIGHT | INPUT.BLOCK, 0]);
  assert.equal(early.f[0].state, 'roll', 'no strike in the first ticks of a roll');
});

test('punch or kick while getting up is a rising sweep that cannot be hit while it starts', () => {
  const s = startFight();
  closeUp(s);
  step(s, [INPUT.GRAB, 0]);
  for (let t = 0; t < 200 && s.f[1].state !== 'getup'; t++) step(s, idle(s));
  assert.equal(s.f[1].state, 'getup');
  s.f[0].x = s.f[1].x - 70; // waiting over the fallen rival
  s.f[0].z = s.f[1].z;
  run(s, 4, [0, INPUT.KICK]);
  assert.equal(s.f[1].move, 'riseKick');
  assert.ok(s.f[1].inv > 0, 'safe while it winds up');
  const hp = s.f[0].hp;
  run(s, 14);
  assert.ok(s.f[0].hp < hp, 'it catches the rival standing over them');
});

test('a fresh press of jump in the air jumps again, once, and higher overall', () => {
  const peak = (presses) => {
    const s = startFight();
    step(s, [INPUT.JUMP, 0]);
    let top = 0;
    for (let i = 0; i < 90; i++) {
      step(s, [presses.includes(i) ? INPUT.JUMP : 0, 0]);
      top = Math.max(top, s.f[0].h);
    }
    return { top, s };
  };
  const one = peak([]);
  const two = peak([12]);
  const three = peak([12, 26]);
  assert.ok(two.top > one.top * 1.4, `the air jump climbs (${one.top.toFixed(0)} -> ${two.top.toFixed(0)})`);
  assert.equal(three.top, two.top, 'only one air jump per jump');
  // Holding jump from the take-off is not a second jump.
  const held = startFight();
  let top = 0;
  for (let i = 0; i < 40; i++) {
    step(held, [INPUT.JUMP, 0]);
    top = Math.max(top, held.f[0].h);
  }
  assert.ok(top < one.top + 1, 'holding the button does not jump twice');
});

test('in the air punch, kick and grab are three different moves; the stomp knocks down', () => {
  for (const [button, move] of [[INPUT.PUNCH, 'airPunch'], [INPUT.KICK, 'airKick'], [INPUT.GRAB, 'stomp'], [INPUT.PUNCH | INPUT.KICK, 'stomp']]) {
    const s = startFight();
    closeUp(s, 40);
    step(s, [INPUT.JUMP, 0]);
    run(s, 12);
    step(s, [button, 0]);
    assert.equal(s.f[0].move, move);
    run(s, 40);
    assert.ok(s.f[1].hp < s.f[1].maxHp, `${move} lands`);
    if (move === 'stomp') assert.ok(s.f[1].state === 'down' || s.f[1].state === 'getup', 'stomped flat');
  }
  // A stomp that meets nothing roots the stomper for a moment.
  const miss = startFight();
  closeUp(miss, 300);
  step(miss, [INPUT.JUMP, 0]);
  run(miss, 12);
  step(miss, [INPUT.GRAB, 0]);
  for (let i = 0; i < 40 && miss.f[0].state !== 'land'; i++) step(miss, idle(miss));
  assert.equal(miss.f[0].state, 'land');
  assert.ok(miss.f[0].stun >= 10, 'a missed stomp is slow to recover');
});

test('punch, punch, kick launches; a jump and an air punch juggle the rival before they land', () => {
  const s = startFight();
  closeUp(s);
  const seq = { 0: INPUT.PUNCH, 9: INPUT.PUNCH, 19: INPUT.KICK };
  let launched = false;
  let juggled = false;
  let top = 0;
  let pressedAir = false;
  for (let t = 0; t < 100; t++) {
    const me = s.f[0];
    const o = s.f[1];
    let inp = seq[t] || 0;
    if (me.move === 'launch' && me.hits.length) inp |= INPUT.JUMP;
    if (me.state === 'jump' && o.h > 0 && Math.abs(me.h - o.h) < 60 && !pressedAir) {
      inp |= INPUT.PUNCH;
      pressedAir = true;
    }
    step(s, [inp, 0]);
    launched ||= s.ev.some((e) => e.type === 'hit' && e.kind === 'launch');
    juggled ||= s.ev.some((e) => e.type === 'hit' && e.juggle);
    top = Math.max(top, o.h);
  }
  assert.ok(launched, 'the launcher lands');
  assert.ok(top > 80, `the rival is thrown up (${top.toFixed(0)})`);
  assert.ok(juggled, 'and is hit again in the air');
  assert.equal(s.f[1].juggle, 0, 'the juggle ends on landing');
});

test('kick, kick: a kick that lands flows into a roundhouse that knocks down', () => {
  const s = startFight();
  closeUp(s, 80);
  step(s, [INPUT.KICK, 0]);
  run(s, 11);
  step(s, [INPUT.KICK, 0]); // pressed while the kick is still out (remembered)
  for (let i = 0; i < 12 && s.f[0].move !== 'kick2'; i++) step(s, idle(s));
  assert.equal(s.f[0].move, 'kick2');
  run(s, 14);
  assert.ok(s.f[1].state === 'down' || s.f[1].state === 'getup', 'knocked down');
  // A kick that missed has no follow-up.
  const miss = startFight();
  closeUp(miss, 300);
  step(miss, [INPUT.KICK, 0]);
  run(miss, 11);
  step(miss, [INPUT.KICK, 0]);
  run(miss, 2);
  assert.notEqual(miss.f[0].move, 'kick2');
});

test('punch, kick: a hook kick that spins the rival round', () => {
  const s = startFight();
  closeUp(s);
  const before = s.f[1].dir;
  step(s, [INPUT.PUNCH, 0]);
  run(s, 9);
  step(s, [INPUT.KICK, 0]);
  const kinds = [];
  for (let i = 0; i < 40; i++) {
    step(s, idle(s));
    for (const e of s.ev) if (e.type === 'hit' && e.by === 0) kinds.push(e.kind);
  }
  assert.ok(kinds.includes('hook'), kinds.join());
  assert.ok(Math.cos(s.f[1].dir - before) < -0.9, 'the rival was turned round');
});

test('an air punch that lands flows into an axe kick; a jump out of a run kicks with a flying knee', () => {
  const s = startFight();
  closeUp(s, 70);
  const kinds = [];
  for (let t = 0; t < 60; t++) {
    step(s, [t === 0 ? INPUT.JUMP | INPUT.RIGHT : t === 10 ? INPUT.PUNCH : t === 16 ? INPUT.KICK : 0, 0]);
    for (const e of s.ev) if (e.type === 'hit' && e.by === 0) kinds.push(e.kind);
  }
  assert.deepEqual(kinds, ['airPunch', 'axeKick']);
  assert.ok(s.f[1].state === 'down' || s.f[1].state === 'getup');

  // A flying kick that lands flows into the hammer fist, which bounces them.
  const h = startFight();
  closeUp(h, 70);
  const hk = [];
  let bounced = false;
  for (let t = 0; t < 70; t++) {
    step(h, [t === 0 ? INPUT.JUMP | INPUT.RIGHT : t === 10 ? INPUT.KICK : t === 17 ? INPUT.PUNCH : 0, 0]);
    for (const e of h.ev) if (e.type === 'hit' && e.by === 0) hk.push(e.kind);
    if (h.f[1].state === 'down' && h.f[1].juggle > 0 && h.f[1].h > 0) bounced = true;
  }
  assert.deepEqual(hk.slice(0, 2), ['airKick', 'hammer']);
  assert.ok(bounced, 'off the floor for one blow more');

  const knee = startFight();
  closeUp(knee, 200);
  const k2 = [];
  for (let t = 0; t < 60; t++) {
    step(knee, [t < 10 ? INPUT.RIGHT : t === 10 ? INPUT.RIGHT | INPUT.JUMP : t === 13 ? INPUT.KICK : 0, 0]);
    for (const e of knee.ev) if (e.type === 'hit' && e.by === 0) k2.push(e.kind);
  }
  assert.deepEqual(k2, ['flyKnee']);
  // From a standing jump the same kick is the ordinary flying kick.
  const still = startFight();
  closeUp(still, 70);
  step(still, [INPUT.JUMP, 0]);
  run(still, 7);
  step(still, [INPUT.KICK, 0]);
  assert.equal(still.f[0].move, 'airKick');
});

test('kick held charges a kick that breaks a guard; a tapped kick is still the kick', () => {
  const play = (hold, p2) => {
    const s = startFight();
    closeUp(s, 80);
    const ev = [];
    for (let t = 0; t < 70; t++) {
      step(s, [t < hold ? INPUT.KICK : 0, p2]);
      ev.push(...s.ev);
    }
    return { s, ev };
  };
  const tap = play(2, INPUT.BLOCK);
  assert.ok(tap.ev.some((e) => e.type === 'block'), 'a tapped kick is blocked as ever');
  assert.ok(!tap.ev.some((e) => e.type === 'swing' && e.move === 'charge'));
  const held = play(25, INPUT.BLOCK);
  assert.ok(held.ev.some((e) => e.type === 'guardBreak'), 'the guard is broken');
  const broke = held.ev.findIndex((e) => e.type === 'guardBreak');
  assert.equal(held.s.f[1].hp, held.s.f[1].maxHp, 'no damage through the guard');
  assert.ok(broke >= 0);
  const open = play(25, 0);
  assert.ok(open.ev.some((e) => e.type === 'hit' && e.kind === 'breaker'), 'on an open rival it simply lands');
});

test('knocked down into the ring of fire, a rival bounces back off it and can be struck once in the air', () => {
  const s = startFight();
  const edge = s.ringR - 60;
  Object.assign(s.f[0], { x: edge - 140, z: 0, dir: 0 });
  Object.assign(s.f[1], { x: edge - 80, z: 0, dir: Math.PI });
  let bounced = -1;
  let juggled = false;
  for (let t = 0; t < 100; t++) {
    const me = s.f[0];
    const o = s.f[1];
    let b = t === 0 || t === 9 || t === 18 ? INPUT.PUNCH : 0;
    if (bounced >= 0 && o.h > 0 && o.juggle > 0) {
      if (Math.hypot(o.x - me.x, o.z - me.z) > 85) b |= o.x > me.x ? INPUT.RIGHT : INPUT.LEFT;
      else if (me.state !== 'attack' && t % 2) b |= INPUT.PUNCH;
    }
    step(s, [b, 0]);
    for (const e of s.ev) {
      if (e.type === 'burn' && e.bounce) bounced = t;
      if (e.type === 'hit' && e.by === 0 && e.juggle) juggled = true;
    }
  }
  assert.ok(bounced >= 0, 'bounced off the fire');
  assert.ok(juggled, 'and was struck on the way back');
});

test('block held and grab pressed while standing still is a taunt: energy, and open to counter hits', () => {
  const s = startFight();
  closeUp(s, 200);
  const m0 = s.f[0].meter;
  step(s, [INPUT.BLOCK, 0]);
  step(s, [INPUT.BLOCK | INPUT.GRAB, 0]);
  assert.equal(s.f[0].move, 'taunt');
  run(s, 45, [INPUT.BLOCK, 0]);
  assert.ok(s.f[0].meter > m0, 'it earns energy');
  // Struck while taunting: a counter hit.
  const c = startFight();
  closeUp(c, 70);
  step(c, [INPUT.BLOCK, 0]);
  step(c, [INPUT.BLOCK | INPUT.GRAB, 0]);
  run(c, 4);
  step(c, [0, INPUT.PUNCH]);
  let counter = false;
  for (let i = 0; i < 20; i++) {
    step(c, idle(c));
    counter ||= c.ev.some((e) => e.type === 'hit' && e.by === 1 && e.counter);
  }
  assert.ok(counter);
});

test('a blow that lands can be cancelled into the special; a stomp that lands bounces its victim up', () => {
  const s = startFight();
  closeUp(s);
  s.f[0].meter = RULES.SPECIAL_COST;
  step(s, [INPUT.PUNCH, 0]);
  run(s, 5);
  step(s, [INPUT.SPECIAL, 0]);
  const ev = [];
  for (let i = 0; i < 30; i++) {
    step(s, idle(s));
    ev.push(...s.ev);
  }
  assert.ok(ev.some((e) => e.type === 'special' && e.cancel), 'cancelled into the special');
  // A missed blow cannot be cancelled.
  const miss = startFight();
  closeUp(miss, 300);
  miss.f[0].meter = RULES.SPECIAL_COST;
  step(miss, [INPUT.PUNCH, 0]);
  run(miss, 5);
  step(miss, [INPUT.SPECIAL, 0]);
  run(miss, 3);
  assert.equal(miss.f[0].move, 'punch');

  const st = startFight();
  closeUp(st, 45);
  step(st, [INPUT.JUMP, 0]);
  run(st, 12);
  step(st, [INPUT.GRAB, 0]);
  let top = 0;
  for (let i = 0; i < 40; i++) {
    step(st, idle(st));
    if (st.f[1].state === 'down') top = Math.max(top, st.f[1].h);
  }
  assert.ok(top > 15, `bounced off the floor (${top.toFixed(0)})`);
});

test('special in the air is each fighter\'s own air special, and each one lands', () => {
  const want = Object.fromEntries(FIGHTERS.map((f) => [f.id, AIR_SPECIAL[f.special.type]]));
  for (const id of ALL) {
    const s = startFight([id, 'ruko']);
    closeUp(s, 60);
    s.f[0].meter = RULES.SPECIAL_COST;
    step(s, [INPUT.JUMP, 0]);
    run(s, 7);
    step(s, [INPUT.SPECIAL, 0]);
    assert.equal(s.f[0].move, want[id], id);
    assert.ok(s.f[0].meter < RULES.SPECIAL_COST, 'it costs energy');
    run(s, 60);
    assert.ok(s.f[1].hp < s.f[1].maxHp, `${id}: lands`);
  }
});

test('grab with nobody in throw reach is the fighter\'s signature move; up close it is still a throw', () => {
  const want = Object.fromEntries(FIGHTERS.map((f) => [f.id, f.signature.move]));
  for (const id of ALL) {
    const s = startFight([id, 'ruko']);
    closeUp(s, 160);
    step(s, [INPUT.GRAB, 0]);
    assert.equal(s.f[0].move, want[id], id);
    const near = startFight([id, 'ruko']);
    closeUp(near, 60);
    step(near, [INPUT.GRAB, 0]);
    assert.equal(near.f[0].move, 'grab', `${id} up close`);
  }
  // Shadow's step ends at the rival's back.
  const sh = startFight(['shadow', 'ruko']);
  closeUp(sh, 200);
  step(sh, [INPUT.GRAB, 0]);
  run(sh, 20);
  const back = Math.cos(sh.f[1].dir - Math.atan2(sh.f[0].z - sh.f[1].z, sh.f[0].x - sh.f[1].x));
  assert.ok(back < -0.9, 'behind the rival');
});

test('grab pressed the moment you are seized breaks the throw; too late and it lands', () => {
  const play = (at) => {
    const s = startFight();
    closeUp(s);
    const ev = [];
    for (let t = 0; t < 70; t++) {
      step(s, [t === 0 ? INPUT.GRAB : 0, t === at ? INPUT.GRAB : 0]);
      ev.push(...s.ev.map((e) => e.type));
    }
    return { s, ev };
  };
  const out = play(12);
  assert.ok(out.ev.includes('seize') && out.ev.includes('escape') && !out.ev.includes('slam'));
  assert.equal(out.s.f[1].hp, out.s.f[1].maxHp, 'no damage taken');
  const late = play(24);
  assert.ok(late.ev.includes('slam') && !late.ev.includes('escape'));
  assert.ok(late.s.f[1].hp < late.s.f[1].maxHp);
});

test('a throw seizes, lifts the rival over the head and slams them down behind', () => {
  const s = startFight();
  closeUp(s, 56);
  step(s, [INPUT.GRAB, INPUT.BLOCK]);
  let seized = false;
  let highest = 0;
  let behind = false;
  for (let i = 0; i < 60; i++) {
    step(s, [0, INPUT.BLOCK]);
    const [a, b] = s.f;
    if (b.state === 'held') {
      seized = true;
      highest = Math.max(highest, b.h);
      assert.equal(a.state, 'throw');
    }
    if (s.ev.some((e) => e.type === 'slam')) behind = b.x - a.x < 0; // fighter 0 faces +x
  }
  assert.ok(seized, 'the grab button alone seizes the rival');
  assert.ok(highest > 80, `the rival is lifted high (${highest.toFixed(0)})`);
  assert.ok(behind, 'and slammed down behind the thrower');
  assert.equal(s.f[1].state === 'down' || s.f[1].state === 'getup', true);
  assert.ok(s.f[1].hp < s.f[1].maxHp, 'the slam hurts');
  assert.equal(s.f[0].state, 'idle', 'the thrower is free again');
});

test('punch and kick a beat apart still make a grab, but a punch then a kick does not', () => {
  const s = startFight();
  closeUp(s, 56);
  step(s, [INPUT.PUNCH, 0]);
  step(s, [INPUT.KICK, 0]);
  run(s, 12);
  assert.ok(s.f[0].state === 'throw' || s.f[1].state === 'held', `a throw, not a punch (${s.f[0].state})`);
  const late = startFight();
  closeUp(late, 56);
  step(late, [INPUT.PUNCH, 0]);
  run(late, 4, [0, 0]);
  step(late, [INPUT.KICK, 0]);
  run(late, 12);
  assert.notEqual(late.f[0].state, 'throw', 'too late: the punch stays a punch');
});

test('in a brawl the one being thrown is out of reach, but a thrower who is hit drops them', () => {
  const s = startFight(['ruko', 'shadow', 'jackie', 'pixie'], [], 'arena');
  closeUp(s, 56);
  Object.assign(s.f[2], { x: 40, z: 60, dir: -Math.PI / 2 });
  Object.assign(s.f[3], { x: 0, z: 400 });
  step(s, [INPUT.GRAB, 0, 0, 0]);
  run(s, 9, [0, 0, 0, 0]);
  assert.equal(s.f[1].state, 'held');
  const hp = [s.f[0].hp, s.f[1].hp];
  for (let i = 0; i < 4; i++) step(s, [0, 0, 0, 0]);
  assert.equal(s.f[1].hp, hp[1], 'the one being thrown is not hurt while carried');
  // Jackie walks up behind the thrower and punches.
  Object.assign(s.f[2], { x: -50, z: 0, dir: 0 });
  for (let i = 0; i < 20 && s.f[0].hp === hp[0]; i++) step(s, [0, 0, i % 2 ? 0 : INPUT.PUNCH, 0]);
  assert.ok(s.f[0].hp < hp[0], 'the thrower can be hit');
  run(s, 2, [0, 0, 0, 0]);
  assert.notEqual(s.f[1].state, 'held', 'and lets the rival go');
  assert.equal(s.f[1].hp, hp[1], 'who drops unhurt');
});

test('random button mashing never breaks the match (duel and arena)', () => {
  // A deterministic stream of random controller states, held for random spans.
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const STATES = new Set(['idle', 'walk', 'jump', 'airAttack', 'attack', 'block', 'roll', 'backstep', 'hit', 'land', 'down', 'getup', 'ko', 'win', 'lose', 'throw', 'held']);
  for (const chars of [['ruko', 'shadow'], ['jackie', 'pixie'], BRAWL, ALL.slice(4), ['pixie', 'pixie', 'jackie']]) {
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

test('in the air, special and punch together is the EX air special', () => {
  // Every kind of air special: jump, then the special (with punch or not).
  const air = (char, bits, gap = char === 'jackie' ? 80 : 120, first = 0) => {
    const s = startFight([char, 'shadow']);
    closeUp(s, gap);
    s.f[0].meter = 100;
    s.f[1].hp = 999;
    step(s, [INPUT.JUMP, 0]);
    run(s, 8);
    step(s, [first || bits, 0]);
    if (first) step(s, [bits, 0]);
    const ex = s.f[0].ex;
    const meter = s.f[0].meter;
    let dmg = 0;
    for (let i = 0; i < 90; i++) {
      step(s, idle(s));
      for (const e of s.ev) if (e.type === 'hit' && e.by === 0) dmg += e.dmg;
    }
    return { ex, meter, dmg, state: s.f[0].move };
  };
  for (const char of ['ruko', 'shadow', 'jackie', 'pixie']) {
    const plain = air(char, INPUT.SPECIAL);
    const ex = air(char, INPUT.SPECIAL | INPUT.PUNCH);
    assert.equal(plain.ex, false, char);
    assert.equal(ex.ex, true, char);
    assert.ok(plain.meter > ex.meter, `${char}: it costs more`);
    assert.ok(plain.dmg > 0 && ex.dmg > plain.dmg, `${char}: EX ${ex.dmg} against ${plain.dmg}`);
    // A beat apart, either way round.
    assert.equal(air(char, INPUT.PUNCH, undefined, INPUT.SPECIAL).ex, true, `${char}: special just after an air punch`);
    assert.equal(air(char, INPUT.SPECIAL, undefined, INPUT.PUNCH).ex, true, `${char}: punch just after the air special`);
  }
  // Not enough energy: the plain air special.
  const s = startFight(['ruko', 'shadow']);
  closeUp(s, 120);
  s.f[0].meter = 50;
  step(s, [INPUT.JUMP, 0]);
  run(s, 8);
  step(s, [INPUT.SPECIAL | INPUT.PUNCH, 0]);
  assert.equal(s.f[0].ex, false);
  assert.equal(s.f[0].state, 'airAttack');
});

test('block held, then kick standing still: the guard sweep - low, it floors a guard; a perfect guard or a jump beats it', () => {
  const sweepAt = (defend, mine = (t) => (t < 4 ? INPUT.BLOCK : t === 4 ? INPUT.BLOCK | INPUT.KICK : 0)) => {
    const s = startFight();
    closeUp(s, 70);
    const seen = [];
    let move = null;
    for (let t = 0; t < 70; t++) {
      step(s, [mine(t), defend(s, t)]);
      if (s.f[0].state === 'attack' && !move) move = s.f[0].move;
      seen.push(...s.ev);
    }
    return { move, hit: seen.find((e) => e.type === 'hit' && e.by === 0), down: s.f[1].state === 'down' || seen.some((e) => e.type === 'knockdown' && e.slot === 1), parried: seen.some((e) => e.type === 'parry' && e.by === 1) };
  };
  const held = sweepAt(() => INPUT.BLOCK);
  assert.equal(held.move, 'sweep');
  assert.ok(held.hit && held.hit.under, 'it goes under a guard held all along');
  // A guard raised just before it lands: a perfect guard stops it.
  const perfect = sweepAt((s) => (s.f[0].move === 'sweep' && s.f[0].t >= MOVES.sweep.startup - 2 ? INPUT.BLOCK : 0));
  assert.ok(perfect.parried && !perfect.hit, 'a perfect guard stops it');
  const jumped = sweepAt((s) => (s.f[0].move === 'sweep' && s.f[0].t < 3 ? INPUT.JUMP : 0));
  assert.ok(!jumped.hit, 'a jump clears it');
  // Kick without the guard is still the kick; with the stick pushed, the guard rolls.
  assert.equal(sweepAt(() => 0, (t) => (t === 4 ? INPUT.KICK : 0)).move, 'kick');
});

test('after a throw, kick drops onto the floored rival (the pursuit); a quick rise gets out of its way', () => {
  const pursue = (victim) => {
    const s = startFight();
    closeUp(s, 50);
    const seen = [];
    let thrown = -1;
    for (let t = 0; t < 120; t++) {
      const me = t === 0 ? INPUT.GRAB : s.f[0].state === 'throw' && s.f[0].t > THROW.slam ? INPUT.KICK : 0;
      step(s, [me, victim(s, t, thrown)]);
      for (const e of s.ev) if (e.type === 'slam') thrown = t;
      seen.push(...s.ev);
    }
    return { thrown, pursued: seen.some((e) => e.type === 'swing' && e.by === 0 && e.move === 'pursuit'), hit: seen.find((e) => e.type === 'hit' && e.by === 0 && e.kind === 'pursuit'), hp: s.f[1].hp, state: s.f[1].state };
  };
  const stay = pursue(() => 0);
  assert.ok(stay.thrown >= 0 && stay.pursued, 'the throw lands and the pursuit comes out');
  assert.ok(stay.hit, 'it lands on a rival who stays down');
  // A quick rise the moment they land: up and away before it falls.
  const rise = pursue((s, t, thrown) => (thrown >= 0 && t > thrown ? INPUT.BLOCK : 0));
  assert.ok(rise.pursued && !rise.hit, 'a quick rise beats it');
  // Not after an ordinary knockdown: kick is just a kick there.
  const s = startFight();
  closeUp(s, 60);
  step(s, [INPUT.KICK, 0]);
  assert.equal(s.f[0].move, 'kick');
});

test('kick after a double jump is a dive kick: down at the rival, it floors them; a miss lands heavily', () => {
  const dive = (gap, rival = 0) => {
    const s = startFight();
    closeUp(s, gap);
    const seen = [];
    let move = null;
    let stun = 0;
    for (let t = 0; t < 90; t++) {
      const me = t === 0 ? INPUT.JUMP : t === 10 ? INPUT.JUMP : t === 16 ? INPUT.KICK : 0;
      step(s, [me, rival]);
      if (s.f[0].state === 'airAttack' && !move) move = s.f[0].move;
      if (s.f[0].state === 'land') stun = Math.max(stun, s.f[0].stun);
      seen.push(...s.ev);
    }
    return { move, hit: seen.find((e) => e.type === 'hit' && e.by === 0 && e.kind === 'diveKick'), down: seen.some((e) => e.type === 'hit' && e.by === 0) && s.f[1].state !== 'idle', stun };
  };
  const near = dive(150);
  assert.equal(near.move, 'diveKick');
  assert.ok(near.hit, 'it reaches a rival a good way off');
  const miss = dive(600);
  assert.ok(!miss.hit && miss.stun >= 14, `a miss lands heavily (${miss.stun})`);
  assert.ok(near.stun < miss.stun, 'a hit lands lighter');
  // A single jump's kick is still the flying kick.
  const s = startFight();
  closeUp(s, 150);
  step(s, [INPUT.JUMP, 0]);
  run(s, 8);
  step(s, [INPUT.KICK, 0]);
  assert.equal(s.f[0].move, 'airKick');
});

test('a boss brought to half health powers up once a round (second wind)', () => {
  const s = createMatch(['ruko', 'shadow'], [null, { health: 1.3, power: 1.1, enrage: true }]);
  while (s.phase !== 'fight') step(s, idle(s));
  closeUp(s, 60);
  const boss = s.f[1];
  const pw = boss.pw;
  boss.hp = Math.round(boss.maxHp * 0.55); // a few blows from half
  const seen = [];
  for (let t = 0; t < 600 && boss.hp > boss.maxHp * 0.3; t++) {
    if (t % 60 === 0) closeUp(s, 60);
    step(s, [t % 60 === 1 ? INPUT.PUNCH : 0, 0]);
    seen.push(...s.ev);
  }
  const winds = seen.filter((e) => e.type === 'enrage' && e.slot === 1);
  assert.equal(winds.length, 1, 'once');
  assert.ok(boss.enraged && boss.pw > pw, 'harder blows');
  // An ordinary fighter never does.
  assert.ok(!seen.some((e) => e.type === 'enrage' && e.slot === 0));
});

test('caught in a combo, special and block together burst out: half the energy, the rival pushed back and staggered', () => {
  const tryBurst = (meter, from) => {
    const s = startFight(['ruko', 'shadow']);
    closeUp(s);
    s.f[0].meter = meter;
    const seen = [];
    let burstAt = -1;
    let before = 0;
    for (let t = 0; t < 150 && burstAt < 0; t++) {
      const me = s.f[0];
      before = me.meter;
      // Shadow mashes punch (a string); Ruko, once caught (the `from`th blow
      // on), holds block and taps special.
      const caught = me.state === 'hit' && me.taken >= from;
      step(s, [caught ? INPUT.BLOCK | (t % 2 ? INPUT.SPECIAL : 0) : 0, t % 3 === 0 ? INPUT.PUNCH : 0]);
      seen.push(...s.ev);
      if (s.ev.some((e) => e.type === 'burst')) burstAt = t;
    }
    return { s, seen, burstAt, spent: before - s.f[0].meter };
  };
  const { s, burstAt, spent } = tryBurst(60, 2);
  assert.ok(burstAt >= 0, 'burst out of the string');
  assert.equal(s.f[0].state, 'idle');
  assert.ok(s.f[0].inv > 0, 'a moment untouchable');
  assert.equal(spent, 50, 'half the energy spent');
  assert.equal(s.f[1].state, 'hit', 'the attacker staggered');
  assert.ok(Math.hypot(s.f[1].x - s.f[0].x, s.f[1].z - s.f[0].z) > 80, 'and pushed back');
  // Not without the energy, and not on the first blow.
  assert.equal(tryBurst(5, 2).burstAt, -1, 'needs half the bar');
  assert.equal(tryBurst(60, 0).seen.filter((e) => e.type === 'burst').length <= 1, true);
});

test('two plain blows of the same weight meeting at once clash: no damage, both knocked apart', () => {
  const meet = (a, b) => {
    const s = startFight(['ruko', 'ruko']);
    closeUp(s, 70);
    const hp = s.f.map((f) => f.hp);
    const gap0 = s.f[1].x - s.f[0].x;
    const seen = [];
    step(s, [a, b]);
    seen.push(...s.ev);
    for (let i = 0; i < 30; i++) {
      step(s, idle(s));
      seen.push(...s.ev);
    }
    return { s, seen, lost: s.f.map((f, i) => hp[i] - f.hp), gap: s.f[1].x - s.f[0].x - gap0 };
  };
  const same = meet(INPUT.PUNCH, INPUT.PUNCH);
  assert.ok(same.seen.some((e) => e.type === 'clash' && e.melee), 'a clash');
  assert.deepEqual(same.lost, [0, 0], 'no damage');
  assert.ok(same.gap > 30, 'knocked apart');
  // A jab against a kick (light against heavy): no clash, they trade or the faster one lands.
  const mixed = meet(INPUT.PUNCH, INPUT.KICK);
  assert.ok(!mixed.seen.some((e) => e.type === 'clash'));
  assert.ok(mixed.lost.some((x) => x > 0));
});

// Every string, started near its first blow's full reach on a rival who
// stands still, lands to its last blow (for some steady rhythm of presses):
// the pushback of the early blows must never carry the rival out of reach.
test('every string lands to its end from near its first blow\'s reach', () => {
  const P = INPUT.PUNCH;
  const K = INPUT.KICK;
  const strings = { 'P P P': [P, P, P], 'P P K': [P, P, K], 'K K': [K, K], 'K P': [K, P], 'P K': [P, K], 'P K P': [P, K, P], 'K P P': [K, P, P], 'K P K': [K, P, K] };
  const landed = (keys, d0, gap) => {
    const s = createMatch(['ruko', 'shadow']);
    while (s.phase !== 'fight') step(s, [0, 0]);
    s.f[0].x = -d0 / 2;
    s.f[1].x = d0 / 2;
    s.f[0].z = s.f[1].z = 0;
    let n = 0;
    for (let t = 0; t < 120; t++) {
      step(s, [t % gap === 0 && t / gap < keys.length ? keys[t / gap] : 0, 0]);
      n += s.ev.filter((e) => e.type === 'hit' && e.by === 0).length;
    }
    return n;
  };
  for (const [name, keys] of Object.entries(strings)) {
    const d0 = (keys[0] === P ? MOVES.punch.reach : MOVES.kick.reach) - 4;
    const best = Math.max(...[6, 8, 10, 12, 14, 16, 18, 20].map((gap) => landed(keys, d0, gap)));
    assert.equal(best, keys.length, `${name} from ${d0}`);
  }
});

test('punch, punch, punch started at the jab\'s full reach lands all three', () => {
  const s = createMatch(['ruko', 'shadow']);
  while (s.phase !== 'fight') step(s, [0, 0]);
  s.f[0].x = -42;
  s.f[1].x = 42; // 84 apart: as far as the jab reaches
  s.f[0].z = s.f[1].z = 0;
  const plan = { 0: INPUT.PUNCH, 8: INPUT.PUNCH, 16: INPUT.PUNCH };
  const kinds = [];
  for (let t = 0; t < 90; t++) {
    step(s, [plan[t] || 0, 0]);
    for (const e of s.ev) if (e.type === 'hit' && e.by === 0) kinds.push(e.kind);
  }
  assert.deepEqual(kinds, ['punch', 'punch2', 'punch3']);
});

// The move list calls the dash special 'a long lunge from well beyond kick
// range': it lands from about two and a half kicks away, no farther.
test('the dash special lands from well beyond a kick, but not across the arena', () => {
  const lands = (d0) => {
    const s = createMatch(['ruko', 'jackie']);
    while (s.phase !== 'fight') step(s, [0, 0]);
    s.f[0].x = -d0 / 2;
    s.f[1].x = d0 / 2;
    s.f[0].z = s.f[1].z = 0;
    s.f[0].meter = RULES.METER_MAX;
    let hit = false;
    for (let t = 0; t < 120; t++) {
      step(s, [t < 3 ? INPUT.SPECIAL : 0, 0]);
      if (s.ev.some((e) => e.type === 'hit' && e.by === 0)) hit = true;
    }
    return hit;
  };
  assert.ok(lands(MOVES.kick.reach * 2.4), 'from 2.4 kicks away');
  assert.ok(!lands(ARENA.R), 'not from half the arena away');
});

// Gleh's Moon Vault, as the move list says: a high vault that lands its kick
// from well out of reach (beyond a kick's reach, up to about three).
test('Moon Vault kicks from well out of reach', () => {
  const lands = (d0) => {
    const s = createMatch(['gleh', 'jackie']);
    while (s.phase !== 'fight') step(s, [0, 0]);
    s.f[0].x = -d0 / 2;
    s.f[1].x = d0 / 2;
    s.f[0].z = s.f[1].z = 0;
    let hit = false;
    for (let t = 0; t < 90; t++) {
      step(s, [t < 3 ? INPUT.GRAB : 0, 0]);
      if (s.ev.some((e) => e.type === 'hit' && e.by === 0 && e.kind === 'moonVault')) hit = true;
    }
    return hit;
  };
  assert.ok(lands(MOVES.kick.reach * 2.5), 'from 2.5 kicks away');
  assert.ok(!lands(ARENA.R * 0.8), 'not from most of the arena away');
});

// Every fighter's own moves land on a rival who stands still, from a range
// each is meant for: the special and its air version up close, the
// signature move (grab out of reach) from beyond a kick, the finisher.
test('every fighter\'s special, air special, signature move and finisher land', () => {
  const lands = (id, d0, plan) => {
    const s = createMatch([id, 'jackie']);
    while (s.phase !== 'fight') step(s, [0, 0]);
    s.f[0].x = -d0 / 2;
    s.f[1].x = d0 / 2;
    s.f[0].z = s.f[1].z = 0;
    s.f[0].meter = RULES.METER_MAX;
    for (let t = 0; t < 150; t++) {
      step(s, [plan(t), 0]);
      if (s.ev.some((e) => e.type === 'hit' && e.by === 0)) return true;
    }
    return false;
  };
  const press = (button, from = 0) => (t) => (t >= from && t < from + 2 ? button : 0);
  for (const f of FIGHTERS) {
    assert.ok(lands(f.id, 80, press(INPUT.SPECIAL)), `${f.id} special`);
    assert.ok([4, 8, 12, 16].some((at) => lands(f.id, 80, (t) => (t < 2 ? INPUT.JUMP : press(INPUT.SPECIAL, at)(t)))), `${f.id} air special`);
    if (f.id !== 'shadow') assert.ok(lands(f.id, 150, press(INPUT.GRAB)), `${f.id} signature`); // (Shade Step strikes nothing: it steps behind)
    assert.ok(lands(f.id, 80, press(INPUT.SUPER)), `${f.id} finisher`);
  }
});
