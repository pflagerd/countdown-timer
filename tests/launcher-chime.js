'use strict';
// End to end: does the chime play with no click when the timer is started by
// the real launcher (./countdown 0:05), in file and --server mode? Headed:
// needs a display, and briefly opens real Chromium windows.
//
// Method: the launcher starts Playwright's Chromium (through a small wrapper
// that adds a remote-debugging port); the test attaches and only *listens* to
// the console. Nothing is clicked or evaluated (that would count as a click).
// When Chromium blocks audio it logs "The AudioContext was not allowed to
// start". A control run without the launcher's own profile (no allow-sound
// switch) must show that warning, so the check can tell the two apart.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, ROOT, sleep, reporter } = require('./lib');

const PORT = 9335;
const BLOCKED = /AudioContext was not allowed to start/;

(async () => {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.log('\n== launcher-chime ==\nSKIP  no display (set DISPLAY or WAYLAND_DISPLAY)');
    process.exit(0);
  }
  const t = reporter('launcher-chime');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'countdown-chime-test-'));
  const exe = process.env.CHROMIUM_PATH || chromium.executablePath();
  const sandbox = process.getuid && process.getuid() === 0 ? ' --no-sandbox' : '';   // root (e.g. in a container) needs it
  const wrap = (name, extra) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, `#!/bin/sh\nexec '${exe}'${sandbox} --remote-debugging-port=${PORT} ${extra} "$@"\n`, { mode: 0o755 });
    return f;
  };
  // Through the launcher's own profile handling (this is what you get by default):
  const viaLauncher = wrap('chrome', '');
  // Control: launcher told not to use its profile; a throwaway profile without the allow-sound switch.
  const control = wrap('chrome-control', `--no-first-run --user-data-dir='${path.join(tmp, 'control-profile')}'`);

  async function listen() {
    let browser, page;
    for (let i = 0; i < 100 && !browser; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(100); } }
    if (!browser) return { error: 'could not attach to the browser' };
    for (let i = 0; i < 100 && !page; i++) { page = browser.contexts().flatMap((c) => c.pages()).find((p) => /countdown\.html|localhost/.test(p.url())); if (!page) await sleep(100); }
    if (!page) { await browser.close().catch(() => {}); return { error: 'timer window not found' }; }
    const msgs = [];
    page.on('console', (m) => msgs.push(m.text()));
    await sleep(7000);                                  // the timer runs 0:05
    await browser.close().catch(() => {});
    return { blocked: msgs.some((m) => BLOCKED.test(m)), msgs };
  }

  async function launch(mode, browserWrapper, env) {
    spawnSync('pkill', ['-f', `remote-debugging-port=${PORT}`]);
    const args = mode === 'server' ? ['--server', '0:05'] : ['0:05'];
    spawn(path.join(ROOT, 'countdown'), args, {
      detached: true, stdio: 'ignore',
      env: { ...process.env, HOME: path.join(tmp, 'home'), COUNTDOWN_BROWSER: browserWrapper, COUNTDOWN_PORT: '8787', ...env },
    }).unref();
    const r = await listen();
    spawnSync('pkill', ['-f', `remote-debugging-port=${PORT}`]);
    spawnSync('pkill', ['-f', 'server.js --port 8787']);
    await sleep(500);
    return r;
  }

  try {
    fs.mkdirSync(path.join(tmp, 'home'));
    for (const mode of ['file', 'server']) {
      let r = await launch(mode, viaLauncher, { COUNTDOWN_PROFILE: path.join(tmp, 'timer-profile') });
      t.check(`${mode}: ./countdown with its own profile, never clicked: chime not blocked`, !r.error && !r.blocked, r.error || (r.blocked ? 'blocked' : 'no autoplay warning'));
      r = await launch(mode, control, { COUNTDOWN_PROFILE: 'none' });
      t.check(`${mode}: control (no allow-sound switch): chime blocked, so the check above is meaningful`, !r.error && r.blocked, r.error || (r.blocked ? 'blocked' : 'NOT blocked'));
    }
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    spawnSync('pkill', ['-f', `remote-debugging-port=${PORT}`]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(t.finish() ? 1 : 0);
})();
