// Runs. A run is every annotation made with one setup (provider, model,
// reasoning effort, prompt, answer fields, and, where set, temperature and
// output limit), numbered in the order the runs were started. Annotating more texts with an unchanged setup adds to the
// latest run; a changed setup, or annotating a text again, starts a new one.
// A text keeps its latest result in its own fields (as it always has) and the
// results of earlier runs in `earlier`, so nothing is overwritten. The run is
// stored as `runNo`; `runNumber` belongs to the Model knowledge workspace,
// where charts and the Excel workbook read it.
import {cleanAnswerSettings,type AnswerSettings} from '../answer-types';
import {cleanRepeats,incomplete} from './repeats';

// answerSettings: the types of the answer fields, plain text, or no explanation (absent: the standard format).
// repeats: annotations per text, when more than one (lib/research/repeats.ts).
// temperature, maxOutput: the request settings that can change an answer, as sent (lib/request-settings.ts;
// absent: the model's own temperature, the Lab's own output limit). The other request settings (prompt caching,
// reasoning summary, OpenAI's logs) leave the answers alone and are recorded on each result only.
export type Setup={provider:string;model:string;effort:string;prompt:string;answerFields:string[];answerSettings?:AnswerSettings;repeats?:number;temperature?:number;maxOutput?:number};
const tuning=(value:{temperature?:unknown;maxOutput?:unknown}|undefined)=>({...(typeof value?.temperature==='number'&&Number.isFinite(value.temperature)?{temperature:value.temperature}:{}),...(typeof value?.maxOutput==='number'&&Number.isInteger(value.maxOutput)?{maxOutput:value.maxOutput}:{})});
// A deleted run keeps its record (marked), so its number is never used again.
export type RunRecord=Setup&{number:number;startedAt:string;deleted?:boolean};
// The fields of a result the research views read by name; a result may hold more.
type ResultFields={provider?:string;model?:string;effort?:string;prompt?:string;answerFields?:string[];answerSettings?:AnswerSettings;repeats?:number;answers?:Record<string,string>;score?:string;explanation?:string;[key:string]:any};
export type Earlier=ResultFields&{runNo:number;status:string};
export type Row=ResultFields&{id:string;status:string;name:string;runNo?:number;earlier?:Earlier[];cells?:string[]};

// Everything a single annotation writes on a text (the same list Clear results removes). requestId to lab are
// the record research mode keeps of a request (lib/research/requests.ts); the last three belong to a result
// made of several annotations (lib/research/repeats.ts).
export const RESULT_KEYS=['inputMode','runId','runStartedAt','runSize','responseFormat','rawResponse','answerFields','answerSettings','requestSettings','answers','history','startedAt','concurrency','provider','score','explanation','error','model','prompt','effort','tokens','usage','time','responseId','processing','batchId','runNo','requestId','modelReported','stopReason','output','reasoningSummary','lab','repeats','annotations','consistency'] as const;

// Field names and their settings together: the same answers are asked for exactly when this is the same.
const fieldsKey=(setup:{answerFields?:string[];answerSettings?:AnswerSettings})=>JSON.stringify([setup.answerFields||[],setup.answerSettings||null]);
export function sameSetup(a:Setup,b:Setup){
 return a.provider===b.provider&&a.model===b.model&&a.effort===b.effort&&a.prompt===b.prompt&&fieldsKey(a)===fieldsKey(b)&&(a.repeats||1)===(b.repeats||1)&&a.temperature===b.temperature&&a.maxOutput===b.maxOutput;
}
// Results from before providers were recorded name their provider by the model.
const providerOf=(row:{provider?:string;model?:string})=>row.provider||(row.model?.startsWith('gemini-')?'gemini':row.model?.startsWith('claude-')?'anthropic':'openai');
export function setupOf(row:{provider?:string;model?:string;effort?:string;prompt?:string;answerFields?:string[];answerSettings?:AnswerSettings;repeats?:number;requestSettings?:{temperature?:number;maxOutput?:number}}):Setup{
 const repeats=cleanRepeats(row.repeats);
 return {provider:providerOf(row),model:row.model||'',effort:row.effort||'',prompt:row.prompt||'',answerFields:row.answerFields||[],...(row.answerSettings?{answerSettings:row.answerSettings}:{}),...(repeats?{repeats}:{}),...tuning(row.requestSettings)};
}
const hasSettings=(row:Row)=>row.prompt!==undefined&&Boolean(row.model)&&row.status!=='pending';
const needsNumber=(row:Row)=>row.runNo===undefined&&hasSettings(row);
const when=(row:Row)=>String(row.runStartedAt||row.startedAt||row.time||'');

