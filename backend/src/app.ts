import Fastify, {type FastifyError} from 'fastify';
import type {Pool} from 'pg';
import {ApiError,registerAuth} from './auth.js';
import type {Mailer} from './mail.js';
import {registerMessages} from './messages.js';
import {registerComments} from './comments.js';
import {registerDirectMessages} from './direct-messages.js';
import {registerPresence} from './presence.js';
import {registerAdmin} from './admin.js';
import {registerNotifications} from './notifications.js';
export interface Database { query(sql: string): Promise<unknown> }
export function buildApp(db: Database, logger = false, auth?:{pool:Pool;origins:string[];production:boolean;trustProxy?:boolean;mail?:Mailer|null}) {
  const app = Fastify({logger, bodyLimit:16384, requestIdHeader:false, trustProxy:auth?.trustProxy ?? false});
  if(auth){const access=registerAuth(app,auth.pool,auth);const presence=registerPresence(app,access,auth.production);registerMessages(app,auth.pool,access,presence);registerComments(app,auth.pool,access);registerDirectMessages(app,auth.pool,access);registerAdmin(app,auth.pool,access);registerNotifications(app,auth.pool,access);}
  app.addHook('onRequest', async (_request, reply) => {reply.header('Cache-Control','no-store');});
  app.get('/api/health', async () => ({data:{status:'ok'}}));
  app.get('/api/ready', async (_request, reply) => {
    try {
      await db.query('SELECT 1');
      // Ensure the service is not marked ready before required schema exists.
      await db.query('SELECT id FROM users LIMIT 0');
      await db.query('SELECT id FROM sessions LIMIT 0');
      await db.query('SELECT id,tag FROM messages LIMIT 0');
      await db.query('SELECT id FROM message_events LIMIT 0');
      await db.query('SELECT id FROM admin_audit_logs LIMIT 0');
      if(auth){await db.query('SELECT id FROM admin_applications LIMIT 0');await db.query('SELECT id FROM notifications LIMIT 0');await db.query('SELECT id FROM comments LIMIT 0');await db.query('SELECT id FROM dm_conversations LIMIT 0');await db.query('SELECT id FROM dm_messages LIMIT 0');await db.query('SELECT id FROM dm_events LIMIT 0');await db.query('SELECT id FROM email_verifications LIMIT 0');}
      return {data:{status:'ready',database:'up',schema:'ready'}};
    } catch {
      return reply.code(503).send({error:{code:'NOT_READY',message:'数据库不可用或迁移未完成',requestId:_request.id}});
    }
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({error:{code:'NOT_FOUND',message:'接口不存在或尚未实现',requestId:request.id}}));
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    request.log.error({code:error.code,requestId:request.id}, 'Request failed');
    reply.code(status).send({error:{code:error instanceof ApiError?error.code:status===413?'PAYLOAD_TOO_LARGE':status===500?'INTERNAL_ERROR':'VALIDATION_ERROR',message:error instanceof ApiError?error.message:status===500?'服务暂时不可用':'请求格式不正确',requestId:request.id}});
  });
  return app;
}
