import {readConfig} from './config.js';
import {createPool} from './db.js';
import {buildApp} from './app.js';
import {createMailer} from './mail.js';
const config = readConfig();
const pool = createPool(config.databaseUrl, config.dbConnectTimeoutMs);
const mail = createMailer(config.smtp);
const app = buildApp(pool,true,{pool,origins:config.origins,production:config.production,trustProxy:config.trustProxy,mail});
pool.on('error', () => app.log.error('Idle database connection failed'));
if (!mail) app.log.warn('SMTP 未配置：邮箱验证码无法发送，注册功能将返回 503');
app.addHook('onClose', async () => {await pool.end();});
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => {void app.close().catch(() => {process.exitCode=1;});});
try {await app.listen({host:config.host,port:config.port});} catch {app.log.error('Failed to start server');await app.close();process.exitCode=1;}
