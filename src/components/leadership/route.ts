// The tool's address lives in the URL hash, so a view or a person can be linked to and the
// back button works. `#/people`, `#/people/12`, `#/events`.
import type { View } from './model';

export interface Route {
  view: View;
  id: number | null;
}

/** Reads a hash into a route. Anything unknown, or a view the person may not open, falls back to `fallback`. */
export function parseHash(hash: string, allowed: View[], fallback: View): Route {
  const [view, id] = hash.replace(/^#\/?/, '').split('/');
  const known = allowed.find((v) => v === view);
  const n = Number(id);
  return { view: known ?? fallback, id: known && Number.isInteger(n) && n > 0 ? n : null };
}

export const formatHash = (view: View, id: number | null = null): string => `#/${view}${id ? `/${id}` : ''}`;
