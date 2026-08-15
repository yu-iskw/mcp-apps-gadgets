import "./styles.css";
import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

const hostInfo = { name: "mcp-app-gadgets", version: "0.1.0" };
const serverUrlInput = document.querySelector<HTMLInputElement>("#server-url")!;
const connectButton = document.querySelector<HTMLButtonElement>("#connect")!;
const toolSelect = document.querySelector<HTMLSelectElement>("#tool")!;
const titleInput = document.querySelector<HTMLInputElement>("#tile-title")!;
const argumentsInput = document.querySelector<HTMLTextAreaElement>("#arguments")!;
const addButton = document.querySelector<HTMLButtonElement>("#add")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const grid = document.querySelector<HTMLElement>("#grid")!;

let client: Client | undefined;
let tools = new Map<string, Tool>();

function setStatus(message: string) {
  status.textContent = message;
}

connectButton.addEventListener("click", async () => {
  try {
    setStatus("Connecting…");
    await client?.close();
    client = new Client(hostInfo);
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrlInput.value)));
    const response = await client.listTools();
    tools = new Map(response.tools.map((tool) => [tool.name, tool]));
    const appTools = response.tools.filter((tool) => getToolUiResourceUri(tool));
    toolSelect.replaceChildren(...appTools.map((tool) => new Option(tool.title ?? tool.name, tool.name)));
    toolSelect.disabled = appTools.length === 0;
    addButton.disabled = appTools.length === 0;
    setStatus(appTools.length ? `Discovered ${appTools.length} MCP App tool(s).` : "No MCP App tools found.");
  } catch (error) {
    setStatus(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});

addButton.addEventListener("click", async () => {
  if (!client) return;
  const tool = tools.get(toolSelect.value);
  if (!tool) return;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsInput.value) as Record<string, unknown>;
  } catch {
    setStatus("Arguments must be valid JSON.");
    return;
  }

  const tile = document.createElement("article");
  tile.className = "tile";
  const tileHeader = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = titleInput.value || tool.title || tool.name;
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "Remove";
  tileHeader.append(heading, remove);
  tile.append(tileHeader);
  grid.prepend(tile);
  remove.addEventListener("click", () => tile.remove());

  try {
    await mountAppTile(tile, client, tool, args);
    setStatus(`Added ${tool.name}.`);
  } catch (error) {
    tile.insertAdjacentHTML("beforeend", `<div class="fallback"></div>`);
    tile.querySelector<HTMLElement>(".fallback")!.textContent = error instanceof Error ? error.message : String(error);
    setStatus("The gadget failed to render; see the tile for details.");
  }
});

async function mountAppTile(tile: HTMLElement, mcpClient: Client, tool: Tool, args: Record<string, unknown>) {
  const resourceUri = getToolUiResourceUri(tool);
  if (!resourceUri) throw new Error("Tool does not declare an MCP App resource.");

  const [resource, result] = await Promise.all([
    mcpClient.readResource({ uri: resourceUri }),
    mcpClient.callTool({ name: tool.name, arguments: args }) as Promise<CallToolResult>,
  ]);
  const content = resource.contents[0];
  if (!content || content.mimeType !== RESOURCE_MIME_TYPE) {
    throw new Error(`Expected ${RESOURCE_MIME_TYPE} from ${resourceUri}.`);
  }
  const html = "blob" in content ? atob(content.blob) : content.text;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts allow-forms");
  iframe.srcdoc = html;
  tile.append(iframe);
  await new Promise<void>((resolve, reject) => {
    iframe.addEventListener("load", () => resolve(), { once: true });
    setTimeout(() => reject(new Error("MCP App iframe did not load.")), 10_000);
  });

  const bridge = new AppBridge(
    mcpClient,
    hostInfo,
    { serverTools: mcpClient.getServerCapabilities()?.tools, serverResources: mcpClient.getServerCapabilities()?.resources, openLinks: {} },
    { hostContext: { platform: "web", displayMode: "inline", availableDisplayModes: ["inline"] } },
  );
  bridge.onopenlink = async ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); return {}; };
  bridge.onsizechange = async ({ height }) => { if (height) iframe.style.height = `${Math.max(120, height)}px`; };
  bridge.onmessage = async () => ({ isError: true });
  bridge.onupdatemodelcontext = async () => ({});

  const initialized = new Promise<void>((resolve) => {
    const previous = bridge.oninitialized;
    bridge.oninitialized = (...values) => { resolve(); previous?.(...values); };
  });
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  await initialized;
  bridge.sendToolInput({ arguments: args });
  bridge.sendToolResult(result);

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
