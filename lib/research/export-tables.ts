// The tables in the Export tab's files, each as rows of cells with the column names first: one run text by
// text and request by request, the runs of a study with their settings, and the corpus as it was sent.
import {answersLabel,fieldSpec,PLAIN_FIELD,type AnswerSettings} from '../answer-types';
import {fieldsOf,valueOf} from './view';
import {explanationOf,runLines,sourceOf,subjectField,subjectHeadings,uniqueNames,unitOf,type Dataset,type RunLine} from './export';
import {costOf,latencyOf,requestLines,rowForRun,shortHash,tokensOf,type ExportStudy,type RequestLine} from './export-data';
import type {Row} from './runs';
import {consistencyOf} from './repeats';
import {defaultOutputLimit} from '../request-settings';

export type Table=(string|number)[][];
const lower=(name:string)=>name.toLowerCase();
// The single score or category of a prompt without named answer fields has the column `score`.
export const fieldName=(field:string)=>field||'score';
// A name that is already a column of the table gets a prefix: an answer field answer_, a label or metadata
// column meta_, so neither hides the other.
function named(names:string[],taken:Set<string>,prefix:string):string[]{
 return names.map(name=>{let next=name;while(taken.has(lower(next)))next=prefix+next;taken.add(lower(next));return next;});
}
// What identifies a text in every table. doc_id is the Lab's own identifier, which never changes; the name can.
function identity(dataset:Dataset,short=false){
 const knowledge=dataset.kind==='knowledge',chunked=!short&&!knowledge&&dataset.rows.some(row=>row.sourceId);
 const fields=knowledge&&!short?subjectHeadings(dataset.rows).filter(heading=>dataset.rows.some(row=>subjectField(row,heading)!==String(row.name??''))):[];
 return {header:['doc_id',knowledge?'subject':'document',...(chunked?['source_document','chunk']:[]),...fields],
  cells:(row:Row):(string|number)[]=>[String(row.id),String(row.name??''),...(chunked?[String(row.sourceName??''),row.sourceId?`${row.chunkIndex} of ${row.chunkCount}`:'']:[]),...fields.map(heading=>subjectField(row,heading))]};
}

// The first 12 hexadecimal digits of each prompt's SHA-256, to tell at a glance whether two runs used the same prompt.
export async function promptHashes(dataset:Dataset):Promise<Map<string,string>>{
 const prompts=new Set<string>();
 for(const run of runLines(dataset))prompts.add(run.prompt);
 for(const line of requestLines(dataset))if(typeof line.result.prompt==='string')prompts.add(line.result.prompt);
 const hashes=new Map<string,string>();
 for(const prompt of prompts)hashes.set(prompt,await shortHash(prompt));
 return hashes;
}

// What a run did, counted from its requests. requests: total, ok, and failed count each text's last request
// in the run (with several annotations per text, the last request for each annotation); replaced counts the
// failed attempts that were sent again. Tokens and cost include those attempts.
export type RunFacts={run:RunLine;texts:number;usable:number;allFailed:number;active:number;
 requests:{total:number;ok:number;failed:number;replaced:number;first:string;last:string};
 tokens:{input:number;output:number;reasoning:number;cacheRead:number;cacheWrite:number;knownFor:number};
 cost:{amount:number;knownFor:number;of:number};models:string[];labs:string[];processing:'instant'|'batch'|'instant and batch';batchIds:string[];finished:string;webSearch:boolean;recorded:number};
export function runFacts(dataset:Dataset,run:RunLine,all:RequestLine[]=requestLines(dataset)):RunFacts{
 const lines=all.filter(line=>line.run===run.number),texts=new Set<string>(),ok=new Set<string>();
 const requests={total:0,ok:0,failed:0,replaced:0,first:'',last:''},tokens={input:0,output:0,reasoning:0,cacheRead:0,cacheWrite:0,knownFor:0},cost={amount:0,knownFor:0,of:lines.length};
 const models=new Set<string>(),labs=new Set<string>(),batchIds=new Set<string>();let instant=0,batch=0,webSearch=false,recorded=0;
 for(const {row,result,replaced} of lines){
  texts.add(row.id);
  if(replaced)requests.replaced++;else{requests.total++;if(result.status==='done'){requests.ok++;ok.add(row.id);}else requests.failed++;}
  const started=String(result.startedAt||''),done=String(result.time||'');
  if(started&&(!requests.first||started<requests.first))requests.first=started;
  if(done&&done>requests.last)requests.last=done;
  const used=tokensOf(result);
  if(used.input!==''){tokens.knownFor++;tokens.input+=used.input;tokens.output+=Number(used.output)||0;tokens.reasoning+=Number(used.reasoning)||0;tokens.cacheRead+=Number(used.cacheRead)||0;tokens.cacheWrite+=Number(used.cacheWrite)||0;}
  const charge=costOf(result);if(charge!==''){cost.amount+=charge;cost.knownFor++;}
  if(result.status==='done'&&result.modelReported)models.add(String(result.modelReported));
  if(result.lab)labs.add(String(result.lab));
  if(result.processing==='batch'){batch++;if(result.batchId)batchIds.add(String(result.batchId));}else instant++;
  if(result.webSearch)webSearch=true;
  if(result.requestId)recorded++;
 }
 return {run,texts:texts.size+run.active,usable:ok.size,allFailed:texts.size-ok.size,active:run.active,requests,tokens,cost:{...cost,amount:Number(cost.amount.toFixed(6))},models:[...models],labs:[...labs],
  processing:batch&&instant?'instant and batch':batch?'batch':'instant',batchIds:[...batchIds],finished:run.active?'':requests.last,webSearch,recorded};
}

