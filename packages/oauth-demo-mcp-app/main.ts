import crypto from 'node:crypto';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors from 'cors';
import { json, urlencoded } from 'express';

import { createServer } from './server.js';

import type { Request, Response } from 'express';

interface RegistrationBody {
  redirect_uris?: unknown;
}

interface TokenBody {
  grant_type?: unknown;
  code?: unknown;
  code_verifier?: unknown;
  redirect_uri?: unknown;
  client_id?: unknown;
  refresh_token?: unknown;
}

type RegistrationRequest = Request<Record<string, never>, unknown, RegistrationBody>;
type TokenRequest = Request<Record<string, never>, unknown, TokenBody>;

const port = Number(process.env.PORT ?? 3002);
const app = createMcpExpressApp({ host: '0.0.0.0' });
const authorizationCodes = new Map<
  string,
  { clientId: string; redirectUri: string; challenge?: string }
>();
const accessTokens = new Set<string>();
const refreshTokens = new Set<string>();

function origin(req: Request) {
  return `${req.protocol}://${req.get('host')}`;
}

function base64urlSha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function issueTokens(res: Response) {
  const accessToken = crypto.randomUUID();
  const refreshToken = crypto.randomUUID();
  accessTokens.add(accessToken);
  refreshTokens.add(refreshToken);
  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'mcp',
  });
}

app.use(cors({ origin: true, exposedHeaders: ['WWW-Authenticate'] }));
app.use(urlencoded({ extended: false }));
app.use(json());
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
app.post('/register', (req: RegistrationRequest, res: Response) => {
  res.status(201).json({
    client_id: crypto.randomUUID(),
    redirect_uris: stringArray(req.body.redirect_uris),
    token_endpoint_auth_method: 'none',
  });
});
app.get('/authorize', (req: Request, res: Response) => {
  const clientId = stringValue(req.query.client_id);
  const redirectUri = stringValue(req.query.redirect_uri);
  const state = stringValue(req.query.state);
  const challenge = stringValue(req.query.code_challenge) || undefined;
  if (!clientId || !redirectUri) {
    res.status(400).send('Missing OAuth client parameters');
    return;
  }
  const code = crypto.randomUUID();
  authorizationCodes.set(code, { clientId, redirectUri, challenge });
  const callback = new URL(redirectUri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);
  callback.searchParams.set('iss', origin(req));
  res.redirect(302, callback.href);
});
app.post('/token', (req: TokenRequest, res: Response) => {
  const grantType = stringValue(req.body.grant_type);
  if (grantType === 'refresh_token') {
    const refreshToken = stringValue(req.body.refresh_token);
    if (!refreshToken || !refreshTokens.delete(refreshToken)) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    issueTokens(res);
    return;
  }

  const code = stringValue(req.body.code);
  const verifier = stringValue(req.body.code_verifier);
  const redirectUri = stringValue(req.body.redirect_uri);
  const clientId = stringValue(req.body.client_id);
  const pending = authorizationCodes.get(code);
  if (!pending || pending.redirectUri !== redirectUri || pending.clientId !== clientId) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }
  if (pending.challenge && base64urlSha256(verifier) !== pending.challenge) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    return;
  }
  authorizationCodes.delete(code);
  issueTokens(res);
});

app.all('/mcp', async (req: Request, res: Response) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !accessTokens.has(token)) {
    const metadata = `${origin(req)}/.well-known/oauth-protected-resource/mcp`;
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="mcp"`);
    res.status(401).json({ error: 'invalid_token' });
    return;
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
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.listen(port, '0.0.0.0', () => console.log(`OAuth demo MCP App: http://localhost:${port}/mcp`));
