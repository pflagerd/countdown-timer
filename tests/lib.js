'use strict';
/*
 * Shared helpers for the countdown-timer tests.
 * In server mode each run starts its own server.js on a free port, so it never
 * collides with a server you already have running (and every run gets fresh
 * browser storage, because storage is per origin and the port is part of the
 * origin). In file mode the app is opened straight from app/countdown.html.
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

/** Start server.js on `port` and wait until it accepts connections. */
async function startServer(port) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', String(port), '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    if (await portOpen(port)) return proc;
    await sleep(100);
  }
  proc.kill();
  throw new Error(`server.js did not start on port ${port}`);
}

/** Browser launch options; set CHROMIUM_PATH to use a specific Chromium binary. */
function launchOptions(extra = {}) {
  const opts = { ...extra };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return opts;
}

/** Tiny PASS/FAIL reporter. */
function reporter(suite) {
  let fails = 0, count = 0;
  console.log(`\n== ${suite} ==`);
  return {
    check(name, ok, info) {
      count++;
      if (!ok) fails++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  — ' + info : ''}`);
    },
    finish(extraErrors = []) {
      for (const e of extraErrors) { fails++; console.log(`FAIL  page error: ${e}`); }
      console.log(`${suite}: ${count - (fails - extraErrors.length)}/${count} passed${extraErrors.length ? `, ${extraErrors.length} page error(s)` : ''}`);
      return fails;
    },
  };
}

/** Read the visible state of the timer from a page. */
function view(page) {
  return page.evaluate(() => ({
    digits: document.getElementById('digits').textContent,
    status: document.getElementById('status').textContent,
    muted: document.getElementById('muteBtn').getAttribute('aria-pressed'),
    title: document.title,
  }));
}

/** The controls only take clicks while the pointer is over the clock (#12): hover it first. */
async function revealControls(page) {
  await page.hover('#face', { position: { x: 10, y: 10 } }); await sleep(250);
}

/**
 * What to test: COUNTDOWN_TEST_MODE=server (default) starts server.js on a free
 * port and returns its http://localhost URL; COUNTDOWN_TEST_MODE=file returns
 * the file:// URL of app/countdown.html (the launcher's default mode), no server.
 */
async function startTarget() {
  if (process.env.COUNTDOWN_TEST_MODE === 'file') {
    return { mode: 'file', URL: pathToFileURL(path.join(ROOT, 'app', 'countdown.html')).href, srv: null, stop() {} };
  }
  const port = await freePort();
  const srv = await startServer(port);
  return { mode: 'server', URL: `http://localhost:${port}/`, srv, stop() { srv.kill(); } };
}

module.exports = { chromium, ROOT, sleep, freePort, startServer, startTarget, launchOptions, reporter, view, revealControls };
