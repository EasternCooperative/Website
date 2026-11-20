// The contract that protects donation amounts: run as a standard user against a real
// SQLite database seeded with distinctive gifts, and fail if any figure appears.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from './d1-sqlite';

let signedInAs = 'standard@example.org';
vi.mock('../../functions/_lib/access.js', async (orig) => {
  const real = await orig<typeof import('../../functions/_lib/access.js')>();
  return { ...real, authenticate: async () => ({ email: signedInAs }) };
});
import { onRequest } from '../../functions/api/internal/leadership/[[path]].js';

// Distinctive amounts, so a leak shows up as a recognizable number anywhere in a response.
const BIG = 987654; // cents
const SMALL = 12345;
const MID = 22222;

let db: ReturnType<typeof sqliteD1>;

function seed() {
  db = sqliteD1();
  const { raw } = db;
  raw.exec(`
    INSERT INTO app_user (email_lower, level, is_admin) VALUES
      ('standard@example.org', 'standard', 0), ('finance@example.org', 'finance', 0), ('admin@example.org', 'standard', 1);
    INSERT INTO person (id, name, email, status) VALUES
      (1, 'Alice Adams', 'alice@example.org', 'active'),
      (2, 'Bob Brown', 'bob@example.org', 'active'),
      (3, 'Cara Cole', NULL, 'active'),
      (4, 'Dan Dunn', NULL, 'active');
    INSERT INTO event (id, name, event_type, year) VALUES (1, 'Camp 2025', 'weekend', 2025), (2, 'Winter 2026', 'extended', 2026);
    INSERT INTO activity (id, name, scope, type) VALUES (1, 'Games Class', 'class', 'Games');
    INSERT INTO role (person_id, activity_id, event_id, leadership_type, how_it_went) VALUES (1, 1, 1, 'solo', 'went well');
    INSERT INTO registration (person_id, event_id, source, entry_ref, attended) VALUES (1, 1, 'cognito', 'e1', 1), (1, 2, 'cognito', 'e2', NULL), (2, 1, 'cognito', 'e3', 1);
    INSERT INTO volunteer (person_id, event_id, task) VALUES (1, 1, 'Moved tables');
    INSERT INTO membership (person_id, kind) VALUES (2, 'life');
    INSERT INTO service (person_id, body, title, started_on, ended_on) VALUES (1, 'Board', 'Chair', '2024-01-01', NULL);
    -- Bob and Cara land in the SAME tier (Medium) with different amounts, in an order
    -- opposite to their names, so sorting by tier must not reveal which gave more.
    INSERT INTO donation (person_id, source, source_ref, amount_cents, donated_at, campaign) VALUES
      (1, 'zeffy', 'p1', ${BIG}, '2026-05-23', 'Annual Appeal'),
      (2, 'zeffy', 'p2', ${SMALL}, '2025-10-04', 'Fun Day'),
      (3, 'zeffy', 'p3', ${MID}, '2025-11-01', 'Fun Day');
    INSERT INTO outreach (person_id, goal, status, note) VALUES (2, 'invite_lead', 'contacted', 'Asked at camp');
    INSERT INTO journey_note (person_id, kind, body, author) VALUES (1, 'note', 'Great with kids', 'standard@example.org');
  `);
}

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
const get = async (path: string, as: string) => {
  const res = await call(path, as);
  return { status: res.status, text: await res.text() };
};
const post = (path: string, as: string, body: unknown) =>
  call(path, as, { method: 'POST', body: JSON.stringify(body) });

// Anything that looks like a figure, a total, or a per-gift date.
const MONEY_KEYS = /amount|total_cents|giving_total|first_gift|last_gift|min_giving|cents/i;
const NUMBERS = [String(BIG), String(SMALL), String(MID), '9876', '987.', '123.45', '222.22'];
const expectNoMoney = (text: string) => {
  expect(text).not.toMatch(MONEY_KEYS);
  for (const n of NUMBERS) expect(text).not.toContain(n);
};

beforeEach(seed);

