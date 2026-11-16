// The Export tab's files. An Excel workbook reports one run. The research repository is the whole study for
// the researcher's own archive: every run, the corpus, the requests and replies, and a backup that can be
// imported again. The supplementary repository is what a journal or an OSF or Zenodo deposit needs for one
// run: a record of the settings, the prompt and answer fields, the results, agreement with human labels, a
// draft methods paragraph, and a Python script that sends the requests again.
import {fieldSpec,PLAIN_FIELD} from '../answer-types';
import {reasoningOptionLabel,type Provider} from '../providers';
import {fillRequest} from '../request-frame';
import {insertMap,markedInserts} from '../prompt-inserts';
import {columnIndex} from './columns';
import {agreementTable,runAgreement,type AgreementLine,type Intervals,type LabelPair,type Skipped} from './export-agreement';
import {fileHash,fullestRun,requestFinder,requestLines,requestParts,requestRecord,responseRecord,runFolder,runRequests,type DocumentReader,type ExportStudy,type RunRequests,type SentRequest} from './export-data';
import {fillScript,keyVariable,REQUIREMENTS,SCRIPT_TEMPLATE,scriptValues} from './export-python';
import {codebook,corpusColumnNames,corpusRecords,corpusTable,promptHashes,requestsTable,resultsTable,runFacts,runsOverview,type RunFacts,type Table} from './export-tables';
import {buildWorkbook,isProse,type Sheet} from './export-workbook';
import {fileStem,runLines,samplesTable,sourceOf,unitOf,wideTable} from './export';
import {BOOTSTRAP_RESAMPLES,fixed,fmtStat} from './metrics';
import {toCsv} from './parse-table';
import {rowForRun,type Row} from './runs';
import {tiedVote} from './repeats';
import {sampleNote} from './sample';
import {fieldLabel} from './view';

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
const LOG_NOTE='A request line is the request as it was sent: the request the Lab kept when the run was made, with the document put back where it was. The Lab keeps the body of a run’s requests once, not once per text, and never an API key (keys travel in request headers). A response line is what the Lab kept of the reply: the text the model returned, the summary of its reasoning where the run asked for one, the model the provider named, the stop reason, the token counts, and the response ID, not the provider’s whole response.';

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
 const {dataset}=ctx.study,name=dataset.kind==='knowledge'?'subject':'document',requests:unknown[]=[],responses:unknown[]=[],hashes=new Map<string,string>();
 const lines=requestLines(dataset).filter(line=>line.run===run);
 for(const [i,{row,replicate,attempt,result,replaced}] of lines.entries()){
  if(i%100===0)await ctx.onProgress?.(`Writing the requests and replies of run ${run} (${count(i)} of ${count(lines.length)})`);
  const head={doc_id:String(row.id),[name]:String(row.name??''),run,replicate,attempt,...(replaced?{sent_again:true}:{})},sent=find(row,result),doc=await ctx.read(row,result);
  let pdf='';
  if(doc&&'pdf' in doc){
   if(!hashes.has(row.id))hashes.set(row.id,await fileHash(doc.pdf));
   const path=filePath(row);
   pdf=`[PDF file: ${doc.filename}, ${doc.pdf.size} bytes, SHA-256 ${hashes.get(row.id)}; ${path?'in this package at '+path:'not included in this package'}]`;
  }
  requests.push({...head,...requestRecord(sent,doc,result,pdf)});
  responses.push({...head,...responseRecord(result)});
 }
 return {requests:jsonLines(requests),responses:jsonLines(responses)};
}

// The temperature a run was sent with: what its request says, or what the run's setup records.
const temperatureOf=(run:RunFacts['run'],parts?:{temperature?:number}):number|'model default'=>parts?.temperature??run.temperature??'model default';
const summaryWords=(run:RunFacts['run'])=>run.summary==='on'?'requested':run.summary==='off'?'not requested':'requested for part of the run';
const explanationRequested=(facts:RunFacts)=>!facts.run.answerSettings?.plain&&(facts.run.answerSettings?.rationale!==false||facts.run.answerFields.some(name=>name.toLowerCase()==='explanation'));
const processingWords=(facts:RunFacts)=>facts.processing==='batch'?'the provider’s batch interface':facts.processing==='instant'?'requests sent one by one':'requests sent one by one and the provider’s batch interface';
const requestNote=(sent:RunRequests)=>sent.total===0?'':sent.rebuilt===0&&sent.unknown===0?'kept when the run was made':sent.rebuilt===sent.total?'built again from the run’s settings by the version of the Lab that made this export (the run was made before the Lab kept requests, or in the standard Lab)':`kept when the run was made for ${count(sent.total-sent.rebuilt-sent.unknown)} of ${count(sent.total)} requests; the others are built again from the results’ settings by the version of the Lab that made this export`;

