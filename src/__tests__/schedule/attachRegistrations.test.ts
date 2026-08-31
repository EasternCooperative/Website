import { describe, it, expect } from 'vitest';
import { attachRegistrations, ExcelParseError } from '~/components/schedule/excelParser';
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

  it('throws ExcelParseError when the file bytes are not a valid xlsx', () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer;
    expect(() => attachRegistrations(garbage, [ws('Woodworking')])).toThrow(ExcelParseError);
  });

  it('falls back to the period-sheet name when the selection id is not in ClassSelection', () => {
    const existing = [ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      MorningFirstPeriod: makePeriodSheet([
        // selId 'SEL999' has no ClassSelection row — attendee is synthesised from the name columns
        row('SEL999', 'Carol', 'Nguyen', 'Woodworking (John Smith)'),
      ]),
    });

    const { workshops } = attachRegistrations(buffer, existing);
    expect(workshops[0].selections.map((s) => s.fullName)).toEqual(['Carol Nguyen']);
  });

  it('skips a period row that has neither a known id nor a name', () => {
    const existing = [ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      MorningFirstPeriod: makePeriodSheet([
        row('', '', '', 'Woodworking (John Smith)'),
        row('SEL001', 'Alice', 'Johnson', 'Woodworking (John Smith)'),
      ]),
    });

    const { workshops } = attachRegistrations(buffer, existing);
    expect(workshops[0].selections.map((s) => s.fullName)).toEqual(['Alice Johnson']);
  });

  it('ignores a period sheet that is not in the workbook', () => {
    const existing = [ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      // no period sheets at all
    });

    const { workshops, unmatched } = attachRegistrations(buffer, existing);
    expect(workshops[0].selections).toHaveLength(0);
    expect(unmatched).toEqual([]);
  });

  it('skips a period sheet that has only a header row', () => {
    const existing = [ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      MorningFirstPeriod: makePeriodSheet([]),
    });

    const { workshops } = attachRegistrations(buffer, existing);
    expect(workshops[0].selections).toHaveLength(0);
  });

  it('de-duplicates existing workshops that share a name', () => {
    const existing = [ws('Woodworking'), ws('Woodworking')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      MorningFirstPeriod: makePeriodSheet([row('SEL001', 'Alice', 'Johnson', 'Woodworking (John Smith)')]),
    });

    const { workshops } = attachRegistrations(buffer, existing);
    // only the first workshop of that name receives the selection
    expect(workshops[0].selections).toHaveLength(1);
    expect(workshops[1].selections).toHaveLength(0);
  });

  it('tolerates a period sheet whose header omits optional columns', () => {
    const existing = [ws('Pottery')];
    const buffer = buildWorkbook({
      ClassSelection: makeClassSelectionSheet([attendeeRow('SEL001', 'Alice', 'Johnson')]),
      // No ClassSelection_Id, no ChoiceNumber, no _4dayClasses column.
      MorningFirstPeriod: [
        ['AttendeeName_First', 'AttendeeName_Last', '_2dayClassesFirst2Days'],
        ['Dana', 'Lee', 'Pottery (Jane Doe)'],
      ],
    });

    const { workshops, unmatched } = attachRegistrations(buffer, existing);
    const sel = workshops[0].selections;
    expect(sel).toHaveLength(1);
    expect(sel[0].fullName).toBe('Dana Lee');
    expect(sel[0].choiceNumber).toBe(1); // defaulted — no ChoiceNumber column
    expect(sel[0].duration).toEqual({ startDay: 1, endDay: 2 });
    expect(unmatched).toEqual([]);
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
