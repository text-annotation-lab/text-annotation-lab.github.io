// Tables for the Export tab and the list of runs. A dataset is either the
// uploaded texts or the Model knowledge subjects, read the same way.
import {recordedCost} from '../cost-estimate/run-cost';
import {rowForRun,runSummaries,setupOf,sameSetup,type Row,type RunRecord,type RunSummary} from './runs';
import {requestsOf} from './repeats';
import type {Column} from './columns';
import {fieldsOf,valueOf} from './view';
import {sampleNote,type SampleRecord} from './sample';

export type Dataset={kind:'texts'|'knowledge';rows:Row[];runs:RunRecord[];columns:Column[];samples:SampleRecord[]};
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
function leading(dataset:Dataset){
 const chunked=dataset.kind==='texts'&&dataset.rows.some(row=>row.sourceId),fields=dataset.kind==='knowledge'?subjectHeadings(dataset.rows).filter(heading=>dataset.rows.some(row=>subjectField(row,heading)!==String(row.name??''))):[];
 const header=[dataset.kind==='knowledge'?'subject':'document',...(chunked?['source_document','chunk']:[]),...fields,...dataset.columns.map(column=>column.name)];
 const cells=(row:Row)=>[String(row.name??''),...(chunked?[String(row.sourceName??''),row.sourceId?`${row.chunkIndex} of ${row.chunkCount}`:'']:[]),...fields.map(heading=>subjectField(row,heading)),...dataset.columns.map((_,i)=>row.cells?.[i]??'')];
 return {header,cells};
}
// One row per text: its labels and metadata, then every run's answers side by side.
export function wideTable(dataset:Dataset):(string|number)[][]{
 const lead=leading(dataset),runs=runSummaries(dataset.rows,dataset.runs);
 const plan=runs.map(run=>{
  const results=dataset.rows.map(row=>rowForRun(row,run.number));
  return {run:run.number,results,fields:fieldsOf(results),explanation:results.some(result=>result.status==='done'&&explanationOf(result))};
 });
 const header=uniqueNames([...lead.header,...plan.flatMap(p=>[...p.fields.map(field=>`run${p.run}_${field||'score'}`),...(p.explanation?[`run${p.run}_explanation`]:[])])]);
 return [header,...dataset.rows.map((row,i)=>[...lead.cells(row),...plan.flatMap(p=>{
  const result=p.results[i],done=result.status==='done';
  return [...p.fields.map(field=>done?valueOf(result,field):''),...(p.explanation?[done?explanationOf(result):'']:[])];
 })])];
}
export function samplesTable(samples:SampleRecord[]):(string|number)[][]{
 return [['column','value','drawn_on','size','eligible','seed','stratified_by','allocation','excluded','method','note'],...samples.map(s=>[s.column,s.value,s.date,s.size,s.eligible,s.seed,s.strata.join(' × '),s.allocation.map(a=>`${a.stratum}: ${a.drawn} of ${a.available}`).join('; '),s.exclude?`${s.exclude.column} = ${s.exclude.value}`:'',s.method,sampleNote(s)])];
}
export const fileStem=(studyName:string|undefined,dataset:{kind:string})=>((studyName||'annotations').trim().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,60)||'annotations')+(dataset.kind==='knowledge'?'-model-knowledge':'');
