// Playwright contract — Project HOLD (phase T3).
//
// The dispatch acceptance path: AM puts a project on HOLD with a reason →
// the project box renders the red HOLD ribbon → resume clears it. The
// list view (/projects) and the detail view (/projects/[id]) both surface
// the ribbon, with the detail page also showing the reason in a banner.

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe("project hold/resume", () => {
  test("AM puts project on hold → ribbon visible → resume clears", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "alsultain@agency.com");
    await page.fill('input[name="password"]', "alsultain22");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    await page.goto(`${BASE_URL}/projects`);
    await page.click("a:has-text('Open')");

    // Trigger HOLD.
    await page.click("button:has-text('إيقاف المشروع')");
    await page.fill('textarea[name="reason"]', "بانتظار دفعة من العميل");
    await page.click("button:has-text('تأكيد')");
    await expect(page.locator("text=المشروع موقوف مؤقتًا")).toBeVisible();
    await expect(
      page.locator("text=بانتظار دفعة من العميل"),
    ).toBeVisible();

    // List view should show the red HOLD ribbon next to the project name.
    await page.goto(`${BASE_URL}/projects`);
    await expect(page.locator("span:has-text('موقوف')").first()).toBeVisible();

    // Resume.
    await page.goto(`${BASE_URL}/projects`);
    await page.click("a:has-text('Open')");
    await page.click("button:has-text('استئناف المشروع')");
    await expect(page.locator("text=المشروع موقوف مؤقتًا")).toHaveCount(0);
  });
});
