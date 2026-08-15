import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const directory = path.dirname(fileURLToPath(import.meta.url));
const resourceUri = "ui://mcp-app-gadgets/demo-card.html";

export function createServer() {
  const server = new McpServer({
    name: "mcp-app-gadgets-demo",
    version: "0.1.0",
  });

  registerAppTool(
    server,
    "render-metric",
    {
      title: "Metric card",
      description: "Render a configurable metric card as an MCP App.",
      inputSchema: {
        title: z.string().default("Metric"),
        value: z.union([z.string(), z.number()]),
        unit: z.string().optional(),
      },
      _meta: { ui: { resourceUri } },
    },
    ({ title, value, unit }) => ({
      content: [
        {
          type: "text",
          text: `${title}: ${value}${unit ? ` ${unit}` : ""}`,
        },
      ],
      structuredContent: { title, value, unit: unit ?? "" },
    }),
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await fs.readFile(
            path.join(directory, "dist", "app.html"),
            "utf8",
          ),
        },
      ],
    }),
  );

  return server;
}
