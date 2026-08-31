import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const emptyToUndefined = (v: unknown) => (v === '' || v == null ? undefined : v);
const optionalDate = z.preprocess(emptyToUndefined, z.date().optional());
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const landingSettingsCollection = defineCollection({
  // Only landing.md — the JSON siblings in settings/ are plain imports, and a
  // stray future .md must not get pulled into this schema and break the build.
  loader: glob({ pattern: 'landing.md', base: 'src/data/settings' }),
  schema: z.object({
    heroTitle: z.string(),
    heroSubtitle: z.string(),
    aboutTitle: z.string(),
    aboutBody: z.string(),
    aboutImage: z.string().optional(),
    pillars: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        icon: z.string(),
        classes: z.object({ icon: z.string() }).optional(),
      })
    ),
    stats: z
      .array(
        z.object({
          amount: z.string(),
          title: z.string(),
        })
      )
      .optional(),
    whatToExpectTitle: z.string().optional(),
    whatToExpectSubtitle: z.string().optional(),
    whatToExpectItems: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
          icon: z.string(),
          iconColor: z.string().optional(),
        })
      )
      .optional(),
    whyTitle: z.string().optional(),
    whySubtitle: z.string().optional(),
    ctaTitle: z.string().optional(),
    ctaSubtitle: z.string().optional(),
    ctaPrimaryText: z.string().optional(),
    ctaPrimaryHref: z.string().optional(),
    ctaSecondaryText: z.string().optional(),
    ctaSecondaryHref: z.string().optional(),
    moreEventsEyebrow: z.string().optional(),
    moreEventsHeading: z.string().optional(),
    moreEventsViewAllText: z.string().optional(),
  }),
});

const pricingTierSchema = z.object({
  ageRange: z.string().optional(),
  fullWeekend: z.string().optional(),
  note: z.string().optional(),
});

const accommodationTierSchema = z.object({
  label: z.string(),
  amount: z.string(),
});

const accommodationSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tiers: z.array(accommodationTierSchema),
});

const tuitionTierSchema = z.object({
  label: z.string().optional(),
  amount: z.string(),
  note: z.string().optional(),
});

const testimonialCollection = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/data/testimonials' }),
  schema: z.object({
    quote: z.string(),
    name: z.string().optional(),
    role: z.string().optional(),
  }),
});

const leaderCollection = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/data/leaders' }),
  schema: z.object({
    name: z.string(),
    title: z.string().optional(),
    photo: z.string().optional(),
    bio: z.string().optional(),
    // id (filename slug) of another leader this person always co-leads with and
    // shares a bio/photo with (e.g. a couple who only ever teach together). Set
    // on both sides of the pair. Used by our-people.astro to render one combined
    // card instead of two duplicate ones.
    partnerId: z.string().optional(),
    // Excludes this person from the auto-rendered Leaders section on
    // our-people.astro, while still resolving normally as a class leader on
    // event/activity pages. For people who shouldn't have a public profile
    // (e.g. no longer involved) but are still referenced by past class records.
    hideFromPeoplePage: z.boolean().optional(),
  }),
});

const staffCollection = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/data/staff' }),
  schema: z.object({
    name: z.string(),
    // Default/most-recent role — an event's `staff[]` entry can override this
    // with its own `role` for that specific event.
    role: z.string().optional(),
    photo: z.string().optional(),
    bio: z.string().optional(),
  }),
});

const siteCollection = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/data/sites' }),
  schema: z.object({
    name: z.string(),
    address: z.string().optional(),
    phone: z.string().optional(),
    accessibilityNote: z.string().optional(),
    image: z.string().optional(),
    // Overrides geocoding the address text for the map link when it's imprecise
    // (e.g. "Wilmington, DE") — displayed address text is unaffected.
    lat: z.number().optional(),
    lng: z.number().optional(),
    website: z.url().optional(),
    // A venue ECRS has used but no longer does. Only surfaces on /connections —
    // events resolve venues by siteId, so these records appear nowhere else.
    historical: z.boolean().default(false),
  }),
});