describe('a standard user never sees a figure', () => {
  it('in the people list', async () => {
    const { status, text } = await get('engagement', 'standard@example.org');
    expect(status).toBe(200);
    expectNoMoney(text);
    const people = JSON.parse(text).people;
    expect(people.map((p: { name: string }) => p.name)).toEqual(['Alice Adams', 'Bob Brown', 'Cara Cole', 'Dan Dunn']);
    const tiers = Object.fromEntries(people.map((p: { name: string; giving_tier: string }) => [p.name, p.giving_tier]));
    expect(tiers).toEqual({
      'Alice Adams': 'Large',
      'Bob Brown': 'Medium',
      'Cara Cole': 'Medium',
      'Dan Dunn': 'No gifts',
    });
  });

  it('in every filter and sort, and refuses to sort or filter by amount', async () => {
    for (const q of ['sort=giving_tier&dir=desc', 'sort=name', 'min_tier=2', 'member=1', 'q=a&limit=2&offset=1']) {
      const { status, text } = await get(`engagement?${q}`, 'standard@example.org');
      expect(status, q).toBe(200);
      expectNoMoney(text);
    }
    for (const q of ['sort=giving_total', 'sort=last_gift', 'min_giving_cents=1', 'sort=total_cents']) {
      expect((await get(`engagement?${q}`, 'standard@example.org')).status, q).toBe(400);
    }
  });

  it('cannot infer who gave more from the order inside a tier', async () => {
    const asc = JSON.parse((await get('engagement?sort=giving_tier&dir=desc', 'standard@example.org')).text).people;
    const medium = asc
      .filter((p: { giving_tier: string }) => p.giving_tier === 'Medium')
      .map((p: { name: string }) => p.name);
    // Cara gave more than Bob, but ties fall back to name order, so Bob still comes first.
    expect(medium).toEqual(['Bob Brown', 'Cara Cole']);
  });

  it('in a person’s timeline, where a gift is only "Gift" plus the tier', async () => {
    const { status, text } = await get('timeline/1', 'standard@example.org');
    expect(status).toBe(200);
    expectNoMoney(text);
    const body = JSON.parse(text);
    expect(body.giving).toEqual({ tier: 'Large' });
    expect(body.items.find((i: { type: string }) => i.type === 'gift')).toMatchObject({
      title: 'Gift',
      at: '2026-05-23',
    });
  });

  it('in the bootstrap and export, which carry no giving data at all', async () => {
    for (const path of ['bootstrap', 'export']) {
      const { status, text } = await get(path, 'standard@example.org');
      expect(status).toBe(200);
      expectNoMoney(text);
      expect(text).not.toContain('Annual Appeal');
    }
  });

  it('cannot record, change, or remove a gift', async () => {
    const before = db.raw.prepare('SELECT COUNT(*) n, SUM(amount_cents) s FROM donation').get();
    const body = { person_id: 1, amount_cents: 500, donated_at: '2026-06-01' };
    expect((await post('donation', 'standard@example.org', body)).status).toBe(403);
    expect(
      (await call('donation/1', 'standard@example.org', { method: 'PUT', body: JSON.stringify(body) })).status
    ).toBe(403);
    expect((await call('donation/1', 'standard@example.org', { method: 'DELETE' })).status).toBe(403);
    expect(db.raw.prepare('SELECT COUNT(*) n, SUM(amount_cents) s FROM donation').get()).toEqual(before);
  });

  it('cannot read donations through any generic route', async () => {
    for (const path of ['donation', 'donation/1', 'person_giving', 'giving']) {
      expect([403, 404, 405], path).toContain((await get(path, 'standard@example.org')).status);
    }
  });
});

describe('the finance level sees amounts', () => {
  it('in the people list, with sort and filter by amount', async () => {
    const all = JSON.parse((await get('engagement?sort=giving_total&dir=desc', 'finance@example.org')).text).people;
    expect(all.map((p: { name: string }) => p.name)).toEqual(['Alice Adams', 'Cara Cole', 'Bob Brown', 'Dan Dunn']);
    expect(all[0]).toMatchObject({ total_cents: BIG, last_gift_at: '2026-05-23' });
    const filtered = JSON.parse((await get(`engagement?min_giving_cents=${MID}`, 'finance@example.org')).text).people;
    expect(filtered.map((p: { name: string }) => p.name)).toEqual(['Alice Adams', 'Cara Cole']);
  });

  it('in the timeline, with each gift and the total', async () => {
    const body = JSON.parse((await get('timeline/1', 'finance@example.org')).text);
    expect(body.giving).toEqual({ total_cents: BIG });
    expect(body.items.find((i: { type: string }) => i.type === 'gift')).toMatchObject({
      amount_cents: BIG,
      title: 'Annual Appeal',
    });
  });

  it('can record a gift, stamped with who did it', async () => {
    const res = await post('donation', 'finance@example.org', {
      person_id: 4,
      amount_cents: 2500,
      donated_at: '2026-06-01',
      campaign: 'Check',
    });
    expect(res.status).toBe(201);
    const row = db.raw
      .prepare('SELECT source, source_ref, created_by FROM donation WHERE person_id = 4')
      .get() as Record<string, string>;
    expect(row.source).toBe('manual');
    expect(row.source_ref).toMatch(/^manual-/);
    expect(row.created_by).toBe('finance@example.org');
    for (const bad of [{ amount_cents: 0 }, { amount_cents: 12.5 }, { amount_cents: 100, donated_at: 'soon' }]) {
      expect(
        (await post('donation', 'finance@example.org', { person_id: 4, donated_at: '2026-06-01', ...bad })).status
      ).toBe(400);
    }
  });
});

