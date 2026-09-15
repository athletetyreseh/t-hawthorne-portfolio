import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schema, login, config, authenticated } from '../functions/_shared/scheduler-pin.js';
import { onRequest as settings } from '../functions/tools/th-operations-scheduler/api/pin-access.js';
import { onRequest as gateway } from '../functions/scheduler-agent/[[path]].js';
function database() {
 const sql=new DatabaseSync(':memory:');
 return {sql,prepare(query){let args=[];const stmt={bind(...values){args=values;return stmt},async first(){return sql.prepare(query).get(...args)||null},async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}};return stmt},async batch(stmts){sql.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.run());sql.exec('COMMIT');return results}catch(e){sql.exec('ROLLBACK');throw e}}};
}
function context(db,path='/scheduler-agent/login',body,headers={}){
 return {request:new Request('https://example.com'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://example.com','CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env:{SCHEDULER_DB:db,OWNER_EMAIL:'owner@example.com'},data:{privateUser:{email:'owner@example.com'}}};
}
async function setup(){const db=database();await schema(db);await settings(context(db,'/tools/th-operations-scheduler/api/pin-access',{action:'set',pin:'123456'}));return db}
async function signIn(db,pin='123456',headers={}){return login(context(db,'/scheduler-agent/login',{pin},headers),await config(db))}
test('fifth incorrect attempt locks IP, including correct PIN and cleared browser cookies',async()=>{
 const db=await setup();for(let i=0;i<4;i++)assert.equal((await signIn(db,'000000')).status,401);
 assert.equal((await signIn(db,'000000')).status,423);assert.equal((await signIn(db)).status,423);
 assert.equal((await signIn(db,'123456',{'CF-Connecting-IP':'192.0.2.2'})).status,200);
});
test('concurrent incorrect attempts cannot lose increments or bypass lockout',async()=>{
 const db=await setup();await Promise.all(Array.from({length:12},()=>signIn(db,'999999')));
 assert.equal(db.sql.prepare('SELECT failures FROM scheduler_pin_attempts').get().failures,5);
 assert.equal((await signIn(db)).status,423);
});
test('session authenticates only its network and expires; rotation revokes it',async()=>{
 const db=await setup(),r=await signIn(db);const cookie=r.headers.get('Set-Cookie');
 assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.match(cookie,/Max-Age=14400/);
 const ctx=context(db,'/scheduler-agent/',undefined,{Cookie:cookie});
 assert.equal(await authenticated(ctx,await config(db)),true);
 assert.equal(await authenticated(context(db,'/scheduler-agent/',undefined,{Cookie:cookie,'CF-Connecting-IP':'192.0.2.2'}),await config(db)),false);
 db.sql.exec('UPDATE scheduler_pin_sessions SET expires=0');assert.equal(await authenticated(ctx,await config(db)),false);
 const r2=await signIn(db);await settings(context(db,'/tools/th-operations-scheduler/api/pin-access',{action:'set',pin:'654321'}));
 assert.equal(await authenticated(context(db,'/scheduler-agent/',undefined,{Cookie:r2.headers.get('Set-Cookie')}),await config(db)),false);
});
test('owner can clear lockouts; other operators cannot configure PIN',async()=>{
 const db=await setup();for(let i=0;i<5;i++)await signIn(db,'000000');
 const nonOwner=context(db,'/tools/th-operations-scheduler/api/pin-access',{action:'reset'});nonOwner.data.privateUser.email='other@example.com';
 assert.equal((await settings(nonOwner)).status,403);assert.equal((await signIn(db)).status,423);
 assert.equal((await settings(context(db,'/tools/th-operations-scheduler/api/pin-access',{action:'reset'}))).status,200);
 assert.equal((await signIn(db)).status,200);
});
test('cross-origin and missing trusted IP fail closed',async()=>{
 const db=await setup();assert.equal((await signIn(db,'123456',{Origin:'https://attacker.example'})).status,403);
 const ctx=context(db);ctx.request.headers.delete('CF-Connecting-IP');assert.equal((await login(ctx,await config(db))).status,403);
});
test('PIN route cannot expose APIs before login or private admin routes after login',async()=>{
 const db=await setup();assert.equal((await gateway(context(db,'/scheduler-agent/api/state',undefined))).status,401);
 const response=await signIn(db),headers={Cookie:response.headers.get('Set-Cookie')};
 assert.equal((await gateway(context(db,'/scheduler-agent/api/pin-access',undefined,headers))).status,404);
 assert.equal((await gateway(context(db,'/scheduler-agent/../private/',undefined,headers))).status,404);
});
test('PIN configuration is hashed, and disable revokes access',async()=>{
 const db=await setup(),cfg=await config(db);assert.notEqual(cfg.hash,'123456');assert.equal(cfg.hash.length,64);
 const r=await signIn(db);await settings(context(db,'/tools/th-operations-scheduler/api/pin-access',{action:'disable'}));
 assert.equal(await authenticated(context(db,'/scheduler-agent/',undefined,{Cookie:r.headers.get('Set-Cookie')}),await config(db)),false);
 assert.equal((await signIn(db)).status,503);
});
