// Online play: the alliance lobby, rooms of up to four, and the match itself.
//
// How a match works over the network:
//   - One player in the room is the HOST (whoever has been in it longest). The
//     host's browser runs the real fight, with the same rules code as offline.
//   - Everyone else sends the host only the buttons they are holding.
//   - Twenty times a second the host sends everyone a snapshot of the fight.
//     The other browsers draw those snapshots, gliding between one and the next.
// So there is exactly one copy of the truth and nobody can drift out of sync.
//
// Players find each other through the bus (see bus.js). Game data then goes
// over a direct browser-to-browser link (link.js) when the networks allow it,
// and is relayed through the bus, at a lower rate, when they do not.

import { createBus } from './bus.js';
import { createLink } from './link.js';
import { createGame } from '../game.js';
import { createMatch } from '../../../shared/sim.js';
import { createAI, aiInput } from '../../../shared/ai.js';
import { FIGHTERS, isFighterId } from '../../../shared/fighters.js';
import { INPUT_MASK } from '../../../shared/constants.js';

const SNAP_EVERY = 3; // ticks between snapshots on a direct link (20 a second)
const RELAY_EVERY = 8; // ticks between snapshots when relayed (7.5 a second)
const MAX_PLAYERS = 4;

const newId = () => Math.random().toString(36).slice(2, 12);
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Fighter';
// Shorten floats so snapshots stay small on the wire.
const compact = (key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value);

