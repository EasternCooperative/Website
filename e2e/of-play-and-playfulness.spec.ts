import { test, expect } from '@playwright/test';

/**
 * Of Play and Playfulness: the book search (runs on the built Pagefind index)
 * and the chapter sidebar's collapsible section lists.
 */

test('searching the book finds a game and jumps to it', async ({ page }) => {
  await page.goto('/of-play-and-playfulness');
  await page.getByRole('button', { name: 'Search the book' }).click();
  const dialog = page.locator('#opp-search');
  await expect(dialog).toBeVisible();
  await page.keyboard.type('balloon');

  const result = dialog.getByRole('link', { name: /^Bat the Balloon/ });
  await expect(result).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('mention');
  await result.click();
  await expect(page).toHaveURL(/\/of-play-and-playfulness\/games#bat_the_balloon$/);
  await expect(dialog).toBeHidden();
});

test('a chapter in the sidebar folds its sections away and back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/of-play-and-playfulness/games');
  const toggle = page.getByRole('button', { name: 'Sections in Games' });
  const list = page.locator('#opp-nav-games');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(list).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(list).toBeHidden();

  // Another chapter's sections open in place, without leaving this one.
  await page.getByRole('button', { name: 'Sections in Dancing' }).click();
  await expect(page.locator('#opp-nav-dancing')).toBeVisible();
  await expect(page).toHaveURL(/\/games$/);
});
