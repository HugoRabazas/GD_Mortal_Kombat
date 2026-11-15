// Who is in a channel, and what each of them last said about themselves.
//
// The realtime service's presence says who is here, but it cannot carry a
// state that changes: a member who updates their presence more than about
// five times in a few seconds has their channel closed, with no error. So
// presence is published once, on joining, and each member's state (fighter,
// costume, ready...) travels as ordinary messages instead: told when it
// changes, told again when someone new arrives (who knows only what the
// others joined with), and repeated now and then in case one was lost.
// Presence can also lag by seconds, so a member whose messages are heard
// counts as here at once - until presence says they left, they say goodbye,
// or they fall silent.
//
// This file is that bookkeeping, with no network in it (bus.js feeds it), so
// it can be tested on its own.
//
//   createRoster({ id, state, tell, onChange, now, later })
//     tell(state)        send our state to everyone else
//     onChange(list)     the list changed: [{ id, ...state }]
//     now(), later(fn, ms) -> cancel()   the clock (replaced in tests)
//   roster.set(state)    our own state changed
//   roster.state(msg)    a state message arrived: { id, s }
//   roster.bye(msg)      a goodbye arrived: { id }
//   roster.presence(all) presence synced: { id: [meta, ...] }
//   roster.beat()        call every BEAT ms: repeat ours, drop the silent
//   roster.list(), roster.current(), roster.stop()

export const BEAT = 20000; // how often a member repeats their state
export const SILENCE = 50000; // unheard for this long (and not in presence): gone
const REPEAT = 1500; // a told state is told once more this much later

const timeout = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export function createRoster({ id, state, tell, onChange = () => {}, now = Date.now, later = timeout }) {
  let current = state;
  const known = new Map([[id, state]]); // the latest state of each member
  let present = []; // who is here, by presence
  const heard = new Map(); // id -> when last heard, for those presence has not shown (yet)
  const gone = new Set(); // said goodbye, though presence may list them for most of a minute yet
  let cancel = null;

  const here = () => {
    const t = now();
    for (const [peer, at] of heard) if (t - at > SILENCE) heard.delete(peer);
    return [...new Set([...present, ...heard.keys()])].filter((peer) => !gone.has(peer));
  };
  const list = () => here().map((peer) => ({ ...(known.get(peer) || {}), id: peer }));
  const changed = () => onChange(list());
  const announce = () => {
    tell(current);
    cancel?.();
    cancel = later(() => tell(current), REPEAT);
  };

  return {
    list,
    current: () => current,
    announce,
    set(next) {
      current = next;
      known.set(id, next);
      announce();
      changed();
    },
    state(msg) {
      if (!msg || typeof msg.id !== 'string' || msg.id === id || !msg.s || typeof msg.s !== 'object') return;
      const isNew = !present.includes(msg.id) && !heard.has(msg.id);
      known.set(msg.id, msg.s);
      gone.delete(msg.id);
      if (!present.includes(msg.id)) heard.set(msg.id, now());
      if (isNew) announce(); // they may not have heard of us either
      changed();
    },
    bye(msg) {
      if (!msg || typeof msg.id !== 'string' || msg.id === id) return;
      heard.delete(msg.id);
      gone.add(msg.id);
      changed();
    },
    presence(all) {
      const ids = Object.keys(all);
      const fresh = ids.some((peer) => peer !== id && !present.includes(peer) && !heard.has(peer));
      for (const peer of ids) if (!known.has(peer)) known.set(peer, all[peer][all[peer].length - 1]);
      for (const peer of present) {
        if (ids.includes(peer)) continue;
        known.delete(peer); // presence says they left
        heard.delete(peer);
      }
      for (const peer of gone) if (!ids.includes(peer)) gone.delete(peer); // ...and now presence agrees
      for (const peer of ids) heard.delete(peer); // presence has them now
      known.set(id, current);
      present = ids;
      if (fresh) announce(); // a newcomer knows only what we joined with
      changed();
    },
    beat() {
      tell(current);
      const before = heard.size;
      here();
      if (heard.size !== before) changed(); // someone fell silent
    },
    stop() {
      cancel?.();
    },
  };
}
