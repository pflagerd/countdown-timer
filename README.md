# Countdown Timer

A small, dependency-free countdown timer you can install as a PWA (Progressive Web App). It runs on `localhost` in a chrome-less browser window.

- **Analog face: an analog clock running backwards to "zero hour".** The outer ring has minute ticks labelled 0–55, and an inner ring has small hour numerals 0–11. Both are numbered clockwise like a clock face, with 0 at the top. All three hands show time *remaining*, move **counter-clockwise**, and meet at 12 when the countdown reaches zero:
  - **little hand:** hours remaining, one turn per 12 h, read against the inner hour numerals.
  - **big hand** (the one with the knob): minutes remaining within the hour, one turn per hour. The coloured arc from 12 o'clock to it is the time left in the current hour. A faint full ring means more than an hour remains.
  - **sweep hand** (thin, coral): seconds remaining within the minute, one turn per minute.

  The hands start at the edge of the central readout instead of at a pivot in the middle, so they never cover the digits.
- **Digital readout** in the centre of the face (`MM:SS`, or `H:MM:SS` for durations of an hour or more).
- **Thin progress bar** just below the readout. It is drawn translucent on purpose so it stays in the background.
- **Status line** showing the wall-clock end time (`ENDS 9:02 PM`), or `PAUSED` / `TIME'S UP`.
- **Colours:** the face turns amber in the last 10 % and red when time runs out. After that it counts overtime (`+00:04`).
- **Chime:** made with Web Audio, so there are no audio files. You can mute it.
- **Screen Wake Lock** while the timer runs, so the display doesn't go to sleep.
- **Closing the app stops the timer; a reload doesn't.** The running timer lives in [`sessionStorage`](https://html.spec.whatwg.org/multipage/webstorage.html#the-sessionstorage-attribute), which survives a reload of the same window but is discarded when the window closes. The next launch starts at **READY**. Your last duration and the mute setting are kept in `localStorage`, so they are remembered across launches.
- **Works offline** once it's installed. The service worker serves the cached app when the local server isn't running.
- **Controls always visible.** The controls at the bottom never fade or hide. The action buttons are icons (▶/❚❚ start-pause, ⟲ reset, speaker mute, ⛶ fullscreen), each with a tooltip naming its keyboard shortcut. When the window gets smaller, the clock face shrinks and the controls get more compact.
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
- **Controls below or beside the clock, whichever gives the bigger clock.** On every resize the app tries both arrangements and keeps the one with the larger face. Once an arrangement is in use, it only switches when the other one would be more than 5 % bigger (`SWITCH_MARGIN` in `app.js`), so dragging the window edge near the cut-over doesn't make the layout flip back and forth. Tall and square windows put the controls below. Wide windows (e.g. 640×300, 1280×720, fullscreen on a 16:9 screen) put them in a column to the right, and the clock and controls stay together, centred in the window.
- **The clock never disappears.** The face is never laid out smaller than 200 px (`--face-min` in `styles.css`). As far as I know, browsers have no API to stop a window from being resized smaller. So when the window is smaller than face + controls, `app.js` scales the **whole UI down uniformly** to fit (like zooming out). There are no scroll bars, and the face and controls stay fully visible at any window size, just smaller.
- **Themes:** dark and light, following `prefers-color-scheme`.

No build step, no npm, no frameworks. The only runtime requirement besides a Chromium-family browser is Python 3, which is preinstalled on Kubuntu.

> **Experiment (#12) on this branch:** the controls are hidden, and appear over the bottom of the clock only while the
> pointer is over it, or when `Tab` moves keyboard focus into them. The overlay that holds them is transparent and only as big as the controls.
> Clicking anywhere else in the window starts or pauses the timer. `./countdown` opens a square 420×420 window.
> To get the original layout back, remove `class="hover-controls"` from `<html>` in `app/index.html`.

## Quick start

```bash
./countdown
```

That's all. The script starts the local server (if it isn't already running) and opens the timer in an app-mode window, which has no tabs, address bar or toolbar.

```bash
./countdown 25m
```

Opens the window, sets 25 minutes and starts the timer immediately. The big hand starts at "25" and moves counter-clockwise to 0.

Accepted duration formats: `25m`, `1h30m`, `90s`, `1h2m3s`, `5:00` (m:ss), `1:30:00` (h:mm:ss), or a bare number meaning minutes (`10`, `2.5`).

Environment overrides for `./countdown`:

| Variable | Default | Purpose |
|---|---|---|
| `COUNTDOWN_PORT` | `8765` | Port for the local server. **Note:** the origin includes the port, so a different port is a different app with separate storage and a separate install. |
| `COUNTDOWN_BROWSER` | first one found of `chromium`, `chromium-browser`, `google-chrome-stable`, `google-chrome`, `brave-browser`, `microsoft-edge` | Browser executable |
| `COUNTDOWN_SIZE` | `420,420` | Initial window `WIDTH,HEIGHT` in pixels |

