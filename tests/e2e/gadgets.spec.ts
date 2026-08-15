import { expect, test, type Page } from '@playwright/test';

async function addGadget(page: Page, title: string, value: number) {
  const previousCount = await page.locator('.tile').count();
  await page.locator('#tile-title').fill(title);
  await page.locator('#arguments').fill(JSON.stringify({ title, value, unit: 'req/min' }));
  await page.locator('#add').click();
  await expect(page.locator('.tile')).toHaveCount(previousCount + 1);
}

async function gadgetColumns(page: Page, index: number) {
  return page.locator('.tile').nth(index).evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--gadget-columns').trim(),
  );
}

test('discovers, lays out, parameterizes, and restores MCP App gadgets', async ({ page }) => {
  await page.goto('/');
  await page.locator('#server-url').fill('http://demo-mcp-app:3001/mcp');
  await page.locator('#connect').click();
  await expect(page.locator('#status')).toContainText('Discovered 1 MCP App tool');

  await addGadget(page, 'API requests', 1284);
  await addGadget(page, 'Background jobs', 73);
  await expect(page.locator('.tile')).toHaveCount(2);

  const firstView = page.locator('.tile').nth(0).frameLocator('iframe').frameLocator('iframe');
  const secondView = page.locator('.tile').nth(1).frameLocator('iframe').frameLocator('iframe');
  await expect(firstView.locator('#title')).toHaveText('API requests');
  await expect(firstView.locator('#value')).toHaveText('1284');
  await expect(secondView.locator('#title')).toHaveText('Background jobs');
  await expect(secondView.locator('#value')).toHaveText('73');

  const firstTile = page.locator('.tile').first();
  const resizeHandle = firstTile.locator('.resize-handle');
  const box = await resizeHandle.boundingBox();
  if (!box) throw new Error('Resize handle is not visible.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => gadgetColumns(page, 0)).not.toBe('6');
  const resizedColumns = await gadgetColumns(page, 0);

  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(2);
  await expect(page.locator('#status')).toContainText('Restored 2 gadget');
  await expect(page.locator('.tile h2')).toHaveText(['API requests', 'Background jobs']);
  await expect.poll(() => gadgetColumns(page, 0)).toBe(resizedColumns);
});
