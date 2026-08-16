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
    version: '0.3.0',
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
        refreshPolicy: z.enum(['on-open', 'live', 'manual']).optional(),
      }),
      _meta: { ui: { resourceUri } },
    },
    ({ title, value, unit, live, refreshPolicy }) => {
      // `live` is kept for compatibility with earlier saved demo workspaces.
      const effectivePolicy = refreshPolicy ?? (live ? 'live' : undefined);
      const readsAuthoritativeMetric = effectivePolicy !== undefined;
      const renderedValue = readsAuthoritativeMetric ? liveMetricValue : value;
      if (renderedValue === undefined) {
        throw new Error('value is required unless a refreshPolicy is configured');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `${title}: ${renderedValue}${unit ? ` ${unit}` : ''}`,
          },
        ],
        structuredContent: {
          title,
          value: renderedValue,
          unit: unit ?? '',
          refreshPolicy: effectivePolicy ?? 'static',
        },
        // Opening/restoring a gadget always calls the tool, so on-open and
        // manual policies get authoritative state without background events.
        // Live is the only policy that advertises an observable dependency.
        _meta:
          effectivePolicy === 'live'
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
    (uri) => ({
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
