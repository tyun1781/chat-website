import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {ApiError,digest,objectBody,registerAuth,transaction} from './auth.js';
import {uuid,pageCursor,pageLimit,eventCursor} from './messages.js';
import {textBody,cursorValue} from './comments.js';

type DmRow={id:string;conversation_id:string;sender_id:string;sender_nickname:string;body:string;created_at:Date|string;cursor_created_at:string};
type ConversationRow={id:string;user_low:string;user_high:string;created_at:Date;updated_at:Date;other_id:string;other_nickname:string;last_message:DmRow|null;cursor_created_at:string};
type EventRow={id:string;event_type:string;payload:unknown;created_at:Date};
const dm=(row:DmRow)=>({id:row.id,conversationId:row.conversation_id,sender:{id:row.sender_id,nickname:row.sender_nickname},body:row.body,createdAt:new Date(row.created_at).toISOString()});
const conversation=(row:ConversationRow)=>({id:row.id,otherUser:{id:row.other_id,nickname:row.other_nickname},createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),lastMessage:row.last_message?dm(row.last_message):null});
const conversationSelect=`SELECT c.*,u.id AS other_id,u.nickname AS other_nickname,to_jsonb(lm) AS last_message,
 to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
 FROM dm_conversations c JOIN users u ON u.id=CASE WHEN c.user_low=$1 THEN c.user_high ELSE c.user_low END
 LEFT JOIN LATERAL(SELECT * FROM dm_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) lm ON true
 WHERE (c.user_low=$1 OR c.user_high=$1)`;
const privateLatest=async(client:PoolClient,userId:string)=>(await client.query<{id:string}>('SELECT COALESCE(MAX(e.id),0)::text AS id FROM dm_events e JOIN dm_conversations c ON c.id=e.conversation_id WHERE c.user_low=$1 OR c.user_high=$1',[userId])).rows[0]!.id;
const privateEvents=async(client:PoolClient,userId:string,after:string,limit:number)=>(await client.query<EventRow>('SELECT e.id::text,e.event_type,e.payload,e.created_at FROM dm_events e JOIN dm_conversations c ON c.id=e.conversation_id WHERE (c.user_low=$1 OR c.user_high=$1) AND e.id>$2::bigint ORDER BY e.id ASC LIMIT $3',[userId,after,limit])).rows;
async function requireConversation(client:PoolClient,id:string,userId:string){
  const row=(await client.query<{user_low:string;user_high:string}>('SELECT user_low,user_high FROM dm_conversations WHERE id=$1 AND (user_low=$2 OR user_high=$2)',[id,userId])).rows[0];
  if(!row)throw new ApiError(404,'NOT_FOUND','会话不存在');return row;
}

