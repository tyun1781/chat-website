import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Pool,PoolClient} from 'pg';
import {ApiError,objectBody,registerAuth,transaction} from './auth.js';
import {pageCursor,pageLimit,uuid} from './messages.js';

type NotificationRow = {
 id:string; user_id:string; type:string; title:string; body:string;
 data:Record<string,unknown>; read_at:Date|null; created_at:Date; cursor_created_at?:string;
};
const notificationValue = (row:NotificationRow) => ({
 id:row.id, type:row.type, title:row.title, body:row.body, data:row.data,
 readAt:row.read_at?new Date(row.read_at).toISOString():null,
 createdAt:new Date(row.created_at).toISOString()
});
const pageValue = (row:NotificationRow) => Buffer.from(JSON.stringify({createdAt:row.cursor_created_at!,id:row.id})).toString('base64url');

export function notifyMessageDeleted(client:PoolClient,userId:string,messageId:string,reason:string,excerpt:string) {
 return client.query(
  "INSERT INTO notifications(id,user_id,type,title,body,data) VALUES($1,$2,'message.deleted','你的帖子被管理员删除',$3,$4::jsonb)",
  [randomUUID(),userId,reason,JSON.stringify({messageId,reason,excerpt})]
 );
}

export function registerNotifications(app:FastifyInstance,pool:Pool,auth:ReturnType<typeof registerAuth>) {
 app.get('/api/notifications',async(request)=>transaction(pool,async(client)=>{
  const query=objectBody(request.query,['cursor','limit']);
  const cursor=pageCursor(query.cursor),limit=pageLimit(query.limit,20,100);
  const user=(await auth.session(client,request))!;
  const values:unknown[]=[user.id];let where='user_id=$1';
  if(cursor){values.push(cursor.createdAt,cursor.id);where+=` AND (created_at,id)<($${values.length-1}::timestamptz,$${values.length}::uuid)`;}
  values.push(limit+1);
  const rows=(await client.query<NotificationRow>(`SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at FROM notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT $${values.length}`,values)).rows;
  const batch=rows.slice(0,limit),hasMore=rows.length>limit;
  const unread=(await client.query<{count:number}>('SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL',[user.id])).rows[0]!.count;
  return {data:batch.map(notificationValue),page:{nextCursor:hasMore?pageValue(batch.at(-1)!):null,hasMore},unreadCount:unread};
 }));

 app.patch('/api/notifications/:id/read',async(request,reply)=>{
  const id=uuid((request.params as {id:string}).id);
  await transaction(pool,async(client)=>{
   const user=(await auth.session(client,request,true))!;
   const updated=await client.query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 AND read_at IS NULL RETURNING id',[id,user.id]);
   if(updated.rowCount)return;
   if(!(await client.query('SELECT 1 FROM notifications WHERE id=$1 AND user_id=$2',[id,user.id])).rowCount)throw new ApiError(404,'NOT_FOUND','通知不存在');
  });
  return reply.code(204).send();
 });

 app.post('/api/notifications/read-all',async(request)=>transaction(pool,async(client)=>{
  const user=(await auth.session(client,request,true))!;
  const updated=await client.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL',[user.id]);
  return {data:{updated:updated.rowCount??0}};
 }));
}
