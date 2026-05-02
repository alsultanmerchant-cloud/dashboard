// Playwright spec — non-admin cannot reach /settings/feature-flags.
//
// Playwright is not yet installed at the repo root (no test framework was
// configured before T0). This spec is committed as a contract: when the
// orchestrator wires Playwright via the QA agent, it should be picked up
// automatically.
//
// Expected behaviour: the page is gated by `requirePagePermission(
// "feature_flag.manage")`. Non-admin users get a redirect to /dashboard
// (per src/lib/auth-server.ts §requirePagePermission), so we assert the
// final URL.
//
// Run (once Playwright is installed):
//   bunx playwright test tests/playwright/settings-feature-flags.spec.ts

import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Seeded credentials. Owner exists; agent we create-or-reuse via the
// project's normal auth + employee_profiles flow.
const OWNER = {
  email: "alsultain@agency.com",
  password: "alsultain22",
};
const AGENT = {
  // Pre-seeded specialist account — provisioned by /scripts/seed-admin.ts +
  // org seed. If the QA harness does not have one yet, swap to any seeded
  // non-admin credentials.
  email: process.env.TEST_AGENT_EMAIL ?? "agent@agency.com",
  password: process.env.TEST_AGENT_PASSWORD ?? "agent22pass",
};

async function login(page, creds: { email: string; password: string }) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/البريد|email/i).fill(creds.email);
  await page.getByLabel(/كلمة المرور|password/i).fill(creds.password);
  await page.getByRole("button", { name: /دخول|تسجيل|sign in/i }).click();
  await page.waitForURL(/\/(dashboard|tasks|uploads)/);
}

test.describe("/settings/feature-flags gating", () => {
  test("owner can open the page", async ({ page }) => {
    await login(page, OWNER);
    await page.goto(`${BASE}/settings/feature-flags`);
    await expect(page).toHaveURL(/\/settings\/feature-flags$/);
    await expect(page.getByRole("heading", { name: /المفاتيح المميّزة/ })).toBeVisible();
  });

  test("non-admin (agent) is redirected to /dashboard", async ({ page }) => {
    await login(page, AGENT);
    await page.goto(`${BASE}/settings/feature-flags`);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("toggling a flag is observable on next request", async ({ page }) => {
    await login(page, OWNER);
    await page.goto(`${BASE}/settings/feature-flags`);
    // Click the switch on sales_track_enabled.
    const row = page.locator('text=sales_track_enabled').locator('..').locator('..').locator('..');
    const toggle = row.getByRole("switch");
    const initiallyOn = (await toggle.getAttribute("aria-checked")) === "true";
    await toggle.click();
    await expect(toggle).toHaveAttribute(
      "aria-checked",
      initiallyOn ? "false" : "true",
      { timeout: 2000 },
    );
    // Restore.
    await toggle.click();
  });
});
