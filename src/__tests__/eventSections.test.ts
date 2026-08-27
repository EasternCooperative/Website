import { describe, it, expect } from 'vitest';
import { computeEventSections, type EventSectionsInput } from '~/utils/eventSections';

const FUTURE = new Date('2099-01-01T00:00:00Z');
const PAST = new Date('2000-01-01T00:00:00Z');
const NOW = new Date('2026-06-21T12:00:00Z');

function base(overrides: Partial<EventSectionsInput> = {}): EventSectionsInput {
  return {
    date: FUTURE,
    ...overrides,
  };
}

// ─── isPast ──────────────────────────────────────────────────────────────────

describe('isPast', () => {
  it('is false when date is in the future', () => {
    const r = computeEventSections(base({ date: FUTURE }), NOW);
    expect(r.isPast).toBe(false);
  });

  it('is true when date is in the past and no endDate', () => {
    const r = computeEventSections(base({ date: PAST }), NOW);
    expect(r.isPast).toBe(true);
  });

  it('uses endDate when present: endDate in future → not past', () => {
    const r = computeEventSections(base({ date: PAST, endDate: FUTURE }), NOW);
    expect(r.isPast).toBe(false);
  });

  it('uses endDate when present: endDate in past → past', () => {
    const r = computeEventSections(base({ date: PAST, endDate: new Date('2001-01-01') }), NOW);
    expect(r.isPast).toBe(true);
  });
});

// ─── registerMode ────────────────────────────────────────────────────────────

describe('registerMode', () => {
  it('is "cognito" when cognitoFormId is set', () => {
    const r = computeEventSections(base({ cognitoFormId: '42' }), NOW);
    expect(r.registerMode).toBe('cognito');
  });

  it('is "url" when registrationUrl is set and no cognitoFormId', () => {
    const r = computeEventSections(base({ registrationUrl: 'https://example.com/register' }), NOW);
    expect(r.registerMode).toBe('url');
  });

  it('is "cognito" when both cognitoFormId and registrationUrl are set (cognito wins)', () => {
    const r = computeEventSections(base({ cognitoFormId: '42', registrationUrl: 'https://example.com/register' }), NOW);
    expect(r.registerMode).toBe('cognito');
  });

  it('is "zeffy" when zeffyFormUrl is set and no cognitoFormId', () => {
    const r = computeEventSections(base({ zeffyFormUrl: '/embed/ticketing/example' }), NOW);
    expect(r.registerMode).toBe('zeffy');
  });

  it('is "cognito" when both cognitoFormId and zeffyFormUrl are set (cognito wins)', () => {
    const r = computeEventSections(base({ cognitoFormId: '42', zeffyFormUrl: '/embed/ticketing/example' }), NOW);
    expect(r.registerMode).toBe('cognito');
  });

  it('is "zeffy" when both zeffyFormUrl and registrationUrl are set (zeffy wins)', () => {
    const r = computeEventSections(
      base({ zeffyFormUrl: '/embed/ticketing/example', registrationUrl: 'https://example.com/register' }),
      NOW
    );
    expect(r.registerMode).toBe('zeffy');
  });

  it('is "none" when neither is set', () => {
    const r = computeEventSections(base(), NOW);
    expect(r.registerMode).toBe('none');
  });

  it('is "none" for a past event even when cognitoFormId is set', () => {
    const r = computeEventSections(base({ date: PAST, cognitoFormId: '42' }), NOW);
    expect(r.registerMode).toBe('none');
  });

  it('is "none" for a past event even when registrationUrl is set', () => {
    const r = computeEventSections(base({ date: PAST, registrationUrl: 'https://example.com/register' }), NOW);
    expect(r.registerMode).toBe('none');
  });
});

// ─── hasCosts ────────────────────────────────────────────────────────────────

