import { expect, test, type Page } from '@playwright/test';

async function addGadget(page: Page, title: string, value: number) {
  const previousCount = await page.locator('.tile').count();
  await page.locator('#tile-title').fill(title);
  await page.locator('#arguments').fill(JSON.stringify({ title, value, unit: 'req/min' }));
  await page.locator('#add').click();
  await expect(page.locator('.tile')).toHaveCount(previousCount + 1);
}

async function gadgetColumns(page: Page, index: number) {
  return page
    .locator('.tile')
    .nth(index)
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--gadget-columns').trim());
}

test('manages and restores an MCP App gadget workspace', async ({ page }) => {
  await page.goto('/');
  await page.locator('#server-url').fill('http://demo-mcp-app:3001/mcp');
  await page.locator('#connect').click();
  await expect(page.locator('#status')).toContainText('Discovered 1 MCP App tool');

  await addGadget(page, 'API requests', 1284);
  await addGadget(page, 'Background jobs', 73);
  await expect(page.locator('.tile')).toHaveCount(2);
  await expect(page.locator('.gadget-state')).toHaveText(['Ready', 'Ready']);

  const firstView = page.locator('.tile').nth(0).frameLocator('iframe').frameLocator('iframe');
  const secondView = page.locator('.tile').nth(1).frameLocator('iframe').frameLocator('iframe');
  await expect(firstView.locator('#title')).toHaveText('API requests');
  await expect(firstView.locator('#value')).toHaveText('1284');
  await expect(secondView.locator('#title')).toHaveText('Background jobs');
  await expect(secondView.locator('#value')).toHaveText('73');

  // Pointer-drag behavior is intentionally outside this integration test: browser pointer-capture
  // behavior is timing-sensitive in headless containers. We still verify persisted/default layout
  // restoration here and explicit imported layout values below.
  const restoredColumns = await gadgetColumns(page, 0);

  const firstTile = page.locator('.tile').first();
  await firstTile.locator('.duplicate').click();
  await expect(page.locator('.tile')).toHaveCount(3);
  await expect(page.locator('.tile h2')).toHaveText([
    'API requests',
    'API requests copy',
    'Background jobs',
  ]);

  const jobsTile = page.locator('.tile').filter({ hasText: 'Background jobs' });
  await jobsTile.locator('.edit').click();
  await expect(page.locator('#add')).toHaveText('Save changes');
  await page.locator('#tile-title').fill('Workers');
  await page
    .locator('#arguments')
    .fill(JSON.stringify({ title: 'Workers', value: 99, unit: 'req/min' }));
  await page.locator('#add').click();
  await expect(page.locator('.tile h2')).toHaveText([
    'API requests',
    'API requests copy',
    'Workers',
  ]);
  const workersView = page.locator('.tile').nth(2).frameLocator('iframe').frameLocator('iframe');
  await expect(workersView.locator('#value')).toHaveText('99');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-workspace').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mcp-app-gadgets-workspace.json');

  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(3);
  await expect(page.locator('#status')).toContainText('Restored 3 gadget');
  await expect(page.locator('.tile h2')).toHaveText([
    'API requests',
    'API requests copy',
    'Workers',
  ]);
  await expect.poll(() => gadgetColumns(page, 0)).toBe(restoredColumns);

  const importedWorkspace = {
    version: 1,
    gadgets: [
      {
        id: 'imported-metric',
        serverUrl: 'http://demo-mcp-app:3001/mcp',
        toolName: 'render-metric',
        title: 'Imported metric',
        arguments: { title: 'Imported metric', value: 42, unit: 'req/min' },
        layout: { columns: 12, height: 220 },
      },
    ],
  };
  await page.locator('#import-file').setInputFiles({
    name: 'workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedWorkspace)),
  });
  await expect(page.locator('#status')).toContainText('Imported 1 gadget');
  await expect(page.locator('.tile')).toHaveCount(1);
  await expect(page.locator('.tile h2')).toHaveText(['Imported metric']);
  await expect.poll(() => gadgetColumns(page, 0)).toBe('12');
  const importedView = page.locator('.tile').first().frameLocator('iframe').frameLocator('iframe');
  await expect(importedView.locator('#value')).toHaveText('42');
});

test('reuses one OAuth connection across multiple MCP App gadgets', async ({ page }) => {
  await page.goto('/');
  await page.locator('#server-url').fill('http://oauth-demo-mcp-app:3002/mcp');
  await page.locator('#auth-mode').selectOption('oauth');
  await page.locator('#connect').click();

  await expect(page.locator('#status')).toContainText('Discovered 1 MCP App tool');
  await page.locator('#tile-title').fill('Protected revenue');
  await page.locator('#arguments').fill(JSON.stringify({ title: 'Protected revenue', value: 101 }));
  await page.locator('#add').click();
  await expect(page.locator('.gadget-state')).toHaveText(['Ready']);

  await page.locator('#tile-title').fill('Protected orders');
  await page.locator('#arguments').fill(JSON.stringify({ title: 'Protected orders', value: 202 }));
  await page.locator('#add').click();
  await expect(page.locator('.gadget-state')).toHaveText(['Ready', 'Ready']);

  const firstView = page.locator('.tile').nth(0).frameLocator('iframe').frameLocator('iframe');
  const secondView = page.locator('.tile').nth(1).frameLocator('iframe').frameLocator('iframe');
  await expect(firstView.locator('#value')).toHaveText('101');
  await expect(secondView.locator('#value')).toHaveText('202');

  const document = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('mcp-app-gadgets.document.v2') ?? '{}'),
  );
  expect(document.version).toBe(2);
  expect(document.connections).toHaveLength(1);
  expect(document.gadgets).toHaveLength(2);
  expect(document.gadgets[0].connectionId).toBe(document.gadgets[1].connectionId);
  expect(JSON.stringify(document)).not.toContain('access_token');
  expect(JSON.stringify(document)).not.toContain('code_verifier');
});
