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
import {fileHash,fullestRun,requestFinder,requestLines,requestParts,requestRecord,responseRecord,runFolder,runOutputLimit,runRequests,type DocumentReader,type ExportStudy,type RequestLine,type RunRequests,type SentRequest} from './export-data';
import {fillScript,keyVariable,SCRIPT_TEMPLATE,scriptValues,withoutTemplateLine} from './export-python';
import {codebook,codebookRecord,corpusColumnNames,corpusRecords,corpusTable,docIdOf,failureOf,fieldKeys,hashOf,modeOf,MODEL_DEFAULT,promptHashes,requestsTable,resultsTable,runFacts,runsOverview,sourceName,splitRecord,thinkingOf,type RunFacts,type Table} from './export-tables';
import {buildWorkbook,isProse,type Sheet} from './export-workbook';
import {dateStamp,exportStem,publicColumns,runLines,sourceOf,unitOf,type RunLine} from './export';
import {BOOTSTRAP_RESAMPLES,fixed,fmtStat} from './metrics';
import {toCsv} from './parse-table';
import {rowForRun,runState,type Row} from './runs';
import {tiedVote} from './repeats';
import {officialUrl} from './requests';
import {plainMethod,sampleNote} from './sample';
import {fieldLabel} from './view';
import {offScaleLeftOut} from './scale-combine';

