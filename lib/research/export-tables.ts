// The tables in the Export tab's files, each as rows of cells with the column names first: one run text by
// text and request by request, the runs of a study with their settings, and the corpus as it was sent.
// Every table puts the common layout first (doc_id names the text; each answer field has a column under its
// key; a field or value named like one of the tables' own columns is written as answer_<name>), and the
// columns only the Lab has after all the others.
import {fieldSpec,isExplanationField,slugKey,wireKeys,RATIONALE_KEY,PLAIN_FIELD,type AnswerSettings} from '../answer-types';
import {fieldsOf,valueOf} from './view';
import {docIdOf,docIds,explanationOf,runLines,subjectField,subjectHeadings,uniqueNames,type Dataset,type RunLine} from './export';
import {costOf,latencyOf,requestLines,rowForRun,shortHash,tokensOf,type ExportStudy,type RequestLine} from './export-data';
import {promptKey,setupOf,type Row} from './runs';
import {removedOn} from './removed';
import {consistencyOf} from './repeats';
import {budgetedClaude,defaultOutputLimit} from '../request-settings';

export type Table=(string|number)[][];
const lower=(name:string)=>name.toLowerCase();
// The single score or category of a prompt without named answer fields has the column `score`.
export const fieldName=(field:string)=>field||'score';
// A name that is already a column of the table gets a prefix: an answer field answer_, a label or metadata
// column meta_, so neither hides the other.
function named(names:string[],taken:Set<string>,prefix:string):string[]{
 return names.map(name=>{let next=name;while(taken.has(lower(next)))next=prefix+next;taken.add(lower(next));return next;});
}
// The tables' own columns, the same in every table: an answer field or a JSON value with one of these names is
// written as answer_<name>.
const OWN_COLUMNS=['doc_id','file','text','study','run','run_label','prompt_version','prompt_hash','provider','model_requested','model_reported','replicate','status','rationale','reasoning_summary','parse_error','error','stop_reason','input_tokens','output_tokens','reasoning_tokens','cache_read_tokens','cache_write_tokens','latency_ms','requested_at','completed_at','response_id','n_ok','n_error'];

export {docIdOf,docIds};
// The file name each request gave for a text (a text from a table or pasted is named after its ID).
export const sourceName=(dataset:Dataset,row:Row)=>dataset.kind==='knowledge'?'':String(row.name??row.file?.name??'');
// The columns only the Lab has about a text: a subject's name and the fields the model saw (Model knowledge),
// and, for a part of a text that was split, the text it comes from and which part it is.
function textExtras(dataset:Dataset){
 const knowledge=dataset.kind==='knowledge',chunked=!knowledge&&dataset.rows.some(row=>row.sourceId);
 const fields=knowledge?subjectHeadings(dataset.rows).filter(heading=>dataset.rows.some(row=>subjectField(row,heading)!==String(row.name??''))):[];
 return {header:[...(knowledge?['subject']:[]),...(chunked?['source_document','chunk']:[]),...fields],
  cells:(row:Row):(string|number)[]=>[...(knowledge?[String(row.name??'')]:[]),...(chunked?[String(row.sourceName??''),row.sourceId?`${row.chunkIndex} of ${row.chunkCount}`:'']:[]),...fields.map(heading=>subjectField(row,heading))]};
}

