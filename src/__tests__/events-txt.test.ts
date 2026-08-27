import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('astro:content', () => ({
  getCollection: vi.fn(),
}));

import { getCollection } from 'astro:content';
import { GET, getStaticPaths } from '../pages/events/[id].txt';

const makeEvent = (
  overrides: Partial<{
    id: string;
    title: string;
    date: Date;
    endDate: Date | undefined;
    startTime: string | undefined;
    endTime: string | undefined;
    location: string | undefined;
    address: string | undefined;
    excerpt: string | undefined;
    description: string | undefined;
    fee: string | undefined;
    tuition: { label?: string; amount: string; note?: string }[] | undefined;
    pricing: { ageRange?: string; fullWeekend?: string; note?: string }[] | undefined;
    classes: unknown[] | undefined;
    showCancellationPolicy: boolean | undefined;
    cancellationPolicy: string | undefined;
    registrationUrl: string | undefined;
    noRegistrationRequired: boolean | undefined;
    tags: string[] | undefined;
  }> = {}
) => {
  const data = {
    title: 'Annual Gala',
    date: new Date('2024-05-15'),
    endDate: undefined as Date | undefined,
    startTime: undefined as string | undefined,
    endTime: undefined as string | undefined,
    location: undefined as string | undefined,
    address: undefined as string | undefined,
    excerpt: undefined as string | undefined,
    description: undefined as string | undefined,
    fee: undefined as string | undefined,
    tuition: undefined as { label?: string; amount: string; note?: string }[] | undefined,
    pricing: undefined as { ageRange?: string; fullWeekend?: string; note?: string }[] | undefined,
    classes: undefined as unknown[] | undefined,
    showCancellationPolicy: undefined as boolean | undefined,
    cancellationPolicy: undefined as string | undefined,
    registrationUrl: undefined as string | undefined,
    noRegistrationRequired: undefined as boolean | undefined,
    tags: undefined as string[] | undefined,
    ...overrides,
  };
  return {
    id: overrides.id ?? 'annual-gala-2024',
    data,
  };
};

const callGet = async (event: ReturnType<typeof makeEvent>): Promise<string> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (await GET({ props: { event } } as any)).text();

beforeEach(() => {
  vi.mocked(getCollection).mockResolvedValue([] as never);
});

describe('getStaticPaths', () => {
  it('maps each event to {params: {id}, props: {event}}', async () => {
    const fakeEvents = [makeEvent({ id: 'event-a' }), makeEvent({ id: 'event-b' })];
    vi.mocked(getCollection)
      .mockResolvedValueOnce(fakeEvents as never)
      .mockResolvedValueOnce([] as never);
    // getStaticPaths is typed as GetStaticPaths (which declares a required options
    // param) even though this implementation ignores it, so the call site still
    // needs an argument to satisfy the type checker.
    const paths = await getStaticPaths({} as Parameters<typeof getStaticPaths>[0]);
    expect(paths).toEqual([
      { params: { id: 'event-a' }, props: { event: fakeEvents[0], siteData: undefined } },
      { params: { id: 'event-b' }, props: { event: fakeEvents[1], siteData: undefined } },
    ]);
  });
});

