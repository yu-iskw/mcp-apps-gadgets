import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const PREFIX = 'mcp-app-gadgets.oauth.';

function key(connectionId: string, suffix: string) {
  return `${PREFIX}${connectionId}.${suffix}`;
}

export class BrowserOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: URL;
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    readonly connectionId: string,
    readonly serverUrl: string,
  ) {
    this.redirectUrl = new URL(window.location.origin);
    this.redirectUrl.searchParams.set('oauth_callback', '1');
    this.redirectUrl.searchParams.set('connection_id', connectionId);
    this.clientMetadata = {
      client_name: 'MCP App Gadgets',
      redirect_uris: [this.redirectUrl.href],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const value = sessionStorage.getItem(key(this.connectionId, 'client'));
    return value ? (JSON.parse(value) as OAuthClientInformationMixed) : undefined;
  }

  saveClientInformation(value: OAuthClientInformationMixed) {
    sessionStorage.setItem(key(this.connectionId, 'client'), JSON.stringify(value));
  }

  tokens(): OAuthTokens | undefined {
    const value = sessionStorage.getItem(key(this.connectionId, 'tokens'));
    return value ? (JSON.parse(value) as OAuthTokens) : undefined;
  }

  saveTokens(value: OAuthTokens) {
    sessionStorage.setItem(key(this.connectionId, 'tokens'), JSON.stringify(value));
  }

  redirectToAuthorization(url: URL) {
    window.location.assign(url.href);
  }

  saveCodeVerifier(value: string) {
    sessionStorage.setItem(key(this.connectionId, 'verifier'), value);
  }

  codeVerifier(): string {
    const value = sessionStorage.getItem(key(this.connectionId, 'verifier'));
    if (!value) throw new Error('Missing OAuth PKCE verifier.');
    return value;
  }

  state(): string {
    let value = sessionStorage.getItem(key(this.connectionId, 'state'));
    if (!value) {
      value = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
        part.toString(16).padStart(8, '0'),
      ).join('');
      sessionStorage.setItem(key(this.connectionId, 'state'), value);
    }
    return value;
  }

  clearAuthorizationState() {
    sessionStorage.removeItem(key(this.connectionId, 'state'));
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client')
      sessionStorage.removeItem(key(this.connectionId, 'client'));
    if (scope === 'all' || scope === 'tokens')
      sessionStorage.removeItem(key(this.connectionId, 'tokens'));
    if (scope === 'all' || scope === 'verifier')
      sessionStorage.removeItem(key(this.connectionId, 'verifier'));
    if (scope === 'all') this.clearAuthorizationState();
  }

  logout() {
    for (const suffix of ['client', 'tokens', 'verifier', 'state']) {
      sessionStorage.removeItem(key(this.connectionId, suffix));
    }
  }
}

export function oauthCallback():
  | { connectionId: string; code: string; state: string | undefined }
  | undefined {
  const url = new URL(window.location.href);
  if (url.searchParams.get('oauth_callback') !== '1') return undefined;
  const connectionId = url.searchParams.get('connection_id');
  const code = url.searchParams.get('code');
  if (!connectionId || !code) return undefined;
  return { connectionId, code, state: url.searchParams.get('state') ?? undefined };
}

export function clearOAuthCallback() {
  const url = new URL(window.location.href);
  for (const parameter of ['oauth_callback', 'connection_id', 'code', 'state', 'iss']) {
    url.searchParams.delete(parameter);
  }
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
