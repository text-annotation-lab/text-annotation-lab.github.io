import {allowedOrigin,requestBody} from '@/lib/request-guards';
import {readAnswerFields} from '@/lib/answer-fields';
import {providerError,providerJson} from '@/lib/provider-errors';
import {PROVIDERS,GEMINI_ENABLED,reasoningOptions,type Provider} from '@/lib/providers';
import {buildBatchBody} from '@/lib/batch-provider';
import {supportedFile} from '@/lib/extract-text';
import {knowledgeInstructions,knowledgeItemText,validKnowledgeFields} from '@/lib/model-knowledge';
const reply=(x:unknown,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
const MAX_BYTES=22*1024*1024;
// The destination and method are fixed here. This route cannot generate an
// annotation, submit a batch, run a search, or upload a provider-side file.
export async function POST(request:Request){try{
 if(!allowedOrigin(request))return reply({error:'Request origin not allowed.'},403);
 const auth=request.headers.get('authorization')||'',key=auth.startsWith('Bearer ')?auth.slice(7):'';
 if(!key||!/^[\x21-\x7e]+$/.test(key))return reply({error:'Enter your selected provider’s API key to count input tokens.'},401);
 if(Number(request.headers.get('content-length')||0)>MAX_BYTES)return reply({error:'The input is too large for token counting.'},413);
 let bytes=0;const limited=(await requestBody(request))?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX_BYTES)throw Error('Input is too large.');controller.enqueue(chunk);}}));
 const f=await new Response(limited,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();
 const provider=f.get('provider') as Provider,model=String(f.get('model')||''),effort=String(f.get('effort')||''),prompt=String(f.get('prompt')||'');
 if(provider==='openrouter')return reply({error:'This operation is not available through OpenRouter. Use Instant processing and the rough cost estimate.'},400);
 if(key.startsWith('sk-or-'))return reply({error:'This is an OpenRouter key. Select OpenRouter as the provider.'},401);
 if(!Object.hasOwn(PROVIDERS,provider)||provider==='gemini'&&!GEMINI_ENABLED)return reply({error:'Unsupported provider.'},400);
 if(!PROVIDERS[provider].models.includes(model)||!reasoningOptions(provider,model).includes(effort))return reply({error:'Unsupported model or reasoning setting.'},400);
 if(provider==='openai'&&(!/^sk-[\w-]+$/.test(key)||key.startsWith('sk-ant-')))return reply({error:'Use an OpenAI key for OpenAI input counting.'},401);
 if(!prompt.trim()||prompt.length>100000)return reply({error:'Provide your annotation prompt first.'},400);
 const mode=f.get('mode'),knowledge=mode==='model-knowledge',web=f.get('webSearch')==='true';
 if(mode!==null&&!knowledge||web&&!knowledge)return reply({error:'Unsupported annotation mode.'},400);
 let file=f.get('file');
 if(knowledge){const raw=f.get('fields');if(typeof raw!=='string'||raw.length>1000000)return reply({error:'Provide one subject’s labeled fields.'},400);const fields=JSON.parse(raw);if(!validKnowledgeFields(fields))return reply({error:'Invalid subject fields.'},400);file=new File([knowledgeItemText(fields)],'subject.txt',{type:'text/plain'});}
 if(!(file instanceof File)||!file.size||file.size>20*1024*1024||!supportedFile.test(file.name))return reply({error:'Choose a supported file up to 20 MB.'},400);
 const answerFields=readAnswerFields(f.get('answerFields'));
 const body:any=await buildBatchBody(provider,file,prompt+(knowledge?'\n\n'+knowledgeInstructions(web):''),model,effort,knowledge,web,answerFields);
 let url:string,payload:any,headers:Record<string,string>={'Content-Type':'application/json'};
 if(provider==='openai'){url='https://api.openai.com/v1/responses/input_tokens';headers.Authorization=auth;payload={model, input:body.input,instructions:body.instructions,text:body.text,reasoning:body.reasoning};}
 else if(provider==='anthropic'){url='https://api.anthropic.com/v1/messages/count_tokens';headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';headers['anthropic-dangerous-direct-browser-access']='true';payload={model,system:body.system,messages:body.messages,thinking:body.thinking,output_config:body.output_config};}
 else{url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens`;headers['x-goog-api-key']=key;payload={generateContentRequest:{...body,model:'models/'+model}};}
 const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.any([request.signal,AbortSignal.timeout(90000)])});
 const out:any=await providerJson(r);
 if(!r.ok)return reply({error:'Input counting failed. '+providerError(provider,r.status,out,r.headers)+' No annotation was run; the rough estimate is still available.'},r.status);
 const tokens=provider==='gemini'?out?.totalTokens:out?.input_tokens;
 if(!Number.isSafeInteger(tokens)||tokens<0)return reply({error:'The provider returned an unreadable token count. No annotation was run.'},502);
 return reply({inputTokens:tokens,provider,model});
 }catch{return reply({error:'Input counting was interrupted or the input could not be read. No annotation was run; the rough estimate is still available.'},400);}}