// Results made before runs were numbered (or in an older version of the Lab)
// join the latest run with the same setup, or become a run of their own.
export function adoptUnnumbered<T extends Row>(docs:T[],runs:RunRecord[]=[]):{docs:T[];runs:RunRecord[]}{
 if(!docs.some(needsNumber))return {docs,runs};
 const next=[...runs],numbers=new Map<string,number>();
 for(const doc of docs.filter(needsNumber).sort((a,b)=>when(a).localeCompare(when(b)))){
  const setup=setupOf(doc);
  let run=[...next].reverse().find(r=>!r.deleted&&sameSetup(r,setup)&&!(doc.earlier||[]).some(e=>e.runNo===r.number));
  if(!run){run={...setup,number:(next.at(-1)?.number||0)+1,startedAt:when(doc)||new Date().toISOString()};next.push(run);}
  numbers.set(doc.id,run.number);
 }
 return {docs:docs.map(doc=>numbers.has(doc.id)?{...doc,runNo:numbers.get(doc.id)}:doc),runs:next};
}

// Called when annotations are about to start: which run do they belong to?
// `claim` names the texts about to be annotated: a text that already has an
// earlier result in the latest run starts a new run, so a run never holds two
// results for one text.
export function beginRun<T extends Row>(docs:T[],runs:RunRecord[]|undefined,setup:Setup,forceNew:boolean,now:string,claim?:Set<string>):{docs:T[];runs:RunRecord[];number:number}{
 const adopted=adoptUnnumbered(docs,runs||[]),last=adopted.runs.at(-1);
 const repeat=Boolean(last&&claim&&adopted.docs.some(doc=>claim.has(doc.id)&&(doc.earlier||[]).some(e=>e.runNo===last.number)));
 if(last&&!last.deleted&&!forceNew&&!repeat&&sameSetup(last,setup))return {...adopted,number:last.number};
 const number=(last?.number||0)+1;
 return {docs:adopted.docs,runs:[...adopted.runs,{...setup,answerFields:[...setup.answerFields],number,startedAt:now}],number};
}
// Runs as read from browser storage or a study backup.
export function cleanRuns(value:unknown):RunRecord[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<number>();
 return value.filter((r):r is RunRecord=>Boolean(r)&&typeof r==='object'&&Number.isInteger(r.number)&&r.number>0&&!seen.has(r.number)&&Boolean(seen.add(r.number))&&typeof r.model==='string'&&typeof r.prompt==='string').map(r=>({provider:String(r.provider||''),model:r.model,effort:String(r.effort||''),prompt:r.prompt,answerFields:Array.isArray(r.answerFields)?r.answerFields.filter((n:unknown)=>typeof n==='string'):[],...(cleanAnswerSettings(r.answerSettings)?{answerSettings:cleanAnswerSettings(r.answerSettings)}:{}),...(cleanRepeats(r.repeats)?{repeats:cleanRepeats(r.repeats)}:{}),...tuning(r),number:r.number,startedAt:String(r.startedAt||''),...(r.deleted?{deleted:true}:{})})).sort((a,b)=>a.number-b.number);
}

function withoutResult<T extends Row>(doc:T):T{
 const rest:Row={...doc};
 for(const key of RESULT_KEYS)delete rest[key];
 return rest as T;
}

// Make completed texts ready to annotate again. Their results move to
// `earlier`, so the new annotation is added, never substituted.
export function requeue<T extends Row>(docs:T[],runs:RunRecord[]|undefined,ids:Set<string>):{docs:T[];runs:RunRecord[];archived:number}{
 const adopted=adoptUnnumbered(docs,runs||[]);let archived=0;
 const next=adopted.docs.map(doc=>{
  if(!ids.has(doc.id)||doc.status!=='done')return doc;
  const entry:Earlier={status:'done',runNo:doc.runNo??0};
  for(const key of RESULT_KEYS)if(doc[key]!==undefined)entry[key]=doc[key];
  archived++;
  return {...withoutResult(doc),status:'pending',earlier:[...(doc.earlier||[]),entry]} as T;
 });
 return {docs:next,runs:adopted.runs,archived};
}

// The text as it stood in one run: its own fields with that run's result.
// A text the run did not annotate gets the status "absent".
export function rowForRun<T extends Row>(doc:T,run:number):T{
 if(doc.runNo===run&&doc.status!=='pending')return doc;
 const entry=[...(doc.earlier||[])].reverse().find(e=>e.runNo===run);
 return {...withoutResult(doc),...(entry||{status:'absent'}),earlier:doc.earlier} as T;
}

// Every completed result of a text: earlier runs first, then the current one.
export function completedResults(doc:Row):Earlier[]{
 const results=(doc.earlier||[]).filter(e=>e.status==='done');
 return doc.status==='done'?[...results,{...doc,runNo:doc.runNo??0} as Earlier]:results;
}