// Told each step as it starts: "Computing agreement", or the file about to be written.
export type Progress=(step:string)=>void|Promise<void>;
export type PackageFile={path:string;data:string|Uint8Array|Blob};
// warning: what the package lacks that it should have (a research repository without its study backup), to say on
// the page as well as in the README.
export type Package={name:string;files:PackageFile[];warning?:string};
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
// lean (the supplementary repository): the replies are without the provider's IDs.
const logNote=(lean:boolean)=>`Each line starts with doc_id, replicate, and attempt. In requests.jsonl, \`request\` is the request as it was sent, with the document put back where it was (API keys travel in request headers and are never included). In responses.jsonl, \`response\` holds what was kept of the reply: the text the model returned, the summary of its reasoning where the run asked for one, the model the provider named, the stop reason, ${lean?'and the token counts':'the token counts, and the response ID'}, not the provider’s whole response; a failed attempt that was sent again also has its status, error, and parse_error.`;
// A request that was not kept when it was sent (a run made before requests were kept; see requestOf).
const REBUILT_NOTE='`recorded` is false for a request that was not kept when it was sent: it was built again from the run’s settings, so it shows what those settings give, not a copy of what was sent (`answer_format_unchanged`, where it is given, says whether the answer format kept with the result is the one the rebuilt request has).';
// What the times of a request sent through a provider's batch interface are.
const BATCH_TIMES_NOTE='For a request sent through the provider’s batch interface, `requested_at` is when its batch was submitted and `completed_at` when its results were collected, which can be long after the provider produced them.';
// Why a prompt taken from a request body has another hash than prompt.txt.
const hashNote=(system:boolean,folder:string)=>`The prompt hash is the first 12 hexadecimal digits of the SHA-256 of ${system?'the prompt and the system prompt together (as the JSON list `["<prompt>","<system prompt>"]`)':`\`${folder}prompt.txt\``}, in UTF-8 and as written (line breaks as LF). Inside the request bodies the prompt has CR LF line breaks, as it was sent, so the prompt copied from a request gives another hash until its line breaks are changed back.`;
// What OpenAI's cache option says where caching was off.
const CACHE_OPTION_NOTE='An OpenAI request made with prompt caching off carries `"prompt_cache_options": {"mode": "explicit"}` and marks no part of the request to cache: with that option nothing is cached unless a part is marked, so this is how caching is turned off.';

// The documents of a set of texts, read once. A PDF was sent as a file: it has no text, and the file goes
// into the package under `folder`.
type Corpus={texts:Map<string,string>;files:Map<string,string>;pdfs:{path:string;file:File}[];unread:number};
// run: the run whose requests the corpus shows. A Model knowledge subject is read as its run's requests carried it
// (with the web research of a web-assisted run, and in the earlier layout for a run made in it).
async function readCorpus(ctx:ExportContext,rows:Row[],folder:string,keepFiles:boolean,run?:number):Promise<Corpus>{
 const corpus:Corpus={texts:new Map(),files:new Map(),pdfs:[],unread:0},taken=new Set<string>(),unit=unitOf(ctx.study.dataset);
 const knowledge=ctx.study.dataset.kind==='knowledge',sentWith=(row:Row):Row|undefined=>{
  const made=(result:Row)=>result.prompt!==undefined&&result.status!=='pending';
  const result=run===undefined?row:rowForRun(row,run);
  return made(result)?result:undefined;
 };
 for(const [i,row] of rows.entries()){
  if(i%100===0)await ctx.onProgress?.(`Reading the ${unit}s (${count(i)} of ${count(rows.length)})`);
  const doc=await ctx.read(row,knowledge?sentWith(row):undefined);
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
// PDF is in the package (absent when it is not included). lean (the supplementary repository): without the
// provider's IDs of a reply and its batch, which point into the researcher's own account, and `recorded` only
// where a request was not kept when it was sent.
async function runLogs(ctx:ExportContext,run:number,find:(row:Row,result:Row)=>SentRequest|undefined,filePath:(row:Row)=>string|undefined,lean=false):Promise<{requests:Blob;responses:Blob}>{
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
  const {request,recorded:_recorded,...kept}=requestRecord(sent,doc,result,pdf),{status,error,...whole}=responseRecord(result),failure=failureOf(result);
  const {response_id:_id,batch_id:_batch,...short}=whole,reply=lean?short:whole;
  requests.push({...head,request,run,...(replaced?{sent_again:true}:{}),...(sent&&!(lean&&sent.recorded)?{recorded:sent.recorded}:{}),...kept});
  responses.push({...head,...(replaced?{status,error:failure.error||null,parse_error:failure.parseError||null}:{}),response:reply,run,...(replaced?{sent_again:true}:{status,...(status==='ok'?{}:{error:failure.error||null,parse_error:failure.parseError||null})})});
 }
 return {requests:jsonLines(requests),responses:jsonLines(responses)};
}

// The temperature a run was sent with: what its request says, or what the run's setup records.
const temperatureOf=(run:RunFacts['run'],parts?:{temperature?:number}):number|string=>parts?.temperature??run.temperature??MODEL_DEFAULT;
const explanationRequested=(facts:RunFacts)=>!facts.run.answerSettings?.plain&&(facts.run.answerSettings?.rationale!==false||facts.run.answerFields.some(name=>name.toLowerCase()==='explanation'));
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
const NOT_KEPT='Not kept when it was sent: built again from the run’s settings.';
function runRecord(study:ExportStudy,report:RunReport,exportedAt:string){
 const {dataset}=study,{facts,hash,sent}=report,{run}=facts,unit=unitOf(dataset),frame=(sent.text||sent.pdf)?.frame,parts=frame?requestParts(frame):undefined,known=facts.tokens.knownFor>0;
 // Every different body of the run's requests with the number of its requests, the most used first (a run can
 // hold several: part of it sent through the batch interface, or, in Model knowledge, requests to several models).
 const bodies=sent.bodies.map(body=>({kind:body.kind as string,requests:body.count,recorded:body.recorded,...(body.recorded?{}:{note:NOT_KEPT}),url:body.frame.url,body:JSON.parse(body.frame.body)}));
 // Scores off the study's scale left out when a text's annotations were combined, because another was on it (scale-combine.ts).
 const offScale=run.answerSettings?.plain&&(run.repeats||1)>1?offScaleLeftOut(dataset.rows,run.number,dataset.scoreScale):0;
 // Texts whose majority vote was tied, by field (kept as "a | b"; see repeats.ts).
 const voted=votedFields(run),keys=fieldKeys(run.answerFields,new Set(run.answerFields)),done=voted.length?dataset.rows.map(row=>rowForRun(row,run.number)).filter(result=>result.status==='done'):[];
 const ties=Object.fromEntries(voted.map(name=>[name?keys[run.answerFields.indexOf(name)]:'score',done.filter(result=>tiedVote(result,name)).length]));
 // How the run's texts were split, where any is a part of a longer text.
 const split=splitRecord(report.rows);
 return {
  exported_at:exportedAt,study:study.name,
  // Notes kept with the study: how each sample was drawn (rule and seed).
  study_notes:dataset.samples.map(sampleNote).join('\n')||null,
  // finished_at: when the run's last reply was produced (null: not finished, or a batch whose end the provider's
  // record of it was not kept for). results_collected_at: when the last results of a batch were collected.
  run:{number:run.number,...(run.label?{label:run.label}:{}),...(run.scope?{scope:run.scope}:{}),started_at:run.startedAt,finished_at:facts.ended||null,...(facts.collected?{results_collected_at:facts.collected}:{}),status_when_exported:runState(dataset.rows,run) as string,processing:modeOf(facts.processing),batch_ids:facts.batchIds},
  model:{provider:run.provider,requested:run.model,reported_by_api:facts.models,reasoning_effort:run.effort||MODEL_DEFAULT,reasoning_summary_requested:run.summary==='in part'?'in part':run.summary==='on',temperature:temperatureOf(run,parts),max_output_tokens:runOutputLimit(run,sent)},
  prompt:{version:run.promptVersion,sha256_prefix:hash,answer_format:run.answerSettings?.plain?'plain text':'structured',explanation_requested:explanationRequested(facts),answer_fields:run.answerFields,answer_settings:run.answerSettings??null,system_prompt:run.system??null,...(run.answerSettings?.plain&&dataset.scoreScale?{score_scale_for_statistics:{...dataset.scoreScale,sent_to_model:false}}:{})},
  options:{annotations_per_text:run.repeats||1,prompt_caching:run.caching,...(dataset.kind==='knowledge'?{web_search:run.webSearch}:{})},
  // The bodies of the run's requests, with marks where each document goes (<<DOCUMENT_FILENAME>>, <<DOCUMENT_TEXT>>, <<FILE_BASE64>>).
  // recorded: false for a request that was not kept when it was sent, built again from the run's settings.
  requests_as_sent:{different_bodies:sent.forms,bodies},
  corpus:{[`n_${unit}s_in_run`]:facts.texts,[`n_${unit}s_with_usable_annotation`]:facts.usable,[`n_${unit}s_all_requests_failed`]:facts.allFailed,[`n_${unit}s_without_result_yet`]:facts.active,...((run.repeats||1)>1?{[`n_${unit}s_with_fewer_usable_annotations`]:run.fewer}:{}),...(voted.length?{[`n_${unit}s_with_tied_votes`]:ties}:{}),...(split?{split}:{})},
  // total, ok, failed: each text's last request in the run (with several annotations per text, the last request
  // for each annotation). replaced_by_retries: failed attempts that were sent again. last_completed_at: when the
  // last reply was produced (null for a batch without the provider's time for its end); last_results_collected_at:
  // when the last results of a batch were collected.
  requests:{total:facts.requests.total,ok:facts.requests.ok,failed:facts.requests.failed,replaced_by_retries:facts.requests.replaced,...(facts.requests.replaced?{sent_in_all:facts.requests.total+facts.requests.replaced}:{}),first_requested_at:facts.requests.first||null,last_completed_at:facts.requests.lastReply||null,...(facts.requests.lastCollected?{last_results_collected_at:facts.requests.lastCollected}:{}),...(offScale?{scores_off_scale_left_out_when_combined:offScale}:{})},
  // reasoning: null where no request's provider reported a count of its own (not known, which is not zero).
  tokens:known?{input:facts.tokens.input,output:facts.tokens.output,reasoning:facts.tokens.reasoningKnownFor?facts.tokens.reasoning:null,cache_read:facts.tokens.cacheRead,cache_write:facts.tokens.cacheWrite,known_for_requests:facts.tokens.knownFor}:null,
 };
}
type RunRecord=ReturnType<typeof runRecord>;
// Whether a run covered only part of the study's texts (a sample, checked texts, one text).
const partOfStudy=(dataset:ExportStudy['dataset'],facts:RunFacts)=>facts.texts<dataset.rows.filter(row=>!row.removedAt).length;
// metadata.json of the supplementary repository: the run's record without its label or batch IDs, the system
// prompt or answer settings (prompt/ holds them), and counters that are 0 (the totals always); the output schema
// is named where the request bodies hold it (prompt/output_schema.json). Which texts the run covered and the
// study's notes on how its samples were drawn stay only where the run covered part of the study (partial).
// `recorded` stays only where a body was not kept when it was sent, and a time only where there is one.
function publicRecord(record:RunRecord,unit:string,schema:unknown,partial:boolean):Record<string,unknown>{
 const {study_notes,run,prompt,requests_as_sent,corpus,requests,...rest}=record;
 const {label:_label,scope,batch_ids:_batches,status_when_exported,finished_at,...runRest}=run as typeof run&{label?:string;scope?:string};
 const nonZero=(o:Record<string,unknown>,always:string[])=>Object.fromEntries(Object.entries(o).filter(([key,value])=>always.includes(key)||(value!==0&&value!==null&&value!==undefined)));
 const shown=JSON.stringify(schema),named=(value:unknown):unknown=>schema!==undefined&&JSON.stringify(value)===shown?'see prompt/output_schema.json':Array.isArray(value)?value.map(named):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,named(item)])):value;
 const tiedKey=`n_${unit}s_with_tied_votes`,tied=nonZero((corpus as Record<string,unknown>)[tiedKey] as Record<string,unknown>||{},[]);
 // In the order of run.json: number, scope, the times, the status, and how the requests were sent.
 const {number,started_at,...runLast}=runRest;
 const lean:Record<string,unknown>={...rest,
  ...(partial&&study_notes?{study_notes}:{}),
  run:{number,...(partial&&scope?{scope}:{}),started_at,...(finished_at?{finished_at}:{}),...runLast,...(status_when_exported!=='completed'?{status_when_exported}:{})},
  // The answer fields only where the schema has them under short keys (f0, f1, …).
  prompt:{version:prompt.version,sha256_prefix:prompt.sha256_prefix,answer_format:prompt.answer_format,explanation_requested:prompt.explanation_requested,...(prompt.answer_format==='structured'&&!prompt.answer_settings?.named&&prompt.answer_fields.length?{answer_fields:prompt.answer_fields}:{}),...('score_scale_for_statistics' in prompt?{score_scale_for_statistics:prompt.score_scale_for_statistics}:{})},
  requests_as_sent:{...(requests_as_sent.different_bodies>1?{different_bodies:requests_as_sent.different_bodies}:{}),bodies:requests_as_sent.bodies.map(({recorded,...body})=>({...(recorded?{}:{recorded}),...body,body:named(body.body)}))},
  corpus:{...nonZero({...corpus,[tiedKey]:undefined},[`n_${unit}s_in_run`,`n_${unit}s_with_usable_annotation`]),...(Object.keys(tied).length?{[tiedKey]:tied}:{})},
  requests:nonZero(requests,['total','ok','failed','first_requested_at'])};
 // In the order of the whole record.
 return Object.fromEntries(Object.keys(record).filter(key=>key in lean).map(key=>[key,lean[key]]));
}

// The Settings sheet of the workbook. After the common rows: web search (Model knowledge), and the prompt as sent
// where the Lab added instructions of its own to it (addedInstructions). A run with a batch has the time its
// results were collected, and Finished only where the provider's time for the end of the batch was kept.
function settingsTable(study:ExportStudy,facts:RunFacts,hash:string,sent:RunRequests):Table{
 const {dataset}=study,{run}=facts,unit=unitOf(dataset),frame=(sent.text||sent.pdf)?.frame,parts=frame?requestParts(frame):undefined,notes=dataset.samples.map(sampleNote).join('\n');
 const ended:Table=run.active?[['Finished','not finished when exported (the results so far)']]:[...(facts.ended?[['Finished',facts.ended]]:[]),...(facts.collected?[['Batch results collected',facts.collected]]:[])];
 return [['setting','value'],['Study',study.name],...(notes?[['Study notes (e.g. how samples were drawn)',notes]]:[]),['Run','#'+run.number+(run.label?` (${run.label})`:'')],['Started',run.startedAt],...ended,
  ['Provider',run.provider],['Model',run.model],['Effort / reasoning',run.effort||MODEL_DEFAULT],['Thinking',thinkingOf(run)||'n/a (reasoning controlled by effort)'],['Temperature',temperatureOf(run,parts)],['Max output tokens',runOutputLimit(run,sent)],[`Annotations per ${unit}`,(run.repeats||1)>1?`${run.repeats} (the Results sheet has the combined answers; By replicate has each annotation)`:1],
  ['Prompt caching',run.caching],['Mode',modeOf(facts.processing)],
  ['Prompt version',`v${run.promptVersion} (${hash})`],[`Prompt (sent with each ${unit})`,run.prompt],['System prompt',run.system||'(none)'],['Output',parts?.schema?JSON.stringify(parts.schema):run.answerSettings?.plain?'plain text':'not recorded'],
  ...(dataset.kind==='knowledge'?[['Web search',run.webSearch?'yes':'no']]:[]),
  ...(parts?.prompt&&addedInstructions(dataset,run)?[['Prompt as sent',parts.prompt]]:[])];
}
// Whether the Lab added instructions of its own after a run's prompt: the standard Lab's answer format (runs
// before fields went under their own names), or Model knowledge's paragraph where it was not in the prompt box.
const addedInstructions=(dataset:ExportStudy['dataset'],run:RunLine)=>dataset.kind==='knowledge'&&!run.answerSettings?.inPrompt||!(run.answerSettings?.plain||run.answerSettings?.named);

// What is computed once for a run and used by its workbook, its tables, and its README. rows: the texts the run
// sent a request for, in the study's order.
type RunReport={facts:RunFacts;hash:string;sent:RunRequests;rows:Row[];agreement:AgreementLine[];pairs:LabelPair[];skipped:Skipped[]};
async function reportRun(ctx:ExportContext,run:number,hashes:Map<string,string>,find=requestFinder(ctx.study),lines:RequestLine[]=requestLines(ctx.study.dataset)):Promise<RunReport>{
 const {dataset}=ctx.study,line=runLines(dataset).find(candidate=>candidate.number===run);
 if(!line)throw new Error(`Run ${run} has no results.`);
 await ctx.onProgress?.(`Computing agreement for run ${run}`);
 const {lines:agreement,pairs,skipped}=await runAgreement(dataset,run,ctx.intervals);
 const ids=new Set(lines.filter(item=>item.run===run).map(item=>item.row.id));
 return {facts:runFacts(dataset,line,lines),hash:hashOf(hashes,line.prompt,line.system),sent:runRequests(ctx.study,run,find,lines),rows:dataset.rows.filter(row=>ids.has(row.id)),agreement,pairs,skipped};
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
// A run's table of requests without those columns, and with doc_id and replicate first (what a row is, before
// what it holds). Public (the supplementary repository): also without model_reported where the provider named
// one model throughout, without response_id (the provider's ID of a reply, which points into the researcher's own
// account), and, with one annotation per text, without replicate and the answers, which results.csv gives (a
// plain-text reply stays where a failed request has one). web_search (Model knowledge) goes where it is the same
// throughout.
function leanRequests(table:Table,lean?:{reps:number}):Table{
 const [header,...rows]=table,at=(name:string)=>header.indexOf(name),drop=new Set<number>();
 const same=(i:number)=>i>=0&&rows.every(row=>row[i]===rows[0][i]);
 // (Where settings vary within the run, as the runs table then says, the provider, model, and prompt stay.)
 for(const name of RUN_CONSTANTS)if(at(name)>=0&&(name==='latency_ms'||same(at(name))))drop.add(at(name));
 for(const name of BLANK_UNLESS_USED)if(at(name)>=0&&rows.every(row=>unused(row[at(name)])))drop.add(at(name));
 if(same(at('web_search')))drop.add(at('web_search'));
 if(lean){
  if(same(at('model_reported')))drop.add(at('model_reported'));
  if(at('response_id')>=0)drop.add(at('response_id'));
  if(lean.reps===1){
   const status=at('status'),end=header.findIndex((name,i)=>i>status&&['rationale','reasoning_summary','parse_error'].includes(String(name)));
   drop.add(at('replicate'));if(at('rationale')>=0)drop.add(at('rationale'));
   for(let i=status+1;i<end;i++)if(!(header[i]===PLAIN_FIELD&&rows.some(row=>row[status]==='error'&&row[i]!=='')))drop.add(i);
  }
 }
 const first=[at('doc_id'),at('replicate')].filter(i=>i>=0),order=[...first,...header.map((_,i)=>i).filter(i=>!first.includes(i))].filter(i=>!drop.has(i));
 return table.map(row=>order.map(i=>row[i]));
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
 const results=resultsTable(study,run),all=requestsTable(study,[run],hashes),requests=leanRequests(all);
 // The answers stand between status and the columns of the request's own (rationale on): counted before the lean
 // table drops empty columns, so that answers stay numbers when rationale, reasoning summary, and parse error are all left out.
 const from=requests[0].indexOf('status'),answers=all[0].findIndex(column=>['rationale','reasoning_summary','parse_error'].includes(String(column)))-all[0].indexOf('status')-1,to=from+answers+1;
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
// fields), those of a prompt version (prompts/vN/: the prompt and its system prompt, which make the version),
// or those of a run (runs/run-NN/: runs of one version can ask for different answer fields, so the codebook and
// the schema are each run's own).
function promptFiles(study:ExportStudy,report:RunReport,which:'all'|'version'|'run'):PackageFile[]{
 const {run}=report.facts,frame=(report.sent.text||report.sent.pdf)?.frame,sent=frame?requestParts(frame):undefined,plain=Boolean(run.answerSettings?.plain);
 const prompt:PackageFile[]=[{path:'prompt.txt',data:run.prompt},...(run.system?[{path:'system_prompt.txt',data:run.system}]:[])];
 if(which==='version')return prompt;
 return [...(which==='all'?prompt:[]),
  ...(which==='all'?[]:[{path:'codebook.md',data:codebook(run.answerFields,run.answerSettings,study.dataset.kind==='knowledge')}]),...(sent?.schema?[{path:'output_schema.json',data:pretty(sent.schema)}]:[]),...(plain||which==='all'?[]:[{path:'codebook.json',data:pretty(codebookRecord(run.answerFields,run.answerSettings))}]),
  ...(sent?.prompt&&addedInstructions(study.dataset,run)?[{path:'prompt_as_sent.txt',data:sent.prompt}]:[])];
}
// The placeholders of a run's prompt that were filled in for each text, read from the marks of its request.
const runInserts=(sent:RunRequests):string[]=>markedInserts((sent.text||sent.pdf)?.frame.body||'');
// Where the corpus table holds the values of each: {{id}} is the text's doc_id (idColumn), {{meta.<column>}} a
// metadata column. One whose column the study no longer has as metadata (removed, or now human labels): null where
// it held no value in the run's requests (the script fills in nothing, as the run did), else the column's own name,
// which the corpus then lacks, so the script stops and asks for it (goneInserts) instead of sending nothing.
// withFiles: the package's corpus table has a `file` column for PDFs (a metadata column named file is then meta_file).
function insertColumns(dataset:ExportStudy['dataset'],names:string[],run:number,withFiles:boolean):[string,string|null][]{
 const columns=corpusColumnNames(dataset,withFiles),valued=valuedInserts(dataset,run);
 return names.map(name=>{
  if(name==='id')return [name,idColumn(dataset,run)];
  const index=columnIndex(dataset.columns,name.slice(5));
  return [name,index>=0&&dataset.columns[index].role==='meta'?columns[index]:valued.has(name)?name.slice(5):null];
 });
}
// The {{meta.<column>}} placeholders of a run that held values in its requests but whose column the study no longer
// has as metadata: the column names the script asks for.
function goneInserts(dataset:ExportStudy['dataset'],names:string[],run:number):string[]{
 const valued=valuedInserts(dataset,run);
 return names.filter(name=>name.startsWith('meta.')&&valued.has(name)&&!(c=>c>=0&&dataset.columns[c].role==='meta')(columnIndex(dataset.columns,name.slice(5)))).map(name=>name.slice(5));
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
// The texts of a run with, in each metadata column a placeholder of its prompt read, the value the run sent (kept
// with each result), not the study's value of today: the corpus of a run's package is what its script sends again.
function sentValues(dataset:ExportStudy['dataset'],rows:Row[],run:number):Row[]{
 const sent=new Map<string,Map<number,string>>();
 for(const line of requestLines(dataset)){
  if(line.run!==run||!Array.isArray(line.result.inserts))continue;
  for(const [name,value] of insertMap(String(line.result.prompt??''),line.result.inserts)){
   if(!name.startsWith('meta.'))continue;
   const c=columnIndex(dataset.columns,name.slice(5));if(c<0||dataset.columns[c].role!=='meta')continue;
   const own=sent.get(line.row.id)??new Map<number,string>();if(!own.has(c))own.set(c,value);sent.set(line.row.id,own);
  }
 }
 if(!sent.size)return rows;
 return rows.map(row=>{const own=sent.get(row.id);if(!own)return row;const cells=[...(row.cells||[])];for(const [c,value] of own){while(cells.length<c)cells.push('');cells[c]=value;}return {...row,cells};});
}
// The placeholders that held a value in at least one request of a run, read from the values kept with its
// results. One that names a column of human labels, no column at all, or an empty column held none.
function valuedInserts(dataset:ExportStudy['dataset'],run:number):Set<string>{
 const valued=new Set<string>();
 for(const line of requestLines(dataset))if(line.run===run&&Array.isArray(line.result.inserts))for(const [name,value] of insertMap(String(line.result.prompt??''),line.result.inserts))if(value!=='')valued.add(name);
 return valued;
}
// The script that sends a run's requests again; template: with its template (the research repository). No script:
// a run whose requests carried web search results collected for each subject (the search is a step of its own),
// or a run without a known request.
function scriptFiles(study:ExportStudy,report:RunReport,exportedAt:string,withFiles=false,template=false):{files:PackageFile[];why:string}{
 const {facts,sent}=report,{run}=facts;
 if(facts.webSearch)return {files:[],why:'No script is included: each request of this run carried web search results collected for its subject in a step of its own, which a script cannot repeat as it was.'};
 if(!sent.text&&!sent.pdf)return {files:[],why:'No script is included: the settings of this run’s requests were not recorded.'};
 // A script sends the researcher's key: only ever to the provider's own address.
 if([sent.text,sent.pdf].some(part=>part&&!officialUrl(part.frame.url,run.provider)))return {files:[],why:'No script is included: the recorded address of this run’s requests is not the provider’s own.'};
 const other=sent.total-(sent.text?.count||0)-(sent.pdf?.count||0)-sent.unknown;
 const notes=[other>0?`${count(other)} of the run’s ${count(sent.total)} requests had another body (for example, sent through the provider’s batch interface, or with another answer format); this script sends every document with the body most of them had.`:'',
  facts.processing!=='instant'?'The run used the provider’s batch interface; this script sends the same request bodies one by one.':'',
  // The body is the run's own only where it was kept when the run was made.
  [sent.text,sent.pdf].some(part=>part&&!part.recorded)?'The request body below was not kept when the run was made: it was built again from the run’s settings.':''].filter(Boolean);
 // Lines of at most about 78 characters, as in the rest of the script's opening text.
 const wrap=(text:string)=>text.split(' ').reduce<string[]>((lines,word)=>{const last=lines[lines.length-1];if(last!==undefined&&(last+' '+word).length<=78)lines[lines.length-1]=last+' '+word;else lines.push(word);return lines;},[]).join('\n');
 // columns: each answer field's column in the run's results tables, so that the script's results.csv has the same names.
 const values=scriptValues({studyName:study.name,runDescription:`#${run.number}, started ${run.startedAt}; exported ${exportedAt}`,provider:run.provider as Provider,text:sent.text?.frame,pdf:sent.pdf?.frame,fields:run.answerFields,columns:fieldKeys(run.answerFields,new Set(run.answerFields)),plain:Boolean(run.answerSettings?.plain),settings:run.answerSettings,repeats:run.repeats||1,note:notes.map(wrap).join('\n'),inserts:insertColumns(study.dataset,runInserts(sent),run.number,withFiles),knowledge:study.dataset.kind==='knowledge'});
 const script=fillScript(SCRIPT_TEMPLATE,values);
 return {files:template?[{path:'annotate_template.py',data:SCRIPT_TEMPLATE},{path:'annotate.py',data:script}]:[{path:'annotate.py',data:withoutTemplateLine(script)}],why:''};
}