describe('what the views report', () => {
  it('counts facts per person, without money', async () => {
    const people = JSON.parse((await get('engagement', 'standard@example.org')).text).people;
    const alice = people.find((p: { name: string }) => p.name === 'Alice Adams');
    expect(alice).toMatchObject({
      events_registered: 2,
      events_attended: 1, // the second registration has no attendance mark, so it is not counted
      last_event_year: 2026,
      roles_led: 1,
      last_led_year: 2025,
      volunteer_count: 1,
      serving_now: 1,
      member_now: 0,
      gift_count: 1,
    });
    const bob = people.find((p: { name: string }) => p.name === 'Bob Brown');
    expect(bob).toMatchObject({ member_now: 1, do_not_contact: 0 });
  });

  it('flags do-not-contact, and a cancelled registration is not counted', async () => {
    db.raw.exec("INSERT INTO outreach (person_id, goal, status) VALUES (3, 'invite_back', 'do_not_contact')");
    db.raw.exec(
      "INSERT INTO registration (person_id, event_id, source, entry_ref, status) VALUES (3, 1, 'cognito', 'x', 'cancelled')"
    );
    const rows = JSON.parse((await get('engagement?exclude_do_not_contact=1', 'standard@example.org')).text).people;
    expect(rows.map((p: { name: string }) => p.name)).not.toContain('Cara Cole');
    const cara = JSON.parse((await get('engagement', 'standard@example.org')).text).people.find(
      (p: { name: string }) => p.name === 'Cara Cole'
    );
    expect(cara).toMatchObject({ do_not_contact: 1, events_registered: 0 });
  });

  it('puts a gift in the tier its person total reaches', async () => {
    db.raw.exec(
      "INSERT INTO donation (person_id, source, source_ref, amount_cents, donated_at) VALUES (4, 'manual', 'm1', 1, '2026-01-01')"
    );
    const dan = JSON.parse((await get('engagement', 'standard@example.org')).text).people.find(
      (p: { name: string }) => p.name === 'Dan Dunn'
    );
    expect(dan.giving_tier).toBe('Small');
  });
});

describe('the schema', () => {
  it('keeps one row per adult per entry, and allows several adults in one entry', () => {
    const add = (entry: string, attendee: string) =>
      db.raw
        .prepare(
          "INSERT INTO registration (person_id, event_id, source, entry_ref, attendee_ref) VALUES (4, 2, 'cognito', ?, ?)"
        )
        .run(entry, attendee);
    add('big', 'a1');
    add('big', 'a2'); // same entry, another adult
    expect(() => add('big', 'a1')).toThrow(/UNIQUE/);
  });

  it('keeps registrations free of money, and stores children only as tokens', () => {
    const cols = (t: string) =>
      (db.raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols('registration').join()).not.toMatch(/amount|cents|fee|price|tuition/i);
    expect(cols('child_attendance').join()).not.toMatch(/name|birth|person|email/i);
    const view = (db.raw.prepare('PRAGMA table_info(person_engagement)').all() as { name: string }[])
      .map((c) => c.name)
      .join();
    expect(view).not.toMatch(/amount|cents|giving_total|first_gift|last_gift/i);
  });

  it('enforces uniqueness for gifts, emails, and links, and foreign keys', () => {
    const run = (sql: string, ...p: (string | number)[]) => db.raw.prepare(sql).run(...p);
    run(
      "INSERT INTO donation (person_id, source, source_ref, line_ref, amount_cents, donated_at) VALUES (1, 'zeffy', 'p9', 'a', 1, '2026-01-01')"
    );
    run(
      "INSERT INTO donation (person_id, source, source_ref, line_ref, amount_cents, donated_at) VALUES (1, 'zeffy', 'p9', 'b', 1, '2026-01-01')"
    ); // another line of one payment
    expect(() =>
      run(
        "INSERT INTO donation (person_id, source, source_ref, line_ref, amount_cents, donated_at) VALUES (1, 'zeffy', 'p9', 'a', 1, '2026-01-01')"
      )
    ).toThrow(/UNIQUE/);
    run("INSERT INTO person_email (person_id, email_lower) VALUES (1, 'a@example.org')");
    expect(() => run("INSERT INTO person_email (person_id, email_lower) VALUES (1, 'a@example.org')")).toThrow(
      /UNIQUE/
    );
    run("INSERT INTO person_email (person_id, email_lower, shared) VALUES (2, 'a@example.org', 1)"); // a shared address is allowed
    expect(() => run("INSERT INTO volunteer (person_id, task) VALUES (999, 'x')")).toThrow(/FOREIGN KEY/);
  });
});