describe('hasCosts', () => {
  it('is false with no cost fields', () => {
    expect(computeEventSections(base(), NOW).hasCosts).toBe(false);
  });

  it('is true with a simple fee', () => {
    expect(computeEventSections(base({ fee: 'Free / $25 adults' }), NOW).hasCosts).toBe(true);
  });

  it('is true with tuition entries', () => {
    expect(computeEventSections(base({ tuition: [{ amount: '$110' }] }), NOW).hasCosts).toBe(true);
  });

  it('is true with accommodations entries', () => {
    expect(computeEventSections(base({ accommodations: [{ name: 'Main Lodge', tiers: [] }] }), NOW).hasCosts).toBe(
      true
    );
  });

  it('is true with simple pricing rows that have an ageRange', () => {
    expect(computeEventSections(base({ pricing: [{ ageRange: '18+', fullWeekend: '$110' }] }), NOW).hasCosts).toBe(
      true
    );
  });

  it('is false when pricing rows have no ageRange (note-only rows)', () => {
    expect(computeEventSections(base({ pricing: [{ note: 'See website' }] }), NOW).hasCosts).toBe(false);
  });
});

// ─── hasClasses ──────────────────────────────────────────────────────────────

describe('hasClasses', () => {
  it('is false with no classes', () => {
    expect(computeEventSections(base(), NOW).hasClasses).toBe(false);
  });

  it('is false with an empty classes array', () => {
    expect(computeEventSections(base({ classes: [] }), NOW).hasClasses).toBe(false);
  });

  it('is true when at least one class is present', () => {
    expect(computeEventSections(base({ classes: [{ name: 'Folk Dance' }] }), NOW).hasClasses).toBe(true);
  });
});

// ─── hasEmbeddedForm ─────────────────────────────────────────────────────────

describe('hasEmbeddedForm', () => {
  it('is true for a future event with cognitoFormId', () => {
    expect(computeEventSections(base({ cognitoFormId: '42' }), NOW).hasEmbeddedForm).toBe(true);
  });

  it('is false for a past event with cognitoFormId', () => {
    expect(computeEventSections(base({ date: PAST, cognitoFormId: '42' }), NOW).hasEmbeddedForm).toBe(false);
  });

  it('is false for a future event without cognitoFormId', () => {
    expect(computeEventSections(base(), NOW).hasEmbeddedForm).toBe(false);
  });

  it('is true for a future event with zeffyFormUrl', () => {
    expect(computeEventSections(base({ zeffyFormUrl: '/embed/ticketing/example' }), NOW).hasEmbeddedForm).toBe(true);
  });

  it('is false for a past event with zeffyFormUrl', () => {
    expect(
      computeEventSections(base({ date: PAST, zeffyFormUrl: '/embed/ticketing/example' }), NOW).hasEmbeddedForm
    ).toBe(false);
  });
});

// ─── jumpLinks / showJumpNav ─────────────────────────────────────────────────

describe('jumpLinks', () => {
  it('is empty when no sections are present', () => {
    expect(computeEventSections(base(), NOW).jumpLinks).toHaveLength(0);
  });

  it('includes Costs when hasCosts is true', () => {
    const { jumpLinks } = computeEventSections(base({ fee: '$25' }), NOW);
    expect(jumpLinks).toContainEqual({ href: '#costs', label: 'Costs' });
  });

  it('includes Classes when hasClasses is true', () => {
    const { jumpLinks } = computeEventSections(base({ classes: [{ name: 'Dance' }] }), NOW);
    expect(jumpLinks).toContainEqual({ href: '#schedule', label: 'Schedule' });
  });

  it('includes Register when hasEmbeddedForm is true', () => {
    const { jumpLinks } = computeEventSections(base({ cognitoFormId: '42' }), NOW);
    expect(jumpLinks).toContainEqual({ href: '#registration', label: 'Register' });
  });

  it('does not include Register for a past event', () => {
    const { jumpLinks } = computeEventSections(base({ date: PAST, cognitoFormId: '42' }), NOW);
    expect(jumpLinks.some((l) => l.href === '#registration')).toBe(false);
  });
});

