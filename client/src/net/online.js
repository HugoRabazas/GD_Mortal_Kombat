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
import { createInputSender, createInputReceiver, createSnapshotMeter } from './inputs.js';
import { createGame } from '../game.js';
import { ARENAS, isArenaId } from '../arenas.js';
import { createMatch } from '../../../shared/sim.js';
import { createAI, aiInput } from '../../../shared/ai.js';
import { FIGHTERS, getFighter, isFighterId, lookCount } from '../../../shared/fighters.js';
import { INPUT, INPUT_MASK } from '../../../shared/constants.js';

const SNAP_EVERY = 3; // ticks between snapshots on a direct link (20 a second)
const RELAY_EVERY = 8; // ticks between snapshots when relayed (7.5 a second)
const MAX_PLAYERS = 4;
const WALK = 3.5; // walking speed in the rules, pixels a tick
const LEAD_MAX = 14; // never draw a guest's own fighter more than this many ticks ahead

const newId = () => Math.random().toString(36).slice(2, 12);
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
const cleanText = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 140);
const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Fighter';
// Shorten floats so snapshots stay small on the wire.
const compact = (key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 10) / 10 : value);

// config: { url, key } or { local: true }. readInput() returns this player's buttons.
// onChange() is called whenever the lobby or the room changes; onStart(info)
// when a match begins; onEnd(reason) when it is over or the host is lost.
// `version` identifies this build of the game: everyone in a room must run the
// same one, or the host and its guests would disagree about the rules.
// `arena` returns the arena this player would host a fight in; the room shows
// everyone the host's choice.
// A win count someone sent: a whole number, never negative or absurd.
const cleanWins = (n) => Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));

// A costume number someone sent, checked against the fighter's real costumes.
const cleanLook = (char, look) => (Number.isInteger(look) && look >= 0 && look < lookCount(char) ? look : 0);

