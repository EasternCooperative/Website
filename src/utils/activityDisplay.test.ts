import { describe, it, expect } from 'vitest';
import { sentenceCase, getPosturePill, getBadges, formatGroupSize } from './activityDisplay';

describe('sentenceCase', () => {
  it('capitalizes the first letter only', () => {
    expect(sentenceCase('standing')).toBe('Standing');
  });
});

describe('getPosturePill', () => {
  it('returns the posture label with accessible=false when not wheelchair adaptable', () => {
    expect(getPosturePill({ posture: 'standing', seatedOrWheelchairAdaptable: false })).toEqual({
      label: 'Standing',
      accessible: false,
    });
  });

  it('returns the posture label with accessible=true when also wheelchair adaptable', () => {
    expect(getPosturePill({ posture: 'sitting', seatedOrWheelchairAdaptable: true })).toEqual({
      label: 'Sitting',
      accessible: true,
    });
  });

  it('falls back to a generic label when only seatedOrWheelchairAdaptable is set', () => {
    expect(getPosturePill({ seatedOrWheelchairAdaptable: true })).toEqual({
      label: 'Seated/wheelchair adaptable',
      accessible: true,
    });
  });

  it('returns undefined when neither field is set', () => {
    expect(getPosturePill({})).toBeUndefined();
  });
});

describe('getBadges', () => {
  it('includes only the badges whose flags are true', () => {
    expect(getBadges({ isCalled: true, isRound: false, beginnerAdaptable: true })).toEqual([
      'Called live',
      'Beginner adaptable',
    ]);
  });

  it('returns an empty array when no flags are set', () => {
    expect(getBadges({})).toEqual([]);
  });
});

describe('formatGroupSize', () => {
  it('prefers the free-text groupSize field when present', () => {
    expect(formatGroupSize({ groupSize: 'Any size', groupSizeMin: 5, groupSizeMax: 10 })).toBe('Any size');
  });

  it('formats a min/max range', () => {
    expect(formatGroupSize({ groupSizeMin: 6, groupSizeMax: 20 })).toBe('6–20');
  });

  it('formats a min-only value with a "+"', () => {
    expect(formatGroupSize({ groupSizeMin: 6 })).toBe('6+');
  });

  it('formats a max-only value as "Up to N"', () => {
    expect(formatGroupSize({ groupSizeMax: 20 })).toBe('Up to 20');
  });

  it('returns undefined when nothing is set', () => {
    expect(formatGroupSize({})).toBeUndefined();
  });
});
