'use strict';
// Runs the test suites one after another; exits non-zero if any failed.
//   node run-all.js            headless suites only
//   node run-all.js --headed   also the real app-window suite (needs a display)
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['regress.js', 'lockdown.js'];
if (process.argv.includes('--headed')) suites.push('app-window.js');

const failed = suites.filter((s) => spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' }).status !== 0);
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nAll ${suites.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
