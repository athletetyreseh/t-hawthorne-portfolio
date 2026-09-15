import { schema, pinHash } from '../../../_shared/scheduler-pin.js';
import { json, errorResponse, requireSameOrigin } from '../../../_shared/scheduler.js';
import { ownerEmailFor } from '../../../_shared/private-access.js';
export async function onRequest(context) {
  if(context.data.privateUser?.email!==ownerEmailFor(context)) return json({error:'Owner access required'},403);
  try {
    await schema(context.env.SCHEDULER_DB);
    if(context.request.method==='POST') {
      if(!requireSameOrigin(context.request)) return json({error:'Invalid request origin'},403);
      const text=await context.request.text();if(text.length>1024) return json({error:'Request too large'},413);
      let body;try{body=JSON.parse(text)}catch{return json({error:'Invalid request'},400)}
      const db=context.env.SCHEDULER_DB;
      if(body.action==='reset') {
        await db.prepare('DELETE FROM scheduler_pin_attempts').run();return json({ok:true,message:'Network lockouts cleared.'});
      }
      if(body.action==='disable') {
        await db.batch([db.prepare('DELETE FROM scheduler_pin_config'),db.prepare('DELETE FROM scheduler_pin_sessions')]);
        return json({ok:true,message:'PIN access disabled and sessions revoked.'});
      }
      if(body.action!=='set' || !/^\d{6}$/.test(body.pin||'')) return json({error:'Enter exactly six digits'},400);
      const salt=crypto.randomUUID(),version=crypto.randomUUID(),hash=await pinHash(body.pin,salt);
      await db.batch([
        db.prepare('INSERT INTO scheduler_pin_config(id,salt,hash,version) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,version=excluded.version').bind(salt,hash,version),
        db.prepare('DELETE FROM scheduler_pin_attempts'),db.prepare('DELETE FROM scheduler_pin_sessions')
      ]);
      return json({ok:true,message:'Code saved. Previous sessions revoked and lockouts cleared.'});
    }
    if(context.request.method!=='GET') return json({error:'Method not allowed'},405);
    const enabled=!!await context.env.SCHEDULER_DB.prepare('SELECT id FROM scheduler_pin_config WHERE id=1').first();
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scheduler PIN access settings</title><style>body{font:16px system-ui;color:#173655;background:#e9eff7;padding:30px}main{max-width:560px;margin:auto;padding:28px;background:white;border-radius:12px}input,button{font:inherit;padding:10px;margin:5px}input{width:130px;letter-spacing:4px}button{cursor:pointer}p{line-height:1.5}#message{min-height:48px}</style><main><h1>Scheduler agent access</h1><p>PIN access: <strong>${enabled?'Enabled':'Not enabled'}</strong></p><p>The fifth incorrect attempt locks the public IP until you clear lockouts. Devices on the same network share this limit. Sessions expire after four hours.</p><form id="settings"><label for="pin">Six-digit code</label><input id="pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" required autocomplete="off"><button id="generate" type="button">Generate code</button><button type="submit">Save code</button></form><button data-action="reset">Clear network lockouts</button><button data-action="disable">Disable PIN access</button><p id="message" role="status"></p><p><a href="/scheduler-agent/">Open agent link</a></p><a href="../">Back to scheduler</a></main><script>const pin=document.querySelector('#pin'),msg=document.querySelector('#message');document.querySelector('#generate').onclick=()=>{let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=4294000000);pin.value=String(n%1000000).padStart(6,'0')};async function send(body){try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();msg.textContent=data.message||data.error}catch{msg.textContent='Connection failed.'}}document.querySelector('form').onsubmit=e=>{e.preventDefault();send({action:'set',pin:pin.value})};document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>send({action:b.dataset.action}));</script></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
  }catch(error){return errorResponse(error)}
}
