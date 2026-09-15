import { json, parseBody, requireSameOrigin, errorResponse } from './scheduler.js';
import { executeSchedulerCommand, SchedulerCommandError } from './scheduler-commands.js';
import { onRequestPost as saveCommand } from '../tools/th-operations-scheduler/api/commands.js';
export const commandReference = {
 assign:{required:['target','officer'],optional:['start','end','position','note','allowNewOfficer']},
 unassign:{required:['target']},set_time:{required:['target','start and/or end']},set_status:{required:['target','status'],optional:['officer','allowNewOfficer','confirm']},
 set_note:{required:['target','note']},tag:{required:['target']},untag:{required:['target']},clear:{required:['target','confirm:true']},block:{required:['target','confirm:true']},
 update_assignment:{required:['target','patch'],patchFields:['status','officer','start','end','position','note','tagged','billCategory','hoursDesc','invoice','allowNewOfficer']},
 add_officer:{required:['officer']},remove_officer:{required:['officer','confirm:true'],behavior:'Removes roster entry; existing assignments remain.'},
 set_row_post:{required:['target','post']},insert_row:{required:['target'],optional:['rowId','typeNum','typeLabel'],behavior:'Inserts a blank row after the target in its working week or master scope.'},
 hide_row:{required:['target']},show_row:{required:['target']},
 update_row:{required:['target','patch'],patchFields:['site','post','shiftCode','shiftName','time','typeNum','typeLabel','scope','weekStart']},remove_row:{required:['target','confirm:true']},
 copy_cell:{required:['source','target','confirm:true'],behavior:'Both source and target use the target schema. Copies the full assignment.'},
 copy_week:{required:['sourceDate','destinationDate','confirm:true'],optional:['site','sourceMode','destinationMode'],behavior:'Copies every matching row; modes default to working. Dates select their Monday-through-Sunday week.'},
 rollover_master:{required:['date','confirm:true'],behavior:'Copies master to the selected working week across all rows.'},clear_week:{required:['date','confirm:true'],optional:['mode','site']},
 update_settings:{required:['patch'],patchFields:['jobNumbers','view','dates','lastRolloverWeek'],behavior:'Replaces supplied settings fields, retaining omitted fields. Read current state before changing view.'},
 replace_state:{required:['state','confirm:true'],behavior:'Validated full schedule JSON import / replacement. Use GET state and preserve fields you are not editing. Atomic, revision-checked and recoverable.'},
 batch:{required:['commands'],optional:['confirm'],behavior:'1–50 commands. No nested batches. One revision and restore point. Failure rolls back every command.'},save:{},sync:{}
};
export function agentManifest(base) {
  const value=JSON.parse(JSON.stringify(base).replaceAll('/tools/th-operations-scheduler/','/scheduler-agent/'));
  value.schemaVersion='2026-09-15-agent';
  value.privacy.access='Six-digit PIN session required. Same-origin JSON mutations; no Cloudflare login required on this route.';
  value.endpoints.execute={method:'POST',path:'/scheduler-agent/api/execute',body:{baseRevision:'integer',dryRun:'optional boolean',command:'see commandReference'}};
  value.endpoints.context={method:'GET',path:'/scheduler-agent/api/context',description:'Revision, settings, roster and stable row IDs without assignment payloads.'};
  value.endpoints.query={method:'GET',path:'/scheduler-agent/api/query',parameters:{from:'YYYY-MM-DD',to:'YYYY-MM-DD; max 93 days',site:'exact name',officer:'exact name',rowId:'exact ID',status:'assigned|escort|open|blank|blocked|sick|pto|training',mode:'working|master',offset:'integer, default 0',limit:'1–1000, default 100'},description:'Flat filtered entries with revision and pagination. No implicit writes.'};
  value.endpoints.officerRequests={method:'GET / PATCH',path:'/scheduler-agent/api/officer-admin',patch:{id:'request ID',status:'approved|denied',denialMessage:'required when denied'}};
  value.commandReference=commandReference;
  value.requestSchema.properties.command.properties.kind.enum=Object.keys(commandReference);
  value.operations.rows.push('update_row','remove_row');value.operations.copy=['copy_cell','copy_week'];value.operations.settings=['update_settings'];value.operations.import=['replace_state'];
  value.safety.confirmations.push('copy_cell, copy_week, remove_row and replace_state require confirm:true; setting blank or blocked through other commands also requires confirmation.');
  value.agentExecutionRules.codeFirst='Read context/query, then POST execute or commands. Batch up to 50 edits. Do not load the human calendar. Preview with dryRun:true. No automatic write retries after conflicts or network failures.';
  value.transport={session:'HttpOnly cookie obtained from POST /scheduler-agent/login with {pin:"six digits"}. Retain cookies.',origin:'Send Origin matching the website on all writes.',noBrowserRequired:'HTTP clients may use the same session cookie and JSON endpoints.',save:'Every successful write persists immediately. No Save Now click is needed.',export:'GET api/state returns the complete schedule; import with replace_state.'};
  return value;
}
const integer=(value,defaultValue,max)=>{if(value===null)return defaultValue;const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>max)throw json({error:'Invalid pagination'},400);return n};
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export async function agentRead(context,kind) {
  const stored=await context.env.SCHEDULER_DB.prepare('SELECT state_json, revision, updated_at FROM scheduler_state WHERE owner_email = ?').bind(context.data.schedulerUser).first();
  if(!stored)return json({error:'No cloud schedule exists'},404);
  const state=JSON.parse(stored.state_json),revision=stored.revision;
  if(kind==='context')return json({revision,updatedAt:stored.updated_at,roster:state.staff,removedStaff:state.removedStaff||[],settings:{view:state.view,dates:state.dates,jobNumbers:state.jobNumbers,lastRolloverWeek:state.lastRolloverWeek},rows:state.rows.map(({assignments,master,...row})=>row),contract:'/scheduler-agent/api/capabilities',next:'GET api/query for target entries, then POST api/execute with baseRevision.'});
  const q=new URL(context.request.url).searchParams,mode=q.get('mode')||'working';
  if(!['working','master'].includes(mode))return json({error:'Invalid mode'},400);
  const from=q.get('from')||state.view?.rangeStart||state.dates?.[0],to=q.get('to')||from;
  if(!validDate(from||'')||!validDate(to||'')||to<from||(Date.parse(to)-Date.parse(from))/86400000>92)return json({error:'Use a valid from/to date range of at most 93 days'},400);
  const dates=[];for(let d=Date.parse(from);d<=Date.parse(to);d+=86400000)dates.push(new Date(d).toISOString().slice(0,10));
  const offset=integer(q.get('offset'),0,1000000),limit=integer(q.get('limit'),100,1000);if(!limit)return json({error:'limit must be positive'},400);
  const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase(),matches=(field,value)=>!q.has(field)||norm(q.get(field))===norm(value);
  const entries=[];
  for(const row of state.rows){if(!matches('site',row.site)||!matches('rowId',row.id))continue;
    for(const date of dates){const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date+'T12:00:00Z').getUTCDay()];const a=(mode==='master'?row.master?.[day]:row.assignments?.[date])||{status:'blank',name:'',start:'',end:''};
      if(matches('officer',a.name)&&matches('status',a.status))entries.push({rowId:row.id,site:row.site,post:row.post,shift:row.shiftCode,date,mode,assignment:a});
    }
  }
  return json({revision,from,to,mode,total:entries.length,offset,limit,nextOffset:offset+limit<entries.length?offset+limit:null,entries:entries.slice(offset,offset+limit)});
}
export async function agentExecute(context) {
  if(!requireSameOrigin(context.request))return json({error:'Invalid request origin'},403);
  // Preserve the original request for the shared saving endpoint.
  const body=await parseBody(context.request.clone());
  if(body.dryRun!==undefined&&typeof body.dryRun!=='boolean')return json({error:'dryRun must be boolean'},400);
  if(!body.dryRun)return await saveCommand(context);
  const stored=await context.env.SCHEDULER_DB.prepare('SELECT state_json, revision FROM scheduler_state WHERE owner_email = ?').bind(context.data.schedulerUser).first();
  if(!stored)return json({error:'No cloud schedule exists'},404);
  if(body.baseRevision!==stored.revision)return json({error:'Cloud schedule changed',code:'revision_conflict',revision:stored.revision},409);
  try {const result=executeSchedulerCommand(JSON.parse(stored.state_json),body.command);return json({ok:true,dryRun:true,saved:false,revision:stored.revision,wouldChange:result.changed,result:result.result});}
  catch(error){if(error instanceof SchedulerCommandError)return json({error:error.message,code:error.code,details:error.details},error.status);return errorResponse(error)}
}
