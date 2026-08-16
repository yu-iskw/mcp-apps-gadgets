import { expect, test, type Page } from '@playwright/test';

async function addGadget(
  page: Page,
  title: string,
  value: number,
  extraArguments: Record<string, unknown> = {},
) {
  const previousCount = await page.locator('.tile').count();
  await page.locator('#tile-title').fill(title);
  await page
    .locator('#arguments')
    .fill(JSON.stringify({ title, value, unit: 'req/min', ...extraArguments }));
  await page.locator('#add').click();
  await expect(page.locator('.tile')).toHaveCount(previousCount + 1);
}

async function gadgetColumns(page: Page, index: number) {
  return page
    .locator('.tile')
    .nth(index)
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--gadget-columns').trim());
}

test('manages, refreshes, and restores an MCP App gadget workspace', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('#server-url').fill('http://demo-mcp-app:3001/mcp');
  await page.locator('#connect').click();
  await expect(page.locator('#status')).toContainText('Discovered 1 MCP App tool');

  await addGadget(page, 'API requests', 1284);
  await addGadget(page, 'Background jobs', 73);
  await addGadget(page, 'Open requests', 0, { refreshPolicy: 'on-open' });
  await addGadget(page, 'Live requests', 0, { refreshPolicy: 'live' });
  await expect(page.locator('.tile')).toHaveCount(4);
  await expect(page.locator('.gadget-state')).toHaveText(['Ready', 'Ready', 'Ready', 'Ready']);

  const firstView = page.locator('.tile').nth(0).frameLocator('iframe').frameLocator('iframe');
  const secondView = page.locator('.tile').nth(1).frameLocator('iframe').frameLocator('iframe');
  const openView = page.locator('.tile').nth(2).frameLocator('iframe').frameLocator('iframe');
  const liveView = page.locator('.tile').nth(3).frameLocator('iframe').frameLocator('iframe');
  await expect(firstView.locator('#title')).toHaveText('API requests');
  await expect(firstView.locator('#value')).toHaveText('1284');
  await expect(secondView.locator('#title')).toHaveText('Background jobs');
  await expect(secondView.locator('#value')).toHaveText('73');
  await expect(openView.locator('#value')).toHaveText('1284');
  await expect(liveView.locator('#value')).toHaveText('1284');

  const metricUpdate = await request.post('http://demo-mcp-app:3001/demo/metric', {
    data: { value: 4321 },
  });
  expect(metricUpdate.ok()).toBe(true);

  // Live policy: resource invalidation causes a targeted refresh while the
  // gadget is open. On-open policy: the currently mounted result remains
  // stable until the gadget is opened/restored again.
  await expect(liveView.locator('#value')).toHaveText('4321');
  await expect(openView.locator('#value')).toHaveText('1284');
  await expect(firstView.locator('#value')).toHaveText('1284');
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

  await firstTile.locator('.duplicate').click();
  await expect(page.locator('.tile')).toHaveCount(5);
  await expect(page.locator('.tile h2')).toHaveText([
    'API requests',
    'API requests copy',
    'Background jobs',
    'Open requests',
    'Live requests',
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
    'Open requests',
    'Live requests',
  ]);
  const workersView = page.locator('.tile').nth(2).frameLocator('iframe').frameLocator('iframe');
  await expect(workersView.locator('#value')).toHaveText('99');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-workspace').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mcp-app-gadgets-workspace.json');

  await page.reload();
  await expect(page.locator('.tile')).toHaveCount(5);
  await expect(page.locator('#status')).toContainText('Restored 5 gadget');
  await expect(page.locator('.tile h2')).toHaveText([
    'API requests',
    'API requests copy',
    'Workers',
    'Open requests',
    'Live requests',
  ]);
  await expect.poll(() => gadgetColumns(page, 0)).toBe(resizedColumns);

  // Opening/restoring always invokes the MCP tool again. Both policies now
  // observe the authoritative 4321 value even though the on-open tile ignored
  // the background invalidation while it was already mounted.
  const restoredOpenView = page
    .locator('.tile')
    .nth(3)
    .frameLocator('iframe')
    .frameLocator('iframe');
  const restoredLiveView = page
    .locator('.tile')
    .nth(4)
    .frameLocator('iframe')
    .frameLocator('iframe');
  await expect(restoredOpenView.locator('#value')).toHaveText('4321');
  await expect(restoredLiveView.locator('#value')).toHaveText('4321');

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