export function createOnline({ config, name, char, arena = () => ARENAS[0].id, look = () => 0, wins = () => 0, version, readInput, onChange, onStart, onEnd, onHeard = () => {} }) {
  const bus = createBus(config);
  const me = { id: newId(), name: cleanName(name) };
  let lobby = null;
  let room = null; // { code, ch, peers, hostId, links, at, char, ready }
  let match = null; // { info, game, mySlot, host }

  const online = {
    me,
    kind: bus.kind,
    lobbyPeers: [],
    chat: [], // the last few messages heard, in the lobby or in the room
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

  // ----------------------------------------------------------------- chat ---
  // Messages go to whoever is in the same place (the lobby, or your room) at
  // that moment. Nothing is stored anywhere: leave, and they are gone.
  let lastSaid = 0;
  function heard(msg, mine) {
    const text = cleanText(msg?.text);
    if (!text) return;
    online.chat.push({ name: cleanName(msg.name), text, mine: !!mine });
    if (online.chat.length > 40) online.chat.shift();
    if (!mine) onHeard(); // someone else spoke
    onChange();
  }
  online.say = (text) => {
    const clean = cleanText(text);
    const now = Date.now();
    if (!clean || now - lastSaid < 700) return false; // no flooding
    lastSaid = now;
    const msg = { name: me.name, text: clean };
    (room ? room.ch : lobby)?.send('chat', msg);
    heard(msg, true);
    return true;
  };

  // ---------------------------------------------------------------- lobby ---

  // What the lobby sees of each player: name, room, whether they are fighting,
  // and the fighter they have picked (shown as a portrait next to the name).
  // `wins`: fights this player has won on their device, all time (shown in the lobby).
  const lobbyState = () => ({ name: me.name, room: room ? room.code : null, playing: !!match, char: room ? room.char : char(), arena: room ? online.arena() : null, wins: cleanWins(wins()) });

  online.connect = async () => {
    lobby = bus.channel('lobby', me.id, lobbyState());
    lobby.onPeers((list) => {
      online.lobbyPeers = list.map((p) => ({ id: p.id, name: cleanName(p.name), room: typeof p.room === 'string' ? p.room.slice(0, 8) : null, playing: !!p.playing, char: isFighterId(p.char) ? p.char : FIGHTERS[0].id, arena: isArenaId(p.arena) ? p.arena : null, wins: cleanWins(p.wins) }));
      onChange();
    });
    lobby.on('chat', (m) => {
      if (!room) heard(m);
    });
    await lobby.ready;
  };

  // Rooms that are open right now, worked out from who says they are in one.
  online.rooms = () => {
    const map = new Map();
    for (const p of online.lobbyPeers) {
      if (!p.room) continue;
      if (!map.has(p.room)) map.set(p.room, { code: p.room, names: [], chars: [], playing: false });
      const r = map.get(p.room);
      r.names.push(p.name);
      r.chars.push(p.char);
      r.arena = r.arena || p.arena; // every member reports the host's arena
      r.playing = r.playing || p.playing;
    }
    // Rooms with a free place first, then the fullest; fights in progress last.
    return [...map.values()].sort((a, b) => a.playing - b.playing || (a.names.length >= MAX_PLAYERS) - (b.names.length >= MAX_PLAYERS) || b.names.length - a.names.length);
  };
  online.maxPlayers = MAX_PLAYERS;

  // ----------------------------------------------------------------- room ---

  const roomState = () => ({ name: me.name, char: room.char, look: room.look, ready: room.ready, at: room.at, v: version, arena: room.arena });

  // Send game data to one member: directly when the link is up, otherwise
  // through the bus (and then only now and again, to stay within its limits).
  function sendTo(peerId, payload, relayNow) {
    const text = JSON.stringify(payload, compact);
    if (room.links.get(peerId)?.send(text)) return;
    if (relayNow) room.ch.send('relay', { to: peerId, from: me.id, d: text });
  }

  // A direct link to one member, opened on first use. Where the browser has
  // no WebRTC (switched off for privacy, or not there at all) there is no
  // link and everything goes through the bus instead: slower, but it works.
  const canLink = typeof RTCPeerConnection !== 'undefined';
  online.canLink = canLink;
  function linkTo(peerId, initiator) {
    if (!canLink) return null;
    let link = room.links.get(peerId);
    if (!link) {
      try {
        link = createLink({
          initiator,
          signal: (d) => room.ch.send('sig', { to: peerId, from: me.id, d }),
          onMessage: (text) => onData(peerId, text),
        });
      } catch {
        return null; // WebRTC refused to start: stay on the bus
      }
      room.links.set(peerId, link);
    }
    return link;
  }

  function onPeers(list) {
    const peers = list
      .map((p) => ({ id: p.id, name: cleanName(p.name), char: isFighterId(p.char) ? p.char : FIGHTERS[0].id, ready: !!p.ready, at: Number(p.at) || 0, same: p.v === version, arena: isArenaId(p.arena) ? p.arena : ARENAS[0].id, look: cleanLook(isFighterId(p.char) ? p.char : FIGHTERS[0].id, p.look) }))
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    const hostBefore = room.hostId;
    room.peers = peers;
    room.hostId = peers.length ? peers[0].id : me.id;
    room.isHost = room.hostId === me.id;
    room.mixed = peers.some((p) => !p.same); // somebody is on another version
    if (lobby && room.lobbyArena !== online.arena()) {
      room.lobbyArena = online.arena();
      lobby.track(lobbyState());
    }

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
    room = { code, ch: null, peers: [], hostId: null, isHost: false, links: new Map(), at: Date.now(), char: char(), look: look(), ready: false, arena: arena() };
    online.chat = []; // a room starts with a clean slate
    const ch = bus.channel(`room-${code}`, me.id, roomState());
    room.ch = ch;
    ch.on('sig', (m) => {
      if (m.to !== me.id || !room) return;
      // Only the host opens links, so a signal is either from the host or for it.
      if (!room.isHost && m.from !== room.hostId) return;
      linkTo(m.from, false)?.handle(m.d);
    });
    ch.on('relay', (m) => {
      if (m.to === me.id || m.to === '*') onData(m.from, m.d);
    });
    ch.on('chat', (m) => heard(m));
    ch.on('start', (info) => {
      if (!room.isHost) beginClient(info);
    });
    ch.on('away', (m) => {
      if (match && !match.host) match.hostAway = !!m?.on;
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

  // One press to a fight: the open room with a free place and the most people
  // in it (the lobby lists them in that order), or a new room if there is none.
  online.quickMatch = () => {
    const open = online.rooms().find((r) => !r.playing && r.names.length < MAX_PLAYERS);
    return open ? online.joinRoom(open.code) : online.createRoom();
  };

  online.leaveRoom = async () => {
    if (!room) return;
    if (match) stopMatch('left', true);
    for (const link of room.links.values()) link.close();
    room.ch.leave();
    room = null;
    online.chat = [];
    lobby?.track(lobbyState());
    onChange();
  };

  // Pick a costume for your fighter (sent with your place in the room).
  online.setLook = (n) => {
    if (!room) return;
    room.look = cleanLook(room.char, n);
    room.ch.track(roomState());
  };

  online.setChar = (id) => {
    if (!room || !isFighterId(id)) return;
    room.char = id;
    room.look = cleanLook(id, room.look);
    room.ready = false;
    room.ch.track(roomState());
    lobby?.track(lobbyState());
  };

  // Tell the room which arena this player has picked (it matters for the host).
  online.setArena = (id) => {
    if (!room || !isArenaId(id) || room.arena === id) return;
    room.arena = id;
    room.ch.track(roomState());
  };

  // The arena the next fight in this room will be held in: the host's choice.
  online.arena = () => room?.peers.find((p) => p.id === room.hostId)?.arena ?? ARENAS[0].id;

  online.setReady = (ready) => {
    if (!room) return;
    room.again = false;
    room.ready = !!ready;
    room.ch.track(roomState());
  };

  // The first four members are the players; anyone after that watches.
  online.players = () => (room ? room.peers.slice(0, MAX_PLAYERS) : []);
  online.canStart = () => !!room && room.isHost && !match && !room.mixed && online.players().every((p) => p.ready || p.id === me.id);

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
      if (slot >= 0 && (typeof msg.i === 'number' || Array.isArray(msg.h))) match.remote[slot].take(msg);
      if (slot >= 0 && typeof msg.p === 'number') match.pings[slot] = Math.max(0, Math.round(msg.p)); // (the guest's own measure)
      if (typeof msg.ping === 'number') sendTo(from, { pong: msg.ping }, true); // answer a guest timing the trip
    } else if (from === room.hostId) {
      if (msg.s) match.receive(msg.s);
      if (typeof msg.pong === 'number') {
        match.ping = Math.round(performance.now() - msg.pong);
        match.meter?.ping(match.ping);
      }
    }
  }

  // Host: start a match with everyone who is in the room.
  online.start = ({ fill = true, arena = ARENAS[0].id } = {}) => {
    if (!online.canStart()) return;
    const slots = online.players().map((p) => ({ id: p.id, name: p.name, char: p.char, look: p.look }));
    const spare = FIGHTERS.map((f) => f.id).filter((id) => !slots.some((sl) => sl.char === id));
    while (slots.length < 2 || (fill && slots.length < MAX_PLAYERS)) {
      slots.push({ cpu: true, name: 'CPU', char: spare.shift() || FIGHTERS[slots.length % FIGHTERS.length].id });
    }
    const info = { slots, mode: slots.length > 2 ? 'arena' : 'duel', arena: isArenaId(arena) ? arena : ARENAS[0].id };
    room.ch.send('start', info);
    beginHost(info);
  };

  function beginHost(info) {
    if (room) room.again = false;
    // Each guest's buttons, kept so a lost message never swallows a press.
    const remote = info.slots.map(() => createInputReceiver(INPUT_MASK));
    const controllers = info.slots.map((sl, i) => {
      if (sl.cpu) {
        const ai = createAI('normal', (Math.random() * 1e9) | 0);
        return (state, slot) => aiInput(ai, state, slot);
      }
      return sl.id === me.id ? () => readInput() : () => remote[i].next();
    });
    const inner = createGame(info.slots.map((sl) => sl.char), controllers, [], info.mode);
    const local = [];
    let recent = []; // events of the last moments, resent in case a snapshot is lost
    let lastSent = 0;
    let sends = 0;
    let lastFrame = 0;
    let frameMs = 16.7; // a smoothed measure of this device's frame time
    // Gone to another app: the fight stops here (the browser stops drawing),
    // so tell the guests why their screens froze.
    const away = () => room?.ch.send('away', { on: document.hidden });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', away);
    const game = {
      get state() {
        return inner.state;
      },
      paused: false,
      update(now) {
        if (lastFrame) frameMs += (Math.min(1000, now - lastFrame) - frameMs) * 0.05;
        lastFrame = now;
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
        const snap = { state, ev: recent, hf: Math.round(1000 / frameMs) };
        // Straight to everyone with a direct link; for the rest, one relayed
        // copy for all of them, less often.
        const text = JSON.stringify({ s: snap }, compact);
        let unreached = 0;
        for (const p of room.peers) if (p.id !== me.id && !room.links.get(p.id)?.send(text)) unreached++;
        if (unreached && sends % Math.round(RELAY_EVERY / SNAP_EVERY) === 0) room.ch.send('relay', { to: '*', from: me.id, d: text });
      },
      drain: () => local.splice(0),
    };
    match = {
      info,
      game,
      host: true,
      remote,
      pings: info.slots.map(() => null),
      fps: () => Math.round(1000 / frameMs),
      mySlot: info.slots.findIndex((sl) => sl.id === me.id),
      stop: () => typeof document !== 'undefined' && document.removeEventListener('visibilitychange', away),
    };
    lobby?.track(lobbyState());
    onStart(info);
  }

  function beginClient(info) {
    if (room) room.again = false;
    if (!info || !Array.isArray(info.slots) || info.slots.length < 2 || info.slots.length > MAX_PLAYERS) return;
    const slots = info.slots.map((sl) => {
      const char = isFighterId(sl.char) ? sl.char : FIGHTERS[0].id;
      return { id: sl.id || null, cpu: !!sl.cpu, name: cleanName(sl.name), char, look: cleanLook(char, sl.look) };
    });
    const clean = { slots, mode: slots.length > 2 ? 'arena' : 'duel', arena: isArenaId(info.arena) ? info.arena : ARENAS[0].id };
    const mySlot = slots.findIndex((sl) => sl.id === me.id);
    let prev = null;
    let cur = null;
    let prevAt = 0;
    let curAt = 0;
    let view = createMatch(slots.map((sl) => sl.char), [], clean.mode);
    let seen = 0;
    const queue = [];
    const sender = createInputSender();
    const meter = createSnapshotMeter(SNAP_EVERY);
    let lastSendAt = 0;
    let lastPingAt = 0;
    const lead = { x: 0, z: 0 }; // how far ahead of the host's word our own fighter is drawn
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
        if (now - lastPingAt > 2000) {
          lastPingAt = now;
          sendTo(room.hostId, { ping: performance.now() }, true);
        }
        const bits = mySlot >= 0 ? readInput() : 0;

        // What the guest sees of their own fighter is the host's answer, which
        // arrives late. While simply walking, we know where the fighter will be
        // by the time the host's answer catches up - so draw it there. The lead
        // grows as you set off and melts away as you stop, attack or get hit,
        // and the host's word is still what decides every hit.
        if (mySlot >= 0 && cur) {
          const f = view.f[mySlot];
          const free = cur.phase === 'fight' && (f.state === 'idle' || f.state === 'walk') && !f.stun;
          const mx = (bits & INPUT.RIGHT ? 1 : 0) - (bits & INPUT.LEFT ? 1 : 0);
          const mz = (bits & INPUT.DOWN ? 1 : 0) - (bits & INPUT.UP ? 1 : 0);
          const moving = free && (mx || mz) && !(bits & INPUT.BLOCK);
          let tx = 0;
          let tz = 0;
          if (moving) {
            const len = Math.hypot(mx, mz);
            const ticks = Math.min(LEAD_MAX, ((match?.ping ?? 60) + 75) / 16.7);
            const step = WALK * getFighter(f.char).stats.speed * ticks;
            tx = (mx / len) * step;
            tz = (mz / len) * step;
          }
          lead.x += (tx - lead.x) * 0.25;
          lead.z += (tz - lead.z) * 0.25;
          if (Math.abs(lead.x) + Math.abs(lead.z) > 0.5) {
            let x = f.x + lead.x;
            let z = f.z + lead.z;
            const r = Math.hypot(x, z);
            const limit = cur.ringR - 24;
            if (r > limit) {
              x *= limit / r;
              z *= limit / r;
            }
            const mine = { ...f, x, z, dir: moving ? Math.atan2(mz, mx) : f.dir, state: moving ? 'walk' : f.state };
            view = { ...view, f: view.f.map((o, i) => (i === mySlot ? mine : o)) };
          }
        }

        if (mySlot >= 0) {
          // The buttons now down and the last few changes (see inputs.js), with
          // our measure of the trip for the host's own panel.
          const changed = sender.note(bits);
          if (changed || now - lastSendAt > 100) {
            sendTo(room.hostId, { ...sender.message(), p: match?.ping ?? undefined }, changed || now - lastSendAt > 250);
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
      meter.got(s.tick, curAt, online.linkKind() === 'direct' ? SNAP_EVERY : SNAP_EVERY * Math.round(RELAY_EVERY / SNAP_EVERY));
      if (typeof snap.hf === 'number') match.hostFps = snap.hf;
      for (const e of snap.ev || []) {
        if (e.id > seen) {
          seen = e.id;
          queue.push(e);
        }
      }
    };

    match = { info: clean, game, host: false, receive, mySlot, ping: null, meter, hostFps: null, hostAway: false };
    lobby?.track(lobbyState());
    onStart(clean);
  }

  function stopMatch(reason, silent) {
    if (!match) return;
    const wasHost = match.host;
    match.stop?.();
    lastReport = report(match);
    // Kept on this device (the last ten), so a laggy match can be looked into later.
    try {
      const log = JSON.parse(localStorage.getItem('gd-arena-netlog') || '[]');
      log.push({ at: new Date().toISOString(), host: !!match.host, players: match.info.slots.filter((sl) => !sl.cpu).length, report: lastReport });
      localStorage.setItem('gd-arena-netlog', JSON.stringify(log.slice(-10)));
    } catch {
      // not kept (no storage here)
    }
    match = null;
    if (wasHost && room) room.ch.send('end', {});
    if (room) {
      // After a fight that finished, everyone who fought stays ready, so one
      // more is a single press for the host. Anyone who wants to sit the next
      // one out presses Not ready. If the host left, everyone starts over.
      if (reason !== 'finished') room.ready = false;
      room.again = reason === 'finished';
      room.ch.track(roomState());
    }
    lobby?.track(lobbyState());
    if (!silent) onEnd(reason);
  }

  // Anyone can go back to the room; when the host does, the match ends for all.
  online.endMatch = () => stopMatch('finished');

  // A short line for the corner of the screen during a fight: how the game
  // data travels, the trip to the host, pictures a second and how many were
  // lost - and, for a guest, the host's frame rate when it is low (the whole
  // fight runs on the host's device) or the host having left the game.
  online.status = () => {
    if (!match) return '';
    const kind = online.linkKind() === 'relayed' ? 'RELAYED' : 'DIRECT';
    if (match.host) {
      const pings = match.pings.filter((x, i) => x !== null && i !== match.mySlot);
      return `HOST · ${kind} · ${match.fps()} FPS${pings.length ? ` · PINGS ${pings.join('/')} MS` : ''}`;
    }
    if (match.hostAway) return 'HOST AWAY · THEIR GAME IS PAUSED';
    const m = match.meter;
    const loss = m.lossPct();
    const slow = match.hostFps !== null && match.hostFps < 45 ? ` · HOST ${match.hostFps} FPS` : '';
    return `${kind}${match.ping !== null ? ` · ${match.ping} MS` : ''} · ${m.perSecond()}/S${loss ? ` · ${loss}% LOST` : ''}${slow}`;
  };

  // How the last match travelled, in a line for the result screen.
  let lastReport = '';
  function report(m) {
    if (!m) return '';
    const kind = online.linkKind() === 'relayed' ? 'relayed through the server' : 'direct';
    if (m.host) {
      const pings = m.pings.filter((x, i) => x !== null && i !== m.mySlot);
      return `You hosted: ${kind}, ${m.fps()} fps${pings.length ? `, guests' pings ${pings.join(', ')} ms` : ''}.`;
    }
    const r = m.meter.report();
    return `Your link: ${kind}${r.pingAvg !== null ? `, ping ${r.pingAvg} ms (worst ${r.pingMax})` : ''}, ${r.lossPct}% of updates lost${m.hostFps !== null && m.hostFps < 45 ? `, host at ${m.hostFps} fps` : ''}.`;
  }
  online.netReport = () => (match ? report(match) : lastReport);

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
