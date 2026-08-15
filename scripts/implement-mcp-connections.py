from pathlib import Path
import re

p = Path('packages/gadget-host/src/main.ts')
s = p.read_text()

s = s.replace("import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';\n", "import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';\n\nimport { BrowserOAuthProvider, clearOAuthCallback, oauthCallback } from './oauth.js';\n")
s = s.replace("const STORAGE_KEY = 'mcp-app-gadgets.document.v1';", "const STORAGE_KEY = 'mcp-app-gadgets.document.v2';\nconst LEGACY_STORAGE_KEY = 'mcp-app-gadgets.document.v1';")

s = re.sub(r"interface GadgetConfig \{.*?interface GadgetDocument \{.*?\n\}", '''type AuthMode = 'none' | 'oauth';

interface ConnectionConfig {
  id: string;
  serverUrl: string;
  displayName: string;
  trust: 'trusted';
  auth: { type: AuthMode };
}

interface GadgetConfig {
  id: string;
  connectionId: string;
  toolName: string;
  title: string;
  arguments: Record<string, unknown>;
  layout?: GadgetLayout;
}

interface GadgetDocument {
  version: 2;
  connections: ConnectionConfig[];
  gadgets: GadgetConfig[];
}''', s, count=1, flags=re.S)

start = s.index('function parseGadget(')
end = s.index('\nfunction readUiMetadata', start)
replacement = '''function parseConnection(value: unknown): ConnectionConfig | undefined {
  if (!isRecord(value) || !isRecord(value.auth)) return undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.serverUrl !== 'string' ||
    typeof value.displayName !== 'string' ||
    value.trust !== 'trusted' ||
    (value.auth.type !== 'none' && value.auth.type !== 'oauth')
  ) return undefined;
  return { id: value.id, serverUrl: value.serverUrl, displayName: value.displayName, trust: 'trusted', auth: { type: value.auth.type } };
}

function parseV2Gadget(value: unknown): GadgetConfig | undefined {
  if (!isRecord(value) || !isRecord(value.arguments)) return undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.connectionId !== 'string' ||
    typeof value.toolName !== 'string' ||
    typeof value.title !== 'string'
  ) return undefined;
  return { id: value.id, connectionId: value.connectionId, toolName: value.toolName, title: value.title, arguments: value.arguments, layout: parseLayout(value.layout) };
}

function parseDocument(raw: string): GadgetDocument {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.gadgets)) throw new Error('Unsupported gadget document');
  if (parsed.version === 2 && Array.isArray(parsed.connections)) {
    return {
      version: 2,
      connections: parsed.connections.flatMap((value) => { const item = parseConnection(value); return item ? [item] : []; }),
      gadgets: parsed.gadgets.flatMap((value) => { const item = parseV2Gadget(value); return item ? [item] : []; }),
    };
  }
  if (parsed.version === 1) {
    const connections: ConnectionConfig[] = [];
    const byUrl = new Map<string, string>();
    const gadgets = parsed.gadgets.flatMap((value, index) => {
      if (!isRecord(value) || !isRecord(value.arguments) || typeof value.serverUrl !== 'string' || typeof value.id !== 'string' || typeof value.toolName !== 'string' || typeof value.title !== 'string') return [];
      const normalized = new URL(value.serverUrl).href;
      let connectionId = byUrl.get(normalized);
      if (!connectionId) {
        connectionId = `legacy-${connections.length + 1}`;
        byUrl.set(normalized, connectionId);
        connections.push({ id: connectionId, serverUrl: normalized, displayName: new URL(normalized).host, trust: 'trusted', auth: { type: 'none' } });
      }
      return [{ id: value.id, connectionId, toolName: value.toolName, title: value.title, arguments: value.arguments, layout: parseLayout(value.layout) } satisfies GadgetConfig];
    });
    return { version: 2, connections, gadgets };
  }
  throw new Error('Unsupported gadget document');
}
'''
s = s[:start] + replacement + s[end:]

