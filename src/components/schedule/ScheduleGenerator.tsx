import { lazy, Suspense, useState } from 'react';
import type { Workshop, TimeSlot } from './models';
import type { AttachResult } from './excelParser';
import { getUniquePeriods } from './scheduleBuilder';
import { buildTimeslotsFromDefaults } from './winterAdventureDefaults';
import {
  slugifyPeriod,
  parseDays,
  frontmatterToTimeslots,
  baseEventTitle,
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
  /** normalized class name -> room */
  rooms: Record<string, string>;
}

interface Props {
  classesSource?: ClassesSource | null;
}

const STEP_ORDER: Step[] = ['upload', 'edit', 'generate'];

function workshopsFromClasses(source: ClassesSource): Workshop[] {
  return source.classes.map((c) => ({
    name: c.name,
    leader: c.leader,
    period: { sheetName: slugifyPeriod(c.period), displayName: c.period },
    duration: parseDays(c.days),
    location: source.rooms[c.name.trim().toLowerCase()] ?? '',
    selections: [],
  }));
}

export default function ScheduleGenerator({ classesSource }: Props) {
  const sourced = !!classesSource?.classes.length;

  const [initialWorkshops] = useState<Workshop[]>(() => (sourced ? workshopsFromClasses(classesSource!) : []));
  const [workshops, setWorkshops] = useState<Workshop[]>(initialWorkshops);
  const [timeslots, setTimeslots] = useState<TimeSlot[]>(() => {
    if (!sourced) return [];
    if (classesSource!.timeslots?.length) return frontmatterToTimeslots(classesSource!.timeslots);
    return buildTimeslotsFromDefaults(getUniquePeriods(initialWorkshops));
  });
  const [step, setStep] = useState<Step>(sourced ? 'edit' : 'upload');
  const [unmatched, setUnmatched] = useState<string[]>([]);

  const eventName = baseEventTitle(classesSource?.title ?? 'Winter Adventure');
  const eventYear = classesSource?.year ?? new Date().getFullYear();

  const stepLabels: { id: Step; label: string }[] = [
    { id: 'upload', label: sourced ? '1. Registrations' : '1. Upload' },
    { id: 'edit', label: '2. Edit' },
    { id: 'generate', label: '3. Generate' },
  ];

  function handleParsed(parsed: Workshop[]) {
    setWorkshops(parsed);
    setTimeslots(buildTimeslotsFromDefaults(getUniquePeriods(parsed)));
    setUnmatched([]);
    setStep('edit');
  }

  function handleAttached(result: AttachResult) {
    setWorkshops(result.workshops);
    setUnmatched(result.unmatched);
    setStep('edit');
  }

  function handleReset() {
    if (sourced) {
      setWorkshops(workshopsFromClasses(classesSource!));
      setUnmatched([]);
      setStep('edit');
    } else {
      setWorkshops([]);
      setTimeslots([]);
      setStep('upload');
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-default">Schedule Generator</h1>
        <p className="mt-1 text-sm text-muted">
          {eventName} {eventYear}
          {sourced && ' · classes loaded from the event page'}
        </p>
      </div>

      <nav className="mb-8 flex gap-0" aria-label="Steps">
        {stepLabels.map(({ id, label }, i) => {
          const currentIdx = STEP_ORDER.indexOf(step);
          const thisIdx = STEP_ORDER.indexOf(id);
          const isDone = thisIdx < currentIdx;
          const isActive = id === step;
          // In sourced mode every step is reachable (upload is optional).
          const isClickable = sourced || isDone || (thisIdx === currentIdx + 1 && step !== 'upload');

          return (
            <div key={id} className="flex items-center">
              <button
                type="button"
                onClick={isClickable ? () => setStep(id) : undefined}
                aria-current={isActive ? 'step' : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : isClickable
                      ? 'cursor-pointer bg-primary/20 text-primary hover:bg-primary/30'
                      : 'cursor-default bg-gray-100 text-muted dark:bg-gray-800'
                }`}
              >
                {isDone ? '✓ ' : ''}
                {label}
              </button>
              {i < stepLabels.length - 1 && (
                <div className={`h-px w-8 ${isDone ? 'bg-primary/20' : 'bg-gray-200 dark:bg-gray-700'}`} />
              )}
            </div>
          );
        })}
      </nav>

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
            eventName={eventName}
            eventYear={eventYear}
            eventId={classesSource?.eventId}
            onBack={() => setStep('edit')}
            onReset={handleReset}
          />
        )}
      </Suspense>
    </div>
  );
}
