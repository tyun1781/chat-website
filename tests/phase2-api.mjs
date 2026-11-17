import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// Independent black-box tests: a fresh local server and real development/test DB are required.
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only local test targets are allowed');
const username = `qa_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
const password = randomBytes(24).toString('base64url');
const newPassword = randomBytes(24).toString('base64url');
const results = [];
let cookieA, cookieB, csrfA, userId;

async function request(path, { method = 'GET', body, cookie, csrf, requestOrigin = origin } = {}) {
  const headers = {};
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const response = await fetch(`${base}/api${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { throw new Error(`Non-JSON response from ${path}, HTTP ${response.status}`); }
  if (response.status >= 400) {
    assert.ok(json?.error?.code && json?.error?.message && json?.error?.requestId, 'Errors must have code, message and requestId');
    assert.ok(!/password_hash|token_hash|postgres(?:ql)?:\/\/|node_modules|SELECT\s+.+FROM/i.test(text), 'Error contains internal details');
  }
  return { status: response.status, headers: response.headers, json };
}

function expect(response, status, code) {
  assert.equal(response.status, status, `Expected HTTP ${status}, received ${response.status}; code=${response.json?.error?.code || 'none'}`);
  if (code) assert.equal(response.json?.error?.code, code);
  return response;
}
async function step(name, run) {
  const started = Date.now();
  try { await run(); results.push({ name, status: 'passed', durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', detail: error.message }); throw error; }
}
function sessionCookie(response) {
  const value = response.headers.getSetCookie().find(value => value.startsWith('dev_session='));
  assert.ok(value, 'Development session cookie is missing');
  assert.match(value, /;\s*HttpOnly/i);
  assert.match(value, /;\s*SameSite=Lax/i);
  assert.match(value, /;\s*Path=\//i);
  assert.doesNotMatch(value, /;\s*Domain=/i);
  return value.split(';')[0];
}

try {
  await step('Real server and database ready', async () => {
    expect(await request('/health'), 200);
    const r = expect(await request('/ready'), 200);
    assert.equal(r.json.data.database, 'up');
    assert.equal(r.json.data.schema, 'ready');
  });
  await step('Anonymous session is denied', async () => expect(await request('/auth/session'), 401, 'UNAUTHENTICATED'));
  await step('Cross-origin registration is denied', async () => {
    expect(await request('/auth/register', { method: 'POST', body: { username, password, nickname: '测试' }, requestOrigin: 'https://untrusted.invalid' }), 403);
  });
  await step('Registration assigns only ordinary role and does not sign in', async () => {
    const r = expect(await request('/auth/register', { method: 'POST', body: { username: username.toUpperCase(), password, nickname: '  测试访客🌱  ' } }), 201);
    assert.equal(r.json.data.user.username, username);
    assert.equal(r.json.data.user.nickname, '测试访客🌱');
    assert.equal(r.json.data.user.role, 'user');
    assert.equal(r.json.data.user.status, 'active');
    assert.ok(!JSON.stringify(r.json).includes('password'));
    assert.equal(r.headers.getSetCookie().length, 0);
    userId = r.json.data.user.id;
  });
  await step('Duplicate normalized username is rejected', async () => expect(await request('/auth/register', { method: 'POST', body: { username, password, nickname: '重复账号' } }), 409, 'USERNAME_TAKEN'));
  await step('Registration rejects privilege injection', async () => expect(await request('/auth/register', { method: 'POST', body: { username: `${username}r`, password, nickname: '测试', role: 'admin' } }), 400, 'VALIDATION_ERROR'));
  await step('Wrong password and unknown user have same public error', async () => {
    const bad = expect(await request('/auth/login', { method: 'POST', body: { username, password: 'incorrect-test-password' } }), 401, 'INVALID_CREDENTIALS');
    const missing = expect(await request('/auth/login', { method: 'POST', body: { username: `${username}x`, password } }), 401, 'INVALID_CREDENTIALS');
    assert.equal(bad.json.error.message, missing.json.error.message);
  });
  await step('Login sets protected cookie and returns CSRF', async () => {
    const r = expect(await request('/auth/login', { method: 'POST', body: { username, password } }), 200);
    cookieA = sessionCookie(r); csrfA = r.json.data.csrfToken;
    assert.ok(typeof csrfA === 'string' && csrfA.length >= 32);
    assert.equal(r.json.data.user.id, userId);
    const remaining = Date.parse(r.json.data.expiresAt) - Date.now();
    assert.ok(remaining > 6.9 * 86400000 && remaining <= 7 * 86400000 + 5000);
  });
  await step('Second login creates a distinct session', async () => {
    const r = expect(await request('/auth/login', { method: 'POST', body: { username, password } }), 200);
    cookieB = sessionCookie(r); assert.notEqual(cookieB, cookieA);
  });
  await step('Profile write requires CSRF and same origin', async () => {
    expect(await request('/users/me', { method: 'PATCH', body: { nickname: '非法修改' }, cookie: cookieA }), 403, 'CSRF_INVALID');
    expect(await request('/users/me', { method: 'PATCH', body: { nickname: '非法修改' }, cookie: cookieA, csrf: csrfA, requestOrigin: 'https://untrusted.invalid' }), 403);
  });
  await step('Session restore rotates CSRF and invalidates old token', async () => {
    const previous = csrfA;
    const r = expect(await request('/auth/session', { cookie: cookieA }), 200);
    csrfA = r.json.data.csrfToken; assert.notEqual(csrfA, previous);
    expect(await request('/users/me', { method: 'PATCH', cookie: cookieA, csrf: previous, body: { nickname: '过期令牌' } }), 403, 'CSRF_INVALID');
  });
  await step('Nickname validation handles Unicode and rejects role/status changes', async () => {
    for (const body of [{ nickname: ' ' }, { nickname: '🌱'.repeat(33) }, { nickname: '越权', role: 'admin' }, { nickname: '越权', status: 'disabled' }]) {
      expect(await request('/users/me', { method: 'PATCH', cookie: cookieA, csrf: csrfA, body }), 400, 'VALIDATION_ERROR');
    }
    const r = expect(await request('/users/me', { method: 'PATCH', cookie: cookieA, csrf: csrfA, body: { nickname: '🌱'.repeat(32) } }), 200);
    assert.equal(r.json.data.user.nickname, '🌱'.repeat(32));
    assert.equal(r.json.data.user.role, 'user');
  });
  await step('Password change validates old password and length', async () => {
    expect(await request('/users/me/password', { method: 'POST', cookie: cookieA, csrf: csrfA, body: { currentPassword: 'incorrect-test-password', newPassword } }), 401, 'INVALID_CREDENTIALS');
    for (const invalid of ['short', 'a'.repeat(129)]) {
      expect(await request('/users/me/password', { method: 'POST', cookie: cookieA, csrf: csrfA, body: { currentPassword: password, newPassword: invalid } }), 400, 'VALIDATION_ERROR');
    }
  });
  await step('Password change invalidates all sessions', async () => {
    const r = expect(await request('/users/me/password', { method: 'POST', cookie: cookieA, csrf: csrfA, body: { currentPassword: password, newPassword } }), 204);
    assert.ok(r.headers.getSetCookie().some(value => /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(value)), 'Password change must clear the cookie');
    expect(await request('/auth/session', { cookie: cookieA }), 401, 'UNAUTHENTICATED');
    expect(await request('/auth/session', { cookie: cookieB }), 401, 'UNAUTHENTICATED');
    expect(await request('/auth/login', { method: 'POST', body: { username, password } }), 401, 'INVALID_CREDENTIALS');
    const login = expect(await request('/auth/login', { method: 'POST', body: { username, password: newPassword } }), 200);
    cookieA = sessionCookie(login); csrfA = login.json.data.csrfToken;
  });
  await step('Logout revokes cookie and is idempotent', async () => {
    expect(await request('/auth/logout', { method: 'POST', cookie: cookieA }), 403, 'CSRF_INVALID');
    expect(await request('/auth/logout', { method: 'POST', cookie: cookieA, csrf: csrfA }), 204);
    expect(await request('/auth/session', { cookie: cookieA }), 401, 'UNAUTHENTICATED');
    expect(await request('/auth/logout', { method: 'POST', cookie: cookieA }), 204);
    expect(await request('/auth/logout', { method: 'POST', requestOrigin: 'https://untrusted.invalid' }), 403);
  });
} catch (error) {
  console.error(`FAIL ${error.message}`); process.exitCode = 1;
} finally {
  const report = { executedAt: new Date().toISOString(), baseUrl: base, origin, username, results, note: 'Requires real local PostgreSQL. Test account is retained; no existing user data is deleted. Credentials and cookies are not recorded.' };
  await writeFile(new URL('./phase2-api-results.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${results.filter(result => result.status === 'passed').length}/${results.length} executed steps passed`);
}