export function registerDirectMessages(app:FastifyInstance,pool:Pool,auth:ReturnType<typeof registerAuth>) {
  app.get('/api/users/search',async(request,reply)=>{
    const query=objectBody(request.query,['q','limit']),limit=pageLimit(query.limit,20,20);
    if(typeof query.q!=='string'||[...query.q.trim()].length<1||[...query.q.trim()].length>32||query.q.includes('\u0000'))throw new ApiError(400,'VALIDATION_ERROR','搜索昵称需为 1～32 个字符');
    const search=query.q.trim();
    return transaction(pool,async(client)=>{
      const user=(await auth.session(client,request))!;auth.limit('search-user:'+user.id,60,60_000,reply);
      return {data:(await client.query<{id:string;nickname:string}>("SELECT id,nickname FROM users WHERE status='active' AND id<>$1 AND position(lower($2) in lower(nickname))>0 ORDER BY nickname,id LIMIT $3",[user.id,search,limit])).rows};
    });
  });
  app.get('/api/dm/conversations',async(request)=>{
    const query=objectBody(request.query,['cursor','limit']),cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,20,100);
    return transaction(pool,async(client)=>{
      const user=(await auth.session(client,request))!;await client.query('SELECT pg_advisory_xact_lock(817462034)');
      const rows=(await client.query<ConversationRow>(`${conversationSelect} ${cursor?'AND (c.created_at,c.id)<($2::timestamptz,$3::uuid)':''} ORDER BY c.created_at DESC,c.id DESC LIMIT ${cursor?'$4':'$2'}`,cursor?[user.id,cursor.createdAt,cursor.id,limit+1]:[user.id,limit+1])).rows;
      const batch=rows.slice(0,limit),hasMore=rows.length>limit;
      return {data:batch.map(conversation),page:{nextCursor:hasMore?cursorValue(batch.at(-1)!):null,hasMore},sync:{eventCursor:await privateLatest(client,user.id)}};
    });
  });
  app.post('/api/dm/conversations',async(request,reply)=>{
    const body=objectBody(request.body,['userId']),target=uuid(body.userId);
    const result=await transaction(pool,async(client)=>{
      const user=(await auth.session(client,request,true))!;
      if(user.id===target)throw new ApiError(400,'VALIDATION_ERROR','不能与自己创建私聊');
      await client.query('SELECT pg_advisory_xact_lock(817462034)');
      const other=(await client.query<{status:string}>('SELECT status FROM users WHERE id=$1',[target])).rows[0];
      if(!other)throw new ApiError(404,'NOT_FOUND','用户不存在');
      if(other.status!=='active')throw new ApiError(403,'RECIPIENT_UNAVAILABLE','对方账号暂不可接收私信');
      const [low,high]=[user.id,target].sort();
      let id=(await client.query<{id:string}>('SELECT id FROM dm_conversations WHERE user_low=$1 AND user_high=$2',[low,high])).rows[0]?.id;
      const created=!id;
      if(!id){
        auth.limit('conversation-user:'+user.id,20,60_000,reply);id=randomUUID();
        await client.query('INSERT INTO dm_conversations(id,user_low,user_high) VALUES($1,$2,$3)',[id,low,high]);
        await client.query("INSERT INTO dm_events(conversation_id,event_type,payload) VALUES($1,'conversation.created',$2::jsonb)",[id,JSON.stringify({conversationId:id})]);
      }
      const row=(await client.query<ConversationRow>(`${conversationSelect} AND c.id=$2`,[user.id,id])).rows[0]!;
      return {conversation:conversation(row),created};
    });
    return reply.code(result.created?201:200).send({data:{conversation:result.conversation}});
  });
  app.get('/api/dm/conversations/:id/messages',async(request)=>{
    const id=uuid((request.params as {id:string}).id),query=objectBody(request.query,['cursor','limit']),cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,30,100);
    return transaction(pool,async(client)=>{
      const user=(await auth.session(client,request))!;await client.query('SELECT pg_advisory_xact_lock(817462034)');await requireConversation(client,id,user.id);
      const rows=(await client.query<DmRow>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM dm_messages WHERE conversation_id=$1 ${cursor?'AND (created_at,id)<($2::timestamptz,$3::uuid)':''} ORDER BY created_at DESC,id DESC LIMIT ${cursor?'$4':'$2'}`,cursor?[id,cursor.createdAt,cursor.id,limit+1]:[id,limit+1])).rows;
      const batch=rows.slice(0,limit),hasMore=rows.length>limit;
      return {data:batch.map(dm),page:{nextCursor:hasMore?cursorValue(batch.at(-1)!):null,hasMore},sync:{eventCursor:await privateLatest(client,user.id)}};
    });
  });
  app.post('/api/dm/conversations/:id/messages',async(request,reply)=>{
    const id=uuid((request.params as {id:string}).id),body=textBody(request.body),key=uuid(request.headers['idempotency-key']),hash=digest(JSON.stringify([id,body]));
    const result=await transaction(pool,async(client)=>{
      const user=(await auth.session(client,request,true))!;await client.query('SELECT pg_advisory_xact_lock(817462034)');const pair=await requireConversation(client,id,user.id);
      const prior=(await client.query<DmRow & {request_hash:string}>('SELECT m.*,k.request_hash FROM dm_idempotency_keys k JOIN dm_messages m ON m.id=k.message_id WHERE k.user_id=$1 AND k.key=$2',[user.id,key])).rows[0];
      if(prior){if(prior.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','请求标识已用于其他私信');return {message:dm(prior),replayed:true};}
      const peer=pair.user_low===user.id?pair.user_high:pair.user_low;
      if((await client.query<{status:string}>('SELECT status FROM users WHERE id=$1',[peer])).rows[0]?.status!=='active')throw new ApiError(403,'RECIPIENT_UNAVAILABLE','对方账号暂不可接收私信');
      auth.limit('dm-user:'+user.id,30,60_000,reply);auth.limit('dm-ip:'+request.ip,90,60_000,reply);
      const row=(await client.query<DmRow>('INSERT INTO dm_messages(id,conversation_id,sender_id,sender_nickname,body) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),id,user.id,user.nickname,body])).rows[0]!;
      await client.query('INSERT INTO dm_idempotency_keys(user_id,key,request_hash,message_id) VALUES($1,$2,$3,$4)',[user.id,key,hash,row.id]);
      await client.query('UPDATE dm_conversations SET updated_at=clock_timestamp() WHERE id=$1',[id]);
      const value=dm(row);await client.query("INSERT INTO dm_events(conversation_id,event_type,payload) VALUES($1,'dm.message.created',$2::jsonb)",[id,JSON.stringify({conversationId:id,message:value})]);
      return {message:value,replayed:false};
    });
    if(result.replayed)reply.header('Idempotency-Replayed','true');return reply.code(result.replayed?200:201).send({data:{message:result.message}});
  });
  app.get('/api/dm/events',async(request)=>{
    const query=objectBody(request.query,['after','limit']),after=eventCursor(query.after),limit=pageLimit(query.limit,100,500);
    return transaction(pool,async(client)=>{
      const user=(await auth.session(client,request))!;await client.query('SELECT pg_advisory_xact_lock(817462034)');
      if(BigInt(after)>BigInt(await privateLatest(client,user.id)))throw new ApiError(410,'EVENT_CURSOR_EXPIRED','私聊游标超出范围，请重新加载会话');
      const rows=await privateEvents(client,user.id,after,limit+1),batch=rows.slice(0,limit);
      return {data:batch.map(row=>({id:row.id,type:row.event_type,data:row.payload,createdAt:row.created_at.toISOString()})),page:{nextCursor:batch.at(-1)?.id??after,hasMore:rows.length>limit}};
    });
  });

  const streams=new Set<()=>void>();app.addHook('preClose',async()=>{for(const close of streams)close();});
  app.get('/api/dm/stream',async(request,reply)=>{
    const query=objectBody(request.query,['after']);let after=eventCursor(request.headers['last-event-id']??query.after);
    const initial=await transaction(pool,async(client)=>{const user=(await auth.session(client,request))!;return {invalid:BigInt(after)>BigInt(await privateLatest(client,user.id))};});
    if(streams.size>=200)throw new ApiError(503,'NOT_READY','实时连接已满，请稍后重试');
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    if(initial.invalid){reply.raw.end('event: sync.reset\ndata: {"reason":"invalid_cursor"}\n\n');return;}
    reply.raw.write('retry: 3000\n\n');
    let stopped=false,busy=false,lastHeartbeat=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
    const close=()=>{if(stopped)return;stopped=true;clearTimeout(timer);streams.delete(close);reply.raw.end();};
    const write=(data:string)=>{if(stopped)return false;if(!reply.raw.write(data)){close();reply.raw.destroy();return false;}return true;};
    streams.add(close);reply.raw.once('close',close);reply.raw.once('error',close);
    const poll=async()=>{
      if(stopped||busy)return;busy=true;let delay=500;
      try {
        // Keep the authenticated user/session lock until content has been queued.
        // Logout or disable cannot commit between the authorization check and send.
        await transaction(pool,async(client)=>{
          const user=(await auth.session(client,request))!;
          const batch=await privateEvents(client,user.id,after,100);
          for(const row of batch){if(!write(`id: ${row.id}\nevent: ${row.event_type}\ndata: ${JSON.stringify(row.payload)}\n\n`))break;after=row.id;}
          if(batch.length===100)delay=0;
          if(Date.now()-lastHeartbeat>=15000){write(': heartbeat\n\n');lastHeartbeat=Date.now();}
        });
      }catch(error){if(error instanceof ApiError&&(error.statusCode===401||error.statusCode===403))write('event: auth.expired\ndata: {}\n\n');close();}
      finally{busy=false;if(!stopped){timer=setTimeout(()=>void poll(),delay);timer.unref();}}
    };
    void poll();
  });
}
