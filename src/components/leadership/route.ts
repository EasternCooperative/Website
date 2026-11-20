// The tool's address lives in the URL hash, so a view or a person can be linked to and the
// back button works. `#/people`, `#/people/12`, `#/events`.
import type { View } from './model';

export interface Route {
  view: View;
  id: number | null;
  /** What follows a "?", without the "?", for views that keep their settings in the address. */
  query: string;
}

/** Reads a hash into a route. Anything unknown, or a view the person may not open, falls back to `fallback`. */
export function parseHash(hash: string, allowed: View[], fallback: View): Route {
  const [path, ...rest] = hash.replace(/^#\/?/, '').split('?');
  const [view, id] = path.split('/');
  const known = allowed.find((v) => v === view);
  const n = Number(id);
  return {
    view: known ?? fallback,
    id: known && Number.isInteger(n) && n > 0 ? n : null,
    query: known ? rest.join('?') : '',
  };
}

export const formatHash = (view: View, id: number | null = null, query = ''): string =>
  `#/${view}${id ? `/${id}` : ''}${query ? `?${query}` : ''}`;
