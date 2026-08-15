import http from 'node:http';

const targetHost = process.env.GADGET_HOST ?? 'gadget-host';
const targetPort = Number(process.env.GADGET_HOST_PORT ?? 8080);
const listenPort = Number(process.env.LOCAL_PROXY_PORT ?? 8080);

const server = http.createServer((request, response) => {
  const upstream = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `${targetHost}:${targetPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', (error) => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
    response.end(`E2E proxy error: ${error.message}`);
  });
  request.pipe(upstream);
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`E2E localhost proxy: http://localhost:${listenPort} -> http://${targetHost}:${targetPort}`);
});
