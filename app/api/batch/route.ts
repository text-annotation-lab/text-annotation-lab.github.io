import {allowedOrigin,requestBody} from '@/lib/request-guards';
import {readAnswerFields} from '@/lib/answer-fields';
import {PROVIDERS,reasoningOptions,GEMINI_ENABLED,type Provider} from '@/lib/providers';
import {supportedFile} from '@/lib/extract-text';
import {BatchError,buildBatchBody,createBatchPayload,createBatch,checkBatch,cancelBatch,validBatchId} from '@/lib/batch-provider';
import {knowledgeInstructions,knowledgeItemText,validKnowledgeFields} from '@/lib/model-knowledge';
import {MAX_BATCH_ITEMS,MAX_BATCH_SOURCE_BYTES,MAX_BATCH_REQUEST_BYTES} from '@/lib/batch-limits';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 try{
  if(!allowedOrigin(request))return reply({error:'Request origin not allowed.'},403);
  const auth=request.headers.get('authorization')||'',key=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(!key||!/^[\x21-\x7e]+$/.test(key))return reply({error:'Enter your provider’s API key.'},401);
  if(Number(request.headers.get('content-length')||0)>MAX_BATCH_REQUEST_BYTES)return reply({error:'This batch upload exceeds 54 MB. Submit fewer or smaller items together.'},413);
  let bytes=0;
  const limited=(await requestBody(request))?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>MAX_BATCH_REQUEST_BYTES)throw new BatchError('This batch upload exceeds 54 MB. Submit fewer or smaller items together.',413);controller.enqueue(chunk);}}));
  let f:FormData;try{f=await new Response(limited,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();}catch(error){if(bytes>MAX_BATCH_REQUEST_BYTES)throw new BatchError('This batch upload exceeds 54 MB. Submit fewer or smaller items together.',413);throw error;}
  const provider=f.get('provider') as Provider,action=f.get('action');
  if(provider==='openrouter')return reply({error:'This operation is not available through OpenRouter. Use Instant processing and the rough cost estimate.'},400);
 if(key.startsWith('sk-or-'))return reply({error:'This is an OpenRouter key. Select OpenRouter as the provider.'},401);
 if(!Object.hasOwn(PROVIDERS,provider)||provider==='gemini'&&!GEMINI_ENABLED)return reply({error:'Unsupported provider.'},400);
  if(provider==='openai'&&(!/^sk-[\w-]+$/.test(key)||key.startsWith('sk-ant-')))return reply({error:'Use an OpenAI key for OpenAI batches.'},401);
  if(action==='submit'){
   const answerFields=readAnswerFields(f.get('answerFields'));
   const model=String(f.get('model')||''),effort=String(f.get('effort')||''),prompt=String(f.get('prompt')||''),runId=String(f.get('runId')||'');
   if(!PROVIDERS[provider].models.includes(model)||!reasoningOptions(provider,model).includes(effort))throw new BatchError('Unsupported model or reasoning setting.');
   if(!prompt.trim()||prompt.length>100000||!/^lab_[a-zA-Z0-9_-]{1,60}$/.test(runId))throw new BatchError('Provide an annotation prompt and a valid batch reference.');
   const mode=f.get('mode'),knowledge=mode==='model-knowledge';
   if(mode!==null&&!knowledge)throw new BatchError('Unsupported annotation mode.');
   if(f.get('webSearch')!==null&&f.get('webSearch')!=='false')throw new BatchError('Web search is available with Instant processing only. No batch was submitted.');
   let files=f.getAll('files');
   const ids=JSON.parse(String(f.get('ids')||'[]'));
   if(knowledge){
    const raw=f.get('subjects');
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_BATCH_SOURCE_BYTES)throw new BatchError('Provide up to 10,000 subjects and 50 MB of subject fields.');
    let subjects:unknown;try{subjects=JSON.parse(raw);}catch{throw new BatchError('Could not read subject fields.');}
    if(!Array.isArray(subjects)||!subjects.length||subjects.length>MAX_BATCH_ITEMS||!subjects.every(validKnowledgeFields))throw new BatchError('Provide 1 to 10,000 subjects with unique field headings and at least one value per subject.');
    if(files.length)throw new BatchError('Submit subject fields without document uploads.');
    files=subjects.map(fields=>new File([knowledgeItemText(fields)],'subject.txt',{type:'text/plain'}));
   }
   if(!files.length||files.length>MAX_BATCH_ITEMS||!Array.isArray(ids)||ids.length!==files.length||new Set(ids).size!==ids.length||ids.some((id,i)=>typeof id!=='string'||id!==runId+'_'+i))throw new BatchError('Submit between 1 and 10,000 items with unique references.');
   if(files.some(file=>!(file instanceof File)||!file.size||file.size>20*1024*1024||!supportedFile.test(file.name)))throw new BatchError('Use nonempty PDF, DOCX, TXT, MD, HTML, or RTF documents.');
   if(files.reduce((n,file)=>n+(file as File).size,0)>MAX_BATCH_SOURCE_BYTES)throw new BatchError('These items exceed the 50 MB combined source limit. Submit fewer or smaller items together.',413);
   // Validate and prepare everything before submitting any paid provider job.
   const payload=createBatchPayload(provider,runId);
   f.delete('files');f.delete('subjects');
   for(let i=0;i<files.length;i++){const body=await buildBatchBody(provider,files[i] as File,knowledge?prompt+'\n\n'+knowledgeInstructions(false):prompt,model,effort,knowledge,false,answerFields);payload.append(ids[i],body);files[i]='';}
   return reply({id:await createBatch(provider,key,model,runId,payload.finish())});
  }
  const id=f.get('id');if(!validBatchId(provider,id))throw new BatchError('Enter a valid batch ID for the selected provider.');
  if(action==='cancel'){await cancelBatch(provider,key,id);return reply({cancelRequested:true});}
  if(action!=='check'&&action!=='collect')throw new BatchError('Unsupported batch action.');
  return reply(await checkBatch(provider,key,id,action==='collect'));
 }catch(error){return reply({error:error instanceof BatchError?error.message:'Could not process this batch request. Check your provider’s console before retrying.',uncertain:error instanceof BatchError?error.uncertain:false},error instanceof BatchError?error.status:400);}
}
