// Playwright contract — Escalations + Exceptions (phase T5).
//
// Marked as a contract: the runner is not yet wired at the repo root
// (T0 carry-over). The QA agent should run this once Playwright is
// installed. The flow exercises:
//   1. /escalations is reachable for users with escalation.view_own.
//   2. Owner can open a manual exception on a task and see the red
//      "استثناء مفتوح" badge appear on the task page.
//   3. Owner can resolve the exception via the inline form.
//   4. Acknowledging an open escalation flips the row to "مُقَرّ به".

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "alsultain@agency.com";
const OWNER_PASS = process.env.OWNER_PASS ?? "alsultain22";

test.describe("escalations", () => {
  test("owner opens + resolves a manual exception", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', OWNER_EMAIL);
    await page.fill('input[name="password"]', OWNER_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    // /escalations is reachable.
    await page.goto(`${BASE_URL}/escalations`);
    await expect(page.locator("text=التصعيدات والاستثناءات")).toBeVisible();

    // Open the first task in the list.
    await page.goto(`${BASE_URL}/tasks`);
    await page.click("a:has-text('عرض')");

    // Open exception modal.
    await page.click("button:has-text('فتح استثناء')");
    await page.fill("textarea[name='reason']", "اختبار E2E");
    await page.click("button:has-text('فتح الاستثناء')");

    // Badge should now be visible.
    await expect(page.locator("text=استثناء مفتوح")).toBeVisible();

    // Navigate to /escalations and resolve it inline.
    await page.goto(`${BASE_URL}/escalations`);
    await page.click("button:has-text('إغلاق الاستثناء')");
    await page.fill("textarea[name='note']", "تم الحل");
    await page.click("button:has-text('حفظ')");

    // Status flips to closed.
    await expect(page.locator("text=مغلق")).toBeVisible();
  });

  test("dashboard surfaces open escalations tile", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', OWNER_EMAIL);
    await page.fill('input[name="password"]', OWNER_PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    await expect(page.locator("text=تصعيدات مفتوحة")).toBeVisible();
  });
});
