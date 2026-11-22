import {answerInstructions,plainAnswer,readReply,EMPTY_REPLY,type AnswerSettings} from './answer-fields';
import {providerError,incompleteAnnotation} from './provider-errors';
import {extractText,TextEncodingError} from './extract-text';
import type {Provider} from './providers';
import type {BatchResult,BatchUpdate} from './batch-types';
import {MAX_BATCH_ITEMS,MAX_BATCH_PREPARED_BYTES,MAX_GEMINI_PREPARED_BYTES,MAX_SPLIT_PREPARED_BYTES,MAX_RECORDED_RESULT_BYTES,SPLIT_LIMITS} from './batch-limits';
import {groupParts} from './research/batch-split';
import type {RequestSettings} from './request-settings';
import {providerBody,replyCode,replyText,reasoningSummary} from './request-frame';

const MAX_RESULT_BYTES=32*1024*1024;
export class BatchError extends Error{constructor(message:string,public status=400,public uncertain=false){super(message);}}
function headers(provider:Provider,key:string):Record<string,string>{return provider==='openai'?{Authorization:`Bearer ${key}`} : provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'}:{'x-goog-api-key':key};}
async function boundedText(response:Response,limit=MAX_RESULT_BYTES){
 const reader=response.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let size=0,text='';
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit){await reader.cancel();throw new BatchError('These results are too large to collect here. Download them from your provider’s console.',413);}text+=decoder.decode(next.value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
}
// limit: the most a reply may hold (a Gemini batch holds its results in its own record, so asking how far it has
// come reads them too).
async function call(provider:Provider,key:string,url:string,init:RequestInit={},creating=false,limit=MAX_RESULT_BYTES):Promise<any>{
 let response:Response;
 try{response=await fetch(url,{...init,headers:{...headers(provider,key),...init.headers},signal:AbortSignal.timeout(90000)});}catch{throw new BatchError(creating?'Submission was not confirmed. Check your provider’s console before trying again.':'Could not reach your provider. Your batch is still saved; try checking again.',502,creating);}
 let text:string;try{text=await boundedText(response,limit);}catch(error){if(creating)throw new BatchError('Submission was not confirmed. Check your provider’s console before trying again.',502,true);throw error;}
 if(response.ok&&!text.trim())return {};
 let out;try{out=JSON.parse(text);}catch{out=null;}
 if(!response.ok){const status=response.status;const uncertain=creating&&(status>=500||status===408);const message=providerError(provider,status,out,response.headers)+(uncertain?' Submission was not confirmed. Check the provider’s batch list before submitting again; a job may already exist.':'');throw new BatchError(message,status,uncertain);}
 if(!out||typeof out!=='object'||Array.isArray(out))throw new BatchError('Your provider returned an unreadable response. Check its console before retrying.',502,creating);
 return out;
}
// Discard provider reasoning and other unused fields one record at a time.
// Large raw result files do not need to fit in the Worker's memory.
async function* resultRows(provider:Provider,key:string,url:string){
 let response:Response;try{response=await fetch(url,{headers:headers(provider,key),signal:AbortSignal.timeout(300000)});}catch{throw new BatchError('Could not download batch results. Your job is still saved; collect again.',502);}
 if(!response.ok)throw new BatchError('Could not download batch results. Check the API key and collect again.',response.status);
 const reader=response.body?.getReader();if(!reader)return;
 const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',bytes=0;
 const parse=(line:string)=>{if(line.length>2*1024*1024)throw new BatchError('One batch result is too large to collect here. Download it from your provider’s console.',413);try{const row=JSON.parse(line);if(!row||typeof row!=='object'||Array.isArray(row))throw Error();return row;}catch{throw new BatchError('The batch result file was incomplete. Collect again; no results have been overwritten.',502);}};
 try{
  while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>512*1024*1024)throw new BatchError('The provider result file exceeds the collection limit. Download it from your provider’s console.',413);buffer+=decoder.decode(next.value,{stream:true});let newline:number;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);if(line)yield parse(line);}if(buffer.length>2*1024*1024)throw new BatchError('One batch result is too large to collect here. Download it from your provider’s console.',413);}
  buffer+=decoder.decode();if(buffer.trim())yield parse(buffer.trim());
 }catch(error){if(error instanceof BatchError)throw error;throw new BatchError('The batch result download was interrupted. Your saved job is unchanged; collect again.',502);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
const payloadHead=(provider:Provider,name:string)=>provider==='openai'?'':provider==='anthropic'?'{"requests":[':'{"batch":{"display_name":'+JSON.stringify(name)+',"input_config":{"requests":{"requests":[';
const payloadTail=(provider:Provider)=>provider==='openai'?'':provider==='anthropic'?']}':']}}}}';
const payloadRow=(provider:Provider,id:string,body:unknown)=>provider==='openai'?{custom_id:id,method:'POST',url:'/v1/responses',body}:provider==='anthropic'?{custom_id:id,params:body}:{request:body,metadata:{key:id}};
export function createBatchPayload(provider:Provider,runId:string){
 const parts:Blob[]=[];
 const prefix=payloadHead(provider,'Text Annotation Lab '+runId);
 const suffix=payloadTail(provider);
 let bytes=new Blob([prefix,suffix]).size;
 return {
  append(id:string,body:unknown){
   const row=payloadRow(provider,id,body);
   const part=new Blob([(parts.length?(provider==='openai'?'\n':','):''),JSON.stringify(row)]);
   bytes+=part.size;
   const limit=provider==='gemini'?MAX_GEMINI_PREPARED_BYTES:MAX_BATCH_PREPARED_BYTES;
   if(bytes>limit)throw new BatchError(provider==='gemini'?'This batch exceeds the app’s 18 MB prepared-request limit for Gemini inline batches. Use fewer items or a shorter prompt. No batch was submitted.':'This batch exceeds the app’s 72 MB prepared-request limit. Use fewer items or a shorter prompt. No batch was submitted.',413);
   parts.push(part);
  },
  finish(){return new Blob([prefix,...parts,suffix],{type:provider==='openai'?'application/jsonl':'application/json'});}
 };
}
// Research mode: the requests of a run, kept text by text, then grouped into batches within the provider's limits
// (several batches in one run when it is larger than one batch). item: the text a request belongs to, in order.
export function createSplitPayload(provider:Provider,runId:string){
 const rows:Blob[]=[],sizes:number[]=[],counts:number[]=[];let total=0;
 const separator=provider==='openai'?'\n':',',name=(k:number,n:number)=>'Text Annotation Lab '+runId+(n>1?` (batch ${k+1} of ${n})`:'');
 return {
  append(item:number,id:string,body:unknown){
   const row=new Blob([JSON.stringify(payloadRow(provider,id,body))]);rows.push(row);
   while(sizes.length<=item){sizes.push(0);counts.push(0);}
   sizes[item]+=row.size;counts[item]++;total+=row.size;
   if(total>MAX_SPLIT_PREPARED_BYTES)throw new BatchError('This run comes to more than 2 GB of requests, more than the Lab prepares at once. Send it in several runs. No batch was submitted.',413);
  },
  plan(){
   const limit=SPLIT_LIMITS[provider as keyof typeof SPLIT_LIMITS],overhead=new Blob([payloadHead(provider,name(998,999)),payloadTail(provider)]).size;
   const parts=groupParts(sizes,counts,limit,overhead,separator.length);
   if(!Array.isArray(parts))throw new BatchError(`Text ${parts.tooLarge+1} of this run is larger, with its annotations, than one ${limit.label} batch can hold. Use fewer annotations per text, or Instant processing for it. No batch was submitted.`,413);
   const bytes=parts.reduce((n,part)=>n+part.bytes,0);
   return {parts,bytes,requests:rows.length,bySize:bytes>limit.bytes};
  },
  assemble(part:{requests:[number,number]},k:number,n:number){
   // (Taken out of the list, so the page can let go of them once the batch has gone up.)
   const list=rows.slice(part.requests[0],part.requests[1]);rows.fill(new Blob(),part.requests[0],part.requests[1]);
   return new Blob([payloadHead(provider,name(k,n)),...list.flatMap((row,i)=>i?[separator,row]:[row]),payloadTail(provider)],{type:provider==='openai'?'application/jsonl':'application/json'});
  }
 };
}
export async function buildBatchBody(provider:Provider,file:File,prompt:string,model:string,effort:string,knowledge=false,webSearch=false,answerFields:string[]=[],settings?:AnswerSettings,request?:RequestSettings,written?:string,spots?:number[]){
 // request: research mode's request settings; the request builder applies each where it changes the request.
 // written: the prompt with its placeholders as written, where they were filled in for this text or the text
 // goes where the prompt has {{text}}. spots: where it goes (lib/prompt-inserts.ts, fillPlaces).
 const schemaPrompt=written??prompt;prompt+=answerInstructions(answerFields,settings);
 const pdf=/\.pdf$/i.test(file.name);let data='';
 if(pdf){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));data=btoa(binary);}else{try{data=await extractText(file);}catch(error){throw new BatchError(error instanceof TextEncodingError?`${file.name}: ${error.message}`:`Could not read ${file.name}. Save it as TXT or PDF and try again.`);}if(!data.trim()||data.length>2000000)throw new BatchError(`${file.name} is empty or too large. Split it into smaller texts.`);}
 return providerBody({provider,model,effort,prompt,schemaPrompt,answerFields,settings,request,knowledge,batch:true,inserts:written!==undefined,spots},pdf?{filename:file.name,pdf:data}:{filename:file.name,text:data});
}
export function validBatchId(provider:Provider,id:unknown):id is string{return typeof id==='string'&&(provider==='openai'?/^batch_[a-zA-Z0-9_-]+$/:provider==='anthropic'?/^msgbatch_[a-zA-Z0-9_-]+$/:/^batches\/[a-zA-Z0-9_-]+$/).test(id);}
export async function createBatch(provider:Provider,key:string,model:string,runId:string,payload:Blob,part?:{index:number;of:number}){
 if(provider==='openai'){
  const form=new FormData();form.set('purpose','batch');form.set('file',new File([payload],'annotation-batch.jsonl',{type:'application/jsonl'}));
  const upload=await call(provider,key,'https://api.openai.com/v1/files',{method:'POST',body:form});
  if(typeof upload.id!=='string'||!/^file-[\w-]+$/.test(upload.id))throw new BatchError('The batch input upload could not be confirmed. No batch was submitted.',502);
  const out=await call(provider,key,'https://api.openai.com/v1/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input_file_id:upload.id,endpoint:'/v1/responses',completion_window:'24h',metadata:{lab_run_id:runId,...(part?{lab_batch:`${part.index+1} of ${part.of}`}:{})}})},true);
  if(!validBatchId(provider,out.id))throw new BatchError('Batch creation was not confirmed. Check OpenAI before retrying.',502,true);return out.id as string;
 }
 const url=provider==='anthropic'?'https://api.anthropic.com/v1/messages/batches':`https://generativelanguage.googleapis.com/v1beta/models/${model}:batchGenerateContent`;
 const out=await call(provider,key,url,{method:'POST',headers:{'Content-Type':'application/json'},body:payload},true);const id=provider==='anthropic'?out.id:out.name;
 if(!validBatchId(provider,id))throw new BatchError('Batch creation was not confirmed. Check your provider before retrying.',502,true);return id;
}
// record (research mode): a result also carries the model the provider names, why it stopped, and the text it
// returned (left out where a plain-text answer already holds that text whole). summary: the requests asked for
// a summary of the model's reasoning, which is kept as well. format: the answer fields and settings of a run in
// the named format (research mode), whose replies are read by them; without it, a reply is in the earlier format.
export type ReplyFormat={names:string[];settings?:AnswerSettings};
export function parseBatchAnnotation(provider:Provider,out:any,plain=false,record=false,summary=false,format?:ReplyFormat):Omit<BatchResult,'id'>{
 const usage=provider==='gemini'?out?.usageMetadata:out?.usage;
 const tokens=provider==='gemini'?usage?.totalTokenCount:provider==='openai'?usage?.total_tokens:
  usage?(usage.input_tokens||0)+(usage.output_tokens||0)+(usage.cache_creation_input_tokens||0)+(usage.cache_read_input_tokens||0):undefined;
 const responseId=provider==='gemini'?out?.responseId:out?.id;
 const noted:Pick<BatchResult,'modelReported'|'stopReason'|'output'|'reasoningSummary'>=!record?{}:provider==='openai'?{modelReported:replyCode(out?.model),stopReason:replyCode([out?.status,out?.incomplete_details?.reason].filter(part=>typeof part==='string'&&part).join(': '))}:provider==='anthropic'?{modelReported:replyCode(out?.model),stopReason:replyCode(out?.stop_reason)}:{modelReported:replyCode(out?.modelVersion),stopReason:replyCode(out?.promptFeedback?.blockReason||out?.candidates?.[0]?.finishReason)};
 if(record&&summary){const text=reasoningSummary(provider,out);if(text)noted.reasoningSummary=text;}
 const metadata:Omit<BatchResult,'id'>={...noted,usage,...(typeof tokens==='number'?{tokens}:{}),...(typeof responseId==='string'?{responseId}:{})};
 let raw:string;
 if(provider==='openai'){
  if(out?.status!=='completed')return {...metadata,error:incompleteAnnotation(provider,out?.incomplete_details?.reason)};
  raw=(out.output||[]).flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
 }else if(provider==='anthropic'){
  if(out?.stop_reason!=='end_turn')return {...metadata,error:incompleteAnnotation(provider,out?.stop_reason)};
  raw=(out.content||[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('');
 }else{
  const candidate=out?.candidates?.[0];
  if(out?.promptFeedback?.blockReason||candidate?.finishReason!=='STOP')return {...metadata,error:incompleteAnnotation(provider,out?.promptFeedback?.blockReason||candidate?.finishReason)};
  raw=(candidate.content?.parts||[]).filter((x:any)=>!x.thought&&typeof x.text==='string').map((x:any)=>x.text).join('');
 }
 if(plain){const answer=plainAnswer(raw);if(record&&raw!==answer?.answers.f0)metadata.output=replyText(raw);return answer?{...metadata,answers:answer.answers,score:'',explanation:''}:{...metadata,error:EMPTY_REPLY};}
 if(record)metadata.output=replyText(raw);
 try{
  const value=JSON.parse(raw);
  if(format?.settings?.named){const read=readReply(value,format.names,format.settings);if(!read)throw Error();return typeof read==='string'?{...metadata,error:read}:{...metadata,...read};}
  if(!value||typeof value.score!=='string'||typeof value.explanation!=='string')throw Error();
  return {...metadata,answers:value.answers,score:value.score,explanation:value.explanation};
 }catch{return {...metadata,error:'The provider did not return a valid annotation. Check its response before retrying.'};}
}
export async function checkBatch(provider:Provider,key:string,id:string,collect:boolean,plain=false,record=false,summary=false,format?:ReplyFormat):Promise<BatchUpdate>{
 const base=provider==='openai'?'https://api.openai.com/v1/batches/':provider==='anthropic'?'https://api.anthropic.com/v1/messages/batches/':'https://generativelanguage.googleapis.com/v1beta/';
 const out=await call(provider,key,base+id,{},false,provider==='gemini'?MAX_RECORDED_RESULT_BYTES:MAX_RESULT_BYTES);
 const state=String(provider==='openai'?out.status:provider==='anthropic'?out.processing_status:out.metadata?.state||out.state||'processing');
 const terminal=provider==='openai'?['completed','failed','expired','cancelled'].includes(state):provider==='anthropic'?state==='ended':out.done===true||/(SUCCEEDED|FAILED|CANCELLED|EXPIRED)$/.test(state);
 const counts=out.request_counts||out.metadata?.batchStats||out.batchStats||{};
 const completed=Number(provider==='anthropic'?(counts.succeeded||0)+(counts.errored||0)+(counts.canceled||0)+(counts.expired||0):provider==='openai'?(counts.completed||0)+(counts.failed||0):Number(counts.successfulRequestCount||0)+Number(counts.failedRequestCount||0));
 const total=Number(provider==='anthropic'?completed+(counts.processing||0):counts.total||counts.requestCount||0);
 const update:BatchUpdate={id,terminal,state,completed,total};if(!terminal||!collect)return update;
 const results:BatchResult[]=[],seen=new Set<string>();let resultBytes=0;
 const append=(result:BatchResult)=>{if(typeof result.id!=='string'||seen.has(result.id))throw new BatchError('The results could not be matched reliably to documents. Check the provider’s batch output.',502);seen.add(result.id);resultBytes+=new TextEncoder().encode(JSON.stringify(result)).length;if(results.length>=MAX_BATCH_ITEMS||resultBytes>(record?MAX_RECORDED_RESULT_BYTES:MAX_RESULT_BYTES))throw new BatchError('The annotations exceed the collection limit. Download them from your provider’s console. Your saved job is unchanged.',413);results.push(result);};
 if(provider==='openai'){
  for(const fileId of [out.output_file_id,out.error_file_id]){if(!fileId)continue;if(!/^file-[\w-]+$/.test(fileId))throw new BatchError('The provider returned an invalid results reference.',502);for await(const row of resultRows(provider,key,'https://api.openai.com/v1/files/'+fileId+'/content')){append({id:row.custom_id,...(row.error||row.response?.status_code!==200?{error:'This request failed in the batch. Check the provider’s batch results before retrying.'}:parseBatchAnnotation(provider,row.response.body,plain,record,summary,format))});}}
 }else if(provider==='anthropic'){
  // Use the fixed API origin, never a response-provided results URL.
  for await(const row of resultRows(provider,key,base+id+'/results')){append({id:row.custom_id,...(row.result?.type==='succeeded'?parseBatchAnnotation(provider,row.result.message,plain,record,summary,format):{error:`Batch request ${String(row.result?.type||'failed')}. Check provider usage before retrying.`})});}
 }else{
  const dest=out.response?.inlinedResponses||out.output?.inlinedResponses||out.dest?.inlinedResponses;
  const rows=Array.isArray(dest)?dest:dest?.inlinedResponses;
  if(rows){for(const row of rows){append({id:row.metadata?.key,...(row.error?{error:'Gemini could not complete this batch request. Check its batch results before retrying.'}:parseBatchAnnotation(provider,row.response,plain,record,summary,format))});}}
 }
 // A terminal batch may legitimately contain no results (e.g., validation failed).
 if(results.some(r=>typeof r.id!=='string')||new Set(results.map(r=>r.id)).size!==results.length)throw new BatchError('The results could not be matched reliably to documents. Check the provider’s batch output.',502);
 return {...update,results};
}
export async function cancelBatch(provider:Provider,key:string,id:string){const url=provider==='openai'?`https://api.openai.com/v1/batches/${id}/cancel`:provider==='anthropic'?`https://api.anthropic.com/v1/messages/batches/${id}/cancel`:`https://generativelanguage.googleapis.com/v1beta/${id}:cancel`;await call(provider,key,url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
