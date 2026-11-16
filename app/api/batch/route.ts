import {allowedOrigin,requestBody} from '@/lib/request-guards';
import {readAnswerFields,readAnswerSettings,type AnswerSettings} from '@/lib/answer-fields';
import {PROVIDERS,validModelId,reasoningOptions,GEMINI_ENABLED,type Provider} from '@/lib/providers';
import {supportedFile} from '@/lib/extract-text';
import {BatchError,buildBatchBody,createBatchPayload,createSplitPayload,createBatch,checkBatch,cancelBatch,validBatchId,type ReplyFormat} from '@/lib/batch-provider';
import {knowledgeAddition,knowledgeItemText,validKnowledgeFields} from '@/lib/model-knowledge';
import {MAX_BATCH_ITEMS,MAX_BATCH_SOURCE_BYTES,MAX_BATCH_REQUEST_BYTES,MAX_SPLIT_REQUESTS,MAX_SPLIT_SOURCE_BYTES,MAX_SPLIT_UPLOAD_BYTES} from '@/lib/batch-limits';
import {readRequestSettings} from '@/lib/request-settings';
import {formText} from '@/lib/request-frame';
import {readInserts,fillInserts,placesText,fillPlaces,insertMap} from '@/lib/prompt-inserts';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
// Research mode: the requests of a run, prepared ("prepare") and then sent batch by batch ("send"), so the page can
// record each batch as it goes up. They are kept in this page only, until sent or discarded.
let prepared:{runId:string;provider:Provider;model:string;payload:ReturnType<typeof createSplitPayload>;parts:({requests:[number,number]}|null)[]}|null=null;
export async function POST(request:Request){
 try{
  if(!allowedOrigin(request))return reply({error:'Request origin not allowed.'},403);
  const auth=request.headers.get('authorization')||'',key=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!key||!/^[\x21-\x7e]+$/.test(key))return reply({error:'Enter your provider’s API key.'},401);
  // Research mode uploads a whole run to be prepared, which may be larger than one batch.
  const split=new URL(request.url).searchParams.get('split')==='1',maxUpload=split?MAX_SPLIT_UPLOAD_BYTES:MAX_BATCH_REQUEST_BYTES,tooLarge=split?'This run’s upload exceeds 1 GB. Send it in several runs.':'This batch upload exceeds 54 MB. Submit fewer or smaller items together.';
  if(Number(request.headers.get('content-length')||0)>maxUpload)return reply({error:tooLarge},413);
  let bytes=0;
  const limited=(await requestBody(request))?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>maxUpload)throw new BatchError(tooLarge,413);controller.enqueue(chunk);}}));
  let f:FormData;try{f=await new Response(limited,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();}catch(error){if(bytes>maxUpload)throw new BatchError(tooLarge,413);throw error;}
  const provider=f.get('provider') as Provider,action=f.get('action');
  if(provider==='openrouter')return reply({error:'This operation is not available through OpenRouter. Use Instant processing and the rough cost estimate.'},400);
 if(key.startsWith('sk-or-'))return reply({error:'This is an OpenRouter key. Select OpenRouter as the provider.'},401);
 if(!Object.hasOwn(PROVIDERS,provider)||provider==='gemini'&&!GEMINI_ENABLED)return reply({error:'Unsupported provider.'},400);
  if(provider==='openai'&&(!/^sk-[\w-]+$/.test(key)||key.startsWith('sk-ant-')))return reply({error:'Use an OpenAI key for OpenAI batches.'},401);
  if(action==='submit'||action==='prepare'){
   // prepare (research mode): the requests are prepared and grouped into batches, and nothing is sent yet.
   const research=action==='prepare',maxItems=research?MAX_SPLIT_REQUESTS:MAX_BATCH_ITEMS,maxSource=research?MAX_SPLIT_SOURCE_BYTES:MAX_BATCH_SOURCE_BYTES,most=maxItems.toLocaleString('en-US');
   let answerFields:string[],answerSettings,requestSettings;try{answerFields=readAnswerFields(f.get('answerFields'));answerSettings=readAnswerSettings(f.get('answerSettings'),answerFields);requestSettings=readRequestSettings(f.get('requestSettings'));}catch(error){throw new BatchError((error as Error).message);}
   const model=String(f.get('model')||''),effort=String(f.get('effort')||''),prompt=formText(String(f.get('prompt')||'')),runId=String(f.get('runId')||'');
   if(!validModelId(provider,model)||!reasoningOptions(provider,model).includes(effort))throw new BatchError('Unsupported model or reasoning setting.');
   if(!prompt.trim()||prompt.length>100000||!/^lab_[a-zA-Z0-9_-]{1,60}$/.test(runId))throw new BatchError('Provide an annotation prompt and a valid batch reference.');
   const mode=f.get('mode'),knowledge=mode==='model-knowledge';
   if(mode!==null&&!knowledge)throw new BatchError('Unsupported annotation mode.');
   if(f.get('webSearch')!==null&&f.get('webSearch')!=='false')throw new BatchError('Web search is available with Instant processing only. No batch was submitted.');
   let files=f.getAll('files');
   const ids=JSON.parse(String(f.get('ids')||'[]'));
   if(knowledge){
    const raw=f.get('subjects');
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_BATCH_SOURCE_BYTES)throw new BatchError(`Provide up to ${most} subjects and 50 MB of subject fields.`);
    let subjects:unknown;try{subjects=JSON.parse(raw);}catch{throw new BatchError('Could not read subject fields.');}
    if(!Array.isArray(subjects)||!subjects.length||subjects.length>maxItems||!subjects.every(validKnowledgeFields))throw new BatchError(`Provide 1 to ${most} subjects with unique field headings and at least one value per subject.`);
    if(files.length)throw new BatchError('Submit subject fields without document uploads.');
    files=subjects.map(fields=>new File([knowledgeItemText(fields)],'subject.txt',{type:'text/plain'}));
   }
   // Research mode, several annotations per text: how many requests each item gets (absent: one). An item is
   // prepared once and its request is repeated under consecutive references.
   let copies:number[]|undefined;
   if(f.get('copies')!==null){
    try{copies=JSON.parse(String(f.get('copies')));}catch{throw new BatchError('Could not read the number of annotations per item.');}
    if(!Array.isArray(copies)||copies.length!==files.length||copies.some(n=>!Number.isInteger(n)||n<1||n>10))throw new BatchError('Provide 1 to 10 annotations for each item.');
   }
   // Research mode: each item's values for the placeholders of the prompt ({{id}}, {{meta.<column>}}).
   let inserts:string[][]|undefined;
   if(f.get('inserts')!==null){
    try{const raw:unknown=JSON.parse(String(f.get('inserts')));if(!Array.isArray(raw)||raw.length!==files.length)throw Error();inserts=raw.map(values=>{const read=readInserts(values,prompt);if(!read)throw Error();return read;});}catch{throw new BatchError('Could not read the values for the placeholders of the prompt.');}
   }
   // Research mode: the text goes where the prompt has {{text}}, instead of after it (lib/request-frame.ts).
   const placeFlag=f.get('placeText');if(placeFlag!==null&&(placeFlag!=='true'||!placesText(prompt)))throw new BatchError('Invalid setting for the place of the text.');
   const placed=placeFlag==='true';
   const total=copies?copies.reduce((sum,n)=>sum+n,0):files.length;
   if(!files.length||total>maxItems||!Array.isArray(ids)||ids.length!==total||new Set(ids).size!==ids.length||ids.some((id,i)=>typeof id!=='string'||id!==runId+'_'+i))throw new BatchError(copies?`Submit between 1 and ${most} requests (items × annotations per item) with unique references.`:`Submit between 1 and ${most} items with unique references.`);
   if(files.some(file=>!(file instanceof File)||!file.size||file.size>20*1024*1024||!supportedFile.test(file.name)))throw new BatchError('Use nonempty PDF, DOCX, TXT, MD, HTML, or RTF documents.');
   if(files.reduce((n,file)=>n+(file as File).size,0)>maxSource)throw new BatchError(research?'These items come to more than 1 GB, more than the Lab prepares at once. Send them in several runs.':'These items exceed the 50 MB combined source limit. Submit fewer or smaller items together.',413);
   // Validate and prepare everything before submitting any paid provider job.
   if(research)prepared=null;
   const payload=research?createSplitPayload(provider,runId):createBatchPayload(provider,runId);
   f.delete('files');f.delete('subjects');
   const added=knowledge?knowledgeAddition(false,answerSettings):'';
   for(let i=0,at=0;i<files.length;i++){
    const values=inserts?insertMap(prompt,inserts[i]):undefined,filled=placed?fillPlaces(prompt,(name,whole)=>values?values.get(name)??'':whole):undefined,written=filled?filled.prompt:inserts?fillInserts(prompt,inserts[i]):prompt;
    if(written.length>100000)throw new BatchError(`${(files[i] as File).name}: with the values of its placeholders filled in, the prompt is longer than 100,000 characters.`);
    const body=await buildBatchBody(provider,files[i] as File,written+added,model,effort,knowledge,false,answerFields,answerSettings,requestSettings,inserts||placed?prompt+added:undefined,filled?.spots);for(let copy=0;copy<(copies?copies[i]:1);copy++){if('plan' in payload)payload.append(i,ids[at++],body);else payload.append(ids[at++],body);}files[i]='';}
   if('plan' in payload){const plan=payload.plan();prepared={runId,provider,model,payload,parts:plan.parts.map(part=>({requests:part.requests}))};return reply(plan);}
   return reply({id:await createBatch(provider,key,model,runId,payload.finish())});
  }
  // Research mode: one batch of the prepared run goes up. A batch is never sent twice from here.
  if(action==='send'){
   const runId=String(f.get('runId')||''),model=String(f.get('model')||''),k=Number(f.get('part'));
   const kept=prepared&&prepared.runId===runId&&prepared.provider===provider&&prepared.model===model&&Number.isInteger(k)?prepared:null,part=kept?.parts[k];
   if(!kept||!part)throw new BatchError('The prepared requests of this batch are no longer in this page. No batch was submitted.',409);
   const n=kept.parts.length,payload=kept.payload.assemble(part,k,n);kept.parts[k]=null;if(kept.parts.every(left=>!left))prepared=null;
   return reply({id:await createBatch(provider,key,model,runId,payload,n>1?{index:k,of:n}:undefined)});
  }
  if(action==='discard'){prepared=null;return reply({discarded:true});}
  const id=f.get('id');if(!validBatchId(provider,id))throw new BatchError('Enter a valid batch ID for the selected provider.');
  if(action==='cancel'){await cancelBatch(provider,key,id);return reply({cancelRequested:true});}
  if(action!=='check'&&action!=='collect')throw new BatchError('Unsupported batch action.');
  // Research mode: collected results also carry the model the provider names, its stop reason, the text it
  // returned, and (summary) the summary of the model's reasoning that the requests asked for.
  const record=f.get('record');if(record!==null&&record!=='true')throw new BatchError('Invalid record setting.');
  const summary=f.get('summary');if(summary!==null&&(summary!=='true'||record!=='true'))throw new BatchError('Invalid summary setting.');
  // A run in the named format (research mode) sends its answer fields and settings, by which its replies are read.
  let format:ReplyFormat|undefined;
  if(f.get('answerSettings')!==null){let names:string[],settings:AnswerSettings|undefined;try{names=readAnswerFields(f.get('answerFields'));settings=readAnswerSettings(f.get('answerSettings'),names);}catch(error){throw new BatchError((error as Error).message);}if(settings?.named)format={names,settings};}
  return reply(await checkBatch(provider,key,id,action==='collect',f.get('plain')==='true',record==='true',summary==='true',format));
 }catch(error){return reply({error:error instanceof BatchError?error.message:'Could not process this batch request. Check your provider’s console before retrying.',uncertain:error instanceof BatchError?error.uncertain:false},error instanceof BatchError?error.status:400);}
}
