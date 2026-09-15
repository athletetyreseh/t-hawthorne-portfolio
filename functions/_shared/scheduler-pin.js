import { json, requireSameOrigin } from './scheduler.js';
export const PIN_ROOT = '/scheduler-agent/';
const COOKIE = 'th_scheduler_agent';
const HOURS = 4 * 60 * 60;
export async function schema(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS scheduler_pin_config (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL, version TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS scheduler_pin_attempts (ip TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS scheduler_pin_sessions (token TEXT PRIMARY KEY, ip TEXT NOT NULL, version TEXT NOT NULL, expires INTEGER NOT NULL)')
  ]);
}
export const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export const config = db => db.prepare('SELECT * FROM scheduler_pin_config WHERE id=1').first();
export function trustedIp(context) {
  return context.request.headers.get('CF-Connecting-IP') || (context.env.SCHEDULER_DEV_BYPASS === 'true' ? '127.0.0.1' : '');
}
export const cookie = (value, age=HOURS) => `${COOKIE}=${value}; Path=${PIN_ROOT}; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export async function authenticated(context, cfg) {
  const ip = trustedIp(context);
  if (!cfg || !ip) return false;
  const token = (context.request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  return !!await context.env.SCHEDULER_DB.prepare('SELECT token FROM scheduler_pin_sessions WHERE token=? AND ip=? AND version=? AND expires>?').bind(await digest(token),await digest(cfg.salt+ip),cfg.version,Date.now()).first();
}
export async function login(context, cfg) {
  if (!requireSameOrigin(context.request)) return json({error:'Invalid request origin'},403);
  if (!cfg) return json({error:'PIN access has not been enabled by the owner.'},503);
  const rawIp = trustedIp(context);
  if (!rawIp) return json({error:'Network identity unavailable.'},403);
  const db=context.env.SCHEDULER_DB, ip=await digest(cfg.salt+rawIp);
  const blocked = () => json({error:'PIN access is locked for this network. Ask the owner to reset access through the normal login.'},423);
  const attempts=await db.prepare('SELECT failures FROM scheduler_pin_attempts WHERE ip=?').bind(ip).first();
  if (attempts?.failures>=5) return blocked();
  if (Number(context.request.headers.get('Content-Length'))>1024) return json({error:'Request too large'},413);
  const text=await context.request.text();
  if(text.length>1024) return json({error:'Request too large'},413);
  let pin=''; try {pin=String(JSON.parse(text).pin||'');} catch {}
  if (!/^\d{6}$/.test(pin) || await pinHash(pin,cfg.salt)!==cfg.hash) {
    const result=await db.prepare('INSERT INTO scheduler_pin_attempts(ip,failures) VALUES (?,1) ON CONFLICT(ip) DO UPDATE SET failures=MIN(failures+1,5) RETURNING failures').bind(ip).first();
    if(result.failures>=5) return blocked();
    return json({error:`Incorrect code. ${5-result.failures} attempts remain.`},401);
  }
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const result=await db.prepare(`INSERT INTO scheduler_pin_sessions(token,ip,version,expires)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM scheduler_pin_config WHERE id=1 AND version=?)
    AND COALESCE((SELECT failures FROM scheduler_pin_attempts WHERE ip=?),0)<5`).bind(await digest(token),ip,cfg.version,Date.now()+HOURS*1000,cfg.version,ip).run();
  if(!result.meta.changes) return blocked();
  await db.prepare('DELETE FROM scheduler_pin_sessions WHERE expires<?').bind(Date.now()).run();
  const response=json({ok:true,location:PIN_ROOT}); response.headers.set('Set-Cookie',cookie(token));return response;
}
export function loginPage() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>TH Scheduler · Agent access</title><style>body{font:16px system-ui;background:#e8eef6;color:#183454;display:grid;place-items:center;min-height:95vh;margin:0}main{background:white;padding:32px;border:1px solid #bbc9d9;border-radius:14px;width:min(330px,85vw);box-shadow:0 12px 35px #18345418}h1{font-size:23px;margin-top:0}input,button{font:inherit;box-sizing:border-box}input{width:100%;padding:12px;text-align:center;font-size:28px;letter-spacing:8px;border:1px solid #9bafc7;border-radius:6px}.pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:15px 0}button{padding:13px;border:1px solid #adbed2;border-radius:6px;background:#edf3fa;cursor:pointer}button[type=submit]{background:#214e7f;color:white;width:100%}p{line-height:1.5}#message{min-height:48px;font-size:14px}a{color:#214e7f}</style><main><h1>TH Operations Scheduler</h1><p>Enter your six-digit agent access code.</p><form id="login"><label for="pin">Access code</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" required autofocus><div class="pad">${['1','2','3','4','5','6','7','8','9','Clear','0','⌫'].map(k=>`<button type="button" data-key="${k}" aria-label="${k==='⌫'?'Backspace':k}">${k}</button>`).join('')}</div><button type="submit">Open scheduler</button></form><p id="message" role="status" aria-live="polite">Five incorrect attempts lock this network until the owner resets access.</p><a href="/tools/th-operations-scheduler/">Use normal Cloudflare login</a></main><script>const form=document.querySelector('form'),pin=document.querySelector('#pin'),message=document.querySelector('#message');document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>{const k=b.dataset.key;pin.value=k==='Clear'?'':k==='⌫'?pin.value.slice(0,-1):(pin.value+k).slice(0,6);pin.focus()});form.onsubmit=async e=>{e.preventDefault();const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{const r=await fetch('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin.value})});const data=await r.json();if(r.ok){location.assign(data.location);return}message.textContent=data.error;pin.value='';if(r.status===423){pin.disabled=true;return}}catch{message.textContent='Connection failed. Please try again.'}buttons.forEach(b=>b.disabled=false);pin.focus()};</script></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
}
