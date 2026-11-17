import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173';
const { username } = JSON.parse(await readFile(new URL('./phase2-api-results.json', import.meta.url)));
const results = [];
async function post(path, body, extraHeaders = {}) {
  const r = await fetch(`${base}/api${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const json = await r.json();
  if (r.status === 429) {
    assert.equal(json.error.code, 'RATE_LIMITED');
    assert.ok(Number(r.headers.get('retry-after')) > 0, '429 requires positive Retry-After');
  }
  return r.status;
}
async function reachesLimit(name, maxAttempts, run, otherStatus) {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await run(i);
    if (status === 429) { results.push({ name, status: 'passed', requestsUntil429: i + 1 }); console.log(`PASS ${name}`); return; }
    assert.equal(status, otherStatus, `Unexpected HTTP ${status}`);
  }
  throw new Error(`${name}: no 429 within ${maxAttempts} requests`);
}
try {
  await reachesLimit('Registration IP limit returns 429 and Retry-After', 6, () => post('/auth/register', { username, password: 'qa-invalid-password-long', nickname: '重复测试' }), 409);
  await reachesLimit('Login limit returns 429 and Retry-After', 21, i => post('/auth/login', { username: `qa_missing_${randomBytes(5).toString('hex')}_${i}`, password: 'qa-invalid-password-long' }), 401);
  const spoofed = await post('/auth/login', { username: 'qa_missing_spoof', password: 'qa-invalid-password-long' }, { 'X-Forwarded-For': '203.0.113.33' });
  assert.equal(spoofed, 429, 'Untrusted proxy header must not bypass IP limit');
  results.push({ name: 'Forged X-Forwarded-For does not bypass IP limit', status: 'passed' });
  console.log('PASS Forged X-Forwarded-For does not bypass IP limit');
} catch (error) {
  results.push({ name: 'Limit test execution', status: 'failed', detail: error.message }); console.error(`FAIL ${error.message}`); process.exitCode = 1;
} finally {
  await writeFile(new URL('./phase2-rate-results.json', import.meta.url), `${JSON.stringify({ executedAt: new Date().toISOString(), baseUrl: base, results, note: 'Run after API/DB tests on the isolated service. Existing counters mean this validates bounded enforcement and headers, not exact fresh-counter thresholds. Restart that test service before another full suite.' }, null, 2)}\n`);
}
