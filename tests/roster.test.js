// The roster of an online channel (client/src/net/roster.js): who is here and
// what each member last said about themselves. Tested against a pretend
// service with the real one's two awkward habits: presence that cannot be
// updated more than a few times in a row (the channel closes), and presence
// news that may arrive late.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoster, SILENCE } from '../client/src/net/roster.js';

// A pretend service for one channel. `lag` holds presence news back until
// `service.sync()`; `drop(from, to)` loses a message on the way.
function makeService({ lag = false, drop = () => false } = {}) {
  const members = new Map(); // id -> { roster, meta, lists }
  const service = { time: 0, presencePublished: new Map(), timers: [] };
  const now = () => service.time;
  const later = (fn, ms) => {
    const timer = { at: service.time + ms, fn };
    service.timers.push(timer);
    return () => {
      timer.fn = null;
    };
  };
  service.pass = (ms) => {
    const end = service.time + ms;
    for (;;) {
      // Each timer runs at its own moment, in order.
      const due = service.timers.filter((t) => t.fn && t.at <= end).sort((p, q) => p.at - q.at)[0];
      if (!due) break;
      service.time = due.at;
      const fn = due.fn;
      due.fn = null;
      fn();
    }
    service.time = end;
  };
  service.sync = () => {
    const all = Object.fromEntries([...members].map(([id, m]) => [id, [m.meta]]));
    for (const m of members.values()) m.roster.presence(all);
  };
  service.join = (id, state) => {
    const member = { lists: [] };
    member.roster = createRoster({
      id,
      state,
      now,
      later,
      onChange: (list) => member.lists.push(list),
      tell: (s) => {
        for (const [other, m] of members) if (other !== id && !drop(id, other)) m.roster.state({ id, s });
      },
    });
    // Presence is published once, with the state of that moment.
    member.meta = state;
    service.presencePublished.set(id, (service.presencePublished.get(id) || 0) + 1);
    members.set(id, member);
    if (!lag) service.sync();
    member.roster.announce();
    return member.roster;
  };
  service.leave = (id, { goodbye = true } = {}) => {
    members.get(id).roster.stop();
    members.delete(id);
    if (goodbye) for (const m of members.values()) m.roster.bye({ id });
    if (!lag) service.sync();
  };
  service.view = (id) => Object.fromEntries(members.get(id).roster.list().map((p) => [p.id, `${p.char}/${p.look}${p.ready ? ' ready' : ''}`]));
  return service;
}

const fighter = (char, look = 0, ready = false) => ({ char, look, ready });

test('a burst of changes reaches everyone and never touches presence again', () => {
  const service = makeService();
  const ana = service.join('ana', fighter('ruko'));
  const beto = service.join('beto', fighter('shadow'));
  const chars = ['kichta', 'meru', 'zelrith', 'gleh', 'pixie', 'jackie'];
  for (let i = 0; i < 12; i++) {
    beto.set(fighter(chars[i % 6], i % 2));
    service.pass(500);
  }
  beto.set(fighter('kichta', 1, true));
  assert.deepEqual(service.view('ana'), { ana: 'ruko/0', beto: 'kichta/1 ready' });
  assert.deepEqual(service.view('beto'), { ana: 'ruko/0', beto: 'kichta/1 ready' });
  // (The real service closes the channel of whoever updates presence six times running.)
  assert.equal(service.presencePublished.get('beto'), 1);
  assert.equal(service.presencePublished.get('ana'), 1);
  assert.ok(ana.list().length === 2);
});

test('someone who arrives later sees what everyone has chosen since they joined', () => {
  const service = makeService();
  service.join('ana', fighter('ruko'));
  const beto = service.join('beto', fighter('shadow'));
  beto.set(fighter('meru', 1, true)); // long after joining: presence still says shadow/0
  service.pass(5000);
  service.join('caro', fighter('pixie'));
  assert.deepEqual(service.view('caro'), { ana: 'ruko/0', beto: 'meru/1 ready', caro: 'pixie/0' });
  assert.deepEqual(service.view('ana'), { ana: 'ruko/0', beto: 'meru/1 ready', caro: 'pixie/0' });
});

