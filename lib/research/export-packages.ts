// The Export tab's files. An Excel workbook reports one run. The research repository is the whole study for
// the researcher's own archive: every run, the corpus, the requests and replies, and a backup that can be
// imported again. The supplementary repository is what a journal or an OSF or Zenodo deposit needs for one
// run: a record of the settings, the prompt and answer fields, the results, agreement with human labels, and a
// Python script that sends the requests again.
import {fieldSpec,PLAIN_FIELD} from '../answer-types';
import type {Provider} from '../providers';
import {fillRequest} from '../request-frame';
import {insertMap,markedInserts,placesText} from '../prompt-inserts';
import {columnIndex,stem} from './columns';
import {agreementTable,runAgreement,type AgreementLine,type Intervals,type LabelPair,type Skipped} from './export-agreement';
import {fileHash,fullestRun,requestFinder,requestLines,requestParts,requestRecord,responseRecord,runFolder,runRequests,type DocumentReader,type ExportStudy,type RunRequests,type SentRequest} from './export-data';
import {fillScript,keyVariable,REQUIREMENTS,SCRIPT_TEMPLATE,scriptValues} from './export-python';
import {codebook,codebookRecord,corpusColumnNames,corpusRecords,corpusTable,docIdOf,failureOf,fieldKeys,hashOf,promptHashes,requestsTable,resultsTable,runFacts,runsOverview,sourceName,thinkingOf,type RunFacts,type Table} from './export-tables';
import {buildWorkbook,isProse,type Sheet} from './export-workbook';
import {dateStamp,exportStem,publicColumns,runLines,unitOf,type RunLine} from './export';
import {BOOTSTRAP_RESAMPLES,fixed,fmtStat} from './metrics';
import {toCsv} from './parse-table';
import {rowForRun,type Row} from './runs';
import {tiedVote} from './repeats';
import {plainMethod,sampleNote} from './sample';
import {fieldLabel} from './view';
import {offScaleLeftOut} from './scale-combine';

// Told each step as it starts: "Computing agreement", or the file about to be written.
export type Progress=(step:string)=>void|Promise<void>;
export type PackageFile={path:string;data:string|Uint8Array|Blob};
export type Package={name:string;files:PackageFile[]};
// read: each text as it was sent. intervals: how the 95% intervals are computed (by default here). backup:
// the whole study as a backup file. now: the time of the export.
export type ExportContext={study:ExportStudy;read:DocumentReader;intervals?:Intervals;onProgress?:Progress;backup?:()=>Promise<string>;now?:Date};

const PROVIDER_NAMES:Record<string,string>={openai:'OpenAI',anthropic:'Anthropic',gemini:'Google Gemini',openrouter:'OpenRouter'};
const count=(n:number)=>n.toLocaleString('en-US');
const jsonLines=(items:unknown[])=>new Blob(items.map(item=>JSON.stringify(item)+'\n'),{type:'application/jsonl'});
const pretty=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
// CSV files are written for analysis software, exactly as the values are.
const CSV_NOTE='The CSV files are for analysis software: they keep every value exactly as it is (a value starting with =, +, -, or @ is not escaped, so a spreadsheet program may read it as a formula).';
const TOKEN_NOTE='Token counts are the providers’ own: input tokens include tokens read from or written to a prompt cache, and output tokens include reasoning tokens.';
const LOG_NOTE='Each line starts with doc_id, replicate, and attempt. In requests.jsonl, `request` is the request as it was sent, with the document put back where it was (API keys travel in request headers and are never included). In responses.jsonl, `response` holds what was kept of the reply: the text the model returned, the summary of its reasoning where the run asked for one, the model the provider named, the stop reason, the token counts, and the response ID, not the provider’s whole response; a failed attempt that was sent again also has its status, error, and parse_error.';
// The research repository's logs also hold requests made before requests were kept (see requestOf).
const REBUILT_NOTE='`recorded` is false for a request that was not kept when it was sent: it was built again from the run’s settings.';

// The documents of a set of texts, read once. A PDF was sent as a file: it has no text, and the file goes
// into the package under `folder`.
type Corpus={texts:Map<string,string>;files:Map<string,string>;pdfs:{path:string;file:File}[];unread:number};
async function readCorpus(ctx:ExportContext,rows:Row[],folder:string,keepFiles:boolean):Promise<Corpus>{
 const corpus:Corpus={texts:new Map(),files:new Map(),pdfs:[],unread:0},taken=new Set<string>(),unit=unitOf(ctx.study.dataset);
 for(const [i,row] of rows.entries()){
  if(i%100===0)await ctx.onProgress?.(`Reading the ${unit}s (${count(i)} of ${count(rows.length)})`);
  const doc=await ctx.read(row);
  if(!doc){corpus.unread++;continue;}
  if(!('pdf' in doc)){corpus.texts.set(row.id,doc.text);continue;}
  if(!keepFiles)continue;
  const safe=doc.filename.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_')||'document.pdf',dot=safe.lastIndexOf('.');
  let name=safe;for(let n=2;taken.has(name.toLowerCase());n++)name=(dot>0?safe.slice(0,dot):safe)+'_'+n+(dot>0?safe.slice(dot):'');
  taken.add(name.toLowerCase());corpus.files.set(row.id,'files/'+name);corpus.pdfs.push({path:folder+'/files/'+name,file:doc.pdf});
 }
 return corpus;
}

// A run's requests and replies as JSON Lines, in the study's order of texts, then replicate (which of the
// text's annotations), then attempt. filePath: where a
// PDF is in the package (absent when it is not included).
async function runLogs(ctx:ExportContext,run:number,find:(row:Row,result:Row)=>SentRequest|undefined,filePath:(row:Row)=>string|undefined):Promise<{requests:Blob;responses:Blob}>{
 const {dataset}=ctx.study,requests:unknown[]=[],responses:unknown[]=[],hashes=new Map<string,string>();
 const lines=requestLines(dataset).filter(line=>line.run===run);
 for(const [i,{row,replicate,attempt,result,replaced}] of lines.entries()){
  if(i%100===0)await ctx.onProgress?.(`Writing the requests and replies of run ${run} (${count(i)} of ${count(lines.length)})`);
  const head={doc_id:docIdOf(dataset,row),replicate,attempt},sent=find(row,result),doc=await ctx.read(row,result);
  let pdf='';
  if(doc&&'pdf' in doc){
   if(!hashes.has(row.id))hashes.set(row.id,await fileHash(doc.pdf));
   const path=filePath(row);
   pdf=`[PDF file: ${doc.filename}, ${doc.pdf.size} bytes, SHA-256 ${hashes.get(row.id)}; ${path?'in this package at '+path:'not included in this package'}]`;
  }
  const {request,...kept}=requestRecord(sent,doc,result,pdf),{status,error,...reply}=responseRecord(result),failure=failureOf(result);
  requests.push({...head,request,run,...(replaced?{sent_again:true}:{}),...kept,...(sent?{recorded:sent.recorded}:{})});
  responses.push({...head,...(replaced?{status,error:failure.error||null,parse_error:failure.parseError||null}:{}),response:reply,run,...(replaced?{sent_again:true}:{status,...(status==='ok'?{}:{error:failure.error||null,parse_error:failure.parseError||null})})});
 }
 return {requests:jsonLines(requests),responses:jsonLines(responses)};
}

