import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readConfig} from './config.js';
import {createPool} from './db.js';
const config=readConfig();
const pool=createPool(config.databaseUrl,config.dbConnectTimeoutMs);
try {
 const client=await pool.connect();
 try {
  await client.query('SELECT pg_advisory_lock(817462031)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir=fileURLToPath(new URL('../migrations/',import.meta.url));
  for (const name of (await readdir(dir)).filter(x=>/^\d+.*\.sql$/.test(x)).sort()) {
   const sql=await readFile(dir+'/'+name,'utf8');
   const checksum=createHash('sha256').update(sql).digest('hex');
   const previous=await client.query<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
   if (previous.rows[0]) {if(previous.rows[0].checksum!==checksum) throw new Error('Migration changed: '+name);continue;}
   await client.query('BEGIN');
   try {await client.query(sql);await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);await client.query('COMMIT');console.log('Applied '+name);} catch(error) {await client.query('ROLLBACK');throw error;}
  }
 } finally {await client.query('SELECT pg_advisory_unlock(817462031)').catch(()=>{});client.release();}
} catch(error) {console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');process.exitCode=1;} finally {await pool.end();}
