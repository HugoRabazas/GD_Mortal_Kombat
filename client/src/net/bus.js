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
import { createRoster, BEAT } from './roster.js';

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
      // Presence says who is here and is published once, on joining; each
      // member's state travels as messages (see roster.js for why and how).
      const events = emitter();
      let peersFn = () => {};
      const ch = client.channel(name, { config: { broadcast: { self: false }, presence: { key: id } } });
      const roster = createRoster({
        id,
        state,
        tell: (s) => ch.send({ type: 'broadcast', event: 'st', payload: { id, s } }),
        onChange: (list) => peersFn(list),
      });
      const beat = setInterval(roster.beat, BEAT);
      // A page that closes says goodbye on its way out: presence alone can
      // take most of a minute to notice a tab that just went.
      const bye = () => ch.send({ type: 'broadcast', event: 'bye', payload: { id } });
      globalThis.addEventListener?.('pagehide', bye);
      ch.on('broadcast', { event: 'm' }, ({ payload }) => events.emit(payload.t, payload.d));
      ch.on('broadcast', { event: 'st' }, ({ payload }) => roster.state(payload));
      ch.on('broadcast', { event: 'bye' }, ({ payload }) => roster.bye(payload));
      ch.on('presence', { event: 'sync' }, () => roster.presence(ch.presenceState()));
      const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 12000);
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timer);
            await ch.track(roster.current()); // once per joining (again only after a dropped connection)
            roster.announce();
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
        track: roster.set,
        peers: roster.list,
        onPeers(fn) {
          peersFn = fn;
          fn(roster.list());
        },
        leave() {
          roster.stop();
          clearInterval(beat);
          globalThis.removeEventListener?.('pagehide', bye);
          bye();
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
