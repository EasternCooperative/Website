import { describe, it, expect } from 'vitest';
import { attachRegistrations } from '~/components/schedule/excelParser';
import type { Workshop } from '~/components/schedule/models';
import { buildWorkbook, makeClassSelectionSheet, makePeriodSheet } from './helpers';

function row(
  selId: string,
  first: string,
  last: string,
  c4day = '',
  choice = '1',
  c2day1 = '',
  c2day2 = ''
): (string | number | null)[] {
  return [selId, first, last, `${first} ${last}`, '', c4day, choice, c2day1, c2day2];
}
const attendeeRow = (selId: string, first: string, last: string) => [selId, first, last, '', ''];

function ws(name: string): Workshop {
  return {
    name,
    leader: 'Someone',
    period: { sheetName: 'morning-first-period', displayName: 'Morning, first period' },
    duration: { startDay: 1, endDay: 4 },
    location: 'Rec Hall',
    selections: [],
  };
}

describe('attachRegistrations', () => {
  it('attaches selections to matching workshops by name and never creates workshops', () => {
    const existing = [ws('Woodworking'), ws('Pottery')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([
        attendeeRow('SEL001', 'Alice', 'Johnson'),
        attendeeRow('SEL002', 'Bob', 'Williams'),
      ]),
      MorningFirstPeriod: makePeriodSheet([
        row('SEL001', 'Alice', 'Johnson', 'Woodworking (John Smith)'),
        row('SEL002', 'Bob', 'Williams', 'Pottery (Jane Doe)'),
      ]),
    });

    const { workshops, unmatched } = attachRegistrations(buffer, existing);
    expect(workshops).toHaveLength(2);
    expect(workshops.find((w) => w.name === 'Woodworking')!.selections.map((s) => s.fullName)).toEqual([
      'Alice Johnson',
    ]);
    expect(workshops.find((w) => w.name === 'Pottery')!.selections).toHaveLength(1);
    expect(unmatched).toEqual([]);
  });

  it('reports registration entries that match no class name', () => {
    const existing = [ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      MorningFirstPeriod: makePeriodSheet([row('SEL001', 'Alice', 'Johnson', 'Underwater Basket Weaving (Nobody)')]),
    });

    const { workshops, unmatched } = attachRegistrations(buffer, existing);
    expect(workshops[0].selections).toHaveLength(0);
    expect(unmatched).toEqual(['Underwater Basket Weaving']);
  });

  it('does not mutate the workshops passed in', () => {
    const existing = [ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      MorningFirstPeriod: makePeriodSheet([row('SEL001', 'Alice', 'Johnson', 'Woodworking (John Smith)')]),
    });

    attachRegistrations(buffer, existing);
    expect(existing[0].selections).toHaveLength(0);
  });
});