// The column of each field. A named answer field goes under its key: the name in lower case with _ between
// words (Word count → word_count), never `rationale` (rationale_field), and _2, _3, … for a key another field
// has. The single score is `score`; a plain-text reply is `response`, and each value of a reply that is JSON
// keeps its own name. A field or value named like one of the tables' own columns gets answer_ before it.
export function fieldKeys(fields:string[],answerFields:Set<string>):string[]{
 const keys:string[]=[];
 return fields.map(field=>{
  if(!field)return 'score';
  if(field===PLAIN_FIELD&&!answerFields.has(field))return field;
  if(!answerFields.has(field))return OWN_COLUMNS.includes(field)?'answer_'+field:field;
  let key=slugKey(field);if(key===RATIONALE_KEY)key+='_field';
  const base=key;for(let n=2;keys.includes(key);n++)key=base+'_'+n;
  keys.push(key);return OWN_COLUMNS.includes(key)?'answer_'+key:key;
 });
}
// The answer fields of a set of results with their columns, each <field>_explanation (or _reasoning) right after
// its own field, as the tables show them.
function fieldPlan(results:Row[]){
 const fields=fieldsOf(results),answerFields=new Set(results.flatMap(result=>result.status==='done'&&!result.answerSettings?.plain?result.answerFields||[]:[]));
 const keys=fieldKeys(fields,answerFields),scoreOf=new Map<string,string>();
 for(const key of keys)for(const suffix of ['_explanation','_reasoning']){const base=key.endsWith(suffix)?key.slice(0,-suffix.length):'';if(base&&keys.includes(base))scoreOf.set(key,base);}
 for(const [key,base] of [...scoreOf])if(scoreOf.has(base))scoreOf.delete(key);
 const order:number[]=[];
 keys.forEach((key,i)=>{if(scoreOf.has(key))return;order.push(i);keys.forEach((other,j)=>{if(scoreOf.get(other)===key)order.push(j);});});
 return order.map(i=>({field:fields[i],key:keys[i]}));
}
// The shared explanation, written before the answers: asked for unless the run sent plain text, asked for no
// explanation, or has an answer field named Explanation.
const asksRationale=(result:Row)=>!result.answerSettings?.plain&&result.answerSettings?.rationale!==false&&!(result.answerFields||[]).some(isExplanationField);
// Why a request failed: error (the request failed, or the reply was cut off, refused, or empty) or parse_error
// (a complete reply that could not be read as the answers asked for).
const NORMAL_STOP=/^(end_turn|stop_sequence|stop|completed|tool_use)$/i;
const READING=/^(The response has an invalid answer format|The answer for “|Invalid answer for “|The reply contains JSON that could not be read|The response is missing its explanation|Unexpected response format|(Claude|Gemini|OpenRouter) returned an unexpected annotation format)/;
export function failureOf(result:Row):{error:string;parseError:string}{
 if(result.status==='done')return {error:'',parseError:''};
 const message=String(result.error??''),stop=String(result.stopReason??'');
 return READING.test(message)&&(!stop||NORMAL_STOP.test(stop))?{error:'',parseError:message}:{error:message,parseError:''};
}
// How a run's model was asked to think, where the provider has a setting of its own for it (Claude).
export function thinkingOf(run:{provider?:string;model?:string;effort?:string;summary?:string}):string{
 if(run.provider!=='anthropic')return '';
 const summary=run.summary==='on'?', summary recorded':run.summary==='in part'?', summary recorded for part of the run':'';
 if(!budgetedClaude(String(run.model??'')))return 'adaptive (on)'+summary;
 return run.effort==='off'?'off':`enabled (budget of ${run.effort} tokens)${summary}`;
}
export const modeOf=(processing:string)=>processing==='batch'?'batch':processing==='instant'?'sync':'sync and batch';

