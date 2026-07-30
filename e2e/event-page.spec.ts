import { test, expect } from '@playwright/test';

/**
 * E2E smoke tests for the event detail page.
 *
 * These tests verify the *rendered* output of the show/hide logic —
 * things that need a real browser to confirm, like DOM presence and
 * interactive behaviour.
 *
 * The combinatorial state-machine logic (hasCosts, registerMode, etc.)
 * is covered by unit tests in src/__tests__/eventSections.test.ts.
 *
 * Events used here (all draft: true fixtures, excluded from listings and
 * sitemap so they never rot as real content comes and goes):
 *   Past:    e2e-past-event              (2024 — no registration, costs, or classes)
 *   Future:  e2e-future-event            (2099 — no registration, costs, or classes)
 *   Rich:    e2e-popover-fixture         (2099 — cognitoFormId, fee, and classes
 *                                         with a leaderId to drive popover tests)
 */

test.describe('past event', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/e2e-past-event');
  });

  test('shows "Past Event" badge', async ({ page }) => {
    await expect(page.getByText('Past Event')).toBeVisible();
  });

  test('does not show a "Register Now" button', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Register Now' })).not.toBeVisible();
  });

  test('"Add to Calendar" button is hidden for past events', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Add to Calendar' })).not.toBeVisible();
  });

  test('has a working ICS download link', async ({ page }) => {
    const response = await page.request.get('/events/e2e-past-event.ics');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/calendar');
  });

  test('"← All Events" back link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: '← All Events' })).toBeVisible();
  });

  test('jump nav is hidden (event has no costs, classes, or embedded form)', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Jump to section' })).not.toBeVisible();
  });
});

test.describe('future event without registration options', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/e2e-future-event');
  });

  test('does not show "Past Event" badge', async ({ page }) => {
    await expect(page.getByText('Past Event')).not.toBeVisible();
  });

  test('does not show "Register Now" when no registrationUrl or cognitoFormId', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Register Now' })).not.toBeVisible();
  });

  test('shows "Add to Calendar" link', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Add to Calendar' })).toBeVisible();
  });

  test('jump nav is hidden (no costs, classes, or embedded form)', async ({ page }) => {
    await expect(page.getByRole('navigation', { name: 'Jump to section' })).not.toBeVisible();
  });
});

test.describe('events listing page', () => {
  test('loads and shows at least one event card', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('main')).toBeVisible();
    const eventLinks = page.getByRole('link').filter({ hasText: /fun day|weekend|adventure/i });
    await expect(eventLinks.first()).toBeVisible();
  });

  test('does not show the e2e fixture event (draft: true)', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByText('E2E Test Fixture')).not.toBeVisible();
  });
});

test.describe('e2e fixture event (draft)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/e2e-popover-fixture');
  });

  test('page loads and shows title', async ({ page }) => {
    // Scoped by name: the embedded Cognito form injects its own <h1>,
    // so an unscoped level-1 locator resolves to two elements.
    await expect(page.getByRole('heading', { level: 1, name: /E2E Test Fixture/ })).toBeVisible();
  });

  test('does not show "Past Event" badge (future date)', async ({ page }) => {
    await expect(page.getByText('Past Event')).not.toBeVisible();
  });

  test('register button scrolls to #registration (cognitoFormId takes priority)', async ({ page }) => {
    // Use the first "Register Now" link (in the hero action buttons, not the bottom CTA)
    const btn = page.getByRole('link', { name: 'Register Now' }).first();
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('href', '#registration');
  });

  test('embedded Cognito form section is present', async ({ page }) => {
    const section = page.locator('#registration');
    await expect(section).toBeAttached();
  });

  test('jump nav appears (has costs + classes + embedded form = 3 sections)', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Jump to section' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: /Costs/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Classes/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Register/i })).toBeVisible();
  });

  test('costs section is present', async ({ page }) => {
    await expect(page.locator('#costs')).toBeAttached();
  });

  test('classes section is present', async ({ page }) => {
    await expect(page.locator('#classes')).toBeAttached();
  });
});

test.describe('leader popover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events/e2e-popover-fixture');
  });

  test('leader name is a clickable button in the class listing', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Patricia Williams' }).first();
    await expect(trigger).toBeVisible();
  });

  test('clicking leader button opens the popover with name and profile link', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Patricia Williams' }).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const popover = page.locator('[id="leader-patricia-williams"]');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Patricia Williams')).toBeVisible();
    await expect(popover.getByRole('link', { name: /view full profile/i })).toBeVisible();
  });

  test('hovering leader button opens the popover', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Patricia Williams' }).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();

    const popover = page.locator('[id="leader-patricia-williams"]');
    await expect(popover).toBeVisible();
  });

  test('popover closes after moving mouse away', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Patricia Williams' }).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();

    const popover = page.locator('[id="leader-patricia-williams"]');
    await expect(popover).toBeVisible();

    // Move away from both trigger and popover
    await page.mouse.move(0, 0);
    await expect(popover).not.toBeVisible({ timeout: 2000 });
  });

  test('popover profile link points to /our-people with correct anchor', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Patricia Williams' }).first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const link = page.locator('[id="leader-patricia-williams"]').getByRole('link', { name: /view full profile/i });
    await expect(link).toHaveAttribute('href', '/our-people#leader-patricia-williams');
  });
});
