'use strict';
// Runs the test suites one after another; exits non-zero if any failed.
// The app suites run against both ways of running the app: the default
// file:// version and the server.js version (./countdown --server).
//   node run-all.js            headless suites only
//   node run-all.js --headed   also the suites that open real windows (need a display)
const { spawnSync } = require('child_process');
const path = require('path');

const headed = process.argv.includes('--headed');
const appSuites = ['regress.js', 'lockdown.js', 'sound.js'];
if (headed) appSuites.push('app-window.js');

const runs = [{ s: 'launcher.js' }];
for (const mode of ['file', 'server']) {
  for (const s of appSuites) runs.push({ mode, s });
}
if (headed) runs.push({ s: 'launcher-chime.js' });

const label = ({ mode, s }) => (mode ? `${s} [${mode}]` : s);
const failed = runs.filter((r) => spawnSync(process.execPath, [path.join(__dirname, r.s)], {
  stdio: 'inherit',
  env: { ...process.env, ...(r.mode ? { COUNTDOWN_TEST_MODE: r.mode } : {}) },
}).status !== 0);

console.log(failed.length
  ? `\nFAILED: ${failed.map(label).join(', ')}`
  : `\nAll ${runs.length} suite runs passed.`);
process.exit(failed.length ? 1 : 0);