// One row per text of a run: its answers, then its labels and metadata. A text is in the run when the run
// sent a request for it; a text whose requests all failed has empty answers. In a run that makes several
// annotations per text the answers are the combined ones, and each answer with a share has a column
// <field>_replicate_agreement after it: the share of the text's annotations that gave the combined value.
export function resultsTable(study:ExportStudy,run:number,options:{texts?:Map<string,string>;explanation?:boolean}={}):Table{
 const {dataset}=study,counts=new Map<string,[number,number]>();
 for(const line of requestLines(dataset))if(line.run===run){const count=counts.get(line.row.id)||[0,0];count[line.result.status==='done'?0:1]++;counts.set(line.row.id,count);}
 const rows=dataset.rows.filter(row=>counts.has(row.id)),results=rows.map(row=>rowForRun(row,run)),lead=identity(dataset);
 const fields=fieldsOf(results),explained=options.explanation!==false&&results.some(result=>result.status==='done'&&explanationOf(result));
 const shared=new Set(fields.filter(field=>results.some(result=>result.status==='done'&&consistencyOf(result,field)!==undefined)));
 const taken=new Set([...lead.header,...(options.texts?['text']:[]),...(explained?['explanation']:[]),'n_ok','n_error'].map(lower));
 const names=named(fields.map(fieldName),taken,'answer_'),shares=named(fields.filter(field=>shared.has(field)).map(field=>fieldName(field)+'_replicate_agreement'),taken,'answer_');
 const header=[...lead.header,...(options.texts?['text']:[]),...fields.flatMap((field,f)=>[names[f],...(shared.has(field)?[shares.shift()!]:[])]),...(explained?['explanation']:[]),...named(dataset.columns.map(column=>column.name),taken,'meta_'),'n_ok','n_error'];
 const share=(result:Row,field:string):number|''=>{const value=result.status==='done'?consistencyOf(result,field):undefined;return value===undefined?'':Math.round(value*1000)/1000;};
 return [uniqueNames(header),...rows.map((row,i)=>{
  const result=results[i],done=result.status==='done',[ok,failed]=counts.get(row.id)!;
  return [...lead.cells(row),...(options.texts?[options.texts.get(row.id)??'']:[]),...fields.flatMap(field=>[done?valueOf(result,field):'',...(shared.has(field)?[share(result,field)]:[])]),...(explained?[done?explanationOf(result):'']:[]),...dataset.columns.map((_,c)=>row.cells?.[c]??''),ok,failed];
 })];
}