// The first 12 hexadecimal digits of each prompt's SHA-256, to tell at a glance whether two runs used the same prompt.
// A prompt sent with a system prompt of one's own is hashed with it (promptKey in runs.ts); look a hash up with
// hashOf.
export const hashOf=(hashes:Map<string,string>,prompt:string,system?:string)=>hashes.get(promptKey(prompt,system))??'';
export async function promptHashes(dataset:Dataset):Promise<Map<string,string>>{
 const prompts=new Set<string>();
 for(const run of runLines(dataset))prompts.add(promptKey(run.prompt,run.system));
 for(const line of requestLines(dataset))if(typeof line.result.prompt==='string')prompts.add(promptKey(line.result.prompt,setupOf(line.result).system));
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

// One row per text of a run: doc_id, its answers (in a run that makes several annotations per text, the
// combined ones, each with a share where it has one: <field>_replicate_agreement, the share of the text's
// annotations that gave the combined value), the explanation, its labels and metadata, and the counts of usable
// and failed requests; then the reply of a plain-text run that answered in JSON (its values come first), the
// text where asked for, and the columns only the Lab has. A text is in the run when the run sent a request
// for it; a text whose requests all failed has empty answers.
// columns: the places in dataset.columns of the label and metadata columns to include (all by default).
export function resultsTable(study:ExportStudy,run:number,options:{texts?:Map<string,string>;explanation?:boolean;columns?:number[]}={}):Table{
 const {dataset}=study,counts=new Map<string,[number,number]>();
 for(const line of requestLines(dataset))if(line.run===run){const count=counts.get(line.row.id)||[0,0];count[line.result.status==='done'?0:1]++;counts.set(line.row.id,count);}
 const rows=dataset.rows.filter(row=>counts.has(row.id)),results=rows.map(row=>rowForRun(row,run)),extra=textExtras(dataset);
 const plan=fieldPlan(results),done=results.filter(result=>result.status==='done');
 const json=done.some(result=>result.answerSettings?.plain)&&plan.some(p=>p.field!==PLAIN_FIELD),reply=json?plan.find(p=>p.field===PLAIN_FIELD):undefined,middle=plan.filter(p=>p!==reply);
 const rationale=options.explanation!==false&&done.some(asksRationale);
 const shared=new Set(middle.filter(p=>done.some(result=>consistencyOf(result,p.field)!==undefined)).map(p=>p.field));
 const taken=new Set(['doc_id','text','n_ok','n_error',...(rationale?['rationale']:[]),...(reply?[PLAIN_FIELD]:[]),...middle.flatMap(p=>[p.key,...(shared.has(p.field)?[p.key+'_replicate_agreement']:[])]),...extra.header].map(lower));
 const kept=options.columns?dataset.columns.map((_,c)=>c).filter(c=>options.columns!.includes(c)):dataset.columns.map((_,c)=>c);
 const meta=named(dataset.columns.map(column=>column.name),taken,'meta_').filter((_,c)=>kept.includes(c));
 const header=['doc_id',...middle.flatMap(p=>[p.key,...(shared.has(p.field)?[p.key+'_replicate_agreement']:[])]),...(rationale?['rationale']:[]),...meta,'n_ok','n_error',...(reply?[PLAIN_FIELD]:[]),...(options.texts?['text']:[]),...extra.header];
 const share=(result:Row,field:string):number|''=>{const value=result.status==='done'?consistencyOf(result,field):undefined;return value===undefined?'':Math.round(value*1000)/1000;};
 return [uniqueNames(header),...rows.map((row,i)=>{
  const result=results[i],ok=result.status==='done',[usable,failed]=counts.get(row.id)!;
  return [docIdOf(dataset,row),...middle.flatMap(p=>[ok?valueOf(result,p.field):'',...(shared.has(p.field)?[share(result,p.field)]:[])]),...(rationale?[ok?explanationOf(result):'']:[]),...kept.map(c=>row.cells?.[c]??''),usable,failed,
   ...(reply?[ok?valueOf(result,PLAIN_FIELD):'']:[]),...(options.texts?[options.texts.get(row.id)??'']:[]),...extra.cells(row)];
 })];
}

// One row per request (text × replicate), in the order of the runs and, within a run, of the texts. A failed
// attempt that Retry failed replaced is not a row: runs.csv counts those, and the logs keep them. A failed request
// has no answers, so a table of requests cannot be averaged with them by mistake; a plain-text run keeps the reply.
// replicate: which of the text's annotations in the run the request is for (1 when the run makes one per text).
// Model knowledge adds web_search at the end.
export function requestsTable(study:ExportStudy,runs:number[]|undefined,hashes:Map<string,string>,options:{explanation?:boolean;reasoning?:boolean}={}):Table{
 const {dataset}=study,knowledge=dataset.kind==='knowledge';
 const lines=requestLines(dataset).filter(line=>!line.replaced&&(!runs||runs.includes(line.run))).map((line,i)=>({line,i})).sort((a,b)=>a.line.run-b.line.run||a.i-b.i).map(entry=>entry.line);
 const byNumber=new Map(runLines(dataset).map(run=>[run.number,run]));
 // Within the fields, a plain-text reply comes before the values of its JSON.
 const plan=fieldPlan(lines.map(line=>line.result)),reply=plan.filter(p=>p.field===PLAIN_FIELD),fields=[...reply,...plan.filter(p=>p.field!==PLAIN_FIELD)];
 const rationale=options.explanation!==false,reasoning=options.reasoning!==false;
 const summaryOf=(result:Row)=>typeof result.reasoningSummary==='string'?result.reasoningSummary:'';
 const header=['study','run','run_label','prompt_version','prompt_hash','provider','model_requested','model_reported','doc_id','replicate','status',...fields.map(p=>p.key),...(rationale?['rationale']:[]),...(reasoning?['reasoning_summary']:[]),
  'parse_error','error','stop_reason','input_tokens','output_tokens','reasoning_tokens','cache_read_tokens','cache_write_tokens','latency_ms','requested_at','completed_at','response_id',
  ...(knowledge?['web_search']:[])];
 return [uniqueNames(header),...lines.map(({row,run,replicate,result})=>{
  const done=result.status==='done',used=tokensOf(result),failure=failureOf(result),line=byNumber.get(run);
  // The reply of a plain-text run is kept for a failed request too (a reply that could not be read as JSON, say).
  const value=(field:string)=>done?valueOf(result,field):field===PLAIN_FIELD&&result.answerSettings?.plain?String(result.rawResponse??result.output??result.answers?.f0??''):'';
  return [study.name,run,line?.label??'',line?.promptVersion??'',hashOf(hashes,String(result.prompt??''),setupOf(result).system),String(result.provider??''),String(result.model??''),String(result.modelReported??''),docIdOf(dataset,row),replicate,done?'ok':'error',
   ...fields.map(p=>value(p.field)),...(rationale?[done?explanationOf(result):'']:[]),...(reasoning?[summaryOf(result)]:[]),
   failure.parseError,failure.error,String(result.stopReason??''),used.input,used.output,used.reasoning,used.cacheRead,used.cacheWrite,latencyOf(result),String(result.startedAt??''),String(result.time??''),String(result.responseId??''),
   ...(knowledge?[result.webSearch?'yes':'no']:[])];
 })];
}

// One row per run, with its settings, counts, and tokens (Model knowledge adds web_search at the end); a column no
// run has a value in is left out.
export function runsOverview(study:ExportStudy,hashes:Map<string,string>):Table{
 const {dataset}=study,knowledge=dataset.kind==='knowledge',lines=requestLines(dataset);
 const header=['run','label','started_at','finished_at','status','mode','batch_id','scope','n_texts','replicates','requests_ok','requests_failed','requests_retried','requests_replaced_by_retries','provider','model_requested','models_reported','effort','thinking','temperature','max_output_tokens','caching','prompt_version','prompt_hash','input_tokens','output_tokens','reasoning_tokens','cache_read_tokens','cache_write_tokens','error','notes',
  ...(knowledge?['web_search']:[])];
 return withoutBlankColumns([header,...runLines(dataset).map(run=>{
  const facts=runFacts(dataset,run,lines),known=facts.tokens.knownFor>0,sum=(n:number)=>known?n:'';
  const notes=run.mixed?'Settings vary within this run; see the table of requests.':run.recorded?'':'Settings read from the run’s results (the run has no record of its own).';
  return [run.number,run.label??'',run.startedAt,facts.finished,run.active?(facts.processing==='instant'?'running':'submitted'):'completed',modeOf(facts.processing),facts.batchIds.join('; '),run.scope??'',facts.texts,run.repeats||1,facts.requests.ok,facts.requests.failed,facts.requests.replaced,facts.requests.replaced,
   run.provider,run.model,facts.models.join('; '),run.effort||'default',thinkingOf(run),run.temperature??'default',run.maxOutput??defaultOutputLimit(run.provider,run.model,run.startedAt),run.caching,run.promptVersion,hashOf(hashes,run.prompt,run.system),
   sum(facts.tokens.input),sum(facts.tokens.output),sum(facts.tokens.reasoning),sum(facts.tokens.cacheRead),sum(facts.tokens.cacheWrite),'',notes,
   ...(knowledge?[run.webSearch?'yes':'no']:[])];
 })]);
}
// A table without the columns that no row has a value in (a label, batch ID, scope, or note no run has).
export function withoutBlankColumns(table:Table):Table{
 const keep=table[0].map((_,i)=>i).filter(i=>table.slice(1).some(row=>row[i]!==''&&row[i]!==null&&row[i]!==undefined));
 return table.map(row=>keep.map(i=>row[i]));
}

// The corpus: one row per text, with the text as it was sent, its length, the name each request gave for it
// (source), the date it was deleted from the study where it was (kept for the runs that used it; only when the
// study has such texts), and its labels and metadata; then the columns only the Lab has, and `file`, the path
// of a PDF in the package (a PDF is sent as a file, so it has no text here).
function corpusHeader(dataset:Dataset,withFiles:boolean,kept:number[]=dataset.columns.map((_,c)=>c),source=true){
 const extra=textExtras(dataset),removed=dataset.rows.some(row=>row.removedAt);
 const taken=new Set(['doc_id','text','n_characters','source','removed_from_study',...extra.header,...(withFiles?['file']:[])].map(lower));
 return {extra,removed,header:uniqueNames(['doc_id','text','n_characters',...(source?['source']:[]),...(removed?['removed_from_study']:[]),...named(dataset.columns.map(column=>column.name),taken,'meta_').filter((_,c)=>kept.includes(c)),...extra.header,...(withFiles?['file']:[])])};
}
// The names the corpus table gives the study's label and metadata columns, in the columns' order.
export const corpusColumnNames=(dataset:Dataset):string[]=>{if(!dataset.columns.length)return [];const {header,removed}=corpusHeader(dataset,false),from=4+(removed?1:0);return header.slice(from,from+dataset.columns.length);};
// options.columns: the places of the label and metadata columns to include (all by default); options.source: false
// leaves out `source` (the supplementary repository, where it only repeats the doc_id with the file's extension).
export function corpusTable(dataset:Dataset,rows:Row[],texts:Map<string,string>,files:Map<string,string>,options:{columns?:number[];source?:boolean}={}):Table{
 const kept=options.columns?dataset.columns.map((_,c)=>c).filter(c=>options.columns!.includes(c)):dataset.columns.map((_,c)=>c),source=options.source!==false;
 const {extra,removed,header}=corpusHeader(dataset,files.size>0,kept,source);
 return [header,...rows.map(row=>{
  const text=texts.get(row.id);
  return [docIdOf(dataset,row),text??'',text===undefined?'':text.length,...(source?[sourceName(dataset,row)]:[]),...(removed?[removedOn(row)]:[]),...kept.map(c=>row.cells?.[c]??''),...extra.cells(row),...(files.size?[files.get(row.id)??'']:[])];
 })];
}
// The same corpus as JSON Lines, for software that reads one record per line: doc_id, text, source, and meta
// (the labels and metadata), then what only the Lab has.
export function corpusRecords(dataset:Dataset,rows:Row[],texts:Map<string,string>,files:Map<string,string>):Record<string,unknown>[]{
 const knowledge=dataset.kind==='knowledge';
 return rows.map(row=>({doc_id:docIdOf(dataset,row),text:texts.get(row.id)??null,source:sourceName(dataset,row),meta:Object.fromEntries(dataset.columns.map((column,c)=>[column.name,row.cells?.[c]??''])),
  ...(knowledge?{subject:String(row.name??''),fields:row.fields||[]}:row.sourceId?{source_document:String(row.sourceName??''),chunk:`${row.chunkIndex} of ${row.chunkCount}`}:{}),
  ...(files.has(row.id)?{file:files.get(row.id)}:{}),...(row.removedAt?{removed_from_study:removedOn(row)}:{})}));
}

// The answer fields of a run as a page of Markdown: what the model had to return, and the column of each.
const TYPES={category:'category',ordinal:'ordinal',number:'number',boolean:'boolean',text:'text'} as const;
export function codebook(answerFields:string[],settings:AnswerSettings|undefined,knowledge:boolean):string{
 if(settings?.plain)return '# Codebook\n\nThe model was asked for a free-text response (no structured fields). The whole reply is stored as `response`; a reply that is one JSON object also has a column for each of its values.\n';
 const escape=(text:string)=>text.replace(/\|/g,'\\|').replace(/\s*\n\s*/g,' ');
 const isNamed=settings?.named===true,keys=wireKeys(answerFields,settings),columns=fieldKeys(answerFields,new Set(answerFields));
 const lines=['# Codebook','','Fields the model was required to return (enforced with a JSON schema; see `output_schema.json`).','','| Field | Column name | Type | Allowed values | Description | Key in the schema |','|---|---|---|---|---|---|'];
 if(!answerFields.some(isExplanationField)&&settings?.rationale!==false)lines.push(`| Rationale | rationale | free text | | Brief justification, generated before the labels | ${isNamed?RATIONALE_KEY:'explanation'} |`);
 if(!answerFields.length)lines.push('| Score / category | score | text | as the prompt defines | The final score or category | score |');
 answerFields.forEach((name,i)=>{
  const spec=fieldSpec(settings,name);
  lines.push(`| ${escape(name)} | ${escape(columns[i])} | ${spec?TYPES[spec.type]:'text'} | ${spec?escape((spec.type==='boolean'?['yes','no']:spec.values).join(', ')):'as the prompt defines'} | ${escape(spec?.description||'')} | ${isNamed?escape(keys[i]):'answers.f'+i} |`);
 });
 if(isNamed)lines.push('','Each field was sent under its key in the schema and its type: a scale as a whole number, a number as a number, yes / no as true or false, anything else as text. The results give each answer as text (a scale’s 3 as 3, true and false as yes and no).');
 if(settings?.rationale===false&&!isNamed)lines.push('','No explanation was requested; the key `explanation` was returned empty.');
 lines.push('','A field named like one of a table’s own columns (status, error, …) is written there as `answer_<name>`.');
 if(knowledge)lines.push('','Model knowledge: each field also accepts INSUFFICIENT_KNOWLEDGE, for a judgment the model cannot make reliably.'+(isNamed?' A scale, a number, or yes / no is therefore sent as text, limited to its values and INSUFFICIENT_KNOWLEDGE.':''));
 return lines.join('\n')+'\n';
}
// The answer fields as data: codebook.json.
export function codebookRecord(answerFields:string[],settings:AnswerSettings|undefined){
 const columns=fieldKeys(answerFields,new Set(answerFields));
 const variables=answerFields.length?answerFields.map((name,i)=>{const spec=fieldSpec(settings,name);return {name:columns[i],label:name,type:spec?.type??'text',values:spec?(spec.type==='boolean'?['yes','no']:[...spec.values]):[],description:spec?.description??''};}):[{name:'score',label:'Score / category',type:'text',values:[],description:'The final score or category'}];
 return {outputMode:'structured',includeRationale:settings?.rationale!==false&&!answerFields.some(isExplanationField),variables};
}