// How a run that annotated each text several times combined its answers, in one line (empty for one annotation
// per text). Kept at the owner's request (November 16, 2026): nothing else in the package says it.
function combiningLine(study:ExportStudy,report:RunReport,record:RunRecord):string{
 const {run}=report.facts,unit=unitOf(study.dataset),reps=run.repeats||1;
 if(reps<2)return '';
 const head=`Each ${unit}’s ${reps} annotations were combined`,typeOf=(name:string)=>fieldSpec(run.answerSettings,name)?.type;
 if(run.answerSettings?.plain){
  const offScale=record.requests.scores_off_scale_left_out_when_combined??0;
  return `${head}: numbers in the answers by the median, other values by the most frequent value${offScale?`; a score off the scale was left out where another annotation of the same ${unit} was on it`:''}.`;
 }
 const voted=votedFields(run).length>0;
 const kinds=([[voted,'categorical labels by the most frequent value'],[run.answerFields.some(name=>typeOf(name)==='ordinal'),'ordinal labels by the median'],[run.answerFields.some(name=>typeOf(name)==='number'),'numbers by the mean'],[run.answerFields.some(name=>typeOf(name)==='text'&&!/(^|_)(explanation|reasoning)$/i.test(name)),'free text by the most frequent exact wording']] as [boolean,string][]).filter(kind=>kind[0]).map(kind=>kind[1]);
 return `${head}${run.answerFields.some(name=>typeOf(name))&&kinds.length?': '+listed(kinds):' by the most frequent value'}${voted?'; a tied vote is kept as both values (for example, “a | b”) and is left out of the agreement figures':''}.`;
}

