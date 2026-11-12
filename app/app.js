'use strict';

/*
 * Countdown timer — plain JS, no dependencies.
 *
 * Timing model: we never "decrement a counter". While running we store the
 * wall-clock end time (endAt, epoch ms) and derive everything from
 * endAt - Date.now(). That keeps the display correct even if timers are
 * throttled, the window is hidden, or the page is reloaded mid-countdown.
 *
 * Persistence is split (issue #8):
 *   - preferences (last duration, mute) → localStorage: survive closing the app;
 *   - the running timer (status, remaining, endAt) → sessionStorage: survives a
 *     reload of this window but is discarded when the window is closed, so
 *     closing the app stops the timer and the next launch starts at READY.
 */

const PREFS_KEY = 'countdown-timer/prefs/v1';     // localStorage
const SESSION_KEY = 'countdown-timer/session/v1'; // sessionStorage
const LEGACY_KEY = 'countdown-timer/state/v1';    // pre-#8 localStorage blob (migrated, then removed)
const MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000;
const MIN_MS = 1000;
const ALARM_REPEATS = 20;          // chime bursts before the alarm gives up
const ALARM_INTERVAL_MS = 1500;
const HOUR_MS = 3600000;        // the dial is a 60-minute face
const MINUTE_MS = 60000;
const HALF_DAY_MS = 12 * HOUR_MS; // little hand: one turn per 12 hours

const $ = (id) => document.getElementById(id);
const el = {
  face: $('face'), arc: $('arc'), ticks: $('ticks'), labels: $('labels'), hourLabels: $('hourLabels'),
  hourHand: $('hourHand'), minHand: $('minHand'), secHand: $('secHand'),
  digits: $('digits'), bar: $('bar'), barFill: $('barFill'), status: $('status'),
  inH: $('inH'), inM: $('inM'), inS: $('inS'), presets: $('presets'), presetSelect: $('presetSelect'),
  startBtn: $('startBtn'), resetBtn: $('resetBtn'), muteBtn: $('muteBtn'), fsBtn: $('fsBtn'),
};

/** status: 'idle' | 'running' | 'paused' | 'done' */
const state = {
  duration: 5 * 60 * 1000,
  remaining: 5 * 60 * 1000,   // authoritative when idle / paused
  endAt: 0,                   // authoritative when running / done
  status: 'idle',
  muted: false,
};

/* ------------------------------------------------------------------ utils */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad2 = (n) => String(n).padStart(2, '0');

function remainingAt(now) {
  return (state.status === 'running' || state.status === 'done')
    ? state.endAt - now
    : state.remaining;
}

/** Countdown shows ceil (05:00 … 00:01), overtime shows floor (+00:00, +00:01 …). */
function formatClock(ms, forceHours) {
  const over = ms < 0;
  const total = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = (h > 0 || forceHours) ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  return (over ? '+' : '') + body;
}

/**
 * Accepts "25m", "1h30m", "90s", "1h2m3s", "5:00" (m:ss), "1:30:00" (h:mm:ss),
 * or a bare number meaning minutes ("25", "2.5"). Returns ms or null.
 */
function parseDuration(input) {
  const str = String(input).trim().toLowerCase();
  let ms = null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(str)) {
    const p = str.split(':').map(Number);
    while (p.length < 3) p.unshift(0);
    ms = ((p[0] * 60 + p[1]) * 60 + p[2]) * 1000;
  } else if (/^\d+(\.\d+)?$/.test(str)) {
    ms = parseFloat(str) * 60000;
  } else {
    const m = str.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
    if (m && (m[1] || m[2] || m[3])) {
      ms = ((parseFloat(m[1] || 0) * 60 + parseFloat(m[2] || 0)) * 60 + parseFloat(m[3] || 0)) * 1000;
    }
  }
  if (ms === null || !Number.isFinite(ms) || ms < MIN_MS) return null;
  return Math.min(Math.round(ms), MAX_MS);
}

const endTimeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/* ------------------------------------------------------------- persistence */

function readJSON(storage, key) {
  try {
    const v = JSON.parse(storage.getItem(key) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }   // unavailable (private mode etc.) or corrupt: ignore
}

function writeJSON(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* unavailable: ignore */ }
}

function save() {
  writeJSON(localStorage, PREFS_KEY, { duration: state.duration, muted: state.muted });
  writeJSON(sessionStorage, SESSION_KEY, {
    duration: state.duration, status: state.status, remaining: state.remaining, endAt: state.endAt,
  });
}

function load() {
  // 1. Preferences. Older versions kept everything in one localStorage blob;
  //    take only the duration and mute setting from it, never the running state.
  let prefs = readJSON(localStorage, PREFS_KEY);
  if (!prefs) {
    prefs = readJSON(localStorage, LEGACY_KEY);
    if (prefs) writeJSON(localStorage, PREFS_KEY, { duration: prefs.duration, muted: prefs.muted });
  }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  if (prefs) {
    if (Number.isFinite(prefs.duration)) state.duration = clamp(prefs.duration, MIN_MS, MAX_MS);
    state.muted = !!prefs.muted;
  }
  state.status = 'idle';
  state.remaining = state.duration;
  state.endAt = 0;

  // 2. Running timer: only present if this same window was reloaded.
  const s = readJSON(sessionStorage, SESSION_KEY);
  if (!s || !['idle', 'running', 'paused', 'done'].includes(s.status)) return;
  if (Number.isFinite(s.duration)) state.duration = clamp(s.duration, MIN_MS, MAX_MS);
  if (Number.isFinite(s.remaining)) state.remaining = clamp(s.remaining, 0, MAX_MS);
  if (Number.isFinite(s.endAt)) state.endAt = s.endAt;
  state.status = s.status;
  // Expired during the reload itself: show as finished, without re-sounding the alarm.
  if (state.status === 'running' && state.endAt <= Date.now()) state.status = 'done';
}

/* ------------------------------------------------------------------- audio */

let audioCtx = null;

function unlockAudio() {
  // Browsers only let an AudioContext run after a user gesture, so we create /
  // resume it from click & key handlers; the alarm later reuses it.
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch { /* no Web Audio */ }
}

function beep(t, freq, dur) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function chime() {
  if (state.muted || !audioCtx || audioCtx.state !== 'running') return;
  const t = audioCtx.currentTime + 0.02;
  beep(t, 880, 0.16);
  beep(t + 0.2, 880, 0.16);
  beep(t + 0.4, 1175, 0.28);
}

let alarmTimer = 0;
function startAlarm() {
  stopAlarm();
  let n = 0;
  const ring = () => {
    chime();
    if (++n < ALARM_REPEATS) alarmTimer = setTimeout(ring, ALARM_INTERVAL_MS);
  };
  ring();
}
function stopAlarm() { clearTimeout(alarmTimer); alarmTimer = 0; }

/* --------------------------------------------------------------- wake lock */

let wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* denied or unsupported: harmless */ }
}
function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }

/* ------------------------------------------------------------ state machine */

let finishTimer = 0;

/** One-shot timeout at endAt. A single (non-chained) timeout is not subject to
 *  Chrome's "intensive" 1-per-minute throttling of hidden pages. */
function scheduleFinish() {
  clearTimeout(finishTimer);
  if (state.status !== 'running') return;
  finishTimer = setTimeout(() => {
    if (state.status === 'running' && state.endAt - Date.now() <= 25) finish(true);
    else scheduleFinish();
  }, Math.max(0, state.endAt - Date.now()));
}

function start() {
  if (state.status === 'running') return;
  if (state.status === 'done') { reset(); }
  if (state.remaining <= 0) state.remaining = state.duration;
  state.endAt = Date.now() + state.remaining;
  state.status = 'running';
  scheduleFinish();
  acquireWakeLock();
  changed();
}

