import './styles.css';
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
  buildAllowAttribute,
  getToolUiResourceUri,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiSandboxProxyReadyNotification,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { BrowserOAuthProvider, clearOAuthCallback, oauthCallback } from './oauth.js';

import type { CallToolResult, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

declare global {
  interface Window {
    __MCP_APP_GADGETS_CONFIG__?: {
      sandboxOrigin?: string;
    };
  }
}

const hostInfo = { name: 'mcp-app-gadgets', version: '0.4.0' };
const STORAGE_KEY = 'mcp-app-gadgets.document.v2';
const LEGACY_STORAGE_KEY = 'mcp-app-gadgets.document.v1';
const GRID_COLUMNS = 12;
const DEFAULT_COLUMNS = 6;
const MIN_TILE_HEIGHT = 180;

type GadgetState = 'loading' | 'ready' | 'error';

interface GadgetLayout {
  columns?: number;
  height?: number;
}

type AuthMode = 'none' | 'oauth';

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
}

interface ServerConnection {
  client: Client;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
}

interface UiResourceData {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLayout(value: unknown): GadgetLayout | undefined {
  if (!isRecord(value)) return undefined;
  const layout: GadgetLayout = {};
  if (typeof value.columns === 'number' && Number.isFinite(value.columns)) {
    layout.columns = value.columns;
  }
  if (typeof value.height === 'number' && Number.isFinite(value.height)) {
    layout.height = value.height;
  }
  return layout;
}

function parseConnection(value: unknown): ConnectionConfig | undefined {
  if (!isRecord(value) || !isRecord(value.auth)) return undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.serverUrl !== 'string' ||
    typeof value.displayName !== 'string' ||
    value.trust !== 'trusted' ||
    (value.auth.type !== 'none' && value.auth.type !== 'oauth')
  )
    return undefined;
  return {
    id: value.id,
    serverUrl: value.serverUrl,
    displayName: value.displayName,
    trust: 'trusted',
    auth: { type: value.auth.type },
  };
}

function parseV2Gadget(value: unknown): GadgetConfig | undefined {
  if (!isRecord(value) || !isRecord(value.arguments)) return undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.connectionId !== 'string' ||
    typeof value.toolName !== 'string' ||
    typeof value.title !== 'string'
  )
    return undefined;
  return {
    id: value.id,
    connectionId: value.connectionId,
    toolName: value.toolName,
    title: value.title,
    arguments: value.arguments,
    layout: parseLayout(value.layout),
  };
}

function parseDocument(raw: string): GadgetDocument {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !Array.isArray(parsed.gadgets))
    throw new Error('Unsupported gadget document');
  if (parsed.version === 2 && Array.isArray(parsed.connections)) {
    return {
      version: 2,
      connections: parsed.connections.flatMap((value) => {
        const item = parseConnection(value);
        return item ? [item] : [];
      }),
      gadgets: parsed.gadgets.flatMap((value) => {
        const item = parseV2Gadget(value);
        return item ? [item] : [];
      }),
    };
  }
  if (parsed.version === 1) {
    const connections: ConnectionConfig[] = [];
    const byUrl = new Map<string, string>();
    const gadgets = parsed.gadgets.flatMap((value) => {
      if (
        !isRecord(value) ||
        !isRecord(value.arguments) ||
        typeof value.serverUrl !== 'string' ||
        typeof value.id !== 'string' ||
        typeof value.toolName !== 'string' ||
        typeof value.title !== 'string'
      )
        return [];
      const normalized = new URL(value.serverUrl).href;
      let connectionId = byUrl.get(normalized);
      if (!connectionId) {
        connectionId = `legacy-${connections.length + 1}`;
        byUrl.set(normalized, connectionId);
        connections.push({
          id: connectionId,
          serverUrl: normalized,
          displayName: new URL(normalized).host,
          trust: 'trusted',
          auth: { type: 'none' },
        });
      }
      return [
        {
          id: value.id,
          connectionId,
          toolName: value.toolName,
          title: value.title,
          arguments: value.arguments,
          layout: parseLayout(value.layout),
        } satisfies GadgetConfig,
      ];
    });
    return { version: 2, connections, gadgets };
  }
  throw new Error('Unsupported gadget document');
}

