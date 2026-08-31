import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import pdfMake from 'pdfmake/js/index.js';
import { buildEventMasterSchedule, type EventScheduleData } from '~/utils/eventSchedule';
import { buildScheduleGrid, buildMasterScheduleDocDefinition } from '~/components/schedule/scheduleGrid';

// Guards the build-time PDF route: pdfmake's Node entry must render our document
// definition to a real PDF buffer using the bundled Roboto fonts.
describe('schedule PDF (Node/pdfmake)', () => {
  it('renders a %PDF buffer from frontmatter', async () => {
    const FONT_DIR = resolve(process.cwd(), 'node_modules/pdfmake/fonts/Roboto');
    pdfMake.setFonts({
      Roboto: {
        normal: resolve(FONT_DIR, 'Roboto-Regular.ttf'),
        bold: resolve(FONT_DIR, 'Roboto-Medium.ttf'),
        italics: resolve(FONT_DIR, 'Roboto-Italic.ttf'),
        bolditalics: resolve(FONT_DIR, 'Roboto-MediumItalic.ttf'),
      },
    });
    pdfMake.setLocalAccessPolicy?.(() => true);
    pdfMake.setUrlAccessPolicy?.(() => false);

    const event: EventScheduleData = {
      date: new Date('2026-12-27T00:00:00Z'),
      endDate: new Date('2026-12-30T00:00:00Z'),
      schedule: {
        timeslots: [
          { label: 'Breakfast', start: '08:00', end: '09:00', isBreak: true },
          { label: 'Morning, first period', start: '09:00', end: '10:40' },
        ],
      },
      classes: [
        { name: 'Folk Dance', period: 'Morning, first period', days: 'All 4 days', room: 'Rec Hall' },
        { name: 'Chair Yoga', period: 'Morning, first period', days: 'Days 1–2', room: 'Elm Room' },
      ],
    };

    const grid = buildScheduleGrid(buildEventMasterSchedule(event, new Map()));
    const doc = buildMasterScheduleDocDefinition(grid, { title: 'Master Schedule', subtitle: 'Winter Adventure 2026' });
    const buffer: Buffer = await pdfMake.createPdf(doc).getBuffer();

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