const tableRow=(cells:(string|number)[])=>'| '+cells.join(' | ')+' |';
// A run whose results were not all made with the same settings (a run without a record of its own, as in Model
// knowledge, can hold requests to several models or with several prompts): the models and the number of prompts
// of its request bodies, in a sentence.
function mixedWarning(report:RunReport):string{
 const {sent}=report,models=new Map<string,number>(),prompts=new Set<string>();
 for(const body of sent.bodies){
  let parts:{model:string;prompt:string}|undefined;try{parts=requestParts(body.frame);}catch{/* a body that cannot be read is counted without a model */}
  const model=parts?.model||'unknown model';models.set(model,(models.get(model)||0)+body.count);prompts.add(parts?.prompt??'');
 }
 const perModel=[...models].map(([model,n])=>`\`${model}\` (${count(n)} request${n===1?'':'s'})`);
 return `**The results of this run were not all made with the same settings.** Its ${count(sent.total)} requests had ${sent.forms} different request bodies: ${models.size>1?`${models.size} models, ${listed(perModel)}`:`one model, ${perModel[0]}`}, and ${prompts.size===1?'one prompt':`${prompts.size} different prompts`}. The summary below and \`prompt/\` give the settings and the prompt that most of its requests had; \`metadata.json\` holds every body with the number of its requests, and \`results/results_by_replicate.csv\` gives the provider, model, and prompt hash of each request.`;
}
// How the run's texts were split, in a sentence (empty: none is a part of a longer text).
function splitLine(record:RunRecord):string{
 const split=record.corpus.split as {n_chunks:number;n_source_documents:number;chunk_words:unknown;chunk_method:unknown}|undefined;
 if(!split)return '';
 const one=(value:unknown)=>Array.isArray(value)?listed(value.map(String)):String(value),method=(value:unknown)=>one(Array.isArray(value)?value.map(methodWords):methodWords(value));
 return `${count(split.n_chunks)} of the run’s texts ${split.n_chunks===1?'is a part':'are parts'} of ${count(split.n_source_documents)} longer text${split.n_source_documents===1?'':'s'} that ${split.n_source_documents===1?'was':'were'} split before annotation, into parts of about ${one(split.chunk_words)} words (${method(split.chunk_method)}). \`source_document\` and \`chunk\` say which part of which text a row is.`;
}
const methodWords=(method:unknown)=>method==='sentences'?'ending at sentence boundaries where possible':method==='exact-words'?'cut at exact word counts':String(method);
// The agreement figures as a Markdown table, with what the brackets and the counts mean.
function agreementSection(study:ExportStudy,report:RunReport):string[]{
 if(!report.agreement.length&&!report.skipped.length)return [];
 const unit=unitOf(study.dataset),ci=(range:[number,number]|null|undefined,percent=false)=>range?` [${percent?(range[0]*100).toFixed(1):fixed(range[0],2)}, ${percent?(range[1]*100).toFixed(1):fixed(range[1],2)}]`:'';
 const lines=['## Agreement with human labels',''];
 if(report.agreement.length){
  lines.push(tableRow(['Field','Annotations','Compared with','N compared (of labeled)','% agreement','Cohen’s κ','Krippendorff’s α','Gwet’s AC1']),'|---|---|---|---|---|---|---|---|');
  for(const a of report.agreement){
   const s=a.stats;
   lines.push(tableRow([fieldLabel(a.field),a.source,a.comparedWith,`${s.n} (of ${a.withLabel}${s.leftOut.n?`; ${s.leftOut.n} left out`:''})`,s.percentAgreement===null?'—':(s.percentAgreement*100).toFixed(1)+'%'+ci(s.ci.percentAgreement,true),fmtStat(s.cohenKappa)+ci(s.ci.cohenKappa),`${fmtStat(s.krippendorffAlpha)}${ci(s.ci.krippendorffAlpha)} (${s.level})`,fmtStat(s.gwetAC1)+ci(s.ci.gwetAC1)]));
  }
  const withIntervals=report.agreement.filter(a=>Object.values(a.stats.ci).some(Boolean)).length;
  // Parts of split texts are compared one by one: the intervals treat them as independent, which parts of the same
  // longer text need not be.
  const parts=report.rows.filter(row=>row.sourceId),sources=new Set(parts.map(row=>String(row.sourceId))).size;
  const partsNote=withIntervals&&parts.length>sources?` Each part of a split text counts as one ${unit} here, and the intervals treat the parts as independent; ${count(parts.length)} of the ${unit}s are parts of ${count(sources)} longer text${sources===1?'':'s'}, so the intervals may be too narrow for a claim about whole texts.`:'';
  lines.push('',(withIntervals?`Brackets: 95% intervals: Wilson intervals for % agreement, bootstrap intervals (${count(BOOTSTRAP_RESAMPLES)} resamples of ${unit}s) for the coefficients.${withIntervals<report.agreement.length?` A comparison of fewer than 10 ${unit}s has no intervals.`:''}${partsNote}`:`No 95% intervals are given: they need at least 10 compared ${unit}s.`)+` “Of labeled”: this run’s ${unit}s with a value in the “Compared with” column (a missing-value marker such as NA counts as no value). Not compared: ${unit}s without a usable value under Annotations (no usable answer from the model, or no label in that column), and pairs with a value that does not fit the field (“left out”: a word where numbers are compared, such as an answer of NA, a number off the scale, a value that is not one of the field’s categories, or a tie between a text’s annotations with no majority, such as “a | b”). Their number is n_left_out_not_on_scale in agreement.csv.`+(report.agreement.some(a=>a.source!=='model')?` Rows with a column name under Annotations compare two columns of human labels (human–human baseline) on this run’s ${unit}s.`:''));
 }
 if(report.skipped.length)lines.push('',`Label columns not used for agreement: ${report.skipped.map(skip=>`${skip.column} (${skip.reason})`).join(', ')}.`);
 return [...lines,''];
}