function readUiMetadata(value: unknown): Pick<UiResourceData, 'csp' | 'permissions'> | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = isRecord(value._meta)
    ? value._meta
    : isRecord(value.meta)
      ? value.meta
      : undefined;
  if (!metadata || !isRecord(metadata.ui)) return undefined;

  const result: Pick<UiResourceData, 'csp' | 'permissions'> = {};
  if (isRecord(metadata.ui.csp)) result.csp = metadata.ui.csp;
  if (isRecord(metadata.ui.permissions)) {
    result.permissions = metadata.ui.permissions;
  }
  return result;
}

function messageMethod(value: unknown): string | undefined {
  return isRecord(value) && typeof value.method === 'string' ? value.method : undefined;
}

function newGadgetId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) =>
    value.toString(16).padStart(8, '0'),
  ).join('');
}

const composer = document.querySelector<HTMLElement>('#composer')!;
const serverUrlInput = document.querySelector<HTMLInputElement>('#server-url')!;
const authModeInput = document.querySelector<HTMLSelectElement>('#auth-mode')!;
const connectButton = document.querySelector<HTMLButtonElement>('#connect')!;
const clearOAuthButton = document.querySelector<HTMLButtonElement>('#clear-oauth')!;
const toolSelect = document.querySelector<HTMLSelectElement>('#tool')!;
const titleInput = document.querySelector<HTMLInputElement>('#tile-title')!;
const argumentsInput = document.querySelector<HTMLTextAreaElement>('#arguments')!;
const addButton = document.querySelector<HTMLButtonElement>('#add')!;
const cancelEditButton = document.querySelector<HTMLButtonElement>('#cancel-edit')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export-workspace')!;
const importButton = document.querySelector<HTMLButtonElement>('#import-workspace')!;
const importFileInput = document.querySelector<HTMLInputElement>('#import-file')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const grid = document.querySelector<HTMLElement>('#grid')!;

const runtimeConnections = new Map<string, Promise<ServerConnection>>();
let selectedConnectionId: string | undefined;
const gadgetDocument = loadDocument();
let draggedGadgetId: string | undefined;
let editingGadgetId: string | undefined;

function setStatus(message: string) {
  status.textContent = message;
}

function loadDocument(): GadgetDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseDocument(raw);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    return legacy ? parseDocument(legacy) : { version: 2, connections: [], gadgets: [] };
  } catch (error) {
    console.warn('Could not restore gadget document', error);
    return { version: 2, connections: [], gadgets: [] };
  }
}

function saveDocument() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gadgetDocument));
}

function connectionById(id: string): ConnectionConfig {
  const connection = gadgetDocument.connections.find((candidate) => candidate.id === id);
  if (!connection) throw new Error(`Unknown MCP connection: ${id}`);
  return connection;
}

function ensureConnection(serverUrl: string, authMode: AuthMode): ConnectionConfig {
  const normalized = new URL(serverUrl).href;
  const existing = gadgetDocument.connections.find(
    (candidate) => candidate.serverUrl === normalized && candidate.auth.type === authMode,
  );
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

function updateGadgetLayout(id: string, layout: GadgetLayout) {
  const gadget = gadgetDocument.gadgets.find((candidate) => candidate.id === id);
  if (!gadget) return;
  gadget.layout = { ...gadget.layout, ...layout };
  saveDocument();
}

function cancelEditing() {
  editingGadgetId = undefined;
  addButton.textContent = 'Add gadget';
  cancelEditButton.hidden = true;
}

function parseArgumentsInput(): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsInput.value);
    if (!isRecord(parsed)) throw new Error('Arguments must be a JSON object.');
    return parsed;
  } catch {
    setStatus('Arguments must be a valid JSON object.');
    return undefined;
  }
}

async function listAllTools(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...response.tools);
    cursor = response.nextCursor;
  } while (cursor);
  return tools;
}

async function listAllResources(client: Client): Promise<Resource[]> {
  const resources: Resource[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.listResources(cursor ? { cursor } : undefined);
    resources.push(...response.resources);
    cursor = response.nextCursor;
  } while (cursor);
  return resources;
}

