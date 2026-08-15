import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const directory = path.dirname(fileURLToPath(import.meta.url));
const resourceUri = 'ui://mcp-app-gadgets/demo-card.html';
export const liveMetricUri = 'gadget://mcp-app-gadgets/demo-metric';

let liveMetricValue: string | number = 1284;

export function setLiveMetricValue(value: string | number) {
  liveMetricValue = value;
}

export function getLiveMetricValue() {
  return liveMetricValue;
}

export function createServer() {
  const server = new McpServer({
    name: 'mcp-app-gadgets-demo',
    version: '0.2.0',
  });

  server.registerTool(
    'render-metric',
    {
      title: 'Metric card',
      description: 'Render a configurable metric card as an MCP App.',
      inputSchema: z.object({
        title: z.string().default('Metric'),
        value: z.union([z.string(), z.number()]).optional(),
        unit: z.string().optional(),
        live: z.boolean().optional(),
      }),
      _meta: { ui: { resourceUri } },
    },
    async ({ title, value, unit, live }) => {
      const renderedValue = live ? liveMetricValue : value;
      if (renderedValue === undefined) {
        throw new Error('value is required unless live=true');
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `${title}: ${renderedValue}${unit ? ` ${unit}` : ''}`,
          },
        ],
        structuredContent: { title, value: renderedValue, unit: unit ?? '' },
        _meta: live
          ? {
              'io.mcp-app-gadgets/dependencies': {
                resources: [liveMetricUri],
              },
            }
          : undefined,
      };
    },
  );

  server.registerResource(
    'demo-card',
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: await fs.readFile(path.join(directory, 'dist', 'app.html'), 'utf8'),
        },
      ],
    }),
  );

  server.registerResource(
    'live-demo-metric',
    liveMetricUri,
    {
      title: 'Live demo metric',
      description: 'Mutable metric used to verify MCP v2 resource subscriptions.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({ value: liveMetricValue }),
        },
      ],
    }),
  );

  return server;
}
