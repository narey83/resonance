const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { applyCompatibilityPatches } = require('./apply-node-compat.cjs');

const fromFrontend = createRequire(path.join(__dirname, '../package.json'));
applyCompatibilityPatches();

test('compatibility fixes can be applied repeatedly', () => {
  assert.equal(applyCompatibilityPatches(), 0);
});

test('ESM resolution preserves missing-file, real-file and directory behaviour', () => {
  const resolver = fromFrontend(
    'eslint-plugin-n/lib/converted-esm/import-meta-resolve.js',
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resonance-resolve-'));
  try {
    fs.writeFileSync(path.join(root, 'present.mjs'), 'export default 1;');
    fs.mkdirSync(path.join(root, 'folder'));
    const context = {
      parentURL: pathToFileURL(path.join(root, 'entry.mjs')).href,
    };
    assert.equal(
      resolver.defaultResolve('./present.mjs', context).url,
      pathToFileURL(fs.realpathSync(path.join(root, 'present.mjs'))).href,
    );
    assert.throws(
      () => resolver.defaultResolve('resonance-nonexistent-package', context),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    assert.throws(() => resolver.defaultResolve('./folder', context), {
      code: 'ERR_UNSUPPORTED_DIR_IMPORT',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
const close = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
  });

const withProxy = async (check) => {
  const proxyModule = fromFrontend('http-proxy');
  const sockets = new Set();
  const target = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        path: request.url,
        header: request.headers['x-compat-check'],
      }),
    );
  });
  target.on('upgrade', (request, socket) => {
    const accept = crypto
      .createHash('sha1')
      .update(
        request.headers['sec-websocket-key'] +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
      )
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + accept,
        '',
        '',
      ].join(String.fromCodePoint(13, 10)),
    );
  });
  const targetPort = await listen(target);
  const proxy = proxyModule.createProxyServer({
    target: 'http://127.0.0.1:' + targetPort,
    ws: true,
  });
  const gateway = http.createServer((request, response) =>
    proxy.web(request, response),
  );
  gateway.on('upgrade', (request, socket, head) =>
    proxy.ws(request, socket, head),
  );
  for (const server of [target, gateway])
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
  try {
    const port = await listen(gateway);
    await check(port);
  } finally {
    for (const socket of sockets) socket.destroy();
    proxy.close();
    await Promise.all([close(gateway), close(target)]);
  }
};

test(
  'HTTP proxy retains request path and headers without deprecated extend',
  { timeout: 10_000 },
  async () => {
    await withProxy(async (port) => {
      const body = await new Promise((resolve, reject) => {
        http
          .get(
            {
              hostname: '127.0.0.1',
              port,
              path: '/probe?value=1',
              headers: { 'x-compat-check': 'preserved' },
            },
            (response) => {
              let text = '';
              response.setEncoding('utf8');
              response.on('data', (part) => {
                text += part;
              });
              response.on('end', () => resolve(JSON.parse(text)));
            },
          )
          .on('error', reject);
      });
      assert.deepEqual(body, { path: '/probe?value=1', header: 'preserved' });
    });
  },
);

test(
  'WebSocket proxy retains upgrade support without deprecated extend',
  { timeout: 10_000 },
  async () => {
    await withProxy(async (port) => {
      const status = await new Promise((resolve, reject) => {
        const request = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/socket',
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          },
        });
        request.on('upgrade', (response, socket) => {
          socket.destroy();
          resolve(response.statusCode);
        });
        request.on('error', reject);
        request.end();
      });
      assert.equal(status, 101);
    });
  },
);
