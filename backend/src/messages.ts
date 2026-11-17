import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {ApiError,digest,objectBody,registerAuth,transaction} from './auth.js';
import type {registerPresence} from './presence.js';
import {postTags,parseTag} from './tags.js';

type MessageRow={id:string;author_id:string;author_nickname:string;body:string;tag:string;created_at:Date;deleted_at:Date|null;cursor_created_at?:string};
type EventRow={id:string;event_type:string;payload:unknown;created_at:Date};
const message=(row:MessageRow)=>({id:row.id,author:{id:row.author_id,nickname:row.author_nickname},body:row.body,tag:row.tag,createdAt:row.created_at.toISOString()});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(value:unknown):string {
  if(typeof value!=='string'||!UUID.test(value))throw new ApiError(400,'VALIDATION_ERROR','标识格式不正确');
  return value.toLowerCase();
}
export function pageLimit(value:unknown,fallback:number,max:number):number {
  if(value===undefined)return fallback;
  if(typeof value!=='string'||!/^\d{1,3}$/.test(value)||Number(value)<1||Number(value)>max)throw new ApiError(400,'VALIDATION_ERROR','分页数量不符合要求');
  return Number(value);
}
export function eventCursor(value:unknown):string {
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,18})$/.test(value)||BigInt(value)>9223372036854775807n)throw new ApiError(400,'INVALID_CURSOR','事件游标不正确');
  return value;
}
export function pageCursor(value:unknown):{createdAt:string;id:string}|undefined {
  if(value===undefined)return;
  try {
    if(typeof value!=='string'||value.length>256||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
    const decoded=Buffer.from(value,'base64url');if(decoded.toString('base64url')!==value)throw Error();
    const row=JSON.parse(decoded.toString('utf8'));
    if(!row||Object.keys(row).sort().join(',')!=='createdAt,id'||typeof row.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(row.createdAt)||!UUID.test(row.id))throw Error();
    const parsed=new Date(row.createdAt);if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,19)!==row.createdAt.slice(0,19))throw Error();
    return {createdAt:row.createdAt,id:row.id};
  }catch{throw new ApiError(400,'INVALID_CURSOR','分页游标不正确');}
}
export const latest=async(db:Pool|PoolClient)=>(await db.query<{id:string}>('SELECT COALESCE(MAX(id),0)::text AS id FROM message_events')).rows[0]!.id;
const eventsAfter=async(db:Pool|PoolClient,after:string,limit:number)=>(await db.query<EventRow>('SELECT id::text,event_type,payload,created_at FROM message_events WHERE id>$1::bigint ORDER BY id ASC LIMIT $2',[after,limit])).rows;

