// Client for /api/internal/leadership. Same-origin only: Cloudflare Access puts
// the session cookie on these requests, and the Function checks the JWT.
import type { Data, Person } from './model';

const BASE = '/api/internal/leadership';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    // An expired Access session redirects cross-origin to the login page, which fetch reports as a network error.
    throw new ApiError('Could not reach the server. Your sign-in may have expired: reload the page.', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export const loadAll = () => request<Data>('/bootstrap');

export const savePerson = (p: Person) =>
  request<{ ok: true }>(`/person/${p.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: p.name,
      email: p.email,
      leader_slug: p.leader_slug,
      status: p.status,
      notes: p.notes,
    }),
  });

export const addNote = (note: { person_id: number; kind: 'note' | 'ready'; focus: string; body: string }) =>
  request<{ id: number }>('/note', { method: 'POST', body: JSON.stringify(note) });

export const deleteNote = (id: number) => request<{ ok: true }>(`/note/${id}`, { method: 'DELETE' });
