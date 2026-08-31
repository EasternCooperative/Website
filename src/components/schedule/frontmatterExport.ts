import type { Workshop, TimeSlot } from './models';

// Turns the tool's edited state into a paste-ready `schedule:` frontmatter block
// plus a class -> room table. The tool is the primary editor for this data; the
// block is fully tool-owned and safe to paste over whatever is in the event file.
// Room values are applied per class field (not as a `classes:` block) because the
// markdown classes carry descriptions/callouts the tool never sees.

function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface RoomRow {
  name: string;
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
    .map((w) => ({ name: w.name, room: w.location.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { yaml: `${lines.join('\n')}\n`, roomRows };
}
