import { resolveClassLeaderNames } from '~/utils/classes';
import { buildScheduleGroups, type EventScheduleData } from '~/utils/eventSchedule';
import { stripMarkdown } from '~/utils/markdown';

// The attendee-facing "class descriptions" PDF served at
// /events/<id>/class-descriptions.pdf: every class with its description,
// grouped by period, for reading alongside the class registration form.
// This module only builds the pdfmake document definition; the endpoint
// renders it, so nothing here depends on pdfmake.

export interface ClassDescriptionEntry {
  name: string;
  leader: string;
  /** Days, room, restriction, and "Limited capacity", whichever are set. */
  meta: string[];
  /** Plain text (markdown stripped). */
  description: string;
  callout: string;
}

export interface ClassDescriptionGroup {
  /** Period name, or the time range when the period is only a time. Empty for an ungrouped class list. */
  heading: string;
  /** Formatted clock time shown under the heading; empty when unknown or already the heading. */
  time: string;
  classes: ClassDescriptionEntry[];
}

const META_COLOR = '#555555';
// LETTER width (612pt) minus the two side margins.
const SIDE_MARGIN = 54;
const CONTENT_WIDTH = 612 - SIDE_MARGIN * 2;

/** Offer the PDF only when there is something to read beyond the class names. */
export function hasClassDescriptions(data: EventScheduleData): boolean {
  return (data.classes ?? []).some((c) => c.description?.trim());
}

/**
 * Classes grouped exactly as the event page's Schedule section groups them
 * (same order, same headings), minus the break rows.
 */
export function buildClassDescriptionGroups(
  data: EventScheduleData,
  leaderMap: Map<string, { name: string }>
): ClassDescriptionGroup[] {
  const groups: ClassDescriptionGroup[] = [];
  for (const group of buildScheduleGroups(data)) {
    if (group.kind !== 'classes') continue;
    const label = group.showHeading ? group.label : '';
    groups.push({
      heading: label || group.timeRange,
      time: label ? group.timeRange : '',
      classes: group.classes.map((c) => ({
        name: c.name,
        leader: resolveClassLeaderNames(c, leaderMap).join(', '),
        meta: [c.days, c.room, c.restriction, c.limitedCapacity ? 'Limited capacity' : '']
          .map((m) => m?.trim())
          .filter((m): m is string => !!m),
        description: c.description ? stripMarkdown(c.description) : '',
        callout: c.callout ?? '',
      })),
    });
  }
  return groups;
}

/** pdfmake document definition: a flowing handout, classes never split across pages. */
export function classDescriptionsDocDefinition(groups: ClassDescriptionGroup[], eventLabel: string): object {
  const content: object[] = [
    { text: eventLabel, fontSize: 13, color: META_COLOR, marginBottom: 2 },
    { text: 'Class Descriptions', fontSize: 22, bold: true },
  ];

  for (const group of groups) {
    if (group.heading) {
      content.push({
        // Marks the heading so `pageBreakBefore` can keep it with its first class.
        headlineLevel: 1,
        stack: [
          { text: group.heading, fontSize: 15, bold: true },
          ...(group.time ? [{ text: group.time, fontSize: 11, color: META_COLOR, marginTop: 1 }] : []),
          {
            canvas: [{ type: 'line', x1: 0, y1: 4, x2: CONTENT_WIDTH, y2: 4, lineWidth: 0.75, lineColor: '#bbbbbb' }],
          },
        ],
        margin: [0, 18, 0, 0],
      });
    }

    for (const c of group.classes) {
      content.push({
        unbreakable: true,
        stack: [
          {
            text: [
              { text: c.name, bold: true, fontSize: 12 },
              ...(c.leader ? [{ text: `  with ${c.leader}`, fontSize: 11, color: META_COLOR }] : []),
            ],
          },
          ...(c.meta.length ? [{ text: c.meta.join('  •  '), fontSize: 9, color: META_COLOR, marginTop: 1 }] : []),
          ...(c.description ? [{ text: c.description, fontSize: 10, lineHeight: 1.15, marginTop: 3 }] : []),
          ...(c.callout ? [{ text: c.callout, fontSize: 10, bold: true, marginTop: 3 }] : []),
        ],
        margin: [0, 9, 0, 0],
      });
    }
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [SIDE_MARGIN, 48, SIDE_MARGIN, 48],
    info: { title: `${eventLabel} Class Descriptions` },
    footer: (currentPage: number, pageCount: number) => ({
      text: `${eventLabel}  |  Page ${currentPage} of ${pageCount}`,
      alignment: 'center',
      fontSize: 9,
      color: META_COLOR,
      margin: [0, 12, 0, 0],
    }),
    // Don't strand a period heading at the bottom of a page.
    pageBreakBefore: (
      node: { headlineLevel?: number; pageNumbers?: number[] },
      following: { pageNumbers?: number[] }[]
    ) => node.headlineLevel === 1 && following.length > 0 && following[0].pageNumbers?.[0] !== node.pageNumbers?.[0],
    content,
  };
}