const eventCollection = defineCollection({
  loader: glob({ pattern: ['*.md', '*.mdx'], base: 'src/data/events' }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    endDate: optionalDate,
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    siteId: z.string().optional(),
    location: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    accessibilityNote: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    excerpt: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),

    // Registration
    registrationUrl: optionalString,
    registrationDeadline: optionalDate,
    earlyBirdDeadline: optionalDate,
    earlyBirdFeeNote: z.string().optional(),
    cognitoFormId: z.string().optional(),
    zeffyFormUrl: optionalString,
    // Set only for events that never require signup (free drop-in events). When no
    // registration mechanism is set and this is false/unset, the page assumes
    // registration is just not open yet and shows "coming soon" rather than implying
    // no signup will ever be needed.
    noRegistrationRequired: z.boolean().optional(),

    // Pricing — three tiers of complexity (mutually exclusive, pick one)
    fee: z.string().optional(), // simple: "Free / $25 adults"
    tuitionLabel: optionalString, // override heading; defaults to "Tuition"
    tuition: z.array(tuitionTierSchema).optional(), // mid/full: tuition rows
    accommodations: z.array(accommodationSchema).optional(), // full: residential room & board
    pricing: z.array(pricingTierSchema).optional(), // simple: flat age-range price table

    // Logistics
    mealsIncluded: z.string().optional(),
    mealsNote: z.string().optional(),

    // Policies (shown when toggled on; text editable per event)
    showCancellationPolicy: z.boolean().optional(),
    cancellationCutoffDate: optionalDate,
    cancellationPolicy: z.string().optional(),
    showHealthPolicy: z.boolean().optional(),
    healthPolicy: z.string().optional(),

    // Classes / program
    classes: z
      .array(
        z.object({
          name: z.string(),
          leaders: z
            .array(
              z.object({
                id: z.string().optional(),
                name: z.string().optional(),
                role: z.enum(['assistant']).optional(),
              })
            )
            .optional(),
          leaderId: z.string().optional(),
          leader: z.string().optional(),
          ageRange: z.string().optional(),
          period: z.string().optional(),
          days: z.string().optional(),
          // Room for the printable master schedule grid, e.g. "Rec Hall". Free text
          // (venue-agnostic). When every class in a period has one, the event page
          // offers the master-schedule download.
          room: z.string().optional(),
          limitedCapacity: z.boolean().optional(),
          description: z.string().optional(),
          callout: z.string().optional(),
        })
      )
      .optional(),

    // Master Schedule time grid. Array order of `timeslots` is the row order in the
    // generated grid (both the printable page and the PDF). `start`/`end` are 24-hour
    // "HH:MM" strings; omit them and the row falls back to its label. A non-break
    // timeslot's `label` must exactly match the `period` string of the classes that
    // belong in it. Usually populated from the /internal/schedule tool.
    schedule: z
      .object({
        timeslots: z.array(
          z.object({
            label: z.string(),
            start: optionalString,
            end: optionalString,
            isBreak: z.boolean().optional(), // meals / free time — full-width band, never matched to classes
          })
        ),
      })
      .optional(),

    // Event staff — logistics/coordination roles (registrar, tech support, business
    // manager, etc.) that aren't tied to teaching a class. Distinct from `classes[].leaderId`,
    // which references the `leader` collection instead. References the `staff` collection.
    staff: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string().optional(),
          role: z.string().optional(),
        })
      )
      .optional(),

    // Additional info
    newcomerNote: z.string().optional(),
    financialAidNote: z.string().optional(),

    tags: z.array(z.string()).optional(),

    // Internal — draft events build pages but are excluded from listings/sitemap
    draft: z.boolean().optional(),
  }),
});

const activityReferenceSchema = z.object({
  url: z.string(),
  label: z.string().optional(),
});

const activityTabSchema = z.object({
  instrument: z.string(), // e.g. "guitar", "ukulele" — free text so other instruments fit
  notation: z.string().optional(), // chord-over-lyric text or ASCII tab
  file: z.string().optional(), // scanned/handwritten tab upload
});

