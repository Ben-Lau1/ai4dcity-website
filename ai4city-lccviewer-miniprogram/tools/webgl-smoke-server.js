'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8791;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function proxyRemote(request, response, pathname) {
  const upstream = https.request({
    hostname: 'www.ai4dcity.com',
    method: 'GET',
    path: pathname.slice('/remote'.length),
    headers: request.headers.range ? { Range: request.headers.range } : {},
  }, (remote) => {
    response.writeHead(remote.statusCode || 502, remote.headers);
    remote.pipe(response);
  });
  upstream.on('error', (error) => {
    response.writeHead(502, { 'Content-Type': 'text/plain' });
    response.end(error.message);
  });
  upstream.end();
}

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  if (pathname.startsWith('/remote/')) {
    proxyRemote(request, response, pathname);
    return;
  }
  const relative = pathname === '/' ? '/tools/webgl-smoke.html' : pathname;
  const filePath = path.resolve(root, `.${relative}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    response.end(data);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Native renderer smoke test: http://127.0.0.1:${port}/`);
});