// The temperature a run was sent with: what its request says, or what the run's setup records.
const temperatureOf=(run:RunFacts['run'],parts?:{temperature?:number}):number|'model default'=>parts?.temperature??run.temperature??'model default';
const explanationRequested=(facts:RunFacts)=>!facts.run.answerSettings?.plain&&(facts.run.answerSettings?.rationale!==false||facts.run.answerFields.some(name=>name.toLowerCase()==='explanation'));
const processingWords=(facts:RunFacts)=>facts.processing==='batch'?'the provider’s batch interface':facts.processing==='instant'?'requests sent one by one':'requests sent one by one and the provider’s batch interface';
// The fields of a run whose answers are combined by majority vote when it makes several annotations per text: not
// a scale, a number, free text, or an explanation ('' for the single score or category).
function votedFields(run:RunLine):string[]{
 if((run.repeats||1)<2||run.answerSettings?.plain)return [];
 const typeOf=(name:string)=>fieldSpec(run.answerSettings,name)?.type;
 return run.answerFields.length?run.answerFields.filter(name=>!['ordinal','number','text'].includes(typeOf(name)||'')&&!/(^|_)(explanation|reasoning)$/i.test(name)):[''];
}

// The record of one run: settings, dates, counts, tokens, and the request bodies as sent (with marks where the
// document goes). It is run.json in the research repository; metadata.json in the supplementary repository is its
// public part (publicRecord). Neither names the Lab or its build: software_versions.json does (research repository).
function runRecord(study:ExportStudy,facts:RunFacts,hash:string,sent:RunRequests,exportedAt:string){
 const {dataset}=study,{run}=facts,unit=unitOf(dataset),frame=(sent.text||sent.pdf)?.frame,parts=frame?requestParts(frame):undefined,known=facts.tokens.knownFor>0;
 const body=(kind:string,request?:SentRequest&{count:number})=>request?[{kind,requests:request.count,recorded:request.recorded,url:request.frame.url,body:JSON.parse(request.frame.body)}]:[];
 // Scores off the study's scale left out when a text's annotations were combined, because another was on it (scale-combine.ts).
 const offScale=run.answerSettings?.plain&&(run.repeats||1)>1?offScaleLeftOut(dataset.rows,run.number,dataset.scoreScale):0;
 // Texts whose majority vote was tied, by field (kept as "a | b"; see repeats.ts).
 const voted=votedFields(run),keys=fieldKeys(run.answerFields,new Set(run.answerFields)),done=voted.length?dataset.rows.map(row=>rowForRun(row,run.number)).filter(result=>result.status==='done'):[];
 const ties=Object.fromEntries(voted.map(name=>[name?keys[run.answerFields.indexOf(name)]:'score',done.filter(result=>tiedVote(result,name)).length]));
 return {
  exported_at:exportedAt,study:study.name,
  // Notes kept with the study: how each sample was drawn (rule and seed).
  study_notes:dataset.samples.map(sampleNote).join('\n')||null,
  run:{number:run.number,...(run.label?{label:run.label}:{}),...(run.scope?{scope:run.scope}:{}),started_at:run.startedAt,finished_at:facts.finished||null,status_when_exported:run.active?'in progress':'finished',processing:processingWords(facts),batch_ids:facts.batchIds},
  model:{provider:run.provider,requested:run.model,reported_by_api:facts.models,reasoning_effort:run.effort,reasoning_summary_requested:run.summary==='in part'?'in part':run.summary==='on',temperature:temperatureOf(run,parts),max_output_tokens:parts?.limit??null},
  prompt:{version:run.promptVersion,sha256_prefix:hash,answer_format:run.answerSettings?.plain?'plain text':'structured',explanation_requested:explanationRequested(facts),answer_fields:run.answerFields,answer_settings:run.answerSettings??null,system_prompt:run.system??null,...(run.answerSettings?.plain&&dataset.scoreScale?{score_scale_for_statistics:{...dataset.scoreScale,sent_to_model:false}}:{})},
  options:{annotations_per_text:run.repeats||1,prompt_caching:run.caching,...(dataset.kind==='knowledge'?{web_search:run.webSearch}:{})},
  // The bodies of the run's requests, with marks where each document goes (<<DOCUMENT_FILENAME>>, <<DOCUMENT_TEXT>>, <<FILE_BASE64>>).
  // recorded: false for a request that was not kept when it was sent, built again from the run's settings.
  requests_as_sent:{different_bodies:sent.forms,bodies:[...body('text',sent.text),...body('pdf',sent.pdf)]},
  corpus:{[`n_${unit}s_in_run`]:facts.texts,[`n_${unit}s_with_usable_annotation`]:facts.usable,[`n_${unit}s_all_requests_failed`]:facts.allFailed,[`n_${unit}s_without_result_yet`]:facts.active,...((run.repeats||1)>1?{[`n_${unit}s_with_fewer_usable_annotations`]:run.fewer}:{}),...(voted.length?{[`n_${unit}s_with_tied_votes`]:ties}:{})},
  // total, ok, failed: each text's last request in the run (with several annotations per text, the last request
  // for each annotation). replaced_by_retries: failed attempts that were sent again.
  requests:{total:facts.requests.total,ok:facts.requests.ok,failed:facts.requests.failed,replaced_by_retries:facts.requests.replaced,...(facts.requests.replaced?{sent_in_all:facts.requests.total+facts.requests.replaced}:{}),first_requested_at:facts.requests.first||null,last_completed_at:facts.requests.last||null,...(offScale?{scores_off_scale_left_out_when_combined:offScale}:{})},
  tokens:known?{input:facts.tokens.input,output:facts.tokens.output,reasoning:facts.tokens.reasoning,cache_read:facts.tokens.cacheRead,cache_write:facts.tokens.cacheWrite,known_for_requests:facts.tokens.knownFor}:null,
 };
}
type RunRecord=ReturnType<typeof runRecord>;
// metadata.json of the supplementary repository: the run's record without study notes, its label, scope, or batch
// IDs, the system prompt or answer settings (prompt/ holds them), and counters that are 0 (the totals always); the
// output schema is named where the request bodies hold it (prompt/output_schema.json).
function publicRecord(record:RunRecord,unit:string,schema:unknown):Record<string,unknown>{
 const {study_notes:_notes,run,prompt,requests_as_sent,corpus,requests,...rest}=record;
 const {label:_label,scope:_scope,batch_ids:_batches,status_when_exported,...runRest}=run as typeof run&{label?:string;scope?:string};
 const nonZero=(o:Record<string,unknown>,always:string[])=>Object.fromEntries(Object.entries(o).filter(([key,value])=>always.includes(key)||(value!==0&&value!==null&&value!==undefined)));
 const shown=JSON.stringify(schema),named=(value:unknown):unknown=>schema!==undefined&&JSON.stringify(value)===shown?'see prompt/output_schema.json':Array.isArray(value)?value.map(named):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,named(item)])):value;
 const tiedKey=`n_${unit}s_with_tied_votes`,tied=nonZero((corpus as Record<string,unknown>)[tiedKey] as Record<string,unknown>||{},[]);
 const lean:Record<string,unknown>={...rest,
  run:{...runRest,...(status_when_exported!=='finished'?{status_when_exported}:{})},
  // The answer fields only where the schema has them under short keys (f0, f1, …).
  prompt:{version:prompt.version,sha256_prefix:prompt.sha256_prefix,answer_format:prompt.answer_format,explanation_requested:prompt.explanation_requested,...(prompt.answer_format==='structured'&&!prompt.answer_settings?.named&&prompt.answer_fields.length?{answer_fields:prompt.answer_fields}:{}),...('score_scale_for_statistics' in prompt?{score_scale_for_statistics:prompt.score_scale_for_statistics}:{})},
  requests_as_sent:{...(requests_as_sent.different_bodies>1?{different_bodies:requests_as_sent.different_bodies}:{}),bodies:requests_as_sent.bodies.map(body=>({...body,body:named(body.body)}))},
  corpus:{...nonZero({...corpus,[tiedKey]:undefined},[`n_${unit}s_in_run`,`n_${unit}s_with_usable_annotation`]),...(Object.keys(tied).length?{[tiedKey]:tied}:{})},
  requests:nonZero(requests,['total','ok','failed','first_requested_at','last_completed_at'])};
 // In the order of the whole record.
 return Object.fromEntries(Object.keys(record).filter(key=>key in lean).map(key=>[key,lean[key]]));
}

