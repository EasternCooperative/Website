import * as XLSX from 'xlsx';
import type { Attendee, Workshop, WorkshopSelection, EventSchema, PeriodSheetConfig } from './models';

const WINTER_ADVENTURE_SCHEMA: EventSchema = {
  eventName: 'Winter Adventure',
  totalDays: 4,
  classSelectionSheet: {
    sheetName: 'ClassSelection',
    columns: {
      registrationId: { pattern: 'WinterAdventureClassRegist_Id' },
      selectionId: 'ClassSelection_Id',
      firstName: 'Name_First',
      lastName: 'Name_Last',
      email: 'Email',
      age: 'Age',
    },
  },
  periodSheets: [
    {
      sheetName: 'MorningFirstPeriod',
      displayName: 'Morning First Period',
      columns: {
        registrationId: { pattern: 'WinterAdventureClassRegist_Id' },
        selectionId: 'ClassSelection_Id',
        firstName: 'AttendeeName_First',
        lastName: 'AttendeeName_Last',
        fullName: 'AttendeeName',
        choiceNumber: 'ChoiceNumber',
      },
      workshopColumns: [
        { columnName: '_4dayClasses', startDay: 1, endDay: 4 },
        { columnName: '_2dayClassesFirst2Days', startDay: 1, endDay: 2 },
        { columnName: '_2dayClassesSecond2Days', startDay: 3, endDay: 4 },
      ],
    },
    {
      sheetName: 'MorningSecondPeriod',
      displayName: 'Morning Second Period',
      columns: {
        registrationId: { pattern: 'WinterAdventureClassRegist_Id' },
        selectionId: 'ClassSelection_Id',
        firstName: 'AttendeeName_First',
        lastName: 'AttendeeName_Last',
        fullName: 'AttendeeName',
        choiceNumber: 'ChoiceNumber',
      },
      workshopColumns: [
        { columnName: '_4dayClasses', startDay: 1, endDay: 4 },
        { columnName: '_2dayClassesFirst2Days', startDay: 1, endDay: 2 },
        { columnName: '_2dayClassesSecond2Days', startDay: 3, endDay: 4 },
      ],
    },
    {
      sheetName: 'AfternoonPeriod',
      displayName: 'Afternoon Period',
      columns: {
        registrationId: { pattern: 'WinterAdventureClassRegist_Id' },
        selectionId: 'ClassSelection_Id',
        firstName: 'AttendeeName_First',
        lastName: 'AttendeeName_Last',
        fullName: 'AttendeeName',
        choiceNumber: 'ChoiceNumber',
      },
      workshopColumns: [
        { columnName: '_4dayClasses', startDay: 1, endDay: 4 },
        { columnName: '_2dayClassesFirst2Days', startDay: 1, endDay: 2 },
        { columnName: '_2dayClassesSecond2Days', startDay: 3, endDay: 4 },
      ],
    },
  ],
  workshopFormat: {
    pattern: 'WorkshopName (LeaderName)',
    description: 'Workshop names contain leader in parentheses',
  },
};

export class ExcelParseError extends Error {
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'ExcelParseError';
  }
}

export function normalizeName(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  // Only normalize if the name is entirely upper or entirely lower case
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-')
    )
    .join(' ');
}

export function parseWorkshopCell(cellValue: string): { name: string; leader: string } {
  // "Workshop Name (Leader Name)" format
  const parenMatch = cellValue.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) return { name: parenMatch[1].trim(), leader: normalizeName(parenMatch[2].trim()) };

  // "Workshop Name - Leader Name" format (split on last occurrence)
  const dashIdx = cellValue.lastIndexOf(' - ');
  if (dashIdx > 0) {
    return { name: cellValue.slice(0, dashIdx).trim(), leader: normalizeName(cellValue.slice(dashIdx + 3).trim()) };
  }

  return { name: cellValue.trim(), leader: '' };
}

function findColumnByPattern(headers: Record<string, string>, pattern: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (value && value.includes(pattern)) return key;
  }
  return null;
}

function findColumn(headers: Record<string, string>, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (value === name) return key;
  }
  return null;
}

function getColumnKey(headers: Record<string, string>, columnDef: string | { pattern: string }): string | null {
  if (typeof columnDef === 'string') return findColumn(headers, columnDef);
  return findColumnByPattern(headers, columnDef.pattern);
}

function sheetToRows(sheet: XLSX.WorkSheet): string[][] {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      row.push(cell ? String(cell.v ?? '') : '');
    }
    rows.push(row);
  }
  return rows;
}

function buildHeaderMap(headerRow: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  headerRow.forEach((h, i) => {
    if (h) map[XLSX.utils.encode_col(i)] = h;
  });
  return map;
}

