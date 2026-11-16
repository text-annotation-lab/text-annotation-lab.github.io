// What the Export tab's files are made from: one data set of a study (the uploaded texts, or the Model
// knowledge subjects) read as runs, the requests each run made, and the documents those requests carried.
import {usageSample} from '../cost-estimate/engine';
import {cacheTokens,recordedCost} from '../cost-estimate/run-cost';
import type {Provider} from '../providers';
import {requestFrame,type RequestFrame} from '../request-frame';
import {annotationFormatRecord} from '../answer-fields';
import {knowledgeDocumentText} from '../model-knowledge';
import {rowForRun,type Row} from './runs';
import {requestsOf} from './repeats';
import {runLines,type Dataset,type RunLine} from './export';
import type {RecordedRequest} from './requests';

// lab: the build of the Lab that makes the export.
export type ExportStudy={name:string;dataset:Dataset;requests?:RecordedRequest[];lab:string};
// One request a run made and its outcome. replicate: which of the text's annotations in the run it is (1 when
// the run makes one per text). attempt: counted per run and replicate. replaced: a failed attempt that was sent
// again later. result: the request read as a result of its own (an annotation with its text's settings).
export type RequestLine={row:Row;run:number;replicate:number;attempt:number;result:Row;replaced:boolean};

// Every request with an outcome, text by text in the order of the study; within a text, run by run, then by
// replicate, then by attempt. A failed attempt that was sent again is kept with the result that followed it,
// and counts for the run it was made in.
export function requestLines(dataset:Dataset):RequestLine[]{
 const out:RequestLine[]=[];
 for(const row of dataset.rows){
  const counts=new Map<string,number>();
  const add=(lines:RequestLine[],run:number|undefined,result:Row,replaced:boolean)=>{
   if(run===undefined)return;
   for(const request of requestsOf(result)){
    const key=run+' '+request.replicate,attempt=(counts.get(key)||0)+1;counts.set(key,attempt);
    lines.push({row,run,replicate:request.replicate,attempt,result:request.result,replaced});
   }
  };
  for(const result of [...(row.earlier||[]),row] as Row[]){
   const lines:RequestLine[]=[];
   for(const attempt of result.history||[])add(lines,attempt.runNo??result.runNo,attempt as Row,true);
   if(result.status==='done'||result.status==='error')add(lines,result.runNo,result,false);
   out.push(...lines.map((line,i)=>({line,i})).sort((a,b)=>a.line.run-b.line.run||a.line.replicate-b.line.replicate||a.i-b.i).map(entry=>entry.line));
  }
 }
 return out;
}
// The runs that can be reported: those with at least one completed or failed result, newest first.
export const reportableRuns=(dataset:Dataset):RunLine[]=>runLines(dataset).filter(run=>run.done+run.failed>0).reverse();
// The run with usable answers for the most texts (the latest of them when several have as many).
export function fullestRun(dataset:Dataset):RunLine|undefined{
 return runLines(dataset).reduce<RunLine|undefined>((best,run)=>run.done>0&&(!best||run.done>=best.done)?run:best,undefined);
}
export const runFolder=(run:number)=>'run-'+String(run).padStart(2,'0');

const count=(value:unknown):number|''=>typeof value==='number'&&Number.isFinite(value)?value:'';
// Tokens of one request as the provider reported them. Input includes tokens read from or written to the
// provider's prompt cache; output includes reasoning tokens.
export function tokensOf(result:Row):{input:number|'';output:number|'';reasoning:number|'';cacheRead:number|'';cacheWrite:number|''}{
 const provider=result.provider as Provider|undefined,usage=result.usage;
 if(!provider||!usage)return {input:'',output:'',reasoning:'',cacheRead:'',cacheWrite:''};
 const sample=usageSample(provider,usage),cache=cacheTokens(provider,usage,result.processing==='batch');
 return {input:count(sample?.input),output:count(sample?.output),reasoning:count(sample?.reasoning),cacheRead:cache.read,cacheWrite:cache.write+cache.hourWrite};
}
export const costOf=(result:Row):number|''=>{const charge=recordedCost(result as any);return charge?Number(charge.amount.toFixed(6)):'';};
// Milliseconds from sending a request to its reply (requests sent one by one; a batch has no such time).
export function latencyOf(result:Row):number|''{
 if(result.processing==='batch'||!result.startedAt||!result.time)return '';
 const ms=Date.parse(result.time)-Date.parse(result.startedAt);
 return Number.isFinite(ms)&&ms>=0?ms:'';
}

export const sentAsFile=(dataset:Dataset,row:Row)=>dataset.kind==='texts'&&/\.pdf$/i.test(String(row.file?.name||row.name||''));
// The request behind a result. recorded: kept when the request was sent. Otherwise (a result made before the
// Lab kept requests, or in the standard Lab) it is built again from the result's settings by this version of
// the Lab; formatUnchanged then says whether the answer format recorded with the result is still what this
// version sends.
export type SentRequest={frame:RequestFrame;recorded:boolean;id?:string;formatUnchanged?:boolean};
export function requestOf(study:ExportStudy,row:Row,result:Row):SentRequest|undefined{
 const kept=result.requestId?study.requests?.find(request=>request.id===result.requestId):undefined;
 if(kept)return {frame:{url:kept.url,body:kept.body},recorded:true,id:kept.id};
 if(!result.provider||!result.model||result.effort===undefined||result.prompt===undefined)return undefined;
 const knowledge=study.dataset.kind==='knowledge';
 try{
  const frame=requestFrame({provider:result.provider as Provider,model:result.model,effort:result.effort,prompt:result.prompt,answerFields:result.answerFields||[],answerSettings:result.answerSettings,requestSettings:result.requestSettings,knowledge,webSearch:Boolean(result.webSearch),batch:result.processing==='batch'},sentAsFile(study.dataset,row));
  const format=typeof result.responseFormat==='string'?result.responseFormat===annotationFormatRecord(result.answerFields||[],result.prompt,knowledge,result.answerSettings):undefined;
  return {frame,recorded:false,...(format===undefined?{}:{formatUnchanged:format})};
 }catch{return undefined;}
}