// One row per request, in the order of the runs and, within a run, of the texts. A failed request has no
// answers, so a table of requests cannot be averaged with them by mistake; a plain-text run keeps the reply.
// replicate: which of the text's annotations in the run the request is for (1 when the run makes one per
// text). sent_again marks a failed attempt that was queued again (the request that followed it has the next
// attempt number of the same replicate).
export function requestsTable(study:ExportStudy,runs:number[]|undefined,hashes:Map<string,string>,options:{explanation?:boolean;reasoning?:boolean}={}):Table{
 const {dataset}=study,knowledge=dataset.kind==='knowledge',lead=identity(dataset,true);
 const lines=requestLines(dataset).filter(line=>!runs||runs.includes(line.run)).map((line,i)=>({line,i})).sort((a,b)=>a.line.run-b.line.run||a.i-b.i).map(entry=>entry.line);
 const versions=new Map(runLines(dataset).map(run=>[run.number,run.promptVersion]));
 const fields=fieldsOf(lines.map(line=>line.result)),explained=options.explanation!==false&&lines.some(line=>line.result.status==='done'&&explanationOf(line.result));
 // The summary of the model's reasoning, where a run asked for one (a failed request may have one too).
 const summaryOf=(result:Row)=>typeof result.reasoningSummary==='string'?result.reasoningSummary:'',reasoned=options.reasoning!==false&&lines.some(line=>summaryOf(line.result));
 const before=['study','data','run','prompt_version','prompt_hash','provider','model_requested','model_reported','reasoning_effort',...lead.header,'replicate','attempt','status','sent_again'];
 const after=['error','stop_reason','input_tokens','output_tokens','reasoning_tokens','cache_read_tokens','cache_write_tokens','cost_usd','processing','prompt_caching',...(knowledge?['web_search']:[]),'latency_ms','requested_at','completed_at','response_id','batch_id','request_id','lab_version'];
 const prose=[...(explained?['explanation']:[]),...(reasoned?['reasoning_summary']:[])];
 const taken=new Set([...before,...prose,...after].map(lower));
 const header=[...before,...named(fields.map(fieldName),taken,'answer_'),...prose,...after];
 return [header,...lines.map(({row,run,replicate,attempt,result,replaced})=>{
  const done=result.status==='done',used=tokensOf(result);
  // The reply of a plain-text run is kept for a failed request too (a reply that could not be read as JSON, say).
  const value=(field:string)=>done?valueOf(result,field):field===PLAIN_FIELD&&result.answerSettings?.plain?String(result.rawResponse??result.output??result.answers?.f0??''):'';
  return [study.name,sourceOf(dataset),run,versions.get(run)??'',hashes.get(String(result.prompt??''))??'',String(result.provider??''),String(result.model??''),String(result.modelReported??''),String(result.effort??''),...lead.cells(row),replicate,attempt,done?'ok':'error',replaced?'yes':'',
   ...fields.map(value),...(explained?[done?explanationOf(result):'']:[]),...(reasoned?[summaryOf(result)]:[]),
   done?'':String(result.error??''),String(result.stopReason??''),used.input,used.output,used.reasoning,used.cacheRead,used.cacheWrite,costOf(result),result.processing==='batch'?'batch':'instant',result.requestSettings?.cache?'on':'off',...(knowledge?[result.webSearch?'yes':'no']:[]),
   latencyOf(result),String(result.startedAt??''),String(result.time??''),String(result.responseId??''),String(result.batchId??''),String(result.requestId??''),String(result.lab??'')];
 })];
}

// One row per run, with its settings, counts, tokens, cost, and full prompt.
export function runsOverview(study:ExportStudy,hashes:Map<string,string>):Table{
 const {dataset}=study,knowledge=dataset.kind==='knowledge',unit=unitOf(dataset),lines=requestLines(dataset);
 const header=['run','data','started_at','finished_at','status','processing','batch_ids','n_'+unit+'s','n_'+unit+'s_with_usable_answer','annotations_per_'+unit,'requests_ok','requests_failed','requests_replaced_by_retries','provider','model_requested','models_reported','reasoning_effort','reasoning_summary_requested','temperature','max_output_tokens',...(knowledge?['web_search']:[]),'prompt_caching','prompt_version','prompt_hash','answer_fields','answer_format','input_tokens','output_tokens','reasoning_tokens','cache_read_tokens','cache_write_tokens','cost_usd','cost_known_for','lab_versions','settings','prompt'];
 return [header,...runLines(dataset).map(run=>{
  const facts=runFacts(dataset,run,lines),known=facts.tokens.knownFor>0,sum=(n:number)=>known?n:'';
  return [run.number,sourceOf(dataset),run.startedAt,facts.finished,run.active?'in progress':'finished',facts.processing,facts.batchIds.join('; '),facts.texts,facts.usable,run.repeats||1,facts.requests.ok,facts.requests.failed,facts.requests.replaced,run.provider,run.model,facts.models.join('; '),run.effort,run.summary==='on'?'yes':run.summary==='off'?'no':'in part',run.temperature??'default',run.maxOutput??defaultOutputLimit(run.provider,run.model),...(knowledge?[run.webSearch?'yes':'no']:[]),run.caching,run.promptVersion,hashes.get(run.prompt)??'',run.answerFields.join(' | '),answersLabel(run.answerFields,run.answerSettings,true),
   sum(facts.tokens.input),sum(facts.tokens.output),sum(facts.tokens.reasoning),sum(facts.tokens.cacheRead),sum(facts.tokens.cacheWrite),facts.cost.knownFor?facts.cost.amount:'',`${facts.cost.knownFor} of ${facts.cost.of}`,facts.labs.join('; '),run.mixed?'vary within this run; see the table of requests':run.recorded?'recorded when the run started':'read from the run’s results',run.prompt];
 })];
}

