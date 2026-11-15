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
      const events = emitter();
      let list = [];
      let peersFn = () => {};
      const ch = client.channel(name, { config: { broadcast: { self: false }, presence: { key: id } } });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => events.emit(payload.t, payload.d));
      ch.on('presence', { event: 'sync' }, () => {
        const all = ch.presenceState();
        list = Object.entries(all).map(([peer, metas]) => ({ ...metas[metas.length - 1], id: peer }));
        peersFn(list);
      });
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 12000);
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            await ch.track(state);
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
        track: (next) => ch.track(next),
        peers: () => list,
        onPeers(fn) {
          peersFn = fn;
          fn(list);
        },
        leave: () => client.removeChannel(ch),
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