function loadAttendees(workbook: XLSX.WorkBook, schema: EventSchema): Map<string, Attendee> {
  const sheetConfig = schema.classSelectionSheet;
  const sheet = workbook.Sheets[sheetConfig.sheetName];
  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    throw new ExcelParseError(`Required sheet "${sheetConfig.sheetName}" not found.`, `Available sheets: ${available}`);
  }

  const rows = sheetToRows(sheet);
  if (rows.length < 2) return new Map();

  const headers = buildHeaderMap(rows[0]);
  const cols = sheetConfig.columns;

  const selIdCol = getColumnKey(headers, cols.selectionId);
  const firstCol = getColumnKey(headers, cols.firstName);
  const lastCol = getColumnKey(headers, cols.lastName);
  const emailCol = getColumnKey(headers, cols.email);
  const ageCol = getColumnKey(headers, cols.age);

  const attendees = new Map<string, Attendee>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const colIndex = (col: string | null) => (col ? XLSX.utils.decode_col(col) : -1);

    const firstName = normalizeName(firstCol !== null ? (row[colIndex(firstCol)] ?? '') : '');
    const lastName = normalizeName(lastCol !== null ? (row[colIndex(lastCol)] ?? '') : '');

    if (!firstName && !lastName) continue;

    let selectionId = selIdCol !== null ? (row[colIndex(selIdCol)] ?? '') : '';
    if (!selectionId) selectionId = `${firstName}${lastName}`.replace(/\s/g, '');

    const attendee: Attendee = {
      classSelectionId: selectionId,
      firstName,
      lastName,
      email: emailCol !== null ? (row[colIndex(emailCol)] ?? '') : '',
      age: ageCol !== null ? (row[colIndex(ageCol)] ?? '') : '',
      fullName: `${firstName} ${lastName}`.trim(),
    };

    attendees.set(selectionId, attendee);
  }

  return attendees;
}

function collectWorkshops(
  workbook: XLSX.WorkBook,
  periodConfig: PeriodSheetConfig,
  attendees: Map<string, Attendee>
): Workshop[] {
  const sheet = workbook.Sheets[periodConfig.sheetName];
  if (!sheet) return [];

  const rows = sheetToRows(sheet);
  if (rows.length < 2) return [];

  const headers = buildHeaderMap(rows[0]);
  const cols = periodConfig.columns;

  const selIdCol = getColumnKey(headers, cols.selectionId);
  const firstCol = getColumnKey(headers, cols.firstName);
  const lastCol = getColumnKey(headers, cols.lastName);
  const choiceCol = getColumnKey(headers, cols.choiceNumber);

  const workshopColIndices = periodConfig.workshopColumns.map((wc) => ({
    config: wc,
    colIndex: (() => {
      const key = findColumn(headers, wc.columnName);
      return key !== null ? XLSX.utils.decode_col(key) : -1;
    })(),
  }));

  const workshops = new Map<string, Workshop>();
  const period = { sheetName: periodConfig.sheetName, displayName: periodConfig.displayName };

  const ci = (col: string | null) => (col !== null ? XLSX.utils.decode_col(col) : -1);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const selectionId = selIdCol !== null ? (row[ci(selIdCol)] ?? '') : '';
    const choiceStr = choiceCol !== null ? (row[ci(choiceCol)] ?? '') : '';
    const choiceNumber = parseInt(choiceStr, 10) || 1;

    let attendee: Attendee | undefined = attendees.get(selectionId);
    if (!attendee) {
      const firstName = firstCol !== null ? (row[ci(firstCol)] ?? '') : '';
      const lastName = lastCol !== null ? (row[ci(lastCol)] ?? '') : '';
      if (!firstName && !lastName) continue;
      attendee = {
        classSelectionId: selectionId || `${firstName}${lastName}`,
        firstName,
        lastName,
        email: '',
        age: '',
        fullName: `${firstName} ${lastName}`.trim(),
      };
    }

    for (const { config: wc, colIndex } of workshopColIndices) {
      if (colIndex < 0) continue;
      const cellValue = row[colIndex] ?? '';
      if (!cellValue.trim()) continue;

      const { name: workshopName, leader } = parseWorkshopCell(cellValue);
      if (!workshopName) continue;

      const duration = { startDay: wc.startDay, endDay: wc.endDay };

      const selection: WorkshopSelection = {
        classSelectionId: attendee.classSelectionId,
        workshopName,
        fullName: attendee.fullName,
        firstName: attendee.firstName,
        lastName: attendee.lastName,
        choiceNumber,
        duration,
        registrationId: 0,
      };

      const key = `${period.sheetName}|${workshopName}|${leader}|${duration.startDay}-${duration.endDay}`;

      const existing = workshops.get(key);
      if (existing) {
        existing.selections.push(selection);
      } else {
        workshops.set(key, {
          name: workshopName,
          leader,
          period,
          duration,
          location: '',
          selections: [selection],
        });
      }
    }
  }

  return Array.from(workshops.values());
}