// The record of one run: settings, dates, counts, tokens, and the request bodies as sent (with marks where the
// document goes). It is metadata.json in the supplementary repository and run.json in the research repository.
function runRecord(study:ExportStudy,facts:RunFacts,hash:string,sent:RunRequests,exportedAt:string){
 const {dataset}=study,{run}=facts,unit=unitOf(dataset),frame=(sent.text||sent.pdf)?.frame,parts=frame?requestParts(frame):undefined,known=facts.tokens.knownFor>0;
 const body=(kind:string,request?:SentRequest&{count:number})=>request?[{kind,requests:request.count,recorded:request.recorded,url:request.frame.url,body:JSON.parse(request.frame.body)}]:[];
 return {
  software:{name:'Text Annotation Lab',version:study.lab,versions_used_for_run:facts.labs},
  exported_at:exportedAt,study:study.name,data:sourceOf(dataset),
  ...(dataset.samples.length?{samples:dataset.samples.map(sampleNote)}:{}),
  run:{number:run.number,...(run.label?{label:run.label}:{}),...(run.scope?{scope:run.scope}:{}),started_at:run.startedAt,finished_at:facts.finished||null,status_when_exported:run.active?'in progress':'finished',processing:processingWords(facts),batch_ids:facts.batchIds},
  model:{provider:run.provider,requested:run.model,reported_by_api:facts.models,reasoning_effort:run.effort,reasoning_summary_requested:run.summary==='in part'?'in part':run.summary==='on',temperature:temperatureOf(run,parts),max_output_tokens:parts?.limit??null},
  prompt:{version:run.promptVersion,sha256_prefix:hash,answer_format:run.answerSettings?.plain?'plain text':'structured',explanation_requested:explanationRequested(facts),answer_fields:run.answerFields,answer_settings:run.answerSettings??null},
  options:{annotations_per_text:run.repeats||1,prompt_caching:run.caching,...(dataset.kind==='knowledge'?{web_search:run.webSearch}:{})},
  // The bodies of the run's requests, with marks where each document goes (<<DOCUMENT_FILENAME>>, <<DOCUMENT_TEXT>>, <<FILE_BASE64>>).
  requests_as_sent:{record:requestNote(sent),different_bodies:sent.forms,bodies:[...body('text',sent.text),...body('pdf',sent.pdf)]},
  corpus:{[`n_${unit}s_in_run`]:facts.texts,[`n_${unit}s_with_usable_annotation`]:facts.usable,[`n_${unit}s_all_requests_failed`]:facts.allFailed,[`n_${unit}s_without_result_yet`]:facts.active,...((run.repeats||1)>1?{[`n_${unit}s_with_fewer_usable_annotations`]:run.fewer}:{})},
  // total, ok, failed: each text's last request in the run (with several annotations per text, the last request
  // for each annotation). replaced_by_retries: failed attempts that were sent again.
  requests:{total:facts.requests.total,ok:facts.requests.ok,failed:facts.requests.failed,replaced_by_retries:facts.requests.replaced,sent_in_all:facts.requests.total+facts.requests.replaced,first_requested_at:facts.requests.first||null,last_completed_at:facts.requests.last||null},
  tokens:known?{input:facts.tokens.input,output:facts.tokens.output,reasoning:facts.tokens.reasoning,cache_read:facts.tokens.cacheRead,cache_write:facts.tokens.cacheWrite,known_for_requests:facts.tokens.knownFor}:null,
  cost_usd:facts.cost.knownFor?{amount:facts.cost.amount,known_for_requests:facts.cost.knownFor,of_requests:facts.cost.of}:null,
 };
}
type RunRecord=ReturnType<typeof runRecord>;

// The Settings sheet of the workbook.
function settingsTable(study:ExportStudy,facts:RunFacts,hash:string,sent:RunRequests):Table{
 const {dataset}=study,{run}=facts,frame=(sent.text||sent.pdf)?.frame,parts=frame?requestParts(frame):undefined;
 return [['setting','value'],['Study',study.name],['Data',sourceOf(dataset)],['Run','#'+run.number],['Started',run.startedAt],['Finished',run.active?'not finished when exported (the results so far)':facts.finished],
  ['Provider',run.provider],['Model',run.model],['Model reported by the provider',facts.models.join('; ')||'not recorded'],['Reasoning effort',run.effort],['Reasoning summary',summaryWords(run)],['Temperature',temperatureOf(run,parts)],['Max output tokens',parts?.limit??''],[`Annotations per ${unitOf(dataset)}`,(run.repeats||1)>1?`${run.repeats} (the Results sheet has the combined answers; By replicate has each annotation)`:1],
  ['Prompt caching',run.caching],['Processing',processingWords(facts)],...(dataset.kind==='knowledge'?[['Web search',run.webSearch?'yes':'no']]:[]),
  ['Prompt version',`v${run.promptVersion} (${hash})`],['Prompt',run.prompt],...(parts?.system?[['Prompt as sent (with the Lab’s instructions)',parts.system]]:[]),
  ['Answer fields',run.answerSettings?.plain?'plain text: the whole reply is stored as “response”':run.answerFields.join(' | ')||'Score / category'],['Answer format',parts?.schema?JSON.stringify(parts.schema):run.answerSettings?.plain?'plain text (no answer format was sent)':'not recorded'],
  ['Requests',requestNote(sent)],...dataset.samples.map(sample=>[`Sample ${sample.column} = ${sample.value}`,sampleNote(sample)]),
  ['Text Annotation Lab version (run)',facts.labs.join('; ')||'not recorded'],['Text Annotation Lab version (this export)',study.lab]];
}

