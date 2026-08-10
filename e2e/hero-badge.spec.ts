import { test, expect } from '@playwright/test';

/**
 * E2E regression tests for the "Founded 1940" badge on the homepage hero.
 *
 * This badge went through many rounds of layout bugs — overlapping the nav,
 * overlapping the event card, mismatched gaps — because its position depends
 * on real browser layout (flexbox, viewport height, the header's actual
 * rendered height) that jsdom unit tests can't reproduce. These tests assert
 * the invariants that broke each time, against the real rendered page.
 *
 * The nav breakpoint (--breakpoint-nav in tailwind.css) is 1110px: below it
 * the header shows a hamburger menu and the badge must stay hidden (it
 * previously rendered underneath the mobile header at 1024–1109px).
 */

async function heroRects(page: import('@playwright/test').Page) {
  const header = page.locator('#header');
  const badge = page.locator('[data-hero-badge]');
  const card = page.locator('[data-hero-card]');
  return {
    header: await header.boundingBox(),
    badge: await badge.boundingBox(),
    card: await card.boundingBox(),
  };
}

/**
 * The centered flex area of [data-video-hero-content], excluding its own
 * padding — one edge is the dynamic header-clearance padding-top, the other
 * is a fixed py-20 padding-bottom, so raw header/viewport coordinates aren't
 * directly comparable. This is the box `justify-center` actually centers within.
 */
async function heroContentInterior(page: import('@playwright/test').Page) {
  const content = page.locator('[data-video-hero-content]');
  const box = await content.boundingBox();
  const padding = await content.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom) };
  });
  if (!box) return null;
  return { top: box.y + padding.top, bottom: box.y + box.height - padding.bottom };
}

/**
 * The combined top/bottom of [data-video-hero-content]'s direct flex children
 * (the badge row and the grid row) — i.e. the actual block `justify-center`
 * centers. Deliberately not the badge/card elements themselves: the grid uses
 * `items-center` with the card set to `self-start`, so when the text column
 * is taller than the card, the card's own bottom edge sits well above the
 * row's real bottom — a pre-existing column-height quirk unrelated to
 * top/bottom centering, which would otherwise show up as a false gap mismatch.
 */
async function heroContentBlockSpan(page: import('@playwright/test').Page) {
  return page.locator('[data-video-hero-content] > *').evaluateAll((els) => {
    const rects = els.map((el) => el.getBoundingClientRect());
    return { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
  });
}

test.describe('hero badge — below the nav breakpoint (1024x800)', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('is not visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-hero-badge]')).not.toBeVisible();
  });
});

test.describe('hero badge — above the nav breakpoint', () => {
  for (const viewport of [
    { width: 1150, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test.describe(`${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test('is visible', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('[data-hero-badge]')).toBeVisible();
      });

      test('does not overlap the header', async ({ page }) => {
        await page.goto('/');
        const { header, badge } = await heroRects(page);
        expect(header).toBeTruthy();
        expect(badge).toBeTruthy();
        expect(badge!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      });

      test('does not overlap the event card', async ({ page }) => {
        await page.goto('/');
        const { badge, card } = await heroRects(page);
        expect(badge).toBeTruthy();
        expect(card).toBeTruthy();
        expect(card!.y).toBeGreaterThanOrEqual(badge!.y + badge!.height);
      });

      // The hero content (badge + grid, as a group) is vertically centered within
      // its content box, rather than top-anchored — the leftover space above the
      // group should roughly match the leftover space below it. Catches a
      // regression back to top-anchoring, which piles all the leftover space below
      // the content instead of splitting it evenly.
      test('leftover space splits evenly above and below the hero content', async ({ page }) => {
        await page.goto('/');
        const interior = await heroContentInterior(page);
        const block = await heroContentBlockSpan(page);
        expect(interior).toBeTruthy();

        const topGap = block.top - interior!.top;
        const bottomGap = interior!.bottom - block.bottom;

        // Generous tolerance — this only needs to catch the gaps badly diverging
        // (e.g. content reverting to top-anchored), not pin an exact pixel value
        // that would break on font-metric changes.
        expect(Math.abs(topGap - bottomGap)).toBeLessThan(30);
      });
    });
  }
});
