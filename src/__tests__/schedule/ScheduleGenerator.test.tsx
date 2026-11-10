// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleGenerator, { type ClassesSource } from '~/components/schedule/ScheduleGenerator';
import { classKey } from '~/utils/eventSchedule';
import { blur, buttonWithText, click, cleanup, render, settle, textOf, type } from '../react';
import { buildWorkbook, makeClassSelectionSheet, makePeriodSheet } from './helpers';

// pdfmake is heavy and pointless here; the PDF content has its own tests.
const { downloadRosters, downloadIndividualSchedules } = vi.hoisted(() => ({
  downloadRosters: vi.fn(),
  downloadIndividualSchedules: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('~/components/schedule/printRenderer', () => ({ downloadRosters, downloadIndividualSchedules }));

const MORNING = 'Morning class, first period';
const classes = [
  { name: 'Folk Dance', leader: 'Pat Williams', period: MORNING, days: 'All 4 days' },
  { name: 'Chair Yoga', leader: 'Judi Powers', period: MORNING, days: 'Days 1–2' },
  { name: 'Small Scenes', leader: 'Camden Elliott', period: 'Afternoon class', days: 'All 4 days' },
];

function makeSource(over: Partial<ClassesSource> = {}): ClassesSource {
  return {
    eventId: '2026-winter-adventure',
    title: 'Winter Adventure 2026',
    year: 2026,
    classes,
    timeslots: [
      { label: 'Breakfast', start: '08:00', isBreak: true },
      { label: MORNING, start: '09:00', end: '10:40' },
      { label: 'Afternoon class', start: '15:45', end: '17:45' },
    ],
    rooms: { [classKey(classes[0])]: 'Rec Hall' },
    classRooms: {},
    editUrl: 'https://github.com/example/edit/main/event.md',
    ...over,
  };
}

const draftKey = 'ecrs-schedule-draft:2026-winter-adventure';
const roomInput = (root: ParentNode, cls: string) =>
  root.querySelector<HTMLInputElement>(`input[aria-label="Room for ${cls}"]`);

/** A registration export with two attendees: Alice (Chair Yoga, days 1-2) and Bob (Folk Dance, all 4 days). */
function registrationFile(name = 'registrations.xlsx') {
  const row = (id: string, first: string, last: string, four = '', two = '') => [
    id,
    first,
    last,
    `${first} ${last}`,
    1,
    four,
    '1',
    two,
    '',
  ];
  const buffer = buildWorkbook({
    ClassSelection: makeClassSelectionSheet([
      ['S1', 'Alice', 'Johnson', '', ''],
      ['S2', 'Bob', 'Williams', '', ''],
    ]),
    MorningFirstPeriod: makePeriodSheet([
      row('S1', 'Alice', 'Johnson', '', 'Chair Yoga (Judi Powers)'),
      row('S2', 'Bob', 'Williams', 'Folk Dance (Pat Williams)'),
    ]),
  });
  return new File([buffer], name);
}

async function chooseFile(root: ParentNode, file: File) {
  const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await import('react').then(({ act }) =>
    act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })
  );
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  downloadRosters.mockClear();
  downloadIndividualSchedules.mockClear();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(async () => {
  await cleanup();
  document.body.innerHTML = '';
});

describe('ScheduleGenerator: classes from the event page', () => {
  it('opens on the rooms step with a summary of what still needs doing', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();

    const text = textOf(container);
    expect(text).toContain('Winter Adventure 2026 · classes loaded from the event page');
    expect(text).toContain('3 classes');
    expect(text).toContain('2 need a room');
    expect(text).toContain('no registrations loaded');
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Rooms and times');
    expect(roomInput(container, 'Folk Dance')!.value).toBe('Rec Hall');
  });

  it('flags classes that still need a room, and the published schedule that depends on them', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();

    expect(textOf(container)).toContain('2 classes still need a room');
    expect(roomInput(container, 'Chair Yoga')!.placeholder).toBe('Needs a room');
  });

  it('keeps room edits as a draft for this event, and offers them back after a reload', async () => {
    const first = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await type(roomInput(first.container, 'Chair Yoga'), 'Library');
    await blur(roomInput(first.container, 'Chair Yoga'));

    const saved = JSON.parse(localStorage.getItem(draftKey)!);
    expect(saved.rooms[`${'morning-class-first-period'}|chair yoga`]).toEqual({ value: 'Library', base: '' });
    await cleanup();

    const second = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    expect(textOf(second.container)).toContain('Picked up where you left off in this browser: 1 room change');
    expect(roomInput(second.container, 'Chair Yoga')!.value).toBe('Library');
  });

  it('drops a stale draft when someone has since published a different room', async () => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ rooms: { 'morning-class-first-period|folk dance': { value: 'Chapel A', base: 'Elm Room' } } })
    );
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();

    expect(roomInput(container, 'Folk Dance')!.value).toBe('Rec Hall');
    expect(textOf(container)).not.toContain('Picked up where you left off');
  });

  it('discards restored edits on request and clears the saved draft', async () => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ rooms: { 'morning-class-first-period|folk dance': { value: 'Chapel A', base: 'Rec Hall' } } })
    );
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    expect(roomInput(container, 'Folk Dance')!.value).toBe('Chapel A');

    await click(buttonWithText(container, 'Discard and use published'));

    expect(roomInput(container, 'Folk Dance')!.value).toBe('Rec Hall');
    expect(textOf(container)).not.toContain('Picked up where you left off');
    expect(localStorage.getItem(draftKey)).toBeNull();
  });

  it('keeps restored edits when asked to, hiding the banner', async () => {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ rooms: { 'morning-class-first-period|folk dance': { value: 'Chapel A', base: 'Rec Hall' } } })
    );
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();

    await click(buttonWithText(container, 'Keep'));

    expect(textOf(container)).not.toContain('Picked up where you left off');
    expect(roomInput(container, 'Folk Dance')!.value).toBe('Chapel A');
  });

  it('blocks continuing while two classes share a room at the same time, and says why', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    // Folk Dance (all 4 days) is in Rec Hall; Chair Yoga (days 1-2) in the same period overlaps it.
    await type(roomInput(container, 'Chair Yoga'), 'Rec Hall');

    const next = buttonWithText(container, /Continue to print/)!;
    expect(next.disabled).toBe(true);
    expect(textOf(container)).toContain('Room conflicts');
    expect(textOf(container)).toContain('Two classes share a room at the same time');
    expect(roomInput(container, 'Chair Yoga')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('blocks continuing while a period has no times, and clears once they are set', async () => {
    const source = makeSource({
      timeslots: [
        { label: MORNING, start: '09:00' },
        { label: 'Afternoon class', start: '15:45', end: '17:45' },
      ],
    });
    const { container } = await render(<ScheduleGenerator classesSource={source} />);
    await settle();

    expect(buttonWithText(container, /Continue to print/)!.disabled).toBe(true);
    expect(textOf(container)).toContain(`Set a start and end time for: ${MORNING}`);

    await type(container.querySelector<HTMLInputElement>(`input[aria-label="${MORNING} end"]`), '10:40');
    expect(buttonWithText(container, /Continue to print/)!.disabled).toBe(false);
  });

  it('flags overlapping timeslots', async () => {
    const source = makeSource({
      timeslots: [
        { label: MORNING, start: '09:00', end: '11:00' },
        { label: 'Afternoon class', start: '10:00', end: '12:00' },
      ],
    });
    const { container } = await render(<ScheduleGenerator classesSource={source} />);
    await settle();

    expect(textOf(container)).toContain('Timeslot conflicts');
    expect(textOf(container)).toContain('Some timeslots overlap');
  });

  it('adds and removes a meal row', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    const rows = () => container.querySelectorAll('input[aria-label="Timeslot label"]').length;
    const before = rows();

    await click(buttonWithText(container, '+ Add a meal or break'));
    expect(rows()).toBe(before + 1);

    await type(container.querySelectorAll<HTMLInputElement>('input[aria-label="Timeslot label"]')[before], 'Snacks');
    await click(buttonWithText(container, /^Remove$/));
    expect(rows()).toBe(before);
  });

  it('publishes: the copied block carries timeslots and rooms, with a link to the event file', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await type(roomInput(container, 'Chair Yoga'), 'Library');
    await type(roomInput(container, 'Small Scenes'), 'Chapel A');

    await click(buttonWithText(container, /Continue to print/));
    await settle();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Print and publish');
    expect(container.querySelector<HTMLAnchorElement>('a[href^="https://github.com"]')!.href).toContain('/edit/main/');
    expect(container.querySelector<HTMLAnchorElement>('a[href="/events/2026-winter-adventure/schedule"]')).toBeTruthy();

    await click(buttonWithText(container, 'Copy schedule block'));
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copied).toContain('schedule:\n  timeslots:');
    expect(copied).toContain(
      "    - class: 'Chair Yoga'\n      period: 'Morning class, first period'\n      room: 'Library'"
    );
    expect(textOf(container)).toContain('Copied');
  });

  it('warns when a room on the class itself overrides the pasted block', async () => {
    const source = makeSource({ classRooms: { [classKey(classes[0])]: 'Elm Room' } });
    const { container } = await render(<ScheduleGenerator classesSource={source} />);
    await settle();
    await click(buttonWithText(container, /Continue to print/));
    await settle();

    expect(textOf(container)).toContain('overrides the pasted block');
    expect(textOf(container)).toContain('class field says “Elm Room”, this plan says “Rec Hall”');
  });

  it('lists the classes with no room on the publish step', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await click(buttonWithText(container, /Continue to print/));
    await settle();

    expect(textOf(container)).toContain('2 classes have no room yet (Chair Yoga, Small Scenes)');
  });

  it('attaches registrations, enabling both PDFs', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await click(buttonWithText(container, /Registrations/));
    await settle();
    expect(textOf(container)).toContain('Add Registrations (optional)');

    await chooseFile(container, registrationFile());
    expect(textOf(container)).toContain('2 attendees');
    expect(textOf(container)).not.toContain('didn’t match a class name');

    await click(buttonWithText(container, /Continue to print/));
    await settle();
    const rosters = buttonWithText(container, /Class rosters/)!;
    const individual = buttonWithText(container, /Individual schedules/)!;
    expect(rosters.disabled).toBe(false);
    expect(textOf(rosters)).toContain('3 pages');
    expect(textOf(individual)).toContain('2 pages');

    await click(rosters);
    expect(downloadRosters).toHaveBeenCalledWith(expect.any(Array), 'Winter Adventure 2026');
    await click(individual);
    await settle();
    expect(downloadIndividualSchedules).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      'Winter Adventure 2026'
    );
  });

  it('turns the PDFs off, with a way to add registrations, when none are loaded', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await click(buttonWithText(container, /Continue to print/));
    await settle();

    expect(buttonWithText(container, /Class rosters/)!.disabled).toBe(true);
    expect(textOf(container)).toContain('They need sign-ups');

    await click(buttonWithText(container, 'add the registration export'));
    await settle();
    expect(textOf(container)).toContain('Add Registrations (optional)');
  });

  it('reports sign-ups that match no class', async () => {
    const source = makeSource({ classes: [classes[0]], rooms: { [classKey(classes[0])]: 'Rec Hall' } });
    const { container } = await render(<ScheduleGenerator classesSource={source} />);
    await settle();
    await click(buttonWithText(container, /Registrations/));
    await settle();

    await chooseFile(container, registrationFile());
    expect(textOf(container)).toContain('1 registration selection didn’t match a class name:');
    expect(textOf(container)).toContain('Chair Yoga');
  });

  it('can continue without registrations', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await click(buttonWithText(container, /Registrations/));
    await settle();

    await click(buttonWithText(container, 'Continue without registrations →'));
    await settle();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Rooms and times');
  });

  it('rejects a file that is not an .xlsx, and one that cannot be read', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await click(buttonWithText(container, /Registrations/));
    await settle();

    await chooseFile(container, new File(['x'], 'notes.txt'));
    expect(textOf(container)).toContain('Please upload an .xlsx file.');

    await chooseFile(container, new File([new Uint8Array([0, 1, 2, 3])], 'broken.xlsx'));
    expect(container.querySelector('.border-red-200')).toBeTruthy();
  });

  it('start over clears this event’s draft and returns to the published rooms', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await type(roomInput(container, 'Chair Yoga'), 'Library');
    expect(localStorage.getItem(draftKey)).not.toBeNull();
    await click(buttonWithText(container, /Continue to print/));
    await settle();

    await click(buttonWithText(container, 'Start over'));
    await settle();

    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(roomInput(container, 'Chair Yoga')!.value).toBe('');
  });

  it('moves between steps from the stepper and the back buttons', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await click(buttonWithText(container, /Print and publish/));
    await settle();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Print and publish');

    await click(buttonWithText(container, /Back to rooms and times/));
    await settle();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Rooms and times');

    await click(buttonWithText(container, '← Back'));
    await settle();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Registrations');
  });

  it('suggests rooms typed before', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={makeSource()} />);
    await settle();
    await type(roomInput(container, 'Chair Yoga'), 'Gym');
    await blur(roomInput(container, 'Chair Yoga'));
    await click(buttonWithText(container, /Continue to print/));
    await click(buttonWithText(container, /Back to rooms and times/));
    await settle();

    const options = [...container.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(expect.arrayContaining(['Rec Hall', 'Gym']));
  });
});

