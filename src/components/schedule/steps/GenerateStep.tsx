import { useState } from 'react';
import type { Workshop, TimeSlot } from '../models';
import { buildMasterSchedule, buildRosters, buildIndividualSchedules } from '../scheduleBuilder';
import { downloadMasterSchedule, downloadRosters, downloadIndividualSchedules } from '../printRenderer';

interface Props {
  workshops: Workshop[];
  timeslots: TimeSlot[];
  eventName: string;
  onBack: () => void;
  onReset: () => void;
}

export default function GenerateStep({ workshops, timeslots, eventName, onBack, onReset }: Props) {
  const [generatingIndividual, setGeneratingIndividual] = useState(false);

  function handleMasterSchedule() {
    downloadMasterSchedule(buildMasterSchedule(workshops, timeslots), eventName);
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
          Click a button below to download the PDF.{' '}
          <kbd className="rounded bg-gray-200 px-1 font-mono text-xs dark:bg-gray-700 dark:text-gray-200">Ctrl+P</kbd> /{' '}
          <kbd className="rounded bg-gray-200 px-1 font-mono text-xs dark:bg-gray-700 dark:text-gray-200">⌘P</kbd> to
          print from the browser.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <PrintCard
          title="Master Schedule"
          description="Full grid showing all workshops by location and period. Auto-selects landscape when there are more than 5 locations."
          icon="🗓"
          onClick={handleMasterSchedule}
        />
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
