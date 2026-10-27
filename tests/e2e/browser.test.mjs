import assert from 'node:assert/strict';
import test from 'node:test';
import { browserConfig, launchBrowser } from './browser.mjs';

test('reports the requested browser and version', async () => {
  const calls = [];
  const browser = { version: () => '156.test' };
  const result = await launchBrowser('A', { channel: 'chrome' }, {
    async launch(options) { calls.push(options); return browser; },
  });
  assert.equal(result.browser, browser);
  assert.equal(result.engine, 'chrome 156.test');
  assert.deepEqual(calls, [{ channel: 'chrome', headless: true }]);
});

test('an unavailable requested browser fails without launching a replacement', async () => {
  const calls = [];
  const launcher = {
    async launch(options) {
      calls.push(options);
      if (options.channel === 'chrome') throw new Error('Chrome is unavailable');
      return { version: () => 'Edge replacement' };
    },
  };
  await assert.rejects(launchBrowser('B', { channel: 'chrome' }, launcher), /Chrome is unavailable/);
  assert.equal(calls.length, 1);
});

test('selects each browser independently while preserving the single-channel option', () => {
  assert.deepEqual(browserConfig({}, 'A'), { channel: 'msedge' });
  const env = { E2E_BROWSER: 'chrome', E2E_BROWSER_B: 'msedge', E2E_EXECUTABLE_A: 'portable/chrome.exe' };
  assert.deepEqual(browserConfig(env, 'A'), { channel: 'chrome', executablePath: 'portable/chrome.exe' });
  assert.deepEqual(browserConfig(env, 'B'), { channel: 'msedge' });
});

test('rejects an unknown channel before starting any browser', () => {
  assert.throws(() => browserConfig({ E2E_BROWSER: 'typo' }, 'A'), /chrome 或 msedge/);
});

test('uses an explicit executable without an implicit channel override', async () => {
  const calls = [];
  await launchBrowser('A', { channel: 'chrome', executablePath: 'portable/chrome.exe' }, {
    async launch(options) { calls.push(options); return { version: () => '156.test' }; },
  });
  assert.deepEqual(calls, [{ executablePath: 'portable/chrome.exe', headless: true }]);
});
