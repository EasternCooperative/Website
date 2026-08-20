export type TuitionTier = { label?: string; amount: string; note?: string };
export type PricingTier = { ageRange?: string; fullWeekend?: string; note?: string };

export type EventSectionsInput = {
  date: Date;
  endDate?: Date;
  fee?: string;
  tuition?: TuitionTier[];
  accommodations?: unknown[];
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
