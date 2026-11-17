import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import type {Pool, PoolClient} from 'pg';

export class ApiError extends Error {
  constructor(public statusCode:number, public code:string, message:string) {super(message);}
}
export const passwordOptions = {type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1} as const;
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
export function objectBody(input:unknown, keys:string[]):Record<string,unknown> {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!keys.includes(k))) throw new ApiError(400,'VALIDATION_ERROR','输入字段不符合要求');
  return input as Record<string,unknown>;
}
export function username(input:unknown):string {
  if(typeof input!=='string' || !/^[a-z0-9_]{3,32}$/.test(input.toLowerCase())) throw new ApiError(400,'VALIDATION_ERROR','用户名需为 3～32 位字母、数字或下划线');
  return input.toLowerCase();
}
export function password(input:unknown):string {
  if(typeof input!=='string' || [...input].length<12 || [...input].length>128) throw new ApiError(400,'VALIDATION_ERROR','密码需为 12～128 个字符');
  return input;
}
export function nickname(input:unknown):string {
  if(typeof input!=='string' || [...input.trim()].length<1 || [...input.trim()].length>32) throw new ApiError(400,'VALIDATION_ERROR','昵称需为 1～32 个字符');
  return input.trim();
}
type UserRow={id:string;username:string;nickname:string;role:string;status:string;created_at:Date;updated_at:Date;password_hash:string};
const publicUser=(u:UserRow)=>({id:u.id,username:u.username,nickname:u.nickname,role:u.role,status:u.status,createdAt:u.created_at.toISOString(),updatedAt:u.updated_at.toISOString()});
type SessionRow=UserRow & {session_id:string;csrf_token_hash:string;expires_at:Date};
export async function transaction<T>(pool:Pool, run:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
}
export function registerAuth(app:FastifyInstance,pool:Pool,options:{origins:string[];production:boolean}) {
  app.register(cookie);
  const cookieName=options.production?'__Host-session':'dev_session';
  const cookieOptions={httpOnly:true,secure:options.production,sameSite:'lax' as const,path:'/'};
  const clear=(reply:FastifyReply)=>reply.clearCookie(cookieName,cookieOptions);
  const limits=new Map<string,{count:number;until:number}>();
  const cleanup=()=>{const now=Date.now();for(const [key,bucket] of limits)if(bucket.until<=now)limits.delete(key);};
  const timer=setInterval(cleanup,60_000);timer.unref();
  app.addHook('onClose',async()=>{clearInterval(timer);});
  function limit(key:string,max:number,windowMs:number,reply:FastifyReply) {
    const now=Date.now();let bucket=limits.get(key);
    if(!bucket || bucket.until<=now){if(limits.size>=10000){cleanup();if(limits.size>=10000)throw new ApiError(429,'RATE_LIMITED','请求过于频繁，请稍后重试');}bucket={count:0,until:now+windowMs};limits.set(key,bucket);}
    bucket.count++;
    if(bucket.count>max){reply.header('Retry-After',Math.ceil((bucket.until-now)/1000));throw new ApiError(429,'RATE_LIMITED','请求过于频繁，请稍后重试');}
  }
  app.addHook('onRequest',async(request)=>{
    if(['POST','PATCH','DELETE','PUT'].includes(request.method) && request.url.startsWith('/api/')) {
      if(typeof request.headers.origin!=='string' || !options.origins.includes(request.headers.origin)) throw new ApiError(403,'FORBIDDEN','请求来源不被允许');
    }
  });
  async function session(client:PoolClient,request:FastifyRequest,csrf=false,optional=false):Promise<SessionRow|undefined> {
    const value=request.cookies[cookieName];
    if(!value || !/^[A-Za-z0-9_-]{43}$/.test(value)){if(optional)return;throw new ApiError(401,'UNAUTHENTICATED','请先登录');}
    const result=await client.query<SessionRow>('SELECT u.*,s.id AS session_id,s.csrf_token_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() FOR NO KEY UPDATE OF u,s',[digest(value)]);
    const row=result.rows[0];
    if(!row){if(optional)return;throw new ApiError(401,'UNAUTHENTICATED','登录已过期，请重新登录');}
    if(row.status!=='active')throw new ApiError(403,'ACCOUNT_DISABLED','账号已被禁用');
    if(csrf){const provided=request.headers['x-csrf-token'];if(typeof provided!=='string' || !timingSafeEqual(Buffer.from(digest(provided),'hex'),Buffer.from(row.csrf_token_hash,'hex')))throw new ApiError(403,'CSRF_INVALID','安全凭证已过期，请重试');}
    return row;
  }
  // The dummy hash makes unknown-user logins perform the same password work.
  const dummyHash=argon2.hash(randomBytes(32),passwordOptions);
  app.post('/api/auth/register',async(request,reply)=>{
    limit('register:'+request.ip,5,3600_000,reply);
    const body=objectBody(request.body,['username','password','nickname']);
    const name=username(body.username), pass=password(body.password), nick=nickname(body.nickname);
    const hash=await argon2.hash(pass,passwordOptions);
    try {
      const result=await pool.query<UserRow>('INSERT INTO users(id,username,nickname,password_hash) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),name,nick,hash]);
      return reply.code(201).send({data:{user:publicUser(result.rows[0]!)}});
    } catch(error){if((error as {code?:string}).code==='23505')throw new ApiError(409,'USERNAME_TAKEN','用户名已被使用');throw error;}
  });
  app.post('/api/auth/login',async(request,reply)=>{
    limit('login-ip:'+request.ip,20,900_000,reply);
    const body=objectBody(request.body,['username','password']);const name=username(body.username),pass=password(body.password);
    limit('login-user:'+name,10,900_000,reply);
    const result=await transaction(pool,async(client)=>{
      const row=(await client.query<UserRow>('SELECT * FROM users WHERE username=$1 FOR UPDATE',[name])).rows[0];
      const valid=await argon2.verify(row?.password_hash ?? await dummyHash,pass);
      if(!row || !valid)throw new ApiError(401,'INVALID_CREDENTIALS','账号或密码错误');
      if(row.status!=='active')throw new ApiError(403,'ACCOUNT_DISABLED','账号已被禁用');
      const raw=token(),csrf=token(),expiresAt=new Date(Date.now()+7*86400_000);
      const prior=request.cookies[cookieName];
      if(prior)await client.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2 AND revoked_at IS NULL',[digest(prior),row.id]);
      await client.query('INSERT INTO sessions(id,user_id,token_hash,csrf_token_hash,expires_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),row.id,digest(raw),digest(csrf),expiresAt]);
      return {raw,data:{user:publicUser(row),csrfToken:csrf,expiresAt:expiresAt.toISOString()},expiresAt};
    });
    reply.setCookie(cookieName,result.raw,{...cookieOptions,expires:result.expiresAt});
    return {data:result.data};
  });
  app.get('/api/auth/session',async(request)=>transaction(pool,async(client)=>{
    const row=(await session(client,request))!;const csrfToken=token();
    await client.query('UPDATE sessions SET csrf_token_hash=$1 WHERE id=$2',[digest(csrfToken),row.session_id]);
    return {data:{user:publicUser(row),csrfToken,expiresAt:row.expires_at.toISOString()}};
  }));
  app.post('/api/auth/logout',async(request,reply)=>{
    if(request.body!==undefined)objectBody(request.body,[]);
    await transaction(pool,async(client)=>{const row=await session(client,request,true,true);if(row)await client.query('UPDATE sessions SET revoked_at=now() WHERE id=$1',[row.session_id]);});
    clear(reply);return reply.code(204).send();
  });
  app.patch('/api/users/me',async(request)=>{
    const body=objectBody(request.body,['nickname']);const nick=nickname(body.nickname);
    return transaction(pool,async(client)=>{const row=(await session(client,request,true))!;const updated=(await client.query<UserRow>('UPDATE users SET nickname=$1,updated_at=now() WHERE id=$2 RETURNING *',[nick,row.id])).rows[0]!;return {data:{user:publicUser(updated)}};});
  });
  app.post('/api/users/me/password',async(request,reply)=>{
    limit('password-ip:'+request.ip,20,900_000,reply);
    const body=objectBody(request.body,['currentPassword','newPassword']);const current=password(body.currentPassword),next=password(body.newPassword);
    await transaction(pool,async(client)=>{
      const row=(await session(client,request,true))!;
      if(!await argon2.verify(row.password_hash,current))throw new ApiError(401,'INVALID_CREDENTIALS','当前密码不正确');
      await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[await argon2.hash(next,passwordOptions),row.id]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[row.id]);
    });
    clear(reply);return reply.code(204).send();
  });
  return {session,limit};
}
