#!/usr/bin/env node
'use strict';
/*
 * Tiny static file server for the countdown-timer PWA (Node.js built-in modules only).
 *
 * Serves ./app on http://localhost:<port>/ . A service worker requires a
 * "secure context"; http://localhost qualifies, so no TLS is needed.
 *
 * Usage: node server.js [--port 8765] [--bind 127.0.0.1] [--quiet]
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const ROOT = path.join(__dirname, 'app');

// Explicit types for everything the app serves; these matter for a PWA.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const USAGE = `Usage: node server.js [options]

Serves ./app on http://localhost:<port>/

Options:
  --port <n>     TCP port (default: 8765)
  --bind <addr>  address to listen on (default: 127.0.0.1, i.e. this machine only)
  --quiet        don't log each request
  -h, --help     show this help`;

function parseOptions() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        port: { type: 'string', default: '8765' },
        bind: { type: 'string', default: '127.0.0.1' },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    console.error(`server.js: sorry, I didn't understand that: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (values.help) { console.log(USAGE); process.exit(0); }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`server.js: sorry, --port must be a whole number from 0 to 65535 (I got "${values.port}").\n\n${USAGE}`);
    process.exit(2);
  }
  return { port, bind: values.bind, quiet: values.quiet };
}

/** Map a request URL to a file under ROOT, or null if it would escape ROOT. */
function resolvePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(ROOT, '.' + path.posix.normalize('/' + decoded));
  return full === ROOT || full.startsWith(ROOT + path.sep) ? full : null;
}

function send(res, status, headers, body, isHead) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(isHead ? undefined : body);
}

function handle(req, res, log) {
  const isHead = req.method === 'HEAD';
  const done = (status) => log(`${req.method} ${req.url} ${status}`);
  if (req.method !== 'GET' && !isHead) {
    send(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Method Not Allowed\n', isHead);
    return done(405);
  }
  let file = resolvePath(req.url || '/');
  if (!file) {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Request\n', isHead);
    return done(400);
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      // Directory: redirect "/dir" to "/dir/", then serve its index.html.
      if (!req.url.split('?')[0].endsWith('/')) {
        const [p, q] = req.url.split('?');
        send(res, 301, { Location: p + '/' + (q !== undefined ? '?' + q : '') }, '', isHead);
        return done(301);
      }
      file = path.join(file, 'index.html');
      return fs.stat(file, (err2, st2) => serveFile(err2, st2));
    }
    serveFile(err, st);
  });

  function serveFile(err, st) {
    if (err || !st.isFile()) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found\n', isHead);
      return done(404);
    }
    const lastModified = new Date(Math.floor(st.mtimeMs / 1000) * 1000);
    const since = Date.parse(req.headers['if-modified-since'] || '');
    if (!Number.isNaN(since) && lastModified.getTime() <= since) {
      send(res, 304, { 'Last-Modified': lastModified.toUTCString() }, undefined, true);
      return done(304);
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Last-Modified': lastModified.toUTCString(),
      // "no-cache" = always revalidate; the service worker handles offline use.
      'Cache-Control': 'no-cache',
    });
    if (isHead) { res.end(); return done(200); }
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
      .on('finish', () => done(200));
  }
}

function main() {
  const { port, bind, quiet } = parseOptions();
  const log = quiet ? () => {} : (msg) => console.log(`${new Date().toISOString()} ${msg}`);
  const server = http.createServer((req, res) => handle(req, res, log));
  server.on('error', (err) => {
    const hint = err.code === 'EADDRINUSE'
      ? ` Port ${port} is already in use; please stop whatever is using it, or choose another with --port.`
      : err.code === 'EACCES'
        ? ` I'm not allowed to use port ${port}; please choose one above 1023 with --port.`
        : '';
    console.error(`server.js: sorry, I couldn't start the server (${err.message}).${hint}`);
    process.exit(1);
  });
  server.listen(port, bind, () => {
    console.log(`Serving ${ROOT} at http://localhost:${server.address().port}/  (Ctrl+C to stop)`);
  });
  const stop = () => { server.close(() => process.exit(0)); server.closeAllConnections(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
