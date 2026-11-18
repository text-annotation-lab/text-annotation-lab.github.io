import {priceFor,type Provider} from './pricing';
import {usageSample} from './engine';
// repeats, annotations: a result made of several annotations (research mode, lib/research/repeats.ts).
export type CostRecord={status:string;runId?:string;runStartedAt?:string;runSize?:number;provider?:Provider;model?:string;processing?:string;webSearch?:boolean;usage?:any;time?:string;startedAt?:string;history?:CostRecord[];repeats?:number;annotations?:(CostRecord&{n?:number})[]};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function recordedCost(row:CostRecord):{amount:number;reported:boolean}|undefined{
 const u=row.usage;
 if(row.provider==='openrouter'&&finite(u?.cost))return {amount:u.cost,reported:true};
 if(!row.provider||!row.model||!u||row.webSearch)return;
 const s=usageSample(row.provider,u),p=priceFor(row.provider,row.model,(row.time||row.startedAt)?.slice(0,10));
 if(!s||!finite(s.input)||!p)return;
 // Search fees need billing-specific prices, and so do cached tokens on a model without a listed cache
 // rate. Do not present an incomplete token calculation as the charge for those requests.
 const batch=row.processing==='batch'&&p.batch,cache=cacheTokens(row.provider,u,batch);
 const cached=cache.read+cache.write+cache.hourWrite,fresh=s.input-cached;
 if(cached>0&&(row.provider==='openrouter'||p.cacheRead===undefined||fresh<0))return;
 const long=!!p.threshold&&s.input>p.threshold;
 const input=long?p.longInput??p.input:p.input,output=long?p.longOutput??p.output:p.output;
 const discount=batch?0.5:1;
 // Shares of the input price: a cache read at the model's listed rate; a cache write at 1.25 (Anthropic's
 // five-minute entry, OpenAI's 30-minute entry) or 2 (Anthropic's one-hour entry). The batch discount applies to all.
 const read=batch&&p.cacheReadBatch!==undefined?p.cacheReadBatch:(p.cacheRead??1)*discount;
 return {amount:((fresh*discount+cache.read*read+(cache.write*1.25+cache.hourWrite*2)*discount)*input+s.output*output*discount)/1e6,reported:false};
}
// Input tokens a request read from the provider's prompt cache or wrote to it; they are part of its input tokens.
// hourWrite: written to Anthropic's one-hour cache, which the Lab asks for in a batch.
export function cacheTokens(provider:Provider|undefined,u:any,batch=false):{read:number;write:number;hourWrite:number}{
 const n=(value:unknown)=>finite(value)?value:0;
 if(provider==='anthropic'){
  const all=n(u?.cache_creation_input_tokens),hour=finite(u?.cache_creation?.ephemeral_1h_input_tokens)?Math.min(u.cache_creation.ephemeral_1h_input_tokens,all):batch?all:0;
  return {read:n(u?.cache_read_input_tokens),write:all-hour,hourWrite:hour};
 }
 if(provider==='gemini')return {read:n(u?.cachedContentTokenCount),write:0,hourWrite:0};
 const details=provider==='openrouter'?u?.prompt_tokens_details:u?.input_tokens_details;
 return {read:n(details?.cached_tokens),write:n(details?.cache_write_tokens),hourWrite:0};
}
// The requests behind a result. One made of several annotations counts request by request: each annotation
// that came back, with its own usage and the click it was sent with, and, while the text is being annotated,
// one request in progress for each annotation still to come.
function requestsOf(row:CostRecord):CostRecord[]{
 const made=Array.isArray(row.annotations)?row.annotations.filter(a=>a&&typeof a==='object'&&(a.status==='done'||a.status==='error')):[];
 const active=row.status==='running'||row.status==='queued',planned=active&&typeof row.repeats==='number'?row.repeats:0;
 if(!made.length&&planned<2)return [row];
 const {annotations,history,usage,repeats,...shared}=row,list:CostRecord[]=made.map(a=>({...shared,...a}));
 for(let n=1;n<=planned;n++)if(!made.some(a=>a.n===n&&(a.status==='done'||a.runId===row.runId)))list.push(shared);
 return list;
}
export function latestRunCost(rows:CostRecord[]){
 const attempts=rows.flatMap(row=>[...(row.history||[]),...requestsOf(row)]).filter(row=>['done','error','running','queued'].includes(row.status));
 const tracked=attempts.filter(row=>row.runId&&row.runStartedAt);
 const latest=tracked.reduce<CostRecord|undefined>((a,b)=>!a||b.runStartedAt!>=a.runStartedAt!?b:a,undefined);
 const selected=latest?attempts.filter(row=>row.runId===latest.runId):attempts;
 if(!selected.length)return;
 let amount=0,known=0,calculated=0,active=0,cacheRead=0,cacheWrite=0;
 for(const row of selected){if(row.status==='running'||row.status==='queued')active++;const c=recordedCost(row);if(c){amount+=c.amount;known++;if(!c.reported)calculated++;}const cache=cacheTokens(row.provider,row.usage);cacheRead+=cache.read;cacheWrite+=cache.write+cache.hourWrite;}
 // The models and the way of running the run's requests used (normally one of each), so its cost is not
 // mistaken for the estimate of the next run, which uses the current settings.
 const models=[...new Set(selected.flatMap(r=>r.model?[r.model]:[]))],batch=selected.length>0&&selected.every(r=>r.processing==='batch');
 return {amount,known,calculated,active,cacheRead,cacheWrite,models,batch,count:selected.length,missing:selected.length-known,planned:selected.reduce((n,r)=>Math.max(n,finite(r.runSize)?r.runSize:0),selected.length),legacy:!latest,startedAt:latest?.runStartedAt};
}
