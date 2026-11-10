import { useState, useEffect, useId } from 'react';
import type { Workshop, TimeSlot } from '../models';
import { getUniquePeriods } from '../scheduleBuilder';
import { validateTimeslots, validateLocations } from '../validation';
import { saveLocationHistory, loadLocationHistory } from '../storage';
import { KNOWN_LOCATIONS } from '../winterAdventureDefaults';

interface Props {
  workshops: Workshop[];
  timeslots: TimeSlot[];
  /** Class name + leader come from the event page and can't be edited here. */
  readOnlyClasses?: boolean;
  onWorkshopsChange: (workshops: Workshop[]) => void;
  onTimeslotsChange: (timeslots: TimeSlot[]) => void;
  onBack: () => void;
  onNext: () => void;
}

const fieldBase =
  'w-full rounded border px-2 py-1 text-sm text-default focus:outline-none focus:ring-1 dark:bg-gray-900';
const fieldOk = 'border-gray-200 focus:border-primary focus:ring-primary/20 dark:border-gray-700';
const fieldError =
  'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200 dark:border-red-700 dark:bg-red-950 dark:focus:border-red-600 dark:focus:ring-red-900';
const fieldMissing =
  'border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-200 dark:border-amber-700 dark:bg-amber-950 dark:focus:border-amber-600 dark:focus:ring-amber-900';

