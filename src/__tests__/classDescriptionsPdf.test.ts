import { describe, it, expect } from 'vitest';
import {
  buildClassDescriptionGroups,
  classDescriptionsDocDefinition,
  hasClassDescriptions,
} from '~/utils/classDescriptionsPdf';

const date = new Date('2026-12-27T00:00:00Z');
const leaderMap = new Map([['john-smith', { name: 'John Smith' }]]);

describe('hasClassDescriptions', () => {
  it('is true only when some class has a description', () => {
    expect(hasClassDescriptions({ date })).toBe(false);
    expect(hasClassDescriptions({ date, classes: [{ name: 'Pottery' }, { name: 'Dance', description: ' ' }] })).toBe(
      false
    );
    expect(hasClassDescriptions({ date, classes: [{ name: 'Pottery', description: 'Throw a pot.' }] })).toBe(true);
  });
});

describe('buildClassDescriptionGroups', () => {
  it('follows the timeslot order, skips breaks, and carries the class time', () => {
    const groups = buildClassDescriptionGroups(
      {
        date,
        classes: [
          { name: 'Yoga', period: 'Afternoon' },
          { name: 'Pottery', period: 'Morning' },
          { name: 'Dance', period: 'Morning' },
        ],
        schedule: {
          timeslots: [
            { label: 'Morning', start: '09:15', end: '10:45' },
            { label: 'Lunch', start: '12:00', end: '13:00', isBreak: true },
            { label: 'Afternoon', start: '14:00', end: '15:30' },
          ],
        },
      },
      leaderMap
    );
    expect(groups.map((g) => [g.heading, g.time, g.classes.map((c) => c.name)])).toEqual([
      ['Morning', '9:15 AM - 10:45 AM', ['Pottery', 'Dance']],
      ['Afternoon', '2:00 PM - 3:30 PM', ['Yoga']],
    ]);
  });

  it('resolves leaders, strips markdown, and collects the detail line', () => {
    const [group] = buildClassDescriptionGroups(
      {
        date,
        classes: [
          {
            name: 'Pottery',
            leaderId: 'john-smith',
            days: 'Days 1-2',
            room: 'Art Studio',
            restriction: 'Ages 12+',
            limitedCapacity: true,
            description: 'Throw a **pot** on the [wheel](https://example.com).',
            callout: 'Bring an apron',
          },
          { name: 'Open Sing' },
        ],
      },
      leaderMap
    );
    expect(group.heading).toBe('');
    expect(group.classes).toEqual([
      {
        name: 'Pottery',
        leader: 'John Smith',
        meta: ['Days 1-2', 'Art Studio', 'Ages 12+', 'Limited capacity'],
        description: 'Throw a pot on the wheel.',
        callout: 'Bring an apron',
      },
      { name: 'Open Sing', leader: '', meta: [], description: '', callout: '' },
    ]);
  });

  it('uses a time-only period as the heading', () => {
    const [group] = buildClassDescriptionGroups(
      { date, classes: [{ name: 'Pottery', period: '10:00 - 10:45 AM' }] },
      leaderMap
    );
    expect([group.heading, group.time]).toEqual(['10:00 - 10:45 AM', '']);
  });
});

describe('classDescriptionsDocDefinition', () => {
  const groups = [
    {
      heading: 'Morning',
      time: '9:15 AM - 10:45 AM',
      classes: [
        {
          name: 'Pottery',
          leader: 'John Smith',
          meta: ['Days 1-2', 'Art Studio'],
          description: 'Throw a pot.',
          callout: 'Bring an apron',
        },
      ],
    },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = classDescriptionsDocDefinition(groups, 'Winter Adventure 2026') as any;

  it('writes each period and class with its details', () => {
    const json = JSON.stringify(doc);
    for (const text of [
      'Winter Adventure 2026',
      'Morning',
      '9:15 AM - 10:45 AM',
      'Pottery',
      '  with John Smith',
      'Days 1-2  •  Art Studio',
      'Throw a pot.',
      'Bring an apron',
    ]) {
      expect(json).toContain(text);
    }
    expect(doc.footer(2, 4).text).toBe('Winter Adventure 2026  |  Page 2 of 4');
  });

  it('keeps a period heading on the same page as its first class', () => {
    const heading = { headlineLevel: 1, pageNumbers: [1] };
    expect(doc.pageBreakBefore(heading, [{ pageNumbers: [2] }])).toBe(true);
    expect(doc.pageBreakBefore(heading, [{ pageNumbers: [1] }])).toBe(false);
    expect(doc.pageBreakBefore({ pageNumbers: [1] }, [{ pageNumbers: [2] }])).toBe(false);
  });
});