// requestOf for many results: results made with the same settings share one rebuilt request.
export function requestFinder(study:ExportStudy):(row:Row,result:Row)=>SentRequest|undefined{
 const built=new Map<string,SentRequest|undefined>();
 return (row,result)=>{
  if(result.requestId)return requestOf(study,row,result);
  const key=JSON.stringify([result.provider,result.model,result.effort,result.prompt,result.answerFields,result.answerSettings,result.requestSettings,Boolean(result.webSearch),result.processing==='batch',sentAsFile(study.dataset,row),result.responseFormat]);
  if(!built.has(key))built.set(key,requestOf(study,row,result));
  return built.get(key);
 };
}
// The requests of one run: the body most of its texts were sent with, and the one most of its PDFs were sent
// with. forms: how many different bodies the run sent (more than one per kind when, say, part of a run went
// through the batch interface). rebuilt: requests that were not kept when sent and are built again here.
export type RunRequests={text?:SentRequest&{count:number};pdf?:SentRequest&{count:number};forms:number;rebuilt:number;unknown:number;total:number};
export function runRequests(study:ExportStudy,run:number,find=requestFinder(study)):RunRequests{
 const counts=new Map<string,{sent:SentRequest;pdf:boolean;count:number}>();let rebuilt=0,unknown=0,total=0;
 for(const line of requestLines(study.dataset)){
  if(line.run!==run)continue;
  total++;const sent=find(line.row,line.result);
  if(!sent){unknown++;continue;}
  if(!sent.recorded)rebuilt++;
  const pdf=sentAsFile(study.dataset,line.row),key=(pdf?'pdf ':'text ')+sent.frame.url+' '+sent.frame.body,entry=counts.get(key);
  if(entry)entry.count++;else counts.set(key,{sent,pdf,count:1});
 }
 const most=(pdf:boolean)=>[...counts.values()].filter(entry=>entry.pdf===pdf).reduce<{sent:SentRequest;count:number}|undefined>((best,entry)=>!best||entry.count>best.count?entry:best,undefined);
 const text=most(false),pdf=most(true);
 return {...(text?{text:{...text.sent,count:text.count}}:{}),...(pdf?{pdf:{...pdf.sent,count:pdf.count}}:{}),forms:counts.size,rebuilt,unknown,total};
}
// What a request body says, whichever provider it is for. system: the prompt with the Lab's own instructions,
// as sent. limit: the most output tokens the reply may have. schema: the answer format (absent for plain text).
export function requestParts(frame:RequestFrame):{model:string;system:string;limit?:number;schema?:any}{
 const body=JSON.parse(frame.body);
 const text=(value:any):string=>typeof value==='string'?value:Array.isArray(value)?value.map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
 const first=Array.isArray(body.input)?body.input[0]:Array.isArray(body.messages)?body.messages[0]:undefined;
 const system=typeof body.instructions==='string'?body.instructions:body.system!==undefined?text(body.system):body.systemInstruction?text(body.systemInstruction.parts):first&&(first.role==='developer'||first.role==='system')?text(first.content):'';
 const limit=[body.max_output_tokens,body.max_tokens,body.generationConfig?.maxOutputTokens].find(value=>typeof value==='number');
 const schema=body.text?.format?.schema??body.output_config?.format?.schema??body.generationConfig?.responseSchema??body.response_format?.json_schema?.schema;
 // Gemini names its model in the address, the others in the body.
 const model=typeof body.model==='string'?body.model:(/\/models\/([^/:]+):/.exec(frame.url)?.[1]??'');
 return {model,system,...(limit===undefined?{}:{limit}),...(schema?{schema}:{})};
}

// The document a request carried: a text, or a whole PDF sent as a file.
export type SentDocument={filename:string;text:string}|{filename:string;pdf:File};
export type DocumentReader=(row:Row,result?:Row)=>Promise<SentDocument|undefined>;
// extract: reads a file's text as the request handlers do. Each text is read once.
export function documentReader(dataset:Dataset,extract:(file:File)=>Promise<string>):DocumentReader{
 const texts=new Map<string,Promise<string|undefined>>();
 return async(row,result)=>{
  if(dataset.kind==='knowledge'){
   if(!Array.isArray(row.fields))return undefined;
   return {filename:'subject.txt',text:knowledgeDocumentText(row.fields,result?.research&&typeof result.research.text==='string'?result.research:undefined)};
  }
  const file=row.file as File|undefined;if(!file)return undefined;
  if(sentAsFile(dataset,row))return {filename:file.name,pdf:file};
  let text=texts.get(row.id);
  if(!text){text=extract(file).catch(()=>undefined);texts.set(row.id,text);}
  const read=await text;
  return read===undefined?undefined:{filename:file.name,text:read};
 };
}

// The first 12 hexadecimal digits of a text's SHA-256, to tell whether two prompts are the same.
export async function shortHash(text:string):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return Array.from(new Uint8Array(digest).slice(0,6),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function fileHash(file:Blob):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
export {rowForRun};
