// Buttons that survive a lost message, and a count of how well the game's
// pictures are arriving.
//
// A guest tells the host which buttons are down. The direct link drops a lost
// message rather than send it late (a late picture is worthless), so a quick
// tap whose only message was lost used to vanish: the host never saw the
// punch. Now every message carries the last few changes of the buttons, each
// numbered; the host applies, one tick each, any it had not seen yet - so a
// press always shows for at least one tick, even if its own message was lost.

const KEEP = 8; // changes carried by every message

// Guest side: `note(bits)` each frame; `message()` is what to send.
export function createInputSender() {
  let seq = 0;
  let last = -1;
  const recent = []; // [seq, bits], oldest first
  return {
    // Returns true when the buttons changed (worth sending at once).
    note(bits) {
      if (bits === last) return false;
      last = bits;
      recent.push([++seq, bits]);
      if (recent.length > KEEP) recent.shift();
      return true;
    },
    message: () => ({ i: last < 0 ? 0 : last, h: recent.slice() }),
  };
}

// Host side, one per guest: `take(msg)` on every message, `next()` once a tick
// gives the buttons to use for that tick.
export function createInputReceiver(mask = 0xffff) {
  let seen = 0; // the last change applied
  let held = 0;
  const queue = [];
  return {
    take(msg) {
      if (Array.isArray(msg.h) && msg.h.length) {
        for (const pair of msg.h) {
          const [q, b] = Array.isArray(pair) ? pair : [];
          if (typeof q !== 'number' || typeof b !== 'number' || q <= seen) continue;
          // A gap means changes older than the window were lost for good:
          // nothing to do but carry on from here.
          seen = q;
          queue.push(b & mask);
        }
        if (queue.length > KEEP * 2) queue.splice(0, queue.length - KEEP * 2); // never fall far behind
      } else if (typeof msg.i === 'number') {
        // An older build that sends only the buttons now down.
        queue.length = 0;
        held = msg.i & mask;
      }
    },
    next() {
      if (queue.length) held = queue.shift();
      return held;
    },
  };
}

// Guest side: how the host's pictures are arriving. `got(tick)` for each one
// received; the host numbers them by tick, `every` ticks apart, so a gap in the
// numbers is a picture that was lost on the way.
export function createSnapshotMeter(every = 3) {
  let lastTick = -1;
  let got = 0;
  let lost = 0;
  const times = []; // arrival times in the last second
  let pings = 0;
  let pingSum = 0;
  let pingMax = 0;
  return {
    // (`gap`: the ticks between pictures on the route they came by.)
    got(tick, now, gap = every) {
      if (lastTick >= 0 && tick > lastTick) {
        const missing = Math.round((tick - lastTick) / gap) - 1;
        if (missing > 0 && missing < 200) lost += missing; // (a long gap is a pause or a new round, not loss)
      }
      lastTick = tick;
      got++;
      times.push(now);
      while (times.length && now - times[0] > 1000) times.shift();
    },
    ping(ms) {
      pings++;
      pingSum += ms;
      pingMax = Math.max(pingMax, ms);
    },
    perSecond: () => times.length,
    lossPct: () => (got + lost ? Math.round((lost / (got + lost)) * 100) : 0),
    report: () => ({ got, lost, lossPct: got + lost ? Math.round((lost / (got + lost)) * 100) : 0, pingAvg: pings ? Math.round(pingSum / pings) : null, pingMax: pings ? pingMax : null }),
  };
}
