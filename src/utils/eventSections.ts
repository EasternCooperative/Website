export type TuitionTier = { label?: string; amount: string; note?: string };
export type PricingTier = { ageRange?: string; fullWeekend?: string; note?: string };
export type Accommodation = { name: string; description?: string; tiers: { label: string; amount: string }[] };

export type EventSectionsInput = {
  date: Date;
  endDate?: Date;
  fee?: string;
  tuition?: TuitionTier[];
  accommodations?: Accommodation[];
  pricing?: PricingTier[];
  classes?: unknown[];
  cognitoFormId?: string;
  zeffyFormUrl?: string;
  registrationUrl?: string;
  showCancellationPolicy?: boolean;
  cancellationCutoffDate?: Date;
};

export type JumpLink = { href: string; label: string };
export type RegisterMode = 'cognito' | 'zeffy' | 'url' | 'none';
export type TuitionDisplay = 'card' | 'table' | 'none';

export type EventSections = {
  isPast: boolean;
  pricingRows: PricingTier[];
  offerRows: PricingTier[];
  hasCosts: boolean;
  hasClasses: boolean;
  hasEmbeddedForm: boolean;
  jumpLinks: JumpLink[];
  showJumpNav: boolean;
  registerMode: RegisterMode;
  tuitionDisplay: TuitionDisplay;
  tuitionHasLabels: boolean;
  cancellationCutoff: Date | null;
};

export function computeEventSections(data: EventSectionsInput, now = new Date()): EventSections {
  const isPast = (data.endDate ?? data.date) < now;

  const pricingRows = (data.pricing ?? []).filter((p) => p.ageRange);
  // JSON-LD Offers need a flat list of priced tiers. Events with a simple age-based
  // price table use `pricing` directly. Events priced by tuition and/or a residential
  // accommodations breakdown don't need a second, redundant `pricing` array just to
  // feed structured data — derive offer rows from whichever of those is present
  // instead, so there's exactly one place each event's price lives.
  const offerRows: PricingTier[] =
    pricingRows.length > 0
      ? pricingRows
      : data.tuition?.length
        ? data.tuition.map((t) => ({ ageRange: t.label ?? 'Tuition', fullWeekend: t.amount, note: t.note }))
        : (data.accommodations ?? []).flatMap((a) =>
            a.tiers.map((t) => ({ ageRange: `${a.name} — ${t.label}`, fullWeekend: t.amount }))
          );

  const hasCosts = !!(data.fee || data.tuition?.length || data.accommodations?.length || pricingRows.length);
  const hasClasses = !!data.classes?.length;
  const hasEmbeddedForm = !isPast && !!(data.cognitoFormId || data.zeffyFormUrl);

  const jumpLinks: JumpLink[] = [
    hasCosts && { href: '#costs', label: 'Costs' },
    hasClasses && { href: '#schedule', label: 'Schedule' },
    hasEmbeddedForm && { href: '#registration', label: 'Register' },
  ].filter(Boolean) as JumpLink[];

  const showJumpNav = jumpLinks.length >= 2;

  let registerMode: RegisterMode = 'none';
  if (!isPast) {
    if (data.cognitoFormId) registerMode = 'cognito';
    else if (data.zeffyFormUrl) registerMode = 'zeffy';
    else if (data.registrationUrl) registerMode = 'url';
  }

  const tuitionCount = data.tuition?.length ?? 0;
  let tuitionDisplay: TuitionDisplay = 'none';
  if (tuitionCount === 1) tuitionDisplay = 'card';
  else if (tuitionCount > 1) tuitionDisplay = 'table';

  // Only meaningful when display === 'table'
  const tuitionHasLabels = tuitionDisplay === 'table' && !!data.tuition?.some((t) => t.label);

  let cancellationCutoff: Date | null = null;
  if (data.cancellationCutoffDate) {
    cancellationCutoff = data.cancellationCutoffDate;
  } else if (data.showCancellationPolicy) {
    cancellationCutoff = new Date(data.date);
    cancellationCutoff.setUTCDate(cancellationCutoff.getUTCDate() - 21);
  }

  return {
    isPast,
    pricingRows,
    offerRows,
    hasCosts,
    hasClasses,
    hasEmbeddedForm,
    jumpLinks,
    showJumpNav,
    registerMode,
    tuitionDisplay,
    tuitionHasLabels,
    cancellationCutoff,
  };
}
