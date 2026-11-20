// Cloudflare Pages Function: /api/internal/leadership/*
//
// Backs /internal/engagement (and the older /internal/leadership). Every request is authenticated by verifying the
// Cloudflare Access JWT here (see ../../../_lib/access.js), because the Access
// application does not cover *.pages.dev. Needs the D1 binding `DB`.
//
//   GET    bootstrap                       everything, in one call
//   GET    export                          JSON backup
//   GET    users                           the access list (admins only)
//   POST   users                           { email, level, is_admin } add or change (admins only)
//   PUT    users/<email>                   { level, is_admin }
//   DELETE users/<email>                   remove (admins only)
//   GET    engagement                      people with engagement facts (paged; money redacted by level)
//   GET    timeline/<personId>             one person's history across every record type
//   GET    journey                         the board: funnel counts and each stage's first people (or one stage with ?stage=)
//   GET    journey/<personId>              one person's stage and plan
//   PUT    journey/<personId>              { target, next_step, due_on, owner } set their plan
//   DELETE journey/<personId>              clear their plan
//   POST   erase/<personId>                { confirm: <personId> } clear a person's identity (admins only)
//   GET    duplicates                      people who may be one person (admins only)
//   GET    merge/<fromId>/<intoId>         what a merge would move, as counts (admins only)
//   POST   merge/<fromId>/<intoId>         { confirm: <fromId> } fold the first into the second (admins only)
//   POST   venue                           { name, address } add a venue; its location is looked up from the address
//   POST   roles/bulk                      { rows: [role, ...] }
//   POST   volunteers/bulk                 { rows: [volunteer, ...] }
//   POST   <resource>                      create
//   PUT    <resource>/<id>                 update
//   DELETE <resource>/<id>                 soft delete
// where <resource> is person | activity | event | role | note | service | volunteer | outreach,
// plus donation, which only the finance level may touch.

import { authenticate, json, sameOriginWrite } from '../../../_lib/access.js';
import {
  erasePerson,
  listEngagement,
  mergePeople,
  mergePreview,
  possibleDuplicates,
  timeline,
} from '../../../_lib/engagement.js';
import { clearPlan, journeyBoard, journeyOne, savePlan, validatePlan } from '../../../_lib/journey.js';
import { createVenue } from '../../../_lib/venues.js';
import { audit, listUsers, removeUser, resolveUser, saveUser, validateUser } from '../../../_lib/roles.js';
import {
  ValidationError,
  bootstrap,
  bulkAddRoles,
  bulkAddVolunteers,
  createRow,
  exportAll,
  findDuplicate,
  softDelete,
  updateRow,
  validators,
} from '../../../_lib/leadership.js';

const MAX_BODY_BYTES = 64 * 1024;
const RESOURCES = Object.keys(validators);

const readBody = async (request) => {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ValidationError('body too large');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new ValidationError('body must be JSON');
  }
};