// What is computed once for a run and used by its workbook, its tables, and its README.
type RunReport={facts:RunFacts;hash:string;sent:RunRequests;agreement:AgreementLine[];pairs:LabelPair[];skipped:Skipped[]};
async function reportRun(ctx:ExportContext,run:number,hashes:Map<string,string>,find=requestFinder(ctx.study)):Promise<RunReport>{
 const {dataset}=ctx.study,line=runLines(dataset).find(candidate=>candidate.number===run);
 if(!line)throw new Error(`Run ${run} has no results.`);
 await ctx.onProgress?.(`Computing agreement for run ${run}`);
 const {lines,pairs,skipped}=await runAgreement(dataset,run,ctx.intervals);
 return {facts:runFacts(dataset,line),hash:hashes.get(line.prompt)??'',sent:runRequests(ctx.study,run,find),agreement:lines,pairs,skipped};
}
const without=(table:Table,column:string):Table=>{const at=table[0].indexOf(column);return at<0?table:table.map(row=>row.filter((_,i)=>i!==at));};
// The workbook of one run: results text by text and request by request (By replicate), agreement, settings,
// and all runs.
async function runWorkbook(ctx:ExportContext,report:RunReport,hashes:Map<string,string>):Promise<ArrayBuffer>{
 const {study}=ctx,run=report.facts.run.number;
 // The Lab's identifier is left out of the Results sheet, where the name says which text a row is.
 const results=without(resultsTable(study,run),'doc_id'),requests=requestsTable(study,[run],hashes),from=requests[0].indexOf('sent_again'),to=requests[0].indexOf('error');
 const fixedText=new Set(['document','subject','source_document','chunk','text','explanation',PLAIN_FIELD]);
 const sheets:Sheet[]=[{name:'Results',table:results,frozen:1,numbers:column=>!fixedText.has(column)&&!isProse(column)},
  {name:'By replicate',table:requests,numbers:(column,i)=>i>from&&i<to&&!fixedText.has(column)&&!isProse(column)},
  ...(report.agreement.length?[{name:'Agreement',table:agreementTable(report.agreement)}]:[]),
  {name:'Settings',table:settingsTable(study,report.facts,report.hash,report.sent),frozen:1,prose:(column:string)=>column==='value'},
  {name:'All runs',table:runsOverview(study,hashes)}];
 return buildWorkbook(sheets);
}
export async function buildRunWorkbook(ctx:ExportContext,run:number):Promise<{name:string;data:ArrayBuffer}>{
 const hashes=await promptHashes(ctx.study.dataset),report=await reportRun(ctx,run,hashes);
 await ctx.onProgress?.('Writing the sheets');
 return {name:`${fileStem(ctx.study.name,ctx.study.dataset)}_run${run}_${(ctx.now||new Date()).toISOString().slice(0,10)}.xlsx`,data:await runWorkbook(ctx,report,hashes)};
}

// The prompt of a run as written and as sent, its answer fields, and its answer format.
function promptFiles(study:ExportStudy,report:RunReport,parts:{prompt:boolean}):PackageFile[]{
 const {run}=report.facts,frame=(report.sent.text||report.sent.pdf)?.frame,sent=frame?requestParts(frame):undefined;
 return [...(parts.prompt?[{path:'prompt.txt',data:run.prompt}]:[]),...(sent?.system?[{path:'prompt_as_sent.txt',data:sent.system}]:[]),{path:'codebook.md',data:codebook(run.answerFields,run.answerSettings,study.dataset.kind==='knowledge')},...(sent?.schema?[{path:'output_schema.json',data:pretty(sent.schema)}]:[])];
}
// The placeholders of a run's prompt that were filled in for each text, read from the marks of its request.
const runInserts=(sent:RunRequests):string[]=>markedInserts((sent.text||sent.pdf)?.frame.body||'');
// Where the corpus table holds the values of each: {{id}} is the text's name, {{meta.<column>}} a metadata
// column (null: the study no longer has it).
function insertColumns(dataset:ExportStudy['dataset'],names:string[]):[string,string|null][]{
 const columns=corpusColumnNames(dataset);
 return names.map(name=>{
  if(name==='id')return [name,dataset.kind==='knowledge'?'subject':'document'];
  const index=columnIndex(dataset.columns,name.slice(5));
  return [name,index>=0&&dataset.columns[index].role==='meta'?columns[index]:null];
 });
}
const listed=(items:string[])=>items.length>2?items.slice(0,-1).join(', ')+', and '+items[items.length-1]:items.join(' and ');
const written=(names:string[])=>listed(names.map(name=>`\`{{${name}}}\``));
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
 const notes=[sent.rebuilt?'The requests of this run were not kept when it was made'+(sent.rebuilt<sent.total?' for all of its texts':'')+': the request here was built again from the run’s settings by the version of the Lab that made this export.':'',
  other>0?`${count(other)} of the run’s ${count(sent.total)} requests had another body (for example, sent through the provider’s batch interface, or with another answer format); this script sends every document with the body most of them had.`:'',
  facts.processing!=='instant'?'The run used the provider’s batch interface; this script sends the same request bodies one by one.':''].filter(Boolean);
 // Lines of at most about 78 characters, as in the rest of the script's opening text.
 const wrap=(text:string)=>text.split(' ').reduce<string[]>((lines,word)=>{const last=lines[lines.length-1];if(last!==undefined&&(last+' '+word).length<=78)lines[lines.length-1]=last+' '+word;else lines.push(word);return lines;},[]).join('\n');
 const values=scriptValues({lab:study.lab,studyName:study.name,runDescription:`#${run.number}, started ${run.startedAt}${facts.labs.length?` with the Lab’s version ${facts.labs.join('; ')}`:''}; exported ${exportedAt}`,provider:run.provider as Provider,text:sent.text?.frame,pdf:sent.pdf?.frame,fields:run.answerFields,plain:Boolean(run.answerSettings?.plain),repeats:run.repeats||1,note:notes.map(wrap).join('\n'),inserts:insertColumns(study.dataset,runInserts(sent))});
 return {files:[{path:'annotate_template.py',data:SCRIPT_TEMPLATE},{path:'annotate.py',data:fillScript(SCRIPT_TEMPLATE,values)},{path:'requirements.txt',data:REQUIREMENTS}],why:''};
}

