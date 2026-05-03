// Phase T7 — Playwright contract for the renewal flow.
//
// Owner-confirmed acceptance: setting next_renewal_date 13 days out
// surfaces a "تجديد خلال X يوم" amber badge on /projects and
// /projects/[id], and starting a new cycle adds a row to the
// "دورات التجديد" table. The scheduler test (pure-Bun) covers the
// notification firing rule.

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe("project renewals", () => {
  test("set cycle 13 days out → badge + new-cycle button generates a row", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "alsultain@agency.com");
    await page.fill('input[name="password"]', "alsultain22");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    // Open the first project on the list.
    await page.goto(`${BASE_URL}/projects`);
    await page.click("a:has-text('Open')");

    // Set next renewal date 13 days from today, monthly cadence.
    const in13 = new Date();
    in13.setUTCDate(in13.getUTCDate() + 13);
    const iso = in13.toISOString().slice(0, 10);

    await page.fill('input[name="cycle_length_months"]', "1");
    await page.fill('input[name="next_renewal_date"]', iso);
    await page.click("button:has-text('حفظ الجدول')");
    await expect(page.locator("text=تم تحديث جدول التجديد")).toBeVisible();

    // Badge appears on the detail page header.
    await expect(page.locator("text=/تجديد خلال \\d+ يوم/")).toBeVisible();

    // Badge also surfaces on the projects list.
    await page.goto(`${BASE_URL}/projects`);
    await expect(page.locator("text=/تجديد خلال \\d+ يوم/").first()).toBeVisible();

    // Start a new cycle.
    await page.click("a:has-text('Open')");
    await page.click("button:has-text('بدء دورة تجديد جديدة')");
    await expect(page.locator("text=/بدأت الدورة رقم/")).toBeVisible();
    await expect(page.locator("text=#1")).toBeVisible();
  });
});