describe('ScheduleGenerator: from an uploaded export (no classes on the event page)', () => {
  it('starts on the upload step', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={null} />);
    await settle();

    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Upload');
    expect(textOf(container)).toContain('Upload Registration Export');
    expect(textOf(container)).not.toContain('classes loaded from the event page');
  });

  it('builds the classes from the export and lets them be edited', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={null} />);
    await settle();

    await chooseFile(container, registrationFile());
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Rooms and times');
    expect(textOf(container)).toContain('2 classes');
    const name = container.querySelector<HTMLInputElement>('input[aria-label="Class name"]')!;
    await type(name, 'Renamed');
    expect(name.value).toBe('Renamed');

    await click(buttonWithText(container, '← Back'));
    await settle();
    await click(buttonWithText(container, /Rooms and times/));
    await settle();
  });

  it('start over returns to the upload step', async () => {
    const { container } = await render(<ScheduleGenerator classesSource={null} />);
    await settle();
    await chooseFile(container, registrationFile());
    const roomInputs = [...container.querySelectorAll<HTMLInputElement>('input[aria-label^="Room for"]')];
    for (const [i, room] of roomInputs.entries()) await type(room, `Room ${i}`);
    await click(buttonWithText(container, /Continue to print/));
    await settle();

    await click(buttonWithText(container, 'Start over'));
    await settle();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Upload');
  });
});