// The Settings sheet of the workbook. After the common rows: web search (Model knowledge), and the prompt as sent
// where the Lab added instructions of its own to it (addedInstructions).
function settingsTable(study:ExportStudy,facts:RunFacts,hash:string,sent:RunRequests):Table{
 const {dataset}=study,{run}=facts,unit=unitOf(dataset),frame=(sent.text||sent.pdf)?.frame,parts=frame?requestParts(frame):undefined,notes=dataset.samples.map(sampleNote).join('\n');
 return [['setting','value'],['Study',study.name],...(notes?[['Study notes (e.g. how samples were drawn)',notes]]:[]),['Run','#'+run.number+(run.label?` (${run.label})`:'')],['Started',run.startedAt],['Finished',run.active?'not finished when exported (the results so far)':facts.finished],
  ['Provider',run.provider],['Model',run.model],['Effort / reasoning',run.effort||'model default'],['Thinking',thinkingOf(run)||'n/a (reasoning controlled by effort)'],['Temperature',temperatureOf(run,parts)],['Max output tokens',parts?.limit??''],[`Annotations per ${unit}`,(run.repeats||1)>1?`${run.repeats} (the Results sheet has the combined answers; By replicate has each annotation)`:1],
  ['Prompt caching',run.caching],['Mode',facts.processing==='batch'?'Batch API':facts.processing==='instant'?'immediate requests':'immediate requests and Batch API'],
  ['Prompt version',`v${run.promptVersion} (${hash})`],[`Prompt (sent with each ${unit})`,run.prompt],['System prompt',run.system||'(none)'],['Output',parts?.schema?JSON.stringify(parts.schema):run.answerSettings?.plain?'plain text':'not recorded'],
  ...(dataset.kind==='knowledge'?[['Web search',run.webSearch?'yes':'no']]:[]),
  ...(parts?.prompt&&addedInstructions(dataset,run)?[['Prompt as sent',parts.prompt]]:[])];
}
// Whether the Lab added instructions of its own after a run's prompt: the standard Lab's answer format (runs
// before fields went under their own names), or Model knowledge's paragraph where it was not in the prompt box.
const addedInstructions=(dataset:ExportStudy['dataset'],run:RunLine)=>dataset.kind==='knowledge'&&!run.answerSettings?.inPrompt||!(run.answerSettings?.plain||run.answerSettings?.named);

// What is computed once for a run and used by its workbook, its tables, and its README.
type RunReport={facts:RunFacts;hash:string;sent:RunRequests;agreement:AgreementLine[];pairs:LabelPair[];skipped:Skipped[]};
async function reportRun(ctx:ExportContext,run:number,hashes:Map<string,string>,find=requestFinder(ctx.study)):Promise<RunReport>{
 const {dataset}=ctx.study,line=runLines(dataset).find(candidate=>candidate.number===run);
 if(!line)throw new Error(`Run ${run} has no results.`);
 await ctx.onProgress?.(`Computing agreement for run ${run}`);
 const {lines,pairs,skipped}=await runAgreement(dataset,run,ctx.intervals);
 return {facts:runFacts(dataset,line),hash:hashOf(hashes,line.prompt,line.system),sent:runRequests(ctx.study,run,find),agreement:lines,pairs,skipped};
}
// The column of an agreement line's field, as in the run's results tables.
function agreementKeys(dataset:ExportStudy['dataset']):(line:AgreementLine)=>string{
 const fields=new Map(runLines(dataset).map(run=>[run.number,run.answerFields]));
 return line=>{const names=fields.get(line.run)||[],at=names.indexOf(line.field);return at>=0?fieldKeys(names,new Set(names))[at]:fieldKeys([line.field],new Set())[0];};
}
// Lean tables (November 16, 2026): a column with one value for the whole run is given once (the Settings sheet,
// metadata.json), and one that no request has a value in is left out.
const RUN_CONSTANTS=['study','run','run_label','prompt_version','prompt_hash','provider','model_requested','latency_ms'];
const BLANK_UNLESS_USED=['rationale','reasoning_summary','parse_error','error','reasoning_tokens','cache_read_tokens','cache_write_tokens'];
const unused=(value:unknown)=>value===''||value===0||value===null||value===undefined;
// A run's table of requests without those columns. Public (the supplementary repository): also without
// model_reported where the provider named one model throughout, and, with one annotation per text, without
// replicate and the answers, which results.csv gives (a plain-text reply stays where a failed request has one).
// web_search (Model knowledge) goes where it is the same throughout.
function leanRequests(table:Table,lean?:{reps:number}):Table{
 const [header,...rows]=table,at=(name:string)=>header.indexOf(name),drop=new Set<number>();
 const same=(i:number)=>i>=0&&rows.every(row=>row[i]===rows[0][i]);
 for(const name of RUN_CONSTANTS)if(at(name)>=0)drop.add(at(name));
 for(const name of BLANK_UNLESS_USED)if(at(name)>=0&&rows.every(row=>unused(row[at(name)])))drop.add(at(name));
 if(same(at('web_search')))drop.add(at('web_search'));
 if(lean){
  if(same(at('model_reported')))drop.add(at('model_reported'));
  if(lean.reps===1){
   const status=at('status'),end=header.findIndex((name,i)=>i>status&&['rationale','reasoning_summary','parse_error'].includes(String(name)));
   drop.add(at('replicate'));if(at('rationale')>=0)drop.add(at('rationale'));
   for(let i=status+1;i<end;i++)if(!(header[i]===PLAIN_FIELD&&rows.some(row=>row[status]==='error'&&row[i]!=='')))drop.add(i);
  }
 }
 return table.map(row=>row.filter((_,i)=>!drop.has(i)));
}
// results.csv of the supplementary repository: no n_error, and n_ok only where a text has fewer usable annotations
// than the run made (the workbook keeps both).
function publicResults(table:Table,reps:number):Table{
 const [header,...rows]=table,ok=header.indexOf('n_ok'),error=header.indexOf('n_error'),fewer=reps>1&&rows.some(row=>Number(row[ok])<reps);
 return table.map(row=>row.filter((_,i)=>i!==error&&(i!==ok||fewer)));
}

