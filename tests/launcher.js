'use strict';
// The ./countdown launcher, with stand-in "browsers" that record the arguments
// they're given (no real browser needed). Checks URLs, options, the timer's own
// Chromium profile (snap vs regular location, COUNTDOWN_PROFILE) and errors.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { ROOT, reporter } = require('./lib');

const t = reporter('launcher');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'countdown-launcher-test-'));
const home = path.join(tmp, 'home');
const argsFile = path.join(tmp, 'args.txt');
fs.mkdirSync(home);

// A stand-in browser: writes each argument on its own line, then exits.
const fake = path.join(tmp, 'bin', 'fake-chrome');
fs.mkdirSync(path.dirname(fake));
fs.writeFileSync(fake, `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > '${argsFile}'\n`, { mode: 0o755 });
// A snap-style browser: <dir>/snap/bin/chromium is a link to <dir>/usr/bin/snap, as on Ubuntu.
fs.mkdirSync(path.join(tmp, 'usr', 'bin'), { recursive: true });
fs.copyFileSync(fake, path.join(tmp, 'usr', 'bin', 'snap'));
fs.chmodSync(path.join(tmp, 'usr', 'bin', 'snap'), 0o755);
fs.mkdirSync(path.join(tmp, 'snap', 'bin'), { recursive: true });
fs.symlinkSync(path.join(tmp, 'usr', 'bin', 'snap'), path.join(tmp, 'snap', 'bin', 'chromium'));

const nodeDir = path.dirname(process.execPath);
function run(args, env = {}) {
  try { fs.unlinkSync(argsFile); } catch { /* none yet */ }
  const r = spawnSync(path.join(ROOT, 'countdown'), args, {
    encoding: 'utf8',
    env: { HOME: home, PATH: `${path.dirname(fake)}:${nodeDir}:/usr/bin:/bin`, COUNTDOWN_BROWSER: fake, COUNTDOWN_PORT: '8789', ...env },
  });
  const browserArgs = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : [];
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), browserArgs };
}
const has = (r, a) => r.browserArgs.includes(a);
const fileURL = pathToFileURL(path.join(ROOT, 'app', 'countdown.html')).href;
const ownProfile = `--user-data-dir=${path.join(home, '.local', 'share', 'countdown-timer', 'chromium-profile')}`;

