# Countdown Timer

A small, dependency-free countdown timer you can install as a PWA (Progressive Web App). It runs on `localhost` in a chrome-less browser window.

- **Analog face: an analog clock running backwards to "zero hour".** The outer ring has minute ticks labelled 0–55, and an inner ring has small hour numerals 0–11. Both are numbered clockwise like a clock face, with 0 at the top. All three hands show time *remaining*, move **counter-clockwise**, and meet at 12 when the countdown reaches zero:
  - **little hand:** hours remaining, one turn per 12 h, read against the inner hour numerals.
  - **big hand** (the one with the knob): minutes remaining within the hour, one turn per hour. The coloured arc from 12 o'clock to it is the time left in the current hour. A faint full ring means more than an hour remains.
  - **sweep hand** (thin, coral): seconds remaining within the minute, one turn per minute.

  The hands start at the edge of the central readout instead of at a pivot in the middle, so they never cover the digits.
- **Digital readout** in the centre of the face (`MM:SS`, or `H:MM:SS` for durations of an hour or more).
- **Thin progress bar** just below the readout. It is drawn translucent on purpose so it stays in the background.
- **Status line** showing the wall-clock end time (`ENDS AT 9:02 PM`), or `PAUSED` / `TIME'S UP`.
- **Colours:** the face turns amber in the last 10 % and red when time runs out. After that it counts overtime (`+00:04`).
- **Chime:** made with Web Audio, so there are no audio files. You can mute it. Started with `./countdown`, it plays even if you never touch the window (see "The timer's own Chromium profile" below).
- **Screen Wake Lock** while the timer runs, so the display doesn't go to sleep.
- **Closing the app stops the timer; a reload doesn't.** The running timer lives in [`sessionStorage`](https://html.spec.whatwg.org/multipage/webstorage.html#the-sessionstorage-attribute), which survives a reload of the same window but is discarded when the window closes. The next launch starts at **READY**. Your last duration and the mute setting are kept in `localStorage`, so they are remembered across launches.
- **Works offline** once it's installed. The service worker serves the cached app when the local server isn't running.
- **Just the clock; controls on hover.** The clock is the only thing permanently on screen, so the window can be small and square.
  - **Showing the controls:** they appear over the bottom of the clock while the pointer is over it, or when `Tab` moves keyboard focus into them. They fade out about 0.3 s after the pointer leaves.
  - **The overlay:** they sit on a transparent overlay that is only as big as the controls, so only the controls themselves cover the clock.
  - **Clicking:** a click anywhere else in the window starts or pauses the timer. A click on a control, or in the gaps between controls, never does.
  - **What they are:** the `hh : mm : ss` fields, a **Preset…** dropdown, and icon buttons (▶/❚❚ start-pause, ⟲ reset, speaker mute, ⛶ fullscreen), each with a tooltip naming its keyboard shortcut. They scale with the clock.
  - **While the timer runs:** the time fields and the preset dropdown are disabled. Hovering them shows "Disabled while the timer is running".
- **Locked down like a kiosk.** The page cancels:
  - the right-click menu, and dragging;
  - browser keyboard shortcuts such as `Ctrl+S`, `Ctrl+P`, `F5`/`Ctrl+R`, `Ctrl`+`+`/`-`/`0` (zoom), `Ctrl+F` and `F12`.

  Still allowed, so the app stays usable from the keyboard:
  - its own shortcuts;
  - plain typing in the time fields and the preset dropdown;
  - `Tab`/`Shift+Tab` to move between controls;
  - `Enter` on a focused button.

  Limits:
  - Shortcuts the window manager handles before the page sees them can't be blocked by a web page. That includes `Alt+F4` and KDE's own shortcuts.
  - **Checked by hand** on Kubuntu (Plasma 6.6.6, Wayland, Chromium 157 snap, app window): `Ctrl+S`, `Ctrl+P`, `F5`, `Ctrl+R`, `Ctrl+=`, `Ctrl+F`, `F12`, `Ctrl+Shift+I`, `Ctrl+U`, `Ctrl+T`, `Ctrl+N`, `Ctrl+W` and right-click are all blocked.
  - `Ctrl+A`/`C`/`V` don't work in the time fields either.
- **The clock never disappears.** The face is never laid out smaller than 200 px (`--face-min` in `styles.css`). As far as I know, browsers have no API to stop a window from being resized smaller. So when the window is smaller than that, `app.js` scales the **whole UI down uniformly** to fit (like zooming out). There are no scroll bars, and the clock stays fully visible at any window size, just smaller.
- **Themes:** dark and light, following `prefers-color-scheme`.