describe('showJumpNav', () => {
  it('is false when 0 sections are present', () => {
    expect(computeEventSections(base(), NOW).showJumpNav).toBe(false);
  });

  it('is false when only 1 section is present', () => {
    expect(computeEventSections(base({ fee: '$25' }), NOW).showJumpNav).toBe(false);
  });

  it('is true when 2 sections are present', () => {
    expect(computeEventSections(base({ fee: '$25', classes: [{ name: 'Dance' }] }), NOW).showJumpNav).toBe(true);
  });

  it('is true when all 3 sections are present', () => {
    expect(
      computeEventSections(base({ fee: '$25', classes: [{ name: 'Dance' }], cognitoFormId: '42' }), NOW).showJumpNav
    ).toBe(true);
  });
});

// ─── tuitionDisplay ──────────────────────────────────────────────────────────

describe('tuitionDisplay', () => {
  it('is "none" when no tuition', () => {
    expect(computeEventSections(base(), NOW).tuitionDisplay).toBe('none');
  });

  it('is "none" when tuition is an empty array', () => {
    expect(computeEventSections(base({ tuition: [] }), NOW).tuitionDisplay).toBe('none');
  });

  it('is "card" for a single tuition tier', () => {
    expect(computeEventSections(base({ tuition: [{ amount: '$110' }] }), NOW).tuitionDisplay).toBe('card');
  });

  it('is "table" for two or more tuition tiers', () => {
    expect(computeEventSections(base({ tuition: [{ amount: '$110' }, { amount: 'Free' }] }), NOW).tuitionDisplay).toBe(
      'table'
    );
  });
});

// ─── tuitionHasLabels ────────────────────────────────────────────────────────

describe('tuitionHasLabels', () => {
  it('is false when display is card (single tier)', () => {
    const r = computeEventSections(base({ tuition: [{ label: 'Adults', amount: '$110' }] }), NOW);
    expect(r.tuitionDisplay).toBe('card');
    expect(r.tuitionHasLabels).toBe(false);
  });

  it('is true when at least one table tier has a label', () => {
    const r = computeEventSections(base({ tuition: [{ label: 'Adults', amount: '$110' }, { amount: 'Free' }] }), NOW);
    expect(r.tuitionHasLabels).toBe(true);
  });

  it('is false when no table tiers have labels', () => {
    const r = computeEventSections(base({ tuition: [{ amount: '$110' }, { amount: 'Free' }] }), NOW);
    expect(r.tuitionHasLabels).toBe(false);
  });
});

// ─── cancellationCutoff ──────────────────────────────────────────────────────

describe('cancellationCutoff', () => {
  const eventDate = new Date('2026-10-15T00:00:00Z');

  it('is null when showCancellationPolicy is false', () => {
    const r = computeEventSections(base({ date: eventDate, showCancellationPolicy: false }), NOW);
    expect(r.cancellationCutoff).toBeNull();
  });

  it('is 21 days before the event date when showCancellationPolicy is true and no explicit date', () => {
    const r = computeEventSections(base({ date: eventDate, showCancellationPolicy: true }), NOW);
    // 2026-10-15 minus 21 days = 2026-09-24
    expect(r.cancellationCutoff?.toISOString().slice(0, 10)).toBe('2026-09-24');
  });

  it('uses the explicit cancellationCutoffDate when provided', () => {
    const explicit = new Date('2026-09-01T00:00:00Z');
    const r = computeEventSections(
      base({ date: eventDate, showCancellationPolicy: true, cancellationCutoffDate: explicit }),
      NOW
    );
    expect(r.cancellationCutoff).toBe(explicit);
  });
});

// ─── pricingRows ─────────────────────────────────────────────────────────────

describe('pricingRows', () => {
  it('filters out pricing entries that have no ageRange', () => {
    const r = computeEventSections(
      base({
        pricing: [{ ageRange: '18+', fullWeekend: '$110' }, { note: 'All prices include meals' }],
      }),
      NOW
    );
    expect(r.pricingRows).toHaveLength(1);
    expect(r.pricingRows[0].ageRange).toBe('18+');
  });
});
