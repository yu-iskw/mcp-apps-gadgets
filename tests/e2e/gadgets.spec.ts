import { expect, test } from "@playwright/test";

async function addGadget(page, title: string, value: number) {
  await page.locator("#tile-title").fill(title);
  await page.locator("#arguments").fill(JSON.stringify({ title, value, unit: "req/min" }));
  await page.locator("#add").click();
  await expect(page.locator(".tile")).toHaveCount(await page.locator(".tile").count());
}

test("discovers, renders, parameterizes, and restores MCP App gadgets", async ({ page }) => {
  await page.goto("/");
  await page.locator("#server-url").fill("http://demo-mcp-app:3001/mcp");
  await page.locator("#connect").click();
  await expect(page.locator("#status")).toContainText("Discovered 1 MCP App tool");

  await addGadget(page, "API requests", 1284);
  await addGadget(page, "Background jobs", 73);
  await expect(page.locator(".tile")).toHaveCount(2);

  const firstView = page.locator(".tile").nth(0).frameLocator("iframe").frameLocator("iframe");
  const secondView = page.locator(".tile").nth(1).frameLocator("iframe").frameLocator("iframe");
  await expect(firstView.locator("#title")).toHaveText("Background jobs");
  await expect(firstView.locator("#value")).toHaveText("73");
  await expect(secondView.locator("#title")).toHaveText("API requests");
  await expect(secondView.locator("#value")).toHaveText("1284");

  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(2);
  await expect(page.locator("#status")).toContainText("Restored 2 gadget");
  const restoredTitles = page.locator(".tile h2");
  await expect(restoredTitles).toContainText(["API requests", "Background jobs"]);
});
