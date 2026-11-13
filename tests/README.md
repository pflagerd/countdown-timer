# Tests

Browser tests for the countdown timer, driven by [Playwright](https://playwright.dev/) (Apache-2.0).
They're an **optional developer tool**: the app itself has no dependencies, and nothing here is needed to run it.

Each run starts its own `serve.py` on a free port, so it doesn't clash with a server you already have
running on 8765, and every run starts with clean browser storage.

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

From the `tests/` directory, run the headless suites (about 40 s):
```bash
npm test
```
Also run the real app-window suite. It briefly opens real Chromium windows, so it needs a desktop session:
```bash
npm run test:headed
```
Each suite prints `PASS`/`FAIL` per check, and the run exits non-zero if anything failed.

To use a different Chromium binary instead of Playwright's own, set `CHROMIUM_PATH`, e.g.
`CHROMIUM_PATH=/snap/bin/chromium npm test`. This is untested: I'm guessing the snap's sandboxing may get in the way.

## What's covered

| Suite | Checks |
|---|---|
| `regress.js` | **Timer:** URL `?t=` / autostart, countdown, pause, reload, overtime, reset, presets. **Hands:** angles, and that they turn counter-clockwise. **#8:** closing stops the timer, a reload doesn't, mute is remembered, old saved state is migrated, windows are independent. **Presets dropdown**, and the tooltip on disabled controls. **Controls overlay:** hidden until hover or focus, only as big as the controls, clicks outside it start/pause. **Layout:** 10 window sizes. **Offline:** reload served from the service-worker cache. |
| `lockdown.js` | Right-click, dragging and 23 browser shortcuts are cancelled. The app's own keys, typing in the time fields, Tab, Enter on buttons and the dropdown still work. |
| `app-window.js` | A real `chromium --app=…` window: #8 end to end (reload keeps the timer; quitting and relaunching gives READY) and `window.close()`. |

**Not covered automatically:** whether Chromium itself skips its shortcuts (`Ctrl+S`, `F5`, …) once the page cancels them.
Playwright's injected keys never trigger Chromium's own shortcuts, even without the lock-down, so check that by hand
with a real keyboard. Last checked by hand on Kubuntu (Plasma 6.6.6, Wayland, Chromium 157 snap, app window):
`Ctrl+S`, `Ctrl+P`, `F5`, `Ctrl+R`, `Ctrl+=`, `Ctrl+F`, `F12`, `Ctrl+Shift+I`, `Ctrl+U`, `Ctrl+T`, `Ctrl+N`, `Ctrl+W`
and right-click were all blocked.
