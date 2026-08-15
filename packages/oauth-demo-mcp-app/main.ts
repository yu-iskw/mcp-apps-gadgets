import crypto from 'node:crypto';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import express from 'express';

import { createServer } from './server.js';

import type { Request, Response } from 'express';

const port = Number(process.env.PORT ?? 3002);
const app = createMcpExpressApp({ host: '0.0.0.0' });
const authorizationCodes = new Map<
  string,
  { clientId: string; redirectUri: string; challenge?: string }
>();
const accessTokens = new Set<string>();

function origin(req: Request) {
  return `${req.protocol}://${req.get('host')}`;
}

function base64urlSha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

app.use(cors({ origin: true, exposedHeaders: ['WWW-Authenticate'] }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.get('/health', (_req: Request, res: Response) => res.status(200).json({ status: 'ok' }));

app.get('/.well-known/oauth-protected-resource/mcp', (req: Request, res: Response) => {
  const base = origin(req);
  res.json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['mcp'] });
});
app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
  const base = origin(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  });
});
app.post('/register', (req: Request, res: Response) => {
  const redirectUris = Array.isArray(req.body?.redirect_uris) ? req.body.redirect_uris : [];
  res.status(201).json({
    client_id: crypto.randomUUID(),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
  });
});
app.get('/authorize', (req: Request, res: Response) => {
  const clientId = String(req.query.client_id ?? '');
  const redirectUri = String(req.query.redirect_uri ?? '');
  const state = String(req.query.state ?? '');
  const challenge =
    typeof req.query.code_challenge === 'string' ? req.query.code_challenge : undefined;
  if (!clientId || !redirectUri)
    return void res.status(400).send('Missing OAuth client parameters');
  const code = crypto.randomUUID();
  authorizationCodes.set(code, { clientId, redirectUri, challenge });
  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  callback.searchParams.set('iss', origin(req));
  res.redirect(302, callback.href);
});
app.post('/token', (req: Request, res: Response) => {
  if (req.body?.grant_type === 'refresh_token') {
    const token = crypto.randomUUID();
    accessTokens.add(token);
    return void res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp',
    });
  }
  const code = String(req.body?.code ?? '');
  const verifier = String(req.body?.code_verifier ?? '');
  const pending = authorizationCodes.get(code);
  if (!pending || pending.redirectUri !== String(req.body?.redirect_uri ?? '')) {
    return void res.status(400).json({ error: 'invalid_grant' });
  }
  if (pending.challenge && base64urlSha256(verifier) !== pending.challenge) {
    return void res
      .status(400)
      .json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
  }
  authorizationCodes.delete(code);
  const token = crypto.randomUUID();
  accessTokens.add(token);
  res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600, scope: 'mcp' });
});

app.all('/mcp', async (req: Request, res: Response) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !accessTokens.has(token)) {
    const metadata = `${origin(req)}/.well-known/oauth-protected-resource/mcp`;
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="mcp"`);
    return void res.status(401).json({ error: 'invalid_token' });
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent)
      res
        .status(500)
        .json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
  }
});

app.listen(port, '0.0.0.0', () => console.log(`OAuth demo MCP App: http://localhost:${port}/mcp`));
