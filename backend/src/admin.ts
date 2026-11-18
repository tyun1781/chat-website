import {randomUUID} from 'node:crypto';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {Pool, PoolClient} from 'pg';
import {ApiError, objectBody, registerAuth, transaction} from './auth.js';
import {pageCursor, pageLimit, uuid} from './messages.js';
import {notifyMessageDeleted} from './notifications.js';

type UserRow = {
 id:string; username:string; nickname:string; role:'user'|'admin'; status:'active'|'disabled';
 created_at:Date; updated_at:Date; cursor_created_at?:string;
};
type MessageRow = {id:string; author_id:string; body:string; deleted_at:Date|null};
type ApplicationRow = {
 id:string; user_id:string; statement:string; status:'pending'|'approved'|'rejected';
 reviewed_by:string|null; reviewed_at:Date|null; review_reason:string|null;
 created_at:Date; updated_at:Date; username:string; nickname:string;
 user_role:'user'|'admin'; user_status:'active'|'disabled'; reviewer_nickname:string|null;
 cursor_created_at?:string;
};

const userValue = (row:UserRow) => ({
 id:row.id, username:row.username, nickname:row.nickname, role:row.role, status:row.status,
 createdAt:new Date(row.created_at).toISOString(), updatedAt:new Date(row.updated_at).toISOString()
});
const applicationValue = (row:ApplicationRow) => ({
 id:row.id,
 user:{id:row.user_id,username:row.username,nickname:row.nickname,role:row.user_role,status:row.user_status},
 statement:row.statement,
 status:row.status,
 reviewedBy:row.reviewed_by?{id:row.reviewed_by,nickname:row.reviewer_nickname}:null,
 reviewedAt:row.reviewed_at?new Date(row.reviewed_at).toISOString():null,
 reviewReason:row.review_reason,
 createdAt:new Date(row.created_at).toISOString(),
 updatedAt:new Date(row.updated_at).toISOString()
});
const pageValue = (row:{id:string;cursor_created_at?:string}) => Buffer.from(JSON.stringify({createdAt:row.cursor_created_at!,id:row.id})).toString('base64url');
const applicationSelect = `SELECT a.*,u.username,u.nickname,u.role AS user_role,u.status AS user_status,
 r.nickname AS reviewer_nickname,
 to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
 FROM admin_applications a
 JOIN users u ON u.id=a.user_id
 LEFT JOIN users r ON r.id=a.reviewed_by`;

function boundedText(input:unknown,label:string,required=true):string|null {
 if(input===undefined||input===null) {
  if(required)throw new ApiError(400,'VALIDATION_ERROR',`请填写${label}`);
  return null;
 }
 if(typeof input!=='string')throw new ApiError(400,'VALIDATION_ERROR',`${label}格式不正确`);
 const value=input.replace(/\r\n?/g,'\n').trim();
 if([...value].length<1||[...value].length>500||value.includes('\u0000'))throw new ApiError(400,'VALIDATION_ERROR',`${label}需为 1～500 个字符`);
 return value;
}

