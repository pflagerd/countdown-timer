'use strict';
// Real app-mode window (chromium --app=URL), headed: needs a display, and
// briefly opens real windows. Run with `npm run test:headed`.
// Checks issue #8 end to end and that the page can close its own window.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, sleep, freePort, startServer, launchOptions, reporter, view } = require('./lib');

(async () => {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.log('\n== app-window ==\nSKIP  no display (set DISPLAY or WAYLAND_DISPLAY)');
    process.exit(0);
  }
  const port = await freePort();
  const URL = `http://localhost:${port}/`;
  const srv = await startServer(port);
  const t = reporter('app-window');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'countdown-test-profile-'));
  const launch = (u) => chromium.launchPersistentContext(profile, launchOptions({ headless: false, args: [`--app=${u}`] }));
  const appPage = async (ctx) => {
    for (let i = 0; i < 50; i++) { const p = ctx.pages().find((x) => x.url().startsWith(URL)); if (p) return p; await sleep(100); }
    throw new Error('app window did not appear');
  };
  let ctx;
  try {
    ctx = await launch(URL + '?t=25m&autostart=1'); let p = await appPage(ctx); await sleep(1500);
    let v = await view(p); t.check('app window starts the timer from ?t=25m&autostart=1', v.status.startsWith('ends'), v.digits);
    t.check('app window has a single history entry', (await p.evaluate(() => history.length)) === 1);
    await p.reload(); await sleep(400); v = await view(p);
    t.check('#8 reload keeps the timer running', v.status.startsWith('ends'), v.status);
    await ctx.close();

    ctx = await launch(URL); p = await appPage(ctx); await sleep(500); v = await view(p);
    t.check('#8 quit Chromium + relaunch -> READY 25:00', v.status === 'ready' && v.digits === '25:00', JSON.stringify(v));
    await p.keyboard.press('Space'); await sleep(1200);
    await p.evaluate(() => window.close()); await sleep(600);
    t.check('window.close() closes the app window', p.isClosed());
    await ctx.close();

    ctx = await launch(URL); p = await appPage(ctx); await sleep(500); v = await view(p);
    t.check('#8 relaunch after window.close() -> READY', v.status === 'ready', JSON.stringify(v));
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    srv.kill(); fs.rmSync(profile, { recursive: true, force: true });
  }
  process.exit(t.finish() ? 1 : 0);
})();
