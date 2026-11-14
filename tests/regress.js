'use strict';
// Functional, layout, #8 (closing stops the timer) and offline / file-mode checks. Headless.
// Runs against server.js (default) or the file:// version (COUNTDOWN_TEST_MODE=file).
const { chromium, sleep, startTarget, launchOptions, reporter, view, revealControls } = require('./lib');

(async () => {
  const target = await startTarget();
  const { URL } = target;
  const t = reporter(`regress [${target.mode}]`);
  const b = await chromium.launch(launchOptions());
  const ctx = await b.newContext({ viewport: { width: 420, height: 420 } });
  const errs = []; ctx.on('weberror', (e) => errs.push(String(e.error())));
  const consoleMsgs = [];
  ctx.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') consoleMsgs.push(`${m.type()}: ${m.text().split('\n')[0]}`); });
  const open = async (u = URL) => { const p = await ctx.newPage(); await p.goto(u); await sleep(250); return p; };
  try {
    let p, v;

    // --- timer basics
    p = await open(URL + '?t=0:12&autostart=1'); v = await view(p);
    t.check('?t=0:12&autostart=1 starts; params stripped from URL', v.status.startsWith('ends') && p.url() === URL, `${v.digits} ${p.url()}`);
    const shown = await p.evaluate(() => { const s = document.getElementById('status'); return { text: s.textContent, upper: getComputedStyle(s).textTransform }; });
    t.check('#7 status reads "ENDS AT <time>" while running', /^ends at \d{1,2}:\d{2}/.test(shown.text) && shown.upper === 'uppercase', `${shown.text} (${shown.upper})`);
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
    await p.selectOption('#presetSelect', '60');
    await p.keyboard.press('ArrowUp'); v = await view(p);
    t.check('preset 1h + ArrowUp = 1:01:00', v.digits === '1:01:00', v.digits);
    await p.keyboard.press('Space'); await sleep(1300); v = await view(p);
    t.check('Space after choosing a preset starts the timer', v.digits === '1:00:59', v.digits);
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

    // --- tooltip on disabled controls: shown only while the timer runs, only over disabled controls
    {
      const tip = (sel) => p.evaluate((sel) => getComputedStyle(document.querySelector(sel), '::after').opacity, sel);
      await p.goto(URL); await sleep(300);
      await revealControls(p); await p.hover('#inM'); await sleep(300);
      t.check('tooltip: not shown over the time fields when the timer is not running', (await tip('.setter')) === '0');
      await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('Space'); await sleep(300);
      await revealControls(p); await p.hover('#inM'); await sleep(300);
      t.check('tooltip: shown over a disabled time field while running', (await tip('.setter')) === '1');
      await p.hover('#startBtn'); await sleep(300);
      t.check('tooltip: not shown over an enabled control while running', (await tip('.setter')) === '0');
      await p.hover('#presetSelect'); await sleep(300);
      t.check('tooltip: shown over the disabled preset dropdown while running', (await tip('.setter')) === '1');
      await p.keyboard.press('r');
    }

    // --- presets dropdown
    t.check('presets are a dropdown (no row of preset buttons)', (await p.locator('#presetSelect option').count()) === 8 && (await p.locator('#presets').count()) === 0);
    await p.selectOption('#presetSelect', '25'); v = await view(p);
    t.check('dropdown: 25 sets 25:00 and resets to "Preset…"', v.digits === '25:00' && (await p.inputValue('#presetSelect')) === '', v.digits);
    await p.keyboard.press('Space'); await sleep(300);
    t.check('dropdown is disabled while running', await p.isDisabled('#presetSelect')); await p.keyboard.press('r');

    {
      // --- controls overlaid on the clock, shown only on hover / focus (#12)
      const ctl = () => p.evaluate(() => {
        const c = document.getElementById('controls'), f = document.getElementById('face');
        const r = document.getElementById('startBtn').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { opacity: getComputedStyle(c).opacity, inFace: f.contains(c), startHit: !!hit && !!hit.closest('#startBtn') };
      });
      await p.setViewportSize({ width: 420, height: 420 }); await p.goto(URL); await sleep(300);
      await p.mouse.move(0, 0); await sleep(800); let c = await ctl();
      t.check('overlay: controls sit inside the clock face', c.inFace);
      t.check('overlay: controls hidden and not clickable when the pointer is away', c.opacity === '0' && !c.startHit, JSON.stringify(c));
      await p.mouse.move(210, 210); await sleep(400); c = await ctl();
      t.check('overlay: controls shown and clickable while hovering the clock', c.opacity === '1' && c.startHit, JSON.stringify(c));
      await p.click('#resetBtn'); v = await view(p);
      t.check('overlay: clicking a control does not also start the timer', v.status === 'ready', v.status);
      await p.mouse.click(210, 120); await sleep(300); v = await view(p);
      t.check('overlay: clicking the clock (outside the controls) starts the timer', v.status.startsWith('ends'), v.status);
      await p.keyboard.press('r');
      // The overlay is only as big as the controls: its width equals its widest row.
      const box = await p.evaluate(() => {
        const c = document.getElementById('controls').getBoundingClientRect();
        const rows = [...document.querySelectorAll('#controls .row')].filter((r) => r.offsetParent).map((r) => {
          const kids = [...r.children].filter((k) => k.offsetParent).map((k) => k.getBoundingClientRect());
          return Math.max(...kids.map((k) => k.right)) - Math.min(...kids.map((k) => k.left));
        });
        const a = document.getElementById('startBtn').getBoundingClientRect(), b = document.getElementById('resetBtn').getBoundingClientRect();
        return { overlay: Math.round(c.width), widestRow: Math.round(Math.max(...rows)), gapX: (a.right + b.left) / 2, gapY: (a.top + a.bottom) / 2 };
      });
      t.check('overlay: overlay is only as wide as its widest row of controls', Math.abs(box.overlay - box.widestRow) <= 2, `${box.overlay} vs ${box.widestRow}`);
      await p.mouse.click(box.gapX, box.gapY); await sleep(300); v = await view(p);
      t.check('overlay: clicking a gap inside the overlay does not start the timer', v.status === 'ready', v.status);
      await p.setViewportSize({ width: 700, height: 320 }); await sleep(200);
      await p.mouse.click(20, 160); await sleep(300); v = await view(p);
      t.check('overlay: clicking the window margin outside the clock starts the timer', v.status.startsWith('ends'), v.status);
      await p.mouse.click(680, 300); await sleep(300); v = await view(p);
      t.check('overlay: ...and clicking again pauses it', v.status === 'paused', v.status);
      await p.keyboard.press('r'); await p.setViewportSize({ width: 420, height: 420 }); await sleep(200);
      await p.mouse.move(0, 0); await sleep(800); await p.focus('#inM'); await sleep(300); c = await ctl();
      t.check('overlay: keyboard focus in the controls reveals them', c.opacity === '1', c.opacity);
      await p.evaluate(() => document.activeElement.blur());
    }

    // --- layout invariants across window sizes
    const bad = [];
    for (const [w, h] of [[440, 620], [440, 500], [640, 300], [900, 150], [1280, 720], [1920, 1080], [260, 260], [150, 900], [80, 80], [500, 500]]) {
      await p.setViewportSize({ width: w, height: h }); await sleep(120);
      const i = await p.evaluate(() => {
        const f = document.getElementById('face').getBoundingClientRect(), c = document.getElementById('controls').getBoundingClientRect();
        const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
        const se = document.scrollingElement;
        const inView = (x) => x.left >= -0.5 && x.top >= -0.5 && x.right <= innerWidth + 0.5 && x.bottom <= innerHeight + 0.5;
        // The controls are overlaid on the clock (#12): they must stay inside the face and the window.
        const inFace = c.left >= f.left - 0.5 && c.right <= f.right + 0.5 && c.top >= f.top - 0.5 && c.bottom <= f.bottom + 0.5;
        return { ok: inView(f) && inView(c) && inFace && se.scrollWidth <= innerWidth && se.scrollHeight <= innerHeight && f.width / s >= 199 };
      });
      if (!i.ok) bad.push(`${w}x${h}`);
    }
    t.check('layout: no scroll bars, clock fully visible and >= 200px, controls inside the clock (10 sizes)', bad.length === 0, bad.join(' ') || 'ok');

    await p.setViewportSize({ width: 420, height: 420 });
    if (target.mode === 'server') {
      // --- offline: server stopped, reload served from the service-worker cache
      await p.goto(URL);
      await p.evaluate(() => navigator.serviceWorker.ready); await sleep(300);
      target.stop(); await sleep(400);
      const r = await p.reload().catch(() => null);
      t.check('offline: reload served from the service-worker cache (HTTP 200)', !!r && r.status() === 200, r && r.status());
    } else {
      // --- file mode: no service worker is registered (browsers don't allow it on file://)
      await p.goto(URL); await sleep(500);
      const regs = await p.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length).catch(() => 0));
      t.check('file mode: no service worker registered', regs === 0, regs);
    }
    t.check('no console warnings or errors during the run', consoleMsgs.length === 0, consoleMsgs.slice(0, 3).join(' | ') || 'none');
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    await b.close(); target.stop();
  }
  process.exit(t.finish(errs) ? 1 : 0);
})();
