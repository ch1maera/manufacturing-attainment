import { test, expect } from '@playwright/test';

/**
 * Smoke coverage for the Plant Attainment Control Tower.
 *
 * Scope: the app boots, every route in App.tsx renders its own chrome, and the
 * data-backed API routes answer with the shapes the client consumes. Deliberately
 * asserts on structure (nav, headings, JSON shape) rather than specific numbers,
 * so regenerating the demo data doesn't turn this red.
 *
 * Run against a local dev server (`npm run test:smoke`, which boots `npm run dev`
 * via playwright.config.ts), or against the deployed app with
 * `PLAYWRIGHT_BASE_URL=https://<app-url> npx playwright test tests/smoke.spec.ts`.
 * Note the deployed app sits behind Databricks OAuth, so an unauthenticated run
 * against it will redirect to login rather than render — local is the default.
 */

const NAV_ITEMS = [
  { label: 'Assistant', path: '/' },
  { label: 'Operations', path: '/operations' },
  { label: 'Attainment', path: '/attainment' },
  { label: 'Miss Pareto', path: '/pareto' },
  { label: 'Steering', path: '/steering' },
] as const;

test.describe('app shell', () => {
  test('serves the app and titles it for this demo', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Plant Attainment Control Tower/);
  });

  test('renders every sidebar destination', async ({ page }) => {
    await page.goto('/');
    for (const item of NAV_ITEMS) {
      await expect(
        // exact: true — the sidebar's brand link is named "Plant Attainment
        // Control Tower", which substring-matches the "Attainment" nav item and
        // trips Playwright's strict mode.
        page.getByRole('link', { name: item.label, exact: true }),
        `"${item.label}" should be in the sidebar`,
      ).toBeVisible();
    }
  });

  test('carries no leftover template copy', async ({ page }) => {
    await page.goto('/');
    const body = (await page.textContent('body')) ?? '';
    // The scaffold this was forked from shipped a LuxeBeauty returns demo and a
    // "Todo List" starter page. Neither belongs in this build.
    expect(body).not.toMatch(/LuxeBeauty/i);
    expect(body).not.toMatch(/Todo List/i);
    expect(body).not.toMatch(/Welcome to your Databricks App/i);
  });
});

test.describe('theme', () => {
  // Regression guard. @databricks/appkit-ui/styles.css declares a full dark
  // palette on `:root:not(.light)` inside a prefers-color-scheme query — a
  // (0,2,0) selector that outranks a bare `:root`. Before index.html carried
  // class="light" (and index.css matched that specificity), every viewer whose
  // OS was in dark mode got appkit's greyscale instead of the brand palette, with
  // white-on-white text in the architecture diagrams. This app is light-only, so
  // the tokens must not move when the OS flips.
  test.use({ colorScheme: 'dark' });

  test('keeps the light brand tokens when the OS asks for dark', async ({ page }) => {
    await page.goto('/');

    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const read = (name: string) => s.getPropertyValue(name).trim();
      return {
        background: read('--background'),
        foreground: read('--foreground'),
        card: read('--card'),
        primary: read('--primary'),
        accent: read('--accent'),
        colorScheme: s.colorScheme,
      };
    });

    // Brand stops, resolved through the --brand-* indirection.
    expect(tokens.primary.toUpperCase()).toBe('#0033A0');
    expect(tokens.accent.toUpperCase()).toBe('#E31837');
    expect(tokens.background.toUpperCase()).toBe('#F7F9FC');
    expect(tokens.card.toUpperCase()).toBe('#FFFFFF');
    expect(tokens.foreground.toUpperCase()).toBe('#0B1B3A');

    // appkit's dark block also flips color-scheme, which would darken native
    // scrollbars and form controls even if the custom properties held.
    expect(tokens.colorScheme).toBe('light');

    // And the paint that actually reaches the user: appkit's @layer base sets
    // body's background from --background, so this catches a token that resolves
    // correctly but loses the cascade at the point of use. Polled because that
    // same rule transitions background-color over 200ms — read too early and you
    // catch a partially-faded rgba() mid-transition.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe('rgb(247, 249, 252)');
  });

  test('exposes no dark-mode toggle surface', async ({ page }) => {
    await page.goto('/');
    // Nothing should add appkit's `.dark` class — the token backstop in
    // index.css deliberately stops applying if it ever appears.
    await expect(page.locator('html.dark')).toHaveCount(0);
    await expect(page.locator('html.light')).toHaveCount(1);
  });
});

test.describe('routes', () => {
  for (const item of NAV_ITEMS) {
    test(`${item.path} renders without an error boundary`, async ({ page }) => {
      const res = await page.goto(item.path);
      expect(res?.status()).toBeLessThan(400);
      // RouteError is what renders when a route throws.
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    });
  }

  test('/platform renders the Databricks pitch page', async ({ page }) => {
    await page.goto('/platform');
    await expect(
      page.getByRole('region', { name: /Plant Attainment on the Databricks Platform/i }),
    ).toBeVisible();
  });
});

test.describe('api', () => {
  test('/api/config reports this demo’s branding', async ({ request }) => {
    const res = await request.get('/api/config');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.branding?.appName).toContain('Plant Attainment Control Tower');
  });

  test('/api/plants returns plant dimensions', async ({ request }) => {
    const res = await request.get('/api/plants');
    expect(res.ok()).toBeTruthy();
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({
      id: expect.any(String),
      plantName: expect.any(String),
    });
  });

  test('/api/misses filters to the open backlog', async ({ request }) => {
    const res = await request.get('/api/misses?status=open');
    expect(res.ok()).toBeTruthy();
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    // Every row must actually be open, or the Operations queue is lying.
    for (const row of rows) expect(row.status).toBe('open');
  });

  test('/api/misses/summary aggregates by status', async ({ request }) => {
    const res = await request.get('/api/misses/summary');
    expect(res.ok()).toBeTruthy();
    const rows = await res.json();
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('status');
    expect(rows[0]).toHaveProperty('n');
  });
});
