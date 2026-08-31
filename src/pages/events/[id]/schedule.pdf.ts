import type { APIRoute } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// pdfmake's isomorphic Node entry — reads Roboto TTFs straight off disk.
import pdfMake from 'pdfmake/js/index.js';
import {
  buildEventMasterSchedule,
  hasMasterSchedule,
  baseEventTitle,
  venueScheduleMapPath,
} from '~/utils/eventSchedule';
import { buildScheduleGrid, buildMasterScheduleDocDefinition } from '~/components/schedule/scheduleGrid';

const ROOT = process.cwd();
const FONT_DIR = resolve(ROOT, 'node_modules/pdfmake/fonts/Roboto');

pdfMake.setFonts({
  Roboto: {
    normal: resolve(FONT_DIR, 'Roboto-Regular.ttf'),
    bold: resolve(FONT_DIR, 'Roboto-Medium.ttf'),
    italics: resolve(FONT_DIR, 'Roboto-Italic.ttf'),
    bolditalics: resolve(FONT_DIR, 'Roboto-MediumItalic.ttf'),
  },
});
pdfMake.setLocalAccessPolicy?.(() => true);
pdfMake.setUrlAccessPolicy?.(() => false);

function mapDataUri(siteId: string | undefined): string | undefined {
  const path = venueScheduleMapPath(siteId);
  if (!path) return undefined;
  const buf = readFileSync(resolve(ROOT, 'public', path.replace(/^\//, '')));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

export async function getStaticPaths() {
  const events = await getCollection('event');
  return events
    .filter((event) => hasMasterSchedule(event.data).ok)
    .map((event) => ({ params: { id: event.id }, props: { event } }));
}

export const GET: APIRoute = async ({ props }) => {
  const { event } = props as { event: CollectionEntry<'event'> };
  const { data } = event;

  const leaders = await getCollection('leader');
  const leaderMap = new Map(leaders.map((l) => [l.id, l.data]));

  const grid = buildScheduleGrid(buildEventMasterSchedule(data, leaderMap));
  const docDefinition = buildMasterScheduleDocDefinition(grid, {
    // Titles vary across years ("Winter Adventure 2025" vs "Winter Adventure"),
    // so derive the year from the event date.
    title: `${baseEventTitle(data.title)} ${data.date.getUTCFullYear()}`,
    subtitle: 'Master Schedule',
    mapDataUri: mapDataUri(data.siteId),
  });

  const buffer: Buffer = await pdfMake.createPdf(docDefinition).getBuffer();

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${event.id}-master-schedule.pdf"`,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
