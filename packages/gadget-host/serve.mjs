import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./dist/", import.meta.url));
const hostPort = Number.parseInt(process.env.HOST_PORT ?? "8080", 10);
const sandboxPort = Number.parseInt(process.env.SANDBOX_PORT ?? "8081", 10);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

function sanitizeDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return domains.filter((domain) => typeof domain === "string" && !/[;\r\n'" ]/.test(domain));
}

function buildCspHeader(csp = {}) {
  const resourceDomains = sanitizeDomains(csp.resourceDomains).join(" ");
  const connectDomains = sanitizeDomains(csp.connectDomains).join(" ");
  const frameDomains = sanitizeDomains(csp.frameDomains).join(" ");
  const baseUriDomains = sanitizeDomains(csp.baseUriDomains).join(" ");
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ].join("; ");
}

function safeFilePath(pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  return join(directory, relative || "index.html");
}

async function sendStatic(response, pathname) {
  let file = safeFilePath(pathname);
  if (!existsSync(file)) {
    response.writeHead(404).end("Not found");
    return;
  }
  if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  response.setHeader("Content-Type", mimeTypes.get(extname(file)) ?? "application/octet-stream");
  response.setHeader("X-Content-Type-Options", "nosniff");
  createReadStream(file).pipe(response);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === "/sandbox.html") {
    response.writeHead(404).end("Sandbox is served from the isolated origin on port 8081.");
    return;
  }
  await sendStatic(response, url.pathname === "/" ? "/index.html" : url.pathname);
}).listen(hostPort, "0.0.0.0", () => console.log(`Gadget host listening on ${hostPort}`));

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname !== "/" && url.pathname !== "/sandbox.html" && !url.pathname.startsWith("/assets/")) {
    response.writeHead(404).end("Sandbox origin only serves the proxy and its build assets.");
    return;
  }
  let csp;
  if (url.searchParams.has("csp")) {
    try { csp = JSON.parse(url.searchParams.get("csp")); } catch { csp = undefined; }
  }
  response.setHeader("Content-Security-Policy", buildCspHeader(csp));
  response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  await sendStatic(response, url.pathname === "/" ? "/sandbox.html" : url.pathname);
}).listen(sandboxPort, "0.0.0.0", () => console.log(`Sandbox proxy listening on ${sandboxPort}`));