export const onRequest = async ({ request, env, params }) => {
  const auth = await authenticate(request, env);
  if (auth.response) return auth.response;
  if (!sameOriginWrite(request)) return json(403, { error: 'forbidden' });
  if (!env.DB) return json(503, { error: 'database not configured' });

  // Passing Access is not enough: the person must be on the access list.
  const user = await resolveUser(env.DB, auth);
  if (!user) {
    return json(403, { error: 'You are signed in, but not on the access list. Ask an admin to add you.' });
  }

  const [first, second, third] = [].concat(params.path ?? []);
  const method = request.method;

  try {
    if (method === 'GET' && first === 'bootstrap' && !second) {
      return json(200, { me: auth.email, level: user.level, isAdmin: !!user.is_admin, ...(await bootstrap(env.DB)) });
    }
    if (method === 'GET' && first === 'export' && !second) {
      await audit(env.DB, auth.email, 'export');
      return new Response(JSON.stringify(await exportAll(env.DB)), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'content-disposition': 'attachment; filename="leadership-export.json"',
        },
      });
    }
    if (first === 'users') {
      if (!user.is_admin) return json(403, { error: 'Only admins can manage access.' });
      if (method === 'GET' && !second) return json(200, { users: await listUsers(env.DB) });
      if (method === 'POST' && !second) {
        await saveUser(env.DB, validateUser(await readBody(request)), auth.email);
        return json(200, { ok: true });
      }
      if (method === 'PUT' && second) {
        const body = await readBody(request);
        await saveUser(env.DB, validateUser({ ...body, email: decodeURIComponent(second) }), auth.email);
        return json(200, { ok: true });
      }
      if (method === 'DELETE' && second) {
        return (await removeUser(env.DB, decodeURIComponent(second), auth.email))
          ? json(200, { ok: true })
          : json(404, { error: 'not found' });
      }
      return json(405, { error: 'method not allowed' });
    }
    if (method === 'GET' && first === 'engagement' && !second) {
      return json(200, await listEngagement(env.DB, user, new URL(request.url).searchParams));
    }
    if (first === 'journey') {
      if (method === 'GET' && !second) {
        return json(200, await journeyBoard(env.DB, new URL(request.url).searchParams, auth.email));
      }
      const personId = Number(second);
      if (!Number.isInteger(personId) || personId < 1) return json(404, { error: 'not found' });
      if (method === 'GET') {
        const found = await journeyOne(env.DB, personId);
        return found ? json(200, found) : json(404, { error: 'not found' });
      }
      if (method === 'PUT') {
        const saved = await savePlan(env.DB, personId, validatePlan(await readBody(request)), auth.email);
        return saved ? json(200, { ok: true }) : json(404, { error: 'not found' });
      }
      if (method === 'DELETE')
        return (await clearPlan(env.DB, personId, auth.email))
          ? json(200, { ok: true })
          : json(404, { error: 'not found' });
    }
    if (method === 'GET' && first === 'timeline' && second) {
      const found = await timeline(env.DB, user, Number(second));
      return found ? json(200, found) : json(404, { error: 'not found' });
    }
    if (method === 'POST' && first === 'erase' && second) {
      if (!user.is_admin) return json(403, { error: 'Only admins can erase a person.' });
      const personId = Number(second);
      const { confirm } = await readBody(request);
      if (!Number.isInteger(personId) || confirm !== personId)
        throw new ValidationError('confirm must repeat the person id');
      return (await erasePerson(env.DB, personId, auth.email))
        ? json(200, { ok: true })
        : json(404, { error: 'not found' });
    }
    if (first === 'duplicates' || first === 'merge') {
      if (!user.is_admin) return json(403, { error: 'Only admins can merge people.' });
      if (method === 'GET' && first === 'duplicates') return json(200, { pairs: await possibleDuplicates(env.DB) });
      const [fromId, intoId] = [Number(second), Number(third)];
      if (!Number.isInteger(fromId) || !Number.isInteger(intoId)) return json(404, { error: 'not found' });
      if (method === 'GET') {
        const found = await mergePreview(env.DB, fromId, intoId);
        return found ? json(200, found) : json(404, { error: 'not found' });
      }
      if (method === 'POST') {
        const { confirm } = await readBody(request);
        if (confirm !== fromId) throw new ValidationError('confirm must repeat the id of the record being merged away');
        const done = await mergePeople(env.DB, fromId, intoId, auth.email);
        return done ? json(200, done) : json(404, { error: 'not found' });
      }
    }
    if (first === 'venue' && method === 'POST' && !second) {
      return json(201, { id: await createVenue(env.DB, await readBody(request), auth.email) });
    }
    if (first === 'donation' && user.level !== 'finance') {
      return json(403, { error: 'Only the finance level can record or change gifts.' });
    }
    if (method === 'POST' && first === 'volunteers' && second === 'bulk') {
      const { rows } = await readBody(request);
      return json(200, { added: await bulkAddVolunteers(env.DB, rows, auth.email) });
    }
    if (method === 'POST' && first === 'roles' && second === 'bulk') {
      const { rows } = await readBody(request);
      return json(200, { added: await bulkAddRoles(env.DB, rows, auth.email) });
    }
    if (!RESOURCES.includes(first)) return json(404, { error: 'not found' });

    if (method === 'POST' && !second) {
      const values = validators[first](await readBody(request));
      if (await findDuplicate(env.DB, first, values)) return json(409, { error: 'already exists' });
      return json(201, { id: await createRow(env.DB, first, values, auth.email) });
    }

    const rowId = Number(second);
    if (!Number.isInteger(rowId) || rowId < 1) return json(404, { error: 'not found' });

    if (method === 'PUT') {
      const values = validators[first](await readBody(request));
      if (await findDuplicate(env.DB, first, values, rowId)) return json(409, { error: 'already exists' });
      return (await updateRow(env.DB, first, rowId, values, auth.email))
        ? json(200, { ok: true })
        : json(404, { error: 'not found' });
    }
    if (method === 'DELETE') {
      return (await softDelete(env.DB, first, rowId, auth.email))
        ? json(200, { ok: true })
        : json(404, { error: 'not found' });
    }
    return json(405, { error: 'method not allowed' });
  } catch (err) {
    if (err instanceof ValidationError) return json(400, { error: err.message });
    // A unique-constraint hit on role (same person, activity, event) is the one expected DB error.
    if (String(err?.message).includes('UNIQUE')) return json(409, { error: 'already exists' });
    console.error('leadership api error', err);
    return json(500, { error: 'server error' });
  }
};
