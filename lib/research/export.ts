// Tables for the Export tab and the list of runs. A dataset is either the
// uploaded texts or the Model knowledge subjects, read the same way.
import {recordedCost} from '../cost-estimate/run-cost';
import {rowForRun,runSummaries,setupOf,sameSetup,type Row,type RunRecord,type RunSummary} from './runs';
import {requestsOf} from './repeats';
import type {Column} from './columns';
import type {SampleRecord} from './sample';
import type {ScoreScale} from './score-scale';

// scoreScale: the study's scale for the scores of plain-text replies that are JSON (see score-scale.ts).
export type Dataset={kind:'texts'|'knowledge';rows:Row[];runs:RunRecord[];columns:Column[];samples:SampleRecord[];scoreScale?:ScoreScale};
export const unitOf=(dataset:{kind:string})=>dataset.kind==='knowledge'?'subject':'text';
export const sourceOf=(dataset:{kind:string})=>dataset.kind==='knowledge'?'model knowledge (no texts supplied)':'uploaded texts';

// caching: whether the run's results were made with prompt caching (all, none, or some of them). summary: the
// same for a requested summary of the model's reasoning.
export type Share='on'|'off'|'in part';
export type RunLine=RunSummary&{cost:number;costKnown:number;costCount:number;mixed:boolean;webSearch:boolean;caching:Share;summary:Share};
// One line per run: its settings, how many texts it covers, and what it cost.
export function runLines(dataset:Dataset):RunLine[]{
 return runSummaries(dataset.rows,dataset.runs).map(run=>{
  let cost=0,costKnown=0,costCount=0,mixed=false,webSearch=false,cached=0,summarized=0,started=0;const share=(n:number):Share=>!n?'off':n===started?'on':'in part';
  for(const row of dataset.rows){
   const result=rowForRun(row,run.number);
   // A text waiting in a batch already carries the settings it was sent with.
   if(result.status==='queued'||result.status==='running'){started++;if(result.requestSettings?.cache)cached++;if(result.requestSettings?.summary)summarized++;}
   if(result.status!=='done'&&result.status!=='error')continue;
   started++;
   // A result made of several annotations cost what its annotations cost.
   for(const request of requestsOf(result)){costCount++;const charge=recordedCost(request.result as any);if(charge){cost+=charge.amount;costKnown++;}}
   if(result.webSearch)webSearch=true;
   if(result.requestSettings?.cache)cached++;
   if(result.requestSettings?.summary)summarized++;
   // A run without a record of its own (Model knowledge) may hold results made with different settings.
   if(!run.recorded&&result.prompt!==undefined&&!sameSetup(setupOf(result),run))mixed=true;
  }
  return {...run,cost,costKnown,costCount,mixed,webSearch,caching:share(cached),summary:share(summarized)};
 });
}
export const explanationOf=(row:Row)=>{const text=String(row.explanation??'').trim();return text&&!Object.values(row.answers||{}).some(value=>String(value).trim()===text)?text:'';};
export const subjectHeadings=(rows:Row[])=>{const names:string[]=[];for(const row of rows)for(const field of row.fields||[])if(field?.heading&&!names.includes(field.heading))names.push(field.heading);return names;};
export const subjectField=(row:Row,heading:string)=>String((row.fields||[]).find((field:any)=>field?.heading===heading)?.value??'');
// Column names stay unique when an imported column shares a name with one of
// the Lab's own (a second `year` becomes `year_2`).
export function uniqueNames(names:string[]):string[]{
 const seen=new Set<string>();
 return names.map(name=>{let next=name,n=1;while(seen.has(next.toLowerCase()))next=`${name}_${++n}`;seen.add(next.toLowerCase());return next;});
}
// doc_id, the key that joins the tables, also fills in {{id}}: see lib/research/columns.ts.
export {docIds,docIdOf} from './columns';
// A study's or run's name for a file or folder: lower case, accents dropped, words joined by hyphens, at most 48
// characters (“Villains: Pilot 2” → villains-pilot-2).
export const slugName=(name:string)=>name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g,'').trim().replace(/[\s_-]+/g,'-').slice(0,48);
// The start of the Export tab's file names (Model knowledge's add -model-knowledge), and the date in them (20261116).
export const exportStem=(studyName:string|undefined,dataset:{kind:string})=>(slugName(studyName||'')||'study')+(dataset.kind==='knowledge'?'-model-knowledge':'');
export const dateStamp=(date:Date)=>date.toISOString().slice(0,10).replace(/-/g,'');