describe('GET /events/[id].txt', () => {
  it('returns text/plain content-type', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await GET({ props: { event: makeEvent() } } as any);
    expect(response.headers.get('Content-Type')).toBe('text/plain;charset=utf-8');
  });

  it('sets Content-Disposition with the event id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await GET({ props: { event: makeEvent() } } as any);
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="annual-gala-2024.txt"');
  });

  it('includes the event title and date range', async () => {
    const text = await callGet(makeEvent({ title: 'Spring Concert', date: new Date('2024-05-15') }));
    expect(text).toContain('Spring Concert');
    expect(text).toContain('May 15, 2024');
  });

  it('includes start and end time when present', async () => {
    const text = await callGet(makeEvent({ startTime: '10:00 AM', endTime: '4:00 PM' }));
    expect(text).toContain('Starts 10:00 AM · Ends 4:00 PM');
  });

  it('includes only the start time when no end time is set', async () => {
    const text = await callGet(makeEvent({ startTime: '10:00 AM' }));
    expect(text).toContain('Starts 10:00 AM');
    expect(text).not.toContain('Ends');
  });

  it('includes the excerpt under About when present', async () => {
    const text = await callGet(makeEvent({ excerpt: 'A short **teaser**' }));
    expect(text).toContain('ABOUT');
    expect(text).toContain('A short teaser');
  });

  it('falls back to the description under About when no excerpt is set', async () => {
    const text = await callGet(makeEvent({ description: 'The full **description**' }));
    expect(text).toContain('ABOUT');
    expect(text).toContain('The full description');
  });

  it('includes location and address when present', async () => {
    const text = await callGet(makeEvent({ location: 'Conference Center', address: '123 Main St' }));
    expect(text).toContain('Conference Center');
    expect(text).toContain('123 Main St');
  });

  it('includes simple fee when present', async () => {
    const text = await callGet(makeEvent({ fee: 'Free / $25 adults' }));
    expect(text).toContain('COST');
    expect(text).toContain('Free / $25 adults');
  });

  it('includes tuition tiers when present', async () => {
    const text = await callGet(
      makeEvent({
        tuition: [
          { label: 'Adult', amount: '$50' },
          { amount: '$30', label: 'Child' },
        ],
      })
    );
    expect(text).toContain('TUITION');
    expect(text).toContain('Adult: $50');
    expect(text).toContain('Child: $30');
  });

  it('includes simple age-range pricing rows when present', async () => {
    const text = await callGet(makeEvent({ pricing: [{ ageRange: '0-5', fullWeekend: 'Free' }] }));
    expect(text).toContain('PRICING');
    expect(text).toContain('0-5: Free');
  });

  it('includes classes/schedule when present', async () => {
    const text = await callGet(
      makeEvent({
        classes: [{ name: 'Beginner Contra', ageRange: 'All ages', description: 'A fun **intro** class' }],
      })
    );
    expect(text).toContain('SCHEDULE');
    expect(text).toContain('Beginner Contra');
    expect(text).toContain('A fun intro class');
  });

  it('includes cancellation policy when shown', async () => {
    const text = await callGet(
      makeEvent({ showCancellationPolicy: true, cancellationPolicy: 'No refunds after May 1.' })
    );
    expect(text).toContain('CANCELLATION POLICY');
    expect(text).toContain('No refunds after May 1.');
  });

  it('omits cancellation policy when showCancellationPolicy is false', async () => {
    const text = await callGet(makeEvent({ showCancellationPolicy: false, cancellationPolicy: 'No refunds.' }));
    expect(text).not.toContain('No refunds.');
  });

  it('includes registration URL when present', async () => {
    const text = await callGet(makeEvent({ registrationUrl: 'https://example.com/register' }));
    expect(text).toContain('https://example.com/register');
  });

  it('notes drop-in events with no registration required', async () => {
    const text = await callGet(makeEvent({ noRegistrationRequired: true }));
    expect(text).toContain('No registration required');
  });

  it('includes tags when present', async () => {
    const text = await callGet(makeEvent({ tags: ['family', 'outdoor'] }));
    expect(text).toContain('TAGS');
    expect(text).toContain('family, outdoor');
  });

  it('includes early-bird deadline and fee note', async () => {
    const text = await callGet(
      makeEvent({
        earlyBirdDeadline: new Date('2024-04-01'),
        earlyBirdFeeNote: 'Save $10 if you register early',
      } as never)
    );
    expect(text).toContain('EARLY-BIRD DEADLINE');
    expect(text).toContain('Save $10 if you register early');
  });

  it('includes registration deadline', async () => {
    const text = await callGet(makeEvent({ registrationDeadline: new Date('2024-05-01') } as never));
    expect(text).toContain('REGISTER BY');
  });

  it('includes venue phone and accessibility note', async () => {
    const text = await callGet(
      makeEvent({ phone: '555-1234', accessibilityNote: 'Wheelchair accessible entrance' } as never)
    );
    expect(text).toContain('555-1234');
    expect(text).toContain('Accessibility: Wheelchair accessible entrance');
  });

  it('includes accommodation tiers', async () => {
    const text = await callGet(
      makeEvent({
        accommodations: [
          { name: 'Cabin', description: 'Rustic **cabin** lodging', tiers: [{ label: 'Per person', amount: '$100' }] },
        ],
      } as never)
    );
    expect(text).toContain('ROOM & BOARD');
    expect(text).toContain('Cabin');
    expect(text).toContain('Rustic cabin lodging');
    expect(text).toContain('Per person: $100');
  });

  it('includes mealsIncluded and mealsNote', async () => {
    const text = await callGet(
      makeEvent({ mealsIncluded: 'All meals provided', mealsNote: 'Let us know about *allergies*' } as never)
    );
    expect(text).toContain('MEALS');
    expect(text).toContain('All meals provided');
    expect(text).toContain('Let us know about allergies');
  });

  it('includes health policy when shown', async () => {
    const text = await callGet(makeEvent({ showHealthPolicy: true, healthPolicy: 'Masks optional.' } as never));
    expect(text).toContain('HEALTH POLICY');
    expect(text).toContain('Masks optional.');
  });

  it('includes tuition note and pricing note', async () => {
    const text = await callGet(
      makeEvent({
        tuition: [{ amount: '$50', note: 'Includes materials' }],
        pricing: [{ ageRange: '0-5', fullWeekend: 'Free', note: 'Must be accompanied by an adult' }],
      })
    );
    expect(text).toContain('Includes materials');
    expect(text).toContain('Must be accompanied by an adult');
  });

  it('groups classes by period and includes leaders, days, and capacity flag', async () => {
    const text = await callGet(
      makeEvent({
        endDate: new Date('2024-05-16'),
        classes: [
          {
            name: 'Advanced Contra',
            period: 'Saturday Morning',
            leader: 'Jane Doe',
            days: 'Sat',
            limitedCapacity: true,
          },
        ],
      })
    );
    expect(text).toContain('SATURDAY MORNING');
    expect(text).toContain('Advanced Contra');
    expect(text).toContain('— Jane Doe');
    expect(text).toContain('Sat');
    expect(text).toContain('[Limited capacity]');
  });

  it('notes online registration when a Cognito form is embedded', async () => {
    const text = await callGet(makeEvent({ id: 'form-event', cognitoFormId: 'abc123' } as never));
    expect(text).toContain('Register online at https://ecrs.org/events/form-event#registration');
  });

  it('includes resolved event staff by name and role', async () => {
    vi.mocked(getCollection).mockImplementation(async (name: string) => {
      if (name === 'staff') {
        return [{ id: 'jane-staff', data: { name: 'Jane Registrar' } }] as never;
      }
      return [] as never;
    });
    const text = await callGet(makeEvent({ staff: [{ id: 'jane-staff', role: 'Registrar' }] } as never));
    expect(text).toContain('EVENT STAFF');
    expect(text).toContain('Registrar: Jane Registrar');
  });
});