// The workbook of one run: results text by text and request by request (By replicate), agreement, settings,
// and all runs.
async function runWorkbook(ctx:ExportContext,report:RunReport,hashes:Map<string,string>):Promise<ArrayBuffer>{
 const {study}=ctx,run=report.facts.run.number;
 const results=resultsTable(study,run),requests=leanRequests(requestsTable(study,[run],hashes)),from=requests[0].indexOf('status'),to=requests[0].findIndex(column=>['rationale','reasoning_summary','parse_error'].includes(String(column)));
 const fixedText=new Set(['doc_id','subject','source_document','chunk','text','rationale',PLAIN_FIELD]);
 const sheets:Sheet[]=[{name:'Results',table:results,frozen:1,numbers:column=>!fixedText.has(column)&&!isProse(column)},
  {name:'By replicate',table:requests,numbers:(column,i)=>i>from&&i<to&&!fixedText.has(column)&&!isProse(column)},
  ...(report.agreement.length?[{name:'Agreement',table:agreementTable(report.agreement,agreementKeys(study.dataset))}]:[]),
  {name:'Settings',table:settingsTable(study,report.facts,report.hash,report.sent),frozen:1,prose:(column:string)=>column==='value'},
  {name:'All runs',table:runsOverview(study,hashes)}];
 return buildWorkbook(sheets);
}
export async function buildRunWorkbook(ctx:ExportContext,run:number):Promise<{name:string;data:ArrayBuffer}>{
 const hashes=await promptHashes(ctx.study.dataset),report=await reportRun(ctx,run,hashes);
 await ctx.onProgress?.('Writing the sheets');
 return {name:`${exportStem(ctx.study.name,ctx.study.dataset)}_run${run}_${dateStamp(ctx.now||new Date())}.xlsx`,data:await runWorkbook(ctx,report,hashes)};
}

// The prompt of a run and its answer fields: prompt.txt, system_prompt.txt (where there is one), codebook.md and
// codebook.json (research repository; codebook.json not for plain text), and output_schema.json; then
// prompt_as_sent.txt, only where the Lab added instructions of its own (addedInstructions): the prompt as each
// request carried it. which: those of a supplementary repository's prompt/ (no codebook: the schema gives the
// fields), those of a prompt version (prompts/vN/), or those that can differ between runs of one version (runs/run-NN/).
function promptFiles(study:ExportStudy,report:RunReport,which:'all'|'version'|'run'):PackageFile[]{
 const {run}=report.facts,frame=(report.sent.text||report.sent.pdf)?.frame,sent=frame?requestParts(frame):undefined,plain=Boolean(run.answerSettings?.plain);
 return [...(which!=='run'?[{path:'prompt.txt',data:run.prompt},...(run.system?[{path:'system_prompt.txt',data:run.system}]:[])]:[]),
  ...(which==='all'?[]:[{path:'codebook.md',data:codebook(run.answerFields,run.answerSettings,study.dataset.kind==='knowledge')}]),...(sent?.schema?[{path:'output_schema.json',data:pretty(sent.schema)}]:[]),...(plain||which==='all'?[]:[{path:'codebook.json',data:pretty(codebookRecord(run.answerFields,run.answerSettings))}]),
  ...(which!=='version'&&sent?.prompt&&addedInstructions(study.dataset,run)?[{path:'prompt_as_sent.txt',data:sent.prompt}]:[])];
}
// The placeholders of a run's prompt that were filled in for each text, read from the marks of its request.
const runInserts=(sent:RunRequests):string[]=>markedInserts((sent.text||sent.pdf)?.frame.body||'');
// Where the corpus table holds the values of each: {{id}} is the text's doc_id (idColumn), {{meta.<column>}} a
// metadata column (null: the study no longer has it).
function insertColumns(dataset:ExportStudy['dataset'],names:string[],run:number):[string,string|null][]{
 const columns=corpusColumnNames(dataset);
 return names.map(name=>{
  if(name==='id')return [name,idColumn(dataset,run)];
  const index=columnIndex(dataset.columns,name.slice(5));
  return [name,index>=0&&dataset.columns[index].role==='meta'?columns[index]:null];
 });
}
const listed=(items:string[])=>items.length>2?items.slice(0,-1).join(', ')+', and '+items[items.length-1]:items.join(' and ');
const written=(names:string[])=>listed(names.map(name=>`\`{{${name}}}\``));
// {{id}} is filled in with a text's doc_id; a run made before 2026-11-16 filled in its name as it was (with the
// file's extension), which the corpus holds as source (a subject's name: subject). Read from the values kept with
// the run's results: doc_id unless one of them is the name and not the doc_id.
function idColumn(dataset:ExportStudy['dataset'],run:number):string{
 for(const line of requestLines(dataset)){
  if(line.run!==run||!Array.isArray(line.result.inserts))continue;
  const value=insertMap(String(line.result.prompt??''),line.result.inserts).get('id');
  if(value!==undefined&&value!==docIdOf(dataset,line.row)&&value===String(line.row.name??''))return dataset.kind==='knowledge'?'subject':'source';
 }
 return 'doc_id';
}
// The placeholders that held a value in at least one request of a run, read from the values kept with its
// results. One that names a column of human labels, no column at all, or an empty column held none.
function valuedInserts(dataset:ExportStudy['dataset'],run:number):Set<string>{
 const valued=new Set<string>();
 for(const line of requestLines(dataset))if(line.run===run&&Array.isArray(line.result.inserts))for(const [name,value] of insertMap(String(line.result.prompt??''),line.result.inserts))if(value!=='')valued.add(name);
 return valued;
}
// The script that sends a run's requests again, with its template. No script: a run whose requests carried web
// search results collected for each subject (the search is a step of its own), or a run without a known request.
function scriptFiles(study:ExportStudy,report:RunReport,exportedAt:string):{files:PackageFile[];why:string}{
 const {facts,sent}=report,{run}=facts;
 if(facts.webSearch)return {files:[],why:'No script is included: each request of this run carried web search results collected for its subject in a step of its own, which a script cannot repeat as it was.'};
 if(!sent.text&&!sent.pdf)return {files:[],why:'No script is included: the settings of this run’s requests were not recorded.'};
 const other=sent.total-(sent.text?.count||0)-(sent.pdf?.count||0)-sent.unknown;
 const notes=[other>0?`${count(other)} of the run’s ${count(sent.total)} requests had another body (for example, sent through the provider’s batch interface, or with another answer format); this script sends every document with the body most of them had.`:'',
  facts.processing!=='instant'?'The run used the provider’s batch interface; this script sends the same request bodies one by one.':''].filter(Boolean);
 // Lines of at most about 78 characters, as in the rest of the script's opening text.
 const wrap=(text:string)=>text.split(' ').reduce<string[]>((lines,word)=>{const last=lines[lines.length-1];if(last!==undefined&&(last+' '+word).length<=78)lines[lines.length-1]=last+' '+word;else lines.push(word);return lines;},[]).join('\n');
 const values=scriptValues({studyName:study.name,runDescription:`#${run.number}, started ${run.startedAt}; exported ${exportedAt}`,provider:run.provider as Provider,text:sent.text?.frame,pdf:sent.pdf?.frame,fields:run.answerFields,plain:Boolean(run.answerSettings?.plain),settings:run.answerSettings,repeats:run.repeats||1,note:notes.map(wrap).join('\n'),inserts:insertColumns(study.dataset,runInserts(sent),run.number)});
 return {files:[{path:'annotate_template.py',data:SCRIPT_TEMPLATE},{path:'annotate.py',data:fillScript(SCRIPT_TEMPLATE,values)},{path:'requirements.txt',data:REQUIREMENTS}],why:''};
}