// A draft paragraph for a paper's methods section, written from the run's record.
export function methodsParagraph(study:ExportStudy,report:RunReport,record:RunRecord):string{
 const {facts}=report,{run}=facts,knowledge=study.dataset.kind==='knowledge',unit=unitOf(study.dataset),units=(n:number)=>`${count(n)} ${unit}${n===1?'':'s'}`,was=(n:number)=>n===1?'was':'were';
 const dates=[facts.requests.first,facts.requests.last].filter(Boolean).map(time=>time.slice(0,10)),period=!dates.length?'':dates.length<2||dates[0]===dates[1]?` on ${dates[0]}`:` between ${dates[0]} and ${dates[1]}`;
 const effort=run.effort==='off'?'reasoning switched off':run.effort&&run.effort!=='default'?`reasoning effort “${reasoningOptionLabel(run.effort).toLowerCase()}”`:'the provider’s default reasoning effort',limit=record.model.max_output_tokens;
 const reported=facts.models.length?`; model ${run.provider==='openrouter'?'and upstream provider ':'version '}reported by the API: ${facts.models.join(', ')}`:'';
 const {total,failed,replaced}=facts.requests,failedText=failed?`${count(failed)} of ${count(total)} request${total===1?'':'s'} did not return a usable annotation (an API error, a refusal, or an answer that could not be read) and ${was(failed)} excluded${facts.allFailed?`, leaving ${units(facts.allFailed)} without an annotation`:''}`:'';
 const retried=replaced?`${count(replaced)} failed request${replaced===1?' was':'s were'} sent again`:'';
 // Several annotations per text: how they were combined, how many texts combine fewer, and how many votes were tied.
 const reps=run.repeats||1,plain=Boolean(run.answerSettings?.plain),typeOf=(name:string)=>fieldSpec(run.answerSettings,name)?.type;
 const annotated=run.fewer?`Each ${unit} was to be annotated ${reps} times, but ${units(run.fewer)} had fewer usable annotations, so ${run.fewer===1?'its answers combine':'their answers combine'} fewer`:`Each ${unit} was annotated ${reps} times`;
 const voted=plain?[]:run.answerFields.length?run.answerFields.filter(name=>!['ordinal','number','text'].includes(typeOf(name)||'')&&!/(^|_)(explanation|reasoning)$/i.test(name)):[''];
 const kinds=[[voted.length>0,'categorical','majority vote'],[run.answerFields.some(name=>typeOf(name)==='ordinal'),'ordinal','the median'],[run.answerFields.some(name=>typeOf(name)==='number'),'numeric','the mean']].filter(kind=>kind[0]).map((kind,i)=>`${kind[1]} labels ${i?'':'were aggregated '}by ${kind[2]}`);
 const results=reps>1&&voted.length?study.dataset.rows.map(row=>rowForRun(row,run.number)).filter(result=>result.status==='done'):[];
 const ties=voted.map(name=>[name,results.filter(result=>tiedVote(result,name)).length] as const).filter(tie=>tie[1]>0);
 const tieText=!voted.length?'':` A tied vote is kept as both values (for example, “a | b”) and counts as a disagreement in the agreement figures${ties.length?` (${ties.map(([name,n],i)=>`${i?count(n):units(n)} for ${fieldLabel(name)}`).join(', ')})`:'; no vote was tied'}.`;
 const combined=reps<2?'':plain?`${annotated}; numbers in the answers were combined by the median, other values by majority vote.`:`${annotated}; ${!run.answerFields.some(name=>typeOf(name))?'the answers were combined by majority vote':kinds.length>2?kinds.slice(0,-1).join(', ')+', and '+kinds[kinds.length-1]:kinds.join(' and ')}.${tieText}`;
 // Placeholders of the prompt that held a text's own value.
 const valued=valuedInserts(study.dataset,run.number),inserted=runInserts(report.sent).filter(name=>valued.has(name)),metaNames=inserted.filter(name=>name!=='id').map(name=>name.slice(5)),insertedParts=[...(inserted.includes('id')?['its name']:[]),...(metaNames.length?[`its value${metaNames.length===1?'':'s'} of the metadata column${metaNames.length===1?'':'s'} ${listed(metaNames)}`]:[])];
 const insertedText=insertedParts.length?`For each ${unit}, the prompt was completed with ${insertedParts.join(' and ')}.`:'';
 // What the package holds: no request without recorded settings, and no script for a run that carried web search results.
 const known=Boolean(report.sent.text||report.sent.pdf),provided=['The full prompt',...(known?['the requests as sent']:[]),...(known&&!facts.webSearch?['an executable script']:[])];
 return [
  `${unit==='text'?'Texts':'Subjects'} (N = ${count(facts.usable)}) were annotated with ${run.model} (${run.provider==='openrouter'?'through the OpenRouter API':(PROVIDER_NAMES[run.provider]||run.provider)+' API'}${reported})${period}, using ${[effort,...(typeof record.model.temperature==='number'?[`temperature ${record.model.temperature}`]:[])].join(', ')}${limit?`${typeof record.model.temperature==='number'?',':''} and a maximum of ${count(limit)} output tokens`:''}.`,
  knowledge?`No source texts were supplied: the model answered from what it has learned, given a few identifying details for each subject (see the prompt and the list of subjects).${facts.webSearch?' Web search results collected beforehand for each subject were supplied with the request.':''}`:'',
  insertedText,
  run.answerSettings?.plain?'The model returned free-text responses.':`The model was required to return the answer fields listed in the codebook as JSON conforming to a schema (structured outputs)${explanationRequested(facts)?', with an explanation written before the answers':''}.`,
  combined,
  retried?`${retried}${failedText?`; after this, ${failedText}`:''}.`:failedText?failedText+'.':'',
  facts.active?`The run was not finished when this was exported: ${units(facts.active)} had no result yet.`:'',
  `Requests were sent ${facts.processing==='batch'?'through the provider’s batch interface':facts.processing==='instant'?'individually':'partly individually and partly through the provider’s batch interface'}${run.caching==='off'?'':run.caching==='on'?' with prompt caching':' (partly with prompt caching)'}. The annotation was run with the Text Annotation Lab (version ${facts.labs.join('; ')||study.lab}). ${provided.length>2?provided.slice(0,-1).join(', ')+', and '+provided[provided.length-1]:provided.join(' and ')} ${provided.length>1?'are':'is'} provided in the supplementary material.`,
 ].filter(Boolean).join(' ');
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
  lines.push('',(withIntervals?`Brackets: 95% intervals: Wilson intervals for % agreement, bootstrap intervals (${count(BOOTSTRAP_RESAMPLES)} resamples of ${unit}s) for the coefficients.${withIntervals<report.agreement.length?` A comparison of fewer than 10 ${unit}s has no intervals.`:''}`:`No 95% intervals are given: they need at least 10 compared ${unit}s.`)+` “Of labelled”: this run’s ${unit}s with a value in the “Compared with” column. Not compared: ${unit}s without a usable value under Annotations (no usable answer from the model, or no label in that column), and pairs with a value that does not fit the field (“left out”: a missing-value marker such as NA, a word where numbers are compared, a number off the scale, or a value that is not one of the field’s categories). Their number is n_left_out_not_on_scale in agreement.csv, which also says what each field’s scale or categories rest on.`+(report.agreement.some(a=>a.source!=='model')?` Rows with a column name under Annotations compare two columns of human labels (human–human baseline) on this run’s ${unit}s.`:''));
 }
 if(report.skipped.length)lines.push('',`Label columns not used for agreement: ${report.skipped.map(skip=>`${skip.column} (${skip.reason})`).join(', ')}.`);
 return [...lines,''];
}