function audit(client:PoolClient,actorId:string,action:string,targetType:'user'|'message',targetId:string,reason:string|null) {
 return client.query('INSERT INTO admin_audit_logs(id,actor_id,action,target_type,target_id,reason) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actorId,action,targetType,targetId,reason]);
}

export function registerAdmin(app:FastifyInstance,pool:Pool,auth:ReturnType<typeof registerAuth>) {
 async function current(client:PoolClient,request:FastifyRequest,csrf=false) {
  const user=(await auth.session(client,request,csrf))!;
  if(user.role!=='admin')throw new ApiError(403,'FORBIDDEN','需要管理员权限');
  return user;
 }

 app.get('/api/admin-applications/me',async(request)=>transaction(pool,async(client)=>{
  const user=(await auth.session(client,request))!;
  const row=(await client.query<ApplicationRow>(`${applicationSelect} WHERE a.user_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[user.id])).rows[0];
  return {data:{application:row?applicationValue(row):null}};
 }));

 app.post('/api/admin-applications',async(request,reply)=>{
  const body=objectBody(request.body,['statement']);
  const statement=boundedText(body.statement,'申请理由')!;
  const result=await transaction(pool,async(client)=>{
   const user=(await auth.session(client,request,true))!;
   await client.query('SELECT pg_advisory_xact_lock(817462035)');
   if(user.role==='admin')throw new ApiError(409,'ALREADY_ADMIN','你已经是管理员，无需再次申请');
   if((await client.query("SELECT 1 FROM admin_applications WHERE user_id=$1 AND status='pending'",[user.id])).rowCount)throw new ApiError(409,'APPLICATION_PENDING','你已有一条待审批的申请');
   auth.limit('admin-application:'+user.id,3,86400_000,reply);
   const id=randomUUID();
   await client.query("INSERT INTO admin_applications(id,user_id,statement) VALUES($1,$2,$3)",[id,user.id,statement]);
   const row=(await client.query<ApplicationRow>(`${applicationSelect} WHERE a.id=$1`,[id])).rows[0]!;
   return applicationValue(row);
  });
  return reply.code(201).send({data:{application:result}});
 });

 app.get('/api/admin/applications',async(request)=>transaction(pool,async(client)=>{
  const query=objectBody(request.query,['status','cursor','limit']);
  const cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,20,100);
  let status:unknown=query.status;
  if(status!==undefined&&(typeof status!=='string'||!['pending','approved','rejected'].includes(status)))throw new ApiError(400,'VALIDATION_ERROR','申请状态不正确');
  await current(client,request);
  const values:unknown[]=[];let where='1=1';
  if(status!==undefined){values.push(status);where+=` AND a.status=$${values.length}`;}
  if(cursor){values.push(cursor.createdAt,cursor.id);where+=` AND (a.created_at,a.id)<($${values.length-1}::timestamptz,$${values.length}::uuid)`;}
  values.push(limit+1);
  const rows=(await client.query<ApplicationRow>(`${applicationSelect} WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT $${values.length}`,values)).rows;
  const batch=rows.slice(0,limit),hasMore=rows.length>limit;
  return {data:batch.map(applicationValue),page:{nextCursor:hasMore?pageValue(batch.at(-1)!):null,hasMore}};
 }));

 app.patch('/api/admin/applications/:id',async(request)=>transaction(pool,async(client)=>{
  const id=uuid((request.params as {id:string}).id);
  const body=objectBody(request.body,['decision','reason']);
  if(body.decision!=='approve'&&body.decision!=='reject')throw new ApiError(400,'VALIDATION_ERROR','审批决定不正确');
  const decision=body.decision;
  const reason=boundedText(body.reason,decision==='reject'?'拒绝理由':'备注',decision==='reject');
  const actor=await current(client,request,true);
  await client.query('SELECT pg_advisory_xact_lock(817462035)');
  const application=(await client.query<ApplicationRow>('SELECT * FROM admin_applications WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!application)throw new ApiError(404,'NOT_FOUND','申请不存在');
  if(application.user_id===actor.id)throw new ApiError(403,'FORBIDDEN','不能审批自己的申请');
  if(application.status!=='pending')throw new ApiError(409,'APPLICATION_ALREADY_REVIEWED','该申请已处理');
  const applicant=(await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE',[application.user_id])).rows[0];
  if(!applicant)throw new ApiError(404,'NOT_FOUND','申请用户不存在');
  if(decision==='approve') {
   if(applicant.status!=='active')throw new ApiError(409,'APPLICANT_UNAVAILABLE','该用户当前不可用，无法通过申请');
   if(applicant.role==='admin')throw new ApiError(409,'ALREADY_ADMIN','该用户已经是管理员');
   await client.query("UPDATE users SET role='admin',updated_at=now() WHERE id=$1",[applicant.id]);
  }
  await client.query('UPDATE admin_applications SET status=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4,updated_at=now() WHERE id=$1',[id,decision==='approve'?'approved':'rejected',actor.id,reason]);
  await audit(client,actor.id,decision==='approve'?'admin_application.approved':'admin_application.rejected','user',applicant.id,reason);
  const row=(await client.query<ApplicationRow>(`${applicationSelect} WHERE a.id=$1`,[id])).rows[0]!;
  return {data:{application:applicationValue(row)}};
 }));

 app.get('/api/admin/users',async(request)=>transaction(pool,async(client)=>{
  const query=objectBody(request.query,['q','status','cursor','limit']);
  const cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,20,100);
  const q=query.q===undefined?undefined:typeof query.q==='string'?query.q.trim():null;
  if(q!==undefined&&(q===null||[...q].length>64||q.includes('\u0000')))throw new ApiError(400,'VALIDATION_ERROR','搜索内容需为 1～64 个字符');
  if(query.status!==undefined&&(query.status!=='active'&&query.status!=='disabled'))throw new ApiError(400,'VALIDATION_ERROR','账号状态不正确');
  await current(client,request);
  const values:unknown[]=[];let where='1=1';
  if(query.status){values.push(query.status);where+=` AND status=$${values.length}`;}
  if(q){values.push(q);where+=` AND (position(lower($${values.length}) in lower(username))>0 OR position(lower($${values.length}) in lower(nickname))>0)`;}
  if(cursor){values.push(cursor.createdAt,cursor.id);where+=` AND (created_at,id)<($${values.length-1}::timestamptz,$${values.length}::uuid)`;}
  values.push(limit+1);
  const rows=(await client.query<UserRow>(`SELECT id,username,nickname,role,status,created_at,updated_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM users WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,values)).rows;
  const batch=rows.slice(0,limit),hasMore=rows.length>limit;
  return {data:batch.map(userValue),page:{nextCursor:hasMore?pageValue(batch.at(-1)!):null,hasMore}};
 }));

 app.patch('/api/admin/users/:id/status',async(request)=>transaction(pool,async(client)=>{
  const id=uuid((request.params as {id:string}).id);
  const body=objectBody(request.body,['status','reason']);
  if(body.status!=='active'&&body.status!=='disabled')throw new ApiError(400,'VALIDATION_ERROR','账号状态不正确');
  const reason=boundedText(body.reason,'操作理由')!;
  const actor=await current(client,request,true);
  await client.query('SELECT pg_advisory_xact_lock(817462035)');
  const target=(await client.query<UserRow>('SELECT * FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!target)throw new ApiError(404,'NOT_FOUND','用户不存在');
  if(target.status===body.status)return {data:{user:userValue(target)}};
  if(body.status==='disabled') {
   if(target.id===actor.id)throw new ApiError(409,'LAST_ADMIN','不能禁用自己的账号');
   if(target.role==='admin') {
    const activeAdmins=(await client.query<{count:string}>("SELECT count(*) AS count FROM users WHERE role='admin' AND status='active'")).rows[0]!.count;
    if(BigInt(activeAdmins)<=1n)throw new ApiError(409,'LAST_ADMIN','不能禁用最后一个管理员');
   }
   await client.query("UPDATE users SET status='disabled',updated_at=now() WHERE id=$1",[id]);
   await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[id]);
  } else {
   await client.query("UPDATE users SET status='active',updated_at=now() WHERE id=$1",[id]);
  }
  await audit(client,actor.id,body.status==='disabled'?'user.disabled':'user.enabled','user',target.id,reason);
  const row=(await client.query<UserRow>('SELECT * FROM users WHERE id=$1',[id])).rows[0]!;
  return {data:{user:userValue(row)}};
 }));

 app.delete('/api/admin/messages/:id',async(request,reply)=>{
  const id=uuid((request.params as {id:string}).id);
  const body=objectBody(request.body,['reason']);
  const reason=boundedText(body.reason,'删除理由')!;
  await transaction(pool,async(client)=>{
   const actor=await current(client,request,true);
   await client.query('SELECT pg_advisory_xact_lock(817462033)');
   const message=(await client.query<MessageRow>('SELECT id,author_id,body,deleted_at FROM messages WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!message)throw new ApiError(404,'NOT_FOUND','帖子不存在');
   if(message.deleted_at)return;
   const removed=(await client.query<{deleted_at:Date}>('UPDATE messages SET deleted_at=now(),deleted_by=$2 WHERE id=$1 RETURNING deleted_at',[id,actor.id])).rows[0]!;
   await client.query("INSERT INTO message_events(event_type,message_id,payload) VALUES('message.deleted',$1,$2::jsonb)",[id,JSON.stringify({messageId:id,deletedAt:removed.deleted_at.toISOString()})]);
   await audit(client,actor.id,'message.deleted','message',id,reason);
   await notifyMessageDeleted(client,message.author_id,id,reason,[...message.body].slice(0,120).join(''));
  });
  return reply.code(204).send();
 });
}
