import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the gallery's lightbox video player (GalleryVideoPlayer.tsx,
 * media-chrome inside PhotoSwipe). PhotoSwipe owns pointer drags and arrow
 * keys for slide navigation, so these check that the player's own controls
 * win inside a video slide. None of them need the video file itself to load
 * (it streams from media.ecrs.org), only the player chrome.
 */

async function openVideo(page: Page, title: RegExp) {
  await page.goto('/gallery');
  await page.locator('select[data-track-filter="type"]').selectOption('video');
  await page.getByRole('button', { name: title }).click();
  await expect(page.locator('.pswp media-controller').first()).toBeVisible();
}

/** Playback rate of the player on the current slide (PhotoSwipe keeps neighbors mounted). */
function currentVideoRate(page: Page) {
  return page
    .locator('.pswp__item:not([aria-hidden="true"]) media-controller video')
    .first()
    .evaluate((v: HTMLVideoElement) => v.playbackRate);
}

test('speed menu changes the playback rate and remembers it', async ({ page }) => {
  await openVideo(page, /Play video: Ice Cream Disaster/);
  await page.locator('media-playback-rate-menu-button').filter({ visible: true }).click();
  await page.locator('media-playback-rate-menu').filter({ visible: true }).getByText('1.5x', { exact: true }).click();
  await expect.poll(() => currentVideoRate(page)).toBe(1.5);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toHaveCount(0);
  await openVideo(page, /Play video: Spring Weekend 2009/);
  await expect.poll(() => currentVideoRate(page)).toBe(1.5);
});

test('dragging the scrubber does not swipe to another slide', async ({ page }) => {
  await openVideo(page, /Play video: Ice Cream Disaster/);
  const counter = page.locator('.pswp__counter');
  const before = await counter.textContent();
  const box = await page.locator('media-time-range').filter({ visible: true }).boundingBox();
  if (!box) throw new Error('scrubber not visible');
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(counter).toHaveText(before ?? '');
});

test('arrow keys inside the player seek instead of changing slides', async ({ page }) => {
  await openVideo(page, /Play video: Ice Cream Disaster/);
  const counter = page.locator('.pswp__counter');
  const before = await counter.textContent();
  await page.locator('media-play-button').filter({ visible: true }).last().focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await expect(counter).toHaveText(before ?? '');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('every speed in the menu is reachable', async ({ page }) => {
    await openVideo(page, /Play video: Ice Cream Disaster/);
    await page.locator('media-playback-rate-menu-button').filter({ visible: true }).tap();
    await page.locator('media-playback-rate-menu').filter({ visible: true }).getByText('2x', { exact: true }).tap();
    await expect.poll(() => currentVideoRate(page)).toBe(2);
  });
});
