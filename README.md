# MCP App Gadgets

Experimental web host for composing dashboards from independently deployed [MCP Apps](https://github.com/modelcontextprotocol/ext-apps).

The hypothesis is deliberately small: the host should own **composition and layout**, while each tile is supplied by an MCP Apps server. Adding a new tile type should therefore mean deploying another MCP Apps server, not adding another bespoke UI integration to this repository.

## Experiment

A gadget is conceptually:

```json
{
  "serverUrl": "http://localhost:3001/mcp",
  "toolName": "render-metric",
  "arguments": {
    "title": "Requests",
    "value": 1284,
    "unit": "/ min"
  },
  "title": "Traffic"
}
```

The browser host connects to the MCP server over Streamable HTTP, discovers tools that declare MCP App UI resources, invokes the selected tool with tile-specific arguments, reads the `ui://` resource, and mounts it through the MCP Apps host bridge.

See [`docs/experiment.md`](docs/experiment.md) for scope, architecture, security boundaries, and follow-up experiments.

## Run with Docker Compose

```bash
docker compose up --build
```

Then open <http://localhost:8080>.

The included demo MCP Apps server is exposed at `http://localhost:3001/mcp`. Click **Discover apps**, select the metric-card tool, edit its JSON arguments, and add multiple gadgets with different parameters.

## Packages

- `packages/gadget-host`: generic browser-based MCP Apps gadget composer.
- `packages/demo-mcp-app`: isolated parameterized MCP Apps HTTP server used to prove the composition model.
- `packages/common`: shared package from the repository template; currently not needed by the experiment.

## Development

Prerequisites are Node.js 22+, pnpm 11, and Corepack.

```bash
corepack enable
pnpm install
pnpm --filter @mcp-app-gadgets/host dev
```

In another shell:

```bash
pnpm --filter @mcp-app-gadgets/demo-mcp-app build
pnpm --filter @mcp-app-gadgets/demo-mcp-app start
```

## Security status

This is an experiment, not a production host. The current tile iframe uses a restrictive sandbox sufficient for evaluating the composition model, but production should adopt the MCP Apps reference host's double-iframe sandbox proxy, CSP and permissions enforcement, strict origin checks, endpoint trust policy, authentication/token delegation, SSRF controls, audit logging, and network egress policy.

Do not connect the experiment to untrusted MCP endpoints with sensitive credentials or data.

## License

Apache-2.0
