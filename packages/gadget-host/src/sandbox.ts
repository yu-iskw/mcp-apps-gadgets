import {
  buildAllowAttribute,
  type McpUiResourcePermissions,
  type McpUiSandboxProxyReadyNotification,
  type McpUiSandboxResourceReadyNotification,
} from '@modelcontextprotocol/ext-apps/app-bridge';

interface ResourceReadyPayload {
  html?: string;
  sandbox?: string;
  permissions?: McpUiResourcePermissions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseResourceReadyPayload(data: unknown): ResourceReadyPayload | undefined {
  if (!isRecord(data) || data.method !== resourceReadyMethod || !isRecord(data.params)) {
    return undefined;
  }

  const payload: ResourceReadyPayload = {};
  if (typeof data.params.html === 'string') payload.html = data.params.html;
  if (typeof data.params.sandbox === 'string') payload.sandbox = data.params.sandbox;
  if (isRecord(data.params.permissions)) {
    payload.permissions = data.params.permissions;
  }
  return payload;
}

if (window.self === window.top) throw new Error('Sandbox proxy must run inside an iframe.');
if (!document.referrer) throw new Error('Missing embedding referrer.');

const hostUrl = new URL(document.referrer);
const hostOrigin = hostUrl.origin;
if (hostUrl.hostname !== window.location.hostname || hostUrl.port !== '8080') {
  throw new Error(`Embedding origin is not allowed: ${hostOrigin}`);
}
const ownOrigin = window.location.origin;

let topIsAccessible = false;
try {
  topIsAccessible = typeof window.top?.location.href === 'string';
} catch {
  topIsAccessible = false;
}
if (topIsAccessible) {
  throw new Error('Sandbox isolation self-test failed: top window is accessible.');
}

const inner = document.createElement('iframe');
inner.style.cssText = 'width:100%;height:100%;border:0;display:block';
inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
document.body.append(inner);

const resourceReadyMethod: McpUiSandboxResourceReadyNotification['method'] =
  'ui/notifications/sandbox-resource-ready';
const proxyReadyMethod: McpUiSandboxProxyReadyNotification['method'] =
  'ui/notifications/sandbox-proxy-ready';

function loadInnerResource(payload: ResourceReadyPayload) {
  if (payload.sandbox) inner.setAttribute('sandbox', payload.sandbox);

  const allow = buildAllowAttribute(payload.permissions);
  if (allow) inner.setAttribute('allow', allow);

  if (!payload.html) return;
  const innerDocument = inner.contentDocument ?? inner.contentWindow?.document;
  if (!innerDocument) throw new Error('Could not access inner sandbox document.');
  innerDocument.open();
  innerDocument.write(payload.html);
  innerDocument.close();
}

function handleHostMessage(event: MessageEvent<unknown>) {
  if (event.origin !== hostOrigin) return;
  const payload = parseResourceReadyPayload(event.data);
  if (payload) {
    loadInnerResource(payload);
    return;
  }
  inner.contentWindow?.postMessage(event.data, '*');
}

function handleInnerMessage(event: MessageEvent<unknown>) {
  if (event.origin !== ownOrigin && event.origin !== 'null') return;
  window.parent.postMessage(event.data, hostOrigin);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source === window.parent) {
    handleHostMessage(event);
    return;
  }
  if (event.source === inner.contentWindow) handleInnerMessage(event);
});

window.parent.postMessage(
  {
    jsonrpc: '2.0',
    method: proxyReadyMethod,
    params: {},
  },
  hostOrigin,
);