test('with presence running late, a member counts as here from their first message', () => {
  const service = makeService({ lag: true });
  service.join('ana', fighter('ruko'));
  service.join('beto', fighter('shadow'));
  // No presence news has arrived at all yet.
  assert.deepEqual(service.view('ana'), { beto: 'shadow/0' }, 'heard, so here (presence has not even shown Ana herself)');
  assert.deepEqual(service.view('beto'), { ana: 'ruko/0' }, 'and Ana answered the newcomer');
  service.sync();
  assert.deepEqual(service.view('ana'), { ana: 'ruko/0', beto: 'shadow/0' }, 'presence confirms: nobody listed twice');
  assert.deepEqual(service.view('beto'), { ana: 'ruko/0', beto: 'shadow/0' });
});

test('leaving: a goodbye removes at once, presence removes for good, the silent expire', () => {
  const service = makeService({ lag: true });
  service.join('ana', fighter('ruko'));
  service.join('beto', fighter('shadow'));
  service.join('caro', fighter('pixie'));
  service.sync();
  service.leave('beto'); // says goodbye; presence still lists them
  assert.deepEqual(Object.keys(service.view('ana')).sort(), ['ana', 'caro']);
  service.pass(40000); // presence can go on listing a closed tab for most of a minute
  assert.deepEqual(Object.keys(service.view('ana')).sort(), ['ana', 'caro'], 'the goodbye holds until presence agrees');
  service.sync();
  assert.deepEqual(Object.keys(service.view('ana')).sort(), ['ana', 'caro']);
  // Someone with the same name coming back is heard, and listed again.
  service.join('beto', fighter('meru'));
  assert.equal(service.view('ana').beto, 'meru/0');
  service.leave('beto');
  service.sync();

  // A tab that just closes says nothing: presence takes them off.
  service.leave('caro', { goodbye: false });
  assert.equal(Object.keys(service.view('ana')).length, 2, 'not known yet');
  service.sync();
  assert.deepEqual(Object.keys(service.view('ana')), ['ana']);

  // Heard but never shown by presence, then silent: gone after a while.
  const lost = makeService({ lag: true });
  const dana = lost.join('dana', fighter('ruko'));
  lost.join('eli', fighter('gleh'));
  assert.ok('eli' in lost.view('dana'));
  lost.pass(SILENCE + 5000); // (past the repeat of their first message, too)
  dana.beat();
  assert.ok(!('eli' in lost.view('dana')));
});

test('a message lost on the way is made good by the repeat and the regular beat', () => {
  let losing = true;
  const service = makeService({ drop: (from, to) => losing && from === 'beto' && to === 'ana' });
  service.join('ana', fighter('ruko'));
  const beto = service.join('beto', fighter('shadow'));
  beto.set(fighter('zelrith', 1));
  assert.equal(service.view('ana').beto, 'shadow/0', 'Ana missed it');
  losing = false;
  service.pass(1600); // the repeat, a moment later
  assert.equal(service.view('ana').beto, 'zelrith/1');

  // Both the message and its repeat lost: the beat still brings it.
  losing = true;
  beto.set(fighter('meru', 0));
  service.pass(1600);
  assert.equal(service.view('ana').beto, 'zelrith/1');
  losing = false;
  beto.beat();
  assert.equal(service.view('ana').beto, 'meru/0');
});

test('rubbish on the channel is ignored', () => {
  const service = makeService();
  const ana = service.join('ana', fighter('ruko'));
  for (const msg of [null, {}, { id: 5, s: {} }, { id: 'x' }, { id: 'x', s: 'no' }, { id: 'ana', s: fighter('pixie') }]) ana.state(msg);
  for (const msg of [null, {}, { id: 7 }, { id: 'ana' }]) ana.bye(msg);
  assert.deepEqual(service.view('ana'), { ana: 'ruko/0' });
});
