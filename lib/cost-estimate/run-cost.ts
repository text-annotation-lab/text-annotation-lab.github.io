import {priceFor,type Provider} from './pricing';
import {usageSample} from './engine';
export type CostRecord={status:string;runId?:string;runStartedAt?:string;runSize?:number;provider?:Provider;model?:string;processing?:string;webSearch?:boolean;usage?:any;time?:string;startedAt?:string;history?:CostRecord[]};
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
export function latestRunCost(rows:CostRecord[]){
 const attempts=rows.flatMap(row=>[...(row.history||[]),row]).filter(row=>['done','error','running','queued'].includes(row.status));
 const tracked=attempts.filter(row=>row.runId&&row.runStartedAt);
 const latest=tracked.reduce<CostRecord|undefined>((a,b)=>!a||b.runStartedAt!>=a.runStartedAt!?b:a,undefined);
 const selected=latest?attempts.filter(row=>row.runId===latest.runId):attempts;
 if(!selected.length)return;
 let amount=0,known=0,calculated=0,active=0,cacheRead=0,cacheWrite=0;
 for(const row of selected){if(row.status==='running'||row.status==='queued')active++;const c=recordedCost(row);if(c){amount+=c.amount;known++;if(!c.reported)calculated++;}const cache=cacheTokens(row.provider,row.usage);cacheRead+=cache.read;cacheWrite+=cache.write+cache.hourWrite;}
 return {amount,known,calculated,active,cacheRead,cacheWrite,count:selected.length,missing:selected.length-known,planned:selected.reduce((n,r)=>Math.max(n,finite(r.runSize)?r.runSize:0),selected.length),legacy:!latest,startedAt:latest?.runStartedAt};
}
