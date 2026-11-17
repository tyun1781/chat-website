import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

// Use only the PostgreSQL driver and dotenv parser, never the application's implementation.
const requireBackend = createRequire(new URL('../backend/package.json', import.meta.url));
const { Pool } = requireBackend('pg');
const { parse } = requireBackend('dotenv');
const localEnv = parse(await readFile(process.env.TEST_ENV_FILE || new URL('../backend/.env', import.meta.url)));
const databaseUrl = process.env.TEST_DATABASE_URL || localEnv.DATABASE_URL;
assert.ok(databaseUrl, 'A local test database URL is required');
const dbTarget = new URL(databaseUrl);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(dbTarget.hostname), 'Only local DB targets are allowed');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:5173';
const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
const username = `qa_db_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`;
const password = randomBytes(24).toString('base64url');
const results = [];
let userId, cookie, csrfToken;
async function request(path, { method = 'GET', body, session = cookie } = {}) {
  const headers = { Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Cookie = session;
  const r = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => undefined) };
}
async function step(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, status: 'failed', detail: error.message }); throw error; }
}
try {
  await step('Dedicated local database has migrated schema', async () => {
    const { rows } = await pool.query('SELECT current_database() AS name');
    assert.match(rows[0].name, /(?:dev|test)/i, 'Requires explicitly named development or test database');
    const migrated = await pool.query('SELECT name FROM schema_migrations');
    assert.ok(migrated.rows.some(row => row.name === '001_initial.sql'));
  });
  await step('Create isolated QA user and session over real HTTP', async () => {
    const created = await request('/auth/register', { method: 'POST', body: { username, password, nickname: '数据库安全测试' }, session: undefined });
    assert.equal(created.status, 201, `Registration HTTP ${created.status}`); userId = created.body.data.user.id;
    const login = await request('/auth/login', { method: 'POST', body: { username, password }, session: undefined });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie().find(x => x.startsWith('dev_session=')).split(';')[0];
    csrfToken = login.body.data.csrfToken;
  });
  await step('DB stores Argon2id password and hashed session/CSRF tokens', async () => {
    const { rows } = await pool.query('SELECT u.password_hash,u.role,s.token_hash,s.csrf_token_hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1', [userId]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].password_hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    assert.notEqual(rows[0].password_hash, password);
    assert.equal(rows[0].role, 'user');
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    assert.equal(rows[0].token_hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(rows[0].csrf_token_hash, createHash('sha256').update(csrfToken).digest('hex'));
  });
  await step('Disabled user is denied even with previously valid session', async () => {
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1 AND username=$2", [userId, username]);
    const session = await request('/auth/session');
    assert.equal(session.status, 403); assert.equal(session.body.error.code, 'ACCOUNT_DISABLED');
    const incorrect = await request('/auth/login', { method: 'POST', body: { username, password: 'incorrect-test-password' }, session: undefined });
    assert.equal(incorrect.status, 401); assert.equal(incorrect.body.error.code, 'INVALID_CREDENTIALS');
    const correct = await request('/auth/login', { method: 'POST', body: { username, password }, session: undefined });
    assert.equal(correct.status, 403); assert.equal(correct.body.error.code, 'ACCOUNT_DISABLED');
    await pool.query("UPDATE users SET status='active' WHERE id=$1 AND username=$2", [userId, username]);
  });
  await step('Expired session cannot be restored', async () => {
    await pool.query("UPDATE sessions SET created_at=now()-interval '8 days', expires_at=now()-interval '1 day' WHERE user_id=$1", [userId]);
    const session = await request('/auth/session');
    assert.equal(session.status, 401); assert.equal(session.body.error.code, 'UNAUTHENTICATED');
  });
} catch (error) {
  console.error(`FAIL ${error.message}`); process.exitCode = 1;
} finally {
  // Only the uniquely created QA user is restored. Existing user records are never modified.
  if (userId) await pool.query("UPDATE users SET status='active' WHERE id=$1 AND username=$2", [userId, username]).catch(() => {});
  await pool.end();
  await writeFile(new URL('./phase2-db-results.json', import.meta.url), `${JSON.stringify({ executedAt: new Date().toISOString(), username, results, note: 'Changes limited to the newly created QA account. Credentials and hashes are not recorded. Direct DB status checks do not prove future admin endpoints revoke sessions.' }, null, 2)}\n`);
}
