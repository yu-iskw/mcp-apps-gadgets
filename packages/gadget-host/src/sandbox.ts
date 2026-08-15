import {
  buildAllowAttribute,
  type McpUiSandboxProxyReadyNotification,
  type McpUiSandboxResourceReadyNotification,
} from '@modelcontextprotocol/ext-apps/app-bridge';

if (window.self === window.top) throw new Error('Sandbox proxy must run inside an iframe.');
if (!document.referrer) throw new Error('Missing embedding referrer.');

const hostUrl = new URL(document.referrer);
const hostOrigin = hostUrl.origin;
if (hostUrl.hostname !== window.location.hostname || hostUrl.port !== '8080') {
  throw new Error(`Embedding origin is not allowed: ${hostOrigin}`);
}
const ownOrigin = window.location.origin;

try {
  window.top!.location.href;
  throw new Error('Sandbox isolation self-test failed: top window is accessible.');
} catch (error) {
  if (error instanceof Error && error.message.startsWith('Sandbox isolation self-test failed'))
    throw error;
}

const inner = document.createElement('iframe');
inner.style.cssText = 'width:100%;height:100%;border:0;display:block';
inner.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
document.body.append(inner);

const resourceReadyMethod: McpUiSandboxResourceReadyNotification['method'] =
  'ui/notifications/sandbox-resource-ready';
const proxyReadyMethod: McpUiSandboxProxyReadyNotification['method'] =
  'ui/notifications/sandbox-proxy-ready';

window.addEventListener('message', (event) => {
  if (event.source === window.parent) {
    if (event.origin !== hostOrigin) return;
    if (event.data?.method === resourceReadyMethod) {
      const { html, sandbox, permissions } = event.data.params ?? {};
      if (typeof sandbox === 'string') inner.setAttribute('sandbox', sandbox);
      const allow = buildAllowAttribute(permissions);
      if (allow) inner.setAttribute('allow', allow);
      if (typeof html === 'string') {
        const document = inner.contentDocument ?? inner.contentWindow?.document;
        if (!document) throw new Error('Could not access inner sandbox document.');
        document.open();
        document.write(html);
        document.close();
      }
      return;
    }
    inner.contentWindow?.postMessage(event.data, '*');
    return;
  }

  if (event.source === inner.contentWindow) {
    if (event.origin !== ownOrigin && event.origin !== 'null') return;
    window.parent.postMessage(event.data, hostOrigin);
  }
});

window.parent.postMessage(
  {
    jsonrpc: '2.0',
    method: proxyReadyMethod,
    params: {},
  },
  hostOrigin,
);