// How a run that annotated each text several times combined its answers, in one line (empty for one annotation
// per text). Kept at the owner's request (November 16, 2026): nothing else in the package says it.
function combiningLine(study:ExportStudy,report:RunReport,record:RunRecord):string{
 const {run}=report.facts,unit=unitOf(study.dataset),reps=run.repeats||1;
 if(reps<2)return '';
 const head=`Each ${unit}’s ${reps} annotations were combined`,typeOf=(name:string)=>fieldSpec(run.answerSettings,name)?.type;
 if(run.answerSettings?.plain){
  const offScale=record.requests.scores_off_scale_left_out_when_combined??0;
  return `${head}: numbers in the answers by the median, other values by majority vote${offScale?`; a score off the scale was left out where another annotation of the same ${unit} was on it`:''}.`;
 }
 const voted=votedFields(run).length>0;
 const kinds=([[voted,'categorical labels by majority vote'],[run.answerFields.some(name=>typeOf(name)==='ordinal'),'ordinal labels by the median'],[run.answerFields.some(name=>typeOf(name)==='number'),'numbers by the mean']] as [boolean,string][]).filter(kind=>kind[0]).map(kind=>kind[1]);
 return `${head}${run.answerFields.some(name=>typeOf(name))?': '+listed(kinds):' by majority vote'}${voted?'; a tied vote is kept as both values (for example, “a | b”) and counts as a disagreement in the agreement figures':''}.`;
}

const tableRow=(cells:(string|number)[])=>'| '+cells.join(' | ')+' |';
// The agreement figures as a Markdown table, with what the brackets and the counts mean.
function agreementSection(study:ExportStudy,report:RunReport):string[]{
 if(!report.agreement.length&&!report.skipped.length)return [];
 const unit=unitOf(study.dataset),ci=(range:[number,number]|null|undefined,percent=false)=>range?` [${percent?(range[0]*100).toFixed(1):fixed(range[0],2)}, ${percent?(range[1]*100).toFixed(1):fixed(range[1],2)}]`:'';
 const lines=['## Agreement with human labels',''];
 if(report.agreement.length){
  lines.push(tableRow(['Field','Annotations','Compared with','N compared (of labelled)','% agreement','Cohen’s κ','Krippendorff’s α','Gwet’s AC1']),'|---|---|---|---|---|---|---|---|');
  for(const a of report.agreement){
   const s=a.stats;
   lines.push(tableRow([fieldLabel(a.field),a.source,a.comparedWith,`${s.n} (of ${a.withLabel}${s.leftOut.n?`; ${s.leftOut.n} left out`:''})`,s.percentAgreement===null?'—':(s.percentAgreement*100).toFixed(1)+'%'+ci(s.ci.percentAgreement,true),fmtStat(s.cohenKappa)+ci(s.ci.cohenKappa),`${fmtStat(s.krippendorffAlpha)}${ci(s.ci.krippendorffAlpha)} (${s.level})`,fmtStat(s.gwetAC1)+ci(s.ci.gwetAC1)]));
  }
  const withIntervals=report.agreement.filter(a=>Object.values(a.stats.ci).some(Boolean)).length;
  lines.push('',(withIntervals?`Brackets: 95% intervals: Wilson intervals for % agreement, bootstrap intervals (${count(BOOTSTRAP_RESAMPLES)} resamples of ${unit}s) for the coefficients.${withIntervals<report.agreement.length?` A comparison of fewer than 10 ${unit}s has no intervals.`:''}`:`No 95% intervals are given: they need at least 10 compared ${unit}s.`)+` “Of labelled”: this run’s ${unit}s with a value in the “Compared with” column (a missing-value marker such as NA counts as no value). Not compared: ${unit}s without a usable value under Annotations (no usable answer from the model, or no label in that column), and pairs with a value that does not fit the field (“left out”: a word where numbers are compared, such as an answer of NA, a number off the scale, or a value that is not one of the field’s categories). Their number is n_left_out_not_on_scale in agreement.csv, which also says what each field’s scale or categories rest on.`+(report.agreement.some(a=>a.source!=='model')?` Rows with a column name under Annotations compare two columns of human labels (human–human baseline) on this run’s ${unit}s.`:''));
 }
 if(report.skipped.length)lines.push('',`Label columns not used for agreement: ${report.skipped.map(skip=>`${skip.column} (${skip.reason})`).join(', ')}.`);
 return [...lines,''];
}

