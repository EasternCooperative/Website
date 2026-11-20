import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { ApiError, deleteUser, listUsers, saveUser } from './api';
import {
  ConfirmRemove,
  ErrorNote,
  Field,
  PanelFrame,
  Segmented,
  Split,
  inputCls,
  linkBtn,
  primaryBtn,
  secondaryBtn,
  surfaceHover,
  useAction,
} from './forms';
import type { AccessLevel, AppUser } from './model';

export const LEVEL_LABELS: Record<AccessLevel, string> = { finance: 'Finance', standard: 'Standard' };
const LEVEL_HINT: Record<AccessLevel, string> = {
  finance: 'Sees exact donation amounts. For the board and the treasurer.',
  standard: 'Sees everything except amounts. Giving shows as a broad tier.',
};
const LEVEL_OPTIONS = (Object.keys(LEVEL_LABELS) as AccessLevel[]).map((value) => ({
  value,
  label: LEVEL_LABELS[value],
}));

function UserPanel({
  user,
  me,
  reload,
  onClose,
}: {
  user: AppUser | null;
  me: string;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(user?.email ?? '');
  const [level, setLevel] = useState<AccessLevel>(user?.level ?? 'standard');
  const [admin, setAdmin] = useState(user?.is_admin === 1);
  const { busy, error, run } = useAction(reload);
  const isMe = !!user && user.email === me.toLowerCase();
  const locked = isMe || user?.protected === 1;
  const ready = email.trim() !== '';

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (!ready || locked) return;
    if ((await run(() => saveUser({ email: email.trim(), level, is_admin: admin }))).ok) onClose();
  };

  return (
    <PanelFrame
      label={user ? `${user.email} access` : 'Add someone'}
      title={user ? user.email : 'Add someone'}
      onClose={onClose}
    >
      {user?.protected === 1 ? (
        <p className="mt-3 text-sm text-muted">Protected. This access can’t be changed or removed.</p>
      ) : (
        isMe && <p className="mt-3 text-sm text-muted">This is you. Ask another admin to change your access.</p>
      )}
      <form onSubmit={onSubmit} className="mt-4 space-y-3">
        {!user && (
          <Field label="Email" hint="The address they sign in with.">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </Field>
        )}
        <div>
          <Segmented name="access-level" legend="Can see" value={level} options={LEVEL_OPTIONS} onChange={setLevel} />
          <p className="mt-1 text-xs text-muted">{LEVEL_HINT[level]}</p>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} className="mt-1" />
          <span>
            Can manage this list
            <span className="block text-xs text-muted">
              Admins add and remove people. It does not show amounts by itself.
            </span>
          </span>
        </label>
        <ErrorNote message={error} />
        {!locked && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={!ready || busy} className={primaryBtn}>
              {user ? 'Save' : 'Add person'}
            </button>
            {!user && (
              <button type="button" onClick={onClose} className={linkBtn}>
                Cancel
              </button>
            )}
          </div>
        )}
      </form>
      {user && !locked && (
        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
          <ConfirmRemove
            what={user.email}
            disabled={busy}
            onConfirm={async () => {
              if ((await run(() => deleteUser(user.email))).ok) onClose();
            }}
          />
        </div>
      )}
    </PanelFrame>
  );
}

/** Admins only: who may use the tool, and whether they see donation amounts. */
export default function UsersView({ me }: { me: string }) {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers((await listUsers()).users);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as ApiError).message); // request() only ever throws ApiError
      throw e;
    }
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const selected = typeof sel === 'string' && sel !== 'new' ? users?.find((u) => u.email === sel) : undefined;

  return (
    <Split
      open={sel === 'new' || selected !== undefined}
      list={
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose text-sm text-muted">
              Only people on this list can open the tracker. Finance sees exact donation amounts; everyone else sees
              giving as a broad tier.
            </p>
            <button type="button" onClick={() => setSel('new')} className={secondaryBtn}>
              Add someone
            </button>
          </div>
          <ErrorNote message={loadError} />
          {users && (
            <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {users.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    onClick={() => setSel(u.email)}
                    aria-pressed={sel === u.email}
                    className={`flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm ${surfaceHover} ${
                      sel === u.email ? 'bg-primary/10' : ''
                    }`}
                  >
                    <span className="break-all font-medium">
                      {u.email}
                      {u.email === me.toLowerCase() && <span className="ml-2 font-normal text-muted">(you)</span>}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted">
                      {LEVEL_LABELS[u.level]}
                      {u.is_admin === 1 ? ', admin' : ''}
                      {u.protected === 1 ? ', protected' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
      panel={
        <UserPanel key={sel ?? 'none'} user={selected ?? null} me={me} reload={load} onClose={() => setSel(null)} />
      }
    />
  );
}
