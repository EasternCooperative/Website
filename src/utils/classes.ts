export type LeaderEntry = {
  id?: string;
  name?: string;
  role?: 'assistant';
};

export type EventClass = {
  name: string;
  leaders?: LeaderEntry[];
  leaderId?: string;
  leader?: string;
  ageRange?: string;
  period?: string;
  days?: string;
  room?: string;
  limitedCapacity?: boolean;
  description?: string;
  callout?: string;
};

/**
 * Resolves the leader name(s) for a single class, preferring the `leaders`
 * array and falling back to the singular `leaderId`/`leader` fields — same
 * precedence used to render leader chips on the event page. `leaderId`
 * lookups that don't resolve fall back to the plain-text `leader`/`name`.
 */
export function resolveClassLeaderNames(cls: EventClass, leaderMap: Map<string, { name: string }>): string[] {
  const entries = cls.leaders?.length
    ? cls.leaders
    : cls.leaderId || cls.leader
      ? [{ id: cls.leaderId, name: cls.leader }]
      : [];
  const names = entries
    .map((l) => (l.id ? (leaderMap.get(l.id)?.name ?? l.name) : l.name))
    .filter((n): n is string => !!n);
  return names;
}

/**
 * Groups classes by period in first-seen insertion order.
 * Classes with no period are grouped under the empty string key.
 */
export function groupClassesByPeriod(classes: EventClass[]): Map<string, EventClass[]> {
  const groups = new Map<string, EventClass[]>();
  for (const cls of classes) {
    const key = cls.period ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(cls);
  }
  return groups;
}
