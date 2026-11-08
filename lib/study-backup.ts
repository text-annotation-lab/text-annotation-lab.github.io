import {newId} from './identifier';
import {validAnswerFields} from './answer-fields';
import {z} from 'zod';
import {studyWorkspaceKey,WORKING_STUDY_ID,type Study} from './studies';
const FORMAT='text-annotation-lab-study',VERSION=1;
export const MAX_BACKUP_BYTES=250*1024*1024;
const secret=/^(?:api[-_]?key|key|authorization|credentials?|secret|access[-_]?token|refresh[-_]?token|password)$/i;
const unsafe=new Set(['__proto__','prototype','constructor']);
const text=z.string().max(1000000),short=z.string().max(1000),optionalText=text.optional();
const file=z.custom<File>(value=>value instanceof File&&value.size>0&&value.size<=20*1024*1024,'Missing or invalid retained file (limit 20 MB).');
const status=z.enum(['pending','running','queued','done','error']);
const fields=z.array(z.object({heading:z.string().min(1).max(100),value:z.string().max(30000)})).min(1).max(30);
const research=z.object({text, sources:z.array(z.object({url:text,title:text})).max(10000),queries:z.array(text).max(10000),searchedAt:short,instructions:text,model:short.optional(),effort:short.optional(),tokens:z.number().optional(),usage:z.unknown().optional(),responseId:optionalText,searchSuggestionsHtml:optionalText}).passthrough();
const answerNames=z.array(z.string().min(1).max(60)).max(10).refine(validAnswerFields).optional();
const attemptShape={inputMode:z.enum(['pdf-native','text']).optional(),runId:short.optional(),runStartedAt:short.optional(),runSize:z.number().int().positive().optional(),responseFormat:optionalText,rawResponse:optionalText,answerFields:answerNames,answers:z.record(z.string(),text).optional(),status,error:optionalText,provider:z.enum(['openai','gemini','anthropic','openrouter']).optional(),model:short.optional(),effort:short.optional(),prompt:z.string().max(100000).optional(),processing:z.enum(['instant','batch']).optional(),concurrency:z.number().int().min(1).max(100).optional(),batchId:optionalText,instructions:optionalText,webSearch:z.boolean().optional(),webUsed:z.boolean().optional(),research:research.optional(),score:optionalText,explanation:optionalText,tokens:z.number().optional(),usage:z.unknown().optional(),responseId:optionalText,time:short.optional(),startedAt:short.optional()};
const attempt=z.object(attemptShape).passthrough();
const row=z.object({...attemptShape,id:short.min(1),name:text,history:z.array(attempt).max(10000).optional(),subjectId:short.optional(),runNumber:z.number().int().positive().optional(),fields:fields.optional(),file:file.optional(),sourceFile:file.optional(),sourceId:short.optional(),sourceName:text.optional(),chunkIndex:z.number().int().positive().optional(),chunkCount:z.number().int().positive().optional(),wordsPerChunk:z.number().int().positive().max(1000000).optional(),wordStart:z.number().int().positive().optional(),wordEnd:z.number().int().positive().optional(),chunkMethod:z.enum(['sentences','exact-words']).optional(),segmenter:short.optional()}).passthrough();
const batch=z.object({responseFormat:optionalText,answerFields:answerNames,runId:short.min(1),id:short.optional(),provider:z.enum(['openai','gemini','anthropic']),model:short,prompt:z.string().max(100000),effort:short,docIds:z.array(short).max(10000),createdAt:short,state:z.enum(['submitting','unknown','processing','ready']),completed:z.number().optional(),total:z.number().optional(),providerState:short.optional()}).passthrough().nullable().optional();
const workspace=z.object({answerFields:answerNames,prompt:z.string().max(100000).optional(),model:short.optional(),effort:short.optional(),provider:z.enum(['openai','gemini','anthropic','openrouter']).optional(),processing:z.enum(['instant','batch']).optional(),concurrency:z.number().int().positive().max(100).optional(),batchJob:batch,chunkWords:z.union([z.string().max(20),z.number()]).optional(),chunkMethod:z.enum(['sentences','exact-words']).optional(),mode:z.enum(['list','structured']).optional(),headings:text.optional(),input:z.string().max(8000000).optional(),webSearch:z.boolean().optional(),docs:z.array(row).max(100000).optional(),items:z.array(row).max(100000).optional()}).passthrough();
export type StudyBackupData={name:string;texts:any;knowledge:any;createdAt:string;provenance?:any};
function cleanWorkspace(value:any){const {revision,snapshot,deleted,...data}=value||{};return data;}
export async function encodeStudyBackup(data:StudyBackupData){
 const assets:{id:string;name:string;type:string;lastModified:number;bytes:number;base64:string}[]=[],seen=new Map<Blob,string>();let total=0;
 async function encode(value:any,depth=0):Promise<any>{
  if(depth>30)throw Error('This study has data nested too deeply to export.');
  if(value instanceof Blob){
   if(seen.has(value))return {$file:seen.get(value)};
   total+=value.size;if(total>150*1024*1024)throw Error('This backup exceeds 150 MB of retained files. Export smaller studies separately.');
   const id=`file-${assets.length+1}`;seen.set(value,id);const bytes=new Uint8Array(await value.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   assets.push({id,name:value instanceof File?value.name:'retained-source',type:value.type,lastModified:value instanceof File?value.lastModified:0,bytes:value.size,base64:btoa(binary)});return {$file:id};
  }
  if(Array.isArray(value)){const result=[];for(const item of value)result.push(await encode(item,depth+1));return result;}
  if(value&&typeof value==='object'){const result:Record<string,any>={};for(const [key,item]of Object.entries(value)){if(secret.test(key)||unsafe.has(key)||item===undefined)continue;result[key]=await encode(item,depth+1);}return result;}
  return value;
 }
 const workspaces=await encode({texts:cleanWorkspace(data.texts),knowledge:cleanWorkspace(data.knowledge)});
 const result=JSON.stringify({format:FORMAT,version:VERSION,name:data.name,createdAt:data.createdAt,provenance:await encode(data.provenance),workspaces,assets});
 if(new Blob([result]).size>MAX_BACKUP_BYTES)throw Error('The study backup exceeds the 250 MB import limit.');return result;
}
export function decodeStudyBackup(json:string):StudyBackupData{
 if(new Blob([json]).size>MAX_BACKUP_BYTES)throw Error('Use a study backup smaller than 250 MB.');
 let data:any;try{data=JSON.parse(json);}catch{throw Error('This is not valid JSON. Choose a .tal-study.json backup, not an Excel or CSV export.');}
 if(data?.format!==FORMAT)throw Error('This file is not a Text Annotation Lab study backup.');
 if(data.version!==VERSION)throw Error(`Unsupported study backup version ${String(data.version)}. This site supports version ${VERSION}. No study was imported.`);
 if(typeof data.name!=='string'||!data.name.trim()||data.name.length>80||typeof data.createdAt!=='string'||!Number.isFinite(Date.parse(data.createdAt))||!data.workspaces||!Array.isArray(data.assets)||data.assets.length>100000)throw Error('The backup has invalid study metadata or missing workspaces.');
 const files=new Map<string,File>();let total=0;
 for(const asset of data.assets){
  if(!asset||typeof asset.id!=='string'||files.has(asset.id)||typeof asset.name!=='string'||asset.name.length>1000||typeof asset.type!=='string'||!Number.isSafeInteger(asset.lastModified)||typeof asset.base64!=='string'||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>20*1024*1024||asset.base64.length!==4*Math.ceil(asset.bytes/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64))throw Error('A retained file in this backup is missing, malformed, or too large.');
  total+=asset.bytes;if(total>150*1024*1024)throw Error('The backup exceeds 150 MB of retained files.');
  const binary=atob(asset.base64);if(binary.length!==asset.bytes||btoa(binary)!==asset.base64)throw Error('A retained file has an incorrect byte count.');
  files.set(asset.id,new File([Uint8Array.from(binary,c=>c.charCodeAt(0))],asset.name,{type:asset.type,lastModified:asset.lastModified}));
 }
 function decode(value:any,depth=0):any{
  if(depth>30)throw Error('The backup is nested too deeply.');
  if(Array.isArray(value))return value.map(item=>decode(item,depth+1));
  if(value&&typeof value==='object'){
   if('$file' in value){if(Object.keys(value).length!==1||!files.has(value.$file))throw Error('The backup refers to a missing retained file.');return files.get(value.$file);}
   const result:Record<string,any>={};for(const [key,item]of Object.entries(value)){if(unsafe.has(key)||secret.test(key))throw Error('The backup contains a forbidden property or credential. No data was imported.');result[key]=decode(item,depth+1);}return result;
  }return value;
 }
 const decoded=decode(data.workspaces);
 for(const [kind,value]of Object.entries(decoded)){
  if(!['texts','knowledge'].includes(kind))throw Error('The backup contains an unknown workspace.');
  const checked=workspace.safeParse(value);if(!checked.success){const issue=checked.error.issues[0];throw Error(`Invalid ${kind} workspace at ${issue.path.join('.')||'root'}: ${issue.message}`);}
  const rows=kind==='texts'?checked.data.docs||[]:checked.data.items||[];
  if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error(`Duplicate record IDs in the ${kind} workspace.`);
  for(const r of rows){if(r.status==='done'&&(typeof r.score!=='string'||typeof r.explanation!=='string'))throw Error('A completed result is missing its score or explanation.');if(kind==='texts'&&!(r.file instanceof File)||kind==='knowledge'&&(!r.fields||!r.fields.some(f=>f.value.trim())))throw Error(`Missing source data in the ${kind} workspace.`);if(r.sourceId&&(!(r.sourceFile instanceof File)||!r.sourceName||!r.chunkIndex||!r.chunkCount||!r.wordsPerChunk||!r.wordStart||!r.wordEnd))throw Error('Incomplete chunk provenance in the backup.');}
  if(checked.data.batchJob&&(new Set(checked.data.batchJob.docIds).size!==checked.data.batchJob.docIds.length||checked.data.batchJob.docIds.some(id=>!rows.some(r=>r.id===id))))throw Error('A batch refers to records missing from this backup.');
  if(rows.some(r=>r.status==='queued')&&!checked.data.batchJob)throw Error('Queued batch records have no recovery reference.');
 }
 if(!decoded.texts||!decoded.knowledge)throw Error('Both workspaces must be present in a complete study backup.');
 return {name:data.name,createdAt:data.createdAt,texts:cleanWorkspace(decoded.texts),knowledge:cleanWorkspace(decoded.knowledge),provenance:decode(data.provenance)};
}

function database():Promise<IDBDatabase>{return new Promise((yes,no)=>{const r=indexedDB.open('annotation-desk',1);r.onupgradeneeded=()=>r.result.createObjectStore('workspace');r.onsuccess=()=>yes(r.result);r.onerror=()=>no(Error('Could not open study storage.'));});}
export async function readWorkingBackup(name:string,revisions:(number|undefined)[]):Promise<StudyBackupData>{
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace','readonly'),store=tx.objectStore('workspace'),values:any[]=[];
  [false,true].forEach((knowledge,i)=>{const r=store.get(studyWorkspaceKey(WORKING_STUDY_ID,knowledge));r.onsuccess=()=>{values[i]=r.result;};});
  tx.oncomplete=()=>{db.close();if(values.some((v,i)=>(v?.revision??0)!==revisions[i]))reject(Error('The working copy changed. Wait for autosave or reload before exporting.'));else resolve({name,texts:values[0],knowledge:values[1],createdAt:new Date().toISOString()});};
  tx.onabort=tx.onerror=()=>{db.close();reject(Error('Could not read the complete study.'));};
 });
}
// Import never changes the working copy or any existing snapshot. Catalog and
// both new workspaces commit atomically. Batch references remain for recovery;
// restored running requests are handled by the existing interrupted-request UI.
export async function importStudyBackup(data:StudyBackupData):Promise<{study:Study;studies:Study[]}>{
 const db=await database();return new Promise((resolve,reject)=>{
  const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace');let result:{study:Study;studies:Study[]};
  const r=store.get('named-studies-v1');r.onsuccess=()=>{
   const existing:Study[]=r.result||[];let suffix=1,name=data.name.slice(0,60)+' (imported)';while(existing.some(s=>s.name.toLowerCase()===name.toLowerCase()))name=data.name.slice(0,60)+` (imported ${++suffix})`;
   const study={id:newId(),name,savedAt:new Date().toISOString()},provenance={importedAt:study.savedAt,backupCreatedAt:data.createdAt,originalName:data.name,previous:data.provenance||data.texts?.provenance};
   store.put({...data.texts,provenance,revision:1,snapshot:true},studyWorkspaceKey(study.id));store.put({...data.knowledge,provenance,revision:1,snapshot:true},studyWorkspaceKey(study.id,true));
   result={study,studies:[...existing,study]};store.put(result.studies,'named-studies-v1');
  };
  tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=tx.onerror=()=>{db.close();reject(Error('Could not import the study; browser storage may be full. Existing work is unchanged.'));};
 });
}