function pause() {
  if (state.status !== 'running') return;
  state.remaining = Math.max(0, state.endAt - Date.now());
  state.status = 'paused';
  clearTimeout(finishTimer);
  releaseWakeLock();
  changed();
}

function toggle() {
  if (state.status === 'running') pause();
  else if (state.status === 'done') reset();
  else start();
}

function reset() {
  clearTimeout(finishTimer);
  stopAlarm();
  releaseWakeLock();
  state.status = 'idle';
  state.remaining = state.duration;
  state.endAt = 0;
  changed();
}

function finish(withAlarm) {
  clearTimeout(finishTimer);
  state.status = 'done';
  releaseWakeLock();
  if (withAlarm) startAlarm();
  changed();
}

function setDuration(ms) {
  const d = clamp(ms, MIN_MS, MAX_MS);
  stopAlarm();
  clearTimeout(finishTimer);
  state.duration = d;
  state.remaining = d;
  state.endAt = 0;
  state.status = 'idle';
  changed();
}

/** +/- adjustments work in every state; while running they shift the end time. */
function adjust(deltaMs) {
  const now = Date.now();
  if (state.status === 'running') {
    const rem = state.endAt - now + deltaMs;
    state.duration = clamp(state.duration + deltaMs, MIN_MS, MAX_MS);
    if (rem <= 0) { state.endAt = now; finish(true); return; }
    state.endAt = now + Math.min(rem, MAX_MS);
    scheduleFinish();
    changed();
  } else if (state.status === 'paused') {
    state.remaining = clamp(state.remaining + deltaMs, MIN_MS, MAX_MS);
    state.duration = clamp(Math.max(state.duration + deltaMs, state.remaining), MIN_MS, MAX_MS);
    changed();
  } else {
    setDuration(state.duration + deltaMs);
  }
}

/* ------------------------------------------------------------------ render */

/**
 * 60 minute ticks; minute labels 0, 5 … 55 on the outer ring; small hour
 * numerals 0 … 11 on an inner ring (0 at the top = "zero hour"), all numbered
 * clockwise like a clock face.
 */
function buildDial() {
  const NS = 'http://www.w3.org/2000/svg';
  const LABEL_R = 83;
  const HOUR_LABEL_R = 62.5;
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('y1', major ? -89 : -92);
    line.setAttribute('y2', -96);
    line.setAttribute('transform', `rotate(${i * 6})`);
    if (major) line.setAttribute('class', 'major');
    el.ticks.appendChild(line);
    if (major) {
      const a = (i * 6 * Math.PI) / 180;
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', (Math.sin(a) * LABEL_R).toFixed(2));
      text.setAttribute('y', (-Math.cos(a) * LABEL_R).toFixed(2));
      text.textContent = String(i);
      el.labels.appendChild(text);

      const hour = document.createElementNS(NS, 'text');
      hour.setAttribute('x', (Math.sin(a) * HOUR_LABEL_R).toFixed(2));
      hour.setAttribute('y', (-Math.cos(a) * HOUR_LABEL_R).toFixed(2));
      hour.textContent = String(i / 5);
      el.hourLabels.appendChild(hour);
    }
  }
}

let lastDigits = '';
let lastStatus = '';
let lastTitle = '';