// The README of the supplementary repository: what the package holds, and how to send the requests again. It names
// neither the Lab nor its build, and has no text for a paper (the researcher writes that).
function supplementaryReadme(study:ExportStudy,report:RunReport,record:RunRecord,options:SupplementaryOptions,has:{agreement:boolean;script:boolean;scriptWhy:string;schema:boolean;asSent:boolean;files:number;unread:number;answersOnce:boolean;fewer:boolean;source:boolean}):string{
 const {dataset}=study,{facts}=report,{run}=facts,unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',plain=Boolean(run.answerSettings?.plain),reps=run.repeats||1;
 // Placeholders of the prompt that were filled in for each text, and where the corpus holds their values.
 const inserted=runInserts(report.sent),valued=valuedInserts(dataset,run.number),metaFilled=inserted.filter(name=>name!=='id'&&valued.has(name)),unfilled=inserted.filter(name=>!valued.has(name));
 const insertedNote=inserted.length?`. Its placeholders were filled in for each ${unit}: ${[inserted.includes('id')&&valued.has('id')?`\`{{id}}\` with the ${unit}’s ${idColumn(dataset,run.number)==='doc_id'?'doc_id':'name'}`:'',metaFilled.length?`${written(metaFilled)} with its value${metaFilled.length===1?' in that metadata column':'s in those metadata columns'}`:'',unfilled.length?`${written(unfilled)} ${unfilled.length===1?'was':'were'} filled in empty for every ${unit} (${unfilled.length===1?'it names':'they name'} no metadata column, or an empty one)`:''].filter(Boolean).join('; ')}`:'';
 const combining=combiningLine(study,report,record);
 const lines=[`# ${study.name}: LLM annotation materials`,'',
  `Supplementary materials for the LLM-based annotation, exported on ${record.exported_at.slice(0,10)}.`,'',
  ...(run.active?['**This run was not finished when these materials were exported**: they describe the results so far.','']:[]),
  ...(knowledge?['Model knowledge: no texts were supplied. The model judged named subjects from what it has learned.'+(facts.webSearch?' Web search results collected for each subject were supplied with the request.':''),'']:[]),
  '## Summary','','| | |','|---|---|',
  tableRow(['Provider / model',`${run.provider} / \`${run.model}\``]),tableRow(['Model reported by the API',facts.models.map(model=>'`'+model+'`').join(', ')||'—']),tableRow(['Reasoning effort',run.effort||'—']),tableRow(['Temperature',record.model.temperature]),tableRow(['Max output tokens',record.model.max_output_tokens??'—']),
  tableRow([`${unit==='text'?'Texts':'Subjects'} with a usable annotation`,`${facts.usable} of ${facts.texts}`]),tableRow([`Annotations per ${unit}`,reps]),tableRow(['Requests (ok / failed)',`${facts.requests.ok} / ${facts.requests.failed}`]),
  ...(facts.requests.replaced?[tableRow(['Failed attempts sent again',`${facts.requests.replaced} (their tokens are included in the token totals)`])]:[]),
  tableRow(['Annotation period',`${facts.requests.first||'—'} to ${facts.requests.last||'—'}`]),tableRow(['Prompt version / hash',`v${run.promptVersion} / \`${report.hash}\``]),'',
  ...(combining?[combining,'']:[]),
  ...agreementSection(study,report),
  '## Files','','| File | Contents |','|---|---|',
  tableRow(['`metadata.json`','Machine-readable record of the model, settings, dates, counts, and token use, with the bodies of the requests as sent (marks stand for the document'+(inserted.length?' and for the values of the prompt’s placeholders':'')+')']),
  tableRow(['`prompt/prompt.txt`','The annotation prompt as written'+insertedNote]),
  ...(has.asSent?[tableRow(['`prompt/prompt_as_sent.txt`','The prompt as each request carried it: '+(added=>added.length?'with the instructions added after it '+added.join(' and ')+', and ':'')([...(plain||run.answerSettings?.named?[]:['on the answer format']),...(knowledge&&!run.answerSettings?.inPrompt?['on judging from learned knowledge']:[])])+'with its line breaks as they were sent (CR LF)'+(inserted.length?'; the placeholders stand where each request had the values':'')+([report.sent.text].some(sent=>sent&&placesText(run.prompt)&&requestParts(sent.frame).prompt.includes('{{text}}'))?`; \`{{text}}\` stands where each request had the ${knowledge?'subject’s fields':unit}`:'')])]:[]),
  ...(run.system?[tableRow(['`prompt/system_prompt.txt`','The system prompt sent unchanged with every request; the prompt opened the message with each '+unit])]:[]),
  ...(has.schema?[tableRow(['`prompt/output_schema.json`','The JSON schema the replies had to follow: each field, its type, and its allowed values'])]:[]),
  tableRow(['`results/results.csv`',`One row per ${unit}${options.texts?` (with ${knowledge?'the details the model was given':'its text'})`:''}: answers${reps>1?` (combined across the ${unit}’s annotations; \`<field>_replicate_agreement\` is the share of them that gave the combined value${has.fewer?`; \`n_ok\` is the number of usable annotations, where a ${unit} has fewer than ${reps}`:''})`:''}, labels, and metadata`]),
  tableRow(['`results/results_by_replicate.csv`',`One row per request${reps>1?` (${unit} × annotation; \`replicate\` numbers a ${unit}’s annotations)`:''}, with status, tokens, and timing${has.answersOnce?' (the annotations are in `results.csv`)':''}${facts.requests.replaced?`; a failed attempt that was sent again is counted in \`metadata.json\`${options.logs?' and kept in the logs':''}`:''}`]),
  ...(has.agreement?[tableRow(['`results/agreement.csv`','Agreement statistics'])]:[]),
  ...(options.texts?[tableRow(['`data/corpus.csv`',`The annotated ${unit}s as they were sent${has.source?', with the name each request gave for the document (`source`)':''}, with labels and metadata`+(has.files?'; a PDF was sent as a file and is in `data/files/`':'')])]:[]),
  ...(options.logs?[tableRow(['`logs/requests.jsonl`, `logs/responses.jsonl`','Every request and what was kept of every reply; a request that was sent again has a line for each attempt (same doc_id and replicate; attempt 1, 2, …)'])]:[]),
  ...(has.script?[tableRow(['`scripts/annotate.py`','Python script that sends the requests again (values inserted)']),tableRow(['`scripts/annotate_template.py`','The same script with `{{PLACEHOLDERS}}` marking every value that comes from the study']),tableRow(['`scripts/requirements.txt`','Says that the script needs no packages besides Python itself'])]:[]),
  '',...(options.logs?[LOG_NOTE+' A failed attempt’s request may never have reached the provider (a connection that broke, say).','']:[])];
 if(has.script)lines.push('## Reproducing','','```bash','cd scripts',`export ${keyVariable(run.provider as Provider)}=...`,`python annotate.py ${options.texts?'../data/corpus.csv':'your_corpus.csv'}`,'```','',
  `The script needs Python 3.9 or later and nothing else. ${options.texts?'':`Your corpus file needs a column doc_id and a column text${has.files||report.sent.pdf?' (or file, with the path of a PDF)':''}${[report.sent.text,report.sent.pdf].some(sent=>sent?.frame.body.includes('<<DOCUMENT_FILENAME>>'))?'; a column source gives the name each request states for the document':''}${inserted.length?`; and the columns the prompt’s placeholders take their values from (${insertColumns(dataset,inserted,run.number).filter(pair=>pair[1]).map(pair=>pair[1]).join(', ')})`:''}. `}${inserted.length?`The script fills in the prompt’s placeholders from the corpus file, so a value changed there since the run gives another request than the run sent${options.logs?' (the logs hold the requests as they were sent)':''}. `:''}Hosted models may be updated or retired and generation is not fully deterministic, so sending the requests again may not reproduce every answer exactly.`,'');
 else if(has.scriptWhy)lines.push('## Reproducing','',has.scriptWhy+(options.logs?' The logs hold every request as it was sent.':' The requests as sent are in the logs when the package includes them.'),'');
 // With the logs, the texts are in every request there.
 if(!options.texts)lines.push(options.logs?`The annotated ${unit}s are not included as a separate file, but \`logs/requests.jsonl\` holds every request with its ${knowledge?'subject':'full text'}${report.sent.pdf?' (a PDF sent as a file is named there, not included)':''}.`:`The annotated ${unit}s are not included in this package (for example, for copyright or privacy reasons).`,'');
 if(has.unread)lines.push(`${count(has.unread)} ${unit}${has.unread===1?'':'s'} could not be read when this package was made and ${has.unread===1?'has':'have'} no text here.`,'');
 return lines.join('\n');
}

