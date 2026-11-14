'use strict';
// Runs the test suites one after another, against both ways of running the app:
// the default file:// version and the server.js version (./countdown --server).
// Exits non-zero if any failed.
//   node run-all.js            headless suites only
//   node run-all.js --headed   also the real app-window suite (needs a display)
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['regress.js', 'lockdown.js'];
if (process.argv.includes('--headed')) suites.push('app-window.js');

const runs = [];
for (const mode of ['file', 'server']) {
  for (const s of suites) runs.push({ mode, s });
}

const failed = runs.filter(({ mode, s }) => spawnSync(process.execPath, [path.join(__dirname, s)], {
  stdio: 'inherit',
  env: { ...process.env, COUNTDOWN_TEST_MODE: mode },
}).status !== 0);

console.log(failed.length
  ? `\nFAILED: ${failed.map(({ mode, s }) => `${s} [${mode}]`).join(', ')}`
  : `\nAll ${runs.length} suite runs passed (${suites.length} suites × file and server).`);
process.exit(failed.length ? 1 : 0);