function render(now = Date.now()) {
  const rem = remainingAt(now);
  const frac = state.duration > 0 ? clamp(rem / state.duration, 0, 1) : 0;
  const elapsedFrac = 1 - frac;

  // A clock running backwards to "zero hour". Every hand shows time REMAINING
  // and moves counter-clockwise (its angle shrinks as time passes); all three
  // meet at 12 when the countdown hits zero, and stay parked there in overtime.
  //   little hand: hours remaining, one turn per 12 h (points at "5" = 1 h)
  //   big hand:    minutes remaining within the hour, one turn per hour
  //   sweep hand:  seconds remaining within the minute, one turn per minute
  // The arc from 12 o'clock clockwise to the big hand is the time remaining in
  // the current hour.
  const r = Math.max(rem, 0);
  const hourAngle = ((r % HALF_DAY_MS) / HALF_DAY_MS) * 360;
  const minAngle = ((r % HOUR_MS) / HOUR_MS) * 360;
  const secAngle = ((r % MINUTE_MS) / MINUTE_MS) * 360;
  el.hourHand.setAttribute('transform', `rotate(${hourAngle})`);
  el.minHand.setAttribute('transform', `rotate(${minAngle})`);
  el.secHand.setAttribute('transform', `rotate(${secAngle})`);

  // Arc uses a lap in (0, 60 min] so exactly 60:00 / 2:00:00 draw a full
  // circle rather than an empty one; a faint full ring means "> 1 h left".
  const lap = r > 0 ? ((r - 1) % HOUR_MS) + 1 : 0;
  el.arc.style.strokeDasharray = `${(lap / HOUR_MS) * 100} 100`;
  el.face.classList.toggle('multi-hour', r > HOUR_MS);

  el.barFill.style.transform = `scaleX(${elapsedFrac})`;
  el.bar.setAttribute('aria-valuenow', String(Math.round(elapsedFrac * 100)));

  const longFmt = state.duration >= 3600000;
  const digits = formatClock(rem, longFmt);
  if (digits !== lastDigits) {
    el.digits.textContent = digits;
    el.digits.classList.toggle('long', longFmt);
    lastDigits = digits;
  }

  let status;
  switch (state.status) {
    case 'running': status = `ends ${endTimeFmt.format(state.endAt)}`; break;
    case 'paused':  status = 'paused'; break;
    case 'done':    status = "time's up"; break;
    default:        status = 'ready';
  }
  if (status !== lastStatus) { el.status.textContent = status; lastStatus = status; }

  el.face.classList.toggle('warn', (state.status === 'running' || state.status === 'paused') && frac <= 0.1);
  el.face.classList.toggle('done', state.status === 'done');
  el.face.classList.toggle('paused', state.status === 'paused');

  const title = state.status === 'idle' ? 'Countdown'
    : state.status === 'done' ? `⏰ ${digits} · Countdown`
    : `${digits} · Countdown`;
  if (title !== lastTitle) { document.title = title; lastTitle = title; }
}

let rafId = 0;
function loop() {
  render();
  rafId = (state.status === 'running' || state.status === 'done') ? requestAnimationFrame(loop) : 0;
}
function ensureLoop() { if (!rafId) loop(); }

/** Called after every state transition. */
function changed() {
  save();
  syncControls();
  ensureLoop();
  render();
}

/* ---------------------------------------------------------------- controls */

function syncControls() {
  const running = state.status === 'running';
  const [icon, label] = running ? ['pause', 'Pause'] : state.status === 'paused' ? ['play', 'Resume']
    : state.status === 'done' ? ['stop', 'Dismiss'] : ['play', 'Start'];
  setIcon(el.startBtn, icon, label, 'Space');
  for (const inp of [el.inH, el.inM, el.inS]) inp.disabled = running;
  el.presets.setAttribute('aria-disabled', String(running));
  el.presetSelect.disabled = running;
  setIcon(el.muteBtn, state.muted ? 'muted' : 'sound', state.muted ? 'Unmute' : 'Mute', 'M');
  el.muteBtn.setAttribute('aria-pressed', String(state.muted));
  syncFullscreenButton();
  if (document.activeElement && ![el.inH, el.inM, el.inS].includes(document.activeElement)) {
    writeInputs(state.duration);
  }
}

function setIcon(btn, icon, label, key) {
  const use = btn.querySelector('use');
  if (use.getAttribute('href') !== `#i-${icon}`) use.setAttribute('href', `#i-${icon}`);
  btn.setAttribute('aria-label', label);
  btn.title = `${label} (${key})`;
}

function syncFullscreenButton() {
  const fs = !!document.fullscreenElement;
  setIcon(el.fsBtn, fs ? 'fs-exit' : 'fs', fs ? 'Exit fullscreen' : 'Fullscreen', 'F');
}

