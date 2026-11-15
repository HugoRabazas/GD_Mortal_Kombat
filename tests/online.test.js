// Online rooms, end to end, without a browser: two players meet on the local
// bus (BroadcastChannel, which Node has too), make a room, get ready, fight,
// and come back for one more. Node has no WebRTC, so this also proves that
// play falls back to the bus when a browser cannot open a direct link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnline } from '../client/src/net/online.js';

const until = async (check, what, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

function player(name, char) {
  const log = { starts: [], ends: [] };
  const online = createOnline({
    config: { local: true },
    name,
    char: () => char,
    arena: () => 'frost',
    version: 'test',
    readInput: () => 0,
    onChange: () => {},
    onStart: (info) => log.starts.push(info),
    onEnd: (reason) => log.ends.push(reason),
  });
  return { online, log };
}

test('two players meet, fight, and one press of the host starts the next fight', async () => {
  const ana = player('Ana', 'jackie');
  const beto = player('Beto', 'pixie');
  try {
    await ana.online.connect();
    await beto.online.connect();
    const code = await ana.online.createRoom();
    await until(() => beto.online.rooms().some((r) => r.code === code), 'the room to show in the lobby');
    const listed = beto.online.rooms().find((r) => r.code === code);
    assert.deepEqual(listed.chars, ['jackie'], 'the lobby shows the fighter inside');

    await beto.online.joinRoom(code);
    await until(() => ana.online.players().length === 2, 'Beto to arrive');
    assert.equal(ana.online.canStart(), false, 'not before Beto is ready');
    beto.online.setLook(1); // Frost, Pixie's second costume
    beto.online.setReady(true);
    await until(() => ana.online.canStart(), 'Beto to be ready');
    assert.equal(beto.online.arena(), 'frost', "the guest sees the host's arena");

    ana.online.start({ fill: false, arena: 'frost' });
    await until(() => beto.log.starts.length === 1, 'the fight to start for Beto');
    const info = beto.log.starts[0];
    assert.equal(info.mode, 'duel');
    assert.equal(info.arena, 'frost');
    assert.deepEqual(info.slots.map((sl) => sl.char), ['jackie', 'pixie']);
    assert.deepEqual(info.slots.map((sl) => sl.look), [0, 1], 'costumes travel with the players');
    assert.equal(ana.online.linkKind(), 'relayed', 'no WebRTC here: the bus carries the fight');

    // The host runs the fight; a few frames go by and reach the guest.
    // Both screens draw frames as they would in a browser: the host's runs the
    // fight, the guest's turns the snapshots it hears into what it shows.
    await until(() => {
      const now = performance.now();
      ana.online.game.update(now);
      beto.online.game.update(now);
      return beto.online.game.state.tick > 0;
    }, 'a snapshot to reach Beto');

    ana.online.endMatch();
    await until(() => beto.log.ends.includes('finished'), 'the end to reach Beto');
    const mine = () => ana.online.room.peers.find((p) => p.name === 'Beto');
    assert.equal(beto.online.room.again, true);
    await until(() => mine()?.ready === true, 'Beto still ready on Ana\'s side');
    assert.equal(ana.online.canStart(), true, 'one press starts the next fight');

    // Sitting the next one out clears it.
    beto.online.setReady(false);
    await until(() => !ana.online.canStart(), 'Not ready to arrive');
    assert.equal(beto.online.room.again, false);
  } finally {
    await ana.online.close();
    await beto.online.close();
  }
});
