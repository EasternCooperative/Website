// Who may use the tracker and what they may see. Pure functions over a D1 binding.
// Access (see access.js) proves identity; this decides permission. Missing means no.

import { ValidationError } from './leadership.js';

export const LEVELS = ['finance', 'standard'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Local development (DEV_AUTH_EMAIL on localhost) is treated as a full admin. */
const DEV_USER = { level: 'finance', is_admin: 1 };

export async function resolveUser(db, auth) {
  if (auth.dev) return { email: auth.email, ...DEV_USER };
  const { results } = await db
    .prepare('SELECT email_lower, level, is_admin FROM app_user WHERE email_lower = ? AND deleted_at IS NULL')
    .bind(auth.email.toLowerCase())
    .all();
  const row = results[0];
  return row ? { email: row.email_lower, level: row.level, is_admin: row.is_admin } : null;
}

export async function listUsers(db) {
  const { results } = await db
    .prepare(
      'SELECT email_lower AS email, level, is_admin, protected, updated_at, updated_by FROM app_user WHERE deleted_at IS NULL ORDER BY email_lower'
    )
    .all();
  return results;
}

export function validateUser(b) {
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 200) throw new ValidationError('enter a valid email address');
  if (!LEVELS.includes(b.level)) throw new ValidationError(`level must be one of: ${LEVELS.join(', ')}`);
  if (b.is_admin !== undefined && typeof b.is_admin !== 'boolean')
    throw new ValidationError('is_admin must be yes or no');
  return { email, level: b.level, is_admin: b.is_admin ? 1 : 0 };
}

export async function audit(db, actor, action, target = null, detail = null) {
  await db
    .prepare('INSERT INTO audit_log (actor, action, target, detail) VALUES (?, ?, ?, ?)')
    .bind(actor, action, target, detail)
    .run();
}

// Nobody changes their own access. That also means the last admin can never lock
// everyone out: only an admin can change others, and the acting admin stays.
const notSelf = (email, actor) => {
  if (email === actor.toLowerCase()) throw new ValidationError('You can’t change your own access.');
};

// Owners are protected in the database too (triggers in migration 0005); this gives the friendly message.
async function refuseIfProtected(db, email) {
  const { results } = await db
    .prepare('SELECT protected FROM app_user WHERE email_lower = ? AND deleted_at IS NULL')
    .bind(email)
    .all();
  if (results[0]?.protected === 1) {
    throw new ValidationError('This person’s access is protected. It can’t be changed or removed.');
  }
}

/** Add someone, or change their level or admin flag. Re-adding a removed person brings them back. */
export async function saveUser(db, user, actor) {
  notSelf(user.email, actor);
  await refuseIfProtected(db, user.email);
  await db
    .prepare(
      `INSERT INTO app_user (email_lower, level, is_admin, created_by, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (email_lower) DO UPDATE SET level = excluded.level, is_admin = excluded.is_admin,
         deleted_at = NULL, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    )
    .bind(user.email, user.level, user.is_admin, actor, actor)
    .run();
  await audit(db, actor, 'user.save', user.email, `${user.level}${user.is_admin ? ', admin' : ''}`);
}

export async function removeUser(db, email, actor) {
  const target = email.trim().toLowerCase();
  notSelf(target, actor);
  await refuseIfProtected(db, target);
  const res = await db
    .prepare(
      `UPDATE app_user SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE email_lower = ? AND deleted_at IS NULL`
    )
    .bind(actor, target)
    .run();
  if (res.meta.changes > 0) await audit(db, actor, 'user.remove', target);
  return res.meta.changes > 0;
}
