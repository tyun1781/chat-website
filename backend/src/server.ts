import {readConfig} from './config.js';
import {createPool} from './db.js';
import {buildApp} from './app.js';
const config = readConfig();
const pool = createPool(config.databaseUrl, config.dbConnectTimeoutMs);
const app = buildApp(pool,true,{pool,origins:config.origins,production:config.production});
pool.on('error', () => app.log.error('Idle database connection failed'));
app.addHook('onClose', async () => {await pool.end();});
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => {void app.close().catch(() => {process.exitCode=1;});});
try {await app.listen({host:config.host,port:config.port});} catch {app.log.error('Failed to start server');await app.close();process.exitCode=1;}
