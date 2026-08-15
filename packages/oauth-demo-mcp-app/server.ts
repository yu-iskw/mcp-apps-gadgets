import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const directory = path.dirname(fileURLToPath(import.meta.url));
const resourceUri = 'ui://mcp-app-gadgets/protected-card.html';

export function createServer() {
  const server = new McpServer({ name: 'mcp-app-gadgets-oauth-demo', version: '0.1.0' });
  registerAppTool(
    server,
    'render-protected-metric',
    {
      title: 'Protected metric card',
      description: 'Render an OAuth-protected metric card as an MCP App.',
      inputSchema: { title: z.string().default('Protected metric'), value: z.union([z.string(), z.number()]) },
      _meta: { ui: { resourceUri } },
    },
    ({ title, value }) => ({
      content: [{ type: 'text', text: `${title}: ${value}` }],
      structuredContent: { title, value },
    }),
  );
  registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: await fs.readFile(path.join(directory, 'dist', 'app.html'), 'utf8') }],
  }));
  return server;
}
