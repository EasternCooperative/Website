import { test, expect, type Page } from '@playwright/test';

/**
 * E2E tests for the gallery's lightbox video player (GalleryVideoPlayer.tsx,
 * Video.js 10's packaged skin inside PhotoSwipe). PhotoSwipe owns pointer
 * drags and arrow keys for slide navigation, so these check that the player's
 * own controls win inside a video slide. Controls are found by role and label,
 * not by Video.js's private class names.
 */

/** The slide on screen (PhotoSwipe keeps its neighbors mounted, aria-hidden). */
const CURRENT = '.pswp__item:not([aria-hidden="true"])';

async function openVideo(page: Page, title: RegExp) {
  await page.goto('/gallery');
  await page.locator('select[data-track-filter="type"]').selectOption('video');
  await page.getByRole('button', { name: title }).click();
  await expect(player(page)).toBeVisible();
}

const player = (page: Page) => page.locator(`${CURRENT} .ecrs-player`);
const currentVideoRate = (page: Page) =>
  player(page)
    .locator('video')
    .evaluate((v: HTMLVideoElement) => v.playbackRate);

/** Shows the controls (they wait for playback to start) without needing the video to load. */
async function showControls(page: Page) {
  await player(page)
    .locator('video')
    .evaluate((v: HTMLVideoElement) => {
      v.muted = true;
      return v.play().catch(() => {});
    });
  await player(page).hover();
}

async function chooseSpeed(page: Page, speed: string, tap = false) {
  const go = (l: ReturnType<Page['locator']>) => (tap ? l.tap() : l.click());
  await go(player(page).getByRole('button', { name: /settings/i }));
  await go(player(page).getByRole('menuitem', { name: /speed/i }));
  await go(player(page).getByRole('menuitemradio', { name: speed }));
}

test('speed menu changes the playback rate and remembers it', async ({ page }) => {
  await openVideo(page, /Play video: Ice Cream Disaster/);
  await showControls(page);
  await chooseSpeed(page, '1.5×');
  await expect.poll(() => currentVideoRate(page)).toBe(1.5);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toHaveCount(0);
  await openVideo(page, /Play video: Spring Weekend 2009/);
  await expect.poll(() => currentVideoRate(page)).toBe(1.5);
});

test('dragging the scrubber does not swipe to another slide', async ({ page }) => {
  await openVideo(page, /Play video: Ice Cream Disaster/);
  await showControls(page);
  const counter = page.locator('.pswp__counter');
  const before = await counter.textContent();
  const box = await player(page).getByRole('slider', { name: 'Seek' }).boundingBox();
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
  await player(page).getByRole('button', { name: 'Play' }).first().focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await expect(counter).toHaveText(before ?? '');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('every speed in the menu is reachable', async ({ page }) => {
    await openVideo(page, /Play video: Ice Cream Disaster/);
    await showControls(page);
    await chooseSpeed(page, '2×', true);
    await expect.poll(() => currentVideoRate(page)).toBe(2);
  });
});
