import { chromium } from 'playwright-core';

export function browserConfig(env, label) {
  const channel = env[`E2E_BROWSER_${label}`] ?? env.E2E_BROWSER ?? 'msedge';
  if (!['chrome', 'msedge'].includes(channel)) {
    throw new Error(`浏览器 ${label} 的 channel 只接受 chrome 或 msedge`);
  }
  const executablePath = env[`E2E_EXECUTABLE_${label}`] ?? env.E2E_EXECUTABLE;
  return { channel, ...(executablePath ? { executablePath } : {}) };
}

/** A failed requested browser must never be counted as another browser's pass. */
export async function launchBrowser(label, { channel = 'msedge', executablePath } = {}, launcher = chromium) {
  const browser = await launcher.launch({
    ...(executablePath ? { executablePath } : { channel }),
    headless: true,
  });
  return { browser, engine: `${channel} ${browser.version()}${executablePath ? ' (explicit executable)' : ''}`, label };
}
