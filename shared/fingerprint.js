// A short fingerprint of the whole fight: two devices whose fights are the
// same, to the last bit, get the same fingerprint (for online rollback, so a
// device can tell that its fight has drifted from the host's).
//
// JSON.stringify writes every number the same way in every engine (the
// shortest text that reads back as that exact number), so the text is the
// same wherever the fight is; FNV-1a turns it into 32 bits.
export function fingerprint(state) {
  const text = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
