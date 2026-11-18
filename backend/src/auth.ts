import {createHash, randomBytes, randomInt, randomUUID, timingSafeEqual} from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify';
import type {Pool, PoolClient} from 'pg';
import type {Mailer} from './mail.js';

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
export function email(input:unknown):string {
  if(typeof input!=='string') throw new ApiError(400,'VALIDATION_ERROR','请输入邮箱地址');
  const value=input.trim().toLowerCase();
  if(value.length<6 || value.length>254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value)) throw new ApiError(400,'VALIDATION_ERROR','邮箱格式不正确');
  return value;
}
type UserRow={id:string;username:string;nickname:string;role:string;status:string;created_at:Date;updated_at:Date;password_hash:string};
const publicUser=(u:UserRow)=>({id:u.id,username:u.username,nickname:u.nickname,role:u.role,status:u.status,createdAt:u.created_at.toISOString(),updatedAt:u.updated_at.toISOString()});
type SessionRow=UserRow & {session_id:string;csrf_token_hash:string;expires_at:Date};
export async function transaction<T>(pool:Pool, run:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try {await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
}
export function registerAuth(app:FastifyInstance,pool:Pool,options:{origins:string[];production:boolean;mail?:Mailer|null}) {
  app.register(cookie);
  const mail=options.mail??null;
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
  app.post('/api/auth/email-code',async(request,reply)=>{
    limit('email-code-ip:'+request.ip,10,3600_000,reply);
    if(!mail)throw new ApiError(503,'MAIL_NOT_CONFIGURED','邮件服务尚未配置，暂时无法注册');
    const body=objectBody(request.body,['email']);
    const target=email(body.email);
    limit('email-code-address:'+target,5,3600_000,reply);
    const taken=await pool.query('SELECT 1 FROM users WHERE lower(email)=$1 LIMIT 1',[target]);
    if(taken.rowCount)throw new ApiError(409,'EMAIL_TAKEN','该邮箱已被注册');
    const code=String(randomInt(0,1_000_000)).padStart(6,'0');
    await pool.query("INSERT INTO email_verifications(id,email,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",[randomUUID(),target,digest(code)]);
    try {await mail.sendVerificationCode(target,code,10);}
    catch(error){request.log.error({err:error},'Verification email delivery failed');throw new ApiError(502,'MAIL_FAILED','验证码邮件发送失败，请稍后重试');}
    return reply.code(204).send();
  });
  app.post('/api/auth/register',async(request,reply)=>{
    limit('register:'+request.ip,5,3600_000,reply);
    const body=objectBody(request.body,['username','password','nickname','email','code']);
    const name=username(body.username), pass=password(body.password), nick=nickname(body.nickname), target=email(body.email);
    const submitted=body.code;
    if(typeof submitted!=='string'||!/^\d{6}$/.test(submitted))throw new ApiError(400,'CODE_INVALID','请输入 6 位邮箱验证码');
    const hash=await argon2.hash(pass,passwordOptions);
    // 先校验验证码。错误次数必须落在事务之外，否则抛错回滚会把 attempts 一起撤掉，
    // 爆破保护就失效了。
    const pending=(await pool.query<{id:string;code_hash:string;attempts:number}>(
      'SELECT id,code_hash,attempts FROM email_verifications WHERE lower(email)=$1 AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1',[target])).rows[0];
    if(!pending)throw new ApiError(400,'CODE_INVALID','验证码已失效，请重新获取');
    if(pending.attempts>=5)throw new ApiError(429,'CODE_INVALID','验证码错误次数过多，请重新获取');
    if(!timingSafeEqual(Buffer.from(digest(submitted),'hex'),Buffer.from(pending.code_hash,'hex'))){
      await pool.query('UPDATE email_verifications SET attempts=attempts+1 WHERE id=$1',[pending.id]);
      throw new ApiError(400,'CODE_INVALID','验证码不正确');
    }
    try {
      const created=await transaction(pool,async(client)=>{
        // 条件更新保证同一个验证码只能兑换一次（并发提交也只有一个能成功）。
        const consumed=await client.query('UPDATE email_verifications SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL RETURNING id',[pending.id]);
        if(!consumed.rowCount)throw new ApiError(400,'CODE_INVALID','验证码已失效，请重新获取');
        return client.query<UserRow>('INSERT INTO users(id,username,nickname,password_hash,email,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING *',[randomUUID(),name,nick,hash,target]);
      });
      return reply.code(201).send({data:{user:publicUser(created.rows[0]!)}});
    } catch(error){
      if((error as {code?:string}).code==='23505'){
        const emailConflict=(error as {constraint?:string}).constraint==='users_email_unique';
        throw new ApiError(409,emailConflict?'EMAIL_TAKEN':'USERNAME_TAKEN',emailConflict?'该邮箱已被注册':'用户名已被使用');
      }
      throw error;
    }
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
