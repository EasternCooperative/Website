export interface Attendee {
  classSelectionId: string;
  firstName: string;
  lastName: string;
  email: string;
  age: string;
  fullName: string;
}

export interface WorkshopDuration {
  startDay: number;
  endDay: number;
}

export interface WorkshopSelection {
  classSelectionId: string;
  workshopName: string;
  fullName: string;
  firstName: string;
  lastName: string;
  choiceNumber: number;
  duration: WorkshopDuration;
  registrationId: number;
}

export interface Period {
  sheetName: string;
  displayName: string;
}

export interface Workshop {
  name: string;
  leader: string;
  period: Period;
  duration: WorkshopDuration;
  location: string;
  selections: WorkshopSelection[];
  /** Index into the source event's `classes[]` — set only on the frontmatter path,
   *  used by the printable schedule page to reach the class description / leader bios. */
  classIndex?: number;
}

export interface TimeSlot {
  periodKey: string;
  displayName: string;
  startTime: string;
  endTime: string;
  isCustom?: boolean;
}

// --- Schema types (mirrors WinterAdventureSchema.json) ---

export interface WorkshopColumnConfig {
  columnName: string;
  startDay: number;
  endDay: number;
}

export interface PeriodSheetColumns {
  registrationId: string | { pattern: string };
  selectionId: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  choiceNumber: string;
}

export interface PeriodSheetConfig {
  sheetName: string;
  displayName: string;
  columns: PeriodSheetColumns;
  workshopColumns: WorkshopColumnConfig[];
}

export interface ClassSelectionColumns {
  registrationId: string | { pattern: string };
  selectionId: string;
  firstName: string;
  lastName: string;
  email: string;
  age: string;
}

export interface ClassSelectionSheetConfig {
  sheetName: string;
  columns: ClassSelectionColumns;
}

export interface EventSchema {
  eventName: string;
  totalDays: number;
  classSelectionSheet: ClassSelectionSheetConfig;
  periodSheets: PeriodSheetConfig[];
  workshopFormat: {
    pattern: string;
    description: string;
  };
}
