// The knockout, once more: the last moments before a fight's final blow,
// kept as the fight is drawn and shown again, slowed, from the result screen.
//
// Every frame drawn during a fight goes on a short tape (a copy of the fight
// and the events of that frame); the tape keeps the last few seconds. When
// the fight is over, `clip()` cuts out the stretch around the last knockout:
// LEAD before it (the blows that set it up) and TAIL after (the fall).

const KEEP_MS = 4500;
const LEAD_MS = 1700;
const TAIL_MS = 1300;
export const REPLAY_SPEED = 0.5; // half speed

export function createTape() {
  let frames = [];
  let koAt = -1; // when the knockout being taped began
  return {
    // (Copies: the fight's own objects change under us.)
    push(state, events, at) {
      // Once a knockout's fall is taped, the rest of it (and the end of the
      // match) would only push the blows that led to it off the tape.
      if (state.phase === 'ko') {
        if (koAt < 0) koAt = at;
        else if (at - koAt > TAIL_MS) return;
      } else if (state.phase === 'over') return;
      else koAt = -1;
      frames.push({ state: structuredClone(state), events: events.length ? structuredClone(events) : [], at });
      while (frames.length && at - frames[0].at > KEEP_MS) frames.shift();
    },
    frames: () => frames,
    clear() {
      frames = [];
      koAt = -1;
    },
    // The frames around the last knockout, or null when the fight did not end
    // on one (the clock ran out) or the tape missed it.
    clip() {
      let ko = -1;
      for (let i = frames.length - 1; i > 0; i--) {
        if (frames[i].state.phase === 'ko' && frames[i - 1].state.phase !== 'ko') {
          ko = i;
          break;
        }
      }
      if (ko < 0 || frames[ko].state.koKind !== 'ko') return null;
      const at = frames[ko].at;
      const out = frames.filter((f) => f.at >= at - LEAD_MS && f.at <= at + TAIL_MS);
      return out.length > 8 ? out : null; // (a slow device draws few frames)
    },
  };
}

// Playing a clip: the index of the frame to draw `ms` after the replay
// started (slowed by REPLAY_SPEED), or -1 once it is over.
export function frameIndex(clip, ms) {
  const t = clip[0].at + ms * REPLAY_SPEED;
  if (t > clip[clip.length - 1].at) return -1;
  let i = 0;
  while (i + 1 < clip.length && clip[i + 1].at <= t) i++;
  return i;
}