(async () => {
try {
  let r = run([]);
  t.check('default: opens app/countdown.html from disk', r.code === 0 && has(r, `--app=${fileURL}`), r.browserArgs[0]);
  t.check('default: window size 420,420', has(r, '--window-size=420,420'));
  t.check("default: the timer's own profile under ~/.local/share", has(r, ownProfile), r.browserArgs.find((a) => a.startsWith('--user-data-dir')));
  t.check('default: sound allowed without a click', has(r, '--autoplay-policy=no-user-gesture-required'));
  t.check('default: no first-run / default-browser prompts', has(r, '--no-first-run') && has(r, '--no-default-browser-check'));
  t.check('the profile folder is created', fs.existsSync(path.join(home, '.local', 'share', 'countdown-timer', 'chromium-profile')));

  r = run(['25m']);
  t.check('duration: ?t=25m&autostart=1', has(r, `--app=${fileURL}?t=25m&autostart=1`), r.browserArgs[0]);

  r = run(['--server', '1h30m']);
  t.check('--server: http://localhost:<port>/ with the duration', r.code === 0 && has(r, '--app=http://localhost:8789/?t=1h30m&autostart=1'), r.browserArgs[0] || r.out);
  t.check("--server: also uses the timer's own profile and allows sound", has(r, ownProfile) && has(r, '--autoplay-policy=no-user-gesture-required'));
  const cmd = spawnSync('pgrep', ['-af', 'server.js --port 8789'], { encoding: 'utf8' }).stdout.trim();
  t.check('--server: starts server.js with --exit-when-idle 3m (stops by itself once no window is open)', / --exit-when-idle 3m\b/.test(cmd), cmd || 'no server.js process');
  spawnSync('pkill', ['-f', 'server.js --port 8789']);

  r = run([], { COUNTDOWN_BROWSER: '', PATH: `${path.join(tmp, 'snap', 'bin')}:/usr/bin:/bin` });
  const snapProfile = `--user-data-dir=${path.join(home, 'snap', 'chromium', 'common', 'countdown-timer-profile')}`;
  t.check("snap Chromium: profile goes in the snap's own folder (~/snap/chromium/common)", r.code === 0 && has(r, snapProfile), r.browserArgs.find((a) => a.startsWith('--user-data-dir')) || r.out);

  r = run([], { COUNTDOWN_PROFILE: 'none' });
  t.check('COUNTDOWN_PROFILE=none: your normal profile, no extra switches', r.code === 0 && r.browserArgs.length === 2, r.browserArgs.join(' '));

  r = run([], { COUNTDOWN_PROFILE: path.join(tmp, 'custom') });
  t.check('COUNTDOWN_PROFILE=<dir>: that folder is used', has(r, `--user-data-dir=${path.join(tmp, 'custom')}`));

  r = run([], { COUNTDOWN_SIZE: '300,300' });
  t.check('COUNTDOWN_SIZE', has(r, '--window-size=300,300'));

  const spaced = path.join(tmp, 'my timer ü');
  fs.mkdirSync(spaced);
  fs.cpSync(path.join(ROOT, 'app'), path.join(spaced, 'app'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'countdown'), path.join(spaced, 'countdown'));
  fs.chmodSync(path.join(spaced, 'countdown'), 0o755);
  try { fs.unlinkSync(argsFile); } catch { /* none */ }
  spawnSync(path.join(spaced, 'countdown'), ['5m'], { env: { HOME: home, PATH: process.env.PATH, COUNTDOWN_BROWSER: fake } });
  const spacedArgs = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').split('\n') : [];
  t.check('folder with a space and ü: URL is percent-encoded', spacedArgs[0] === `--app=${pathToFileURL(path.join(spaced, 'app', 'countdown.html')).href}?t=5m&autostart=1`, spacedArgs[0]);

  r = run(['--bogus']);
  t.check('unknown option: exit 2 with a polite message and the usage', r.code === 2 && /sorry, I don't recognise the option "--bogus"/.test(r.out) && /Usage:/.test(r.out), r.out.split('\n')[0]);
  r = run(['5m', '10m']);
  t.check('two durations: exit 2 with a polite message naming both', r.code === 2 && /sorry, please give just one duration \(I got "5m" and "10m"\)/.test(r.out), r.out.split('\n')[0]);
  r = run(['--help']);
  t.check('--help: usage text, ends at the environment section', r.code === 0 && /Usage:/.test(r.out) && /COUNTDOWN_PROFILE/.test(r.out) && !/set -euo/.test(r.out));
  r = run(['--server'], { PATH: `${path.dirname(fake)}:/usr/bin:/bin`, COUNTDOWN_PORT: '8788' });
  const nodeOnPath = spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: '/usr/bin:/bin' } }).status === 0;
  if (!nodeOnPath) t.check('--server without Node.js: exit 1 with a polite install hint', r.code === 1 && /sorry, --server needs Node\.js, which I couldn't find\. Please install it/.test(r.out), r.out.split('\n')[0]);

  // No browser at all: a PATH with only the basic tools the launcher needs.
  const minbin = path.join(tmp, 'minbin');
  fs.mkdirSync(minbin);
  for (const c of ['bash', 'dirname', 'readlink', 'sed', 'mkdir', 'basename']) {
    const where = spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(where, path.join(minbin, c));
  }
  r = run([], { COUNTDOWN_BROWSER: '', PATH: minbin });
  t.check('no browser found: exit 1, politely asks to set COUNTDOWN_BROWSER', r.code === 1 && /sorry, no Chromium-family browser found; please set COUNTDOWN_BROWSER/.test(r.out), r.out.split('\n')[0]);

  // server.js's own messages.
  const srv = (args) => spawnSync(process.execPath, [path.join(ROOT, 'server.js'), ...args], { encoding: 'utf8', timeout: 5000 });
  let s = srv(['--port', 'abc']);
  t.check('server.js --port abc: exit 2, polite message', s.status === 2 && /sorry, --port must be a whole number from 0 to 65535 \(I got "abc"\)/.test(s.stderr), s.stderr.split('\n')[0]);
  s = srv(['--exit-when-idle', 'soon']);
  t.check('server.js --exit-when-idle soon: exit 2, polite message', s.status === 2 && /sorry, --exit-when-idle needs a time such as 3m or 90s \(I got "soon"\)/.test(s.stderr), s.stderr.split('\n')[0]);
  s = srv(['--bogus']);
  t.check('server.js unknown option: exit 2, polite message', s.status === 2 && /sorry, I didn't understand that/.test(s.stderr), s.stderr.split('\n')[0]);
  const blocker = require('net').createServer().listen(8786, '127.0.0.1');
  await new Promise((res) => blocker.on('listening', res));
  s = await new Promise((res) => {
    const c = require('child_process').spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', '8786', '--quiet']);
    let err = ''; c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => res({ status: code, stderr: err }));
  });
  blocker.close();
  t.check('server.js on a port already in use: exit 1, polite message with a hint', s.status === 1 && /sorry, I couldn't start the server .*Port 8786 is already in use; please stop whatever is using it, or choose another with --port/.test(s.stderr), s.stderr.split('\n')[0]);

  // --exit-when-idle: a server with a 2 s limit that is pinged every second stays up,
  // then exits by itself (status 0) about 2 s after the pings stop.
  {
    const { spawn } = require('child_process');
    const started = Date.now();
    const c = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--port', '8785', '--exit-when-idle', '2s']);
    const exited = new Promise((res) => c.on('exit', (code) => res({ code, after: Date.now() - started })));
    let out = ''; c.stdout.on('data', (d) => { out += d; });
    let alive = true; exited.then(() => { alive = false; });
    await new Promise((res) => setTimeout(res, 500));
    let lastRequest = 0;
    for (let i = 0; i < 4; i++) {
      lastRequest = Date.now() - started;
      await fetch('http://127.0.0.1:8785/manifest.json', { method: 'HEAD' }).catch(() => {});
      await new Promise((res) => setTimeout(res, 1000));
    }
    t.check('server.js --exit-when-idle 2s: still running while pinged every second (4.5 s)', alive, alive ? 'running' : 'exited early');
    const e = await Promise.race([exited, new Promise((res) => setTimeout(() => res(null), 5000))]);
    if (!e) c.kill();
    t.check('server.js --exit-when-idle 2s: exits by itself (status 0) about 2 s after the last request', !!e && e.code === 0 && e.after - lastRequest >= 1900 && e.after - lastRequest <= 3500 && /no requests for 2s; stopping/.test(out),
      e ? `exit ${e.code} after ${((e.after - lastRequest) / 1000).toFixed(1)} s idle` : 'still running after 5 s');
  }
} catch (e) {
  t.check('test run completed without exceptions', false, e.message);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(t.finish() ? 1 : 0);
})();