// The corpus: one row per text, with the text as it was sent. A PDF is sent as a file, so it has no text here;
// `file` then names the PDF in the package. filename is the name each request gave for the document.
function corpusHeader(dataset:Dataset,withFiles:boolean){
 const lead=identity(dataset),uploaded=dataset.kind==='texts';
 const taken=new Set([...lead.header,'filename','text','n_characters','file'].map(lower));
 return {lead,uploaded,header:uniqueNames([...lead.header,...(uploaded?['filename']:[]),'text','n_characters',...(withFiles?['file']:[]),...named(dataset.columns.map(column=>column.name),taken,'meta_')])};
}
// The names the corpus table gives the study's label and metadata columns, in the columns' order.
export const corpusColumnNames=(dataset:Dataset):string[]=>dataset.columns.length?corpusHeader(dataset,false).header.slice(-dataset.columns.length):[];
export function corpusTable(dataset:Dataset,rows:Row[],texts:Map<string,string>,files:Map<string,string>):Table{
 const {lead,uploaded,header}=corpusHeader(dataset,files.size>0);
 return [header,...rows.map(row=>{
  const text=texts.get(row.id);
  return [...lead.cells(row),...(uploaded?[String(row.file?.name??row.name??'')]:[]),text??'',text===undefined?'':text.length,...(files.size?[files.get(row.id)??'']:[]),...dataset.columns.map((_,c)=>row.cells?.[c]??'')];
 })];
}
// The same corpus as JSON Lines, for software that reads one record per line.
export function corpusRecords(dataset:Dataset,rows:Row[],texts:Map<string,string>,files:Map<string,string>):Record<string,unknown>[]{
 const knowledge=dataset.kind==='knowledge';
 return rows.map(row=>({doc_id:String(row.id),[knowledge?'subject':'document']:String(row.name??''),...(knowledge?{fields:row.fields||[]}:{filename:String(row.file?.name??row.name??''),...(row.sourceId?{source_document:String(row.sourceName??''),chunk:`${row.chunkIndex} of ${row.chunkCount}`}:{})}),
  text:texts.get(row.id)??null,...(files.has(row.id)?{file:files.get(row.id)}:{}),columns:Object.fromEntries(dataset.columns.map((column,c)=>[column.name,row.cells?.[c]??'']))}));
}

// The answer fields of a run as a page of Markdown: what the model had to return, and where each answer is found.
export function codebook(answerFields:string[],settings:AnswerSettings|undefined,knowledge:boolean):string{
 if(settings?.plain)return '# Answer fields\n\nThe model was asked for a free-text reply: there were no answer fields and no answer format. The whole reply is stored as `response`; a reply that is one JSON object also has a column for each of its values.\n';
 const escape=(text:string)=>text.replace(/\|/g,'\\|').replace(/\s*\n\s*/g,' ');
 const types={category:'category',ordinal:'ordinal scale',number:'number',boolean:'yes / no',text:'free text'} as const;
 const lines=['# Answer fields','','The model had to return these fields as JSON that follows a schema (structured output; see `output_schema.json`). The Lab sends each named field under a short key (f0, f1, …) and stores the answer under the field’s name.','','| Field | Column | Key in the schema | Type | Allowed values | Description |','|---|---|---|---|---|---|'];
 if(!answerFields.length)lines.push('| Score / category | score | score | text | as the prompt defines | The final score or category |');
 answerFields.forEach((name,i)=>{
  const spec=fieldSpec(settings,name);
  lines.push(`| ${escape(name)} | ${escape(name)} | answers.f${i} | ${spec?types[spec.type]:'text'} | ${spec?escape((spec.type==='boolean'?['yes','no']:spec.values).join(', ')):'as the prompt defines'} | ${escape(spec?.description||'')} |`);
 });
 if(!answerFields.some(name=>lower(name)==='explanation'))lines.push(settings?.rationale===false?'| Explanation | (none) | explanation | | | No explanation was requested; the key is returned empty |':'| Explanation | explanation | explanation | free text | | One explanation of the answers, written before them |');
 lines.push('','A field named like one of a table’s own columns (status, error, …) is written there as `answer_<name>`.');
 if(knowledge)lines.push('','Model knowledge: each field also accepts INSUFFICIENT_KNOWLEDGE, for a judgment the model cannot make reliably.');
 return lines.join('\n')+'\n';
}
