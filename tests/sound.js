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
// (status, tones started, whether the page has had a gesture) every
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
    const summary = (tl) => JSON.stringify(tl.filter((s, i) => i === 0 || s.status !== tl[i - 1].status || s.tones !== tl[i - 1].tones || s.activated !== tl[i - 1].activated)
      .map((s) => `${s.t}ms ${s.status} tones=${s.tones} act=${s.activated}`));
    let tl;

    // 1. Sound allowed without a click (what ./countdown sets up: its own profile with
    //    --autoplay-policy=no-user-gesture-required), started by ./countdown 25m, never clicked.
    tl = await scenario(false, URL + '?t=0:02&autostart=1', async () => { await sleep(3200); });
    t.check('sound allowed (as the launcher sets up): autostart, never clicked, chimes at time-up', tl.filter(done).some((s) => s.tones > 0), summary(tl));
    t.check('...the page was never treated as clicked (test is not fooling itself)', tl.every((s) => !s.activated), summary(tl));

    // 2. Normal browser rule (e.g. COUNTDOWN_PROFILE=none), never clicked: the browser blocks it.
    tl = await scenario(true, URL + '?t=0:02&autostart=1', async () => { await sleep(3500); });
    t.check('normal rule, never clicked: chime blocked by the browser (no tones)', tl.some(done) && tl.filter(done).every((s) => s.tones === 0), summary(tl));
    t.check('...the page was never treated as clicked', tl.every((s) => !s.activated), summary(tl));

    // 3. Normal rule, started by clicking the clock.
    tl = await scenario(true, URL + '?t=0:02', async (p) => { await sleep(300); await p.mouse.click(210, 120); await sleep(2800); });
    t.check('normal rule, started by clicking the clock: chime plays at time-up', tl.filter(done).some((s) => s.tones > 0), summary(tl));

    // 4. Muted, even where sound is allowed.
    tl = await scenario(false, URL + '?t=0:02', async (p) => { await sleep(300); await p.keyboard.press('m'); await p.keyboard.press('Space'); await sleep(2800); await p.keyboard.press('m'); });
    t.check('muted: no tones at time-up', tl.some(done) && tl.filter(done).slice(0, 10).every((s) => s.tones === 0), summary(tl));

    // 5. The "click for sound" hint is gone (removed once the launcher made it unnecessary).
    const p = await relaxedBrowser.newPage();
    await p.goto(URL);
    t.check('no "click for sound" hint element in the page', (await p.locator('#soundHint, .sound-hint').count()) === 0);
    await p.close();
  } catch (e) {
    t.check('test run completed without exceptions', false, e.message);
  } finally {
    await strictBrowser.close();
    await relaxedBrowser.close();
    target.stop();
  }
  process.exit(t.finish(errs) ? 1 : 0);
})();
