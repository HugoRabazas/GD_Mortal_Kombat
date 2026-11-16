// Small pictures of the fight for the wire.
//
// The host sends the whole fight to every guest twenty times a second. Sent
// as plain JSON a four-player picture was ~2.7 KB - mostly the names of the
// fighters' fifty-odd fields, repeated in every picture - so it went out as
// three network packets, and losing any one lost the whole picture.
//
// Packed: every KEY_EVERY pictures a key picture carries each fighter's values
// in a fixed order (the order, `K`, travels with it); the pictures between
// carry only the values that changed since that key picture, as
// [position, value, ...]. The rest of the fight (clock, round, projectiles,
// pick-ups) is small and goes whole. A guest that missed a key picture skips
// the pictures built on it until the next one.

const KEY_EVERY = 6; // a key picture every six (over three a second at twenty)

// Floats to one decimal, as the old JSON did; a field a fighter does not have
// (yet) travels as MISSING, as JSON would have left it out.
const MISSING = '~';
// (Lists such as `hits` are copied: the rules change them in place.)
const tidy = (v) => (v === undefined ? MISSING : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10) / 10 : typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v);
const same = (a, b) => a === b || (typeof a === 'object' && a !== null && JSON.stringify(a) === JSON.stringify(b));

export function createPacker(keyEvery = KEY_EVERY) {
  let keyId = 0;
  let count = 0;
  let base = null; // the key picture's values, by fighter
  let keys = null;
  return {
    // state -> a small object for JSON.
    pack(state) {
      const { f, ev, ...rest } = state;
      // Every field any fighter has, in a steady order.
      const order = keys && f.every((x) => Object.keys(x).every((k) => keys.includes(k))) ? keys : [...new Set(f.flatMap((x) => Object.keys(x)))];
      const values = f.map((x) => order.map((k) => tidy(x[k])));
      const fresh = order !== keys || f.length !== base.length || count % keyEvery === 0;
      count++;
      if (fresh) {
        keyId++;
        keys = order;
        base = values;
        return { kf: keyId, K: keys, F: values, r: rest };
      }
      const d = values.map((vals, i) => {
        const out = [];
        vals.forEach((v, j) => {
          if (!same(v, base[i][j])) out.push(j, v);
        });
        return out;
      });
      return { kf: keyId, d, r: rest };
    },
  };
}

export function createUnpacker() {
  const known = new Map(); // key picture id -> { K, F }
  return {
    // packed -> the fight's state, or null when its key picture never came.
    unpack(p) {
      if (!p || typeof p.kf !== 'number' || !p.r) return null;
      if (Array.isArray(p.K) && Array.isArray(p.F)) {
        known.set(p.kf, { K: p.K, F: p.F });
        for (const id of known.keys()) if (id < p.kf - 3) known.delete(id);
      }
      const key = known.get(p.kf);
      if (!key) return null;
      const f = key.F.map((vals, i) => {
        const v = vals.slice();
        const d = p.d?.[i];
        if (Array.isArray(d)) for (let j = 0; j + 1 < d.length; j += 2) v[d[j]] = d[j + 1];
        const fighter = {};
        key.K.forEach((k, j) => {
          if (v[j] !== MISSING) fighter[k] = v[j];
        });
        return fighter;
      });
      return { ...p.r, f };
    },
  };
}
