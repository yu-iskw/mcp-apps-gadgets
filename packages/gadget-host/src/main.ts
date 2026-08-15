import "./styles.css";
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
  buildAllowAttribute,
  getToolUiResourceUri,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
  type McpUiSandboxProxyReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";

const hostInfo = { name: "mcp-app-gadgets", version: "0.2.0" };
const STORAGE_KEY = "mcp-app-gadgets.document.v1";
const SANDBOX_PORT = "8081";

interface GadgetLayout {
  width?: number;
  height?: number;
}

interface GadgetConfig {
  id: string;
  serverUrl: string;
  toolName: string;
  title: string;
  arguments: Record<string, unknown>;
  layout?: GadgetLayout;
}

interface GadgetDocument {
  version: 1;
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

const serverUrlInput = document.querySelector<HTMLInputElement>("#server-url")!;
const connectButton = document.querySelector<HTMLButtonElement>("#connect")!;
const toolSelect = document.querySelector<HTMLSelectElement>("#tool")!;
const titleInput = document.querySelector<HTMLInputElement>("#tile-title")!;
const argumentsInput = document.querySelector<HTMLTextAreaElement>("#arguments")!;
const addButton = document.querySelector<HTMLButtonElement>("#add")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const grid = document.querySelector<HTMLElement>("#grid")!;

const connections = new Map<string, Promise<ServerConnection>>();
let selectedServerUrl = serverUrlInput.value;
let gadgetDocument = loadDocument();

function setStatus(message: string) {
  status.textContent = message;
}

function loadDocument(): GadgetDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, gadgets: [] };
    const parsed = JSON.parse(raw) as GadgetDocument;
    if (parsed.version !== 1 || !Array.isArray(parsed.gadgets)) throw new Error("Unsupported gadget document");
    return parsed;
  } catch (error) {
    console.warn("Could not restore gadget document", error);
    return { version: 1, gadgets: [] };
  }
}

function saveDocument() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(gadgetDocument));
}

async function connectServer(serverUrl: string): Promise<ServerConnection> {
  const normalized = new URL(serverUrl).href;
  const existing = connections.get(normalized);
  if (existing) return existing;

  const pending = (async () => {
    const client = new Client(hostInfo);
    await client.connect(new StreamableHTTPClientTransport(new URL(normalized)));
    const [toolResponse, resourceResponse] = await Promise.all([client.listTools(), client.listResources()]);
    return {
      client,
      tools: new Map(toolResponse.tools.map((tool) => [tool.name, tool])),
      resources: new Map(resourceResponse.resources.map((resource) => [resource.uri, resource])),
    };
  })().catch((error) => {
    connections.delete(normalized);
    throw error;
  });
  connections.set(normalized, pending);
  return pending;
}

