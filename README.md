# Countdown Timer

A small, dependency-free countdown timer you can install as a PWA (Progressive Web App). It runs on `localhost` in a chrome-less browser window.

- **Analog face:** 60 tick marks and a coloured "remaining" arc that empties clockwise as time passes. A hand with a knob marks the leading edge, and a small seconds dot sweeps once per minute.
- **Digital readout** in the centre of the face (`MM:SS`, or `H:MM:SS` for durations of an hour or more).
- **Thin progress bar** just below the readout. It is drawn translucent on purpose so it stays in the background.
- **Status line** showing the wall-clock end time (`ENDS 9:02 PM`), or `PAUSED` / `TIME'S UP`.
- **Colours:** the face turns amber in the last 10 % and red when time runs out. After that it counts overtime (`+00:04`).
- **Chime:** made with Web Audio, so there are no audio files. You can mute it.
- **Screen Wake Lock** while the timer runs, so the display doesn't go to sleep.
- **State survives a reload** or closing the window, because the timer stores an end *timestamp* in `localStorage`.
- **Works offline** once it's installed. The service worker serves the cached app when the local server isn't running.
- **Controls fade out** (and the cursor hides) after 3 s without input while the timer runs.
- **Themes:** dark and light, following `prefers-color-scheme`.

No build step, no npm, no frameworks. The only runtime requirement besides a Chromium-family browser is Python 3, which is preinstalled on Kubuntu.

## Quick start

```bash
./countdown
```

That's all. The script starts the local server (if it isn't already running) and opens the timer in an app-mode window, which has no tabs, address bar or toolbar.

```bash
./countdown 25m
```

Opens the window, sets 25 minutes and starts the timer immediately.

Accepted duration formats: `25m`, `1h30m`, `90s`, `1h2m3s`, `5:00` (m:ss), `1:30:00` (h:mm:ss), or a bare number meaning minutes (`10`, `2.5`).

Environment overrides for `./countdown`:

| Variable | Default | Purpose |
|---|---|---|
| `COUNTDOWN_PORT` | `8765` | Port for the local server. **Note:** the origin includes the port, so a different port is a different app with separate storage and a separate install. |
| `COUNTDOWN_BROWSER` | first one found of `chromium`, `chromium-browser`, `google-chrome-stable`, `google-chrome`, `brave-browser`, `microsoft-edge` | Browser executable |
| `COUNTDOWN_SIZE` | `440,620` | Initial window `WIDTH,HEIGHT` in pixels |

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
| Start / pause / resume | click the face or **Start** | `Space` |
| Dismiss the alarm | click the face or **Dismiss** | `Space` / `Esc` |
| Reset | **Reset** | `R` / `Esc` |
| ±1 minute (works while running too) | | `↑` `↓` or `+` `-` |
| ±10 minutes | | `Shift`+`↑` / `Shift`+`↓` |
| Set an exact time | type into the `hh : mm : ss` fields, then `Enter` to start | |
| Presets | 1m 5m 10m 15m 25m 45m 1h | |
| Mute | **Sound on/Muted** | `M` |
| Fullscreen | **Fullscreen** | `F` |

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
```

## Design notes

- **Timing:** while running, the app stores `endAt` (the epoch time when the timer ends) and computes `remaining = endAt − now` on every frame. It never decrements a counter, so throttled timers, a hidden window or a reload can't make it drift.
- **Alarm timer:** the alarm is one `setTimeout` scheduled for `endAt`. Chrome's ["intensive" throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) (one wake-up per minute for hidden pages) applies only to *chained* timers, so a single timeout isn't affected. The visual updates use `requestAnimationFrame`, which pauses while the window is hidden, and resume immediately when it's shown again.
- **Sound needs a user gesture:** Chrome only lets audio play after a user gesture or in [some other cases](https://developer.chrome.com/blog/autoplay) (installed PWAs are one of them). Any click or key press in the window unlocks audio. If you start the timer with `./countdown 25m` in a *non-installed* window and never touch the window, the chime may stay silent; the red visual alarm still appears. The installed PWA shouldn't have this problem.
- **Wake Lock:** uses the [Screen Wake Lock API](https://www.w3.org/TR/screen-wake-lock/) while the timer runs. The lock is released by the browser when the window is hidden and taken again when it becomes visible.
- **Multiple windows:** windows of this app stay in sync through the `storage` event.
- **Regenerating icons:** the PNG icons were rendered from the SVGs in `app/icons/` with headless Chromium. If you change the SVGs, re-render them (e.g. `rsvg-convert -w 512 icon.svg > icon-512.png` from `librsvg2-bin`) and bump `VERSION` in `sw.js`.

## License

[MIT](LICENSE) © 2026 Daniel Pflager
