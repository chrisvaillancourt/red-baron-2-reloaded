// Coverage floors for the equivalence scenarios (F-115, docs/ai.md "Refactor equivalence").
// Two checkouts that both skip a path compare `equal` and prove nothing about it, so each
// scenario declares, per case, a minimum count for the events its header says it covers.
// Minimums guard against zero and near-zero, well below current counts: they are not
// pinned sim figures. A shortfall throws, so the probe reports `failed` on both sides.

/**
 * @param {string} scenario name used in the error
 * @param {Record<string, { counts: Record<string, number>, minimums: Record<string, number> }>} scopes
 *   one entry per case (or suite): observed counts and the declared minimums
 * @returns the same scopes as plain data, with every minimum's count present (missing = 0),
 *   for the scenario to return under a key that sorts after its observations
 */
export function requireCoverage(scenario, scopes) {
  const tally = {};
  const short = [];
  for (const [scope, { counts = {}, minimums }] of Object.entries(scopes)) {
    if (!minimums || !Object.keys(minimums).length) throw new Error(`${scenario}: ${scope} declares no coverage minimum`);
    const seen = {};
    for (const [key, min] of Object.entries(minimums)) {
      if (!Number.isSafeInteger(min) || min <= 0) throw new Error(`${scenario}: ${scope} ${key} minimum must be a positive integer`);
      seen[key] = counts[key] ?? 0;
      if (seen[key] < min) short.push(`${scope} ${key} ${seen[key]} < ${min}`);
    }
    tally[scope] = { counts: { ...counts, ...seen }, minimums: { ...minimums } };
  }
  if (short.length) {
    throw new Error(`${scenario}: coverage is below its declared minimum, so an equal verdict would prove nothing about these paths: ${short.join('; ')}`);
  }
  return tally;
}

/** Event counts by type. */
export function countEvents(events) {
  const counts = {};
  for (const { type } of events) counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}
