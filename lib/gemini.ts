import {readReply,plainAnswer,EMPTY_REPLY,type AnswerSettings} from './answer-fields';
import {connectionFailure,providerFailure,providerJson,incompleteAnnotation} from './provider-errors';
import {extractText,TextEncodingError} from './extract-text';
import {requestTimeout,type RequestSettings} from './request-settings';
import {providerBody,requestUrl,replyCode,replyText,reasoningSummary,type RequestDocument} from './request-frame';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
// record (research mode): the reply also carries the model the provider names, its stop reason, the text it
// returned, and, where the request asked for one, the summary of the model's reasoning.
// request: research mode's request settings, as they apply to this model (lib/request-settings.ts).
// inserts (research mode): the prompt's placeholders were filled in for this text; schemaPrompt has them as written.
export async function annotateGemini(file:File,prompt:string,model:string,effort:string,key:string,knowledge=false,webSearch=false,answerFields:string[]=[],schemaPrompt=prompt,settings?:AnswerSettings,request?:RequestSettings,record=false,inserts=false,earlier=false,spots?:number[]){
 try {
 let doc:RequestDocument;
 if(/\.pdf$/i.test(file.name)){
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 doc={filename:file.name,pdf:btoa(binary)};
 }else{
 let text;try{text=await extractText(file);}catch(error){return reply({error:error instanceof TextEncodingError?error.message:'Could not read this document. Save it as TXT or PDF and try again.'},400);}
 if(!text.trim()||text.length>2000000)return reply({error:'The document is empty or too large. Upload readable text or split it into smaller files.'},400);
 doc={filename:file.name,text};
 }
 const r=await fetch(requestUrl('gemini',model),{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},signal:AbortSignal.timeout(requestTimeout('gemini',model,request)),body:JSON.stringify(providerBody({provider:'gemini',model,effort,prompt,schemaPrompt,answerFields,settings,request,knowledge,inserts,earlier,spots},doc))});
 const out:any=await providerJson(r);
 if(!r.ok)return reply(providerFailure('gemini',r.status,out,r.headers,request,model),r.status);
 if(!out)return reply({error:'Gemini returned an unreadable response. Check Google AI Studio usage before retrying; the request may have completed.'},502);
 const candidate=out.candidates?.[0];
 const noted:Record<string,unknown>=record?{modelReported:replyCode(out.modelVersion),stopReason:replyCode(out.promptFeedback?.blockReason||candidate?.finishReason)}:{};
 if(record&&request?.summary){const summary=reasoningSummary('gemini',out);if(summary)noted.reasoningSummary=summary;}
 const raw=(candidate?.content?.parts||[]).filter((p:any)=>!p.thought&&typeof p.text==='string').map((p:any)=>p.text).join('');
 if(record)noted.output=replyText(raw);
 // A reply that is cut off or blocked still used (and was billed for) tokens: it keeps them, its response ID, and
 // (research mode) the text it returned, though it counts as failed.
 const billed={tokens:out.usageMetadata?.totalTokenCount,usage:out.usageMetadata,responseId:out.responseId};
 if(out.promptFeedback?.blockReason||candidate?.finishReason!=='STOP')return reply({...noted,...billed,error:incompleteAnnotation('gemini',out.promptFeedback?.blockReason||candidate?.finishReason)},422);
 if(settings?.plain){const plain=plainAnswer(raw);return plain?reply({...noted,...plain,tokens:out.usageMetadata?.totalTokenCount,usage:out.usageMetadata,responseId:out.responseId}):reply({...noted,...billed,error:EMPTY_REPLY},422);}
 let result;try{result=JSON.parse(raw);}catch{return reply({...noted,...billed,error:'Gemini did not return a valid annotation. Review the response in Google AI Studio before retrying.'},422);}
 const read=readReply(result,answerFields,settings);
 if(!read)return reply({...noted,...billed,error:'Gemini returned an unexpected annotation format.'},422);
 if(typeof read==='string')return reply({...noted,...billed,error:read},422);
 return reply({...noted,rawResponse:raw,...read,tokens:out.usageMetadata?.totalTokenCount,usage:out.usageMetadata,responseId:out.responseId});
 }catch(error){return reply({error:'Gemini connection interrupted or timed out. Check Google AI Studio usage before retrying; the request may have completed.',...connectionFailure(error)},502);}
}