describe('erasing a person', () => {
  const seedMore = () => {
    db.raw.exec(`
      INSERT INTO person_email (person_id, email_lower) VALUES (1, 'alice@example.org');
      INSERT INTO person_alias (person_id, alias_norm) VALUES (1, 'allie adams');
      UPDATE person SET notes = 'private note', leader_slug = 'alice-adams' WHERE id = 1;
      UPDATE outreach SET note = 'x' WHERE person_id = 2;
      INSERT INTO outreach (person_id, goal, note) VALUES (1, 'invite_lead', 'asked her');
    `);
  };

  it('is for admins only, and needs the id repeated', async () => {
    seedMore();
    expect((await post('erase/1', 'standard@example.org', { confirm: 1 })).status).toBe(403);
    expect((await post('erase/1', 'finance@example.org', { confirm: 1 })).status).toBe(403);
    expect((await post('erase/1', 'admin@example.org', { confirm: 2 })).status).toBe(400);
    expect((await post('erase/1', 'admin@example.org', {})).status).toBe(400);
    expect(db.raw.prepare('SELECT name FROM person WHERE id = 1').get()).toMatchObject({ name: 'Alice Adams' });
  });

  it('clears everything that identifies them, and keeps the counts whole', async () => {
    seedMore();
    expect((await post('erase/1', 'admin@example.org', { confirm: 1 })).status).toBe(200);
    expect(db.raw.prepare('SELECT * FROM person WHERE id = 1').get()).toMatchObject({
      name: 'Removed person',
      email: null,
      leader_slug: null,
      notes: null,
      status: 'inactive',
      mentor: 0,
    });
    expect(
      (db.raw.prepare('SELECT erased_at FROM person WHERE id = 1').get() as { erased_at: string }).erased_at
    ).toBeTruthy();
    expect(db.raw.prepare('SELECT COUNT(*) n FROM person_email WHERE person_id = 1').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT COUNT(*) n FROM person_alias WHERE person_id = 1').get()).toEqual({ n: 0 });
    expect(db.raw.prepare('SELECT body, focus, deleted_at FROM journey_note WHERE person_id = 1').get()).toMatchObject({
      body: '[removed]',
      focus: null,
    });
    expect(db.raw.prepare('SELECT how_it_went FROM role WHERE person_id = 1').get()).toEqual({ how_it_went: null });
    expect(db.raw.prepare('SELECT note FROM outreach WHERE person_id = 1').get()).toEqual({ note: null });
    // the records themselves stay, so the history's counts are unchanged
    expect(db.raw.prepare('SELECT COUNT(*) n FROM registration WHERE person_id = 1').get()).toEqual({ n: 2 });
    expect(db.raw.prepare('SELECT COUNT(*) n FROM donation WHERE person_id = 1').get()).toEqual({ n: 1 });
  });

  it('removes them from every view of the data, and logs the id but not the name', async () => {
    await post('erase/1', 'admin@example.org', { confirm: 1 });
    for (const as of ['standard@example.org', 'finance@example.org']) {
      expect((await get('timeline/1', as)).status).toBe(404);
      const list = (await get('engagement', as)).text;
      expect(list).not.toContain('Alice');
      expect(list).not.toContain('Removed person');
    }
    const boot = (await get('bootstrap', 'standard@example.org')).text;
    expect(JSON.parse(boot).people.map((p: { id: number }) => p.id)).not.toContain(1);
    const log = db.raw.prepare("SELECT actor, target, detail FROM audit_log WHERE action = 'person.erase'").all();
    expect(log).toEqual([{ actor: 'admin@example.org', target: '1', detail: null }]);
    expect(JSON.stringify(log)).not.toContain('Alice');
    expect((await post('erase/1', 'admin@example.org', { confirm: 1 })).status).toBe(404); // already gone
  });
});

describe('the new record types', () => {
  it('can be added by a standard user, and are validated', async () => {
    const ok = [
      [
        'service',
        { person_id: 2, body: 'Programming Committee', title: 'Co-chair', started_on: '2025', ended_on: '2025-12' },
      ],
      ['volunteer', { person_id: 2, event_id: 1, task: 'Set up', hours: 2.5 }],
      ['outreach', { person_id: 2, goal: 'invite_committee', status: 'contacted', contacted_on: '2026-11-01' }],
    ] as const;
    for (const [path, body] of ok) expect((await post(path, 'standard@example.org', body)).status, path).toBe(201);
    const bad = [
      ['service', { person_id: 2, body: '' }],
      ['service', { person_id: 2, body: 'Board', started_on: 'last year' }],
      ['volunteer', { person_id: 2, task: 'x', hours: -1 }],
      ['outreach', { person_id: 2, goal: 'invite_friend' }],
      ['outreach', { person_id: 2, goal: 'invite_back', status: 'maybe' }],
    ] as const;
    for (const [path, body] of bad) expect((await post(path, 'standard@example.org', body)).status, path).toBe(400);
    expect(db.raw.prepare('SELECT created_by FROM service WHERE person_id = 2').get()).toEqual({
      created_by: 'standard@example.org',
    });
  });
});

describe('volunteers and service on the page', () => {
  it('come with the bootstrap, and still carry no money', async () => {
    const { text } = await get('bootstrap', 'standard@example.org');
    const body = JSON.parse(text);
    expect(body.service).toHaveLength(1);
    expect(body.service[0]).toMatchObject({ body: 'Board', title: 'Chair' });
    expect(body.volunteers).toEqual([expect.objectContaining({ person_id: 1, task: 'Moved tables' })]);
    expectNoMoney(text);
  });

  it('can be added several at a time by any level, stamped with who did it', async () => {
    const rows = [
      { person_id: 2, event_id: 1, task: 'Set up', hours: 2 },
      { person_id: 3, event_id: 1, task: 'Set up' },
    ];
    const res = await post('volunteers/bulk', 'standard@example.org', { rows });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 2 });
    expect(
      db.raw
        .prepare("SELECT person_id, hours, created_by FROM volunteer WHERE task = 'Set up' ORDER BY person_id")
        .all()
    ).toEqual([
      { person_id: 2, hours: 2, created_by: 'standard@example.org' },
      { person_id: 3, hours: null, created_by: 'standard@example.org' },
    ]);
  });

  it('refuses an empty list, too many, or a bad row, and adds nothing', async () => {
    const good = { person_id: 2, event_id: 1, task: 'Set up' };
    for (const rows of [
      [],
      Array(201).fill(good),
      [good, { person_id: 2, event_id: 1, task: '' }],
      [good, { ...good, hours: -3 }],
    ]) {
      expect((await post('volunteers/bulk', 'standard@example.org', { rows })).status).toBe(400);
    }
    expect(db.raw.prepare("SELECT COUNT(*) n FROM volunteer WHERE task = 'Set up'").get()).toEqual({ n: 0 });
  });

  it('give timeline items their parts as separate fields', async () => {
    const body = JSON.parse((await get('timeline/1', 'standard@example.org')).text);
    expect(body.items.find((i: { type: string }) => i.type === 'role')).toMatchObject({
      leadership_type: 'solo',
      event: 'Camp 2025',
      title: 'Games Class',
    });
    expect(body.items.find((i: { type: string }) => i.type === 'volunteer')).toMatchObject({
      event: 'Camp 2025',
      title: 'Moved tables',
    });
    expect(body.items.find((i: { type: string }) => i.type === 'registration')).toMatchObject({
      event: expect.any(String),
    });
  });
});
