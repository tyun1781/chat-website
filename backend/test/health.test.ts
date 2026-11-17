import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
test('liveness does not depend on database; readiness fails safely',async()=>{
 const app=buildApp({query:async()=>{throw new Error('secret-connection-string');}});
 try {
  assert.equal((await app.inject('/api/health')).statusCode,200);
  const res=await app.inject('/api/ready');assert.equal(res.statusCode,503);assert.equal(res.json().error.code,'NOT_READY');assert.ok(!res.body.includes('secret'));
  assert.equal((await app.inject('/api/messages')).statusCode,404);
 }finally{await app.close();}
});
test('readiness validates connectivity and schema',async()=>{
 const queries:string[]=[];const app=buildApp({query:async(sql)=>{queries.push(sql);}});
 try{assert.equal((await app.inject('/api/ready')).statusCode,200);assert.equal(queries.length,6);}finally{await app.close();}
});
test('invalid configuration fails before startup',()=>{
 assert.throws(()=>readConfig({}),/DATABASE_URL/);
 assert.throws(()=>readConfig({DATABASE_URL:'http://localhost',PORT:'3000'}),/PostgreSQL/);
 assert.throws(()=>readConfig({DATABASE_URL:'postgresql://localhost/db',PORT:'NaN'}),/PORT/);
});
