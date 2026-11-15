// A brawl's awards, from each fighter's numbers in the fight ({ dmg, combo,
// perfect } per slot): whoever alone did the most damage, strung the longest
// combo (3 hits or more) or made the most perfect guards - so a fighter who
// placed low but hit hardest still gets a word. Ties earn nothing.
export const AWARDS = [
  ['dmg', 'Heavy hitter', 1],
  ['combo', 'Combo master', 3],
  ['perfect', 'Iron guard', 1],
];

// The names of the awards `slot` earned, in the order above.
export function awardsFor(all, slot) {
  if (!all?.[slot]) return [];
  return AWARDS.filter(([key, , least]) => {
    const best = Math.max(...all.map((st) => st[key]));
    return best >= least && all[slot][key] === best && all.filter((st) => st[key] === best).length === 1;
  }).map(([, name]) => name);
}
