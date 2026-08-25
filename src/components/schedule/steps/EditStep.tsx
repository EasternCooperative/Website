import { useState, useEffect, useId } from 'react';
import type { Workshop, TimeSlot } from '../models';
import { getUniquePeriods } from '../scheduleBuilder';
import { validateTimeslots, validateLocations } from '../validation';
import { saveLocations, loadLocations, saveLocationHistory, loadLocationHistory } from '../storage';
import { KNOWN_LOCATIONS } from '../winterAdventureDefaults';

interface Props {
  workshops: Workshop[];
  timeslots: TimeSlot[];
  onWorkshopsChange: (workshops: Workshop[]) => void;
  onTimeslotsChange: (timeslots: TimeSlot[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function EditStep({
  workshops,
  timeslots,
  onWorkshopsChange,
  onTimeslotsChange,
  onBack,
  onNext,
}: Props) {
  const [locationHistory, setLocationHistory] = useState<string[]>([]);
  const listId = useId();

  useEffect(() => {
    setLocationHistory(loadLocationHistory());

    // Apply saved locations to workshops on mount
    const saved = loadLocations();
    if (Object.keys(saved).length > 0) {
      const updated = workshops.map((w) => {
        const key = `${w.period.sheetName}|${w.name}|${w.leader}`;
        return saved[key] !== undefined ? { ...w, location: saved[key] } : w;
      });
      onWorkshopsChange(updated);
    }
  }, []); // intentional: run once on mount only

  const periods = getUniquePeriods(workshops);

  function updateWorkshop(index: number, field: keyof Workshop, value: string) {
    const updated = workshops.map((w, i) => (i === index ? { ...w, [field]: value } : w));
    onWorkshopsChange(updated);

    if (field === 'location') {
      const locations: Record<string, string> = {};
      updated.forEach((w) => {
        const key = `${w.period.sheetName}|${w.name}|${w.leader}`;
        locations[key] = w.location;
      });
      saveLocations(locations);
    }
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
  const canProceed = validation.isValid && locationConflicts.length === 0;

  return (
    <div className="py-8">
      {/* Workshop table */}
      <section className="mb-10">
        <h2 className="font-heading mb-1 text-2xl font-bold text-default">Workshops</h2>
        <p className="mb-4 text-sm text-muted">
          Review and edit workshop names, leaders, and locations. Location changes are saved automatically.
        </p>

        {periods.map((period) => {
          const periodWorkshops = workshops
            .map((w, i) => ({ w, i }))
            .filter(({ w }) => w.period.sheetName === period.sheetName);

          return (
            <div key={period.sheetName} className="mb-6">
              <h3 className="mb-2 border-b border-gray-200 pb-1 text-xs font-semibold text-muted dark:border-gray-700">
                {period.displayName}
              </h3>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left dark:bg-gray-900">
                    <th className="w-1/3 px-3 py-2 text-xs font-semibold text-muted">Workshop</th>
                    <th className="w-1/4 px-3 py-2 text-xs font-semibold text-muted">Leader</th>
                    <th className="w-1/4 px-3 py-2 text-xs font-semibold text-muted">Location</th>
                    <th className="w-16 px-3 py-2 text-xs font-semibold text-muted">Days</th>
                    <th className="w-16 px-3 py-2 text-xs font-semibold text-muted">Roster</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {periodWorkshops.map(({ w, i }) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={w.name}
                          onChange={(e) => updateWorkshop(i, 'name', e.target.value)}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm text-default focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={w.leader}
                          onChange={(e) => updateWorkshop(i, 'leader', e.target.value)}
                          className="w-full rounded border border-gray-200 px-2 py-1 text-sm text-default focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          list={listId}
                          value={w.location}
                          onChange={(e) => updateWorkshop(i, 'location', e.target.value)}
                          onBlur={commitLocationHistory}
                          placeholder="e.g. Main Hall"
                          className={`w-full rounded border px-2 py-1 text-sm text-default focus:outline-none focus:ring-1 ${
                            w.location &&
                            locationConflicts.some(
                              (c) => c.periodDisplay === w.period.displayName && c.location === w.location
                            )
                              ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200 dark:border-red-700 dark:bg-red-950 dark:focus:border-red-600 dark:focus:ring-red-900'
                              : 'border-gray-200 focus:border-primary focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900'
                          }`}
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
                  ))}
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
        <p className="mb-4 text-sm text-muted">Set start and end times for each period. Add custom rows for breaks.</p>

        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left dark:bg-gray-900">
              <th className="px-3 py-2 text-xs font-semibold text-muted">Period</th>
              <th className="w-36 px-3 py-2 text-xs font-semibold text-muted">Start</th>
              <th className="w-36 px-3 py-2 text-xs font-semibold text-muted">End</th>
              <th className="w-10 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {timeslots.map((ts, i) => (
              <tr key={ts.periodKey}>
                <td className="px-3 py-1.5">
                  {ts.isCustom ? (
                    <input
                      type="text"
                      value={ts.displayName}
                      onChange={(e) => updateTimeslot(i, 'displayName', e.target.value)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm text-default focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900"
                      placeholder="e.g. Lunch"
                    />
                  ) : (
                    <span className="text-default">{ts.displayName}</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="time"
                    value={ts.startTime}
                    onChange={(e) => updateTimeslot(i, 'startTime', e.target.value)}
                    className="rounded border border-gray-200 px-2 py-1 text-sm text-default focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900 dark:[color-scheme:dark]"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="time"
                    value={ts.endTime}
                    onChange={(e) => updateTimeslot(i, 'endTime', e.target.value)}
                    className="rounded border border-gray-200 px-2 py-1 text-sm text-default focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900 dark:[color-scheme:dark]"
                  />
                </td>
                <td className="px-3 py-1.5">
                  {ts.isCustom && (
                    <button
                      onClick={() => removeTimeslot(i)}
                      className="text-muted hover:text-red-500 transition-colors"
                      title="Remove"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          onClick={addCustomTimeslot}
          className="text-sm font-medium text-primary transition-colors hover:text-secondary hover:underline"
        >
          + Add custom timeslot
        </button>

        {overlapErrors.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <p className="mb-1 text-sm font-medium text-amber-700 dark:text-amber-400">Timeslot conflicts:</p>
            {overlapErrors.map((e) => (
              <p key={e} className="text-sm text-amber-600 dark:text-amber-400">
                {e}
              </p>
            ))}
          </div>
        )}

        {locationConflicts.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
            <p className="mb-1 text-sm font-medium text-red-700 dark:text-red-400">Location conflicts:</p>
            {locationConflicts.map((c) => (
              <p key={`${c.periodDisplay}-${c.location}`} className="text-sm text-red-600 dark:text-red-400">
                {c.periodDisplay}: "{c.location}" is assigned to {c.workshopNames.join(', ')}
              </p>
            ))}
          </div>
        )}
      </section>

      {/* Nav */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="cursor-pointer rounded-full border border-gray-300 px-5 py-2 text-sm text-default transition-colors hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!canProceed}
          className="cursor-pointer rounded-full bg-primary px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Generate Schedules →
        </button>
        {!canProceed && (
          <p className="text-sm text-amber-600 dark:text-amber-400">Resolve timeslot conflicts before continuing.</p>
        )}
      </div>
    </div>
  );
}
