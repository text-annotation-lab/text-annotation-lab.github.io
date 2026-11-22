import {allowedOrigin,requestBody} from '@/lib/request-guards';
import {keyProvider} from '@/lib/workflow-safety';
import {annotateOpenRouter,openRouterKey} from '@/lib/openrouter';
import {annotationValidationError} from '@/lib/answer-validation';
import {annotationFormatRecord,readAnswerFields,readAnswerSettings,answerInstructions,readReply,plainAnswer,EMPTY_REPLY,type AnswerSettings} from '@/lib/answer-fields';
import {connectionFailure,providerFailure,providerJson,incompleteAnnotation} from '@/lib/provider-errors';
import { extractText, TextEncodingError, supportedFile as supported } from "@/lib/extract-text";

import {GEMINI_ENABLED,PROVIDERS,validModelId,reasoningOptions,type Provider} from '@/lib/providers';
import {annotateGemini} from '@/lib/gemini';
import {annotateAnthropic} from '@/lib/anthropic';
import {knowledgeAddition,knowledgeDocumentText,validKnowledgeFields,type KnowledgeFields,type KnowledgeResearch} from '@/lib/model-knowledge';
import {researchKnowledge,KnowledgeWebError} from '@/lib/knowledge-web';
import {readRequestSettings,sentRequestSettings,requestTimeout,type RequestSettings} from '@/lib/request-settings';
import {providerBody,requestUrl,replyCode,replyText,reasoningSummary,formText,type RequestDocument} from '@/lib/request-frame';
import {readInserts,fillInserts,placesText,fillPlaces,insertMap} from '@/lib/prompt-inserts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const MAX_REQUEST_BYTES=22*1024*1024;
export async function POST(request:Request){
 let research:KnowledgeResearch|undefined;
 try{
 if(!allowedOrigin(request))return json({error:'Request origin not allowed.'},403);
 const auth=request.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer ')||!auth.slice(7).trim())return json({error:'No API key reached the lab. Re-enter the key for your selected provider and try again.'},401);
 const tooLarge=()=>json({error:'The annotation request is too large. Use one file up to 20 MB and a prompt up to 100,000 characters.'},413);
 if(Number(request.headers.get('content-length')||0)>MAX_REQUEST_BYTES)return tooLarge();
 let f:FormData,bytes=0,bodyTooLarge=false;
 try{
  const limited=(await requestBody(request))?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX_REQUEST_BYTES){bodyTooLarge=true;throw Error('Request too large.');}controller.enqueue(chunk);}}));
  f=await new Response(limited,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();
 }catch{return bodyTooLarge?tooLarge():json({error:'Could not read this annotation request. Select the document again and try again.'},400);}
 const model=f.get('model'),effort=f.get('effort');
 let file=f.get('file'),prompt=f.get('prompt');
 const mode=f.get('mode'),knowledge=mode==='model-knowledge';
 if(mode!==null&&!knowledge)return json({error:'Unsupported annotation mode.'},400);
 const webFlag=f.get('webSearch'),webSearch=knowledge&&webFlag==='true';
 if(webFlag!==null&&(!knowledge||!['true','false'].includes(String(webFlag))))return json({error:'Invalid web-search setting.'},400);
 if(typeof prompt!=='string'||!prompt.trim()||prompt.length>100000)return json({error:'Provide a prompt of up to 100,000 characters.'},400);
 // Line breaks as a browser's form encoding writes them (already so in current browsers).
 prompt=formText(prompt);
 let answerFields:string[],answerSettings:AnswerSettings|undefined;try{answerFields=readAnswerFields(f.get('answerFields'));answerSettings=readAnswerSettings(f.get('answerSettings'),answerFields);}catch(error){return json({error:(error as Error).message},400);}
 // Research mode: request settings (prompt caching, temperature, output limit, reasoning summary, OpenAI's
 // logs). Each reaches the provider only where it changes a request to the selected model.
 let requestSettings:RequestSettings|undefined;try{requestSettings=readRequestSettings(f.get('requestSettings'));}catch(error){return json({error:(error as Error).message},400);}
 // Research mode: the reply also carries the model the provider names, its stop reason, and the text it returned.
 const recordFlag=f.get('record');if(recordFlag!==null&&recordFlag!=='true')return json({error:'Invalid record setting.'},400);
 const record=recordFlag==='true';
 // Research mode, "Retry failed" on a run made before the current layout of requests: its layout (lib/request-frame.ts).
 const layoutFlag=f.get('layout');if(layoutFlag!==null&&layoutFlag!=='earlier')return json({error:'Invalid request layout.'},400);
 const earlier=layoutFlag==='earlier';
 // Research mode: the text's values for the placeholders of the prompt ({{id}}, {{meta.<column>}}). The prompt
 // is sent with them filled in; the answer format is still read from the prompt as written.
 let inserts:string[]|undefined;try{const raw=f.get('inserts');inserts=readInserts(raw===null?null:JSON.parse(String(raw)),prompt);}catch{return json({error:'Could not read the values for the placeholders of the prompt.'},400);}
 // Research mode: the text goes where the prompt has {{text}}, instead of after it (lib/request-frame.ts).
 const placeFlag=f.get('placeText');if(placeFlag!==null&&(placeFlag!=='true'||earlier||!placesText(prompt)))return json({error:'Invalid setting for the place of the text.'},400);
 const annotationPrompt=prompt;let subjectFields:KnowledgeFields|undefined,spots:number[]|undefined;
 if(placeFlag){const values=insertMap(prompt,inserts);({prompt,spots}=fillPlaces(prompt,(name,whole)=>inserts?values.get(name)??'':whole));if(prompt.length>100000)return json({error:'With the values of its placeholders filled in, the prompt is longer than 100,000 characters.'},400);}
 else if(inserts){prompt=fillInserts(prompt,inserts);if(prompt.length>100000)return json({error:'With the values of its placeholders filled in, the prompt is longer than 100,000 characters.'},400);}
 const writtenPrompt=prompt;
 if(knowledge){
  const raw=f.get('fields');let fields:unknown;
  if(typeof raw!=='string'||raw.length>1000000)return json({error:'Provide one subject with labeled fields.'},400);
  try{fields=JSON.parse(raw);}catch{return json({error:'Could not read subject fields.'},400);}
  if(!validKnowledgeFields(fields))return json({error:'Provide one subject with unique, nonempty field headings and at least one value.'},400);
  subjectFields=fields;
  file=new File([knowledgeDocumentText(fields,undefined,earlier)],'subject.txt',{type:'text/plain'});
  prompt+=knowledgeAddition(webSearch,answerSettings);
 }
 const provider=f.get('provider')||'openai';
 if(provider!=='openai'&&provider!=='gemini'&&provider!=='anthropic'&&provider!=='openrouter')return json({error:'Unsupported provider.'},400);
 // A key is sent only to its own provider.
 {const recognized=keyProvider(auth.slice(7));if(recognized&&recognized!=='openrouter'&&recognized!==provider)return json({error:`This key appears to be for ${PROVIDERS[recognized].label}. Select that provider or enter a ${PROVIDERS[provider as Provider].label} key.`},401);}
 if(provider!=='openrouter'&&auth.startsWith('Bearer sk-or-'))return json({error:'This is an OpenRouter key. Select OpenRouter as the provider.'},401);
 if(provider==='openrouter'&&!openRouterKey(auth.slice(7)))return json({error:'Select OpenRouter and enter an OpenRouter API key.'},401);
 if(provider==='openrouter'&&webSearch)return json({error:'Web search is not available through OpenRouter in this Lab. Turn it off to continue.'},400);
 if(provider==='gemini'&&!GEMINI_ENABLED)return json({error:'Gemini is currently disabled. Select OpenAI.'},400);
 if(provider==='openai'&&(!/^Bearer sk-[\w-]+$/.test(auth)||auth.startsWith('Bearer sk-ant-')||auth.startsWith('Bearer sk-or-')))return json({error:'The selected provider is OpenAI. Enter an OpenAI key or switch to the matching provider.'},401);
 // Anthropic validates its own credentials; key shapes can change over time.
 if(provider==='anthropic'&&!/^[\x21-\x7e]+$/.test(auth.slice(7)))return json({error:'The Anthropic key contains spaces, line breaks, or unsupported characters. Copy the key again from Claude Console.'},401);
 // Google owns its key format; only enforce safe, nonempty HTTP-header text here.
 if(provider==='gemini'&&!/^[\x21-\x7e]+$/.test(auth.slice(7)))return json({error:'The Gemini key contains spaces, line breaks, or unsupported characters. Copy the key again from Google AI Studio.'},401);
 // Any model of the provider, by its ID (research mode offers models outside the Lab's lists).
 if(!validModelId(provider,model)||!reasoningOptions(provider,model).includes(String(effort)))return json({error:'Unsupported model or reasoning setting.'},400);
 if(!(file instanceof File)||!file.size||file.size>20*1024*1024||!supported.test(file.name))return json({error:'Choose a PDF, DOCX, TXT, MD, HTML, or RTF file up to 20 MB.'},400);
 if(webSearch&&subjectFields){research=await researchKnowledge(provider,String(model),String(effort),auth.slice(7),subjectFields,writtenPrompt,earlier,requestSettings?.store!==false);file=new File([knowledgeDocumentText(subjectFields,research,earlier)],'subject.txt',{type:'text/plain'});}
 prompt+=answerInstructions(answerFields,answerSettings);
 const sent=sentRequestSettings(provider,String(model),requestSettings,String(effort));
 const finish=async(response:Response)=>{const result=await response.json() as {tokens?:number;[key:string]:any};const error=response.ok?annotationValidationError(result,answerFields,annotationPrompt,knowledge,answerSettings):undefined;if(response.ok&&!error)delete result.rawResponse;
  // The reply as returned is not stored a second time where the result already holds it whole: a plain-text
  // answer, or the reply kept with a rejected result.
  if(result.output!==undefined&&(result.output===result.rawResponse||answerSettings?.plain&&result.output===result.answers?.f0))delete result.output;
  return json({...result,responseFormat:annotationFormatRecord(answerFields,annotationPrompt,knowledge,answerSettings),...(error?{error}:{}),...(knowledge?{webUsed:Boolean(research)}:{}),...(research?{research,...(response.ok?{tokens:(result.tokens||0)+(research.tokens||0)}:{})}:{})},error?422:response.status);};
 if(provider==='openrouter')return finish(await annotateOpenRouter(file,prompt,String(model),String(effort),auth.slice(7),knowledge,answerFields,annotationPrompt,answerSettings,sent,record,Boolean(inserts),earlier,spots));
 if(provider==='anthropic')return finish(await annotateAnthropic(file,prompt,String(model),String(effort),auth.slice(7),knowledge,webSearch,answerFields,annotationPrompt,answerSettings,sent,record,Boolean(inserts),earlier,spots));
 if(provider==='gemini')return finish(await annotateGemini(file,prompt,String(model),String(effort),auth.slice(7),knowledge,webSearch,answerFields,annotationPrompt,answerSettings,sent,record,Boolean(inserts),earlier,spots));
 let doc:RequestDocument;
 if(/\.pdf$/i.test(file.name)){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));doc={filename:file.name,pdf:btoa(binary)};}else{
 let text:string;
 try { text=await extractText(file); } catch(error) { return json({error:error instanceof TextEncodingError||/\.rtf$/i.test(file.name)&&error instanceof Error?error.message:'Could not read this document. Check that it opens correctly, or save it as TXT or PDF and upload it again.'},400); }
 if(!text.trim())return json({error:'The document contains no readable text. For an image-only document, upload a PDF instead.'},400);
 if(text.length>2000000)return json({error:'The extracted text is too large. Split the document into smaller files.'},400);
 doc={filename:file.name,text};}
 const r=await fetch(requestUrl('openai',String(model)),{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},signal:AbortSignal.timeout(requestTimeout('openai',String(model),sent)),body:JSON.stringify(providerBody({provider:'openai',model:String(model),effort:String(effort),prompt,schemaPrompt:annotationPrompt,answerFields,settings:answerSettings,request:sent,knowledge,inserts:Boolean(inserts),earlier,spots},doc))});
 const out:any=await providerJson(r);
 if(!r.ok)return finish(json(providerFailure('openai',r.status,out,r.headers,sent,String(model)),r.status));
 if(!out)return finish(json({error:'OpenAI returned an unreadable response. Check OpenAI Platform usage before retrying; the request may have completed.'},502));
 const noted:Record<string,unknown>=record?{modelReported:replyCode(out.model),stopReason:replyCode([out.status,out.incomplete_details?.reason].filter(part=>typeof part==='string'&&part).join(': '))}:{};
 if(record&&sent?.summary){const summary=reasoningSummary('openai',out);if(summary)noted.reasoningSummary=summary;}
 // A reply that is cut off, refused, or unreadable still used (and was billed for) tokens: it keeps them, its
 // response ID, and (research mode) the text it returned, though it counts as failed.
 const billed={tokens:out.usage?.total_tokens,usage:out.usage,responseId:out.id},partial=()=>record?{output:replyText((out.output||[]).flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join(''))}:{};
 if(out.status!=='completed')return finish(json({...noted,...billed,...partial(),error:incompleteAnnotation('openai',out.incomplete_details?.reason)},422));
 const parts=(out.output||[]).flatMap((x:any)=>x.content||[]);if(parts.some((x:any)=>x.type==='refusal'))return finish(json({...noted,...billed,...(record?{stopReason:'refusal'}:{}),error:incompleteAnnotation('openai','refusal')},422));const raw=parts.filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
 if(record)noted.output=replyText(raw);
 if(answerSettings?.plain){const plain=plainAnswer(raw);return finish(plain?json({...noted,...plain,tokens:out.usage?.total_tokens,usage:out.usage,responseId:out.id}):json({...noted,...billed,error:EMPTY_REPLY},422));}
 let result;try{result=JSON.parse(raw);}catch{return finish(json({...noted,...billed,error:'No valid annotation returned. Check OpenAI Logs for a refusal or incomplete output.'},422));}
 const read=readReply(result,answerFields,answerSettings);
 if(!read)return finish(json({...noted,...billed,error:'Unexpected response format. Check OpenAI Logs.'},422));
 if(typeof read==='string')return finish(json({...noted,...billed,error:read},422));
 return finish(json({...noted,rawResponse:raw,...read,tokens:out.usage?.total_tokens,usage:out.usage,responseId:out.id}));
 }catch(error){if(error instanceof KnowledgeWebError)return json({error:error.message,...(error.research?{research:error.research,webUsed:true}:{}),...(error.retryAfterMs===undefined?{}:{retryAfterMs:error.retryAfterMs}),...(error.shared?{shared:error.shared}:{})},error.status);return json({error:'Connection interrupted. Check your provider’s usage before retrying; the request may have completed.',...(research?{research,webUsed:true}:{}),...connectionFailure(error)},502);}
}
