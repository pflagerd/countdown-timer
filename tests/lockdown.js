'use strict';
// Kiosk-style lock-down: right-click, dragging and browser shortcuts are
// cancelled, while the app's own keys, typing in the time fields, Tab and
// Enter-on-buttons still work. Headless.
//
// Note: this checks the page side only (the page receives each key and cancels
// its default). Playwright's injected keys never trigger Chromium's own
// shortcuts, even without the lock-down, so whether Chromium actually skips
// e.g. Ctrl+S has to be checked by hand with a real keyboard.
const { chromium, sleep, freePort, startServer, launchOptions, reporter, view } = require('./lib');

const BLOCKED = ['Control+s', 'Control+p', 'Control+r', 'F5', 'Control+Equal', 'Control+Minus', 'Control+0', 'Control+f', 'Control+u',
  'F12', 'Control+Shift+i', 'Control+a', 'Alt+ArrowLeft', 'Backspace', 'F11', 'Control+t', 'Control+n', 'Control+w',
  'Control+Shift+r', 'F1', 'F3', 'F7', 'Alt+Home'];

(async () => {
  const port = await freePort();
  const URL = `http://localhost:${port}/`;
  const srv = await startServer(port);
  const t = reporter('lockdown');
  const b = await chromium.launch(launchOptions());
  const p = await b.newPage({ viewport: { width: 440, height: 620 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  try {
    await p.goto(URL);
    // Record defaultPrevented at the end of dispatch (bubble phase on window, after the app's handlers).
    await p.evaluate(() => {
      window.__log = [];
      for (const type of ['keydown', 'contextmenu', 'dragstart']) {
        addEventListener(type, (e) => window.__log.push({ type, key: e.key, prevented: e.defaultPrevented }));
      }
    });
    const last = () => p.evaluate(() => window.__log[window.__log.length - 1]);
    let v, l;

    // 1. browser shortcuts
    const notBlocked = [];
    for (const k of BLOCKED) { await p.keyboard.press(k); l = await last(); if (!(l && l.type === 'keydown' && l.prevented)) notBlocked.push(k); }
    t.check(`${BLOCKED.length} browser shortcuts have their default cancelled`, notBlocked.length === 0, notBlocked.join(' ') || 'all');

    // 2. right-click and dragging
    for (const sel of ['#face', '#startBtn', '#inM']) {
      await p.click(sel, { button: 'right' }); l = await last();
      t.check(`right-click on ${sel}: context menu cancelled`, l.type === 'contextmenu' && l.prevented);
    }
    await p.evaluate(() => document.getElementById('face').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })));
    l = await last(); t.check('dragstart cancelled', l.type === 'dragstart' && l.prevented);
    await p.click('#face', { button: 'right' }); v = await view(p);
    t.check('right-click does not start the timer', v.status === 'ready', v.status);

    // 3. the app's own shortcuts still work
    await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('ArrowUp'); v = await view(p); t.check('ArrowUp adds a minute', v.digits === '06:00', v.digits);
    await p.keyboard.press('m'); v = await view(p); t.check('M mutes', v.muted === 'true');
    await p.keyboard.press('m');
    await p.keyboard.press('Space'); await sleep(1200); v = await view(p); t.check('Space starts', v.status.startsWith('ends'), v.status);
    await p.keyboard.press('Space'); v = await view(p); t.check('Space pauses', v.status === 'paused', v.status);
    await p.keyboard.press('r'); v = await view(p); t.check('R resets', v.status === 'ready' && v.digits === '06:00', v.digits);

    // 4. typing in the time fields
    await p.click('#inM'); await p.keyboard.type('12'); v = await view(p);
    t.check('typing 12 in the minutes field sets 12:00', v.digits === '12:00', v.digits);
    await p.keyboard.press('Backspace'); l = await last();
    t.check('Backspace works in a field', !l.prevented && (await p.inputValue('#inM')) === '1', await p.inputValue('#inM'));
    await p.keyboard.press('Control+a'); l = await last(); t.check('Ctrl+A in a field is cancelled', l.prevented);
    await p.keyboard.type('2'); await p.keyboard.press('Enter'); await sleep(300); v = await view(p);
    t.check('Enter in a field starts the timer', v.status.startsWith('ends'), v.status);
    await p.keyboard.press('r');

    // 5. Tab, and Enter / Space on a focused button
    await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('Tab'); l = await last();
    const focused = await p.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    t.check('Tab moves focus', !l.prevented && focused !== 'BODY', focused);
    await p.focus('#muteBtn'); await p.keyboard.press('Enter'); v = await view(p);
    t.check('Enter on a focused button presses it once', v.muted === 'true' && v.status === 'ready', JSON.stringify(v));
    await p.keyboard.press('Enter'); v = await view(p); t.check('...and again', v.muted === 'false');
    await p.focus('#muteBtn'); await p.keyboard.press('Space'); await sleep(300); v = await view(p);
    t.check('Space on a focused button toggles the timer, not the button', v.status.startsWith('ends') && v.muted === 'false', JSON.stringify(v));
    await p.keyboard.press('r');

    // 6. the preset dropdown still works
    await p.setViewportSize({ width: 300, height: 420 }); await p.selectOption('#presetSelect', '25'); v = await view(p);
    t.check('preset dropdown still works', v.digits === '25:00', v.digits);
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    await b.close(); srv.kill();
  }
  process.exit(t.finish(errs) ? 1 : 0);
})();
