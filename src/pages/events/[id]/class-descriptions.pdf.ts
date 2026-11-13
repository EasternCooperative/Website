import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { baseEventTitle } from '~/utils/eventSchedule';
import {
  buildClassDescriptionGroups,
  classDescriptionsDocDefinition,
  hasClassDescriptions,
} from '~/utils/classDescriptionsPdf';

// Attendee handout: every class with its description, built from the event's
// `classes[]` at build time. Linked from the event page's Schedule section and
// from the class registration page.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfMake as any).vfs = ((pdfFonts as any).pdfMake?.vfs ?? (pdfFonts as any).vfs) as Record<string, string>;

export const getStaticPaths: GetStaticPaths = async () => {
  const events = await getCollection('event');
  return events
    .filter((event) => hasClassDescriptions(event.data))
    .map((event) => ({ params: { id: event.id }, props: { event } }));
};

export const GET: APIRoute = async ({ props }) => {
  const { event } = props as { event: CollectionEntry<'event'> };
  const { data } = event;

  const leaders = await getCollection('leader');
  const leaderMap = new Map(leaders.map((l) => [l.id, l.data]));

  const eventLabel = `${baseEventTitle(data.title)} ${data.date.getUTCFullYear()}`;
  const docDefinition = classDescriptionsDocDefinition(buildClassDescriptionGroups(data, leaderMap), eventLabel);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: Uint8Array = await (pdfMake as any).createPdf(docDefinition).getBuffer();

  return new Response(buffer as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${event.id}-class-descriptions.pdf"`,
    },
  });
};
