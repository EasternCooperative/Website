import { useMemo, useState, type ReactNode } from 'react';
import type { Workshop, TimeSlot } from '../models';
import { buildRosters, buildIndividualSchedules } from '../scheduleBuilder';
import { downloadRosters, downloadIndividualSchedules } from '../printRenderer';
import { buildScheduleFrontmatter } from '../frontmatterExport';
import { classKey } from '~/utils/eventSchedule';

interface Props {
  workshops: Workshop[];
  timeslots: TimeSlot[];
  /** Full name printed on every sheet, year included (e.g. "Winter Adventure 2026"). */
  eventLabel: string;
  eventId?: string;
  /** GitHub web editor URL for the event file. */
  editUrl?: string;
  /** classKey -> room set on the class itself in the event file (overrides the pasted block). */
  classRooms?: Record<string, string>;
  onBack: () => void;
  onAddRegistrations: () => void;
  onReset: () => void;
}

const linkClass = 'font-medium text-primary underline-offset-2 hover:underline';

function RosterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M8 8.5h1.5M8 12h1.5M8 15.5h1.5M12 8.5h4M12 12h4M12 15.5h4" strokeLinecap="round" />
    </svg>
  );
}

function PersonScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <path d="M2.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" strokeLinecap="round" />
      <path d="M15 6.5h6.5M15 10.5h6.5M17 14.5h4.5" strokeLinecap="round" />
    </svg>
  );
}

export default function GenerateStep({
  workshops,
  timeslots,
  eventLabel,
  eventId,
  editUrl,
  classRooms,
  onBack,
  onAddRegistrations,
  onReset,
}: Props) {
  const [generatingIndividual, setGeneratingIndividual] = useState(false);
  const [copied, setCopied] = useState(false);

  const { yaml, roomRows } = useMemo(() => buildScheduleFrontmatter(workshops, timeslots), [workshops, timeslots]);

  function copyYaml() {
    navigator.clipboard?.writeText(yaml).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false)
    );
  }

  function handleRosters() {
    downloadRosters(buildRosters(workshops), eventLabel);
  }

  async function handleIndividualSchedules() {
    setGeneratingIndividual(true);
    try {
      await downloadIndividualSchedules(buildIndividualSchedules(workshops, timeslots), timeslots, eventLabel);
    } finally {
      setGeneratingIndividual(false);
    }
  }

  const totalAttendees = new Set(
    workshops.flatMap((w) => w.selections.filter((s) => s.choiceNumber === 1).map((s) => s.classSelectionId))
  ).size;
  const hasRegistrations = totalAttendees > 0;
  const missingRoom = workshops.filter((w) => !w.location.trim());

  // A Room typed on the class itself in the CMS wins over the pasted block, so a
  // different value there would silently undo what was assigned here.
  const overridden = workshops
    .map((w) => ({
      name: w.name,
      here: w.location.trim(),
      onClass: classRooms?.[classKey({ name: w.name, period: w.period.displayName })],
    }))
    .filter((r) => r.onClass && r.onClass !== r.here);

  return (
    <div className="py-2">
      <section className="mb-10">
        <h2 className="font-heading mb-1 text-2xl font-bold text-default">Print</h2>
        <p className="mb-4 text-sm text-muted">
          Both PDFs are laid out for a black-and-white printer on US Letter paper.
          {!hasRegistrations && (
            <>
              {' '}
              They need sign-ups:{' '}
              <button type="button" onClick={onAddRegistrations} className={`cursor-pointer ${linkClass}`}>
                add the registration export
              </button>{' '}
              to turn them on.
            </>
          )}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <PrintCard
            title="Class rosters"
            description="One page per class: everyone signed up, sorted by last name, with a check box for attendance."
            detail={hasRegistrations ? `${workshops.length} pages` : 'Needs registrations'}
            icon={<RosterIcon />}
            onClick={handleRosters}
            disabled={!hasRegistrations}
          />
          <PrintCard
            title="Individual schedules"
            description="One page per attendee: their classes, times, and rooms, plus a facility map with their rooms marked."
            detail={
              generatingIndividual
                ? 'Building maps…'
                : hasRegistrations
                  ? `${totalAttendees} pages`
                  : 'Needs registrations'
            }
            icon={<PersonScheduleIcon />}
            onClick={handleIndividualSchedules}
            disabled={!hasRegistrations}
            loading={generatingIndividual}
          />
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="font-heading mb-1 text-2xl font-bold text-default">Publish the master schedule</h2>
        <p className="mb-4 text-sm text-muted">
          The public schedule page and its PDF are built from the event file. Copy this block and paste it over the
          existing <code className="font-mono text-xs">schedule:</code> block in the event file. It carries the
          timeslots and every room, so one paste publishes the whole plan.
        </p>

        {missingRoom.length > 0 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
            {missingRoom.length} class{missingRoom.length === 1 ? ' has' : 'es have'} no room yet (
            {missingRoom.map((w) => w.name).join(', ')}). The schedule page stays hidden until every class has one.
          </p>
        )}

        {overridden.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
            <p className="font-medium">
              {overridden.length === 1 ? 'This class has' : 'These classes have'} a different Room set on the class
              itself, which overrides the pasted block. Clear or change that field in the CMS:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {overridden.map((r) => (
                <li key={r.name}>
                  {r.name}: class field says “{r.onClass}”, this plan says “{r.here || 'no room'}”
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={copyYaml}
            className="cursor-pointer rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-secondary"
          >
            {copied ? 'Copied' : 'Copy schedule block'}
          </button>
          {editUrl && (
            <a href={editUrl} target="_blank" rel="noreferrer" className={`text-sm ${linkClass}`}>
              Open the event file on GitHub
            </a>
          )}
          {eventId && (
            <>
              <a
                href={`/admin/#/collections/event/entries/${eventId}`}
                target="_blank"
                rel="noreferrer"
                className={`text-sm ${linkClass}`}
              >
                Open in the CMS
              </a>
              <a
                href={`/events/${eventId}/schedule`}
                target="_blank"
                rel="noreferrer"
                className={`text-sm ${linkClass}`}
              >
                View the published schedule
              </a>
            </>
          )}
        </div>

        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-default">
            Preview the block ({timeslots.length} timeslot{timeslots.length === 1 ? '' : 's'}, {roomRows.length} room
            {roomRows.length === 1 ? '' : 's'})
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-gray-50 p-4 text-xs text-default dark:bg-gray-950">
            {yaml}
          </pre>
        </details>
      </section>

      <div className="mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-full border border-gray-300 px-5 py-2 text-sm text-default transition-colors hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          ← Back to rooms and times
        </button>
        <button
          type="button"
          onClick={onReset}
          className="cursor-pointer rounded-full border border-red-200 px-5 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          Start over
        </button>
      </div>
    </div>
  );
}

function PrintCard({
  title,
  description,
  detail,
  icon,
  onClick,
  disabled = false,
  loading = false,
}: {
  title: string;
  description: string;
  detail: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`group rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm transition-all dark:border-gray-700 dark:bg-gray-900 ${
        loading
          ? 'cursor-wait opacity-60'
          : disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-primary/40 hover:shadow-md'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="text-primary">{icon}</span>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-default dark:bg-gray-800">
          {detail}
        </span>
      </div>
      <h3 className="font-heading mb-1 text-lg font-bold text-default transition-colors group-enabled:group-hover:text-primary">
        {title}
      </h3>
      <p className="text-sm text-muted">{description}</p>
      {!disabled && <p className="mt-3 text-sm font-semibold text-primary">Download PDF</p>}
    </button>
  );
}
