import { agentConsole } from '../_shared/scheduler-agent-console.js';
import { agentRead, agentExecute, agentManifest } from '../_shared/scheduler-agent-api.js';
import { getSchedulerCapabilityManifest } from '../_shared/scheduler-capabilities.js';
import { schema, config, authenticated, login, loginPage, PIN_ROOT, cookie } from '../_shared/scheduler-pin.js';
import { json, errorResponse, requireSameOrigin } from '../_shared/scheduler.js';
import { ownerEmailFor } from '../_shared/private-access.js';
import * as state from '../tools/th-operations-scheduler/api/state.js';
import * as history from '../tools/th-operations-scheduler/api/history.js';
import * as restore from '../tools/th-operations-scheduler/api/restore.js';
import * as commands from '../tools/th-operations-scheduler/api/commands.js';
import * as capabilities from '../tools/th-operations-scheduler/api/capabilities.js';
import * as commandHistory from '../tools/th-operations-scheduler/api/command-history.js';
import * as commandUndo from '../tools/th-operations-scheduler/api/command-undo.js';
import * as officerAdmin from '../tools/th-operations-scheduler/api/officer-admin.js';
const routes = {state,history,restore,commands,capabilities,'command-history':commandHistory,'command-undo':commandUndo,'officer-admin':officerAdmin};
const assets = new Set(['index.html','private-scheduler.css','cloud-sync.js','sync-merge.js','ai-control.js','officer-requests.js']);
export async function onRequest(context) {
  try {
    const url=new URL(context.request.url);
    if(!url.pathname.startsWith(PIN_ROOT) && url.pathname!=='/scheduler-agent') return json({error:'Not found'},404);
    if(url.pathname==='/scheduler-agent') return Response.redirect(new URL(PIN_ROOT,url),302);
    const path=url.pathname.slice(PIN_ROOT.length);
    await schema(context.env.SCHEDULER_DB);
    const cfg=await config(context.env.SCHEDULER_DB);
    if(path==='login' && context.request.method==='POST') return await login(context,cfg);
    if(path==='logout' && context.request.method==='POST') {
      if(!requireSameOrigin(context.request)) return json({error:'Invalid request origin'},403);
      const response=json({ok:true});response.headers.set('Set-Cookie',cookie('',0));return response;
    }
    if(!await authenticated(context,cfg)) {
      if(!path || path==='index.html') return loginPage();
      return json({error:'PIN authentication required',login:PIN_ROOT},401);
    }
    context.data.schedulerUser=ownerEmailFor(context);
    // PIN sessions are scheduler operators, not Cloudflare/private-access administrators.
    context.data.privateUser={email:'scheduler-pin-agent'};
    if((!path||path==='index.html') && context.request.method==='GET') return agentConsole();
    if(['api/context','api/query'].includes(path) && context.request.method==='GET') return await agentRead(context,path.slice(4));
    if(path==='api/execute' && context.request.method==='POST') return await agentExecute(context);
    if(path==='api/capabilities' && context.request.method==='GET') return json(agentManifest(getSchedulerCapabilityManifest()));
    if(path.startsWith('api/')) {
      const route=routes[path.slice(4)], method='onRequest'+context.request.method[0]+context.request.method.slice(1).toLowerCase();
      if(!route) return json({error:'Not found'},404);
      if(!route[method]) return json({error:'Method not allowed'},405);
      const response=await route[method](context);
      if(path==='api/capabilities') return new Response((await response.text()).replaceAll('/tools/th-operations-scheduler/',PIN_ROOT),response);
      return response;
    }
    if(!['GET','HEAD'].includes(context.request.method)) return json({error:'Method not allowed'},405);
    if(path && !assets.has(path) && !/^assets\/[a-z0-9-]+\.png$/.test(path)) return json({error:'Not found'},404);
    const source=new URL('/tools/th-operations-scheduler/'+(path==='index.html'?'':path),url);
    source.search=url.search;
    const asset=await context.env.ASSETS.fetch(new Request(source,{method:context.request.method}));
    const headers=new Headers(asset.headers);headers.set('Cache-Control','no-store');headers.set('X-Robots-Tag','noindex, nofollow');headers.set('X-Frame-Options','DENY');
    if(/text\/html|javascript/.test(headers.get('Content-Type')||'')) {
      const body=(await asset.text()).replaceAll('/tools/th-operations-scheduler/',PIN_ROOT);
      headers.delete('Content-Length');headers.delete('ETag');return new Response(body,{status:asset.status,headers});
    }
    return new Response(asset.body,{status:asset.status,headers});
  } catch(error) {return errorResponse(error);}
}
