import { describe, expect, it } from 'vitest';
import { groupClassesByPeriod, resolveClassLeaderNames } from '../utils/classes';

describe('groupClassesByPeriod', () => {
  it('returns an empty map for empty input', () => {
    expect(groupClassesByPeriod([])).toEqual(new Map());
  });

  it('groups classes by period in first-seen insertion order', () => {
    const classes = [
      { name: 'Folk Dance', period: 'Morning First Period' },
      { name: 'Sketch 101', period: 'Morning Second Period' },
      { name: 'Games', period: 'Morning Second Period' },
    ];
    const groups = groupClassesByPeriod(classes);
    expect([...groups.keys()]).toEqual(['Morning First Period', 'Morning Second Period']);
    expect(groups.get('Morning First Period')).toHaveLength(1);
    expect(groups.get('Morning Second Period')).toHaveLength(2);
  });

  it('preserves class insertion order within each group', () => {
    const classes = [
      { name: 'A', period: 'Morning' },
      { name: 'B', period: 'Afternoon' },
      { name: 'C', period: 'Morning' },
    ];
    const groups = groupClassesByPeriod(classes);
    expect(groups.get('Morning')!.map((c) => c.name)).toEqual(['A', 'C']);
    expect(groups.get('Afternoon')!.map((c) => c.name)).toEqual(['B']);
  });

  it('groups classes without a period under the empty string key', () => {
    const classes = [{ name: 'A' }, { name: 'B', period: 'Morning' }];
    const groups = groupClassesByPeriod(classes);
    expect([...groups.keys()]).toEqual(['', 'Morning']);
    expect(groups.get('')!.map((c) => c.name)).toEqual(['A']);
  });

  it('handles all classes without periods', () => {
    const classes = [{ name: 'A' }, { name: 'B' }];
    const groups = groupClassesByPeriod(classes);
    expect([...groups.keys()]).toEqual(['']);
    expect(groups.get('')).toHaveLength(2);
  });

  it('a new period seen later appears after earlier periods', () => {
    const classes = [
      { name: 'X', period: 'Afternoon' },
      { name: 'Y', period: 'Morning' },
      { name: 'Z', period: 'Afternoon' },
    ];
    const groups = groupClassesByPeriod(classes);
    expect([...groups.keys()]).toEqual(['Afternoon', 'Morning']);
  });

  it('passes through all class fields unchanged', () => {
    const cls = {
      name: 'Yoga',
      leader: 'Jane',
      ageRange: '12+',
      period: 'Morning',
      days: 'Days 1–2',
      limitedCapacity: true,
      description: 'Gentle movement class.',
      callout: 'Register early — fills fast.',
    };
    const groups = groupClassesByPeriod([cls]);
    expect(groups.get('Morning')![0]).toEqual(cls);
  });

  it('passes through leaders array unchanged', () => {
    const cls = {
      name: 'Folk Dance',
      leaders: [{ id: 'isaac-lebwohl-steiner' }, { id: 'judi-powers' }],
      period: 'Morning',
    };
    const groups = groupClassesByPeriod([cls]);
    expect(groups.get('Morning')![0]).toEqual(cls);
  });
});

describe('resolveClassLeaderNames', () => {
  const leaderMap = new Map([
    ['heather-klemanski', { name: 'Heather Klemanski' }],
    ['judi-powers', { name: 'Judi Powers' }],
  ]);

  it('returns an empty array when the class has no leader data', () => {
    expect(resolveClassLeaderNames({ name: 'Break' }, leaderMap)).toEqual([]);
  });

  it('resolves leaders[].id entries against the leader map', () => {
    const cls = { name: 'Folk Dance', leaders: [{ id: 'heather-klemanski' }, { id: 'judi-powers' }] };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Heather Klemanski', 'Judi Powers']);
  });

  it('falls back to leaders[].name when the id is unresolved', () => {
    const cls = { name: 'Improv', leaders: [{ id: 'unknown-id', name: 'Maria Paciona' }] };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Maria Paciona']);
  });

  it('uses leaders[].name directly when no id is present', () => {
    const cls = { name: 'Improv', leaders: [{ name: 'Maria Paciona' }] };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Maria Paciona']);
  });

  it('drops leaders[] entries that resolve to no name', () => {
    const cls = { name: 'Improv', leaders: [{ id: 'unknown-id' }] };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual([]);
  });

  it('falls back to leaderId when leaders[] is absent', () => {
    const cls = { name: 'Games', leaderId: 'heather-klemanski' };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Heather Klemanski']);
  });

  it('falls back to the plain-text leader field when leaderId is unresolved', () => {
    const cls = { name: 'Games', leaderId: 'unknown-id', leader: 'Guest Caller' };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Guest Caller']);
  });

  it('uses the plain-text leader field when no leaderId is present', () => {
    const cls = { name: 'Games', leader: 'Guest Caller' };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Guest Caller']);
  });

  it('prefers leaders[] over the singular leaderId/leader fields when both are present', () => {
    const cls = { name: 'Games', leaderId: 'judi-powers', leaders: [{ id: 'heather-klemanski' }] };
    expect(resolveClassLeaderNames(cls, leaderMap)).toEqual(['Heather Klemanski']);
  });
});