// columns: the names of the label and metadata columns to include in results.csv and data/corpus.csv (absent: all
// of them). A column the prompt's placeholders take values from stays in data/corpus.csv, for the script.
export type SupplementaryOptions={texts:boolean;explanations:boolean;logs:boolean;columns?:string[]};
// What a journal or a deposit needs for one run: lean tables (no column with one value for the whole run, none
// empty throughout, nothing said twice), and nothing that names the Lab or its build.
export async function buildSupplementary(ctx:ExportContext,run:number,options:SupplementaryOptions):Promise<Package>{
 const {study}=ctx,{dataset}=study,exportedAt=(ctx.now||new Date()).toISOString(),name=`${exportStem(study.name,dataset)}_supplementary_${dateStamp(ctx.now||new Date())}`;
 const files:PackageFile[]=[],add=async(path:string,data:PackageFile['data'])=>{await ctx.onProgress?.('Writing '+path);files.push({path:name+'/'+path,data});};
 const hashes=await promptHashes(dataset),find=requestFinder(study),report=await reportRun(ctx,run,hashes,find),record=runRecord(study,report.facts,report.hash,report.sent,exportedAt);
 const ids=new Set(requestLines(dataset).filter(line=>line.run===run).map(line=>line.row.id)),rows=dataset.rows.filter(row=>ids.has(row.id));
 const reps=report.facts.run.repeats||1,corpus=options.texts?await readCorpus(ctx,rows,name+'/data',true):undefined;
 // The label and metadata columns chosen; data/corpus.csv also keeps those the prompt's placeholders read.
 const chosen=publicColumns(dataset).filter(c=>!options.columns||options.columns.includes(dataset.columns[c].name));
 const read=new Set(runInserts(report.sent).filter(insert=>insert.startsWith('meta.')).map(insert=>columnIndex(dataset.columns,insert.slice(5))).filter(c=>c>=0));
 // source: the name each request gave for its document, only where a request named it (a run made before
 // November 16, 2026, or a PDF sent as a file) or where it says more than the doc_id.
 const frames=[report.sent.text,report.sent.pdf].filter(Boolean).map(sent=>sent!.frame.body);
 const source=frames.some(body=>body.includes('<<DOCUMENT_FILENAME>>'))||!rows.every(row=>{const given=sourceName(dataset,row),id=docIdOf(dataset,row);return !given||given===id||stem(given)===id;});
 const prompt=promptFiles(study,report,'all'),schema=prompt.find(file=>file.path==='output_schema.json');
 await add('metadata.json',pretty(publicRecord(record,unitOf(dataset),schema?JSON.parse(String(schema.data)):undefined)));
 for(const file of prompt)await add('prompt/'+file.path,file.data);
 const results=publicResults(resultsTable(study,run,{texts:corpus?.texts,explanation:options.explanations,columns:chosen}),reps);
 await add('results/results.csv',toCsv(results));
 const byRequest=leanRequests(requestsTable(study,[run],hashes,{explanation:options.explanations,reasoning:false}),{reps});
 await add('results/results_by_replicate.csv',toCsv(byRequest));
 if(report.agreement.length)await add('results/agreement.csv',toCsv(agreementTable(report.agreement,agreementKeys(dataset))));
 if(corpus){
  await add('data/corpus.csv',toCsv(corpusTable(dataset,rows,corpus.texts,corpus.files,{columns:dataset.columns.map((_,c)=>c).filter(c=>chosen.includes(c)||read.has(c)),source})));
  for(const pdf of corpus.pdfs){await ctx.onProgress?.('Writing '+pdf.path.slice(name.length+1));files.push({path:pdf.path,data:pdf.file});}
 }
 if(options.logs){
  const logs=await runLogs(ctx,run,find,row=>corpus?.files.has(row.id)?'data/'+corpus.files.get(row.id):undefined);
  await add('logs/requests.jsonl',logs.requests);await add('logs/responses.jsonl',logs.responses);
 }
 const script=scriptFiles(study,report,exportedAt);
 for(const file of script.files)await add('scripts/'+file.path,file.data);
 await add('README.md',supplementaryReadme(study,report,record,options,{agreement:report.agreement.length>0,script:script.files.length>0,scriptWhy:script.why,schema:Boolean(schema),asSent:prompt.some(file=>file.path==='prompt_as_sent.txt'),files:corpus?.pdfs.length||0,unread:corpus?.unread||0,
  answersOnce:reps===1,fewer:results[0].includes('n_ok'),source}));
 return {name,files};
}