async function connectServer(config: ConnectionConfig): Promise<ServerConnection> {
  const existing = runtimeConnections.get(config.id);
  if (existing) return existing;
  const pending = (async () => {
    const client = new Client(hostInfo);
    const provider =
      config.auth.type === 'oauth'
        ? new BrowserOAuthProvider(config.id, config.serverUrl)
        : undefined;
    const transport = new StreamableHTTPClientTransport(
      new URL(config.serverUrl),
      provider ? { authProvider: provider } : undefined,
    );
    const callback = oauthCallback();
    if (provider && callback?.connectionId === config.id) {
      if (!callback.state || callback.state !== provider.state()) {
        throw new Error('OAuth state validation failed.');
      }
      await transport.finishAuth(callback.code);
      provider.clearAuthorizationState();
      clearOAuthCallback();
    }
    await client.connect(transport);
    const [tools, resources] = await Promise.all([listAllTools(client), listAllResources(client)]);
    return {
      client,
      tools: new Map(tools.map((tool) => [tool.name, tool])),
      resources: new Map(resources.map((resource) => [resource.uri, resource])),
    };
  })().catch((error) => {
    runtimeConnections.delete(config.id);
    throw error;
  });
  runtimeConnections.set(config.id, pending);
  return pending;
}

async function discoverApps(preferredTool?: string) {
  try {
    setStatus('Discovering…');
    const selected = ensureConnection(serverUrlInput.value, authModeInput.value as AuthMode);
    selectedConnectionId = selected.id;
    const connection = await connectServer(selected);
    const appTools = Array.from(connection.tools.values()).filter((tool) =>
      getToolUiResourceUri(tool),
    );
    toolSelect.replaceChildren(
      ...appTools.map((tool) => new Option(tool.title ?? tool.name, tool.name)),
    );
    toolSelect.disabled = appTools.length === 0;
    addButton.disabled = appTools.length === 0;
    if (preferredTool && appTools.some((tool) => tool.name === preferredTool)) {
      toolSelect.value = preferredTool;
    }
    setStatus(
      appTools.length
        ? `Discovered ${appTools.length} MCP App tool(s).`
        : 'No MCP App tools found.',
    );
  } catch (error) {
    setStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

connectButton.addEventListener('click', () => {
  void discoverApps();
});

clearOAuthButton.addEventListener('click', () => {
  const connectionId = selectedConnectionId;
  if (!connectionId) {
    setStatus('Select an OAuth connection first.');
    return;
  }
  const config = connectionById(connectionId);
  if (config.auth.type !== 'oauth') {
    setStatus(`${config.displayName} does not use OAuth.`);
    return;
  }
  runtimeConnections.delete(config.id);
  new BrowserOAuthProvider(config.id, config.serverUrl).logout();
  setStatus(`Cleared OAuth session for ${config.displayName}.`);
});

async function addOrSaveGadget() {
  const args = parseArgumentsInput();
  if (!args) return;

  try {
    if (!selectedConnectionId) throw new Error('Discover an MCP connection first.');
    const connectionConfig = connectionById(selectedConnectionId);
    const connection = await connectServer(connectionConfig);
    const tool = connection.tools.get(toolSelect.value);
    if (!tool) throw new Error(`Unknown tool: ${toolSelect.value}`);

    if (editingGadgetId) {
      const config = gadgetDocument.gadgets.find((gadget) => gadget.id === editingGadgetId);
      if (!config) throw new Error('The gadget being edited no longer exists.');
      config.connectionId = selectedConnectionId;
      config.toolName = tool.name;
      config.title = titleInput.value || tool.title || tool.name;
      config.arguments = args;
      saveDocument();
      const title = config.title;
      cancelEditing();
      await rerenderDocument();
      setStatus(`Saved ${title}.`);
      return;
    }

    const config: GadgetConfig = {
      id: newGadgetId(),
      connectionId: selectedConnectionId,
      toolName: tool.name,
      title: titleInput.value || tool.title || tool.name,
      arguments: args,
      layout: { columns: DEFAULT_COLUMNS },
    };
    gadgetDocument.gadgets.push(config);
    saveDocument();
    await renderGadget(config);
    setStatus(`Added ${tool.name}.`);
  } catch (error) {
    setStatus(`Could not save gadget: ${error instanceof Error ? error.message : String(error)}`);
  }
}

addButton.addEventListener('click', () => {
  void addOrSaveGadget();
});

cancelEditButton.addEventListener('click', () => {
  cancelEditing();
  setStatus('Edit cancelled.');
});

async function editGadget(config: GadgetConfig) {
  editingGadgetId = config.id;
  const connection = connectionById(config.connectionId);
  serverUrlInput.value = connection.serverUrl;
  authModeInput.value = connection.auth.type;
  selectedConnectionId = connection.id;
  titleInput.value = config.title;
  argumentsInput.value = JSON.stringify(config.arguments, undefined, 2);
  addButton.textContent = 'Save changes';
  cancelEditButton.hidden = false;
  await discoverApps(config.toolName);
  composer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  titleInput.focus();
  setStatus(`Editing ${config.title}.`);
}

async function duplicateGadget(config: GadgetConfig) {
  const index = gadgetDocument.gadgets.findIndex((gadget) => gadget.id === config.id);
  const duplicate: GadgetConfig = {
    ...config,
    id: newGadgetId(),
    title: `${config.title} copy`,
    arguments: structuredClone(config.arguments),
    layout: config.layout ? { ...config.layout } : undefined,
  };
  gadgetDocument.gadgets.splice(
    index < 0 ? gadgetDocument.gadgets.length : index + 1,
    0,
    duplicate,
  );
  saveDocument();
  await rerenderDocument();
  setStatus(`Duplicated ${config.title}.`);
}

async function retryGadget(config: GadgetConfig) {
  runtimeConnections.delete(config.connectionId);
  await rerenderDocument();
  setStatus(`Retried ${config.title}.`);
}

function exportWorkspace() {
  const blob = new Blob([`${JSON.stringify(gadgetDocument, undefined, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'mcp-app-gadgets-workspace.json';
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus(`Exported ${gadgetDocument.gadgets.length} gadget(s).`);
}

exportButton.addEventListener('click', exportWorkspace);
importButton.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  void file
    .text()
    .then(async (raw) => {
      const imported = parseDocument(raw);
      gadgetDocument.connections.splice(
        0,
        gadgetDocument.connections.length,
        ...imported.connections,
      );
      gadgetDocument.gadgets.splice(0, gadgetDocument.gadgets.length, ...imported.gadgets);
      saveDocument();
      cancelEditing();
      await rerenderDocument();
      setStatus(`Imported ${gadgetDocument.gadgets.length} gadget(s).`);
    })
    .catch((error) => {
      setStatus(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    })
    .finally(() => {
      importFileInput.value = '';
    });
});

function applyLayout(tile: HTMLElement, config: GadgetConfig) {
  const columns = Math.min(GRID_COLUMNS, Math.max(1, config.layout?.columns ?? DEFAULT_COLUMNS));
  tile.style.setProperty('--gadget-columns', String(columns));
  tile.style.setProperty(
    '--gadget-height',
    `${Math.max(MIN_TILE_HEIGHT, config.layout?.height ?? MIN_TILE_HEIGHT)}px`,
  );
}

function enableReordering(tile: HTMLElement, handle: HTMLElement, config: GadgetConfig) {
  handle.draggable = true;
  handle.classList.add('drag-handle');
  handle.title = 'Drag to reorder';

  handle.addEventListener('dragstart', (event) => {
    draggedGadgetId = config.id;
    tile.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', config.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  handle.addEventListener('dragend', () => {
    draggedGadgetId = undefined;
    tile.classList.remove('dragging');
    document
      .querySelectorAll('.tile.drag-over')
      .forEach((element) => element.classList.remove('drag-over'));
  });
  tile.addEventListener('dragover', (event) => {
    if (!draggedGadgetId || draggedGadgetId === config.id) return;
    event.preventDefault();
    tile.classList.add('drag-over');
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('drag-over'));
  tile.addEventListener('drop', (event) => {
    event.preventDefault();
    tile.classList.remove('drag-over');
    if (!draggedGadgetId || draggedGadgetId === config.id) return;
    const fromIndex = gadgetDocument.gadgets.findIndex((gadget) => gadget.id === draggedGadgetId);
    const toIndex = gadgetDocument.gadgets.findIndex((gadget) => gadget.id === config.id);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = gadgetDocument.gadgets.splice(fromIndex, 1);
    gadgetDocument.gadgets.splice(toIndex, 0, moved);
    saveDocument();
    const movedTile = grid.querySelector<HTMLElement>(`[data-gadget-id="${CSS.escape(moved.id)}"]`);
    if (movedTile) grid.insertBefore(movedTile, fromIndex < toIndex ? tile.nextSibling : tile);
    setStatus('Gadget order saved.');
  });
}

function enableResizing(tile: HTMLElement, config: GadgetConfig) {
  const handle = document.createElement('button');
  handle.className = 'resize-handle';
  handle.type = 'button';
  handle.setAttribute('aria-label', `Resize ${config.title}`);
  handle.title = 'Drag to resize';
  tile.append(handle);

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    tile.classList.add('resizing');
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = tile.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      const width = Math.max(240, startRect.width + moveEvent.clientX - startX);
      const height = Math.max(MIN_TILE_HEIGHT, startRect.height + moveEvent.clientY - startY);
      tile.style.width = `${width}px`;
      tile.style.height = `${height}px`;
    };

    const onEnd = (upEvent: PointerEvent) => {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      tile.classList.remove('resizing');
      const gridWidth = grid.getBoundingClientRect().width;
      const tileRect = tile.getBoundingClientRect();
      const columns = Math.min(
        GRID_COLUMNS,
        Math.max(1, Math.round((tileRect.width / gridWidth) * GRID_COLUMNS)),
      );
      const height = Math.round(tileRect.height);
      config.layout = { columns, height };
      tile.style.removeProperty('width');
      tile.style.removeProperty('height');
      applyLayout(tile, config);
      updateGadgetLayout(config.id, config.layout);
      setStatus(`Saved ${config.title} layout (${columns}/12 columns).`);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });
}

function actionButton(label: string, className: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.draggable = false;
  return button;
}

function setTileState(element: HTMLElement, state: GadgetState, message?: string) {
  element.dataset.state = state;
  element.textContent = message ?? state[0].toUpperCase() + state.slice(1);
}

async function renderGadget(config: GadgetConfig) {
  const tile = document.createElement('article');
  tile.className = 'tile';
  tile.dataset.gadgetId = config.id;
  applyLayout(tile, config);

  const tileHeader = document.createElement('header');
  const titleArea = document.createElement('div');
  titleArea.className = 'tile-title-area';
  const heading = document.createElement('h2');
  heading.textContent = config.title;
  const state = document.createElement('span');
  state.className = 'gadget-state';
  setTileState(state, 'loading');
  titleArea.append(heading, state);

  const actions = document.createElement('div');
  actions.className = 'tile-actions';
  const edit = actionButton('Edit', 'edit');
  const duplicate = actionButton('Duplicate', 'duplicate');
  const retry = actionButton('Retry', 'retry');
  const remove = actionButton('Remove', 'remove');
  actions.append(edit, duplicate, retry, remove);
  tileHeader.append(titleArea, actions);
  tile.append(tileHeader);
  grid.append(tile);
  enableReordering(tile, titleArea, config);
  enableResizing(tile, config);

  edit.addEventListener('click', () => {
    void editGadget(config);
  });
  duplicate.addEventListener('click', () => {
    void duplicateGadget(config);
  });
  retry.addEventListener('click', () => {
    void retryGadget(config);
  });
  remove.addEventListener('click', () => {
    const index = gadgetDocument.gadgets.findIndex((gadget) => gadget.id === config.id);
    if (index >= 0) gadgetDocument.gadgets.splice(index, 1);
    if (editingGadgetId === config.id) cancelEditing();
    saveDocument();
    tile.remove();
    setStatus(`Removed ${config.title}.`);
  });

  try {
    const connectionConfig = connectionById(config.connectionId);
    const connection = await connectServer(connectionConfig);
    const tool = connection.tools.get(config.toolName);
    if (!tool) {
      throw new Error(
        `Tool ${config.toolName} is no longer advertised by ${connectionConfig.serverUrl}.`,
      );
    }
    await mountAppTile(tile, connection, tool, config.arguments);
    setTileState(state, 'ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setTileState(state, 'error', 'Error');
    state.title = message;
    const fallback = document.createElement('div');
    fallback.className = 'fallback';
    fallback.textContent = `Unavailable: ${message}`;
    tile.append(fallback);
  }
}

function decodeBase64Utf8(blob: string): string {
  const binary = atob(blob);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function getUiResource(connection: ServerConnection, uri: string): Promise<UiResourceData> {
  const response = await connection.client.readResource({ uri });
  const content = response.contents[0];
  if (content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Expected ${RESOURCE_MIME_TYPE} from ${uri}.`);
  }
  const html = 'blob' in content ? decodeBase64Utf8(content.blob) : content.text;
  const contentUi = readUiMetadata(content);
  const listingUi = readUiMetadata(connection.resources.get(uri));
  return {
    html,
    csp: contentUi?.csp ?? listingUi?.csp,
    permissions: contentUi?.permissions ?? listingUi?.permissions,
  };
}

function sandboxUrl(csp?: McpUiResourceCsp) {
  const configuredOrigin = window.__MCP_APP_GADGETS_CONFIG__?.sandboxOrigin;
  const origin = configuredOrigin ?? new URL(window.location.href).origin;
  const url = new URL('/sandbox.html', origin);
  if (csp) url.searchParams.set('csp', JSON.stringify(csp));
  return url;
}

async function loadSandboxProxy(
  iframe: HTMLIFrameElement,
  csp?: McpUiResourceCsp,
  permissions?: McpUiResourcePermissions,
) {
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
  const allow = buildAllowAttribute(permissions);
  if (allow) iframe.setAttribute('allow', allow);
  const readyMethod: McpUiSandboxProxyReadyNotification['method'] =
    'ui/notifications/sandbox-proxy-ready';
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('Sandbox proxy did not become ready.')),
      10_000,
    );
    const listener = (event: MessageEvent<unknown>) => {
      if (event.source === iframe.contentWindow && messageMethod(event.data) === readyMethod) {
        window.clearTimeout(timeout);
        window.removeEventListener('message', listener);
        resolve();
      }
    };
    window.addEventListener('message', listener);
  });
  iframe.src = sandboxUrl(csp).href;
  await ready;
}

