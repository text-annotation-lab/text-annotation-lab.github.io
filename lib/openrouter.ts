import {readReply,plainAnswer,EMPTY_REPLY,type AnswerSettings} from './answer-fields';
import {extractText,TextEncodingError} from './extract-text';
import {connectionFailure,providerFailure,providerJson,incompleteAnnotation} from './provider-errors';
import {requestTimeout,type RequestSettings} from './request-settings';
import {providerBody,requestUrl,replyCode,replyText,reasoningSummary,type RequestDocument} from './request-frame';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export const openRouterKey=(key:string)=>/^sk-or-[\w-]+$/.test(key);

// Whole PDFs use native file input; text documents and split chunks stay text.
// record (research mode): the reply also carries the model and upstream provider named in the response, its
// finish reason, the text it returned, and, where the request asked for it, the model's reasoning as passed on.
// request: research mode's request settings, as they apply to this model (lib/request-settings.ts).
// inserts (research mode): the prompt's placeholders were filled in for this text; schemaPrompt has them as written.
export async function annotateOpenRouter(file:File,prompt:string,model:string,effort:string,key:string,knowledge=false,answerFields:string[]=[],schemaPrompt=prompt,settings?:AnswerSettings,request?:RequestSettings,record=false,inserts=false,earlier=false,spots?:number[]){
 try{
  const pdfInput=/\.pdf$/i.test(file.name);
  let doc:RequestDocument;
  if(pdfInput){
   const bytes=new Uint8Array(await file.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   doc={filename:file.name,pdf:btoa(binary)};
  }else{
   let text:string;
   try{text=await extractText(file);}catch(error){return reply({error:error instanceof TextEncodingError?error.message:'Could not read this document. Save it as TXT or PDF and try again.'},400);}
   if(!text.trim()||text.length>2000000)return reply({error:'Use a document with readable text, up to 2,000,000 characters. Split large documents into smaller files.'},400);
   doc={filename:file.name,text};
  }
  const response=await fetch(requestUrl('openrouter',model),{
   method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(requestTimeout('openrouter',model,request)),
   body:JSON.stringify(providerBody({provider:'openrouter',model,effort,prompt,schemaPrompt,answerFields,settings,request,knowledge,inserts,earlier,spots},doc))
  });
  const out:any=await providerJson(response);
  const served=[out?.model,out?.provider].map(replyCode).filter(Boolean).join(' via ');
  const accounting:Record<string,unknown>={inputMode:pdfInput?'pdf-native':'text',tokens:out?.usage?.total_tokens,usage:out?.usage,responseId:out?.id,...(record?{modelReported:served||undefined,stopReason:replyCode(out?.choices?.[0]?.finish_reason)}:{})};
  if(!response.ok||out?.error){const code=Number(out?.error?.code),status=response.ok?(Number.isInteger(code)&&code>=400&&code<=599?code:502):response.status;return reply({...accounting,...providerFailure('openrouter',status,out,response.headers,request,model)},status);}
  const choice=out?.choices?.[0];
  if(record&&request?.summary){const summary=reasoningSummary('openrouter',out);if(summary)accounting.reasoningSummary=summary;}
  if(choice?.message?.refusal)return reply({...accounting,error:incompleteAnnotation('openrouter','refusal')},422);
  // A cut-off reply keeps (research mode) the text it returned, though it counts as failed.
  if(choice?.finish_reason!=='stop')return reply({...accounting,...(record&&typeof choice?.message?.content==='string'?{output:replyText(choice.message.content)}:{}),error:incompleteAnnotation('openrouter',choice?.finish_reason)},422);
  const raw=choice.message?.content;let result;
  if(record)accounting.output=replyText(raw);
  if(settings?.plain){const plain=plainAnswer(raw);return plain?reply({...accounting,...plain,tokens:out.usage?.total_tokens,usage:out.usage,responseId:out.id}):reply({...accounting,error:EMPTY_REPLY},422);}
  try{result=JSON.parse(raw);}catch{return reply({...accounting,error:'OpenRouter did not return a valid annotation. Check usage before retrying.'},422);}
  const read=readReply(result,answerFields,settings);
  if(!read)return reply({...accounting,error:'OpenRouter returned an unexpected annotation format. Check usage before retrying.'},422);
  if(typeof read==='string')return reply({...accounting,error:read},422);
  return reply({...accounting,rawResponse:raw,...read,tokens:out.usage?.total_tokens,usage:out.usage,responseId:out.id});
 }catch(error){return reply({error:'OpenRouter connection interrupted or timed out. Refresh your allowance before retrying; the request may have completed and been charged.',...connectionFailure(error)},502);}
}