s = s.replace("const serverUrlInput = document.querySelector<HTMLInputElement>('#server-url')!;", "const serverUrlInput = document.querySelector<HTMLInputElement>('#server-url')!;\nconst authModeInput = document.querySelector<HTMLSelectElement>('#auth-mode')!;")
s = s.replace("const connections = new Map<string, Promise<ServerConnection>>();\nlet selectedServerUrl = serverUrlInput.value;", "const runtimeConnections = new Map<string, Promise<ServerConnection>>();\nlet selectedConnectionId: string | undefined;")
s = s.replace("return raw ? parseDocument(raw) : { version: 1, gadgets: [] };", "if (raw) return parseDocument(raw);\n    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);\n    return legacy ? parseDocument(legacy) : { version: 2, connections: [], gadgets: [] };")
s = s.replace("return { version: 1, gadgets: [] };", "return { version: 2, connections: [], gadgets: [] };")

needle = '''function saveDocument() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gadgetDocument));
}
'''
insert = needle + '''
function connectionById(id: string): ConnectionConfig {
  const connection = gadgetDocument.connections.find((candidate) => candidate.id === id);
  if (!connection) throw new Error(`Unknown MCP connection: ${id}`);
  return connection;
}

function ensureConnection(serverUrl: string, authMode: AuthMode): ConnectionConfig {
  const normalized = new URL(serverUrl).href;
  const existing = gadgetDocument.connections.find((candidate) => candidate.serverUrl === normalized && candidate.auth.type === authMode);
  if (existing) return existing;
  const connection: ConnectionConfig = {
    id: newGadgetId(),
    serverUrl: normalized,
    displayName: new URL(normalized).host,
    trust: 'trusted',
    auth: { type: authMode },
  };
  gadgetDocument.connections.push(connection);
  saveDocument();
  return connection;
}
'''
s = s.replace(needle, insert)

start = s.index('async function connectServer(')
end = s.index('\nasync function discoverApps', start)
replacement = '''async function connectServer(config: ConnectionConfig): Promise<ServerConnection> {
  const existing = runtimeConnections.get(config.id);
  if (existing) return existing;
  const pending = (async () => {
    const client = new Client(hostInfo);
    const provider = config.auth.type === 'oauth' ? new BrowserOAuthProvider(config.id, config.serverUrl) : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(config.serverUrl), provider ? { authProvider: provider } : undefined);
    const callback = oauthCallback();
    if (provider && callback?.connectionId === config.id) {
      await transport.finishAuth(callback.code);
      clearOAuthCallback();
    }
    await client.connect(transport);
    const [tools, resources] = await Promise.all([listAllTools(client), listAllResources(client)]);
    return { client, tools: new Map(tools.map((tool) => [tool.name, tool])), resources: new Map(resources.map((resource) => [resource.uri, resource])) };
  })().catch((error) => { runtimeConnections.delete(config.id); throw error; });
  runtimeConnections.set(config.id, pending);
  return pending;
}
'''
s = s[:start] + replacement + s[end:]

s = s.replace("selectedServerUrl = new URL(serverUrlInput.value).href;\n    const connection = await connectServer(selectedServerUrl);", "const selected = ensureConnection(serverUrlInput.value, authModeInput.value as AuthMode);\n    selectedConnectionId = selected.id;\n    const connection = await connectServer(selected);")
s = s.replace("const connection = await connectServer(selectedServerUrl);", "if (!selectedConnectionId) throw new Error('Discover an MCP connection first.');\n    const connectionConfig = connectionById(selectedConnectionId);\n    const connection = await connectServer(connectionConfig);")
s = s.replace("config.serverUrl = selectedServerUrl;", "config.connectionId = selectedConnectionId;")
s = s.replace("serverUrl: selectedServerUrl,", "connectionId: selectedConnectionId,")

old = '''  serverUrlInput.value = config.serverUrl;
  selectedServerUrl = config.serverUrl;'''
new = '''  const connection = connectionById(config.connectionId);
  serverUrlInput.value = connection.serverUrl;
  authModeInput.value = connection.auth.type;
  selectedConnectionId = connection.id;'''
s = s.replace(old, new)
s = s.replace("connections.delete(new URL(config.serverUrl).href);", "runtimeConnections.delete(config.connectionId);")