async function mountAppTile(
  tile: HTMLElement,
  connection: ServerConnection,
  tool: Tool,
  args: Record<string, unknown>,
) {
  const resourceUri = getToolUiResourceUri(tool);
  if (!resourceUri) throw new Error('Tool does not declare an MCP App resource.');

  const uiPromise = getUiResource(connection, resourceUri);
  const resultPromise = connection.client.callTool({
    name: tool.name,
    arguments: args,
  }) as Promise<CallToolResult>;
  const ui = await uiPromise;

  const iframe = document.createElement('iframe');
  tile.append(iframe);
  await loadSandboxProxy(iframe, ui.csp, ui.permissions);

  const bridge = new AppBridge(
    connection.client,
    hostInfo,
    {
      serverTools: connection.client.getServerCapabilities()?.tools,
      serverResources: connection.client.getServerCapabilities()?.resources,
      openLinks: {},
      updateModelContext: { text: {} },
    },
    {
      hostContext: {
        platform: 'web',
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        containerDimensions: { maxHeight: 6000 },
      },
    },
  );
  bridge.onopenlink = ({ url }) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve({});
  };
  bridge.onsizechange = ({ height }) => {
    if (height) iframe.style.height = `${Math.max(120, height)}px`;
  };
  bridge.onmessage = () => Promise.resolve({});
  bridge.onupdatemodelcontext = () => Promise.resolve({});

  const initialized = new Promise<void>((resolve) => {
    const previous = bridge.oninitialized;
    bridge.oninitialized = (...values) => {
      resolve();
      bridge.oninitialized = previous;
      previous?.(...values);
    };
  });
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  void bridge.sendSandboxResourceReady({
    html: ui.html,
    csp: ui.csp,
    permissions: ui.permissions,
  });
  await initialized;
  void bridge.sendToolInput({ arguments: args });
  void resultPromise.then(
    (result) => {
      void bridge.sendToolResult(result);
    },
    (error) => {
      void bridge.sendToolCancelled({
        reason: error instanceof Error ? error.message : String(error),
      });
    },
  );

  removeBridgeOnTileRemoval(tile, bridge);
}

function removeBridgeOnTileRemoval(tile: HTMLElement, bridge: AppBridge) {
  const observer = new MutationObserver(() => {
    if (!document.contains(tile)) {
      observer.disconnect();
      void bridge.close();
    }
  });
  observer.observe(grid, { childList: true });
}

async function rerenderDocument() {
  grid.replaceChildren();
  for (const gadget of gadgetDocument.gadgets) await renderGadget(gadget);
}

async function restoreDocument() {
  if (gadgetDocument.gadgets.length === 0) return;
  setStatus(`Restoring ${gadgetDocument.gadgets.length} gadget(s)…`);
  await rerenderDocument();
  setStatus(`Restored ${gadgetDocument.gadgets.length} gadget(s).`);
}

async function boot() {
  const callback = oauthCallback();
  if (callback) {
    const connection = gadgetDocument.connections.find(
      (candidate) => candidate.id === callback.connectionId,
    );
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

void boot();