### What the launcher actually runs

```bash
python3 serve.py --port 8765 --quiet
```

- `--port 8765` is the TCP port to listen on.
- `--bind` (default `127.0.0.1`) is the address to listen on. The default means only this machine can connect.
- `--quiet` stops per-request logging.

`serve.py` is a thin wrapper around Python's standard [`http.server`](https://docs.python.org/3/library/http.server.html) module. It adds two things: explicit MIME types, and a `Cache-Control: no-cache` header so edits show up on the next reload.

```bash
chromium --app=http://localhost:8765/ --window-size=440,620
```

- `--app=<url>` opens the URL in a window with no browser UI.
- `--window-size=<w>,<h>` sets the initial window size.

Both switches are defined in Chromium's [`chrome/common/chrome_switches.cc`](https://source.chromium.org/chromium/chromium/src/+/main:chrome/common/chrome_switches.cc) (search for `kApp` and `kWindowSize`). Caveat: if Chromium is already running, the new command is handed to the existing browser process. `--app` is honoured in that case, but some browser-wide switches may not be.

### Installing it as a PWA (optional, recommended)

1. Open the app once, either with `./countdown` or by visiting `http://localhost:8765/` in Chromium.
2. Choose **⋮ → Cast, save and share → Install page as app…**. The menu wording varies between Chromium versions. In app-mode windows, the install option is in the window's own menu.

Chromium then creates a launcher entry in `~/.local/share/applications/`, so "Countdown" shows up in the KDE application menu. It opens in a standalone window (`"display": "standalone"` in the manifest; see the [Web App Manifest `display` member](https://www.w3.org/TR/appmanifest/#display-member)).

The manifest also declares two **shortcuts**, "5 minutes" and "25 minutes". I *believe* Chromium on Linux exposes them as right-click actions on the launcher entry, but I haven't verified that on KDE.

Because the service worker is network-first with a cache fallback, the installed app starts **even when `serve.py` isn't running**. I tested this: I killed the server and reloaded, and the page came back from the cache with HTTP 200. Updates are only picked up when the server is running.

**Why plain HTTP is OK:** service workers need a [secure context](https://www.w3.org/TR/secure-contexts/), and `http://localhost` / `127.0.0.1` count as ["potentially trustworthy" origins](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy). No TLS certificate is needed.

## Using it

| Action | Mouse | Keyboard |
|---|---|---|
| Start / pause / resume | click the face or ▶ / ❚❚ | `Space` |
| Dismiss the alarm | click the face or ■ | `Space` / `Esc` |
| Reset | ⟲ | `R` / `Esc` |
| ±1 minute (works while running too) | | `↑` `↓` or `+` `-` |
| ±10 minutes | | `Shift`+`↑` / `Shift`+`↓` |
| Set an exact time | type into the `hh : mm : ss` fields, then `Enter` to start | |
| Presets | 1m 5m 10m 15m 25m 45m 1h. In small windows (height ≤ 520 px or width ≤ 380 px) the buttons fold into a **Preset…** dropdown next to the time fields. | |
| Mute / unmute | speaker icon | `M` |
| Fullscreen | ⛶ | `F` |

The page also accepts URL parameters: `http://localhost:8765/?t=25m&autostart=1`. They are removed from the address after they're applied, so reloading the page doesn't restart the timer.

## Layout

```
countdown          launcher (bash): starts the server if needed, opens an app-mode window
serve.py           stdlib-only static server for ./app
app/
  index.html       markup: SVG face + HTML readout overlaid in its centre
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
- **Sound needs a user gesture:** Chrome only lets audio play after a user gesture or in [some other cases](https://developer.chrome.com/blog/autoplay) (installed PWAs are one of them). Any click or key press in the window unlocks audio. If you start the timer with `./countdown 25m` in a *non-installed* window and never touch the window, the chime may stay silent; the red visual alarm still appears. The installed PWA shouldn't have this problem.
- **Wake Lock:** uses the [Screen Wake Lock API](https://www.w3.org/TR/screen-wake-lock/) while the timer runs. The lock is released by the browser when the window is hidden and taken again when it becomes visible.
- **Multiple windows:** each window is an independent timer. They share only the remembered duration and mute setting, as of the moment a window opens.
- **Regenerating icons:** the PNG icons were rendered from the SVGs in `app/icons/` with headless Chromium. If you change the SVGs, re-render them (e.g. `rsvg-convert -w 512 icon.svg > icon-512.png` from `librsvg2-bin`) and bump `VERSION` in `sw.js`.

## Tests

Optional browser tests (Playwright) live in [`tests/`](tests/README.md): timer logic, the backwards hands,
"closing stops the timer", the lock-down, layout at many window sizes, and offline start-up.

## License

[MIT](LICENSE) © 2026 Daniel Pflager
