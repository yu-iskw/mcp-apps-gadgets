# MCP App Gadgets

Experimental web host for composing workspaces from independently deployed [MCP Apps](https://github.com/modelcontextprotocol/ext-apps).

The hypothesis is deliberately small: the host should own **composition, layout, and server connections**, while each tile is supplied by an MCP Apps server. Adding a new tile type should therefore mean deploying another MCP Apps server, not adding another bespoke UI integration to this repository.

## Experiment

The persisted workspace now separates reusable MCP server connections from gadgets:

```json
{
  "version": 2,
  "connections": [
    {
      "id": "demo-connection",
      "serverUrl": "http://localhost:3001/mcp",
      "displayName": "localhost:3001",
      "trust": "trusted",
      "auth": { "type": "none" }
    }
  ],
  "gadgets": [
    {
      "id": "traffic",
      "connectionId": "demo-connection",
      "toolName": "render-metric",
      "arguments": {
        "title": "Requests",
        "value": 1284,
        "unit": "/ min"
      },
      "title": "Traffic",
      "layout": { "columns": 6 }
    }
  ]
}
```

The browser host keeps workspace configuration, not MCP results. On load it reconnects to each configured MCP server, rediscovers tools, invokes them with saved arguments, reads the current `ui://` resources, and mounts the apps through the MCP Apps host bridge.

Multiple gadgets can share one connection and therefore one authenticated MCP session. Existing version 1 workspaces that stored `serverUrl` directly on each gadget are migrated to version 2 on load.

OAuth client registration data, access tokens, refresh tokens, PKCE verifiers, and OAuth state are session-local browser credentials and are deliberately excluded from workspace export.

See [`docs/experiment.md`](docs/experiment.md) for architecture, security boundaries, and follow-up experiments.

## Run with Docker Compose

```bash
docker compose up --build
```

Then open `http://localhost:8080`.

Two independently deployed MCP Apps servers are included:

- `http://localhost:3001/mcp`: unauthenticated metric-card demo.
- `http://localhost:3002/mcp`: OAuth-protected metric-card demo with PKCE and dynamic client registration for exercising the MCP OAuth flow.

Enter an endpoint, choose its authentication mode, and click **Trust & discover apps**. The explicit action creates or reuses a trusted connection. After discovery, select a tool and add multiple gadgets with different parameters.

The host container serves two origins:

- `http://localhost:8080`: gadget host.
- `http://localhost:8081`: isolated MCP Apps sandbox proxy with CSP delivered through response headers.

## End-to-end test

The Playwright suite exercises the real Docker Compose topology. It verifies anonymous workspace lifecycle and migration as well as an OAuth flow where two protected gadgets share one authenticated connection while credentials remain outside persisted workspace JSON.

```bash
docker compose up -d --build gadget-host demo-mcp-app oauth-demo-mcp-app
docker compose --profile e2e run --rm e2e
docker compose down --volumes --remove-orphans
```

The same scenarios run in `.github/workflows/e2e.yml`.

## Packages

- `packages/gadget-host`: generic browser-based MCP Apps workspace host, MCP connection manager, OAuth client, and isolated sandbox proxy.
- `packages/demo-mcp-app`: unauthenticated parameterized MCP Apps HTTP server.
- `packages/oauth-demo-mcp-app`: independently deployed OAuth-protected MCP Apps HTTP server used to prove authenticated connection reuse.
- `packages/common`: shared package from the repository template; currently not needed by the experiment.

## Development

Prerequisites are Node.js 22+, pnpm 11, and Corepack.

```bash
corepack enable
pnpm install
pnpm --filter @mcp-app-gadgets/host dev
```

For the complete sandbox and OAuth path, prefer Docker Compose because the production-shaped host requires separate host/sandbox origins and the demo authorization server runs independently.

## Security status

The experiment follows the MCP Apps reference host's **double-iframe isolation shape**: the host embeds a sandbox proxy from a different origin, the proxy validates the embedding origin, the View is placed in an inner sandboxed iframe, requested permissions are translated into the iframe Permission Policy, and resource CSP metadata is translated into an HTTP `Content-Security-Policy` header.

OAuth support is intentionally experimental. Credentials are kept in `sessionStorage`, which prevents them from entering exported or long-lived workspace state but is not a production token vault and remains accessible to same-origin JavaScript. The bundled OAuth server auto-approves authorization requests for deterministic local E2E testing and must not be treated as a production authorization server.

Before accepting arbitrary third-party MCP endpoints with sensitive credentials or data, add endpoint registration/allowlisting policy, durable server-side credential isolation where appropriate, SSRF protection for any server-side fetch path, audit logging, network egress controls, quotas/timeouts/cancellation, and stricter deployment-specific origin policy.

## License

Apache-2.0
