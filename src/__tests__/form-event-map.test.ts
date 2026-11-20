import { describe, expect, it } from 'vitest';
import { proposeMapping, tokens, yearOf } from '../../scripts/lib/form-event-map.mjs';

// Synthetic names only.
const events = [
  { slug: '2025-winter-adventure', title: 'Winter Adventure 2025', year: 2025 },
  { slug: '2025-camping-weekend-camp-onas', title: 'Camping Weekend at Camp Onas 2025', year: 2025 },
  { slug: '2025-spring-weekend-stony-point', title: 'Spring Weekend at Stony Point 2025', year: 2025 },
  { slug: '2025-fun-day-north', title: 'Fun Day North', year: 2025 },
  { slug: '2025-fun-day-south', title: 'Fun Day South', year: 2025 },
  { slug: '2024-winter-adventure', title: 'Winter Adventure 2024', year: 2024 },
];
const form = (formId: string, name: string) => ({ formId, name });

describe('names and years', () => {
  it('reads a year and folds synonyms', () => {
    expect(yearOf('2025 Winter Adventure')).toBe(2025);
    expect(yearOf('No year here')).toBeNull();
    expect([...tokens('2025 Camp Onas - Event Registration')].sort()).toEqual(['camping']);
    expect(tokens('Winter Workshop')).toEqual(tokens('Winter Adventure'));
  });
});

describe('proposing a mapping', () => {
  it('matches by year and name, even when the words differ', () => {
    const rows = proposeMapping(
      [
        form('1', '2025 Winter Adventure - Event Registration'),
        form('2', '2025 Camp Onas'),
        form('3', 'Spring Weekend at Stony Point 2025'),
      ],
      events
    );
    expect(rows.map((r) => [r.formId, r.slug])).toEqual([
      ['1', '2025-winter-adventure'],
      ['2', '2025-camping-weekend-camp-onas'],
      ['3', '2025-spring-weekend-stony-point'],
    ]);
  });

  it('never crosses years, and leaves unsure forms unmapped with the best guess as a hint', () => {
    const rows = proposeMapping(
      [
        form('4', '2023 Winter Adventure'),
        form('5', 'Winter Adventure'),
        form('6', '2025 Fun Day'),
        form('7', '2025 Quilting Retreat'),
      ],
      events
    );
    expect(rows[0]).toMatchObject({ slug: null, runnerUp: null, score: 0 }); // no event in 2023
    expect(rows[1]).toMatchObject({ slug: null }); // no year in the name
    expect(rows[2]).toMatchObject({ slug: null }); // two equally good Fun Days
    expect(rows[2].runnerUp).toBe('2025-fun-day-north');
    expect(rows[3]).toMatchObject({ slug: null });
  });

  it('reports the next best candidate when it is sure', () => {
    const [r] = proposeMapping(
      [form('8', '2025 Camp Onas')],
      [events[1], { slug: '2025-extra', title: 'Extra', year: 2025 }]
    );
    expect(r.slug).toBe('2025-camping-weekend-camp-onas');
    expect(r.runnerUp).toBe('2025-extra');
  });
});
