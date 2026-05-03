// Playwright contract — Task Followers (phase T3).
//
// Marked as a contract: the runner is not yet wired at the repo root
// (T0 carry-over). The QA agent should run this once Playwright is
// installed. The flow exercises both the visibility branch shipped in
// migration 0023 (followers see the task via tasks_select) and the
// permission gate around add/remove.

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe("task followers", () => {
  test("specialist adds agent as follower → agent sees task", async ({
    page,
  }) => {
    // Specialist logs in, opens an existing task they own.
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "specialist-seed@agency.com");
    await page.fill('input[name="password"]', "Password!23");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    // Open the first task the specialist created. The seeded org has at
    // least one such row after the T1 + T3 migrations.
    await page.goto(`${BASE_URL}/tasks`);
    await page.click("a:has-text('عرض')");
    await expect(page.locator("text=متابعون")).toBeVisible();

    // Add a known agent as follower.
    await page.click("button:has-text('إضافة متابع')");
    await page.selectOption("select", { label: /Agent/ });
    await page.click("button:has-text('حفظ')");
    await expect(page.locator("text=تمت إضافة المتابع")).toBeVisible();

    // Re-login as the agent and confirm they can now read the same task.
    const taskUrl = page.url();
    await page.goto(`${BASE_URL}/logout`);
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "agent-seed@agency.com");
    await page.fill('input[name="password"]', "Password!23");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    await page.goto(taskUrl);
    // The follower should land on the task detail (the RLS branch from
    // 0023 grants visibility), not the dashboard redirect.
    await expect(page.locator("text=متابعون")).toBeVisible();
  });

  test("non-creator/non-admin cannot add followers", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="email"]', "agent-seed@agency.com");
    await page.fill('input[name="password"]', "Password!23");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");

    await page.goto(`${BASE_URL}/tasks`);
    await page.click("a:has-text('عرض')");
    await expect(page.locator("text=متابعون")).toBeVisible();
    // The picker should not render for an agent who is neither the
    // task creator nor a holder of task.view_all / task.manage_followers.
    await expect(page.locator("button:has-text('إضافة متابع')")).toHaveCount(0);
  });
});
