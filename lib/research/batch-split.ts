// Research mode: a batch run larger than the provider takes in one batch is sent as several provider batches, all in
// the same run. Each batch holds whole texts (or subjects): every annotation of a text goes in the same batch. The
// requests are numbered across the run, so the results of every batch are matched to the run's texts as before.
import {CLOSE_WHEN_SAVED} from '../batch-save-note';
import {SPLIT_LIMITS} from '../batch-limits';
import type {BatchJob,BatchPart} from '../batch-types';
import type {Provider} from '../providers';

export type PlannedPart={items:[number,number];requests:[number,number];bytes:number};
export type BatchPlan={parts:PlannedPart[];bytes:number;requests:number;bySize:boolean};
type SplitProvider=keyof typeof SPLIT_LIMITS;

// Items (by position) grouped into batches within the limit, keeping their order. sizes: the bytes of each item's
// requests together; requests: how many requests each item has; overhead: the bytes a batch adds around its
// requests; separator: the bytes between two requests. Returns the index of an item too large for any batch.
export function groupParts(sizes:number[],requests:number[],limit:{bytes:number;requests:number},overhead:number,separator:number):PlannedPart[]|{tooLarge:number}{
 const parts:PlannedPart[]=[];let item=0,request=0,bytes=overhead,rows=0;
 const close=(end:number)=>{if(end>item)parts.push({items:[item,end],requests:[request,request+rows],bytes});};
 for(let i=0;i<sizes.length;i++){
  const added=sizes[i]+requests[i]*separator;
  if(overhead+added>limit.bytes||requests[i]>limit.requests)return {tooLarge:i};
  if(rows&&(bytes+added>limit.bytes||rows+requests[i]>limit.requests)){close(i);request+=rows;item=i;bytes=overhead;rows=0;}
  bytes+=added;rows+=requests[i];
 }
 close(sizes.length);
 return parts;
}
export const splitLimit=(provider:Provider)=>SPLIT_LIMITS[provider as SplitProvider];

// The question asked before a run that goes out as several batches.
export function splitQuestion(plan:BatchPlan,provider:Provider):string{
 const limit=splitLimit(provider),n=plan.parts.length;
 const why=plan.bySize?`about ${Math.round(plan.bytes/1e6).toLocaleString('en-US')} MB of requests, more than ${limit.label} accepts in one batch (${limit.providerMb} MB, of which the Lab uses at most ${provider==='gemini'?'18 MB':'95%'})`:`${plan.requests.toLocaleString('en-US')} requests, more than the Lab sends in one batch (${limit.requests.toLocaleString('en-US')})`;
 return `This run is ${why}, so it will be sent as ${n} batches in the same run (all at batch price; the results are collected together). Submit it?`;
}

// The state of a run sent as several batches, from the state of its batches.
export function withParts(job:BatchJob,parts:BatchPart[]):BatchJob{
 const open=parts.filter(part=>part.state!=='collected'&&part.state!=='unsent');
 const state:BatchJob['state']=open.some(part=>part.state==='waiting'||part.state==='submitting')?'submitting':open.some(part=>part.state==='unknown')?'unknown':open.some(part=>part.state==='ready')?'ready':'processing';
 const counted=parts.filter(part=>part.total!==undefined);
 return {...job,parts,state,completed:counted.length?counted.reduce((n,part)=>n+(part.completed||0),0):undefined,total:counted.length?counted.reduce((n,part)=>n+(part.total||0),0):undefined};
}
export function withPart(job:BatchJob,k:number,change:Partial<BatchPart>):BatchJob{return withParts(job,job.parts!.map((part,i)=>i===k?{...part,...change}:part));}
// A run whose batches have all been collected, or were not sent, needs nothing more.
export const partsDone=(job:BatchJob)=>Boolean(job.parts?.every(part=>part.state==='collected'||part.state==='unsent'));
export const textsOf=(job:BatchJob,part:BatchPart)=>job.docIds.slice(part.items[0],part.items[1]);
// The texts of the batches in the given states.
export function textsIn(job:BatchJob,states:BatchPart['state'][]):Set<string>{return new Set((job.parts||[]).filter(part=>states.includes(part.state)).flatMap(part=>textsOf(job,part)));}
export const partName=(job:BatchJob,k:number)=>`batch ${k+1} of ${job.parts!.length}`;