No build step, no npm packages, no frameworks. By default the only requirement is a Chromium-family browser. [Node.js](https://nodejs.org/) is needed only for the optional local server (`./countdown --server`, which runs `server.js` using only Node's built-in modules). On Kubuntu: `sudo apt install nodejs`; on Fedora: `sudo dnf install nodejs`.

## Quick start

```bash
./countdown
```

That's all. The script opens the timer **straight from `app/countdown.html`** in an app-mode window, which has no tabs, address bar or toolbar. No server is involved.

```bash
./countdown 25m
```

Opens the window, sets 25 minutes and starts the timer immediately. The big hand starts at "25" and moves counter-clockwise to 0.

Accepted duration formats: `25m`, `1h30m`, `90s`, `1h2m3s`, `5:00` (m:ss), `1:30:00` (h:mm:ss), or a bare number meaning minutes (`10`, `2.5`). `./countdown --help` shows the usage.

### Two ways to run it

| | `./countdown` (default) | `./countdown --server` |
|---|---|---|
| Opens | `file://…/app/countdown.html` | `http://localhost:8765/`, served by `server.js` |
| Needs | only Chromium | Chromium and Node.js |
| Installable as a Chrome app | No: Chrome only installs apps served over HTTPS or `localhost` ([install criteria](https://web.dev/articles/install-criteria)) | Yes (see below) |
| Offline cache (service worker) | Not used; the files are already local, and browsers don't allow service workers on `file://` | Yes |
| Chime when you never click the window | Plays (the launcher's own profile allows it) | Plays (same) |
| Remembered duration and mute | Its own | Its own, separate from the file version |

Both use the same `app/` folder; nothing is duplicated. Options combine in any order, e.g. `./countdown --server 25m`.

**Snap Chromium (Kubuntu's default):** keep the repo somewhere that isn't inside a hidden folder (one whose name starts with `.`). As I read the snap [`home` interface](https://snapcraft.io/docs/home-interface), snaps can only read non-hidden files in your home directory, so `file://` might fail to load from a hidden folder.

Environment overrides for `./countdown`:

| Variable | Default | Purpose |
|---|---|---|
| `COUNTDOWN_BROWSER` | first one found of `chromium`, `chromium-browser`, `google-chrome-stable`, `google-chrome`, `brave-browser`, `microsoft-edge` | Browser executable |
| `COUNTDOWN_SIZE` | `420,420` | Initial window `WIDTH,HEIGHT` in pixels |
| `COUNTDOWN_PORT` | `8765` | Port for `--server`. **Note:** the origin includes the port, so a different port is a different app with separate storage and a separate install. |
| `COUNTDOWN_PROFILE` | see below | Folder for the timer's own Chromium profile, or `none` to use your normal Chromium profile (the chime then needs a click). |

### The timer's own Chromium profile

`./countdown` runs the timer in a Chromium profile of its own, started with sound allowed without a click. That way the chime plays even if you start a timer with `./countdown 25m` and never touch the window. Chrome's [autoplay policy](https://developer.chrome.com/blog/autoplay) otherwise blocks sound until the first click.

- **Where it lives:**
  - snap Chromium (Kubuntu's default): `~/snap/chromium/common/countdown-timer-profile`. The snap can't write to hidden folders such as `~/.local`, so it goes in the snap's own folder.
  - any other Chromium-family browser: `~/.local/share/countdown-timer/chromium-profile` (or under `$XDG_DATA_HOME`).
  - your own choice: set `COUNTDOWN_PROFILE=/some/folder`.
- **A separate Chromium process:** it runs alongside your normal browser, even if that's already open. That's what makes the switches take effect. If you start a second timer while one is open, it opens as another window in the same process.
- **Separate saved settings:** the remembered duration and mute setting live in this profile, apart from your normal browser.
- **To reset it:** close the timer and delete the folder.
- **Installing (`--server`):** if you install the app from a window opened by `./countdown --server`, it's installed into this profile. To install it into your normal Chromium, open `http://localhost:8765/` there (with `./countdown --server` or `node server.js` running), or run `COUNTDOWN_PROFILE=none ./countdown --server`.
- **Checked here:** on Xvfb, with the timer started by the real launcher and never clicked, Chromium did **not** block the chime in either mode. Without this profile (the control), it did. Also confirmed by hand on Kubuntu (Chromium 157 snap, so the profile in `~/snap/chromium/common/`): the chime played without a click in both modes.
- **Not covered: the app installed in Chromium and opened from the KDE menu.** That isn't started by `./countdown`, so it doesn't get the allow-sound switch, and I expect the chime then needs a click. Chrome's autoplay page lists installing as an exception only on mobile. This hasn't been tested.

### What the launcher actually runs

Default (file) mode, e.g. with snap Chromium:

```bash
chromium --app=file:///path/to/countdown-timer/app/countdown.html --window-size=420,420 \
  --user-data-dir="$HOME/snap/chromium/common/countdown-timer-profile" \
  --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check
```

- `--app=URL`: a window with no tabs or address bar. The path is percent-encoded, so folders with spaces or non-ASCII names work.
- `--window-size=W,H`: initial window size.
- `--user-data-dir=DIR`: use the timer's own profile, and therefore its own Chromium process.
- `--autoplay-policy=no-user-gesture-required`: allow sound without a click.
- `--no-first-run`, `--no-default-browser-check`: skip the welcome and "make default browser" prompts in the new profile. Without `--no-first-run`, a brand-new profile in my tests stalled at first-run setup.

All of these are Chromium command-line switches, each defined, with a comment explaining it, in Chromium's source:
- `--app` (`kApp`), `--window-size` (`kWindowSize`), `--user-data-dir` (`kUserDataDir`), `--no-first-run` (`kNoFirstRun`) and `--no-default-browser-check` (`kNoDefaultBrowserCheck`) are in [`chrome/common/chrome_switches.h`](https://source.chromium.org/chromium/chromium/src/+/main:chrome/common/chrome_switches.h).
- `--autoplay-policy` (`kAutoplayPolicy`) and its value `no-user-gesture-required` (`kNoUserGestureRequiredPolicy`) are in [`media/base/media_switches.cc`](https://source.chromium.org/chromium/chromium/src/+/main:media/base/media_switches.cc).

Checked against Chromium's main branch on 2026-11-14. Besides the source, the behaviour of `--app`, `--user-data-dir`, `--autoplay-policy` and `--no-first-run` was tested (see `tests/`). `--window-size` and `--no-default-browser-check` have only been checked in the source.

With `--server`, it first starts the server if nothing is listening on the port yet:

```bash
node server.js --port 8765 --quiet --exit-when-idle 3m
```

- `--port 8765` is the TCP port to listen on.
- `--bind` (default `127.0.0.1`) is the address to listen on. The default means only this machine can connect.
- `--quiet` stops per-request logging. `--help` lists the options.
- `--exit-when-idle 3m` makes the server exit after 3 minutes with no requests (times such as `90s` also work). Without it, the server runs until it is stopped.

**The server stops by itself about 3 minutes after the last timer window closes.**
- **The heartbeat:** while a window is open, the page sends a tiny `HEAD manifest.json` request every 30 seconds, which keeps the server running (`startHeartbeat()` in `app.js`).
- **Several windows:** they share one server. Later launches reuse the one already running, so it stops only once all the windows are closed.
- **Where it applies:** the heartbeat is sent only on `localhost`, so a copy served from elsewhere (e.g. a VPS) doesn't send it. A `node server.js` you start without `--exit-when-idle` never exits by itself.
- **If the server stops while a window is still open, e.g. after a long sleep, nothing breaks.** The countdown carries on, a reload is served from the service-worker cache (see below), and the next `./countdown --server` starts a new server.
- **Why 30 seconds:** Chromium may slow a hidden window's timers to about once a minute after 5 minutes ([Chrome's timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)), which still leaves a wide margin.
- **To stop it sooner:** `pkill -f 'server.js --port 8765'`. Here `-f` matches the pattern against the whole command line, not just the process name `node` ([pkill(1)](https://man7.org/linux/man-pages/man1/pkill.1.html)).

`server.js` is a small static file server built only on Node's built-in [`http`](https://nodejs.org/api/http.html) and [`fs`](https://nodejs.org/api/fs.html) modules (no npm packages). It serves `app/` with explicit file types and a `Cache-Control: no-cache` header, so edits show up on the next reload. It supports `If-Modified-Since`, refuses paths that would escape `app/`, and answers only `GET` and `HEAD`.

**The page is `app/countdown.html` (there is no `index.html`).**
- **`server.js`** serves it for the folder address, so `http://localhost:8765/` works.
- **The manifest's `start_url` and shortcuts** name `countdown.html` explicitly.
- **The service worker** pre-caches it by name.

So the app installs and works offline even on another web server (e.g. a VPS) that doesn't treat `countdown.html` as its default page. Visitors there would just need the `/countdown.html` address, unless you set that server's default page.

```bash
chromium --app=http://localhost:8765/ --window-size=420,420
```

- `--app=<url>` opens the URL in a window with no browser UI.
- `--window-size=<w>,<h>` sets the initial window size.

Both switches are defined in Chromium's [`chrome/common/chrome_switches.h`](https://source.chromium.org/chromium/chromium/src/+/main:chrome/common/chrome_switches.h) (search for `kApp` and `kWindowSize`). Caveat: if Chromium is already running, the new command is handed to the existing browser process. `--app` is honoured in that case, but some browser-wide switches may not be.

### Installing it as a PWA (server mode only)

1. Open the app once, either with `./countdown --server` or by visiting `http://localhost:8765/` (with `server.js` running) in Chromium.
2. Choose **⋮ → Cast, save and share → Install page as app…**. The menu wording varies between Chromium versions. In app-mode windows, the install option is in the window's own menu.

Chromium then creates a launcher entry in `~/.local/share/applications/`, so "Countdown" shows up in the KDE application menu. It opens in a standalone window (`"display": "standalone"` in the manifest; see the [Web App Manifest `display` member](https://www.w3.org/TR/appmanifest/#display-member)).

The manifest also declares two **shortcuts**, "5 minutes" and "25 minutes". I *believe* Chromium on Linux exposes them as right-click actions on the launcher entry, but I haven't verified that on KDE.

Because the service worker is network-first with a cache fallback, the installed app starts **even when `server.js` isn't running**. I tested this: I killed the server and reloaded, and the page came back from the cache with HTTP 200. Updates are only picked up when the server is running.

**Why plain HTTP is OK:** service workers need a [secure context](https://www.w3.org/TR/secure-contexts/), and `http://localhost` / `127.0.0.1` count as ["potentially trustworthy" origins](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy). No TLS certificate is needed.

## Using it

| Action | Mouse | Keyboard |
|---|---|---|
| Start / pause / resume | click anywhere outside the controls, or ▶ / ❚❚ | `Space` |
| Dismiss the alarm | click anywhere outside the controls, or ■ | `Space` / `Esc` |
| Reset | ⟲ | `R` / `Esc` |
| ±1 minute (works while running too) | | `↑` `↓` or `+` `-` |
| ±10 minutes | | `Shift`+`↑` / `Shift`+`↓` |
| Show the controls | hover over the clock | `Tab` |
| Set an exact time | type into the `hh : mm : ss` fields, then `Enter` to start | |
| Presets | **Preset…** dropdown: 1m 5m 10m 15m 25m 45m 1h | |
| Mute / unmute | speaker icon | `M` |
| Fullscreen | ⛶ | `F` |

The page also accepts URL parameters: `http://localhost:8765/?t=25m&autostart=1`. They are removed from the address after they're applied, so reloading the page doesn't restart the timer.

## Layout

```
countdown          launcher (bash): opens app/countdown.html in an app-mode window; --server starts server.js and uses http://localhost
server.js          static file server for ./app (Node.js built-in modules only)
app/
  countdown.html   markup: SVG face + HTML readout overlaid in its centre
  styles.css       theming via CSS custom properties; sizes use container-query units
  app.js           state machine, rendering, audio, wake lock, persistence
  sw.js            service worker (network-first, cache fallback)
  manifest.json    PWA manifest
  icons/           SVG sources + generated PNGs (192, 512, maskable 512)
tests/             optional Playwright browser tests (see tests/README.md)
```

## Design notes

- **Timing:** while running, the app stores `endAt` (the epoch time when the timer ends) and computes `remaining = endAt − now` on every frame. It never decrements a counter, so throttled timers, a hidden window or a reload can't make it drift.
- **Alarm timer:** the alarm is one `setTimeout` scheduled for `endAt`. Chrome's ["intensive" throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) (one wake-up per minute for hidden pages) applies only to *chained* timers, so a single timeout isn't affected. The visual updates use `requestAnimationFrame`, which pauses while the window is hidden, and resume immediately when it's shown again.
- **Sound needs a user gesture:** Chrome only lets audio play after a click or key press, or in [some other cases](https://developer.chrome.com/blog/autoplay) (installed PWAs are one of them; so is the command-line switch `--autoplay-policy=no-user-gesture-required`, which the launcher uses).
  - **What the app does:** any click or key press in the window unlocks audio. When time's up, the app always creates its audio context and tries to play, so the chime sounds whenever the browser allows it.
  - **When the browser blocks it:** for example the page opened in a normal browser window, or with `COUNTDOWN_PROFILE=none`, and never clicked. Then the chime is silent and only the red visual alarm appears. (An earlier version showed a "click for sound" hint in this case; it was removed once the launcher's own profile made the chime work without a click.)
- **Wake Lock:** uses the [Screen Wake Lock API](https://www.w3.org/TR/screen-wake-lock/) while the timer runs. The lock is released by the browser when the window is hidden and taken again when it becomes visible.
- **Multiple windows:** each window is an independent timer. They share only the remembered duration and mute setting, as of the moment a window opens.
- **Regenerating icons:** the PNG icons were rendered from the SVGs in `app/icons/` with headless Chromium. If you change the SVGs, re-render them (e.g. `rsvg-convert -w 512 icon.svg > icon-512.png` from `librsvg2-bin`) and bump `VERSION` in `sw.js`.

## Tests

Optional browser tests (Playwright) live in [`tests/`](tests/README.md): timer logic, the backwards hands,
"closing stops the timer", the lock-down, layout at many window sizes, and offline start-up.

## License

[MIT](LICENSE) © 2026 Daniel Pflager
