import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { resolveVenue } from '~/utils/resolveEvent';
import { computeEventSections } from '~/utils/eventSections';
import { groupClassesByPeriod, resolveClassLeaderNames } from '~/utils/classes';
import { slugifyPeriod, formatScheduleHeading } from '~/utils/eventSchedule';
import { formatEventDateRange } from '~/utils/dates';
import { stripMarkdown } from '~/utils/markdown';

export const getStaticPaths: GetStaticPaths = async () => {
  const events = await getCollection('event');
  const sites = await getCollection('site');
  const siteMap = new Map(sites.map((s) => [s.id, s.data]));
  return events.map((event) => ({
    params: { id: event.id },
    props: { event, siteData: event.data.siteId ? siteMap.get(event.data.siteId) : undefined },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const { event, siteData } = props as { event: CollectionEntry<'event'>; siteData?: CollectionEntry<'site'>['data'] };
  const { data, id } = event;
  const venue = resolveVenue(data, siteData);
  const { pricingRows } = computeEventSections(data);

  const allLeaders = await getCollection('leader');
  const leaderMap = new Map(allLeaders.map((l) => [l.id, l.data]));

  const allStaff = await getCollection('staff');
  const staffMap = new Map(allStaff.map((s) => [s.id, s.data]));

  const lines: string[] = [];
  const heading = (title: string) => {
    lines.push('', title.toUpperCase(), '-'.repeat(title.length));
  };

  lines.push(data.title);
  lines.push('='.repeat(data.title.length));

  heading('When');
  lines.push(formatEventDateRange(data.date, data.endDate));
  if (data.startTime || data.endTime) {
    lines.push(
      [data.startTime && `Starts ${data.startTime}`, data.endTime && `Ends ${data.endTime}`].filter(Boolean).join(' · ')
    );
  }

  heading('Where');
  lines.push(venue.location || 'TBD');
  if (venue.address) lines.push(venue.address);
  if (venue.phone) lines.push(venue.phone);
  if (venue.accessibilityNote) lines.push(`Accessibility: ${venue.accessibilityNote}`);

  if (data.earlyBirdDeadline) {
    heading('Early-Bird Deadline');
    lines.push(data.earlyBirdDeadline.toDateString());
    if (data.earlyBirdFeeNote) lines.push(data.earlyBirdFeeNote);
  }

  if (data.registrationDeadline) {
    heading('Register By');
    lines.push(data.registrationDeadline.toDateString());
  }

  if (data.excerpt || data.description) {
    heading('About');
    lines.push(stripMarkdown(data.excerpt ?? data.description ?? ''));
  }

  if (data.fee) {
    heading('Cost');
    lines.push(data.fee);
  }

  if (data.tuition && data.tuition.length > 0) {
    heading(data.tuitionLabel ?? 'Tuition');
    for (const tier of data.tuition) {
      lines.push([tier.label, tier.amount].filter(Boolean).join(': ') || tier.amount);
      if (tier.note) lines.push(`  ${tier.note}`);
    }
  }

  if (data.accommodations && data.accommodations.length > 0) {
    heading('Room & Board');
    for (const accom of data.accommodations) {
      lines.push(accom.name);
      if (accom.description) lines.push(`  ${stripMarkdown(accom.description)}`);
      for (const tier of accom.tiers) {
        lines.push(`  ${tier.label}: ${tier.amount}`);
      }
    }
  }

  if (pricingRows.length > 0) {
    heading('Pricing');
    for (const tier of pricingRows) {
      lines.push(`${tier.ageRange}: ${tier.fullWeekend ?? '—'}`);
      if (tier.note) lines.push(`  ${tier.note}`);
    }
  }

  if (data.mealsIncluded || data.mealsNote) {
    heading('Meals');
    if (data.mealsIncluded) lines.push(data.mealsIncluded);
    if (data.mealsNote) lines.push(stripMarkdown(data.mealsNote));
  }

  if (data.classes && data.classes.length > 0) {
    heading('Schedule');
    const slotByPeriod = new Map(
      (data.schedule?.timeslots ?? []).filter((ts) => !ts.isBreak).map((ts) => [slugifyPeriod(ts.label), ts])
    );
    const groups = groupClassesByPeriod(data.classes);
    for (const [period, classes] of groups) {
      if (period) {
        lines.push(
          '',
          formatScheduleHeading(period, slotByPeriod.get(slugifyPeriod(period)), undefined, false).toUpperCase()
        );
      }
      for (const cls of classes) {
        const leaderNames = resolveClassLeaderNames(cls, leaderMap);
        const parts = [cls.name];
        if (leaderNames.length > 0) parts.push(`— ${leaderNames.join(', ')}`);
        if (cls.ageRange) parts.push(`(${cls.ageRange})`);
        if (cls.days) parts.push(cls.days);
        if (cls.limitedCapacity) parts.push('[Limited capacity]');
        lines.push(parts.join(' '));
        if (cls.description) lines.push(`  ${stripMarkdown(cls.description)}`);
      }
    }
  }

  if (data.showCancellationPolicy && data.cancellationPolicy) {
    heading('Cancellation Policy');
    lines.push(stripMarkdown(data.cancellationPolicy));
  }

  if (data.showHealthPolicy && data.healthPolicy) {
    heading('Health Policy');
    lines.push(stripMarkdown(data.healthPolicy));
  }

  const resolvedStaff: { name: string; role?: string }[] = [];
  for (const s of data.staff ?? []) {
    const record = s.id ? staffMap.get(s.id) : undefined;
    const name = s.name ?? record?.name;
    if (!name) continue;
    resolvedStaff.push({ name, role: s.role ?? record?.role });
  }

  if (resolvedStaff.length > 0) {
    heading('Event Staff');
    for (const s of resolvedStaff) {
      lines.push(s.role ? `${s.role}: ${s.name}` : s.name);
    }
  }

  if (data.registrationUrl) {
    heading('Registration');
    lines.push(data.registrationUrl);
  } else if (data.cognitoFormId || data.zeffyFormUrl) {
    heading('Registration');
    lines.push(`Register online at https://ecrs.org/events/${id}#registration`);
  } else if (data.noRegistrationRequired) {
    heading('Registration');
    lines.push('No registration required — just show up.');
  }

  if (data.tags && data.tags.length > 0) {
    heading('Tags');
    lines.push(data.tags.join(', '));
  }

  const text = lines.join('\n') + '\n';

  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
      'Content-Disposition': `attachment; filename="${id}.txt"`,
    },
  });
};