// Sends the batches one by one, recording each before it goes up and after (save), so a batch that went up is
// never lost. Stops at the first batch not sent: it is unknown when its submission was not confirmed, else not sent,
// and the batches after it are not sent.
export async function sendParts(job:BatchJob,send:(k:number)=>Promise<string>,save:(job:BatchJob)=>Promise<void>):Promise<{job:BatchJob;stopped?:{at:number;message:string;uncertain:boolean}}>{
 let current=job;
 const stop=(k:number,message:string,uncertain:boolean)=>{current=withParts(current,current.parts!.map((part,i)=>i===k?{...part,state:uncertain?'unknown':'unsent'}:i>k?{...part,state:'unsent'}:part));return {job:current,stopped:{at:k,message,uncertain}};};
 for(let k=0;k<current.parts!.length;k++){
  current=withPart(current,k,{state:'submitting'});
  try{await save(current);}catch{return stop(k,'This workspace could not be saved, so the batch was not sent.',false);}
  let id:string;
  try{id=await send(k);}catch(error){return stop(k,error instanceof Error?error.message:'Could not submit this batch.',(error as {uncertain?:boolean}).uncertain!==false);}
  current=withPart(current,k,{id,state:'processing'});
  try{await save(current);}catch{if(k+1<current.parts!.length)return stop(k+1,'This workspace could not be saved, so the batches after it were not sent.',false);}
 }
 return {job:current};
}

// After a reload: a batch whose upload was under way may or may not have reached the provider; batches not yet
// sent are not sent now. Returns the job (null when no batch went up) and the texts to release.
export function restoredParts(job:BatchJob):{job:BatchJob|null;release:Set<string>}{
 if(!job.parts)return {job:{...job,state:job.state==='submitting'?'unknown':job.state},release:new Set()};
 const parts=job.parts.map(part=>part.state==='submitting'?{...part,state:'unknown' as const}:part.state==='waiting'?{...part,state:'unsent' as const}:part);
 const restored=withParts(job,parts),release=new Set(job.parts.flatMap((part,k)=>part.state==='waiting'?textsOf(job,job.parts![k]):[]));
 return {job:partsDone(restored)?null:restored,release};
}

// The notice after the batches were sent (or not all of them). unit: texts or subjects.
export function sentNotice(job:BatchJob,stopped:{at:number;message:string;uncertain:boolean}|undefined,unit:string):string{
 const n=job.parts!.length;
 if(!stopped)return `Submitted as ${n} batches in one run. Once this workspace is saved, you can close the page and return in this browser.`;
 const sent=stopped.at,before=sent?` ${sent===1?'Batch 1 was submitted and continues':`Batches 1 ${sent===2?'and':'to'} ${sent} were submitted and continue`} in this run.`:'';
 const rest=job.parts!.filter((part,k)=>part.state==='unsent'&&k>=stopped.at).reduce((count,part)=>count+part.items[1]-part.items[0],0);
 const released=rest?` The ${rest.toLocaleString('en-US')} ${unit} of the batches not sent are back in the queue; send them once the submitted batches are collected.`:'';
 if(stopped.uncertain)return `Submission of batch ${sent+1} of ${n} was not confirmed. Do not submit again yet. Check your provider’s console and use the batch reference below to recover it.${before}${released}`;
 return `Batch ${sent+1} of ${n} was not submitted: ${stopped.message.replace(/\s*No batch was submitted\.?$/,'')}${before}${released}`;
}

// The notice after checking, collecting, or cancelling the batches of a run sent as several. unit: texts or subjects.
export function partsNotice(job:BatchJob,action:'check'|'collect'|'cancel',collected:number,problem:string,unit:string):string{
 const parts=job.parts!,open=parts.filter(part=>part.state!=='collected'&&part.state!=='unsent'),unknown=parts.findIndex(part=>part.state==='unknown');
 const got=collected?`Results of ${collected} ${collected===1?'batch':'batches'} collected. `:'';
 if(problem)return got+problem;
 if(action==='cancel')return 'Cancellation requested for the batches still running. Check status later, then collect any completed results.';
 if(!open.length)return `Batch results collected from all ${parts.filter(part=>part.state==='collected').length} batches of this run. Any failed ${unit} are marked for review; completed results are kept.`;
 const check=unknown>=0?` Batch ${unknown+1} of ${parts.length} needs checking: recover it under Batch details.`:'';
 const running=open.filter(part=>part.state==='processing').length,ended=open.filter(part=>part.state==='ready').length;
 if(running)return `${got}${running} of the ${parts.length} batches ${running===1?'is':'are'} still processing. ${CLOSE_WHEN_SAVED}${ended?' Collect results to take in the batches that have ended.':''}${check}`;
 if(ended)return `${got}The batches still to collect have ended. Collect results to see their annotations and any errors.${check}`;
 return (got+check).trim();
}
