import EmbeddedPostgres from 'embedded-postgres';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const local=join(root,'.local');
await mkdir(local,{recursive:true});
const credentialFile=join(local,'database.json');
let credentials;
try{credentials=JSON.parse(await readFile(credentialFile,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;credentials={admin:randomBytes(32).toString('hex'),app:randomBytes(32).toString('hex')};await writeFile(credentialFile,JSON.stringify(credentials),{flag:'wx'});}
const pg=new EmbeddedPostgres({databaseDir:join(local,'pgdata'),user:'local_admin',password:credentials.admin,port:55432,persistent:true,authMethod:'scram-sha-256',initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
let initialized=false;
try{await access(join(local,'pgdata','PG_VERSION'));initialized=true;}catch{}
if(!initialized)await pg.initialise();
await pg.start();
try{
 const client=pg.getPgClient();await client.connect();
 try {
  if(!(await client.query("SELECT 1 FROM pg_roles WHERE rolname='message_board'")).rowCount)await client.query(`CREATE ROLE message_board LOGIN PASSWORD '${credentials.app}'`);
  for(const name of ['message_board_dev','message_board_test'])if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await client.query(`CREATE DATABASE ${name} OWNER message_board`);
 }finally{await client.end();}
 for(const [file,db] of [['.env','message_board_dev'],['.env.test','message_board_test']]){
  const text=`HOST=127.0.0.1\nPORT=3000\nDATABASE_URL=postgresql://message_board:${credentials.app}@127.0.0.1:55432/${db}\nDB_CONNECT_TIMEOUT_MS=2000\nALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:3000\n`;
  try{await writeFile(join(root,file),text,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
 }
 console.log('Local PostgreSQL ready at 127.0.0.1:55432 (dev and test databases). Ctrl+C stops this instance.');
}catch(error){await pg.stop();throw error;}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await pg.stop();process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
setInterval(()=>{},60000);
