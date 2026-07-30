// Reorders items so that adjacent entries in a fixed-column grid end up with
// similar "weight" (e.g. bio length), keeping long bios paired with long
// bios and short with short — sorting by weight is optimal for minimizing
// height mismatch within consecutive pairs. Stable sort means equal-weight
// items keep their relative input order (pass in alphabetical for a
// deterministic tiebreak).
export function balanceByWeight<T>(items: T[], getWeight: (item: T) => number): T[] {
  return [...items].sort((a, b) => getWeight(b) - getWeight(a));
}
