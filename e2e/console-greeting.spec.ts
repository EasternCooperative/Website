import { test, expect } from '@playwright/test';

/**
 * The devtools console greeting (ConsoleGreeting.astro) is an easter egg, but
 * it is easy to break silently: a minifier collapsing the art's spacing, or a
 * view-transition navigation printing it a second time. Neither shows up
 * anywhere a visitor (or a unit test) would notice.
 */

const NAME = 'Eastern Cooperative Recreation School';
const FIRST_ROW = '███████╗ ██████╗██████╗ ███████╗';
const LAST_ROW = '╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝';

test('prints the ECRS logo once, and not again after client-side navigation', async ({ page }) => {
  const greetings: string[] = [];
  page.on('console', (msg) => {
    // Each letter is its own %c-styled segment; strip the markers so the rows
    // can be compared as plain text.
    const text = msg.text().replace(/%c/g, '');
    if (text.includes(NAME)) greetings.push(text);
  });

  await page.goto('/');
  await expect.poll(() => greetings.length).toBe(1);
  expect(greetings[0]).toContain(FIRST_ROW);
  expect(greetings[0]).toContain(LAST_ROW);
  expect(greetings[0]).toContain('https://github.com/EasternCooperative/Website');

  await page.locator('footer a[href="/about"]').first().click();
  await page.waitForURL('**/about');
  await expect(page.locator('h1').first()).toBeVisible();
  expect(greetings).toHaveLength(1);
});
