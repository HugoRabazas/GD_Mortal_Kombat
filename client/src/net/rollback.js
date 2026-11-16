// Rollback: every player runs the whole fight; only buttons travel.
//
// Each device steps the same fight from the same start. Its own buttons are
// known at once; a rival's for a tick may still be on the way - then the
// device guesses them (the same as that player's last known buttons: right
// most of the time) and carries on. When the real buttons arrive and differ
// from the guess, it goes back to that tick (a copy of the fight is kept for
// each recent tick), puts the right buttons in, and plays the ticks since
// again in one go. Your own fighter never waits; a rival only jumps when a
// guess was wrong.
//
// The fight is a `world` (here: the rules' state plus the CPU fighters'
// minds) that `step(world, buttons)` moves one tick and `copy(world)`
// duplicates. Everything here is plain data in, plain data out, so the whole
// thing is tested in Node with players on simulated networks.

const KEEP = 150; // sure ticks kept, for the referee

export function createRollback({ world, players, mine, step, copy, maxBehind = 12 }) {
  // players: how many fighters have buttons (CPU fighters are inside `world`).
  // mine: the indices whose buttons come from this device.
  const own = new Set(mine);
  const known = Array.from({ length: players }, () => new Map()); // tick -> buttons, for sure
  const lastKnown = Array.from({ length: players }, () => ({ tick: -1, bits: 0 })); // the latest sure buttons
  const heardUpTo = Array.from({ length: players }, (_, i) => (own.has(i) ? Infinity : -1)); // every tick up to here known
  const used = new Map(); // tick -> the buttons the fight was stepped with
  const saved = new Map(); // tick -> a copy of the world just before that tick
  let tick = 0; // the next tick to play
  let redoFrom = Infinity; // the earliest tick played with a wrong guess
  let rollbacks = 0;
  let replayed = 0;

  // The buttons of player p at tick t: sure if known, else the guess.
  const buttonsAt = (p, t) => {
    const k = known[p].get(t);
    if (k !== undefined) return k;
    // the latest sure buttons at or before t
    for (let u = Math.min(t, lastKnown[p].tick); u >= 0; u--) {
      const b = known[p].get(u);
      if (b !== undefined) return b;
    }
    return 0;
  };

  const play = (t) => {
    saved.set(t, copy(world));
    const bits = Array.from({ length: players }, (_, p) => buttonsAt(p, t));
    used.set(t, bits);
    return step(world, bits);
  };

  // The earliest tick some rival has not been heard for.
  const sureUpTo = () => Math.min(...heardUpTo);

  const learn = (p, t, bits) => {
    if (known[p].has(t)) return;
    known[p].set(t, bits);
    if (t > lastKnown[p].tick) lastKnown[p] = { tick: t, bits };
    while (known[p].has(heardUpTo[p] + 1)) heardUpTo[p]++;
    // Played already with other buttons: those ticks must be played again.
    const was = used.get(t);
    if (was && was[p] !== bits) redoFrom = Math.min(redoFrom, t);
  };

  return {
    get world() {
      return world;
    },
    get tick() {
      return tick;
    },
    // This device's buttons for player p at tick t (usually the coming tick
    // plus a small delay).
    local(p, t, bits) {
      learn(p, t, bits);
    },
    // A rival's buttons, as they arrive (any order, repeats welcome).
    remote(p, t, bits) {
      if (own.has(p) || t < 0) return;
      learn(p, t, bits);
    },
    // Too far ahead of what we have heard from a rival: wait a tick rather
    // than guess further (and replay further) than maxBehind.
    canAdvance: () => tick - sureUpTo() <= maxBehind,
    // Play one tick (after replaying any guessed wrong). Returns the events
    // of every tick played: { tick, events, replay } - a replayed tick's events
    // are the corrected version of ones already seen.
    advance() {
      const out = this.settle();
      out.push({ tick, events: play(tick), replay: false });
      tick++;
      // Ticks every rival has been heard for are never replayed for a
      // guess - but the referee may hand back a sure tick that drifted (see
      // restore), so the last KEEP of them are kept too.
      const keepFrom = sureUpTo() - KEEP;
      for (const t of saved.keys()) if (t < keepFrom) {
        saved.delete(t);
        used.delete(t);
      }
      for (let p = 0; p < players; p++) for (const t of known[p].keys()) if (t < Math.min(keepFrom, lastKnown[p].tick - 1)) known[p].delete(t);
      return out;
    },
    // The referee's word: the world as it really was just before tick t (a
    // sure tick that drifted here). It is put in place and every tick since
    // played again. False when t is no longer kept (or not played yet).
    restore(t, w) {
      if (!(t < tick) || !saved.has(t)) return false;
      saved.set(t, copy(w));
      redoFrom = Math.min(redoFrom, t);
      return true;
    },
    // Replay what was guessed wrong, without playing a new tick.
    settle() {
      const out = [];
      if (redoFrom < tick) {
        rollbacks++;
        world = copy(saved.get(redoFrom));
        for (let t = redoFrom; t < tick; t++) {
          out.push({ tick: t, events: play(t), replay: true });
          replayed++;
        }
      }
      redoFrom = Infinity;
      return out;
    },
    // Every tick before this one is final (no guess left in it).
    sureUpTo,
    heard: (p) => heardUpTo[p],
    // The world as it was just before tick t (while it is still kept).
    savedAt: (t) => saved.get(t) ?? null,
    lastHeard: (p) => lastKnown[p].tick,
    stats: () => ({ tick, rollbacks, replayed, behind: tick - 1 - sureUpTo() }),
  };
}

// Sounds and sparks, once. A replayed tick gives its events again - mostly
// the same ones (a punch thrown is still thrown), sometimes new (the guess
// was wrong: now the blow lands). The same event within a couple of ticks of
// one already played is that one again, and is let through only the first
// time; one already played cannot be taken back.
const eventKey = (e) => [e.type, e.by ?? '', e.on ?? e.to ?? e.def ?? e.slot ?? '', e.move ?? e.kind ?? ''].join('|');
export function createEventFilter(near = 2) {
  const played = new Map(); // tick -> keys played at that tick
  return {
    // entries from advance()/settle(): [{ tick, events, replay }] -> events to show
    pass(entries) {
      const out = [];
      for (const { tick, events, replay } of entries) {
        for (const e of events) {
          const key = eventKey(e);
          if (replay) {
            let seen = false;
            for (let t = tick - near; t <= tick + near && !seen; t++) seen = !!played.get(t)?.delete(key);
            if (seen) {
              // (kept as played at this tick from now on)
              if (!played.has(tick)) played.set(tick, new Set());
              played.get(tick).add(key);
              continue;
            }
          }
          if (!played.has(tick)) played.set(tick, new Set());
          played.get(tick).add(key);
          out.push(e);
        }
        for (const t of played.keys()) if (t < tick - 90) played.delete(t);
      }
      return out;
    },
  };
}
