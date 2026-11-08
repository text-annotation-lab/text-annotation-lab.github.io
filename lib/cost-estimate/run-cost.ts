import {priceFor,type Provider} from './pricing';
import {usageSample} from './engine';
export type CostRecord={status:string;runId?:string;runStartedAt?:string;runSize?:number;provider?:Provider;model?:string;processing?:string;webSearch?:boolean;usage?:any;time?:string;startedAt?:string;history?:CostRecord[]};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function recordedCost(row:CostRecord):{amount:number;reported:boolean}|undefined{
 const u=row.usage;
 if(row.provider==='openrouter'&&finite(u?.cost))return {amount:u.cost,reported:true};
 if(!row.provider||!row.model||!u||row.webSearch)return;
 // Cache discounts/writes and search fees need billing-specific prices. Do not
 // present an incomplete token calculation as the charge for those requests.
 if([u.input_tokens_details?.cached_tokens,u.prompt_tokens_details?.cached_tokens,u.prompt_tokens_details?.cache_write_tokens,u.cache_read_input_tokens,u.cache_creation_input_tokens,u.cachedContentTokenCount].some(n=>finite(n)&&n>0))return;
 const s=usageSample(row.provider,u),p=priceFor(row.provider,row.model,(row.time||row.startedAt)?.slice(0,10));
 if(!s||!finite(s.input)||!p)return;
 const long=!!p.threshold&&s.input>p.threshold;
 const input=long?p.longInput??p.input:p.input,output=long?p.longOutput??p.output:p.output;
 const discount=row.processing==='batch'&&p.batch?0.5:1;
 return {amount:(s.input*input+s.output*output)/1e6*discount,reported:false};
}
export function latestRunCost(rows:CostRecord[]){
 const attempts=rows.flatMap(row=>[...(row.history||[]),row]).filter(row=>['done','error','running','queued'].includes(row.status));
 const tracked=attempts.filter(row=>row.runId&&row.runStartedAt);
 const latest=tracked.reduce<CostRecord|undefined>((a,b)=>!a||b.runStartedAt!>=a.runStartedAt!?b:a,undefined);
 const selected=latest?attempts.filter(row=>row.runId===latest.runId):attempts;
 if(!selected.length)return;
 let amount=0,known=0,calculated=0,active=0;
 for(const row of selected){if(row.status==='running'||row.status==='queued')active++;const c=recordedCost(row);if(c){amount+=c.amount;known++;if(!c.reported)calculated++;}}
 return {amount,known,calculated,active,count:selected.length,missing:selected.length-known,planned:selected.reduce((n,r)=>Math.max(n,finite(r.runSize)?r.runSize:0),selected.length),legacy:!latest,startedAt:latest?.runStartedAt};
}
