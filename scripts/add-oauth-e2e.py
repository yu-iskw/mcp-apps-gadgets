from pathlib import Path

p = Path('tests/e2e/gadgets.spec.ts')
s = p.read_text()
s += r'''

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

  const document = await page.evaluate(() => JSON.parse(localStorage.getItem('mcp-app-gadgets.document.v2') ?? '{}'));
  expect(document.version).toBe(2);
  expect(document.connections).toHaveLength(1);
  expect(document.gadgets).toHaveLength(2);
  expect(document.gadgets[0].connectionId).toBe(document.gadgets[1].connectionId);
  expect(JSON.stringify(document)).not.toContain('access_token');
  expect(JSON.stringify(document)).not.toContain('code_verifier');
});
'''
p.write_text(s)