export function registerMessages(app:FastifyInstance,pool:Pool,auth:ReturnType<typeof registerAuth>,presence:ReturnType<typeof registerPresence>) {
  app.get('/api/tags',async()=>({data:postTags}));
  app.get('/api/messages',async(request)=>{
    const query=objectBody(request.query,['cursor','limit','tag']);const cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,20,100),tag=query.tag===undefined?undefined:parseTag(query.tag);
    return transaction(pool,async(client)=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const values:unknown[]=[];let where='deleted_at IS NULL';
      if(tag){values.push(tag);where+=` AND tag=$${values.length}`;}
      if(cursor){values.push(cursor.createdAt,cursor.id);where+=` AND (created_at,id)<($${values.length-1}::timestamptz,$${values.length}::uuid)`;}
      values.push(limit+1);
      const result=await client.query<MessageRow>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM messages WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,values);
      const rows=result.rows.slice(0,limit),hasMore=result.rows.length>limit,last=rows.at(-1);
      return {data:rows.map(message),page:{nextCursor:hasMore&&last?Buffer.from(JSON.stringify({createdAt:last.cursor_created_at,id:last.id})).toString('base64url'):null,hasMore},sync:{eventCursor:await latest(client)}};
    });
  });
  app.post('/api/messages',async(request,reply)=>{
    const input=objectBody(request.body,['body','tag']);
    const tag=input.tag===undefined?'daily':parseTag(input.tag);
    if(typeof input.body!=='string')throw new ApiError(400,'VALIDATION_ERROR','请输入留言正文');
    const body=input.body.replace(/\r\n?/g,'\n').trim();
    if([...body].length<1||[...body].length>500||body.includes('\u0000'))throw new ApiError(400,'VALIDATION_ERROR','留言需为 1～500 个有效字符');
    const key=uuid(request.headers['idempotency-key']);
    const result=await transaction(pool,async(client)=>{
      const user=(await auth.session(client,request,true))!;
      // A single lock orders event IDs and commits across all message mutations.
      await client.query('SELECT pg_advisory_xact_lock(817462033)');
      const prior=(await client.query<MessageRow & {request_hash:string}>('SELECT m.*,k.request_hash FROM idempotency_keys k JOIN messages m ON m.id=k.message_id WHERE k.user_id=$1 AND k.key=$2',[user.id,key])).rows[0];
      if(prior){if(prior.request_hash!==digest(body)||prior.tag!==tag||prior.deleted_at)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','该请求标识已用于其他内容、标签或已删除的留言');return {message:message(prior),replayed:true};}
      auth.limit('message-ip:'+request.ip,30,60_000,reply);auth.limit('message-user:'+user.id,10,60_000,reply);
      const row=(await client.query<MessageRow>('INSERT INTO messages(id,author_id,author_nickname,body,tag) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),user.id,user.nickname,body,tag])).rows[0]!;
      await client.query('INSERT INTO idempotency_keys(user_id,key,request_hash,message_id) VALUES($1,$2,$3,$4)',[user.id,key,digest(body),row.id]);
      const value=message(row);
      await client.query("INSERT INTO message_events(event_type,message_id,payload) VALUES('message.created',$1,$2::jsonb)",[row.id,JSON.stringify({message:value})]);
      return {message:value,replayed:false};
    });
    if(result.replayed)reply.header('Idempotency-Replayed','true');
    return reply.code(result.replayed?200:201).send({data:{message:result.message}});
  });
  app.delete('/api/messages/:id',async(request,reply)=>{
    const id=uuid((request.params as {id:string}).id);
    if(request.body!==undefined)objectBody(request.body,[]);
    await transaction(pool,async(client)=>{
      const user=(await auth.session(client,request,true))!;
      await client.query('SELECT pg_advisory_xact_lock(817462033)');
      const row=(await client.query<MessageRow>('SELECT * FROM messages WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row)throw new ApiError(404,'NOT_FOUND','留言不存在');
      if(row.author_id!==user.id)throw new ApiError(403,'FORBIDDEN','只能删除自己的留言');
      if(row.deleted_at)return;
      const removed=(await client.query<{deleted_at:Date}>('UPDATE messages SET deleted_at=now(),deleted_by=$2 WHERE id=$1 RETURNING deleted_at',[id,user.id])).rows[0]!;
      await client.query("INSERT INTO message_events(event_type,message_id,payload) VALUES('message.deleted',$1,$2::jsonb)",[id,JSON.stringify({messageId:id,deletedAt:removed.deleted_at.toISOString()})]);
    });
    return reply.code(204).send();
  });
  app.get('/api/messages/events',async(request)=>{
    const query=objectBody(request.query,['after','limit']);const after=eventCursor(query.after),limit=pageLimit(query.limit,100,500);
    return transaction(pool,async(client)=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if(BigInt(after)>BigInt(await latest(client)))throw new ApiError(410,'EVENT_CURSOR_EXPIRED','事件游标超出当前范围，请重新加载留言');
      const rows=await eventsAfter(client,after,limit+1),batch=rows.slice(0,limit);
      return {data:batch.map(row=>({id:row.id,type:row.event_type,data:row.payload,createdAt:row.created_at.toISOString()})),page:{nextCursor:batch.at(-1)?.id??after,hasMore:rows.length>limit}};
    });
  });

  const streams=new Set<()=>void>();
  app.addHook('preClose',async()=>{for(const close of streams)close();});
  app.get('/api/events',async(request,reply)=>{
    const query=objectBody(request.query,['after']);let after=eventCursor(request.headers['last-event-id']??query.after);
    const invalid=BigInt(after)>BigInt(await latest(pool));
    if(streams.size>=200)throw new ApiError(503,'NOT_READY','实时连接已满，请稍后重试');
    const leave=invalid?()=>{}:presence.connect(request,reply);
    reply.hijack();
    const presenceCookie=reply.getHeader('Set-Cookie');
    if(typeof presenceCookie==='string'||Array.isArray(presenceCookie))reply.raw.setHeader('Set-Cookie',presenceCookie);
    reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    if(invalid){reply.raw.end('event: sync.reset\ndata: {"reason":"invalid_cursor"}\n\n');return;}
    reply.raw.write('retry: 3000\n\n');
    let stopped=false,busy=false;
    let polling:ReturnType<typeof setTimeout>|undefined;
    const close=()=>{if(stopped)return;stopped=true;clearTimeout(polling);clearInterval(heartbeat);streams.delete(close);leave();reply.raw.end();};
    const write=(data:string)=>{if(stopped)return false;if(!reply.raw.write(data)){close();reply.raw.destroy();return false;}return true;};
    const heartbeat=setInterval(()=>write(': heartbeat\n\n'),15000);heartbeat.unref();
    reply.raw.once('close',close);reply.raw.once('error',close);streams.add(close);
    if(request.raw.aborted||reply.raw.destroyed){close();return;}
    const poll=async()=>{
      if(stopped||busy)return;busy=true;let delay=500;
      try{
        const batch=await eventsAfter(pool,after,100);
        for(const row of batch){if(!write(`id: ${row.id}\nevent: ${row.event_type}\ndata: ${JSON.stringify(row.payload)}\n\n`))break;after=row.id;}
        if(batch.length===100)delay=0;
      }catch{close();}finally{busy=false;if(!stopped){polling=setTimeout(()=>void poll(),delay);polling.unref();}}
    };
    void poll();
  });
}
