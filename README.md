# MCP App Gadgets

Experimental web host for composing dashboards from independently deployed [MCP Apps](https://github.com/modelcontextprotocol/ext-apps).

The hypothesis is deliberately small: the host should own **composition and layout**, while each tile is supplied by an MCP Apps server. Adding a new tile type should therefore mean deploying another MCP Apps server, not adding another bespoke UI integration to this repository.

## Experiment

A persisted gadget is conceptually:

```json
{
  "id": "...",
  "serverUrl": "http://localhost:3001/mcp",
  "toolName": "render-metric",
  "arguments": {
    "title": "Requests",
    "value": 1284,
    "unit": "/ min"
  },
  "title": "Traffic",
  "layout": {}
}
```

The browser host keeps only configuration, not MCP results. On load it reconnects to each configured MCP server, rediscovers the tool, invokes it with the saved arguments, reads the `ui://` resource, and mounts the app through the MCP Apps host bridge.

Each MCP server has its own cached MCP client connection, so one gadget document can compose tiles from multiple independent servers.

### Freshness model

Saved gadgets persist **query/application intent, not analytical result snapshots**. Every time a workspace is opened or restored, the host invokes each saved MCP tool again, so KPI, chart, table, or other artifact results can be recomputed from the server's current authoritative state.

The recommended runtime model is:

```text
open gadget
  -> tools/call for authoritative current state
  -> render MCP App
  -> optionally subscribe to declared resource dependencies
  -> selectively re-call the tool when those resources change
```

The demo tool accepts a `refreshPolicy` argument to exercise three useful policies:

- `on-open`: read authoritative server state whenever the gadget is opened/restored, with no background subscription.
- `live`: do the same initial authoritative read, then declare MCP v2 resource dependencies so the host refreshes the tile while it remains open.
- `manual`: do the initial authoritative read but do not opt into background invalidation; subsequent refreshes are user/client initiated.

For compatibility, the demo's older `live: true` argument is treated as `refreshPolicy: "live"`.

A generic MCP Apps server opts into host-managed live refresh by returning resource dependencies in its tool result metadata:

```json
{
  "_meta": {
    "io.mcp-app-gadgets/dependencies": {
      "resources": ["gadget://example/kpi/revenue"]
    }
  }
}
```

The host aggregates dependencies per MCP server and uses MCP v2 `subscriptions/listen`. A `notifications/resources/updated` event invalidates only gadgets depending on that resource. Subscriptions are therefore an optimization for **while-open freshness**; they are not the source of truth for initial state.

See [`docs/experiment.md`](docs/experiment.md) for scope, architecture, security boundaries, and follow-up experiments.

## Run with Docker Compose

```bash
docker compose up --build
```

Then open `http://localhost:8080`.

The included demo MCP Apps server is exposed at `http://localhost:3001/mcp`. Click **Discover apps**, select the metric-card tool, edit its JSON arguments, and add multiple gadgets with different parameters. Gadget configuration is persisted in browser `localStorage` and restored after reload.

The host container serves two origins:

- `http://localhost:8080`: gadget host.
- `http://localhost:8081`: isolated MCP Apps sandbox proxy with CSP delivered through response headers.

## End-to-end test

The Playwright test runs the real Docker Compose topology and verifies discovery, independently parameterized MCP App tiles, the nested sandbox/View rendering path, workspace lifecycle operations, and both freshness modes:

- a `live` KPI refreshes after a server-side resource update without a browser reload;
- an `on-open` KPI intentionally remains stable while mounted, then fetches the new authoritative value after the workspace is reopened/restored.

```bash
docker compose up -d --build gadget-host demo-mcp-app
docker compose --profile e2e run --rm e2e
docker compose down --volumes --remove-orphans
```

The same scenario runs in `.github/workflows/e2e.yml`.

## Packages

- `packages/gadget-host`: generic browser-based MCP Apps gadget composer and isolated sandbox proxy.
- `packages/demo-mcp-app`: isolated parameterized MCP Apps HTTP server used to prove the composition model.
- `packages/common`: shared package from the repository template; currently not needed by the experiment.

## Development

Prerequisites are Node.js 22+, pnpm 11, and Corepack.

```bash
corepack enable
pnpm install
pnpm --filter @mcp-app-gadgets/host dev
```

For the complete sandbox path, prefer Docker Compose because the production-shaped host requires separate origins on ports 8080 and 8081.

## Security status

The experiment now follows the MCP Apps reference host's **double-iframe isolation shape**: the host embeds a sandbox proxy from a different origin, the proxy validates the embedding origin, the View is placed in an inner sandboxed iframe, requested permissions are translated into the iframe Permission Policy, and resource CSP metadata is translated into an HTTP `Content-Security-Policy` header.

This is still not a production multi-tenant trust boundary. Before accepting arbitrary third-party MCP endpoints with sensitive credentials or data, add endpoint trust/allowlisting, authentication and token delegation, SSRF protection for any server-side fetch path, audit logging, secret isolation, network egress controls, and stricter deployment-specific origin configuration.

## License

Apache-2.0
