import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Workshop, TimeSlot } from './models';
import type { AttachResult } from './excelParser';
import { getUniquePeriods } from './scheduleBuilder';
import { buildTimeslotsFromDefaults } from './winterAdventureDefaults';
import { applyDraft, buildDraft, clearDraft, loadDraft, saveDraft, workshopKey } from './storage';
import {
  slugifyPeriod,
  parseDays,
  frontmatterToTimeslots,
  baseEventTitle,
  classKey,
  type FrontmatterTimeslot,
} from '~/utils/eventSchedule';

// Lazy-loaded so each step's heavy dependencies (xlsx, pdfmake) only load
// when that step is reached, instead of bundling ~2MB into the initial chunk.
const UploadStep = lazy(() => import('./steps/UploadStep'));
const EditStep = lazy(() => import('./steps/EditStep'));
const GenerateStep = lazy(() => import('./steps/GenerateStep'));

type Step = 'upload' | 'edit' | 'generate';

export interface ClassesSource {
  eventId: string;
  /** Event title as authored — may already contain a year. */
  title: string;
  year: number;
  classes: { name: string; leader: string; period: string; days: string }[];
  timeslots: FrontmatterTimeslot[] | null;
  /** classKey -> published room (class field, else the schedule.rooms entry) */
  rooms: Record<string, string>;
  /** classKey -> room set on the class itself, which overrides schedule.rooms */
  classRooms?: Record<string, string>;
  /** Where to edit the event file directly (GitHub web editor). */
  editUrl?: string;
}

interface Props {
  classesSource?: ClassesSource | null;
}

interface ScheduleState {
  workshops: Workshop[];
  timeslots: TimeSlot[];
}

const STEP_ORDER: Step[] = ['upload', 'edit', 'generate'];

function workshopsFromClasses(source: ClassesSource): Workshop[] {
  return source.classes.map((c) => ({
    name: c.name,
    leader: c.leader,
    period: { sheetName: slugifyPeriod(c.period), displayName: c.period },
    duration: parseDays(c.days),
    location: source.rooms[classKey(c)] ?? '',
    selections: [],
  }));
}

