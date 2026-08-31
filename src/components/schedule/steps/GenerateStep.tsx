import { useMemo, useState } from 'react';
import type { Workshop, TimeSlot } from '../models';
import { buildRosters, buildIndividualSchedules } from '../scheduleBuilder';
import { downloadRosters, downloadIndividualSchedules } from '../printRenderer';
import { buildScheduleFrontmatter } from '../frontmatterExport';

interface Props {
  workshops: Workshop[];
  timeslots: TimeSlot[];
  eventName: string;
  eventId?: string;
  onBack: () => void;
  onReset: () => void;
}

export default function GenerateStep({ workshops, timeslots, eventName, eventId, onBack, onReset }: Props) {
  const [generatingIndividual, setGeneratingIndividual] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { yaml, roomRows } = useMemo(() => buildScheduleFrontmatter(workshops, timeslots), [workshops, timeslots]);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
      },
      () => setCopied(null)
    );
  }

  function handleRosters() {
    downloadRosters(buildRosters(workshops), eventName);
  }

  async function handleIndividualSchedules() {
    setGeneratingIndividual(true);
    try {
      await downloadIndividualSchedules(buildIndividualSchedules(workshops, timeslots), timeslots, eventName);
    } finally {
      setGeneratingIndividual(false);
    }
  }

  const totalAttendees = new Set(
    workshops.flatMap((w) => w.selections.filter((s) => s.choiceNumber === 1).map((s) => s.classSelectionId))
  ).size;

  return (
    <div className="py-8">
      <div className="mb-8 rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="font-heading mb-1 text-2xl font-bold text-default">Ready to Generate</h2>
        <p className="text-sm text-muted">
          {workshops.length} workshop{workshops.length !== 1 ? 's' : ''} &bull; {totalAttendees} attendee
          {totalAttendees !== 1 ? 's' : ''} &bull; {timeslots.length} time slot
          {timeslots.length !== 1 ? 's' : ''}
        </p>
        <p className="mt-2 text-sm text-muted">
          Roster and individual-schedule PDFs download from the buttons below.{' '}
          {eventId && (
            <>
              The master schedule lives on the{' '}
              <a
                href={`/events/${eventId}/schedule`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                event page
              </a>{' '}
              once the rooms and times below are published.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <PrintCard
          title="Workshop Rosters"
          description="One page per workshop listing all registered attendees, sorted by last name."
          icon="📋"
          onClick={handleRosters}
        />
        <PrintCard
          title="Individual Schedules"
          description="One page per attendee with their personal workshop schedule and a personalized facility map."
          icon="👤"
          onClick={handleIndividualSchedules}
          loading={generatingIndividual}
        />
      </div>

      <section className="mt-10 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h3 className="font-heading mb-1 text-lg font-bold text-default">Publish to the event page</h3>
        <p className="mb-4 text-sm text-muted">
          Paste this <code className="font-mono text-xs">schedule</code> block into the event
          {eventId ? (
            <>
              {' '}
              (
              <a
                href={`/admin/#/collections/event/entries/${eventId}`}
                className="text-primary hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                open in CMS
              </a>
              )
            </>
          ) : null}
          , then set each class’s <span className="font-semibold">Room</span> from the table below.
        </p>

        <div className="relative">
          <button
            onClick={() => copy(yaml, 'yaml')}
            className="absolute right-2 top-2 cursor-pointer rounded border border-gray-300 bg-white px-2 py-1 text-xs text-default hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800"
          >
            {copied === 'yaml' ? 'Copied' : 'Copy'}
          </button>
          <pre className="overflow-x-auto rounded-lg bg-gray-50 p-4 text-xs text-default dark:bg-gray-950">{yaml}</pre>
        </div>

        {roomRows.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left dark:bg-gray-900">
                <th className="px-3 py-2 text-xs font-semibold text-muted">Class</th>
                <th className="px-3 py-2 text-xs font-semibold text-muted">Room</th>
                <th className="w-24 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {roomRows.map((r) => (
                <tr key={r.name}>
                  <td className="px-3 py-1.5 text-default">{r.name}</td>
                  <td className="px-3 py-1.5 text-muted">{r.room}</td>
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => copy(r.room, `room-${r.name}`)}
                      className="cursor-pointer rounded border border-gray-300 px-2 py-0.5 text-xs text-default hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
                    >
                      {copied === `room-${r.name}` ? 'Copied' : 'Copy room'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="mt-10 flex items-center gap-3">
        <button
          onClick={onBack}
          className="cursor-pointer rounded-full border border-gray-300 px-5 py-2 text-sm text-default transition-colors hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          ← Back to Edit
        </button>
        <button
          onClick={onReset}
          className="cursor-pointer rounded-full border border-red-200 px-5 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          Start Over
        </button>
      </div>
    </div>
  );
}

function PrintCard({
  title,
  description,
  icon,
  onClick,
  loading = false,
}: {
  title: string;
  description: string;
  icon: string;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="group cursor-pointer rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm transition-all hover:border-primary/20 hover:shadow-md disabled:cursor-wait disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="mb-3 text-3xl">{loading ? '⏳' : icon}</div>
      <h3 className="font-heading mb-1 text-lg font-bold text-default transition-colors group-hover:text-primary">
        {title}
      </h3>
      <p className="text-sm text-muted">{loading ? 'Compositing maps…' : description}</p>
    </button>
  );
}
