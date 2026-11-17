import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {ApiError,digest,objectBody,registerAuth,transaction} from './auth.js';
import {uuid,pageCursor,pageLimit,latest} from './messages.js';

export function textBody(input:unknown):string {
  const parsed=objectBody(input,['body']);
  if(typeof parsed.body!=='string')throw new ApiError(400,'VALIDATION_ERROR','请输入正文');
  const body=parsed.body.replace(/\r\n?/g,'\n').trim();
  if([...body].length<1||[...body].length>500||body.includes('\u0000'))throw new ApiError(400,'VALIDATION_ERROR','正文需为 1～500 个有效字符');
  return body;
}
export const cursorValue=(row:{id:string;cursor_created_at:string})=>Buffer.from(JSON.stringify({createdAt:row.cursor_created_at,id:row.id})).toString('base64url');
type CommentRow={id:string;message_id:string;author_id:string;author_nickname:string;body:string;created_at:Date;deleted_at:Date|null;cursor_created_at:string};
const comment=(row:CommentRow)=>({id:row.id,messageId:row.message_id,author:{id:row.author_id,nickname:row.author_nickname},body:row.body,createdAt:row.created_at.toISOString()});
async function requirePost(client:PoolClient,id:string){if(!(await client.query('SELECT id FROM messages WHERE id=$1 AND deleted_at IS NULL',[id])).rowCount)throw new ApiError(404,'NOT_FOUND','帖子不存在或已删除');}

export function registerComments(app:FastifyInstance,pool:Pool,auth:ReturnType<typeof registerAuth>) {
  app.get('/api/messages/:id/comments',async(request)=>{
    const id=uuid((request.params as {id:string}).id),query=objectBody(request.query,['cursor','limit']),cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,20,100);
    return transaction(pool,async(client)=>{
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await requirePost(client,id);
      const rows=(await client.query<CommentRow>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM comments WHERE message_id=$1 AND deleted_at IS NULL ${cursor?'AND (created_at,id)<($2::timestamptz,$3::uuid)':''} ORDER BY created_at DESC,id DESC LIMIT ${cursor?'$4':'$2'}`,cursor?[id,cursor.createdAt,cursor.id,limit+1]:[id,limit+1])).rows;
      const batch=rows.slice(0,limit),hasMore=rows.length>limit;
      return {data:batch.map(comment),page:{nextCursor:hasMore?cursorValue(batch.at(-1)!):null,hasMore},sync:{eventCursor:await latest(client)}};
    });
  });
  app.post('/api/messages/:id/comments',async(request,reply)=>{
    const id=uuid((request.params as {id:string}).id),body=textBody(request.body),key=uuid(request.headers['idempotency-key']),hash=digest(JSON.stringify([id,body]));
    const result=await transaction(pool,async(client)=>{
      const user=(await auth.session(client,request,true))!;await client.query('SELECT pg_advisory_xact_lock(817462033)');await requirePost(client,id);
      const prior=(await client.query<CommentRow & {request_hash:string}>('SELECT c.*,k.request_hash FROM comment_idempotency_keys k JOIN comments c ON c.id=k.comment_id WHERE k.user_id=$1 AND k.key=$2',[user.id,key])).rows[0];
      if(prior){if(prior.request_hash!==hash||prior.deleted_at)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','请求标识已使用');return {comment:comment(prior),replayed:true};}
      auth.limit('comment-user:'+user.id,20,60_000,reply);auth.limit('comment-ip:'+request.ip,60,60_000,reply);
      const row=(await client.query<CommentRow>('INSERT INTO comments(id,message_id,author_id,author_nickname,body) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),id,user.id,user.nickname,body])).rows[0]!;
      await client.query('INSERT INTO comment_idempotency_keys(user_id,key,request_hash,comment_id) VALUES($1,$2,$3,$4)',[user.id,key,hash,row.id]);
      const value=comment(row);await client.query("INSERT INTO message_events(event_type,message_id,payload) VALUES('comment.created',$1,$2::jsonb)",[id,JSON.stringify({comment:value})]);
      return {comment:value,replayed:false};
    });
    if(result.replayed)reply.header('Idempotency-Replayed','true');return reply.code(result.replayed?200:201).send({data:{comment:result.comment}});
  });
  app.delete('/api/comments/:id',async(request,reply)=>{
    const id=uuid((request.params as {id:string}).id);if(request.body!==undefined)objectBody(request.body,[]);
    await transaction(pool,async(client)=>{
      const user=(await auth.session(client,request,true))!;await client.query('SELECT pg_advisory_xact_lock(817462033)');
      const row=(await client.query<CommentRow>('SELECT * FROM comments WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!row)throw new ApiError(404,'NOT_FOUND','评论不存在');
      if(row.author_id!==user.id)throw new ApiError(403,'FORBIDDEN','只能删除自己的评论');
      await requirePost(client,row.message_id);if(row.deleted_at)return;
      const removed=(await client.query<{deleted_at:Date}>('UPDATE comments SET deleted_at=now() WHERE id=$1 RETURNING deleted_at',[id])).rows[0]!;
      await client.query("INSERT INTO message_events(event_type,message_id,payload) VALUES('comment.deleted',$1,$2::jsonb)",[row.message_id,JSON.stringify({commentId:id,messageId:row.message_id,deletedAt:removed.deleted_at.toISOString()})]);
    });return reply.code(204).send();
  });
}