function publishedFromSource(source: ClassesSource): ScheduleState {
  const workshops = workshopsFromClasses(source);
  const timeslots = source.timeslots?.length
    ? frontmatterToTimeslots(source.timeslots)
    : buildTimeslotsFromDefaults(getUniquePeriods(workshops));
  return { workshops, timeslots };
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M3 8.5l3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ScheduleGenerator({ classesSource }: Props) {
  const sourced = !!classesSource?.classes.length;
  // Drafts are kept per event so last year's edits never leak into this year's schedule.
  const scope = classesSource?.eventId ?? 'upload';

  // `published` is what the event file says (or, without one, what the upload parsed):
  // the baseline that unpublished edits are measured against.
  const [published, setPublished] = useState<ScheduleState>(() =>
    sourced ? publishedFromSource(classesSource!) : { workshops: [], timeslots: [] }
  );
  // This island is client:only, so localStorage is available during the first render.
  const [initial] = useState(() => applyDraft(published, sourced ? loadDraft(scope) : null));
  const [workshops, setWorkshops] = useState<Workshop[]>(initial.workshops);
  const [timeslots, setTimeslots] = useState<TimeSlot[]>(initial.timeslots);
  const [restored, setRestored] = useState<{ rooms: number; timeslots: boolean } | null>(
    initial.restoredRooms > 0 || initial.restoredTimeslots
      ? { rooms: initial.restoredRooms, timeslots: initial.restoredTimeslots }
      : null
  );
  const [step, setStep] = useState<Step>(sourced ? 'edit' : 'upload');
  const [unmatched, setUnmatched] = useState<string[]>([]);

  const eventName = baseEventTitle(classesSource?.title ?? 'Winter Adventure');
  const eventYear = classesSource?.year ?? new Date().getFullYear();
  const eventLabel = `${eventName} ${eventYear}`;

  // Keep the draft in step with every edit (an empty draft removes the entry).
  useEffect(() => {
    if (workshops.length === 0) return;
    saveDraft(scope, buildDraft(published, { workshops, timeslots }));
  }, [scope, published, workshops, timeslots]);

  const stats = useMemo(() => {
    const attendees = new Set(
      workshops.flatMap((w) => w.selections.filter((s) => s.choiceNumber === 1).map((s) => s.classSelectionId))
    ).size;
    return { classes: workshops.length, needRoom: workshops.filter((w) => !w.location.trim()).length, attendees };
  }, [workshops]);

  const stepLabels: { id: Step; label: string }[] = [
    { id: 'upload', label: sourced ? 'Registrations' : 'Upload' },
    { id: 'edit', label: 'Rooms and times' },
    { id: 'generate', label: 'Print and publish' },
  ];

  function handleParsed(parsed: Workshop[]) {
    const base = { workshops: parsed, timeslots: buildTimeslotsFromDefaults(getUniquePeriods(parsed)) };
    const applied = applyDraft(base, loadDraft(scope));
    setPublished(base);
    setWorkshops(applied.workshops);
    setTimeslots(applied.timeslots);
    setRestored(
      applied.restoredRooms > 0 || applied.restoredTimeslots
        ? { rooms: applied.restoredRooms, timeslots: applied.restoredTimeslots }
        : null
    );
    setUnmatched([]);
    setStep('edit');
  }

  function handleAttached(result: AttachResult) {
    setWorkshops(result.workshops);
    setUnmatched(result.unmatched);
    setStep('edit');
  }

  /** Drop this browser's unpublished edits; registrations that were loaded stay attached. */
  function discardEdits() {
    clearDraft(scope);
    const rooms = new Map(published.workshops.map((w) => [workshopKey(w), w.location]));
    setWorkshops((current) => current.map((w) => ({ ...w, location: rooms.get(workshopKey(w)) ?? '' })));
    setTimeslots(published.timeslots);
    setRestored(null);
  }

  function handleReset() {
    clearDraft(scope);
    setRestored(null);
    setUnmatched([]);
    if (sourced) {
      setWorkshops(published.workshops);
      setTimeslots(published.timeslots);
      setStep('edit');
    } else {
      setPublished({ workshops: [], timeslots: [] });
      setWorkshops([]);
      setTimeslots([]);
      setStep('upload');
    }
  }

  const currentIdx = STEP_ORDER.indexOf(step);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="font-heading text-3xl font-bold text-default">Schedule Generator</h1>
        <p className="mt-1 text-sm text-muted">
          {eventLabel}
          {sourced && ' · classes loaded from the event page'}
        </p>
        {stats.classes > 0 && (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-default">
            <span>
              <span className="font-semibold">{stats.classes}</span> classes
            </span>
            <span className={stats.needRoom > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : undefined}>
              {stats.needRoom > 0
                ? `${stats.needRoom} need${stats.needRoom === 1 ? 's' : ''} a room`
                : 'every class has a room'}
            </span>
            <span>
              {stats.attendees > 0 ? (
                <>
                  <span className="font-semibold">{stats.attendees}</span> attendees
                </>
              ) : (
                'no registrations loaded'
              )}
            </span>
          </p>
        )}
      </div>

      <nav className="mb-8" aria-label="Steps">
        <ol className="flex flex-wrap items-center gap-y-2">
          {stepLabels.map(({ id, label }, i) => {
            const thisIdx = STEP_ORDER.indexOf(id);
            const isDone = thisIdx < currentIdx;
            const isActive = id === step;
            // In sourced mode every step is reachable (upload is optional).
            const isClickable = sourced || isDone || (thisIdx === currentIdx + 1 && step !== 'upload');

            return (
              <li key={id} className="flex items-center">
                <button
                  type="button"
                  onClick={isClickable ? () => setStep(id) : undefined}
                  disabled={!isClickable}
                  aria-current={isActive ? 'step' : undefined}
                  className={`group flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-primary text-white'
                      : isClickable
                        ? 'cursor-pointer text-default hover:bg-primary/10'
                        : 'cursor-default text-muted'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
                      isActive
                        ? 'border-white/60 bg-white/15'
                        : isDone
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {isDone ? <CheckIcon /> : i + 1}
                  </span>
                  {label}
                </button>
                {i < stepLabels.length - 1 && (
                  <span
                    aria-hidden
                    className={`mx-2 h-px w-6 sm:w-10 ${isDone ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-700'}`}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {restored && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <p className="flex-1 text-default">
            Picked up where you left off in this browser:{' '}
            {[
              restored.rooms > 0 ? `${restored.rooms} room change${restored.rooms === 1 ? '' : 's'}` : null,
              restored.timeslots ? 'edited timeslots' : null,
            ]
              .filter(Boolean)
              .join(' and ')}{' '}
            not yet published.
          </p>
          <button
            type="button"
            onClick={discardEdits}
            className="cursor-pointer rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold text-default hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Discard and use published
          </button>
          <button
            type="button"
            onClick={() => setRestored(null)}
            className="cursor-pointer rounded-full px-3 py-1 text-xs font-semibold text-primary hover:underline"
          >
            Keep
          </button>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {unmatched.length} registration selection{unmatched.length !== 1 ? 's' : ''} didn’t match a class name:
          </p>
          <p className="mt-1 text-amber-600 dark:text-amber-400">{unmatched.join(', ')}</p>
        </div>
      )}

      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        {step === 'upload' && (
          <UploadStep
            attachTo={sourced ? workshops : undefined}
            onParsed={handleParsed}
            onAttached={handleAttached}
            onSkip={sourced ? () => setStep('edit') : undefined}
          />
        )}

        {step === 'edit' && (
          <EditStep
            workshops={workshops}
            timeslots={timeslots}
            readOnlyClasses={sourced}
            onWorkshopsChange={setWorkshops}
            onTimeslotsChange={setTimeslots}
            onBack={() => setStep('upload')}
            onNext={() => setStep('generate')}
          />
        )}

        {step === 'generate' && (
          <GenerateStep
            workshops={workshops}
            timeslots={timeslots}
            eventLabel={eventLabel}
            eventId={classesSource?.eventId}
            editUrl={classesSource?.editUrl}
            classRooms={classesSource?.classRooms}
            onBack={() => setStep('edit')}
            onAddRegistrations={() => setStep('upload')}
            onReset={handleReset}
          />
        )}
      </Suspense>
    </div>
  );
}
