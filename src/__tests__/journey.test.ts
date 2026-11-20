// The engagement journey against real SQLite: derived stages, the funnel, the board, and plans.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';

let signedInAs = 'admin@example.org';
vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: signedInAs }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

let db: ReturnType<typeof sqliteD1>;
const call = (path: string, init: RequestInit = {}, as = 'admin@example.org') => {
  signedInAs = as;
  return onRequest({
    request: new Request(`https://ecrs.org/api/internal/leadership/${path}`, {
      ...init,
      headers: { origin: 'https://ecrs.org' },
    }),
    env: { DB: db.d1 },
    params: { path: path.split('?')[0].split('/') },
  } as never);
};
const get = async (path: string, as?: string) => {
  const res = await call(path, {}, as);
  return { status: res.status, body: JSON.parse(await res.text()), text: '' };
};
const put = (path: string, body: unknown, as?: string) => call(path, { method: 'PUT', body: JSON.stringify(body) }, as);
type Row = { name: string; stage: string };
const names = (people: Row[]) => people.map((p) => p.name);

beforeEach(() => {
  db = sqliteD1();
  db.raw.exec(`
    INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1), ('std@example.org', 'standard', 0);
    INSERT INTO person (id, name, status) VALUES
      (1, 'Sup Porter', 'active'), (2, 'Ann Attendee', 'active'), (3, 'Vic Volunteer', 'active'),
      (4, 'Act Leader', 'active'), (5, 'Cleo Class', 'active'), (6, 'Bo Board', 'active'),
      (7, 'Nobody', 'active'), (8, 'Assist Ant', 'active'), (9, 'Old Timer', 'inactive');
    INSERT INTO event (id, name, event_type, year) VALUES (1, 'Camp 2024', 'weekend', 2024), (2, 'Camp 2025', 'weekend', 2025);
    INSERT INTO activity (id, name, scope, type) VALUES (1, 'Tag', 'activity', 'Games'), (2, 'Games Class', 'class', 'Games');
    INSERT INTO donation (person_id, source, source_ref, amount_cents, donated_at) VALUES (1, 'zeffy', 'g', 424242, '2025-01-01');
    INSERT INTO registration (person_id, event_id, source, entry_ref) VALUES
      (2, 1, 'c', 'a'), (3, 1, 'c', 'b'), (4, 2, 'c', 'c'), (5, 2, 'c', 'd'), (6, 1, 'c', 'e'), (9, 1, 'c', 'f');
    INSERT INTO registration (person_id, event_id, source, entry_ref, status) VALUES (7, 1, 'c', 'g', 'cancelled');
    INSERT INTO volunteer (person_id, event_id, task) VALUES (3, 2, 'Tables');
    INSERT INTO role (person_id, activity_id, event_id, leadership_type) VALUES
      (4, 1, 2, 'solo'), (5, 2, 2, 'partner'), (5, 1, 1, 'solo'), (8, 1, 1, 'assisting');
    INSERT INTO service (person_id, body, title, started_on, ended_on) VALUES
      (6, 'Board of Directors', 'Chair', '2023-01-01', NULL), (4, 'Programming Committee', NULL, '2020-01-01', '2021-12-31');
  `);
});

describe('stages', () => {
  it('derives the highest stage reached from the records', async () => {
    const { body } = await get('journey');
    const col = (s: string) => names(body.columns[s].people).sort();
    expect(col('supporter')).toEqual(['Sup Porter']);
    expect(col('attendee')).toEqual(['Ann Attendee', 'Bo Board', 'Old Timer']);
    expect(col('volunteer')).toEqual(['Assist Ant', 'Vic Volunteer']);
    expect(col('activity')).toEqual(['Act Leader']);
    expect(col('class')).toEqual(['Cleo Class']);
    expect(names(Object.values(body.columns).flatMap((c) => (c as { people: Row[] }).people))).not.toContain('Nobody');
  });

  it('keeps serving as its own lane, current service only', async () => {
    const { body } = await get('journey');
    expect(names(body.columns.serving.people)).toEqual(['Bo Board']); // the old committee term has ended
    expect(body.funnel).toMatchObject({ serving_now: 1, served_ever: 2 });
  });

  it('counts how many have reached each stage, and who reached each in a year', async () => {
    const { body } = await get('journey?year=2024');
    expect(body.funnel).toMatchObject({ supporter: 8, attendee: 7, volunteer: 4, activity: 2, class: 1 });
    expect(body.funnel).toMatchObject({ attendee_new: 4, class_new: 0, serving_new: 0 });
    expect(body.year).toBe(2024);
    expect((await get('journey?year=2025')).body.funnel).toMatchObject({ class_new: 1, activity_new: 1 });
  });
});

