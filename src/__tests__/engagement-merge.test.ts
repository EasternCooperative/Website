// Merging two records of one person, against real SQLite.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';

let signedInAs = 'admin@example.org';
vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: signedInAs }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

let db: ReturnType<typeof sqliteD1>;
const call = (path: string, as: string, init: RequestInit = {}) => {
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
const merge = (from: number, into: number, as = 'admin@example.org', confirm: number = from) =>
  call(`merge/${from}/${into}`, as, { method: 'POST', body: JSON.stringify({ confirm }) });
const one = (sql: string) => db.raw.prepare(sql).get() as Record<string, number | string | null>;

beforeEach(() => {
  db = sqliteD1();
  db.raw.exec(`
    INSERT INTO app_user (email_lower, level, is_admin) VALUES ('admin@example.org', 'standard', 1), ('standard@example.org', 'standard', 0);
    INSERT INTO person (id, name, email, leader_slug, status) VALUES
      (1, 'Debra Dunn', NULL, NULL, 'inactive'),
      (2, 'Debbie Dunn', 'debbie@example.org', 'debbie-dunn', 'active'),
      (3, 'Eve Eaton', 'shared@example.org', NULL, 'active'),
      (4, 'Evelyn Eaton', 'shared@example.org', NULL, 'hiatus'),
      (5, 'Frank Fox', NULL, NULL, 'active');
    INSERT INTO person_email (person_id, email_lower, is_primary) VALUES (1, 'debra@example.org', 1), (1, 'both@example.org', 0), (2, 'both@example.org', 1);
    INSERT INTO event (id, name, event_type, year) VALUES (1, 'Camp 2025', 'weekend', 2025), (2, 'Winter 2026', 'extended', 2026);
    INSERT INTO activity (id, name, scope, type) VALUES (1, 'Games Class', 'class', 'Games');
    INSERT INTO role (person_id, activity_id, event_id, leadership_type) VALUES (1, 1, 1, 'solo'), (2, 1, 1, 'solo'), (1, 1, 2, 'solo');
    INSERT INTO registration (person_id, event_id, source, entry_ref) VALUES (1, 1, 'cognito', 'a'), (2, 1, 'cognito', 'b'), (1, 2, 'cognito', 'c');
    INSERT INTO donation (person_id, source, source_ref, amount_cents, donated_at) VALUES (1, 'zeffy', 'g1', 5000, '2025-01-01');
    INSERT INTO membership (person_id, kind, starts_on, ends_on) VALUES (1, 'annual', '2025-01-01', '2025-12-31'), (2, 'annual', '2025-01-01', '2025-12-31');
    INSERT INTO outreach (person_id, goal, status) VALUES (1, 'invite_back', 'do_not_contact');
    INSERT INTO journey_note (person_id, kind, body, author) VALUES (1, 'note', 'hello', 'x');
  `);
});

describe('merge', () => {
  it('moves everything to the survivor and retires the duplicate', async () => {
    const res = await merge(1, 2);
    expect(res.status).toBe(200);
    expect(one('SELECT COUNT(*) n FROM registration WHERE person_id = 2').n).toBe(3);
    expect(one('SELECT COUNT(*) n FROM registration WHERE person_id = 1').n).toBe(0);
    expect(one('SELECT COUNT(*) n FROM donation WHERE person_id = 2').n).toBe(1);
    expect(one('SELECT COUNT(*) n FROM journey_note WHERE person_id = 2').n).toBe(1);
    expect(one('SELECT deleted_at IS NOT NULL AS gone FROM person WHERE id = 1').gone).toBe(1);
    expect(one('PRAGMA foreign_key_check')).toBeUndefined();
  });

  it('does not double a role or a membership year both records had', async () => {
    await merge(1, 2);
    expect(one('SELECT COUNT(*) n FROM role WHERE person_id = 2 AND deleted_at IS NULL').n).toBe(2);
    expect(one('SELECT COUNT(*) n FROM membership WHERE person_id = 2 AND deleted_at IS NULL').n).toBe(1);
  });

  it('keeps addresses without duplicates and remembers the old name as an alias', async () => {
    await merge(1, 2);
    expect(one("SELECT COUNT(*) n FROM person_email WHERE person_id = 2 AND email_lower = 'both@example.org'").n).toBe(
      1
    );
    expect(one("SELECT COUNT(*) n FROM person_email WHERE person_id = 2 AND email_lower = 'debra@example.org'").n).toBe(
      1
    );
    expect(one("SELECT COUNT(*) n FROM person_alias WHERE person_id = 2 AND alias_norm = 'debra dunn'").n).toBe(1);
  });

  it('takes the stronger status and fills a missing link', async () => {
    await merge(2, 1);
    expect(one('SELECT status, leader_slug, email FROM person WHERE id = 1')).toMatchObject({
      status: 'active',
      leader_slug: 'debbie-dunn',
      email: 'debbie@example.org',
    });
    await merge(4, 3);
    expect(one('SELECT status FROM person WHERE id = 3').status).toBe('active');
  });

  it('carries a do-not-contact mark to the survivor', async () => {
    await merge(1, 2);
    expect(one("SELECT COUNT(*) n FROM outreach WHERE person_id = 2 AND status = 'do_not_contact'").n).toBe(1);
  });

  it('records the merge without names and audits it', async () => {
    await merge(1, 2);
    const row = one('SELECT from_person_id f, into_person_id i, summary, merged_by m FROM person_merge');
    expect(row).toMatchObject({ f: 1, i: 2, m: 'admin@example.org' });
    expect(String(row.summary)).not.toMatch(/Debra|Debbie/);
    expect(one("SELECT COUNT(*) n FROM audit_log WHERE action = 'person.merge'").n).toBe(1);
  });

  it('is admin only, needs the confirmation, and refuses bad pairs', async () => {
    expect((await merge(1, 2, 'standard@example.org')).status).toBe(403);
    expect((await call('merge/1/2', 'standard@example.org')).status).toBe(403);
    expect((await call('duplicates', 'standard@example.org')).status).toBe(403);
    expect((await merge(1, 2, 'admin@example.org', 9)).status).toBe(400);
    expect((await merge(1, 1)).status).toBe(400);
    expect((await merge(1, 99)).status).toBe(404);
    expect((await call('merge/x/2', 'admin@example.org')).status).toBe(404);
    expect(one('SELECT deleted_at FROM person WHERE id = 1').deleted_at).toBeNull();
  });

  it('previews counts, never amounts', async () => {
    const res = await call('merge/1/2', 'admin@example.org');
    const text = await res.text();
    expect(JSON.parse(text).counts).toMatchObject({ registration: 2, donation: 1, role: 2 });
    expect(text).not.toMatch(/5000|amount|cents/);
    expect((await call('merge/1/99', 'admin@example.org')).status).toBe(404);
  });

  it('suggests pairs by shared address and by similar name', async () => {
    const { pairs } = JSON.parse(await (await call('duplicates', 'admin@example.org')).text());
    const key = (p: { a: { id: number }; b: { id: number } }) => `${p.a.id}-${p.b.id}`;
    const found = new Map(pairs.map((p: never) => [key(p), p]));
    expect(found.get('1-2')).toBeTruthy();
    expect(found.get('3-4')).toBeTruthy();
    expect(found.has('1-5')).toBe(false);
  });
});
