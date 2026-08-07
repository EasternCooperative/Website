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

      test('sits roughly equidistant between the header and the card', async ({ page }) => {
        await page.goto('/');
        const { header, badge, card } = await heroRects(page);
        expect(header).toBeTruthy();
        expect(badge).toBeTruthy();
        expect(card).toBeTruthy();

        const navGap = badge!.y - (header!.y + header!.height);
        const cardGap = card!.y - (badge!.y + badge!.height);

        // Generous tolerance — this only needs to catch a gap ballooning or
        // collapsing (e.g. a flex-space-absorbing spacer regressing), not
        // pin an exact pixel value that would break on font-metric changes.
        expect(Math.abs(navGap - cardGap)).toBeLessThan(15);
      });
    });
  }
});
