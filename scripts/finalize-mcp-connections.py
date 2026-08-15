from pathlib import Path

# main.ts: fix migration/import semantics, OAuth state validation, and expose logout lifecycle.
p = Path('packages/gadget-host/src/main.ts')
s = p.read_text()
s = s.replace('const gadgets = parsed.gadgets.flatMap((value, index) => {', 'const gadgets = parsed.gadgets.flatMap((value) => {')
s = s.replace("const connectButton = document.querySelector<HTMLButtonElement>('#connect')!;", "const connectButton = document.querySelector<HTMLButtonElement>('#connect')!;\nconst clearOAuthButton = document.querySelector<HTMLButtonElement>('#clear-oauth')!;")
s = s.replace(
"""    if (provider && callback?.connectionId === config.id) {
      await transport.finishAuth(callback.code);
      clearOAuthCallback();
    }""",
"""    if (provider && callback?.connectionId === config.id) {
      if (!callback.state || callback.state !== provider.state()) {
        throw new Error('OAuth state validation failed.');
      }
      await transport.finishAuth(callback.code);
      provider.clearAuthorizationState();
      clearOAuthCallback();
    }""",
)
s = s.replace(
"""      const imported = parseDocument(raw);
      gadgetDocument.gadgets.splice(0, gadgetDocument.gadgets.length, ...imported.gadgets);""",
"""      const imported = parseDocument(raw);
      gadgetDocument.connections.splice(
        0,
        gadgetDocument.connections.length,
        ...imported.connections,
      );
      gadgetDocument.gadgets.splice(0, gadgetDocument.gadgets.length, ...imported.gadgets);""",
)
needle = """connectButton.addEventListener('click', () => {
  void discoverApps();
});
"""
replacement = needle + """
clearOAuthButton.addEventListener('click', () => {
  const connectionId = selectedConnectionId;
  if (!connectionId) {
    setStatus('Select an OAuth connection first.');
    return;
  }
  const config = connectionById(connectionId);
  if (config.auth.type !== 'oauth') {
    setStatus(`${config.displayName} does not use OAuth.`);
    return;
  }
  runtimeConnections.delete(config.id);
  new BrowserOAuthProvider(config.id, config.serverUrl).logout();
  setStatus(`Cleared OAuth session for ${config.displayName}.`);
});
"""
if needle not in s:
    raise SystemExit('connect button block not found')
s = s.replace(needle, replacement)
p.write_text(s)

# UI: explicit OAuth logout/credential clearing action.
p = Path('packages/gadget-host/index.html')
s = p.read_text()
s = s.replace(
    '<button id="connect" type="button">Trust & discover apps</button>',
    '<button id="connect" type="button">Trust & discover apps</button>\n        <button id="clear-oauth" type="button">Clear OAuth session</button>',
)
p.write_text(s)

# Playwright: OAuth requires WebCrypto; production must be HTTPS. Treat only the Compose host as secure in Chromium E2E.
p = Path('tests/e2e/playwright.config.ts')
s = p.read_text()
s = s.replace(
"""    browserName: 'chromium',
  },""",
"""    browserName: 'chromium',
    launchOptions: {
      args: ['--unsafely-treat-insecure-origin-as-secure=http://gadget-host:8080'],
    },
  },""",
)
p.write_text(s)

# Make resize persistence assertion deterministic by moving relative to the exact pointer-down position.
p = Path('tests/e2e/gadgets.spec.ts')
s = p.read_text()
s = s.replace(
"""  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => gadgetColumns(page, 0)).not.toBe('6');""",
"""  const pointerX = box.x + box.width / 2;
  const pointerY = box.y + box.height / 2;
  await page.mouse.move(pointerX, pointerY);
  await page.mouse.down();
  await page.mouse.move(pointerX + 500, pointerY, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#status')).toContainText('Saved API requests layout');
  await expect.poll(() => gadgetColumns(page, 0)).not.toBe('6');""",
)
p.write_text(s)