old = '''    const connection = await connectServer(config.serverUrl);
    const tool = connection.tools.get(config.toolName);
    if (!tool) {
      throw new Error(`Tool ${config.toolName} is no longer advertised by ${config.serverUrl}.`);
    }'''
new = '''    const connectionConfig = connectionById(config.connectionId);
    const connection = await connectServer(connectionConfig);
    const tool = connection.tools.get(config.toolName);
    if (!tool) {
      throw new Error(`Tool ${config.toolName} is no longer advertised by ${connectionConfig.serverUrl}.`);
    }'''
s = s.replace(old, new)

old = '''async function restoreDocument() {
  if (gadgetDocument.gadgets.length === 0) return;
  setStatus(`Restoring ${gadgetDocument.gadgets.length} gadget(s)…`);
  await rerenderDocument();
  setStatus(`Restored ${gadgetDocument.gadgets.length} gadget(s).`);
}

void restoreDocument();'''
new = '''async function restoreDocument() {
  if (gadgetDocument.gadgets.length === 0) return;
  setStatus(`Restoring ${gadgetDocument.gadgets.length} gadget(s)…`);
  await rerenderDocument();
  setStatus(`Restored ${gadgetDocument.gadgets.length} gadget(s).`);
}

async function boot() {
  const callback = oauthCallback();
  if (callback) {
    const connection = gadgetDocument.connections.find((candidate) => candidate.id === callback.connectionId);
    if (connection) {
      serverUrlInput.value = connection.serverUrl;
      authModeInput.value = connection.auth.type;
      selectedConnectionId = connection.id;
      await discoverApps();
      setStatus(`Connected to ${connection.displayName} with OAuth.`);
      return;
    }
  }
  await restoreDocument();
}

void boot();'''
s = s.replace(old, new)

p.write_text(s)

# Host UI: expose auth mode explicitly. Trust is established by the user's Discover action.
p = Path('packages/gadget-host/index.html')
s = p.read_text()
s = s.replace('<button id="connect" type="button">Discover apps</button>', '''<label>Authentication
          <select id="auth-mode"><option value="none">None</option><option value="oauth">OAuth</option></select>
        </label>
        <button id="connect" type="button">Trust & discover apps</button>''')
p.write_text(s)

# Compose a second, independently deployed OAuth-protected MCP App.
p = Path('docker-compose.yml')
s = p.read_text()
s = s.replace('      - demo-mcp-app\n', '      - demo-mcp-app\n      - oauth-demo-mcp-app\n', 1)
s = s.replace('\n  e2e:\n', '''
  oauth-demo-mcp-app:
    build:
      context: .
      dockerfile: packages/oauth-demo-mcp-app/Dockerfile
    environment:
      PORT: 3002
    ports:
      - 3002:3002

  e2e:
''')
s = s.replace('      - demo-mcp-app\n', '      - demo-mcp-app\n      - oauth-demo-mcp-app\n', 1)
p.write_text(s)

# Bring the experiment document up to date.
p = Path('docs/experiment.md')
s = p.read_text()
s = s.replace('## Next experiment\n\nAdd layout editing (drag, resize, responsive breakpoints) without introducing tile-type-specific UI code. The acceptance criterion should remain: a new MCP App server can add a completely new tile UI without changing the host runtime.', '''## Current experiment: MCP Connections v1

The workspace now separates gadgets from MCP server connections. A connection owns endpoint trust and authentication mode; gadgets reference a `connectionId`. Existing v1 documents that embedded `serverUrl` in each gadget are migrated on load.

OAuth credentials are intentionally session-local and are never written to the exported workspace document. The host uses the MCP TypeScript SDK OAuth provider flow with PKCE and dynamic client registration. The Compose topology includes a second OAuth-protected MCP Apps server to prove that multiple gadgets can reuse one authenticated connection without host UI integration code for that app.

## Next experiment

Validate the generic connection abstraction against a real external OAuth-protected MCP Apps server, then harden endpoint registration, token storage, auditability, and policy based on the observed integration requirements.''')
p.write_text(s)
