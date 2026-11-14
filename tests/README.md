# Tests

Browser tests for the countdown timer, driven by [Playwright](https://playwright.dev/) (Apache-2.0).
They're an **optional developer tool**: the app itself has no dependencies, and nothing here is needed to run it.

Every suite runs twice: against the default **file** version (`file://…/app/index.html`, what `./countdown` opens)
and against the **server** version (what `./countdown --server` opens). For the server runs, each suite starts its
own `server.js` on a free port, so it doesn't clash with a server you already have running on 8765. Every run starts
with clean browser storage.

To run a single suite in one mode, set `COUNTDOWN_TEST_MODE` to `file` or `server` (the default), e.g.
`COUNTDOWN_TEST_MODE=file node regress.js`.

## Setup (once)

1. **Node.js and npm.** On Kubuntu:
   ```bash
   sudo apt install nodejs npm
   ```
   Check the version with `node --version`. Playwright needs a reasonably current Node.js; see
   [Playwright's system requirements](https://playwright.dev/docs/intro#system-requirements).

2. **Install the exact Playwright version** recorded in `package-lock.json`:
   ```bash
   cd tests && npm ci
   ```
   `npm ci` installs exactly what the lockfile lists into `tests/node_modules/` and never edits the lockfile
   ([npm docs](https://docs.npmjs.com/cli/commands/npm-ci)).

3. **Download Playwright's Chromium build** into `~/.cache/ms-playwright/`
   ([Playwright docs: browsers](https://playwright.dev/docs/browsers)):
   ```bash
   npx playwright install chromium
   ```
   - `npx` runs the `playwright` command installed by step 2.
   - `install chromium` downloads only Chromium, not Firefox or WebKit.
   - If Chromium later fails to start because of missing system libraries, `npx playwright install --with-deps chromium`
     also installs them with `apt`, which asks for `sudo`.

## Running

From the `tests/` directory, run the headless suites in both modes (about 1½ minutes):
```bash
npm test
```
Also run the suites that open real Chromium windows (`app-window.js`, `launcher-chime.js`). They need a desktop session:
```bash
npm run test:headed
```
Each suite prints `PASS`/`FAIL` per check, and the run exits non-zero if anything failed.

To use a different Chromium binary instead of Playwright's own, set `CHROMIUM_PATH`, e.g.
`CHROMIUM_PATH=/snap/bin/chromium npm test`. This is untested: I'm guessing the snap's sandboxing may get in the way.

## What's covered

| Suite | Checks |
|---|---|
| `regress.js` | **Timer:** URL `?t=` / autostart, countdown, pause, reload, overtime, reset, presets. **Hands:** angles, and that they turn counter-clockwise. **#8:** closing stops the timer, a reload doesn't, mute is remembered, old saved state is migrated, windows are independent. **Presets dropdown**, and the tooltip on disabled controls. **Controls overlay:** hidden until hover or focus, only as big as the controls, clicks outside it start/pause. **Layout:** 10 window sizes. **Server mode:** reload served from the service-worker cache with the server stopped. **File mode:** no service worker registered. **Both:** no console warnings or errors. |
| `sound.js` | The chime, under Chromium's real autoplay rule (normal launch = sound needs a click; `--autoplay-policy=no-user-gesture-required` = allowed). When sound is allowed (as the launcher sets up) it plays at time-up with no click; under the normal rule, started without a click it's blocked (no tones); clicking to start makes it play; mute suppresses it; no "click for sound" hint exists any more. Playwright's reads count as clicks, so the page records a timeline and the test reads it only afterwards. |
| `lockdown.js` | Right-click, dragging and 23 browser shortcuts are cancelled. The app's own keys, typing in the time fields, Tab, Enter on buttons and the dropdown still work. |
| `app-window.js` | A real `chromium --app=…` window: #8 end to end (reload keeps the timer; quitting and relaunching gives READY) and `window.close()`. |
| `launcher.js` | The `./countdown` launcher, with stand-in browsers that record their arguments (no real browser). Checks: file URL by default; `--server` URL; durations; the timer's own profile (location for snap and other Chromium-family browsers, plus the allow-sound and no-first-run switches); `COUNTDOWN_PROFILE` (`none` and a custom folder); percent-encoding of paths with spaces/non-ASCII; error exits; `--help`. Runs once (not per mode). |
| `launcher-chime.js` | Headed, end to end: the real launcher starts Chromium (`./countdown 0:05`, and `--server 0:05`); the test only listens to the browser console and never clicks. With the timer's own profile, Chromium must **not** log "The AudioContext was not allowed to start". A control run without that profile must log it, which shows the check can tell the difference. |

**Not covered automatically:** whether Chromium itself skips its shortcuts (`Ctrl+S`, `F5`, …) once the page cancels them.
Playwright's injected keys never trigger Chromium's own shortcuts, even without the lock-down, so check that by hand
with a real keyboard. Last checked by hand on Kubuntu (Plasma 6.6.6, Wayland, Chromium 157 snap, app window):
`Ctrl+S`, `Ctrl+P`, `F5`, `Ctrl+R`, `Ctrl+=`, `Ctrl+F`, `F12`, `Ctrl+Shift+I`, `Ctrl+U`, `Ctrl+T`, `Ctrl+N`, `Ctrl+W`
and right-click were all blocked.
