// A real SQLite database that looks like a D1 binding, for tests that must exercise the
// actual schema, views, and constraints rather than a stub that returns canned rows.
// Applies every migration in order, the way production does.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type Param = string | number | null;

export function sqliteD1(upTo?: string) {
  const raw = new DatabaseSync(':memory:');
  const dir = path.resolve(__dirname, '../../migrations');
  for (const file of readdirSync(dir).sort()) {
    if (upTo && file > upTo) break;
    raw.exec(readFileSync(path.join(dir, file), 'utf8'));
  }
  raw.exec('PRAGMA foreign_keys = ON');

  const statement = (sql: string, params: Param[] = []) => {
    const st = raw.prepare(sql);
    return {
      // Like D1, bind returns a new statement, so a batch can reuse one prepared query.
      bind: (...p: Param[]) => statement(sql, p),
      async all() {
        return { results: st.all(...params) as Record<string, unknown>[] };
      },
      async run() {
        const r = st.run(...params);
        return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
    };
  };

  const d1 = {
    prepare: (sql: string) => statement(sql),
    // One transaction, like D1's batch.
    async batch(stmts: ReturnType<typeof statement>[]) {
      raw.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { d1, raw };
}
