import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const frontendRoot = resolve(repositoryRoot, 'apps/frontend/dist-host');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

export function contentType(path) {
  return (
    contentTypes.get(extname(path).toLowerCase()) ?? 'application/octet-stream'
  );
}

export function resolveFrontendPath(pathname, root = frontendRoot) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (
    decoded.includes('\0') ||
    decoded.split('/').some((part) => part.startsWith('.'))
  ) {
    return undefined;
  }
  const candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return undefined;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (extname(decoded).length > 0) return undefined;
  return resolve(root, 'index.html');
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  const host = process.env.VERA_FRONTEND_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.VERA_FRONTEND_PORT?.trim() || '8081');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    fail('VERA_FRONTEND_HOST must remain loopback-only.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail('VERA_FRONTEND_PORT must be a valid TCP port.');
  }
  if (!existsSync(resolve(frontendRoot, 'index.html'))) {
    fail('The production frontend is missing. Run npm run build:host first.');
  }

  const server = createServer((request, response) => {
    if (request.url === '/_health') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      });
      response.end('{"status":"ok","service":"vera-frontend"}\n');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const pathname = new URL(request.url ?? '/', 'http://vera.local').pathname;
    const path = resolveFrontendPath(pathname);
    if (path === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'cache-control': path.endsWith('index.html')
        ? 'no-store'
        : 'public, max-age=31536000, immutable',
      'content-type': contentType(path),
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(path).pipe(response);
  });

  const shutDown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutDown);
  process.once('SIGTERM', shutDown);
  server.listen(port, host, () => {
    process.stdout.write(`Vera frontend listening on http://${host}:${port}\n`);
  });
}
