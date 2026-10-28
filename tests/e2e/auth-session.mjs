import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/** Disposable account for a test-owned database. No credentials in reports. */
export async function registerTestSession(base, label = 'e2e') {
  const username = `test_${randomBytes(8).toString('hex')}`;
  const response = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName: label, password: randomBytes(24).toString('hex') }),
  });
  assert.equal(response.status, 201, 'test account registration');
  const { user, csrfToken } = (await response.json()).data;
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return {
    user, csrfToken, cookie,
    headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken },
    async apply(context) {
      await context.addCookies([{ name: 'tb_session', value: cookie.slice('tb_session='.length),
        url: base, httpOnly: true, sameSite: 'Strict', secure: new URL(base).protocol === 'https:' }]);
    },
  };
}
