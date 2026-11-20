// Walks a Cognito form's entries by number. The API has no list endpoint, and numbers
// have gaps (deleted entries), so we stop only after `gap` misses in a row. Reports the
// highest number seen, so a short count is visible rather than silent.

/**
 * @param {(path: string) => Promise<any>} get
 * @param {string} formId
 * @param {{ gap?: number, batch?: number, onEntry?: (entry: any) => void }} [options]
 * @returns {Promise<{ found: number, highest: number }>}
 */
export async function crawlEntries(get, formId, { gap = 50, batch = 10, onEntry } = {}) {
  let n = 1;
  let misses = 0;
  let found = 0;
  let highest = 0;
  while (misses < gap) {
    const numbers = Array.from({ length: batch }, (_, i) => n + i);
    const results = await Promise.all(numbers.map((num) => get(`/forms/${formId}/entries/${num}`)));
    results.forEach((entry, i) => {
      if (entry) {
        misses = 0;
        found++;
        highest = numbers[i];
        onEntry?.(entry);
      } else misses++;
    });
    n += batch;
  }
  return { found, highest };
}
