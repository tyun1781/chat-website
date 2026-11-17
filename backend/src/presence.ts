import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {ApiError,registerAuth} from './auth.js';

export function registerPresence(app:FastifyInstance,auth:ReturnType<typeof registerAuth>,production:boolean) {
  const signingKey=randomBytes(32);
  const cookieName=production?'__Host-presence':'dev_presence';
  const active=new Map<string,number>();
  const identified=new WeakMap<FastifyRequest,string>();
  const sign=(id:string)=>createHmac('sha256',signingKey).update(id).digest('base64url');
  function identify(request:FastifyRequest,reply:FastifyReply):string {
    const known=identified.get(request);if(known)return known;
    const cookie=request.cookies[cookieName];let id:string|undefined;
    if(cookie&&/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(cookie)) {
      const parts=cookie.split('.');
      if(timingSafeEqual(Buffer.from(sign(parts[0]!)),Buffer.from(parts[1]!)))id=parts[0]!;
    }
    if(!id){
      id=randomBytes(32).toString('base64url');
      // Set the serialized header directly: hijacked SSE bypasses onSend hooks.
      reply.header('Set-Cookie',app.serializeCookie(cookieName,id+'.'+sign(id),{httpOnly:true,secure:production,sameSite:'lax',path:'/'}));
    }
    identified.set(request,id);return id;
  }
  app.addHook('preHandler',async(request,reply)=>{
    const path=request.url.split('?')[0];
    if(request.method==='GET'&&['/api/messages','/api/events','/api/presence'].includes(path!))identify(request,reply);
    if(path==='/api/events')auth.limit('presence-connect:'+request.ip,60,60_000,reply);
  });
  app.get('/api/presence',async(request,reply)=>{
    auth.limit('presence-read:'+request.ip,600,60_000,reply);
    return {data:{onlineCount:active.size}};
  });
  app.addHook('onClose',async()=>{active.clear();});
  return {
    connect(request:FastifyRequest,reply:FastifyReply):()=>void {
      const id=identify(request,reply),count=active.get(id)??0;
      if(count>=8){reply.header('Retry-After','15');throw new ApiError(429,'RATE_LIMITED','此浏览器的实时连接过多');}
      if(!count&&active.size>=200)throw new ApiError(503,'NOT_READY','在线连接已满，请稍后重试');
      active.set(id,count+1);let removed=false;
      return ()=>{if(removed)return;removed=true;const remaining=(active.get(id)??1)-1;if(remaining<=0)active.delete(id);else active.set(id,remaining);};
    }
  };
}
