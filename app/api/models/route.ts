// Research mode: the models on the account behind a key, as the provider lists them. The key goes to the
// selected provider only. From each entry the Lab keeps the model's ID, its name, and the reasoning levels the
// provider says it takes; nothing else of the provider's reply is returned.
import {allowedOrigin} from '@/lib/request-guards';
import {GEMINI_ENABLED,validModelId,type AccountModel,type Provider} from '@/lib/providers';
import {providerError,providerJson} from '@/lib/provider-errors';
import {canCheckKey} from '@/lib/workflow-safety';

const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const MAX_MODELS=1000,MAX_PAGES=5,LEVELS=['none','minimal','low','medium','high','xhigh','max'];
const list=(value:unknown):any[]=>Array.isArray(value)?value:[];
const name=(value:unknown)=>typeof value==='string'&&/^[\p{L}\p{N} .:()+,'’/&_-]{1,80}$/u.test(value)?value:undefined;
// Models that answer in text; the rest (speech, images, embeddings, and so on) are left out of the list.
const OPENAI_TEXT=/^(gpt|o\d|chatgpt)/i,OPENAI_OTHER=/(audio|realtime|transcribe|tts|image|embedding|search|moderation|dall-e|whisper|davinci|babbage|instruct|computer|sora)/i;
const GEMINI_OTHER=/(embedding|image|tts|audio|live|aqa|veo|imagen|robotics|computer-use|lyria)/i;

async function page(url:string,headers:Record<string,string>,signal:AbortSignal){
 const response=await fetch(url,{headers,cache:'no-store',redirect:'manual',signal}),out:any=await providerJson(response);
 return {response,out};
}
export async function POST(request:Request){
 if(!allowedOrigin(request))return reply({error:'Request origin not allowed.'},403);
 const provider=request.headers.get('X-Lab-Provider') as Provider;
 if(provider!=='openai'&&provider!=='anthropic'&&provider!=='gemini'&&provider!=='openrouter'||provider==='gemini'&&!GEMINI_ENABLED)return reply({error:'Unsupported provider.'},400);
 const key=/^Bearer ([\x21-\x7e]+)$/.exec(request.headers.get('authorization')||'')?.[1];
 if(!key||!canCheckKey(provider,key))return reply({error:'Add the API key of the selected provider first.'},401);
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),models:AccountModel[]=[];
 const add=(id:unknown,label?:unknown,efforts?:string[])=>{if(validModelId(provider,id)&&models.length<MAX_MODELS&&!models.some(model=>model.id===id))models.push({id,...(name(label)&&name(label)!==id?{name:name(label)}:{}),...(efforts?{efforts}:{})});};
 const failed=(response:Response,out:unknown)=>reply({error:'The list of models could not be read. '+providerError(provider,response.status,out,response.headers)},response.status);
 try{
  if(provider==='openai'){
   const {response,out}=await page('https://api.openai.com/v1/models',{Authorization:'Bearer '+key},signal);
   if(!response.ok||!Array.isArray(out?.data))return failed(response,out);
   // Newest first.
   for(const model of list(out.data).filter(model=>typeof model?.id==='string'&&OPENAI_TEXT.test(model.id)&&!OPENAI_OTHER.test(model.id)).sort((a,b)=>(Number(b.created)||0)-(Number(a.created)||0)))add(model.id);
  }else if(provider==='anthropic'){
   let after='';
   for(let n=0;n<MAX_PAGES;n++){
    const {response,out}=await page('https://api.anthropic.com/v1/models?limit=1000'+(after?'&after_id='+encodeURIComponent(after):''),{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},signal);
    if(!response.ok||!Array.isArray(out?.data))return failed(response,out);
    // The levels of effort the provider says the model takes, where it says so.
    for(const model of out.data){const effort=model?.capabilities?.effort;add(model?.id,model?.display_name,effort&&typeof effort==='object'?(effort.supported===true?LEVELS.filter(level=>effort[level]?.supported===true):[]):undefined);}
    if(out.has_more!==true||typeof out.last_id!=='string'||!out.last_id)break;after=out.last_id;
   }
  }else if(provider==='gemini'){
   let token='';
   for(let n=0;n<MAX_PAGES;n++){
    const {response,out}=await page('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'+(token?'&pageToken='+encodeURIComponent(token):''),{'x-goog-api-key':key},signal);
    if(!response.ok||!Array.isArray(out?.models))return failed(response,out);
    for(const model of out.models){const id=typeof model?.name==='string'?model.name.replace(/^models\//,''):'';if(id.startsWith('gemini-')&&!GEMINI_OTHER.test(id)&&list(model.supportedGenerationMethods).includes('generateContent'))add(id,model.displayName);}
    if(typeof out.nextPageToken!=='string'||!out.nextPageToken)break;token=out.nextPageToken;
   }
  }else{
   // The models this account may use, after its own provider and privacy settings.
   const {response,out}=await page('https://openrouter.ai/api/v1/models/user',{Authorization:'Bearer '+key},signal);
   if(!response.ok||!Array.isArray(out?.data))return failed(response,out);
   for(const model of out.data){
    const outputs=list(model?.architecture?.output_modalities);if(outputs.length!==1||outputs[0]!=='text')continue;
    const reasons=list(model?.supported_parameters).includes('reasoning'),levels=model?.reasoning?.supported_efforts;
    add(model?.id,model?.name,!reasons?[]:Array.isArray(levels)?LEVELS.filter(level=>levels.includes(level)):undefined);
   }
  }
  return reply({models});
 }catch{return reply({error:'The list of models could not be read. Check your connection and try again; no annotation was run.'},502);}
}
