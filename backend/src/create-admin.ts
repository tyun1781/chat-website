import {randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {readConfig} from './config.js';
import {createPool} from './db.js';
import {username,password,nickname,passwordOptions,transaction} from './auth.js';

// Supply the password via stdin, never a command-line argument or default value.
const name=username(process.argv[2]);const nick=nickname(process.argv[3]??'管理员');
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>2048)throw new Error('Password input too long');}
const pass=password(input.replace(/\r?\n$/,''));
const config=readConfig();const pool=createPool(config.databaseUrl,config.dbConnectTimeoutMs);
try {
 await transaction(pool,async(client)=>{
  await client.query('SELECT pg_advisory_xact_lock(817462032)');
  if((await client.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rowCount)throw new Error('An administrator already exists; bootstrap is disabled');
  await client.query("INSERT INTO users(id,username,nickname,password_hash,role) VALUES($1,$2,$3,$4,'admin')",[randomUUID(),name,nick,await argon2.hash(pass,passwordOptions)]);
 });
 console.log('Initial administrator created.');
}catch(error){console.error(error instanceof Error && error.message==='An administrator already exists; bootstrap is disabled'?error.message:'Administrator creation failed; check inputs and database configuration.');process.exitCode=1;}
finally{await pool.end();}
