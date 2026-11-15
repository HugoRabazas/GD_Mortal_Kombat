import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch, step, MOVES, AIR_SPECIAL } from '../shared/sim.js';
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