function supplementaryReadme(study:ExportStudy,report:RunReport,record:RunRecord,options:SupplementaryOptions,has:{agreement:boolean;script:boolean;scriptWhy:string;schema:boolean;asSent:boolean;files:number;unread:number}):string{
 const {dataset}=study,{facts}=report,{run}=facts,unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',plain=Boolean(run.answerSettings?.plain);
 // Placeholders of the prompt that were filled in for each text, and where the corpus holds their values.
 const inserted=runInserts(report.sent),valued=valuedInserts(dataset,run.number),metaFilled=inserted.filter(name=>name!=='id'&&valued.has(name)),unfilled=inserted.filter(name=>!valued.has(name));
 const insertedNote=inserted.length?`. Its placeholders were filled in for each ${unit}: ${[inserted.includes('id')&&valued.has('id')?`\`{{id}}\` with the ${unit}’s name`:'',metaFilled.length?`${written(metaFilled)} with its value${metaFilled.length===1?' in that metadata column':'s in those metadata columns'}`:'',unfilled.length?`${written(unfilled)} ${unfilled.length===1?'was':'were'} filled in empty for every ${unit} (${unfilled.length===1?'it names':'they name'} no metadata column, or an empty one)`:''].filter(Boolean).join('; ')}`:'';
 const lines=[`# ${study.name}: LLM annotation materials`,'',
  `Supplementary materials for the LLM-based annotation (run #${run.number}), exported from the Text Annotation Lab (version ${study.lab}) on ${record.exported_at.slice(0,10)}.${facts.labs.length&&facts.labs.some(lab=>lab!==study.lab)?` The run was made with version ${facts.labs.join('; ')}.`:''}`,'',
  ...(run.active?['**This run was not finished when these materials were exported**: they describe the results so far.','']:[]),
  ...(knowledge?['Model knowledge: no texts were supplied. The model judged named subjects from what it has learned.'+(facts.webSearch?' Web search results collected for each subject were supplied with the request.':''),'']:[]),
  '## Summary','','| | |','|---|---|',
  tableRow(['Provider / model',`${run.provider} / \`${run.model}\``]),tableRow(['Model reported by the API',facts.models.map(model=>'`'+model+'`').join(', ')||'—']),tableRow(['Reasoning effort',run.effort||'—']),tableRow(['Temperature',record.model.temperature]),tableRow(['Max output tokens',record.model.max_output_tokens??'—']),
  tableRow([`${unit==='text'?'Texts':'Subjects'} with a usable annotation`,`${facts.usable} of ${facts.texts}`]),tableRow([`Annotations per ${unit}`,run.repeats||1]),tableRow(['Requests (ok / failed)',`${facts.requests.ok} / ${facts.requests.failed}`]),
  ...(facts.requests.replaced?[tableRow(['Failed attempts sent again',`${facts.requests.replaced} (their tokens are included in the token totals${options.logs?'; the logs keep them':''})`])]:[]),
  tableRow(['Annotation period',`${facts.requests.first||'—'} to ${facts.requests.last||'—'}`]),tableRow(['Prompt version / hash',`v${run.promptVersion} / \`${report.hash}\``]),tableRow(['Prompt caching',run.caching]),tableRow(['Sent through',processingWords(facts)]),'',
  ...agreementSection(study,report),
  '## Methods text (draft)','','> '+methodsParagraph(study,report,record),'','Edit as needed; check every detail against `metadata.json`.','',
  '## Files','','| File | Contents |','|---|---|',
  tableRow(['`metadata.json`','Machine-readable record of the model, settings, dates, counts, and token use, with the bodies of the requests as sent (marks stand for the document'+(inserted.length?' and for the values of the prompt’s placeholders':'')+')']),
  tableRow(['`prompt/prompt.txt`','The annotation prompt as written'+insertedNote]),
  ...(has.asSent?[tableRow(['`prompt/prompt_as_sent.txt`','The prompt as each request carried it: with the instructions the Lab adds'+(plain?'':' on the answer format')+(knowledge?' and on judging from learned knowledge':'')+', and with its line breaks as they were sent (CR LF)'+(inserted.length?'; the placeholders stand where each request had the values':'')])]:[]),
  ...(plain?[tableRow(['`prompt/codebook.md`','Says that the model returned free text: there were no answer fields and no answer format'])]:[tableRow(['`prompt/codebook.md`','The answer fields: types, allowed values, and descriptions']),...(has.schema?[tableRow(['`prompt/output_schema.json`','The JSON schema the replies had to follow'])]:[])]),
  tableRow(['`results/results.csv`',`One row per ${unit}${options.texts?` (with ${knowledge?'the details the model was given':'its text'})`:''}: answers${(run.repeats||1)>1?` (combined across the ${unit}’s annotations; \`<field>_replicate_agreement\` is the share of them that gave the combined value)`:''}, labels, and metadata`]),
  tableRow(['`results/results_by_replicate.csv`',`One row per request${(run.repeats||1)>1?` (${unit} × annotation; \`replicate\` numbers a ${unit}’s annotations)`:''}, with status, tokens, cost, and timing; a failed attempt that was sent again has a row of its own (\`sent_again\`)`]),
  ...(has.agreement?[tableRow(['`results/agreement.csv`','Agreement statistics'])]:[]),
  ...(options.texts?[tableRow(['`data/corpus.csv`',`The annotated ${unit}s as they were sent, with labels and metadata`+(has.files?'; a PDF was sent as a file and is in `data/files/`':'')])]:[]),
  ...(options.logs?[tableRow(['`logs/requests.jsonl`, `logs/responses.jsonl`','Every request and what was kept of every reply; a request that was sent again has a line for each attempt (same doc_id and replicate; attempt 1, 2, …)'])]:[]),
  ...(has.script?[tableRow(['`scripts/annotate.py`','Python script that sends the requests again (values inserted)']),tableRow(['`scripts/annotate_template.py`','The same script with `{{PLACEHOLDERS}}` marking every value that comes from the study']),tableRow(['`scripts/requirements.txt`','Says that the script needs no packages besides Python itself'])]:[]),
  '',CSV_NOTE,'',TOKEN_NOTE,'',...(options.logs?[LOG_NOTE+' A failed attempt’s request may never have reached the provider (a connection that broke, say).','']:[])];
 if(has.script)lines.push('## Reproducing','','```bash','cd scripts',`export ${keyVariable(run.provider as Provider)}=...`,`python annotate.py ${options.texts?'../data/corpus.csv':'your_corpus.csv'}`,'```','',
  `The script needs Python 3.9 or later and nothing else. ${options.texts?'':`Your corpus file needs a column doc_id and a column text${has.files?' (or file, with the path of a PDF)':''}${knowledge?'':'; a column filename gives the name each request states for the document'}${inserted.length?`; and the columns the prompt’s placeholders take their values from (${insertColumns(dataset,inserted).filter(pair=>pair[1]).map(pair=>pair[1]).join(', ')})`:''}. `}${inserted.length?`The script fills in the prompt’s placeholders from the corpus file, so a value changed there since the run gives another request than the run sent${options.logs?' (the logs hold the requests as they were sent)':''}. `:''}Hosted models may be updated or retired and generation is not fully deterministic, so sending the requests again may not reproduce every answer exactly.`,'');
 else if(has.scriptWhy)lines.push('## Reproducing','',has.scriptWhy+(options.logs?' The logs hold every request as it was sent.':' The requests as sent are in the logs when the package includes them.'),'');
 if(!options.texts)lines.push(`The annotated ${unit}s are not included in this package (for example, for copyright or privacy reasons).`,'');
 if(has.unread)lines.push(`${count(has.unread)} ${unit}${has.unread===1?'':'s'} could not be read when this package was made and ${has.unread===1?'has':'have'} no text here.`,'');
 return lines.join('\n');
}

