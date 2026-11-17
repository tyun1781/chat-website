import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {config} from 'dotenv';
import {createPool} from '../src/db.js';
import {buildApp} from '../src/app.js';

test('real PostgreSQL account lifecycle, security boundaries, and throttling',{skip:process.env.RUN_DB_TESTS!=='1'},async()=>{
 config({path:'.env.test',override:true});
 const url=process.env.DATABASE_URL!;assert.equal(new URL(url).pathname,'/message_board_test');
 const pool=createPool(url,2000);
 const origin='http://localhost:5173';const app=buildApp(pool,false,{pool,origins:[origin],production:false});
 const name='it_'+randomBytes(8).toString('hex'), pass='Integration_'+randomBytes(16).toString('hex'),next=pass+'next';
 const call=(method:'POST'|'GET'|'PATCH',url:string,payload?:object,cookie?:string,csrf?:string,from=origin)=>app.inject({method,url,payload,headers:{origin:from,...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})}});
 try {
  assert.equal((await app.inject('/api/ready')).statusCode,200);
  assert.equal((await call('POST','/api/auth/register',{username:name,password:pass,nickname:'用户'},undefined,undefined,'https://evil.test')).statusCode,403);
  assert.equal((await call('POST','/api/auth/register',{username:name,password:pass,nickname:'用户',role:'admin'})).statusCode,400);
  const registered=await call('POST','/api/auth/register',{username:name.toUpperCase(),password:pass,nickname:'  用户😀  '});
  assert.equal(registered.statusCode,201,registered.body);assert.equal(registered.json().data.user.role,'user');assert.equal(registered.json().data.user.nickname,'用户😀');
  assert.equal(registered.headers['set-cookie'],undefined);assert.equal(registered.body.includes('password'),false);
  assert.equal((await call('POST','/api/auth/register',{username:name,password:pass,nickname:'重复'})).statusCode,409);
  const persisted=(await pool.query('SELECT * FROM users WHERE username=$1',[name])).rows[0];assert.match(persisted.password_hash,/^\$argon2id\$/);assert.notEqual(persisted.password_hash,pass);
  assert.equal((await call('POST','/api/auth/login',{username:name,password:pass+'bad'})).statusCode,401);
  const login=await call('POST','/api/auth/login',{username:name,password:pass});assert.equal(login.statusCode,200,login.body);
  const setCookie=String(login.headers['set-cookie']);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Lax/);const cookie=setCookie.split(';')[0]!;let csrf=login.json().data.csrfToken;
  const stored=(await pool.query('SELECT * FROM sessions WHERE user_id=$1',[persisted.id])).rows[0];assert.notEqual(stored.token_hash,cookie.split('=')[1]);assert.notEqual(stored.csrf_token_hash,csrf);
  assert.equal((await call('PATCH','/api/users/me',{nickname:'更新'},cookie)).statusCode,403);
  const restored=await call('GET','/api/auth/session',undefined,cookie);assert.equal(restored.statusCode,200);const newCsrf=restored.json().data.csrfToken;assert.notEqual(newCsrf,csrf);
  assert.equal((await call('PATCH','/api/users/me',{nickname:'更新'},cookie,csrf)).json().error.code,'CSRF_INVALID');csrf=newCsrf;
  assert.equal((await call('PATCH','/api/users/me',{nickname:'更新'},cookie,csrf)).json().data.user.nickname,'更新');
  const login2=await call('POST','/api/auth/login',{username:name,password:pass});const cookie2=String(login2.headers['set-cookie']).split(';')[0]!;
  assert.equal((await call('POST','/api/users/me/password',{currentPassword:pass+'bad',newPassword:next},cookie,csrf)).statusCode,401);
  assert.equal((await call('POST','/api/users/me/password',{currentPassword:pass,newPassword:next},cookie,csrf)).statusCode,204);
  assert.equal((await call('GET','/api/auth/session',undefined,cookie)).statusCode,401);assert.equal((await call('GET','/api/auth/session',undefined,cookie2)).statusCode,401);
  assert.equal((await call('POST','/api/auth/login',{username:name,password:pass})).statusCode,401);
  const fresh=await call('POST','/api/auth/login',{username:name,password:next});assert.equal(fresh.statusCode,200);const cookie3=String(fresh.headers['set-cookie']).split(';')[0]!;
  assert.equal((await call('POST','/api/auth/logout',undefined,cookie3,fresh.json().data.csrfToken)).statusCode,204);
  assert.equal((await call('GET','/api/auth/session',undefined,cookie3)).statusCode,401);assert.equal((await call('POST','/api/auth/logout',undefined,cookie3)).statusCode,204);
  await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[persisted.id]);
  assert.equal((await call('POST','/api/auth/login',{username:name,password:next})).json().error.code,'ACCOUNT_DISABLED');
  assert.equal((await call('POST','/api/auth/login',{username:name,password:pass})).json().error.code,'INVALID_CREDENTIALS');
  let limited;for(let i=0;i<5;i++)limited=await call('POST','/api/auth/login',{username:name,password:pass});assert.equal(limited!.statusCode,429);assert.ok(limited!.headers['retry-after']);
 } finally {
  await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username=$1)',[name]);await pool.query('DELETE FROM users WHERE username=$1',[name]);await app.close();await pool.end();
 }
});
