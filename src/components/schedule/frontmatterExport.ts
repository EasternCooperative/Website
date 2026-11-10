import type { Workshop, TimeSlot } from './models';

// Turns the tool's edited state into a paste-ready `schedule:` frontmatter block:
// the timeslot rows plus a `rooms:` list (class name -> room). The tool is the
// primary editor for this data; the block is fully tool-owned and safe to paste
// over whatever `schedule:` block is in the event file. Rooms live here rather
// than on each class so the whole plan publishes in one paste: the markdown
// classes carry descriptions/callouts the tool never sees, so it can't rewrite
// the `classes:` block itself.

function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface RoomRow {
  name: string;
  /** The class's period text, so same-named classes in different periods stay distinct. */
  period: string;
  room: string;
}

export interface ScheduleFrontmatter {
  yaml: string;
  roomRows: RoomRow[];
}

export function buildScheduleFrontmatter(workshops: Workshop[], timeslots: TimeSlot[]): ScheduleFrontmatter {
  const lines: string[] = ['schedule:', '  timeslots:'];

  for (const ts of timeslots) {
    lines.push(`    - label: ${yamlString(ts.displayName)}`);
    if (ts.startTime) lines.push(`      start: ${yamlString(ts.startTime)}`);
    if (ts.endTime) lines.push(`      end: ${yamlString(ts.endTime)}`);
    if (ts.isCustom) lines.push('      isBreak: true');
  }

  const roomRows: RoomRow[] = workshops
    .filter((w) => w.location.trim())
    .map((w) => ({ name: w.name, period: w.period.displayName, room: w.location.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.period.localeCompare(b.period));

  if (roomRows.length > 0) {
    lines.push('  rooms:');
    for (const r of roomRows) {
      lines.push(`    - class: ${yamlString(r.name)}`);
      if (r.period) lines.push(`      period: ${yamlString(r.period)}`);
      lines.push(`      room: ${yamlString(r.room)}`);
    }
  }

  return { yaml: `${lines.join('\n')}\n`, roomRows };
}
