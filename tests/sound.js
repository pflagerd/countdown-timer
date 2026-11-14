'use strict';
// The chime: does the app actually start audio when time's up, and does it say
// so when the browser blocks sound? Headless.
//
// Chromium's real autoplay rule is used
// (https://developer.chrome.com/blog/autoplay#web_audio): a normal launch
// ("strict") blocks audio until the page has had a click or key press;
// --autoplay-policy=no-user-gesture-required ("relaxed") allows it, as for an
// installed app.
//
// How this test avoids fooling itself: any Playwright read of the page
// (page.evaluate, and even locator reads) counts as a user gesture and unlocks
// audio. So nothing is read while a scenario runs: the page records a timeline
// (status, hint, tones started, whether the page has had a gesture) every
// 50 ms, and the timeline is read only once the scenario is over. The page's
// AudioContext is instrumented only to count the tones started.
const { chromium, sleep, startTarget, launchOptions, reporter } = require('./lib');

const instrument = () => {
  let tones = 0;
  const AC = window.AudioContext;
  window.AudioContext = class extends AC {
    createOscillator() {
      const o = super.createOscillator();
      const start = o.start.bind(o);
      o.start = (...x) => { tones++; return start(...x); };
      return o;
    }
  };
  const t0 = Date.now();
  window.__timeline = [];
  setInterval(() => {
    const status = document.getElementById('status');
    if (!status) return;
    window.__timeline.push({
      t: Date.now() - t0,
      status: status.textContent,
      hint: !document.getElementById('soundHint').hidden,
      tones,
      activated: navigator.userActivation.hasBeenActive,
    });
  }, 50);
};

(async () => {
  const target = await startTarget();
  const { URL } = target;
  const t = reporter(`sound [${target.mode}]`);
  const errs = [];
  const strictBrowser = await chromium.launch(launchOptions());
  const relaxedBrowser = await chromium.launch(launchOptions({ args: ['--autoplay-policy=no-user-gesture-required'] }));
  try {
    /** Run one scenario: open the page, perform `actions` (no reads!), then return the recorded timeline. */
    const scenario = async (strict, url, actions) => {
      const p = await (strict ? strictBrowser : relaxedBrowser).newPage({ viewport: { width: 420, height: 420 } });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.addInitScript(instrument);
      await p.goto(url);
      await actions(p);
      const tl = await p.evaluate(() => window.__timeline);   // the only read, after the fact
      await p.close();
      return tl;
    };
    const running = (s) => s.status.startsWith('ends');
    const done = (s) => s.status === "time's up";
    const summary = (tl) => JSON.stringify(tl.filter((s, i) => i === 0 || s.status !== tl[i - 1].status || s.hint !== tl[i - 1].hint || s.tones !== tl[i - 1].tones)
      .map((s) => `${s.t}ms ${s.status} hint=${s.hint} tones=${s.tones} act=${s.activated}`));
    let tl;

    // 1. Normal browser policy, started by ./countdown 25m (autostart), never clicked.
    tl = await scenario(true, URL + '?t=0:02&autostart=1', async () => { await sleep(3500); });
    t.check('no click, sound blocked: hint shown while running', tl.filter(running).slice(4).every((s) => s.hint) && tl.some(running), summary(tl));
    t.check('...still shown at time-up, and no tones (browser blocks them; the app says so)', tl.some(done) && tl.filter(done).every((s) => s.hint && s.tones === 0), summary(tl));
    t.check('...the page was never treated as clicked (test is not fooling itself)', tl.every((s) => !s.activated), summary(tl));

    // 2. Same, then one click while ringing.
    tl = await scenario(true, URL + '?t=0:02&autostart=1', async (p) => { await sleep(2800); await p.mouse.click(210, 120); await sleep(1800); });
    const after = tl.filter((s) => s.activated);
    t.check('one click while ringing: chime starts, alarm NOT dismissed, hint gone',
      after.length > 0 && after.every(done) && after[after.length - 1].tones > 0 && !after[after.length - 1].hint, summary(tl));

    // 3. Autostart, one click while running: the click only enables sound.
    tl = await scenario(true, URL + '?t=0:03&autostart=1', async (p) => { await sleep(800); await p.mouse.click(210, 120); await sleep(3500); });
    const clicked = tl.filter((s) => s.activated);
    t.check('one click while running: timer keeps running (the click only enabled sound), hint gone',
      clicked.length > 0 && clicked.filter((s) => !done(s)).every((s) => running(s) && !s.hint), summary(tl));
    t.check('...and the chime plays at time-up', tl.filter(done).some((s) => s.tones > 0), summary(tl));

    // 4. Started by clicking the clock.
    tl = await scenario(true, URL + '?t=0:02', async (p) => { await sleep(300); await p.mouse.click(210, 120); await sleep(2800); });
    t.check('started by clicking the clock: no hint, chime plays at time-up',
      tl.filter(running).every((s) => !s.hint) && tl.filter(done).some((s) => s.tones > 0), summary(tl));

    // 5. Muted.
    tl = await scenario(true, URL + '?t=0:02', async (p) => { await sleep(300); await p.keyboard.press('m'); await p.keyboard.press('Space'); await sleep(2800); await p.keyboard.press('m'); });
    t.check('muted: no hint and no tones', tl.filter((s) => running(s) || done(s)).every((s) => !s.hint) && tl.filter(done).some(() => true) && tl.filter(done).slice(0, 10).every((s) => s.tones === 0), summary(tl));

    // 6. Browser allows sound without a click (installed app / command-line switch).
    tl = await scenario(false, URL + '?t=0:02&autostart=1', async () => { await sleep(3200); });
    t.check('sound allowed without a click: autostart, never clicked, still chimes at time-up', tl.filter(done).some((s) => s.tones > 0), summary(tl));
    t.check('...and no hint once the chime is playing', tl.filter((s) => done(s) && s.tones > 0).every((s) => !s.hint), summary(tl));
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    await strictBrowser.close();
    await relaxedBrowser.close();
    target.stop();
  }
  process.exit(t.finish(errs) ? 1 : 0);
})();
