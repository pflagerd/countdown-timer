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
const fileURL = pathToFileURL(path.join(ROOT, 'app', 'index.html')).href;
const ownProfile = `--user-data-dir=${path.join(home, '.local', 'share', 'countdown-timer', 'chromium-profile')}`;

try {
  let r = run([]);
  t.check('default: opens app/index.html from disk', r.code === 0 && has(r, `--app=${fileURL}`), r.browserArgs[0]);
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
  t.check('folder with a space and ü: URL is percent-encoded', spacedArgs[0] === `--app=${pathToFileURL(path.join(spaced, 'app', 'index.html')).href}?t=5m&autostart=1`, spacedArgs[0]);

  r = run(['--bogus']);
  t.check('unknown option: exit 2 with a message', r.code === 2 && /unknown option: --bogus/.test(r.out), r.out.split('\n')[0]);
  r = run(['5m', '10m']);
  t.check('two durations: exit 2 with a message', r.code === 2 && /more than one duration/.test(r.out), r.out.split('\n')[0]);
  r = run(['--help']);
  t.check('--help: usage text, ends at the environment section', r.code === 0 && /Usage:/.test(r.out) && /COUNTDOWN_PROFILE/.test(r.out) && !/set -euo/.test(r.out));
  r = run(['--server'], { PATH: `${path.dirname(fake)}:/usr/bin:/bin`, COUNTDOWN_PORT: '8788' });
  const nodeOnPath = spawnSync('sh', ['-c', 'command -v node'], { env: { PATH: '/usr/bin:/bin' } }).status === 0;
  if (!nodeOnPath) t.check('--server without Node.js: exit 1 with an install hint', r.code === 1 && /needs Node\.js/.test(r.out), r.out.split('\n')[0]);
} catch (e) {
  t.check('test run completed without exceptions', false, e.message);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(t.finish() ? 1 : 0);