export type ResearchOptions={logs:boolean};
// The whole study, for the researcher's own archive.
export async function buildResearchRepository(ctx:ExportContext,options:ResearchOptions):Promise<Package>{
 const {study}=ctx,{dataset}=study,unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',exportedAt=(ctx.now||new Date()).toISOString(),name=`${exportStem(study.name,dataset)}_research_${dateStamp(ctx.now||new Date())}`;
 const files:PackageFile[]=[],add=async(path:string,data:PackageFile['data'])=>{await ctx.onProgress?.('Writing '+path);files.push({path:name+'/'+path,data});};
 const hashes=await promptHashes(dataset),find=requestFinder(study),lines=requestLines(dataset),withRequests=new Set(lines.map(line=>line.run)),runs=runLines(dataset).filter(run=>run.done+run.failed>0||withRequests.has(run.number));
 const reports=new Map<number,RunReport>();
 for(const run of runs)reports.set(run.number,await reportRun(ctx,run.number,hashes,find));
 // Texts deleted from the study but kept for the runs that used them (lib/research/removed.ts).
 const gone=dataset.rows.filter(row=>row.removedAt).length,inStudy=dataset.rows.length-gone;
 const corpus=await readCorpus(ctx,dataset.rows,name+'/corpus',true);
 await add('study.json',pretty({study:study.name,exported_at:exportedAt,[`n_${unit}s`]:inStudy,...(gone?{[`n_${unit}s_deleted_but_kept_for_runs`]:gone}:{}),...(dataset.scoreScale?{score_scale_for_plain_text_scores:dataset.scoreScale}:{}),runs:runs.map(run=>run.number),columns:dataset.columns,samples:dataset.samples.map(sample=>({...sample,method:plainMethod(sample.method)}))}));
 // The only file of the export that names the Lab and its builds (a private record).
 await add('software_versions.json',pretty({note:'The only file of this export that names the app and its builds. Keep it private: do not publish it.',software:'Text Annotation Lab',exported_with:study.lab,exported_at:exportedAt,runs:runs.map(run=>({run:run.number,made_with:reports.get(run.number)!.facts.labs.join('; ')||'not recorded'}))}));
 let backupNote='';
 if(ctx.backup){
  await ctx.onProgress?.('Writing study-backup.json');
  try{files.push({path:name+'/study-backup.json',data:await ctx.backup()});}
  catch(error){backupNote=error instanceof Error&&error.message?error.message:'The backup could not be made.';}
 }
 await add('corpus/corpus.csv',toCsv(corpusTable(dataset,dataset.rows,corpus.texts,corpus.files)));
 await add('corpus/corpus.jsonl',jsonLines(corpusRecords(dataset,dataset.rows,corpus.texts,corpus.files)));
 for(const pdf of corpus.pdfs){await ctx.onProgress?.('Writing '+pdf.path.slice(name.length+1));files.push({path:pdf.path,data:pdf.file});}
 await add('results/runs.csv',toCsv(runsOverview(study,hashes)));
 await add('results/results_all_runs_long.csv',toCsv(requestsTable(study,undefined,hashes)));
 const versions=new Set<number>();
 // Each prompt version's files, from the first run that used it.
 for(const run of runs){if(versions.has(run.promptVersion))continue;versions.add(run.promptVersion);for(const file of promptFiles(study,reports.get(run.number)!,'version'))await add(`prompts/v${run.promptVersion}/${file.path}`,file.data);}
 for(const run of runs){
  const report=reports.get(run.number)!,folder=`runs/${runFolder(run.number,run.label)}/`;
  await add(folder+'run.json',pretty(runRecord(study,report.facts,report.hash,report.sent,exportedAt)));
  await add(folder+'results_long.csv',toCsv(requestsTable(study,[run.number],hashes)));
  await add(folder+'results_wide.csv',toCsv(resultsTable(study,run.number)));
  if(options.logs){const logs=await runLogs(ctx,run.number,find,row=>corpus.files.has(row.id)?'corpus/'+corpus.files.get(row.id):undefined);await add(folder+'requests.jsonl',logs.requests);await add(folder+'responses.jsonl',logs.responses);}
  for(const file of promptFiles(study,report,'run'))await add(folder+file.path,file.data);
 }
 const agreement=runs.flatMap(run=>reports.get(run.number)!.agreement);
 if(agreement.length)await add('results/agreement.csv',toCsv(agreementTable(agreement,agreementKeys(dataset))));
 // The workbook and the script are for the main run: the one with usable answers for the most texts (the
 // latest of those), not a trial on a few texts made after it.
 const main=fullestRun(dataset),report=main?reports.get(main.number):undefined;
 let script={files:[] as PackageFile[],why:''};
 if(main&&report){
  await ctx.onProgress?.(`Writing results/results_${runFolder(main.number,main.label)}.xlsx`);
  files.push({path:`${name}/results/results_${runFolder(main.number,main.label)}.xlsx`,data:new Uint8Array(await runWorkbook(ctx,report,hashes))});
  script=scriptFiles(study,report,exportedAt);
  for(const file of script.files)await add('scripts/'+file.path,file.data);
 }
 // A prompt of the study has placeholders that were filled in for each text.
 const filled=Boolean(study.requests?.some(request=>markedInserts(request.body).length));
 const rows:[string,string][]=[['`study.json`',`The study at a glance: its name, the number of ${unit}s, its runs, its label and metadata columns, and the samples drawn`],
  ['`software_versions.json`','Which build of the app made each run and wrote this export. The only file here that names the app: keep it private'],
  ...(ctx.backup?[['`study-backup.json`',backupNote?`Not included: ${backupNote}`:`A backup of the whole study (both data sets, with the ${knowledge?'subjects':'uploaded files'}, every run, labels, and samples), re-importable via Studies → Import backup`] as [string,string]]:[]),
  ['`corpus/corpus.csv`, `corpus.jsonl`',`Every ${unit} as it was sent, with labels and metadata`+(corpus.pdfs.length?'; a PDF was sent as a file and is in `corpus/files/`':'')],
  ['`prompts/vN/prompt.txt`','Each version of the annotation prompt, as written'],
  ...(runs.some(run=>run.system)?[['`prompts/vN/system_prompt.txt`','The system prompt sent unchanged with every request, where a version had one; the prompt then opened the message with each '+unit] as [string,string]]:[]),
  ['`prompts/vN/codebook.md`, `codebook.json`, `output_schema.json`','The answer fields (their columns, types, allowed values, and descriptions) and the JSON schema the replies had to follow, as the first run of the version asked for them (no schema or codebook.json for plain text)'],
  ['`runs/run-NN/run.json`','One folder per run (run-NN-<label> for a run with a label). The record of the run: model, settings, dates, counts, token use, and the bodies of its requests as sent (marks stand for the document'+(filled?' and for the values of a prompt’s placeholders':'')+')'],
  ['`runs/run-NN/codebook.md`, `codebook.json`, `output_schema.json`, `prompt_as_sent.txt`','The run’s own (runs of one prompt version can ask for different answer fields): the answer fields and the JSON schema; and, only for a run whose requests carried instructions added after the prompt (on the answer format, or on judging from learned knowledge), the prompt as each request carried it'+(filled?' (placeholders that were filled in for each '+unit+' stand as written)':'')],
  ['`runs/run-NN/results_long.csv`',`One row per request: answers, rationale (the explanation), status, tokens, and timing; \`replicate\` numbers a ${unit}’s annotations in a run that makes several per ${unit} (a failed attempt that was sent again is counted in \`run.json\` and kept in the logs)`],
  ['`runs/run-NN/results_wide.csv`',`One row per ${unit}: answers, labels, and metadata; in a run that makes several annotations per ${unit}, the answers are the combined ones, and \`<field>_replicate_agreement\` is the share of the ${unit}’s annotations that gave the combined value`],
  ...(options.logs?[['`runs/run-NN/requests.jsonl`, `responses.jsonl`','Every request and what was kept of every reply; a request that was sent again has a line for each attempt (same doc_id and replicate; attempt 1, 2, …)'] as [string,string]]:[]),
  ['`results/runs.csv`','Overview of all runs'],['`results/results_all_runs_long.csv`','All requests of all runs in one table'],
  ['`results/agreement.csv`','Agreement between each run’s answers and the columns of human labels that belong to its answer fields (only if there are such columns)'],
  ...(main?[[`\`results/results_${runFolder(main.number,main.label)}.xlsx\``,`Excel workbook for run #${main.number}, the run with usable answers for the most ${unit}s (the latest of those)`] as [string,string]]:[]),
  ...(script.files.length&&main?[['`scripts/`',`Python script that sends the requests of run #${main.number} again (\`annotate.py\`), and its template with placeholders. \`corpus/corpus.csv\` holds every ${unit} of the study: to reproduce that run, use its ${unit}s (the doc_ids in \`runs/${runFolder(main.number,main.label)}/results_wide.csv\`)`] as [string,string]]:[])];
 const readme=[`# ${study.name}: research repository`,'',`Complete record of this annotation study, exported on ${exportedAt}.`,'',
  ...(knowledge?['Model knowledge: no texts were supplied. The model judged named subjects from what it has learned.','']:[]),
  `- ${count(inStudy)} ${unit}${inStudy===1?'':'s'}${gone?` (plus ${count(gone)} deleted from the study but kept for the runs that used ${gone===1?'it':'them'}; marked in \`corpus/corpus.csv\`)`:''}, ${runs.length} run${runs.length===1?'':'s'}, ${count(lines.length)} request${lines.length===1?'':'s'} with an outcome.`,'- API keys are never stored or exported.','',
  '## Layout','','| Path | Contents |','|---|---|',...rows.map(([path,contents])=>tableRow([path,contents])),'',
  ...(script.why&&main?[`Run #${main.number} has the most usable answers. ${script.why}`,'']:[]),
  CSV_NOTE+(main?' To read the results in Excel, open the .xlsx workbook instead.':''),'',TOKEN_NOTE,'',
  ...(options.logs?[LOG_NOTE+' A failed attempt’s request may never have reached the provider (a connection that broke, say).'+(runs.some(run=>reports.get(run.number)!.sent.rebuilt>0)?' '+REBUILT_NOTE:''),'']:[]),
  ...(corpus.unread?[`${count(corpus.unread)} ${unit}${corpus.unread===1?'':'s'} could not be read when this repository was made and ${corpus.unread===1?'has':'have'} no text here.`,'']:[])].join('\n');
 await add('README.md',readme);
 return {name,files};
}

// A package as one .zip file.
export async function zipPackage(pack:Package,onProgress?:Progress):Promise<Uint8Array>{
 const JSZip=(await import('jszip')).default,zip=new JSZip();
 for(const file of pack.files)zip.file(file.path,file.data instanceof Blob?new Uint8Array(await file.data.arrayBuffer()):file.data);
 await onProgress?.('Compressing the files');
 let shown=-1;
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}},update=>{const percent=Math.floor(update.percent/5)*5;if(percent!==shown){shown=percent;void onProgress?.(`Compressing the files (${percent}%)`);}});
}