connectButton.addEventListener("click", async () => {
  try {
    setStatus("Discovering…");
    selectedServerUrl = new URL(serverUrlInput.value).href;
    const connection = await connectServer(selectedServerUrl);
    const appTools = Array.from(connection.tools.values()).filter((tool) => getToolUiResourceUri(tool));
    toolSelect.replaceChildren(...appTools.map((tool) => new Option(tool.title ?? tool.name, tool.name)));
    toolSelect.disabled = appTools.length === 0;
    addButton.disabled = appTools.length === 0;
    setStatus(appTools.length ? `Discovered ${appTools.length} MCP App tool(s).` : "No MCP App tools found.");
  } catch (error) {
    setStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

addButton.addEventListener("click", async () => {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsInput.value) as Record<string, unknown>;
  } catch {
    setStatus("Arguments must be valid JSON.");
    return;
  }

  try {
    const connection = await connectServer(selectedServerUrl);
    const tool = connection.tools.get(toolSelect.value);
    if (!tool) throw new Error(`Unknown tool: ${toolSelect.value}`);
    const config: GadgetConfig = {
      id: crypto.randomUUID(),
      serverUrl: selectedServerUrl,
      toolName: tool.name,
      title: titleInput.value || tool.title || tool.name,
      arguments: args,
    };
    gadgetDocument.gadgets.push(config);
    saveDocument();
    await renderGadget(config, true);
    setStatus(`Added ${tool.name}.`);
  } catch (error) {
    setStatus(`Could not add gadget: ${error instanceof Error ? error.message : String(error)}`);
  }
});

async function renderGadget(config: GadgetConfig, prepend = false) {
  const tile = document.createElement("article");
  tile.className = "tile";
  tile.dataset.gadgetId = config.id;
  const tileHeader = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = config.title;
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "Remove";
  tileHeader.append(heading, remove);
  tile.append(tileHeader);
  prepend ? grid.prepend(tile) : grid.append(tile);

  remove.addEventListener("click", () => {
    gadgetDocument.gadgets = gadgetDocument.gadgets.filter((gadget) => gadget.id !== config.id);
    saveDocument();
    tile.remove();
  });

  try {
    const connection = await connectServer(config.serverUrl);
    const tool = connection.tools.get(config.toolName);
    if (!tool) throw new Error(`Tool ${config.toolName} is no longer advertised by ${config.serverUrl}.`);
    await mountAppTile(tile, connection, tool, config.arguments);
  } catch (error) {
    const fallback = document.createElement("div");
    fallback.className = "fallback";
    fallback.textContent = `Unavailable: ${error instanceof Error ? error.message : String(error)}`;
    tile.append(fallback);
  }
}

async function getUiResource(connection: ServerConnection, uri: string): Promise<UiResourceData> {
  const response = await connection.client.readResource({ uri });
  const content = response.contents[0];
  if (!content || content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Expected ${RESOURCE_MIME_TYPE} from ${uri}.`);
  }
  const html = "blob" in content ? atob(content.blob) : content.text;
  const contentMeta = (content as { _meta?: { ui?: UiResourceData }; meta?: { ui?: UiResourceData } })._meta
    ?? (content as { meta?: { ui?: UiResourceData } }).meta;
  const listingMeta = (connection.resources.get(uri) as Resource & { _meta?: { ui?: UiResourceData } } | undefined)?._meta;
  const ui = contentMeta?.ui ?? listingMeta?.ui;
  return { html, csp: ui?.csp, permissions: ui?.permissions };
}

function sandboxUrl(csp?: McpUiResourceCsp) {
  const url = new URL("/sandbox.html", window.location.href);
  url.port = SANDBOX_PORT;
  if (csp) url.searchParams.set("csp", JSON.stringify(csp));
  return url;
}

async function loadSandboxProxy(iframe: HTMLIFrameElement, csp?: McpUiResourceCsp, permissions?: McpUiResourcePermissions) {
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  const allow = buildAllowAttribute(permissions);
  if (allow) iframe.setAttribute("allow", allow);
  const readyMethod: McpUiSandboxProxyReadyNotification["method"] = "ui/notifications/sandbox-proxy-ready";
  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Sandbox proxy did not become ready.")), 10_000);
    const listener = (event: MessageEvent) => {
      if (event.source === iframe.contentWindow && event.data?.method === readyMethod) {
        window.clearTimeout(timeout);
        window.removeEventListener("message", listener);
        resolve();
      }
    };
    window.addEventListener("message", listener);
  });
  iframe.src = sandboxUrl(csp).href;
  await ready;
}

async function mountAppTile(tile: HTMLElement, connection: ServerConnection, tool: Tool, args: Record<string, unknown>) {
  const resourceUri = getToolUiResourceUri(tool);
  if (!resourceUri) throw new Error("Tool does not declare an MCP App resource.");

  const uiPromise = getUiResource(connection, resourceUri);
  const resultPromise = connection.client.callTool({ name: tool.name, arguments: args }) as Promise<CallToolResult>;
  const ui = await uiPromise;

  const iframe = document.createElement("iframe");
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
        platform: "web",
        displayMode: "inline",
        availableDisplayModes: ["inline"],
        containerDimensions: { maxHeight: 6000 },
      },
    },
  );
  bridge.onopenlink = async ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); return {}; };
  bridge.onsizechange = async ({ height }) => { if (height) iframe.style.height = `${Math.max(120, height)}px`; };
  bridge.onmessage = async () => ({});
  bridge.onupdatemodelcontext = async () => ({});

  const initialized = new Promise<void>((resolve) => {
    const previous = bridge.oninitialized;
    bridge.oninitialized = (...values) => { resolve(); bridge.oninitialized = previous; previous?.(...values); };
  });
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  await bridge.sendSandboxResourceReady({ html: ui.html, csp: ui.csp, permissions: ui.permissions });
  await initialized;
  bridge.sendToolInput({ arguments: args });
  resultPromise.then(
    (result) => bridge.sendToolResult(result),
    (error) => bridge.sendToolCancelled({ reason: error instanceof Error ? error.message : String(error) }),
  );

  removeBridgeOnTileRemoval(tile, bridge);
}

function removeBridgeOnTileRemoval(tile: HTMLElement, bridge: AppBridge) {
  const observer = new MutationObserver(() => {
    if (!document.contains(tile)) {
      observer.disconnect();
      bridge.close().catch(() => undefined);
    }
  });
  observer.observe(grid, { childList: true });
}

async function restoreDocument() {
  if (gadgetDocument.gadgets.length === 0) return;
  setStatus(`Restoring ${gadgetDocument.gadgets.length} gadget(s)…`);
  await Promise.all(gadgetDocument.gadgets.map((gadget) => renderGadget(gadget)));
  setStatus(`Restored ${gadgetDocument.gadgets.length} gadget(s).`);
}

void restoreDocument();
