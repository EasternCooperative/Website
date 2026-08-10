import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Axe accessibility audits on real rendered pages.
 *
 * Only critical and serious violations fail the build — moderate and minor
 * are reported as test annotations so you can see them without blocking CI.
 *
 * Pages covered:
 *   /              — home (hero, nav, stats, CTA)
 *   /events        — event listing
 *   /events/<past> — past event detail (Past Event badge, no register button)
 *   /events/<fut>  — future event detail (no embedded form, simple layout)
 *   /events/<fix>  — fixture event (cognitoFormId, classes, leader popover)
 *   /our-people    — leader cards, category sections
 *   /contact       — contact page
 *   /connections   — link lists + venue cards (feature-flagged, still built)
 */

type AxeViolation = {
  id: string;
  impact: string | null;
  description: string;
  nodes: { html: string; failureSummary?: string }[];
};

function reportViolations(violations: AxeViolation[], testInfo: TestInfo) {
  if (violations.length === 0) return;
  const lines = violations.map(
    (v) =>
      `[${v.impact?.toUpperCase()}] ${v.id}: ${v.description}\n` +
      v.nodes.map((n) => `  → ${n.html.slice(0, 120)}`).join('\n')
  );
  testInfo.annotations.push({ type: 'accessibility', description: lines.join('\n\n') });
}

async function audit(page: Page, testInfo: TestInfo, url: string) {
  // Disable motion so animation-driven opacity (motion-safe:opacity-0) doesn't
  // cause axe to capture elements mid-fade and report false contrast failures.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
    .exclude('.ecrs-cognito-form') // skip third-party form content we can't fix
    .analyze();

  const violations = results.violations as AxeViolation[];

  const critical = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  const minor = violations.filter((v) => v.impact === 'moderate' || v.impact === 'minor');

  // Always annotate everything so the HTML report shows full detail
  reportViolations(violations, testInfo);

  if (minor.length > 0) {
    const summary = minor.map((v) => `${v.id} (${v.impact})`).join(', ');
    console.warn(`[a11y] ${url} — ${minor.length} moderate/minor: ${summary}`);
  }

  // Only critical/serious block CI
  expect(
    critical,
    `${critical.length} critical/serious axe violations on ${url}:\n` +
      critical
        .map(
          (v) =>
            `  [${v.impact}] ${v.id}: ${v.description}\n` +
            v.nodes.map((n) => `    → ${n.html.slice(0, 200)}`).join('\n')
        )
        .join('\n')
  ).toHaveLength(0);
}

test('home page has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/');
});

test('events listing has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/events');
});

test('past event detail has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/events/e2e-past-event');
});

test('future event detail has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/events/e2e-future-event');
});

test('fixture event (classes + form + popover) has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/events/e2e-popover-fixture');
});

test('our-people page has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/our-people');
});

test('contact page has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/contact');
});

test('connections page has no critical a11y violations', async ({ page }, testInfo) => {
  await audit(page, testInfo, '/connections');
});
