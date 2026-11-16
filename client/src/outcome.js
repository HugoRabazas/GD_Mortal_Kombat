// How a match was won, for the winner's line on the result screen.

// How a duel was won, from its rounds' ends (in the order they came) and
// the state at the end: 'perfect' (no round lost and a flawless last
// knockout), 'comeback' (the first round lost), 'close' (it went to the
// deciding round, or the winner ended under a quarter of their health), or
// '' for an ordinary win. (Brawls: see below.)
export function howWon(s, rounds) {
  if (!s || s.matchWinner < 0) return '';
  const w = s.matchWinner;
  if (s.mode === 'arena') {
    // A brawl, won on points over its rounds: every round taken and the
    // last one flawless; the first round someone else's (or shared); or
    // first place by a single point.
    const ends = rounds;
    if (ends.length && ends.every((r) => r.winner === w) && ends[ends.length - 1].perfect) return 'perfect';
    if (ends[0] && ends[0].winner !== w) return 'comeback';
    const pts = [...(s.pts || [])].sort((a, b) => b - a);
    if (pts.length > 1 && pts[0] - pts[1] <= 1) return 'close';
    return '';
  }
  const ends = rounds;
  const lost = ends.some((r) => r.winner >= 0 && r.winner !== w);
  const last = ends[ends.length - 1];
  if (!lost && last?.perfect && last.winner === w) return 'perfect';
  if (ends[0] && ends[0].winner >= 0 && ends[0].winner !== w) return 'comeback';
  const f = s.f[w];
  if (ends.length >= 3 || (f && f.hp > 0 && f.hp < f.maxHp * 0.25)) return 'close';
  return '';
}

// What the banner and the announcer add to "X WINS".
export const HOW_SAID = { perfect: 'Flawless', comeback: 'What a comeback', close: 'By a whisker' };