describe('the board', () => {
  it('pages one column, filters, and rejects bad input', async () => {
    const page = await get('journey?stage=attendee&limit=2&offset=1');
    expect(page.body).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(page.body.people).toHaveLength(2);
    expect(names((await get('journey?stage=attendee&q=ann')).body.people)).toEqual(['Ann Attendee']);
    expect((await get('journey?stage=bogus')).status).toBe(400);
    expect((await get('journey?limit=9999&stage=attendee')).status).toBe(400);
  });

  it('filters by plan: mine, overdue, has a target, stalled, and do-not-contact', async () => {
    await put('journey/2', {
      target: 'activity',
      next_step: 'Ask about a game',
      due_on: '2020-01-01',
      owner: 'Admin@Example.org',
    });
    await put('journey/3', { target: 'class', owner: 'someone@example.org' });
    const all = (q: string) => get(`journey?stage=${q}`).then((r) => names(r.body.people));
    expect(await all('attendee&mine=1')).toEqual(['Ann Attendee']);
    expect(await all('attendee&overdue=1')).toEqual(['Ann Attendee']);
    expect(await all('volunteer&has_target=1')).toEqual(['Vic Volunteer']);
    expect(await all('attendee&stalled_years=2')).toEqual(expect.arrayContaining(['Ann Attendee']));
    db.raw.exec("INSERT INTO outreach (person_id, goal, status) VALUES (2, 'invite_back', 'do_not_contact')");
    expect(await all('attendee&exclude_do_not_contact=1')).not.toContain('Ann Attendee');
  });

  it('shows no figure for a standard user, even for someone who gave', async () => {
    const res = await call('journey', {}, 'std@example.org');
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toMatch(/424242|amount|cents/i);
    expect(text).toContain('Sup Porter'); // a supporter, from giving, with no amount
  });
});

describe('plans', () => {
  it('sets, replaces, reads, and clears a plan, with an audit stamp', async () => {
    expect(
      (await put('journey/2', { target: 'committee', next_step: ' Invite to coffee ', due_on: '2026-12-31' })).status
    ).toBe(200);
    expect((await put('journey/2', { target: 'board', next_step: 'Ask', owner: 'a@example.org' })).status).toBe(200);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM journey_plan WHERE person_id = 2').get()).toEqual({ n: 1 });
    const one = (await get('journey/2')).body;
    expect(one).toMatchObject({
      stage: 'attendee',
      target: 'board',
      next_step: 'Ask',
      owner: 'a@example.org',
      due_on: null,
    });
    expect(db.raw.prepare('SELECT created_by c, updated_by u FROM journey_plan').get()).toEqual({
      c: 'admin@example.org',
      u: 'admin@example.org',
    });
    expect((await call('journey/2', { method: 'DELETE' })).status).toBe(200);
    expect((await get('journey/2')).body.target).toBeNull();
    expect((await call('journey/2', { method: 'DELETE' })).status).toBe(404);
    expect(db.raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'journey.clear'").get()).toEqual({ n: 1 });
  });

  it('validates input and unknown people', async () => {
    expect((await put('journey/2', { target: 'king' })).status).toBe(400);
    expect((await put('journey/2', { due_on: 'soon' })).status).toBe(400);
    expect((await put('journey/2', { next_step: 'x'.repeat(301) })).status).toBe(400);
    expect((await put('journey/2', { next_step: 5 })).status).toBe(400);
    expect((await put('journey/99', { target: 'class' })).status).toBe(404);
    expect((await get('journey/99')).status).toBe(404);
    expect((await get('journey/x')).status).toBe(404);
    expect((await call('journey/x', { method: 'PUT', body: '{}' })).status).toBe(404);
    expect((await call('journey/2', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
