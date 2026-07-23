import type { CollectionEntry } from 'astro:content';

type ActivityData = CollectionEntry<'activity'>['data'];

export const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const activityLevelLabel: Record<NonNullable<ActivityData['activityLevel']>, string> = {
  inactive: 'Inactive',
  'somewhat-active': 'Somewhat Active',
  'very-active': 'Very Active',
};

export const safetyFlagLabel: Record<string, string> = {
  'no-running': 'No running',
  'spotter-recommended': 'Spotter recommended for falls/landings',
  'watch-for-tripping-hazards': 'Watch for tripping hazards',
};

// Posture and seated/wheelchair adaptability are separate fields in the CMS,
// but collapse into a single display pill: the posture label, plus a
// wheelchair icon when the activity supports or adapts to seated participation.
export function getPosturePill(
  data: Pick<ActivityData, 'posture' | 'seatedOrWheelchairAdaptable'>
): { label: string; accessible: boolean } | undefined {
  if (data.posture) return { label: sentenceCase(data.posture), accessible: !!data.seatedOrWheelchairAdaptable };
  if (data.seatedOrWheelchairAdaptable) return { label: 'Seated/wheelchair adaptable', accessible: true };
  return undefined;
}

export function getBadges(data: Pick<ActivityData, 'isCalled' | 'isRound' | 'beginnerAdaptable'>): string[] {
  return [
    data.isCalled ? 'Called live' : '',
    data.isRound ? 'Round' : '',
    data.beginnerAdaptable ? 'Beginner adaptable' : '',
  ].filter(Boolean);
}

// Games/dances use numeric min/max fields; songs use the free-text
// groupSize field instead (see content.config.ts). Prefer whichever is set.
export function formatGroupSize(
  data: Pick<ActivityData, 'groupSize' | 'groupSizeMin' | 'groupSizeMax'>
): string | undefined {
  if (data.groupSize) return data.groupSize;
  const { groupSizeMin: min, groupSizeMax: max } = data;
  if (min && max) return `${min}–${max}`;
  if (min) return `${min}+`;
  if (max) return `Up to ${max}`;
  return undefined;
}