// The texts of the latest run that have fewer usable annotations than the run makes per text (some failed, or
// the run was paused). While the settings are those of that run, "Remaining" makes the missing ones.
export function resumable(docs:Row[],runs:RunRecord[]|undefined,setup:Setup):Set<string>{
 const last=(runs||[]).at(-1),ids=new Set<string>();
 if(!last||last.deleted||(setup.repeats||1)<2||!sameSetup(last,setup))return ids;
 for(const doc of docs)if(doc.runNo===last.number&&incomplete(doc)&&doc.repeats===setup.repeats)ids.add(doc.id);
 return ids;
}

// What "Remaining" annotates: the texts that are waiting or failed, and the
// completed texts that have no result made with this setup in any run. Texts
// being annotated or waiting in a batch are left out. The number of annotations
// per text is not part of the comparison; `resume` names the texts whose
// missing annotations are to be made (see `resumable`).
export function remainingFor<T extends Row>(docs:T[],setup:Setup,resume?:Set<string>):T[]{
 const fields=fieldsKey(setup),prompts=new Map<string,boolean>();
 const samePrompt=(prompt:string)=>{let same=prompts.get(prompt);if(same===undefined){same=prompt===setup.prompt;prompts.set(prompt,same);}return same;};
 const made=(result:ResultFields)=>{const s=setupOf(result);return s.provider===setup.provider&&s.model===setup.model&&s.effort===setup.effort&&fieldsKey(s)===fields&&samePrompt(s.prompt);};
 return docs.filter(doc=>doc.status==='pending'||doc.status==='error'||(doc.status==='done'&&(!completedResults(doc).some(made)||Boolean(resume?.has(doc.id)))));
}

// fewer: completed texts with fewer usable annotations than the run makes per text.
export type RunSummary=RunRecord&{done:number;failed:number;active:number;fewer:number;promptVersion:number;recorded:boolean};
// One line per run that has results (or is in progress). Settings come from
// the run's record; a run from an older study without one reads its results.
export function runSummaries(docs:Row[],runs:RunRecord[]=[]):RunSummary[]{
 const counts=new Map<number,{done:number;failed:number;active:number;fewer:number;sample?:Row|Earlier}>();
 const count=(number:number|undefined,status:string,sample:Row|Earlier)=>{
  if(number===undefined)return;
  const c=counts.get(number)||{done:0,failed:0,active:0,fewer:0};
  if(status==='done'){c.done++;if(incomplete(sample))c.fewer++;}else if(status==='error')c.failed++;else if(status==='running'||status==='queued')c.active++;else return;
  c.sample=c.sample||sample;counts.set(number,c);
 };
 for(const doc of docs){
  for(const entry of doc.earlier||[])count(entry.runNo,entry.status,entry);
  if(doc.status!=='pending')count(doc.runNo,doc.status,doc);
 }
 const records=new Map(runs.map(r=>[r.number,r]));
 const numbers=[...new Set([...counts.keys()])].sort((a,b)=>a-b);
 const prompts:string[]=[];
 const version=(prompt:string)=>{let i=prompts.indexOf(prompt);if(i<0){prompts.push(prompt);i=prompts.length-1;}return i+1;};
 // Number prompt versions over every run in order, so a deleted run does not renumber them.
 for(const run of [...runs].sort((a,b)=>a.number-b.number))version(run.prompt);
 return numbers.map(number=>{
  const c=counts.get(number)!,record=records.get(number);
  const base:RunRecord=record||{...setupOf(c.sample||{}),number,startedAt:String(c.sample?.runStartedAt||c.sample?.time||'')};
  return {...base,done:c.done,failed:c.failed,active:c.active,fewer:c.fewer,promptVersion:version(base.prompt),recorded:Boolean(record)};
 });
}

// Remove one run's results. A text whose current result goes gets its most
// recent earlier result back, or becomes ready to annotate.
export function deleteRun<T extends Row>(docs:T[],runs:RunRecord[]|undefined,run:number):{docs:T[];runs:RunRecord[]}{
 const next=docs.map(doc=>{
  const earlier=(doc.earlier||[]).filter(e=>e.runNo!==run);
  const current=doc.runNo===run&&(doc.status==='done'||doc.status==='error');
  if(!current&&earlier.length===(doc.earlier||[]).length)return doc;
  if(!current)return {...doc,earlier:earlier.length?earlier:undefined} as T;
  const restored=earlier.at(-1),rest=earlier.slice(0,-1);
  return {...withoutResult(doc),...(restored||{status:'pending'}),earlier:rest.length?rest:undefined} as T;
 });
 return {docs:next,runs:(runs||[]).map(r=>r.number===run?{...r,deleted:true}:r)};
}

// Clear results: no results or earlier runs remain on any text.
export function clearRuns<T extends Row>(doc:T):T{
 const {earlier,...rest}=withoutResult(doc);
 return {...rest,status:'pending'} as unknown as T;
}
export const earlierCount=(docs:Row[])=>docs.reduce((n,doc)=>n+(doc.earlier?.length||0),0);