const activityCollection = defineCollection({
  loader: glob({ pattern: ['*.md', '*.mdx'], base: 'src/data/activities' }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['game', 'dance', 'song']),
    excerpt: z.string().optional(),
    instructions: z.string().optional(),
    tags: z.array(z.string()).optional(),
    groupSize: z.string().optional(), // free-text — songs only; games/dances use the numeric fields below
    groupSizeMin: z.number().int().positive().optional(),
    groupSizeMax: z.number().int().positive().optional(),
    groupSizeAdaptationNotes: z.string().optional(), // how to adapt for an especially large or small group
    duration: z.string().optional(),
    energyLevel: z.enum(['low', 'medium', 'high']).optional(), // overall vibe/intensity
    materialsNeeded: z.string().optional(),
    leadingTips: z.string().optional(),
    adaptations: z.string().optional(), // how to simplify/extend for different skill levels

    // Attribution / provenance — community norm, not just legal cover
    origin: z.string().optional(),

    // External references — link out, don't reproduce copyrighted lyrics/audio
    references: z.array(activityReferenceSchema).optional(),

    relatedLeaderIds: z.array(z.string()).optional(),
    relatedEventIds: z.array(z.string()).optional(),

    // ── Physical-activity fields (game / dance) ────────────────────────
    formation: z.string().optional(), // e.g. "Circle", "Line", "Mingling", "Longways set"
    activityLevel: z.enum(['inactive', 'somewhat-active', 'very-active']).optional(), // physical exertion
    physicalContactLevel: z.enum(['none', 'some', 'high']).optional(),
    physicalContactNotes: z.string().optional(), // e.g. "holding hands" vs "hugging"
    accessibilityNotes: z.string().optional(),
    safetyFlags: z.array(z.string()).optional(), // e.g. "no-running", "spotter-recommended"
    safetyNotesOther: z.string().optional(),
    seatedOrWheelchairAdaptable: z.boolean().optional(),
    beginnerAdaptable: z.boolean().optional(), // can be simplified for total newcomers
    setting: z.enum(['indoor', 'outdoor', 'either']).optional(),
    ageRange: z.string().optional(),
    posture: z.enum(['standing', 'sitting', 'either']).optional(),

    // ── Game-specific ──────────────────────────────────────────────────
    objective: z.string().optional(), // win/end condition, e.g. "Be the last player standing"
    variations: z.string().optional(),

    // ── Dance-specific ───────────────────────────────────────────────────
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    meter: z.string().optional(), // e.g. "4/4", "3/4"
    isCalled: z.boolean().optional(), // caller prompts figures live vs. danced from memory
    formationDiagram: z.string().optional(), // floor-plan/diagram image

    // ── Song-specific ────────────────────────────────────────────────────
    lyrics: z.string().optional(), // only for public-domain/rights-cleared songs
    sheetMusicFile: z.string().optional(),
    key: z.string().optional(), // musical key, e.g. "G major"
    tabs: z.array(activityTabSchema).optional(),
    language: z.string().optional(),
    translation: z.string().optional(),
    transliteration: z.string().optional(),
    isRound: z.boolean().optional(),

    image: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});

const galleryPhotoCollection = defineCollection({
  loader: glob({ pattern: '*.md', base: 'src/data/gallery' }),
  schema: z.object({
    image: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
    year: z.number().int().optional(),
    date: z.string().optional(), // ISO date, when known precisely
    photographer: z.string().optional(),
    event: z.string().optional(),
    sourceUrl: z.string().optional(), // provenance back to the WordPress original
  }),
});

export const collections = {
  event: eventCollection,
  leader: leaderCollection,
  staff: staffCollection,
  site: siteCollection,
  testimonial: testimonialCollection,
  landingSettings: landingSettingsCollection,
  activity: activityCollection,
  galleryPhoto: galleryPhotoCollection,
};
