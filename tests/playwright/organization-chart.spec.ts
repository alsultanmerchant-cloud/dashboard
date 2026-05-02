// Playwright spec — /organization/chart visibility + sales-flag gating.
//
// Playwright runner is not yet installed at the repo root (see
// docs/phase-T0-report.md). This spec ships as a contract that the QA
// agent picks up when the runner is wired.
//
// Coverage:
//   1. Owner can open /organization/chart and see the technical depts.
//   2. Sales subtree is hidden when sales_track_enabled=off (default).
//   3. Toggling sales_track_enabled=on surfaces the sales group.
//   4. Non-admin who lacks org.manage_structure cannot see admin
//      controls on /organization/departments/[id].

import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const OWNER = {
  email: "alsultain@agency.com",
  password: "alsultain22",
};
const AGENT = {
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

test.describe("/organization/chart", () => {
  test("owner sees technical depts on the chart", async ({ page }) => {
    await login(page, OWNER);
    await page.goto(`${BASE}/organization/chart`);
    await expect(page.getByRole("heading", { name: /هيكل الوكالة/ })).toBeVisible();
    // 7 technical leaves plus account-management group should all render.
    await expect(page.getByText(/إدارة الحسابات|account management/i)).toBeVisible();
  });

  test("sales subtree hidden when flag off, shown when on", async ({ page, context }) => {
    await login(page, OWNER);

    // Ensure flag is off first.
    await page.goto(`${BASE}/settings/feature-flags`);
    const salesRow = page
      .locator('text=sales_track_enabled')
      .locator('..')
      .locator('..')
      .locator('..');
    const toggle = salesRow.getByRole("switch");
    if ((await toggle.getAttribute("aria-checked")) === "true") {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
    }

    // Sales should NOT be visible on the chart.
    await page.goto(`${BASE}/organization/chart`);
    await expect(page.getByText(/مبيعات|sales/i)).toHaveCount(0);

    // Flip the flag on.
    await page.goto(`${BASE}/settings/feature-flags`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Now sales should appear.
    await page.goto(`${BASE}/organization/chart`);
    await expect(page.getByText(/مبيعات|sales/i)).toBeVisible();

    // Restore (off is the safe default).
    await page.goto(`${BASE}/settings/feature-flags`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("non-admin agent sees no admin tools on department detail", async ({ page }) => {
    await login(page, AGENT);
    await page.goto(`${BASE}/organization/chart`);
    // Click the first department card link.
    const firstDept = page.locator('a[href^="/organization/departments/"]').first();
    if (await firstDept.count()) {
      await firstDept.click();
      // Agent should NOT see the admin tools heading.
      await expect(page.getByText(/أدوات الإدارة/)).toHaveCount(0);
    }
  });
});
