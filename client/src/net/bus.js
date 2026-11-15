// The "bus": named channels that everyone who joins can talk on, and that
// know who else is there (presence). Online play uses it for the alliance
// lobby, for each room, and to let two browsers find each other so they can
// open a direct connection.
//
// Two implementations with the same interface:
//   - Supabase Realtime, for real play over the internet;
//   - BroadcastChannel, which only reaches other tabs of the same browser.
//     It needs no network, and is what the automated tests use.
//
// A channel gives you:
//   send(type, data)         broadcast to everyone else on the channel
//   on(type, fn)             hear broadcasts: fn(data)
//   track(state)             publish your own presence state
//   peers()                  everyone present: [{ id, ...state }], you included
//   onPeers(fn)              called whenever that list changes
//   leave()

import { createClient } from '@supabase/supabase-js';

function emitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    emit(type, data) {
      for (const fn of map.get(type) || []) fn(data);
    },
  };
}

function supabaseBus({ url, key }) {
  const client = createClient(url, key, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 40 } } });
  return {
    kind: 'internet',
    channel(name, id, state) {
      // Presence says who is here, and nothing else: it is published once, on
      // joining. The service drops a member who updates their presence more
      // than about five times in a few seconds (no error, the channel just
      // closes), and picking fighters and costumes did exactly that. So each
      // member's state travels as ordinary messages instead: sent when it
      // changes, sent again when someone new arrives (who knows only what
      // the others joined with), and repeated now and then in case one was
      // lost on the way. Presence itself can lag by seconds, so a member
      // whose messages are heard counts as here at once (until presence says
      // they left, they say goodbye, or they fall silent).
      const events = emitter();
      let peersFn = () => {};
      let current = state;
      const known = new Map([[id, state]]); // the latest state heard from each member
      let present = []; // who is here, from presence
      const heard = new Map(); // id -> when last heard, for members presence has not shown (yet)
      const gone = new Map(); // id -> when they said goodbye (presence may still list them a moment)
      const SILENCE = 50000;
      const here = () => {
        const now = Date.now();
        for (const [peer, at] of heard) if (now - at > SILENCE) heard.delete(peer);
        for (const [peer, at] of gone) if (now - at > 10000) gone.delete(peer);
        return [...new Set([...present, ...heard.keys()])].filter((peer) => !gone.has(peer));
      };
      const list = () => here().map((peer) => ({ ...(known.get(peer) || {}), id: peer }));
      const ch = client.channel(name, { config: { broadcast: { self: false }, presence: { key: id } } });
      const tell = () => ch.send({ type: 'broadcast', event: 'st', payload: { id, s: current } });
      let again = null;
      const announce = () => {
        tell();
        clearTimeout(again);
        again = setTimeout(tell, 1500);
      };
      const beat = setInterval(() => {
        tell();
        const before = heard.size;
        if (here() && heard.size !== before) peersFn(list()); // someone fell silent
      }, 20000);
      ch.on('broadcast', { event: 'm' }, ({ payload }) => events.emit(payload.t, payload.d));
      ch.on('broadcast', { event: 'st' }, ({ payload }) => {
        if (!payload || typeof payload.id !== 'string' || payload.id === id || !payload.s || typeof payload.s !== 'object') return;
        const isNew = !present.includes(payload.id) && !heard.has(payload.id);
        known.set(payload.id, payload.s);
        gone.delete(payload.id);
        if (!present.includes(payload.id)) heard.set(payload.id, Date.now());
        if (isNew) announce(); // they may not have heard of us either
        peersFn(list());
      });
      ch.on('broadcast', { event: 'bye' }, ({ payload }) => {
        if (!payload || typeof payload.id !== 'string' || payload.id === id) return;
        heard.delete(payload.id);
        gone.set(payload.id, Date.now());
        peersFn(list());
      });
      ch.on('presence', { event: 'sync' }, () => {
        const all = ch.presenceState();
        const ids = Object.keys(all);
        const fresh = ids.some((peer) => peer !== id && !present.includes(peer));
        for (const peer of ids) if (!known.has(peer)) known.set(peer, all[peer][all[peer].length - 1]);
        for (const peer of present) {
          if (ids.includes(peer)) continue;
          known.delete(peer); // presence says they left
          heard.delete(peer);
        }
        for (const peer of ids) heard.delete(peer); // presence has them now
        known.set(id, current);
        present = ids;
        if (fresh) announce();
        peersFn(list());
      });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 12000);
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            await ch.track(current); // once per joining (again only after a dropped connection)
            announce();
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timer);
            reject(new Error(status));
          }
        });
      });
      return {
        ready,
        send: (t, d) => ch.send({ type: 'broadcast', event: 'm', payload: { t, d } }),
        on: events.on,
        track(next) {
          current = next;
          known.set(id, next);
          announce();
          peersFn(list());
        },
        peers: list,
        onPeers(fn) {
          peersFn = fn;
          fn(list());
        },
        leave() {
          clearTimeout(again);
          clearInterval(beat);
          ch.send({ type: 'broadcast', event: 'bye', payload: { id } });
          return client.removeChannel(ch);
        },
      };
    },
  };
}

function localBus() {
  return {
    kind: 'this browser only',
    channel(name, id, state) {
      const events = emitter();
      const bc = new BroadcastChannel(`gd-arena:${name}`);
      const known = new Map([[id, state]]);
      let peersFn = () => {};
      const list = () => [...known].map(([peer, st]) => ({ ...st, id: peer }));
      const changed = () => peersFn(list());
      bc.onmessage = ({ data }) => {
        if (data.p === 'hello') {
          known.set(data.id, data.state);
          bc.postMessage({ p: 'state', id, state: known.get(id) });
          changed();
        } else if (data.p === 'state') {
          known.set(data.id, data.state);
          changed();
        } else if (data.p === 'bye') {
          known.delete(data.id);
          changed();
        } else {
          events.emit(data.t, data.d);
        }
      };
      bc.postMessage({ p: 'hello', id, state });
      const bye = () => bc.postMessage({ p: 'bye', id });
      globalThis.addEventListener?.('pagehide', bye); // a page closing says goodbye
      return {
        ready: Promise.resolve(),
        send: (t, d) => bc.postMessage({ t, d }),
        on: events.on,
        track(next) {
          known.set(id, next);
          bc.postMessage({ p: 'state', id, state: next });
          changed();
        },
        peers: list,
        onPeers(fn) {
          peersFn = fn;
          fn(list());
        },
        leave() {
          bye();
          globalThis.removeEventListener?.('pagehide', bye);
          bc.close();
        },
      };
    },
  };
}

// config: { url, key } for the internet, or { local: true } for same-browser play.
export function createBus(config) {
  return config.local ? localBus() : supabaseBus(config);
}
