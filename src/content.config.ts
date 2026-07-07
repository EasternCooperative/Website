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
    excerpt: z.string().optional(),
    description: z.string().optional(),
    image: z.string().optional(),

    // Registration
    registrationUrl: optionalString,
    registrationDeadline: optionalDate,
    earlyBirdDeadline: optionalDate,
    earlyBirdFeeNote: z.string().optional(),
    cognitoFormId: z.string().optional(),

    // Pricing — three tiers of complexity (mutually exclusive, pick one)
    fee: z.string().optional(), // simple: "Free / $25 adults"
    tuitionLabel: optionalString, // override heading; defaults to "Tuition"
    tuition: z.array(tuitionTierSchema).optional(), // mid/full: tuition rows
    accommodations: z.array(accommodationSchema).optional(), // full: residential room & board
    pricing: z.array(pricingTierSchema).optional(), // legacy — kept for back-compat

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
          limitedCapacity: z.boolean().optional(),
          description: z.string().optional(),
          callout: z.string().optional(),
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
    type: z.enum(['game', 'dance', 'song', 'play-party']),
    excerpt: z.string().optional(),
    instructions: z.string().optional(),
    tags: z.array(z.string()).optional(),
    groupSize: z.string().optional(), // free-text — songs only; games/dances/play-parties use the numeric fields below
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

    // ── Physical-activity fields (game / dance / play-party) ──────────
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

    // ── Dance / play-party-specific ─────────────────────────────────────
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

export const collections = {
  event: eventCollection,
  leader: leaderCollection,
  site: siteCollection,
  testimonial: testimonialCollection,
  landingSettings: landingSettingsCollection,
  activity: activityCollection,
};