/*
 * Never let the window hide the clock. Browsers offer no way to set a minimum
 * window size, so instead .app is always laid out big enough for a
 * --face-min clock plus the controls (as they actually measure at that width);
 * if the window is smaller, the whole of .app is scaled down uniformly to fit.
 * Nothing scrolls and nothing is cut off; it just gets smaller.
 */
const MIN_LAYOUT_W = 250;   // face-min + side padding, and room for the controls

/**
 * Two arrangements: controls below the clock (default) or beside it
 * (`html.wide`). On every resize we lay out both and measure how big the clock
 * face comes out in each. The first time, the bigger one wins; after that we
 * only switch when the other arrangement is more than SWITCH_MARGIN bigger
 * (hysteresis), so dragging near the cut-over doesn't make it flip-flop.
 */
const SWITCH_MARGIN = 0.05;
let currentWide = null;     // null = not decided yet
function fitToWindow() {
  const stacked = applyLayout(false);
  const wide = applyLayout(true);
  let useWide;
  if (currentWide === null) useWide = wide.face > stacked.face;
  else if (currentWide) useWide = !(stacked.face > wide.face * (1 + SWITCH_MARGIN));
  else useWide = wide.face > stacked.face * (1 + SWITCH_MARGIN);
  currentWide = useWide;
  if (!useWide) applyLayout(false);   // applyLayout(true) ran last, so only "below" needs re-applying
}

/** Apply one arrangement, scale it to fit, and report the resulting face size (screen px). */
function applyLayout(wide) {
  const root = document.documentElement;
  root.classList.toggle('wide', wide);
  const faceMin = parseFloat(getComputedStyle(root).getPropertyValue('--face-min')) || 200;
  const stage = document.querySelector('.stage');
  const controls = document.getElementById('controls');
  let s = Math.min(1, innerWidth / MIN_LAYOUT_W);
  // Controls can re-wrap when the layout size changes, so settle in a few passes.
  for (let i = 0; i < 3; i++) {
    root.style.setProperty('--ui-scale', String(s));
    const cs = getComputedStyle(stage);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const needW = wide ? faceMin + padX + controls.offsetWidth : MIN_LAYOUT_W;
    const needH = wide ? Math.max(faceMin + padY, controls.offsetHeight)
                       : faceMin + padY + controls.offsetHeight;
    s = Math.min(1, innerWidth / needW, innerHeight / needH);
  }
  root.style.setProperty('--ui-scale', String(s));
  return { s, face: el.face.getBoundingClientRect().width };
}

function writeInputs(ms) {
  const t = Math.round(ms / 1000);
  el.inH.value = pad2(Math.floor(t / 3600));
  el.inM.value = pad2(Math.floor((t % 3600) / 60));
  el.inS.value = pad2(t % 60);
}