// config: { url, key } or { local: true }. readInput() returns this player's buttons.
// onChange() is called whenever the lobby or the room changes; onStart(info)
// when a match begins; onEnd(reason) when it is over or the host is lost.
export function createOnline({ config, name, char, readInput, onChange, onStart, onEnd }) {
  const bus = createBus(config);
  const me = { id: newId(), name: cleanName(name) };
  let lobby = null;
  let room = null; // { code, ch, peers, hostId, links, at, char, ready }
  let match = null; // { info, game, mySlot, host }

  const online = {
    me,
    kind: bus.kind,
    lobbyPeers: [],
    get room() {
      return room;
    },
    get game() {
      return match ? match.game : null;
    },
    get mySlot() {
      return match ? match.mySlot : -1;
    },
    get info() {
      return match ? match.info : null;
    },
  };

  // ---------------------------------------------------------------- lobby ---

  const lobbyState = () => ({ name: me.name, room: room ? room.code : null, playing: !!match });

  online.connect = async () => {
    lobby = bus.channel('lobby', me.id, lobbyState());
    lobby.onPeers((list) => {
      online.lobbyPeers = list.map((p) => ({ id: p.id, name: cleanName(p.name), room: typeof p.room === 'string' ? p.room.slice(0, 8) : null, playing: !!p.playing }));
      onChange();
    });
    await lobby.ready;
  };

  // Rooms that are open right now, worked out from who says they are in one.
  online.rooms = () => {
    const map = new Map();
    for (const p of online.lobbyPeers) {
      if (!p.room) continue;
      if (!map.has(p.room)) map.set(p.room, { code: p.room, names: [], playing: false });
      const r = map.get(p.room);
      r.names.push(p.name);
      r.playing = r.playing || p.playing;
    }
    return [...map.values()];
  };

  // ----------------------------------------------------------------- room ---

  const roomState = () => ({ name: me.name, char: room.char, ready: room.ready, at: room.at });

  // Send game data to one member: directly when the link is up, otherwise
  // through the bus (and then only now and again, to stay within its limits).
  function sendTo(peerId, payload, relayNow) {
    const text = JSON.stringify(payload, compact);
    if (room.links.get(peerId)?.send(text)) return;
    if (relayNow) room.ch.send('relay', { to: peerId, from: me.id, d: text });
  }

  function linkTo(peerId, initiator) {
    let link = room.links.get(peerId);
    if (!link) {
      link = createLink({
        initiator,
        signal: (d) => room.ch.send('sig', { to: peerId, from: me.id, d }),
        onMessage: (text) => onData(peerId, text),
      });
      room.links.set(peerId, link);
    }
    return link;
  }

  function onPeers(list) {
    const peers = list
      .map((p) => ({ id: p.id, name: cleanName(p.name), char: isFighterId(p.char) ? p.char : FIGHTERS[0].id, ready: !!p.ready, at: Number(p.at) || 0 }))
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const hostBefore = room.hostId;
    room.peers = peers;
    room.hostId = peers.length ? peers[0].id : me.id;
    room.isHost = room.hostId === me.id;

    // Drop links to people who left; if the host changed, start over.
    for (const [id, link] of room.links) {
      if (!peers.some((p) => p.id === id) || (hostBefore && hostBefore !== room.hostId)) {
        link.close();
        room.links.delete(id);
      }
    }
    // The host opens a direct link to every other member.
    if (room.isHost) for (const p of peers) if (p.id !== me.id) linkTo(p.id, true);

    // Losing the host in the middle of a match ends it for everyone.
    if (match && !match.host && hostBefore && hostBefore !== room.hostId) stopMatch('host_left');
    onChange();
  }

  online.joinRoom = async (code) => {
    if (room) await online.leaveRoom();
    code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || newCode();
    room = { code, ch: null, peers: [], hostId: null, isHost: false, links: new Map(), at: Date.now(), char: char(), ready: false };
    const ch = bus.channel(`room-${code}`, me.id, roomState());
    room.ch = ch;
    ch.on('sig', (m) => {
      if (m.to !== me.id || !room) return;
      // Only the host opens links, so a signal is either from the host or for it.
      if (!room.isHost && m.from !== room.hostId) return;
      linkTo(m.from, false).handle(m.d);
    });
    ch.on('relay', (m) => {
      if (m.to === me.id || m.to === '*') onData(m.from, m.d);
    });
    ch.on('start', (info) => {
      if (!room.isHost) beginClient(info);
    });
    ch.on('end', () => {
      if (match && !match.host) stopMatch('finished');
    });
    ch.onPeers(onPeers);
    await ch.ready;
    lobby?.track(lobbyState());
    onChange();
    return code;
  };

  online.createRoom = () => online.joinRoom(newCode());

  online.leaveRoom = async () => {
    if (!room) return;
    if (match) stopMatch('left', true);
    for (const link of room.links.values()) link.close();
    room.ch.leave();
    room = null;
    lobby?.track(lobbyState());
    onChange();
  };

  online.setChar = (id) => {
    if (!room || !isFighterId(id)) return;
    room.char = id;
    room.ready = false;
    room.ch.track(roomState());
  };

  online.setReady = (ready) => {
    if (!room) return;
    room.ready = !!ready;
    room.ch.track(roomState());
  };

  // The first four members are the players; anyone after that watches.
  online.players = () => (room ? room.peers.slice(0, MAX_PLAYERS) : []);
  online.canStart = () => !!room && room.isHost && !match && online.players().every((p) => p.ready || p.id === me.id);

  // ---------------------------------------------------------------- match ---

  function onData(from, text) {
    if (!match || typeof text !== 'string' || text.length > 20000) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (match.host) {
      const slot = match.info.slots.findIndex((sl) => sl.id === from);
      if (slot >= 0 && typeof msg.i === 'number') match.remote[slot] = msg.i & INPUT_MASK;
    } else if (from === room.hostId && msg.s) {
      match.receive(msg.s);
    }
  }

  // Host: start a match with everyone who is in the room.
  online.start = ({ fill = true } = {}) => {
    if (!online.canStart()) return;
    const slots = online.players().map((p) => ({ id: p.id, name: p.name, char: p.char }));
    const spare = FIGHTERS.map((f) => f.id).filter((id) => !slots.some((sl) => sl.char === id));
    while (slots.length < 2 || (fill && slots.length < MAX_PLAYERS)) {
      slots.push({ cpu: true, name: 'CPU', char: spare.shift() || FIGHTERS[slots.length % FIGHTERS.length].id });
    }
    const info = { slots, mode: slots.length > 2 ? 'arena' : 'duel' };
    room.ch.send('start', info);
    beginHost(info);
  };

  function beginHost(info) {
    const remote = info.slots.map(() => 0);
    const controllers = info.slots.map((sl, i) => {
      if (sl.cpu) {
        const ai = createAI('normal', (Math.random() * 1e9) | 0);
        return (state, slot) => aiInput(ai, state, slot);
      }
      return sl.id === me.id ? () => readInput() : () => remote[i];
    });
    const inner = createGame(info.slots.map((sl) => sl.char), controllers, [], info.mode);
    const local = [];
    let recent = []; // events of the last moments, resent in case a snapshot is lost
    let lastSent = 0;
    let sends = 0;
    const game = {
      get state() {
        return inner.state;
      },
      paused: false,
      update(now) {
        inner.update(now);
        const events = inner.drain();
        if (events.length) {
          local.push(...events);
          recent.push(...events);
        }
        const s = inner.state;
        if (s.tick - lastSent < SNAP_EVERY) return;
        lastSent = s.tick;
        sends++;
        recent = recent.filter((e) => e.id > s.evSeq - 40);
        const { ev, ...state } = s;
        const snap = { state, ev: recent };
        // Straight to everyone with a direct link; for the rest, one relayed
        // copy for all of them, less often.
        const text = JSON.stringify({ s: snap }, compact);
        let unreached = 0;
        for (const p of room.peers) if (p.id !== me.id && !room.links.get(p.id)?.send(text)) unreached++;
        if (unreached && sends % Math.round(RELAY_EVERY / SNAP_EVERY) === 0) room.ch.send('relay', { to: '*', from: me.id, d: text });
      },
      drain: () => local.splice(0),
    };
    match = { info, game, host: true, remote, mySlot: info.slots.findIndex((sl) => sl.id === me.id) };
    lobby?.track(lobbyState());
    onStart(info);
  }

  function beginClient(info) {
    if (!info || !Array.isArray(info.slots) || info.slots.length < 2 || info.slots.length > MAX_PLAYERS) return;
    const slots = info.slots.map((sl) => ({ id: sl.id || null, cpu: !!sl.cpu, name: cleanName(sl.name), char: isFighterId(sl.char) ? sl.char : FIGHTERS[0].id }));
    const clean = { slots, mode: slots.length > 2 ? 'arena' : 'duel' };
    const mySlot = slots.findIndex((sl) => sl.id === me.id);
    let prev = null;
    let cur = null;
    let prevAt = 0;
    let curAt = 0;
    let view = createMatch(slots.map((sl) => sl.char), [], clean.mode);
    let seen = 0;
    const queue = [];
    let lastBits = -1;
    let lastSendAt = 0;
    const lerp = (a, b, k) => a + (b - a) * k;

    const game = {
      get state() {
        return view;
      },
      paused: false,
      update(now) {
        // Draw a moment behind the latest snapshot, gliding from the one before it.
        if (cur) {
          view = cur;
          if (prev && prev.round === cur.round && prev.f.length === cur.f.length) {
            const k = Math.min(1, Math.max(0, (now - curAt) / Math.max(30, curAt - prevAt)));
            view = {
              ...cur,
              f: cur.f.map((f, i) => ({ ...f, x: lerp(prev.f[i].x, f.x, k), z: lerp(prev.f[i].z, f.z, k), h: lerp(prev.f[i].h, f.h, k) })),
              proj: cur.proj.map((p) => {
                const old = prev.proj.find((q) => q.id === p.id);
                return old ? { ...p, x: lerp(old.x, p.x, k), z: lerp(old.z, p.z, k) } : p;
              }),
            };
          }
        }
        // Tell the host which buttons are down: at once when they change, and
        // a few times a second regardless in case a message was lost.
        if (mySlot >= 0) {
          const bits = readInput();
          if (bits !== lastBits || now - lastSendAt > 100) {
            sendTo(room.hostId, { i: bits }, bits !== lastBits || now - lastSendAt > 250);
            lastBits = bits;
            lastSendAt = now;
          }
        }
      },
      drain: () => queue.splice(0),
    };

    const receive = (snap) => {
      const s = snap.state;
      if (!s || !Array.isArray(s.f) || s.f.length !== slots.length) return;
      if (cur && s.tick <= cur.tick) return; // out of date
      prev = cur;
      prevAt = curAt;
      cur = s;
      curAt = performance.now();
      for (const e of snap.ev || []) {
        if (e.id > seen) {
          seen = e.id;
          queue.push(e);
        }
      }
    };

    match = { info: clean, game, host: false, receive, mySlot };
    lobby?.track(lobbyState());
    onStart(clean);
  }

  function stopMatch(reason, silent) {
    if (!match) return;
    const wasHost = match.host;
    match = null;
    if (wasHost && room) room.ch.send('end', {});
    if (room) {
      room.ready = false;
      room.ch.track(roomState());
    }
    lobby?.track(lobbyState());
    if (!silent) onEnd(reason);
  }

  // Anyone can go back to the room; when the host does, the match ends for all.
  online.endMatch = () => stopMatch('finished');

  // How this player's game data is travelling right now.
  online.linkKind = () => {
    if (!room || room.peers.length < 2) return 'alone';
    const ids = room.isHost ? room.peers.filter((p) => p.id !== me.id).map((p) => p.id) : [room.hostId];
    return ids.every((id) => room.links.get(id)?.isOpen()) ? 'direct' : 'relayed';
  };

  online.close = async () => {
    await online.leaveRoom();
    lobby?.leave();
    lobby = null;
  };

  return online;
}