export default function EditStep({
  workshops,
  timeslots,
  readOnlyClasses = false,
  onWorkshopsChange,
  onTimeslotsChange,
  onBack,
  onNext,
}: Props) {
  const [locationHistory, setLocationHistory] = useState<string[]>([]);
  const listId = useId();

  useEffect(() => {
    setLocationHistory(loadLocationHistory());
  }, []);

  const periods = getUniquePeriods(workshops);

  function updateWorkshop(index: number, field: keyof Workshop, value: string) {
    onWorkshopsChange(workshops.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
  }

  function commitLocationHistory() {
    const allLocations = workshops.map((w) => w.location).filter(Boolean);
    saveLocationHistory(allLocations);
    setLocationHistory(loadLocationHistory());
  }

  function updateTimeslot(index: number, field: keyof TimeSlot, value: string) {
    onTimeslotsChange(timeslots.map((ts, i) => (i === index ? { ...ts, [field]: value } : ts)));
  }

  function addCustomTimeslot() {
    onTimeslotsChange([
      ...timeslots,
      { periodKey: `custom-${Date.now()}`, displayName: 'Break', startTime: '', endTime: '', isCustom: true },
    ]);
  }

  function removeTimeslot(index: number) {
    onTimeslotsChange(timeslots.filter((_, i) => i !== index));
  }

  const validation = validateTimeslots(timeslots);
  const locationConflicts = validateLocations(workshops);
  const overlapErrors = validation.overlapMessages;
  const missingRoom = workshops.filter((w) => !w.location.trim());
  const untimedPeriods = timeslots.filter((ts) => !ts.isCustom && (!ts.startTime || !ts.endTime));

  // Each thing that stops the PDFs from being right, named, so the button's
  // disabled state is never a mystery.
  const blockers = [
    ...(locationConflicts.length > 0 ? ['Two classes share a room at the same time (see Classes).'] : []),
    ...(untimedPeriods.length > 0
      ? [`Set a start and end time for: ${untimedPeriods.map((ts) => ts.displayName).join(', ')}.`]
      : []),
    ...(overlapErrors.length > 0 ? ['Some timeslots overlap (see Timeslots).'] : []),
  ];
  const canProceed = blockers.length === 0;

  const isConflicting = (w: Workshop) =>
    !!w.location &&
    locationConflicts.some((c) => c.periodDisplay === w.period.displayName && c.location === w.location);

  return (
    <div className="py-2">
      {/* Workshop table */}
      <section className="mb-10">
        <h2 className="font-heading mb-1 text-2xl font-bold text-default">Classes</h2>
        <p className="mb-4 text-sm text-muted">
          {readOnlyClasses
            ? 'Class names and leaders come from the event page. Assign a room to each. Edits are kept in this browser until you publish them.'
            : 'Review and edit workshop names, leaders, and rooms. Edits are kept in this browser.'}
        </p>

        {missingRoom.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              {missingRoom.length} class{missingRoom.length === 1 ? '' : 'es'} still need
              {missingRoom.length === 1 ? 's' : ''} a room
            </p>
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              The public master schedule stays hidden until every class has one. Rosters and individual schedules will
              print without a room for these.
            </p>
          </div>
        )}

        {locationConflicts.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">Room conflicts:</p>
            {locationConflicts.map((c) => (
              <p key={`${c.periodDisplay}-${c.location}`} className="text-sm text-red-600 dark:text-red-400">
                {c.periodDisplay}: "{c.location}" is assigned to {c.workshopNames.join(', ')}
              </p>
            ))}
          </div>
        )}

        {periods.map((period) => {
          const periodWorkshops = workshops
            .map((w, i) => ({ w, i }))
            .filter(({ w }) => w.period.sheetName === period.sheetName);

          return (
            <div key={period.sheetName} className="mb-6">
              <h3 className="mb-2 border-b border-gray-200 pb-1 text-sm font-semibold text-default dark:border-gray-700">
                {period.displayName}{' '}
                <span className="ml-2 font-normal text-muted">
                  {periodWorkshops.length} class{periodWorkshops.length === 1 ? '' : 'es'}
                </span>
              </h3>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left dark:bg-gray-900">
                    <th className="w-1/3 px-3 py-2 text-xs font-semibold text-muted">Class</th>
                    <th className="w-1/4 px-3 py-2 text-xs font-semibold text-muted">Leader</th>
                    <th className="w-1/4 px-3 py-2 text-xs font-semibold text-muted">Room</th>
                    <th className="w-20 px-3 py-2 text-center text-xs font-semibold text-muted">Days</th>
                    <th className="w-20 px-3 py-2 text-center text-xs font-semibold text-muted">Signed up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {periodWorkshops.map(({ w, i }) => {
                    const conflict = isConflicting(w);
                    const missing = !w.location.trim();
                    return (
                      <tr key={i}>
                        <td className="px-3 py-1.5">
                          {readOnlyClasses ? (
                            <span className="block px-2 py-1 text-sm text-default">{w.name}</span>
                          ) : (
                            <input
                              type="text"
                              aria-label="Class name"
                              value={w.name}
                              onChange={(e) => updateWorkshop(i, 'name', e.target.value)}
                              className={`${fieldBase} ${fieldOk}`}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {readOnlyClasses ? (
                            <span className="block px-2 py-1 text-sm text-muted">{w.leader || '—'}</span>
                          ) : (
                            <input
                              type="text"
                              aria-label={`Leader for ${w.name}`}
                              value={w.leader}
                              onChange={(e) => updateWorkshop(i, 'leader', e.target.value)}
                              className={`${fieldBase} ${fieldOk}`}
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            list={listId}
                            aria-label={`Room for ${w.name}`}
                            aria-invalid={conflict || undefined}
                            value={w.location}
                            onChange={(e) => updateWorkshop(i, 'location', e.target.value)}
                            onBlur={commitLocationHistory}
                            placeholder={missing ? 'Needs a room' : 'e.g. Main Hall'}
                            className={`${fieldBase} ${conflict ? fieldError : missing ? fieldMissing : fieldOk}`}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-center text-muted">
                          {w.duration.startDay === w.duration.endDay
                            ? `Day ${w.duration.startDay}`
                            : `${w.duration.startDay}–${w.duration.endDay}`}
                        </td>
                        <td className="px-3 py-1.5 text-center text-muted">
                          {w.selections.filter((s) => s.choiceNumber === 1).length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <datalist id={listId}>
          {Array.from(new Set([...KNOWN_LOCATIONS, ...locationHistory])).map((loc) => (
            <option key={loc} value={loc} />
          ))}
        </datalist>
      </section>

      {/* Timeslots */}
      <section className="mb-10">
        <h2 className="font-heading mb-1 text-2xl font-bold text-default">Timeslots</h2>
        <p className="mb-4 text-sm text-muted">
          Set start and end times for each period. Add rows for meals, breaks, and evening programs; they print as
          full-width bands.
        </p>

        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left dark:bg-gray-900">
              <th className="px-3 py-2 text-xs font-semibold text-muted">Period</th>
              <th className="w-36 px-3 py-2 text-xs font-semibold text-muted">Start</th>
              <th className="w-36 px-3 py-2 text-xs font-semibold text-muted">End</th>
              <th className="w-24 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {timeslots.map((ts, i) => {
              const needsTimes = !ts.isCustom;
              return (
                <tr key={ts.periodKey}>
                  <td className="px-3 py-1.5">
                    {ts.isCustom ? (
                      <input
                        type="text"
                        aria-label="Timeslot label"
                        value={ts.displayName}
                        onChange={(e) => updateTimeslot(i, 'displayName', e.target.value)}
                        className={`${fieldBase} ${fieldOk}`}
                        placeholder="e.g. Lunch"
                      />
                    ) : (
                      <span className="text-default">{ts.displayName}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="time"
                      aria-label={`${ts.displayName} start`}
                      value={ts.startTime}
                      onChange={(e) => updateTimeslot(i, 'startTime', e.target.value)}
                      className={`rounded border px-2 py-1 text-sm text-default focus:outline-none focus:ring-1 dark:bg-gray-900 dark:[color-scheme:dark] ${
                        needsTimes && !ts.startTime ? fieldMissing : fieldOk
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="time"
                      aria-label={`${ts.displayName} end`}
                      value={ts.endTime}
                      onChange={(e) => updateTimeslot(i, 'endTime', e.target.value)}
                      className={`rounded border px-2 py-1 text-sm text-default focus:outline-none focus:ring-1 dark:bg-gray-900 dark:[color-scheme:dark] ${
                        needsTimes && !ts.endTime ? fieldMissing : fieldOk
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {ts.isCustom && (
                      <button
                        type="button"
                        onClick={() => removeTimeslot(i)}
                        aria-label={`Remove ${ts.displayName || 'timeslot'}`}
                        className="cursor-pointer text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-red-600 hover:underline dark:hover:text-red-400"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button
          type="button"
          onClick={addCustomTimeslot}
          className="cursor-pointer text-sm font-medium text-primary transition-colors hover:text-secondary hover:underline"
        >
          + Add a meal or break
        </button>

        {overlapErrors.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">Timeslot conflicts:</p>
            {overlapErrors.map((e) => (
              <p key={e} className="text-sm text-red-600 dark:text-red-400">
                {e}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* Nav */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-full border border-gray-300 px-5 py-2 text-sm text-default transition-colors hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className="cursor-pointer rounded-full bg-primary px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to print and publish →
        </button>
      </div>
      {!canProceed && (
        <ul className="mt-3 list-disc pl-5 text-sm text-red-600 dark:text-red-400" role="status">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