export type SupplementaryOptions={texts:boolean;explanations:boolean;logs:boolean};
// What a journal or a deposit needs for one run.
export async function buildSupplementary(ctx:ExportContext,run:number,options:SupplementaryOptions):Promise<Package>{
 const {study}=ctx,{dataset}=study,exportedAt=(ctx.now||new Date()).toISOString(),name=`${fileStem(study.name,dataset)}_supplementary_${exportedAt.slice(0,10)}`;
 const files:PackageFile[]=[],add=async(path:string,data:PackageFile['data'])=>{await ctx.onProgress?.('Writing '+path);files.push({path:name+'/'+path,data});};
 const hashes=await promptHashes(dataset),find=requestFinder(study),report=await reportRun(ctx,run,hashes,find),record=runRecord(study,report.facts,report.hash,report.sent,exportedAt);
 const ids=new Set(requestLines(dataset).filter(line=>line.run===run).map(line=>line.row.id)),rows=dataset.rows.filter(row=>ids.has(row.id));
 const corpus=options.texts?await readCorpus(ctx,rows,name+'/data',true):undefined;
 await add('metadata.json',pretty(record));
 const prompt=promptFiles(study,report,{prompt:true});
 for(const file of prompt)await add('prompt/'+file.path,file.data);
 await add('results/results.csv',toCsv(resultsTable(study,run,{texts:corpus?.texts,explanation:options.explanations})));
 await add('results/results_by_replicate.csv',toCsv(requestsTable(study,[run],hashes,{explanation:options.explanations,reasoning:false})));
 if(report.agreement.length)await add('results/agreement.csv',toCsv(agreementTable(report.agreement)));
 if(corpus){
  await add('data/corpus.csv',toCsv(corpusTable(dataset,rows,corpus.texts,corpus.files)));
  for(const pdf of corpus.pdfs){await ctx.onProgress?.('Writing '+pdf.path.slice(name.length+1));files.push({path:pdf.path,data:pdf.file});}
 }
 if(options.logs){
  const logs=await runLogs(ctx,run,find,row=>corpus?.files.has(row.id)?'data/'+corpus.files.get(row.id):undefined);
  await add('logs/requests.jsonl',logs.requests);await add('logs/responses.jsonl',logs.responses);
 }
 const script=scriptFiles(study,report,exportedAt);
 for(const file of script.files)await add('scripts/'+file.path,file.data);
 await add('README.md',supplementaryReadme(study,report,record,options,{agreement:report.agreement.length>0,script:script.files.length>0,scriptWhy:script.why,schema:prompt.some(file=>file.path==='output_schema.json'),asSent:prompt.some(file=>file.path==='prompt_as_sent.txt'),files:corpus?.pdfs.length||0,unread:corpus?.unread||0}));
 return {name,files};
}

