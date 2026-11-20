// Client for /api/internal/engagement. Same-origin only: Cloudflare Access puts
// the session cookie on these requests, and the Function checks the JWT.
import type {
  AccessLevel,
  Activity,
  AppUser,
  JourneyBoard,
  JourneyColumn,
  JourneyRow,
  Data,
  EngagementPage,
  EventRow,
  Person,
  Role,
  Timeline,
} from './model';

const BASE = '/api/internal/engagement';

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

const send = <T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface PersonInput {
  name: string;
  email: string | null;
  leader_slug?: string | null;
  status: Person['status'];
  mentor: boolean;
  notes: string | null;
}

export const createPerson = (p: PersonInput) => send<{ id: number }>('POST', '/person', p);

export const savePerson = (p: Person) =>
  send<{ ok: true }>('PUT', `/person/${p.id}`, {
    name: p.name,
    email: p.email,
    leader_slug: p.leader_slug,
    status: p.status,
    mentor: p.mentor === 1,
    notes: p.notes,
  });

export interface RoleInput {
  person_id: number;
  activity_id: number;
  event_id: number;
  leadership_type: Role['leadership_type'];
  how_it_went: string | null;
  source?: string;
}

export const createRole = (r: RoleInput) => send<{ id: number }>('POST', '/role', r);
export const saveRole = (id: number, r: RoleInput) => send<{ ok: true }>('PUT', `/role/${id}`, r);
export const deleteRole = (id: number) => send<{ ok: true }>('DELETE', `/role/${id}`);
/** Adds the same role at one event for several people. Repeats are skipped. */
export const addRoles = (rows: RoleInput[]) => send<{ added: number }>('POST', '/roles/bulk', { rows });

export type ActivityInput = Pick<Activity, 'name' | 'scope' | 'type'> & {
  subtype: string | null;
  site_activity_id?: string | null;
};
export const createActivity = (a: ActivityInput) => send<{ id: number }>('POST', '/activity', a);
export const saveActivity = (id: number, a: ActivityInput) => send<{ ok: true }>('PUT', `/activity/${id}`, a);
export const deleteActivity = (id: number) => send<{ ok: true }>('DELETE', `/activity/${id}`);

export type EventInput = Pick<EventRow, 'name' | 'event_type' | 'year'> & {
  site_event_id?: string | null;
  start_date?: string | null;
  site_id?: string | null;
};
export const createEvent = (e: EventInput) => send<{ id: number }>('POST', '/event', e);
export const saveEvent = (id: number, e: EventInput) => send<{ ok: true }>('PUT', `/event/${id}`, e);
export const deleteEvent = (id: number) => send<{ ok: true }>('DELETE', `/event/${id}`);

export const addNote = (note: { person_id: number; kind: 'note' | 'ready'; focus: string; body: string }) =>
  send<{ id: number }>('POST', '/note', note);

export const deleteNote = (id: number) => send<{ ok: true }>('DELETE', `/note/${id}`);

export const listUsers = () => request<{ users: AppUser[] }>('/users');
/** Adds someone, or changes their level or admin flag. */
export const saveUser = (u: { email: string; level: AccessLevel; is_admin: boolean }) =>
  send<{ ok: true }>('POST', '/users', u);
export const deleteUser = (email: string) => send<{ ok: true }>('DELETE', `/users/${encodeURIComponent(email)}`);

export const getTimeline = (personId: number) => request<Timeline>(`/timeline/${personId}`);

export interface ServiceInput {
  person_id: number;
  body: string;
  title: string | null;
  started_on: string | null;
  ended_on: string | null;
  note: string | null;
  source?: string | null;
}
export const createService = (s: ServiceInput) => send<{ id: number }>('POST', '/service', s);
export const saveService = (id: number, s: ServiceInput) => send<{ ok: true }>('PUT', `/service/${id}`, s);
export const deleteService = (id: number) => send<{ ok: true }>('DELETE', `/service/${id}`);

export interface VolunteerInput {
  person_id: number;
  event_id: number;
  task: string;
  hours: number | null;
  note?: string | null;
}
/** The same task at one event for several people. */
export const addVolunteers = (rows: VolunteerInput[]) => send<{ added: number }>('POST', '/volunteers/bulk', { rows });
export const deleteVolunteer = (id: number) => send<{ ok: true }>('DELETE', `/volunteer/${id}`);

export const getEngagement = (query: string) => request<EngagementPage>(`/engagement?${query}`);

export interface OutreachInput {
  person_id: number;
  goal: string;
  status: string;
  contacted_on?: string | null;
  snooze_until?: string | null;
  note?: string | null;
  event_id?: number | null;
  slot?: string | null;
}
export const createOutreach = (o: OutreachInput) => send<{ id: number }>('POST', '/outreach', o);
export const saveOutreach = (id: number, o: OutreachInput) => send<{ ok: true }>('PUT', `/outreach/${id}`, o);
export const deleteOutreach = (id: number) => send<{ ok: true }>('DELETE', `/outreach/${id}`);

export interface DuplicatePair {
  a: { id: number; name: string };
  b: { id: number; name: string };
  reasons: string[];
}
export interface MergePreview {
  from: { id: number; name: string };
  into: { id: number; name: string };
  counts: Record<string, number>;
}
export const listDuplicates = () => request<{ pairs: DuplicatePair[] }>('/duplicates');
export const previewMerge = (fromId: number, intoId: number) => request<MergePreview>(`/merge/${fromId}/${intoId}`);
export const mergePeople = (fromId: number, intoId: number) =>
  send<{ into: number }>('POST', `/merge/${fromId}/${intoId}`, { confirm: fromId });

export interface PlanInput {
  target: string | null;
  next_step: string | null;
  due_on: string | null;
  owner: string | null;
}
export const getJourney = (query: string) => request<JourneyBoard>(`/journey${query ? `?${query}` : ''}`);
export const getJourneyColumn = (query: string) => request<JourneyColumn>(`/journey?${query}`);
export const getJourneyPerson = (id: number) => request<JourneyRow>(`/journey/${id}`);
export const savePlan = (id: number, plan: PlanInput) => send<{ ok: true }>('PUT', `/journey/${id}`, plan);
export const clearPlan = (id: number) => send<{ ok: true }>('DELETE', `/journey/${id}`);

export const createVenue = (v: { name: string; postal_code: string }) => send<{ id: string }>('POST', '/venue', v);
export const markExpert = (person_id: number, type: string) =>
  send<{ id: number }>('POST', '/expertise', { person_id, type });
export const unmarkExpert = (id: number) => send<{ ok: true }>('DELETE', `/expertise/${id}`);
