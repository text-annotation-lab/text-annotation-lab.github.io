import {readReply,plainAnswer,EMPTY_REPLY,type AnswerSettings} from './answer-fields';
import {connectionFailure,providerFailure,providerJson,incompleteAnnotation} from './provider-errors';
import {extractText,TextEncodingError} from './extract-text';
import {requestTimeout,type RequestSettings} from './request-settings';
import {providerBody,requestUrl,replyCode,replyText,reasoningSummary,type RequestDocument} from './request-frame';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});

// Anthropic Messages API. Keep provider credentials solely in request memory.
// record (research mode): the reply also carries the model the provider names, its stop reason, the text it
// returned, and, where the request asked for one, the summary of the model's reasoning.
// request: research mode's request settings, as they apply to this model (lib/request-settings.ts).
// inserts (research mode): the prompt's placeholders were filled in for this text; schemaPrompt has them as written.
export async function annotateAnthropic(file:File,prompt:string,model:string,effort:string,key:string,knowledge=false,webSearch=false,answerFields:string[]=[],schemaPrompt=prompt,settings?:AnswerSettings,request?:RequestSettings,record=false,inserts=false,earlier=false,spots?:number[]){
 try {
  let doc:RequestDocument;
  if(/\.pdf$/i.test(file.name)){
   const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
   for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   doc={filename:file.name,pdf:btoa(binary)};
  }else{
   let text;try{text=await extractText(file);}catch(error){return reply({error:error instanceof TextEncodingError?error.message:'Could not read this document. Save it as TXT or PDF and try again.'},400);}
   if(!text.trim()||text.length>2000000)return reply({error:'The document is empty or too large. Upload readable text or split it into smaller files.'},400);
   doc={filename:file.name,text};
  }
  const r=await fetch(requestUrl('anthropic',model),{
   method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true','Content-Type':'application/json'},signal:AbortSignal.timeout(requestTimeout('anthropic',model,request)),
   body:JSON.stringify(providerBody({provider:'anthropic',model,effort,prompt,schemaPrompt,answerFields,settings,request,knowledge,inserts,earlier,spots},doc))
  });
  if(!r.ok)return reply(providerFailure('anthropic',r.status,await providerJson(r),r.headers,request,model),r.status);
  const out=await r.json() as {id?:string;model?:string;stop_reason?:string;content?:{type:string;text?:string;thinking?:string}[];usage?:{input_tokens?:number;output_tokens?:number;cache_creation_input_tokens?:number;cache_read_input_tokens?:number}};
  const noted:Record<string,unknown>=record?{modelReported:replyCode(out.model),stopReason:replyCode(out.stop_reason)}:{};
  if(record&&request?.summary){const summary=reasoningSummary('anthropic',out);if(summary)noted.reasoningSummary=summary;}
  const raw=(out.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('');
  if(record)noted.output=replyText(raw);
  const u=out.usage,tokens=u?(u.input_tokens||0)+(u.output_tokens||0)+(u.cache_creation_input_tokens||0)+(u.cache_read_input_tokens||0):undefined;
  // A reply that is cut off or refused still used (and was billed for) tokens: it keeps them, its response ID, and
  // (research mode) the text it returned, though it counts as failed.
  if(out.stop_reason!=='end_turn')return reply({...noted,tokens,usage:u,responseId:out.id,error:incompleteAnnotation('anthropic',out.stop_reason)},422);
  if(settings?.plain){const plain=plainAnswer(raw);return plain?reply({...noted,...plain,tokens,usage:u,responseId:out.id}):reply({...noted,error:EMPTY_REPLY},422);}
  let result;try{result=JSON.parse(raw);}catch{return reply({...noted,error:'Claude did not return a valid annotation. Check your usage before retrying.'},422);}
  const read=readReply(result,answerFields,settings);
  if(!read)return reply({...noted,error:'Claude returned an unexpected annotation format.'},422);
  if(typeof read==='string')return reply({...noted,error:read},422);
 return reply({...noted,rawResponse:raw,...read,tokens,usage:u,responseId:out.id});
 }catch(error){return reply({error:'Anthropic connection interrupted or timed out. Check Claude Console usage before retrying; the request may have completed.',...connectionFailure(error)},502);}
}