export type ResearchOptions={logs:boolean};
// The whole study, for the researcher's own archive.
export async function buildResearchRepository(ctx:ExportContext,options:ResearchOptions):Promise<Package>{
 const {study}=ctx,{dataset}=study,unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',exportedAt=(ctx.now||new Date()).toISOString(),name=`${fileStem(study.name,dataset)}_research_${exportedAt.slice(0,10)}`;
 const files:PackageFile[]=[],add=async(path:string,data:PackageFile['data'])=>{await ctx.onProgress?.('Writing '+path);files.push({path:name+'/'+path,data});};
 const hashes=await promptHashes(dataset),find=requestFinder(study),lines=requestLines(dataset),withRequests=new Set(lines.map(line=>line.run)),runs=runLines(dataset).filter(run=>run.done+run.failed>0||withRequests.has(run.number));
 const reports=new Map<number,RunReport>();
 for(const run of runs)reports.set(run.number,await reportRun(ctx,run.number,hashes,find));
 const corpus=await readCorpus(ctx,dataset.rows,name+'/corpus',true);
 await add('study.json',pretty({study:study.name,data:sourceOf(dataset),exported_at:exportedAt,software:{name:'Text Annotation Lab',version:study.lab},[`n_${unit}s`]:dataset.rows.length,runs:runs.map(run=>run.number),columns:dataset.columns,samples:dataset.samples}));
 let backupNote='';
 if(ctx.backup){
  await ctx.onProgress?.('Writing study-backup.tal-study.json');
  try{files.push({path:name+'/study-backup.tal-study.json',data:await ctx.backup()});}
  catch(error){backupNote=error instanceof Error&&error.message?error.message:'The backup could not be made.';}
 }
 await add('corpus/corpus.csv',toCsv(corpusTable(dataset,dataset.rows,corpus.texts,corpus.files)));
 await add('corpus/corpus.jsonl',jsonLines(corpusRecords(dataset,dataset.rows,corpus.texts,corpus.files)));
 for(const pdf of corpus.pdfs){await ctx.onProgress?.('Writing '+pdf.path.slice(name.length+1));files.push({path:pdf.path,data:pdf.file});}
 await add('results/runs.csv',toCsv(runsOverview(study,hashes)));
 await add('results/results_all_runs_long.csv',toCsv(requestsTable(study,undefined,hashes)));
 await add('results/results_all_runs_wide.csv',toCsv(wideTable(dataset)));
 if(dataset.samples.length)await add('results/samples.csv',toCsv(samplesTable(dataset.samples)));
 const versions=new Set<number>();
 for(const run of runs){if(versions.has(run.promptVersion))continue;versions.add(run.promptVersion);await add(`prompts/v${run.promptVersion}/prompt.txt`,run.prompt);}
 for(const run of runs){
  const report=reports.get(run.number)!,folder=`runs/${runFolder(run.number)}/`;
  await add(folder+'run.json',pretty(runRecord(study,report.facts,report.hash,report.sent,exportedAt)));
  for(const file of promptFiles(study,report,{prompt:false}))await add(folder+file.path,file.data);
  await add(folder+'results_long.csv',toCsv(requestsTable(study,[run.number],hashes)));
  await add(folder+'results_wide.csv',toCsv(resultsTable(study,run.number)));
  if(options.logs){const logs=await runLogs(ctx,run.number,find,row=>corpus.files.has(row.id)?'corpus/'+corpus.files.get(row.id):undefined);await add(folder+'requests.jsonl',logs.requests);await add(folder+'responses.jsonl',logs.responses);}
 }
 const agreement=runs.flatMap(run=>reports.get(run.number)!.agreement);
 if(agreement.length)await add('results/agreement.csv',toCsv(agreementTable(agreement)));
 // The workbook and the script are for the main run: the one with usable answers for the most texts (the
 // latest of those), not a trial on a few texts made after it.
 const main=fullestRun(dataset),report=main?reports.get(main.number):undefined;
 let script={files:[] as PackageFile[],why:''};
 if(main&&report){
  await ctx.onProgress?.(`Writing results/results_${runFolder(main.number)}.xlsx`);
  files.push({path:`${name}/results/results_${runFolder(main.number)}.xlsx`,data:new Uint8Array(await runWorkbook(ctx,report,hashes))});
  script=scriptFiles(study,report,exportedAt);
  for(const file of script.files)await add('scripts/'+file.path,file.data);
 }
 // A prompt of the study has placeholders that were filled in for each text.
 const filled=Boolean(study.requests?.some(request=>markedInserts(request.body).length));
 const rows:[string,string][]=[['`study.json`',`The study at a glance: its name, the number of ${unit}s, its runs, its label and metadata columns, and the samples drawn`],
  ...(ctx.backup?[['`study-backup.tal-study.json`',backupNote?`Not included: ${backupNote}`:`A backup of the whole study (both data sets, with the ${knowledge?'subjects':'uploaded files'}, every run, labels, and samples), which Studies → Import backup reads again`] as [string,string]]:[]),
  ['`corpus/corpus.csv`, `corpus.jsonl`',`Every ${unit} as it was sent, with labels and metadata`+(corpus.pdfs.length?'; a PDF was sent as a file and is in `corpus/files/`':'')],
  ['`prompts/vN/prompt.txt`','Each version of the annotation prompt, as written'],
  ['`runs/run-NN/run.json`','The record of the run: model, settings, dates, counts, token use, and the bodies of its requests as sent (marks stand for the document'+(filled?' and for the values of a prompt’s placeholders':'')+')'],
  ['`runs/run-NN/prompt_as_sent.txt`, `codebook.md`, `output_schema.json`','The prompt as each request carried it (with the instructions the Lab adds'+(filled?'; placeholders that were filled in for each '+unit+' stand as written':'')+'), the answer fields, and the JSON schema the replies had to follow (no schema for plain text)'],
  ['`runs/run-NN/results_long.csv`',`One row per request: answers, explanation, status, tokens, cost, and timing; \`replicate\` numbers a ${unit}’s annotations in a run that makes several per ${unit}; a failed attempt that was sent again has a row of its own (\`sent_again\`)`],
  ['`runs/run-NN/results_wide.csv`',`One row per ${unit}: answers, labels, and metadata; in a run that makes several annotations per ${unit}, the answers are the combined ones, and \`<field>_replicate_agreement\` is the share of the ${unit}’s annotations that gave the combined value`],
  ...(options.logs?[['`runs/run-NN/requests.jsonl`, `responses.jsonl`','Every request and what was kept of every reply; a request that was sent again has a line for each attempt (same doc_id and replicate; attempt 1, 2, …)'] as [string,string]]:[]),
  ['`results/runs.csv`','Overview of all runs, with each run’s full prompt'],['`results/results_all_runs_long.csv`','All requests of all runs in one table'],['`results/results_all_runs_wide.csv`',`One row per ${unit} with every run’s answers side by side (run1_…, run2_…)`],
  ['`results/agreement.csv`','Agreement between each run’s answers and the columns of human labels that belong to its answer fields (only if there are such columns)'],
  ...(dataset.samples.length?[['`results/samples.csv`','Each recorded draw of a sample: size, eligible texts, seed, strata, and the sampling method, so the sample can be drawn again'] as [string,string]]:[]),
  ...(main?[[`\`results/results_${runFolder(main.number)}.xlsx\``,`Excel workbook for run #${main.number}, the run with usable answers for the most ${unit}s (the latest of those)`] as [string,string]]:[]),
  ...(script.files.length&&main?[['`scripts/`',`Python script that sends the requests of run #${main.number} again (\`annotate.py\`), and its template with placeholders. \`corpus/corpus.csv\` holds every ${unit} of the study: to reproduce that run, use its ${unit}s (the doc_ids in \`runs/${runFolder(main.number)}/results_wide.csv\`)`] as [string,string]]:[])];
 const readme=[`# ${study.name}: research repository`,'',`Complete record of this annotation study, exported from the Text Annotation Lab (version ${study.lab}) on ${exportedAt}.`,'',
  ...(knowledge?['Model knowledge: no texts were supplied. The model judged named subjects from what it has learned.','']:[]),
  `- ${count(dataset.rows.length)} ${unit}${dataset.rows.length===1?'':'s'}, ${runs.length} run${runs.length===1?'':'s'}, ${count(lines.length)} request${lines.length===1?'':'s'} with an outcome.`,'- API keys are never stored or exported.','',
  '## Layout','','| Path | Contents |','|---|---|',...rows.map(([path,contents])=>tableRow([path,contents])),'',
  ...(script.why&&main?[`Run #${main.number} has the most usable answers. ${script.why}`,'']:[]),
  CSV_NOTE+(main?' To read the results in Excel, open the .xlsx workbook instead.':''),'',TOKEN_NOTE,'',
  ...(options.logs?[LOG_NOTE+' A failed attempt’s request may never have reached the provider (a connection that broke, say). A request marked as built again was made before the Lab kept requests, or in the standard Lab: it is what this version of the Lab sends for the result’s recorded settings.','']:[]),
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
