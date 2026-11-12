'use strict';
// Functional, layout, #8 (closing stops the timer) and offline checks. Headless.
const { chromium, sleep, freePort, startServer, launchOptions, reporter, view } = require('./lib');

(async () => {
  const port = await freePort();
  const URL = `http://localhost:${port}/`;
  let srv = await startServer(port);
  const t = reporter('regress');
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport: { width: 440, height: 620 } });
  const errs = []; ctx.on('weberror', (e) => errs.push(String(e.error())));
  const open = async (u = URL) => { const p = await ctx.newPage(); await p.goto(u); await sleep(250); return p; };
  try {
    let p, v;

    // --- timer basics
    p = await open(URL + '?t=0:12&autostart=1'); v = await view(p);
    t.check('?t=0:12&autostart=1 starts; params stripped from URL', v.status.startsWith('ends') && p.url() === URL, `${v.digits} ${p.url()}`);
    await sleep(3200); v = await view(p);
    t.check('counts down', v.digits === '00:09' || v.digits === '00:08', v.digits);
    await p.keyboard.press('Space'); const pd = (await view(p)).digits; await sleep(1200); v = await view(p);
    t.check('pause holds the time', v.status === 'paused' && v.digits === pd, v.digits);
    await p.reload(); await sleep(250); v = await view(p);
    t.check('reload keeps the paused state', v.status === 'paused' && v.digits === pd, v.digits);
    await p.keyboard.press('Space'); await sleep(9500); v = await view(p);
    t.check("finishes: overtime, TIME'S UP, ⏰ in title", v.status === "time's up" && v.digits.startsWith('+') && v.title.startsWith('⏰'), JSON.stringify(v));
    await p.keyboard.press('Escape'); v = await view(p);
    t.check('Esc resets to the duration', v.status === 'ready' && v.digits === '00:12', v.digits);
    await p.click('button[data-min="60"]'); await p.keyboard.press('ArrowUp'); v = await view(p);
    t.check('preset 1h + ArrowUp = 1:01:00', v.digits === '1:01:00', v.digits);
    await p.keyboard.press('Space'); await sleep(1300); v = await view(p);
    t.check('Space after clicking a preset starts the timer', v.digits === '1:00:59', v.digits);
    await p.keyboard.press('r');

    // --- hand angles (hour / minute / sweep)
    const ang = () => p.evaluate(() => ['hourHand', 'minHand', 'secHand'].map((id) =>
      Math.round(parseFloat(/rotate\(([-\d.e]+)\)/.exec(document.getElementById(id).getAttribute('transform'))[1]) * 100) / 100));
    for (const [dur, exp] of [['4:30', [2.25, 27, 180]], ['1:30:00', [45, 180, 0]], ['2:45:15', [82.63, 271.5, 90]], ['60m', [30, 0, 0]]]) {
      await p.goto(URL + '?t=' + dur); await sleep(150); const a = await ang();
      t.check(`hand angles at ${dur}`, a.every((x, i) => Math.abs(x - exp[i]) < 0.05), a.join('/'));
    }
    await p.goto(URL + '?t=2:45:15&autostart=1'); await sleep(200); const a1 = await ang(); await sleep(2000); const a2 = await ang();
    t.check('all three hands move counter-clockwise', a2.every((x, i) => x < a1[i]), `${a1.join('/')} -> ${a2.join('/')}`);
    await p.keyboard.press('r');

    // --- #8: closing the window stops the timer; a reload doesn't
    await p.goto(URL + '?t=25m&autostart=1'); await sleep(600); await p.close(); p = await open(); v = await view(p);
    t.check('#8 close + reopen -> READY at the last duration', v.status === 'ready' && v.digits === '25:00', JSON.stringify(v));
    await p.keyboard.press('Space'); await sleep(1300); await p.reload(); await sleep(250); v = await view(p);
    t.check('#8 reload keeps the timer running', v.status.startsWith('ends'), v.status);
    await p.keyboard.press('m'); await p.close(); p = await open(); v = await view(p);
    t.check('#8 mute survives closing; timer READY', v.muted === 'true' && v.status === 'ready', JSON.stringify(v));
    await p.keyboard.press('m');
    await p.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('countdown-timer/state/v1', JSON.stringify({ duration: 420000, remaining: 0, endAt: Date.now() - 7200000, status: 'done', muted: true }));
    });
    await p.close(); p = await open(); v = await view(p);
    const keys = await p.evaluate(() => Object.keys(localStorage).join(','));
    t.check('#8 old saved state migrates to READY 07:00, muted, old key removed',
      v.status === 'ready' && v.digits === '07:00' && v.muted === 'true' && keys === 'countdown-timer/prefs/v1', `${JSON.stringify(v)} ${keys}`);
    await p.keyboard.press('m');
    const q = await open(URL + '?t=10m&autostart=1'); v = await view(p);
    t.check('#8 a second window is an independent timer', v.status === 'ready', v.status); await q.close();

    // --- presets dropdown in small windows
    await p.setViewportSize({ width: 300, height: 420 }); await sleep(150);
    t.check('dropdown replaces the preset buttons in small windows', (await p.isVisible('#presetSelect')) && !(await p.isVisible('#presets')));
    await p.selectOption('#presetSelect', '25'); v = await view(p);
    t.check('dropdown: 25 sets 25:00 and resets to "Preset…"', v.digits === '25:00' && (await p.inputValue('#presetSelect')) === '', v.digits);
    await p.keyboard.press('Space'); await sleep(300);
    t.check('dropdown is disabled while running', await p.isDisabled('#presetSelect')); await p.keyboard.press('r');

    // --- layout invariants across window sizes
    const bad = []; const modes = {};
    for (const [w, h] of [[440, 620], [440, 500], [640, 300], [900, 150], [1280, 720], [1920, 1080], [260, 260], [150, 900], [80, 80], [500, 500]]) {
      await p.setViewportSize({ width: w, height: h }); await sleep(120);
      const i = await p.evaluate(() => {
        const f = document.getElementById('face').getBoundingClientRect(), c = document.getElementById('controls').getBoundingClientRect();
        const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
        const se = document.scrollingElement;
        const inView = (x) => x.left >= -0.5 && x.top >= -0.5 && x.right <= innerWidth + 0.5 && x.bottom <= innerHeight + 0.5;
        const overlap = !(f.right <= c.left + 0.5 || c.right <= f.left + 0.5 || f.bottom <= c.top + 0.5 || c.bottom <= f.top + 0.5);
        return { ok: inView(f) && inView(c) && !overlap && se.scrollWidth <= innerWidth && se.scrollHeight <= innerHeight && f.width / s >= 199,
                 wide: document.documentElement.classList.contains('wide') };
      });
      if (!i.ok) bad.push(`${w}x${h}`);
      modes[`${w}x${h}`] = i.wide ? 'beside' : 'below';
    }
    t.check('layout: no scroll bars, all visible, no overlap, face >= 200px (10 sizes)', bad.length === 0, bad.join(' ') || 'ok');
    t.check('layout: controls beside the clock in wide windows, below otherwise',
      modes['1280x720'] === 'beside' && modes['640x300'] === 'beside' && modes['440x620'] === 'below' && modes['150x900'] === 'below', JSON.stringify(modes));

    // --- 5 % hysteresis: at 640 wide, the switch height depends on direction
    let down = null, up = null, last = null;
    for (let h = 700; h >= 380; h -= 10) { await p.setViewportSize({ width: 640, height: h }); await sleep(30);
      const m = await p.evaluate(() => document.documentElement.classList.contains('wide')); if (last !== null && m !== last) down = h; last = m; }
    for (let h = 380; h <= 700; h += 10) { await p.setViewportSize({ width: 640, height: h }); await sleep(30);
      const m = await p.evaluate(() => document.documentElement.classList.contains('wide')); if (m !== last) up = h; last = m; }
    t.check('layout: 5 % switching margin (switch heights differ by direction)', down !== null && up !== null && up > down, `down@${down} up@${up}`);

    // --- offline: server stopped, reload served from the service-worker cache
    await p.setViewportSize({ width: 440, height: 620 }); await p.goto(URL);
    await p.evaluate(() => navigator.serviceWorker.ready); await sleep(300);
    srv.kill(); srv = null; await sleep(400);
    const r = await p.reload().catch(() => null);
    t.check('offline: reload served from the service-worker cache (HTTP 200)', !!r && r.status() === 200, r && r.status());
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    await b.close(); if (srv) srv.kill();
  }
  process.exit(t.finish(errs) ? 1 : 0);
})();