// The README of the supplementary repository: what the package holds, and how to send the requests again. It names
// neither the Lab nor its build, and has no text for a paper (the researcher writes that).
function supplementaryReadme(study:ExportStudy,report:RunReport,record:RunRecord,options:SupplementaryOptions,has:{agreement:boolean;script:boolean;scriptWhy:string;schema:boolean;asSent:boolean;files:number;unread:number;answersOnce:boolean;fewer:boolean;source:boolean;partial:boolean;readLeftOut?:string[];gone?:string[]}):string{
 const {dataset}=study,{facts}=report,{run}=facts,unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',plain=Boolean(run.answerSettings?.plain),reps=run.repeats||1;
 // Bodies that were not kept when the run was made are built again from its settings: the package then says so
 // where it would otherwise call them the requests as sent.
 const rebuilt=report.sent.bodies.some(body=>!body.recorded),allRebuilt=rebuilt&&report.sent.bodies.every(body=>!body.recorded);
 // The times of a run: of requests sent one by one, from the first request to the last reply. A batch has the time
 // it was submitted and the time its results were collected here, and the provider's own time for its end where kept.
 const batch=facts.processing!=='instant',times=!batch?[tableRow(['Annotation period',`${facts.requests.first||'—'} to ${facts.requests.last||'—'}`])]:
  [tableRow([facts.processing==='batch'?(facts.batchIds.length>1?'First batch submitted':'Batch submitted'):'First request',facts.requests.first||'—']),...(facts.requests.lastReply?[tableRow([facts.processing==='batch'?'Batch ended (the provider’s time)':'Last reply produced',facts.requests.lastReply])]:[]),tableRow(['Batch results collected',facts.requests.lastCollected||'—'])];
 const sampling=has.partial?dataset.samples.map(sampleNote).join(' '):'',split=splitLine(record);
 const cacheOff=report.sent.bodies.some(body=>body.frame.body.includes('"prompt_cache_options"')&&!body.frame.body.includes('"prompt_cache_breakpoint"'));
 // Placeholders of the prompt that were filled in for each text, and where the corpus holds their values.
 const inserted=runInserts(report.sent),valued=valuedInserts(dataset,run.number),metaFilled=inserted.filter(name=>name!=='id'&&valued.has(name)),unfilled=inserted.filter(name=>!valued.has(name));
 const insertedNote=inserted.length?`. Its placeholders were filled in for each ${unit}: ${[inserted.includes('id')&&valued.has('id')?`\`{{id}}\` with the ${unit}’s ${idColumn(dataset,run.number)==='doc_id'?'doc_id':'name'}`:'',metaFilled.length?`${written(metaFilled)} with its value${metaFilled.length===1?' in that metadata column':'s in those metadata columns'}`:'',unfilled.length?`${written(unfilled)} ${unfilled.length===1?'was':'were'} filled in empty for every ${unit} (${unfilled.length===1?'it names':'they name'} no metadata column, or an empty one)`:''].filter(Boolean).join('; ')}`:'';
 const combining=combiningLine(study,report,record);
 const lines=[`# ${study.name}: LLM annotation materials`,'',
  `Supplementary materials for the LLM-based annotation, exported on ${record.exported_at.slice(0,10)}.`,'',
  ...(run.active?['**This run was not finished when these materials were exported**: they describe the results so far.','']:[]),
  ...(knowledge?['Model knowledge: no texts were supplied. The model judged named subjects from what it has learned.'+(facts.webSearch?' Web search results collected for each subject were supplied with the request.':''),'']:[]),
  ...(run.mixed?[mixedWarning(report),'']:[]),
  '## Summary','','| | |','|---|---|',
  tableRow(['Provider / model',`${run.provider} / \`${run.model}\``]),tableRow(['Model reported by the API',facts.models.map(model=>'`'+model+'`').join(', ')||'—']),tableRow(['Reasoning effort',record.model.reasoning_effort]),tableRow(['Temperature',record.model.temperature]),tableRow(['Max output tokens',record.model.max_output_tokens]),
  ...(has.partial&&run.scope?[tableRow([`${unit==='text'?'Texts':'Subjects'} the run covered`,run.scope])]:[]),
  tableRow([`${unit==='text'?'Texts':'Subjects'} with a usable annotation`,`${facts.usable} of ${facts.texts}`]),tableRow([`Annotations per ${unit}`,reps]),tableRow(['Requests (ok / failed)',`${facts.requests.ok} / ${facts.requests.failed}`]),
  ...(facts.requests.replaced?[tableRow(['Failed attempts sent again',`${facts.requests.replaced} (their tokens are included in the token totals)`])]:[]),
  tableRow(['Requests sent',modeOf(facts.processing)]),...times,tableRow(['Prompt version / hash',`v${run.promptVersion} / \`${report.hash}\``]),'',
  ...(sampling?[`How the study’s samples were drawn: ${sampling}`,'']:[]),
  ...(split?[split,'']:[]),
  ...(combining?[combining,'']:[]),
  ...agreementSection(study,report),
  '## Files','','| File | Contents |','|---|---|',
  tableRow(['`metadata.json`',`Machine-readable record of the model, settings, dates, counts, and token use, with the ${report.sent.forms>1?'different bodies':'body'} of the requests${allRebuilt?', built again from the run’s settings (the requests were not kept when the run was made)':' as sent'}${report.sent.forms>1?', each with the number of its requests':''} (marks stand for the document`+(inserted.length?' and for the values of the prompt’s placeholders':'')+(rebuilt&&!allRebuilt?'; a body marked `"recorded": false` was not kept when it was sent and is built again from the run’s settings':'')+')']),
  tableRow(['`prompt/prompt.txt`','The annotation prompt as written'+insertedNote]),
  ...(has.asSent?[tableRow(['`prompt/prompt_as_sent.txt`','The prompt as each request carried it: '+(added=>added.length?'with the instructions added after it '+added.join(' and ')+', and ':'')([...(plain||run.answerSettings?.named?[]:['on the answer format']),...(knowledge&&!run.answerSettings?.inPrompt?['on judging from learned knowledge']:[])])+'with its line breaks as they were sent (CR LF)'+(inserted.length?'; the placeholders stand where each request had the values':'')+([report.sent.text].some(sent=>sent&&placesText(run.prompt)&&requestParts(sent.frame).prompt.includes('{{text}}'))?`; \`{{text}}\` stands where each request had the ${knowledge?'subject’s fields':unit}`:'')])]:[]),
  ...(run.system?[tableRow(['`prompt/system_prompt.txt`','The system prompt sent unchanged with every request; the prompt opened the message with each '+unit])]:[]),
  ...(has.schema?[tableRow(['`prompt/output_schema.json`','The JSON schema the replies had to follow: each field, its type, and its allowed values'])]:[]),
  tableRow(['`results/results.csv`',`One row per ${unit}${options.texts?` (with ${knowledge?'the details the model was given':'its text'})`:''}: answers${reps>1?` (combined across the ${unit}’s annotations; \`<field>_replicate_agreement\` is the share of them that gave the combined value${has.fewer?`; \`n_ok\` is the number of usable annotations, where a ${unit} has fewer than ${reps}`:''})`:''}, labels, and metadata`]),
  tableRow(['`results/results_by_replicate.csv`',`One row per request${reps>1?` (${unit} × annotation; \`replicate\` numbers a ${unit}’s annotations)`:''}, with status, tokens, and timing${has.answersOnce?' (the annotations are in `results.csv`)':''}${facts.requests.replaced?`; a failed attempt that was sent again is counted in \`metadata.json\`${options.logs?' and kept in the logs':''}`:''}`]),
  ...(has.agreement?[tableRow(['`results/agreement.csv`','Agreement statistics'])]:[]),
  ...(options.texts?[tableRow(['`data/corpus.csv`',`The annotated ${unit}s as they were sent${has.source?', with the name each request gave for the document (`source`)':''}, with labels and metadata`+(has.files?'; a PDF was sent as a file and is in `data/files/`':'')])]:[]),
  ...(options.logs?[tableRow(['`logs/requests.jsonl`, `logs/responses.jsonl`','Every request and what was kept of every reply; a request that was sent again has a line for each attempt (same doc_id and replicate; attempt 1, 2, …)'])]:[]),
  ...(has.script?[tableRow(['`scripts/annotate.py`','Python script that sends the requests again'])]:[]),
  '',...(options.logs?[logNote(true)+' A failed attempt’s request may never have reached the provider (a connection that broke, say).'+(rebuilt?' '+REBUILT_NOTE:''),'']:[]),CSV_NOTE,'',TOKEN_NOTE,'',
  ...(batch?[BATCH_TIMES_NOTE,'']:[]),hashNote(Boolean(run.system),'prompt/'),'',...(cacheOff?[CACHE_OPTION_NOTE,'']:[])];
 if(has.script)lines.push('## Reproducing','','```bash','cd scripts',`export ${keyVariable(run.provider as Provider)}=...`,`python annotate.py ${options.texts?'../data/corpus.csv':'your_corpus.csv'}`,'```','',
  `The script needs Python 3.9 or later and nothing else. ${options.texts&&has.readLeftOut?.length?`\`data/corpus.csv\` leaves out the ${has.readLeftOut.length===1?'column':'columns'} ${listed(has.readLeftOut.map(name=>'`'+name+'`'))}, which the prompt’s placeholders take their values from; add ${has.readLeftOut.length===1?'it':'them'} to the file to run the script. `:''}${has.gone?.length?`The prompt’s ${has.gone.length===1?'placeholder':'placeholders'} ${listed(has.gone.map(name=>'`{{meta.'+name+'}}`'))} took values from ${has.gone.length===1?'a metadata column':'metadata columns'} the study no longer has; the script stops until the corpus has ${has.gone.length===1?'a column':'columns'} ${listed(has.gone.map(name=>'`'+name+'`'))} with the values the requests carried${options.logs?' (see the logs)':''}. `:''}${options.texts?'':`Your corpus file needs a column doc_id and a column text${has.files||report.sent.pdf?' (or file, with the path of a PDF)':''}${[report.sent.text,report.sent.pdf].some(sent=>sent?.frame.body.includes('<<DOCUMENT_FILENAME>>'))?'; a column source gives the name each request states for the document':''}${inserted.length?`; and the columns the prompt’s placeholders take their values from (${insertColumns(dataset,inserted,run.number,Boolean(options.texts&&has.files)).filter(pair=>pair[1]).map(pair=>pair[1]).join(', ')})`:''}. `}${inserted.length?`The script fills in the prompt’s placeholders from the corpus file, which holds the values this run sent, so a value changed there gives another request than the run sent${options.logs?' (the logs hold the requests as they were sent)':''}. `:''}Hosted models may be updated or retired and generation is not fully deterministic, so sending the requests again may not reproduce every answer exactly.`,'');
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
// empty throughout, nothing said twice), nothing that names the Lab or its build, and none of the provider's IDs
// (of a batch or a reply), which point into the researcher's own account.
export async function buildSupplementary(ctx:ExportContext,run:number,options:SupplementaryOptions):Promise<Package>{
 const {study}=ctx,{dataset}=study,exportedAt=(ctx.now||new Date()).toISOString(),name=`${exportStem(study.name,dataset)}_supplementary_${dateStamp(ctx.now||new Date())}`;
 const files:PackageFile[]=[],add=async(path:string,data:PackageFile['data'])=>{await ctx.onProgress?.('Writing '+path);files.push({path:name+'/'+path,data});};
 const hashes=await promptHashes(dataset),find=requestFinder(study),full=await reportRun(ctx,run,hashes,find),record=runRecord(study,full,exportedAt),partial=partOfStudy(dataset,full.facts);
 // A label column left out of the package is left out of its agreement too (agreement.csv and the README).
 const shown=(column:string)=>!options.columns||options.columns.includes(column);
 const report:RunReport={...full,agreement:full.agreement.filter(line=>shown(line.comparedWith)&&(line.source==='model'||shown(line.source))),pairs:full.pairs.filter(pair=>shown(pair.column)),skipped:full.skipped.filter(skip=>shown(skip.column))};
 const rows=report.rows,reps=report.facts.run.repeats||1,corpus=options.texts?await readCorpus(ctx,rows,name+'/data',true,run):undefined;
 // The label and metadata columns chosen, in results.csv and data/corpus.csv alike. A metadata column the prompt's
 // placeholders read that was left out is named in the README, which says the script needs it (readLeftOut).
 const chosen=publicColumns(dataset).filter(c=>!options.columns||options.columns.includes(dataset.columns[c].name));
 const read=new Set(runInserts(report.sent).filter(insert=>insert.startsWith('meta.')).map(insert=>columnIndex(dataset.columns,insert.slice(5))).filter(c=>c>=0&&dataset.columns[c].role==='meta'));
 const corpusNames=corpusColumnNames(dataset,Boolean(corpus?.files.size)),readLeftOut=[...read].filter(c=>!chosen.includes(c)).map(c=>corpusNames[c]??dataset.columns[c].name);
 // source: the name each request gave for its document, only where a request named it (a run made before
 // November 16, 2026, or a PDF sent as a file) or where it says more than the doc_id.
 const frames=[report.sent.text,report.sent.pdf].filter(Boolean).map(sent=>sent!.frame.body);
 const source=frames.some(body=>body.includes('<<DOCUMENT_FILENAME>>'))||!rows.every(row=>{const given=sourceName(dataset,row),id=docIdOf(dataset,row);return !given||given===id||stem(given)===id;});
 const prompt=promptFiles(study,report,'all'),schema=prompt.find(file=>file.path==='output_schema.json');
 await add('metadata.json',pretty(publicRecord(record,unitOf(dataset),schema?JSON.parse(String(schema.data)):undefined,partial)));
 for(const file of prompt)await add('prompt/'+file.path,file.data);
 const results=publicResults(resultsTable(study,run,{texts:corpus?.texts,explanation:options.explanations,columns:chosen,subjectFields:options.texts}),reps);
 await add('results/results.csv',toCsv(results));
 const byRequest=leanRequests(requestsTable(study,[run],hashes,{explanation:options.explanations,reasoning:false}),{reps});
 await add('results/results_by_replicate.csv',toCsv(byRequest));
 if(report.agreement.length)await add('results/agreement.csv',toCsv(agreementTable(report.agreement,agreementKeys(dataset))));
 if(corpus){
  await add('data/corpus.csv',toCsv(corpusTable(dataset,sentValues(dataset,rows,run),corpus.texts,corpus.files,{columns:dataset.columns.map((_,c)=>c).filter(c=>chosen.includes(c)),source})));
  for(const pdf of corpus.pdfs){await ctx.onProgress?.('Writing '+pdf.path.slice(name.length+1));files.push({path:pdf.path,data:pdf.file});}
 }
 if(options.logs){
  const logs=await runLogs(ctx,run,find,row=>corpus?.files.has(row.id)?'data/'+corpus.files.get(row.id):undefined,true);
  await add('logs/requests.jsonl',logs.requests);await add('logs/responses.jsonl',logs.responses);
 }
 const script=scriptFiles(study,report,exportedAt,Boolean(corpus?.files.size));
 for(const file of script.files)await add('scripts/'+file.path,file.data);
 await add('README.md',supplementaryReadme(study,report,record,options,{agreement:report.agreement.length>0,script:script.files.length>0,scriptWhy:script.why,schema:Boolean(schema),asSent:prompt.some(file=>file.path==='prompt_as_sent.txt'),files:corpus?.pdfs.length||0,unread:corpus?.unread||0,
  answersOnce:reps===1,fewer:results[0].includes('n_ok'),source,partial,readLeftOut,gone:goneInserts(dataset,runInserts(report.sent),run)}));
 return {name,files};
}

// backup: whether the study backup goes into the repository (absent: it does). The backup holds the whole study,
// which is more than the repository's tables show: both data sets, and the texts deleted from the study.
export type ResearchOptions={logs:boolean;backup?:boolean};
const DATA_SETS={texts:'uploaded texts',knowledge:'Model knowledge subjects'} as const;
// The whole of one data set of the study (the uploaded texts or the Model knowledge subjects), for the researcher's
// own archive.
export async function buildResearchRepository(ctx:ExportContext,options:ResearchOptions):Promise<Package>{
 const {study}=ctx,{dataset}=study,unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',exportedAt=(ctx.now||new Date()).toISOString(),name=`${exportStem(study.name,dataset)}_research_${dateStamp(ctx.now||new Date())}`;
 const files:PackageFile[]=[],add=async(path:string,data:PackageFile['data'])=>{await ctx.onProgress?.('Writing '+path);files.push({path:name+'/'+path,data});};
 const hashes=await promptHashes(dataset),find=requestFinder(study),lines=requestLines(dataset),withRequests=new Set(lines.map(line=>line.run)),runs=runLines(dataset).filter(run=>run.done+run.failed>0||withRequests.has(run.number));
 const reports=new Map<number,RunReport>();
 for(const run of runs)reports.set(run.number,await reportRun(ctx,run.number,hashes,find,lines));
 // Texts deleted from the study but kept for the runs that used them (lib/research/removed.ts).
 const gone=dataset.rows.filter(row=>row.removedAt).length,inStudy=dataset.rows.length-gone;
 const corpus=await readCorpus(ctx,dataset.rows,name+'/corpus',true);
 await add('study.json',pretty({study:study.name,exported_at:exportedAt,data_set:sourceOf(dataset),[`n_${unit}s`]:inStudy,...(gone?{[`n_${unit}s_deleted_but_kept_for_runs`]:gone}:{}),...(dataset.scoreScale?{score_scale_for_plain_text_scores:dataset.scoreScale}:{}),runs:runs.map(run=>run.number),columns:dataset.columns,samples:dataset.samples.map(sample=>({...sample,method:plainMethod(sample.method)}))}));
 // The only file of the export that names the Lab and its builds (a private record).
 await add('software_versions.json',pretty({note:'The only file of this export that names the app and its builds. Keep it private: do not publish it.',software:'Text Annotation Lab',exported_with:study.lab,exported_at:exportedAt,runs:runs.map(run=>({run:run.number,made_with:reports.get(run.number)!.facts.labs.join('; ')||'not recorded'}))}));
 let backupNote='';const withBackup=Boolean(ctx.backup)&&options.backup!==false;
 if(ctx.backup&&withBackup){
  await ctx.onProgress?.('Writing study-backup.json');
  try{files.push({path:name+'/study-backup.json',data:await ctx.backup()});}
  catch(error){backupNote=error instanceof Error&&error.message?error.message:'The backup could not be made.';}
 }
 await add('corpus/corpus.csv',toCsv(corpusTable(dataset,dataset.rows,corpus.texts,corpus.files)));
 await add('corpus/corpus.jsonl',jsonLines(corpusRecords(dataset,dataset.rows,corpus.texts,corpus.files)));
 for(const pdf of corpus.pdfs){await ctx.onProgress?.('Writing '+pdf.path.slice(name.length+1));files.push({path:pdf.path,data:pdf.file});}
 await add('results/runs.csv',toCsv(runsOverview(study,hashes,run=>reports.get(run)?.sent)));
 await add('results/results_all_runs_long.csv',toCsv(requestsTable(study,undefined,hashes)));
 const versions=new Set<number>();
 // Each prompt version once: the prompt and its system prompt, which make the version. Its answer fields are each
 // run's own (runs of one version can ask for different ones), so the codebook and the schema are in the run's folder.
 for(const run of runs){if(versions.has(run.promptVersion))continue;versions.add(run.promptVersion);for(const file of promptFiles(study,reports.get(run.number)!,'version'))await add(`prompts/v${run.promptVersion}/${file.path}`,file.data);}
 for(const run of runs){
  const report=reports.get(run.number)!,folder=`runs/${runFolder(run.number,run.label)}/`;
  await add(folder+'run.json',pretty(runRecord(study,report,exportedAt)));
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
  script=scriptFiles(study,report,exportedAt,corpus.files.size>0,true);
  for(const file of script.files)await add('scripts/'+file.path,file.data);
 }
 // A prompt of the study has placeholders that were filled in for each text.
 const filled=Boolean(study.requests?.some(request=>markedInserts(request.body).length));
 const all=runs.map(run=>reports.get(run.number)!),has=(path:string)=>files.some(file=>file.path.endsWith('/'+path)),plural=(n:number,word:string)=>`${count(n)} ${word}${n===1?'':'s'}`;
 const mainFolder=main?runFolder(main.number,main.label):'',batch=all.some(item=>item.facts.processing!=='instant'),rebuilt=all.some(item=>item.sent.rebuilt>0);
 // Runs whose results were not all made with the same settings (runs without a record of their own, as in Model knowledge).
 const mixed=runs.filter(run=>run.mixed).map(run=>'#'+run.number);
 // What the study's other data set holds: these files are made from one of the two, the backup from both.
 const other=study.other&&(study.other.rows||study.other.runs)?study.other:undefined,otherUnit=other?unitOf(other):'';
 // The files a run's folder can hold besides its record and tables, where any run has them.
 const runFiles=['codebook.md','codebook.json','output_schema.json','prompt_as_sent.txt'].filter(file=>has(file));
 // Only what the repository holds is listed: a study without runs has no prompts, runs, agreement, workbook, or script.
 const rows:[string,string][]=[['`study.json`',`The ${DATA_SETS[dataset.kind]} at a glance: the study’s name, the number of ${unit}s, the runs, the label and metadata columns, and the samples drawn`],
  ['`software_versions.json`','Which build of the app made each run and wrote this export. The only file here that names the app: keep it private'],
  ...(withBackup?[['`study-backup.json`',backupNote?`Not included: ${backupNote}`:`A backup of the whole study, which holds more than the other files here: both data sets (the uploaded texts with their files, and the Model knowledge subjects), every run, labels, samples, and the texts and subjects deleted from the study. Re-importable via Studies → More options → Import backup. Take it out before passing this folder on if not all of that is meant to go with it`] as [string,string]]:[]),
  ['`corpus/corpus.csv`, `corpus.jsonl`',`Every ${unit} as it was sent, with labels and metadata`+(dataset.rows.some(row=>row.sourceId)?'; for a part of a text that was split, the text it comes from, which part it is, and how the text was split (`chunk_words`, `chunk_method`, `word_start`, `word_end`)':'')+(corpus.pdfs.length?'; a PDF was sent as a file and is in `corpus/files/`':'')],
  ...(runs.length?[['`prompts/vN/prompt.txt`','Each version of the annotation prompt, as written (`prompt_version` in the tables)'] as [string,string]]:[]),
  ...(runs.some(run=>run.system)?[['`prompts/vN/system_prompt.txt`','The system prompt sent unchanged with every request, where a version had one; the prompt then opened the message with each '+unit] as [string,string]]:[]),
  ...(runs.length?[['`runs/run-NN/run.json`','One folder per run (run-NN-<label> for a run with a label). The record of the run: model, settings, dates, counts, token use, and every different body of its requests as sent, with the number of its requests (marks stand for the document'+(filled?' and for the values of a prompt’s placeholders':'')+')'] as [string,string]]:[]),
  ...(runFiles.length?[[listed(runFiles.map((file,i)=>'`'+(i?'':'runs/run-NN/')+file+'`')),'The run’s own answer format (runs of one prompt version can ask for different answer fields): '+listed([...(has('codebook.md')?['the answer fields (their columns, types, allowed values, and descriptions)']:[]),...(has('output_schema.json')?['the JSON schema the replies had to follow (none for plain text)']:[]),...(has('prompt_as_sent.txt')?['for a run whose requests carried instructions added after the prompt (on the answer format, or on judging from learned knowledge), the prompt as each request carried it'+(filled?' (placeholders that were filled in for each '+unit+' stand as written)':'')]:[])])] as [string,string]]:[]),
  ...(runs.length?[['`runs/run-NN/results_long.csv`',`One row per request: answers, rationale (the explanation), status, tokens, and timing; \`replicate\` numbers a ${unit}’s annotations in a run that makes several per ${unit} (a failed attempt that was sent again is counted in \`run.json\`${options.logs?' and kept in the logs':''})`],
   ['`runs/run-NN/results_wide.csv`',`One row per ${unit}: answers, labels, and metadata; in a run that makes several annotations per ${unit}, the answers are the combined ones, and \`<field>_replicate_agreement\` is the share of the ${unit}’s annotations that gave the combined value`]] as [string,string][]:[]),
  ...(runs.length&&options.logs?[['`runs/run-NN/requests.jsonl`, `responses.jsonl`','Every request and what was kept of every reply; a request that was sent again has a line for each attempt (same doc_id and replicate; attempt 1, 2, …)'] as [string,string]]:[]),
  ['`results/runs.csv`',runs.length?'Overview of all runs. `finished_at` is when a run’s last reply was produced: for a batch that is the provider’s own time for the end of the batch, blank where that time was not kept; `results_collected_at` is when the results of a batch were collected':'Overview of all runs (none yet: the column names only)'],['`results/results_all_runs_long.csv`',runs.length?'All requests of all runs in one table':'All requests of all runs in one table (none yet: the column names only)'],
  ...(has('results/agreement.csv')?[['`results/agreement.csv`','Agreement between each run’s answers and the columns of human labels that belong to its answer fields'] as [string,string]]:[]),
  ...(main?[[`\`results/results_${mainFolder}.xlsx\``,`Excel workbook for run #${main.number}, the run with usable answers for the most ${unit}s (the latest of those)`] as [string,string]]:[]),
  ...(script.files.length&&main?[['`scripts/annotate.py`, `annotate_template.py`',`Python script that sends the requests of run #${main.number} again, and its template, which marks every value that comes from the study as a \`{{PLACEHOLDER}}\``] as [string,string]]:[])];
 const readme=[`# ${study.name}: research repository`,'',`Complete record of this study’s ${DATA_SETS[dataset.kind]} and the runs on them, exported on ${exportedAt}.`,'',
  ...(knowledge?['Model knowledge: no texts were supplied. The model judged named subjects from what it has learned.','']:[]),
  `- ${count(inStudy)} ${unit}${inStudy===1?'':'s'}${gone?` (plus ${count(gone)} deleted from the study but kept for the runs that used ${gone===1?'it':'them'}; marked in \`corpus/corpus.csv\`)`:''}, ${runs.length} run${runs.length===1?'':'s'}, ${count(lines.length)} request${lines.length===1?'':'s'} with an outcome.`,
  ...(runs.length?[]:[`- No run has been made on these ${unit}s yet, so there are no prompts, run folders, workbook, or script here.`]),
  ...(other?[`- The study also holds ${DATA_SETS[other.kind]}: ${plural(other.rows,otherUnit)} and ${plural(other.runs,'run')}. They are not in the tables here${withBackup&&!backupNote?', only in `study-backup.json`':''}; export them from the Export tab, with “${other.kind==='knowledge'?'Model knowledge':'Uploaded texts'}” chosen there.`]:[]),
  ...(mixed.length?[`- The results of ${mixed.length===1?'run':'runs'} ${listed(mixed)} were not all made with the same settings: \`results/runs.csv\` notes it, the run’s \`run.json\` holds every different body of its requests with the number of its requests, and its table of requests gives the provider, model, and prompt hash of each.`]:[]),
  ...(ctx.backup&&!withBackup?['- The study backup was left out of this export.']:[]),
  '- API keys are never stored or exported.','',
  '## Layout','','| Path | Contents |','|---|---|',...rows.map(([path,contents])=>tableRow([path,contents])),'',
  ...(script.files.length&&main?[`## Sending the requests of run #${main.number} again`,'','```bash','cd scripts',`export ${keyVariable(main.provider as Provider)}=...`,`python annotate.py ../corpus/corpus.csv --only ../runs/${mainFolder}/results_wide.csv`,'```','',
   `\`corpus/corpus.csv\` holds every ${unit} of the study${gone?', the deleted ones too':''}, so \`--only\` names the ${unit}s of run #${main.number}: the script sends only the ${unit}s whose doc_id is in that file. It needs Python 3.9 or later and nothing else. Hosted models may be updated or retired and generation is not fully deterministic, so sending the requests again may not reproduce every answer exactly.`,'']:[]),
  ...(script.why&&main?[`Run #${main.number} has the most usable answers. ${script.why}`,'']:[]),
  CSV_NOTE+(main?' To read the results in Excel, open the .xlsx workbook instead.':''),'',TOKEN_NOTE+(runs.length?' A blank `reasoning_tokens` means that the provider reported no count of its own, not that there was no reasoning.':''),'',
  ...(runs.length&&options.logs?[logNote(false)+' A failed attempt’s request may never have reached the provider (a connection that broke, say).'+(rebuilt?' '+REBUILT_NOTE:''),'']:[]),
  ...(batch?[BATCH_TIMES_NOTE+(options.logs?' In responses.jsonl, `batch_ended_at` is the provider’s own time for the end of the batch, where it was kept.':''),'']:[]),
  ...(runs.length?[hashNote(false,'prompts/vN/')+(runs.some(run=>run.system)?' A version with a system prompt is hashed with it: the SHA-256 of the JSON list `["<prompt>","<system prompt>"]`.':''),'']:[]),
  ...(all.some(item=>item.sent.bodies.some(body=>body.frame.body.includes('"prompt_cache_options"')&&!body.frame.body.includes('"prompt_cache_breakpoint"')))?[CACHE_OPTION_NOTE,'']:[]),
  ...(corpus.unread?[`${count(corpus.unread)} ${unit}${corpus.unread===1?'':'s'} could not be read when this repository was made and ${corpus.unread===1?'has':'have'} no text here.`,'']:[])].join('\n');
 await add('README.md',readme);
 return {name,files,...(backupNote?{warning:`study-backup.json is missing: ${backupNote.replace(/\.$/,'')}. Its README says so too.`}:{})};
}

// A package as one .zip file.
const STORED=/\.(pdf|xlsx|docx|zip|png|jpe?g)$/i;
export async function zipPackage(pack:Package,onProgress?:Progress):Promise<Uint8Array>{
 const JSZip=(await import('jszip')).default,zip=new JSZip();
 // PDFs and Excel files are usually compressed already: stored as they are, which is many times faster and hardly larger.
 for(const file of pack.files)zip.file(file.path,file.data instanceof Blob?new Uint8Array(await file.data.arrayBuffer()):file.data,STORED.test(file.path)?{compression:'STORE'}:{});
 await onProgress?.('Compressing the files');
 let shown=-1;
 return zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}},update=>{const percent=Math.floor(update.percent/5)*5;if(percent!==shown){shown=percent;void onProgress?.(`Compressing the files (${percent}%)`);}});
}
