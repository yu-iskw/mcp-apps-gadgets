import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import cors from 'cors';
import express from 'express';

import { createServer, liveMetricUri, setLiveMetricValue } from './server.js';

import type { Request, Response } from 'express';

const port = Number(process.env.PORT ?? 3001);
const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: ['localhost', '127.0.0.1', 'demo-mcp-app'],
});
const handler = createMcpHandler(createServer);
const mcpHandler = toNodeHandler(handler);

app.use(cors({ origin: true }));
app.use(express.json());
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});
app.post('/demo/metric', async (req: Request, res: Response) => {
  const value: unknown = req.body?.value;
  if (typeof value !== 'string' && typeof value !== 'number') {
    res.status(400).json({ error: 'value must be a string or number' });
    return;
  }
  setLiveMetricValue(value);
  await handler.notify.resourceUpdated(liveMetricUri);
  res.status(200).json({ value });
});
app.all('/mcp', (req: Request, res: Response) => {
  void mcpHandler(req, res, req.body);
});

const httpServer = app.listen(port, '0.0.0.0', () => {
  console.log(`Demo MCP App: http://localhost:${port}/mcp`);
});

async function shutdown() {
  await handler.close();
  httpServer.close();
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