function readInputs() {
  const n = (inp) => parseInt(inp.value.replace(/\D/g, ''), 10) || 0;
  return ((n(el.inH) * 60 + n(el.inM)) * 60 + n(el.inS)) * 1000;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function toggleMute() {
  state.muted = !state.muted;
  if (state.muted) stopAlarm();
  changed();
}

/**
 * Kiosk-style lock-down: no right-click menu, no dragging, and no browser
 * keyboard shortcuts (Ctrl+S, Ctrl+P, F5, Ctrl+R, Ctrl+zoom, …). Every keydown
 * has its browser default cancelled, in the capture phase so it happens before
 * anything else. Exceptions, so the app stays usable from the keyboard:
 *   - plain typing in the time fields / preset dropdown (no Ctrl/Alt/Meta);
 *   - plain Tab / Shift+Tab to move focus;
 *   - Enter on a focused button presses it (done here, since its default is cancelled).
 * The app's own shortcuts (Space, R, M, F, arrows, +/-) still run: cancelling
 * the default doesn't stop the event reaching the app's handler.
 * Shortcuts handled by the browser or window manager before the page sees them
 * (e.g. Alt+F4, and possibly Ctrl+W / Ctrl+N / Ctrl+T) can't be blocked by a page.
 */
function lockDownBrowserDefaults() {
  addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });
  addEventListener('dragstart', (e) => e.preventDefault(), { capture: true });

  addEventListener('keydown', (e) => {
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    const t = e.target;
    if (plain && (t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    if (plain && e.key === 'Tab') return;
    e.preventDefault();
    if (plain && e.key === 'Enter' && t instanceof HTMLButtonElement) t.click();
  }, { capture: true });
}

function bindEvents() {
  // Any interaction unlocks audio (needed when started via ?autostart=1).
  for (const type of ['pointerdown', 'keydown']) {
    addEventListener(type, unlockAudio, { capture: true });
  }

  // Mouse clicks shouldn't leave focus on a button (Space would re-trigger it).
  for (const btn of document.querySelectorAll('.controls button')) {
    btn.addEventListener('pointerup', () => btn.blur());
  }

  el.face.addEventListener('click', toggle);
  el.startBtn.addEventListener('click', toggle);
  el.resetBtn.addEventListener('click', reset);
  el.muteBtn.addEventListener('click', toggleMute);
  el.fsBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreenButton);
  addEventListener('resize', fitToWindow);

  el.presets.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-min]');
    if (b) setDuration(Number(b.dataset.min) * 60000);
  });

  // Dropdown version of the presets (shown instead of the buttons in small
  // windows). Options mirror the buttons so there is one list to maintain.
  for (const b of el.presets.querySelectorAll('button[data-min]')) {
    el.presetSelect.add(new Option(b.textContent, b.dataset.min));
  }
  el.presetSelect.addEventListener('change', () => {
    const min = Number(el.presetSelect.value);
    el.presetSelect.value = '';          // back to "Preset…" so the same choice works again
    el.presetSelect.blur();              // so Space goes back to start/pause
    if (min > 0) setDuration(min * 60000);
  });

  for (const inp of [el.inH, el.inM, el.inS]) {
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 2);
      const ms = readInputs();
      if (ms >= MIN_MS) setDuration(ms);
    });
    inp.addEventListener('blur', () => writeInputs(state.duration));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { inp.blur(); start(); e.preventDefault(); }
      if (e.key === 'Escape') inp.blur();
    });
  }

  lockDownBrowserDefaults();

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.ctrlKey || e.altKey || e.metaKey) return;
    const big = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case ' ':
        toggle(); break; // Space is always start/pause, even if a button has focus
      case 'Enter':
        if (e.target instanceof HTMLButtonElement) return; // keyboard users: Enter activates the button
        toggle(); break;
      case 'r': case 'R': case 'Escape': reset(); break;
      case 'm': case 'M': toggleMute(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case '+': case '=': case 'ArrowUp':   adjust(60000 * big); break;
      case '-': case '_': case 'ArrowDown': adjust(-60000 * big); break;
      default: return;
    }
    e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (state.status === 'running') acquireWakeLock();
      render();
    }
  });

  // Keep the window/taskbar title roughly current even when rAF is paused.
  setInterval(() => { if (state.status !== 'idle') render(); }, 1000);
}

/* -------------------------------------------------------------------- boot */

function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  const t = params.get('t');
  if (t === null) return;
  const ms = parseDuration(t);
  if (ms !== null) {
    setDuration(ms);
    if (['1', 'true', 'yes', ''].includes(params.get('autostart') ?? 'no')) start();
  }
  // Strip the params so a reload doesn't restart the timer.
  history.replaceState(null, '', location.pathname);
}

function boot() {
  fitToWindow();
  buildDial();
  load();
  bindEvents();
  applyUrlParams();
  if (state.status === 'running') { scheduleFinish(); acquireWakeLock(); }
  writeInputs(state.duration);
  syncControls();
  ensureLoop();
  render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed:', err));
  }
}

boot();