export interface AttachResult {
  workshops: Workshop[];
  unmatched: string[];
}

/**
 * Overlay a Cognito registration export onto a workshop list that already came
 * from the event's frontmatter classes. Matches by workshop name (case-insensitive)
 * and never creates workshops — names with no match are returned in `unmatched`.
 */
export function attachRegistrations(file: ArrayBuffer, existingWorkshops: Workshop[]): AttachResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file, { type: 'array' });
  } catch {
    throw new ExcelParseError('Could not read file. Make sure it is a valid .xlsx file.');
  }

  const schema = WINTER_ADVENTURE_SCHEMA;
  const attendees = loadAttendees(workbook, schema);

  // Fresh copies so the caller's props stay untouched.
  const workshops = existingWorkshops.map((w) => ({ ...w, selections: [...w.selections] }));
  const byName = new Map<string, Workshop>();
  for (const w of workshops) {
    const key = w.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, w);
  }

  const unmatched = new Set<string>();

  for (const periodConfig of schema.periodSheets) {
    const sheet = workbook.Sheets[periodConfig.sheetName];
    if (!sheet) continue;

    const rows = sheetToRows(sheet);
    if (rows.length < 2) continue;

    const headers = buildHeaderMap(rows[0]);
    const cols = periodConfig.columns;
    const selIdCol = getColumnKey(headers, cols.selectionId);
    const firstCol = getColumnKey(headers, cols.firstName);
    const lastCol = getColumnKey(headers, cols.lastName);
    const choiceCol = getColumnKey(headers, cols.choiceNumber);

    const workshopColIndices = periodConfig.workshopColumns.map((wc) => ({
      config: wc,
      colIndex: (() => {
        const key = findColumn(headers, wc.columnName);
        return key !== null ? XLSX.utils.decode_col(key) : -1;
      })(),
    }));

    const ci = (col: string | null) => (col !== null ? XLSX.utils.decode_col(col) : -1);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      const selectionId = selIdCol !== null ? (row[ci(selIdCol)] ?? '') : '';
      const choiceStr = choiceCol !== null ? (row[ci(choiceCol)] ?? '') : '';
      const choiceNumber = parseInt(choiceStr, 10) || 1;

      let attendee: Attendee | undefined = attendees.get(selectionId);
      if (!attendee) {
        const firstName = firstCol !== null ? (row[ci(firstCol)] ?? '') : '';
        const lastName = lastCol !== null ? (row[ci(lastCol)] ?? '') : '';
        if (!firstName && !lastName) continue;
        attendee = {
          classSelectionId: selectionId || `${firstName}${lastName}`,
          firstName,
          lastName,
          email: '',
          age: '',
          fullName: `${firstName} ${lastName}`.trim(),
        };
      }

      for (const { config: wc, colIndex } of workshopColIndices) {
        if (colIndex < 0) continue;
        const cellValue = row[colIndex] ?? '';
        if (!cellValue.trim()) continue;

        const { name: workshopName } = parseWorkshopCell(cellValue);
        if (!workshopName) continue;

        const target = byName.get(workshopName.trim().toLowerCase());
        if (!target) {
          unmatched.add(workshopName);
          continue;
        }

        target.selections.push({
          classSelectionId: attendee.classSelectionId,
          workshopName: target.name,
          fullName: attendee.fullName,
          firstName: attendee.firstName,
          lastName: attendee.lastName,
          choiceNumber,
          duration: { startDay: wc.startDay, endDay: wc.endDay },
          registrationId: 0,
        });
      }
    }
  }

  return { workshops, unmatched: [...unmatched] };
}

export function parseExcel(file: ArrayBuffer): Workshop[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file, { type: 'array' });
  } catch {
    throw new ExcelParseError('Could not read file. Make sure it is a valid .xlsx file.');
  }

  const schema = WINTER_ADVENTURE_SCHEMA;
  const attendees = loadAttendees(workbook, schema);

  if (attendees.size === 0) {
    throw new ExcelParseError(
      `No attendees found in "${schema.classSelectionSheet.sheetName}" sheet.`,
      'Verify the file is a Winter Adventure Cognito Forms export.'
    );
  }

  const allWorkshops: Workshop[] = [];
  let foundAtLeastOne = false;

  for (const periodConfig of schema.periodSheets) {
    const workshops = collectWorkshops(workbook, periodConfig, attendees);
    if (workshops.length > 0) foundAtLeastOne = true;
    allWorkshops.push(...workshops);
  }

  if (!foundAtLeastOne) {
    throw new ExcelParseError(
      'No workshops found in any period sheet.',
      'Verify the file contains MorningFirstPeriod, MorningSecondPeriod, or AfternoonPeriod sheets.'
    );
  }

  return allWorkshops;
}
