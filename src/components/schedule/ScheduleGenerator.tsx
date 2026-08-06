import { lazy, Suspense, useState } from 'react';
import type { Workshop, TimeSlot } from './models';
import { getUniquePeriods } from './scheduleBuilder';
import { buildTimeslotsFromDefaults } from './winterAdventureDefaults';

// Lazy-loaded so each step's heavy dependencies (xlsx, pdfmake) only load
// when that step is reached, instead of bundling ~2MB into the initial chunk.
const UploadStep = lazy(() => import('./steps/UploadStep'));
const EditStep = lazy(() => import('./steps/EditStep'));
const GenerateStep = lazy(() => import('./steps/GenerateStep'));

type Step = 'upload' | 'edit' | 'generate';

const EVENT_NAME = 'Winter Adventure';

const STEP_LABELS: { id: Step; label: string }[] = [
  { id: 'upload', label: '1. Upload' },
  { id: 'edit', label: '2. Edit' },
  { id: 'generate', label: '3. Generate' },
];

const STEP_ORDER: Step[] = ['upload', 'edit', 'generate'];

export default function ScheduleGenerator() {
  const [step, setStep] = useState<Step>('upload');
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [timeslots, setTimeslots] = useState<TimeSlot[]>([]);

  function handleParsed(parsed: Workshop[]) {
    setWorkshops(parsed);
    setTimeslots(buildTimeslotsFromDefaults(getUniquePeriods(parsed)));
    setStep('edit');
  }

  function handleReset() {
    setWorkshops([]);
    setTimeslots([]);
    setStep('upload');
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-default">Schedule Generator</h1>
        <p className="mt-1 text-sm text-muted">{EVENT_NAME}</p>
      </div>

      {/* Stepper */}
      <nav className="mb-8 flex gap-0" aria-label="Steps">
        {STEP_LABELS.map(({ id, label }, i) => {
          const currentIdx = STEP_ORDER.indexOf(step);
          const thisIdx = STEP_ORDER.indexOf(id);
          const isDone = thisIdx < currentIdx;
          const isActive = id === step;
          const isNext = thisIdx === currentIdx + 1 && step !== 'upload';
          const isClickable = isDone || isNext;

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
                      : 'cursor-default bg-gray-100 text-muted'
                }`}
              >
                {isDone ? '✓ ' : ''}
                {label}
              </button>
              {i < STEP_LABELS.length - 1 && <div className={`h-px w-8 ${isDone ? 'bg-primary/20' : 'bg-gray-200'}`} />}
            </div>
          );
        })}
      </nav>

      {/* Steps */}
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        {step === 'upload' && <UploadStep onParsed={handleParsed} />}

        {step === 'edit' && (
          <EditStep
            workshops={workshops}
            timeslots={timeslots}
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
            eventName={EVENT_NAME}
            onBack={() => setStep('edit')}
            onReset={handleReset}
          />
        )}
      </Suspense>
    </div>
  );
}
