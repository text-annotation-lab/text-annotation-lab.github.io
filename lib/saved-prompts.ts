import {newId} from './identifier';
import {ORIGINAL_STUDY, studyWorkspaceKey, type Study} from './studies';
import {validAnswerFields} from './answer-fields';

export type SavedPrompt = {id:string; studyName:string; workspace:'Texts'|'Model knowledge'; prompt:string; answerFields:string[]};

function withPromptStore<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>Promise<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('annotation-desk',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
  request.onerror=()=>reject(new Error('Could not open saved prompts.'));
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('workspace',mode);
   let result:T,failure:unknown;
   tx.oncomplete=()=>{db.close();resolve(result);};
   tx.onabort=tx.onerror=()=>{db.close();reject(failure||new Error('Could not access saved prompts.'));};
   work(tx.objectStore('workspace')).then(value=>{result=value;}).catch(error=>{failure=error;tx.abort();});
  };
 });
}
function getRecord(store:IDBObjectStore,key:string):Promise<any>{
 return new Promise((resolve,reject)=>{const request=store.get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
async function studyPrompts(store:IDBObjectStore):Promise<SavedPrompt[]>{
 const studies:Study[]=await getRecord(store,'named-studies-v1')??[ORIGINAL_STUDY];
 if(!Array.isArray(studies)||studies.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'))throw new Error('The saved study list could not be read.');
 const groups=await Promise.all(studies.flatMap(study=>[false,true].map(async knowledge=>{
  const id=studyWorkspaceKey(study.id,knowledge),value=await getRecord(store,id);
  if(value?.deleted||typeof value?.prompt!=='string'||!value.prompt.trim())return [];
  const entry:SavedPrompt={id,studyName:study.name,workspace:knowledge?'Model knowledge':'Texts',prompt:value.prompt,answerFields:validAnswerFields(value.answerFields)?value.answerFields:[]};
  return [entry];
 })));
 return groups.flat();
}
export function readStudyPrompts(){return withPromptStore('readonly',studyPrompts);}

export type LibraryPrompt = {id:string; name:string; prompt:string; answerFields:string[]};
const LIBRARY_KEY='saved-prompt-library-v1';
function library(change?:(entries:LibraryPrompt[])=>LibraryPrompt[]):Promise<LibraryPrompt[]>{
 // A single transaction prevents competing pickers from migrating or updating twice.
 return withPromptStore('readwrite',async store=>{
  const stored=await getRecord(store,LIBRARY_KEY);
  const entries=stored===undefined?(await studyPrompts(store)).map(p=>({id:p.id,name:p.studyName+' · '+p.workspace,prompt:p.prompt,answerFields:p.answerFields})):stored;
  if(!Array.isArray(entries)||entries.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'||typeof p.prompt!=='string'||!validAnswerFields(p.answerFields)))throw new Error('Saved prompts could not be read. Existing data is unchanged.');
  const result=change?change(entries):entries;
  if(change||stored===undefined)store.put(result,LIBRARY_KEY);
  return result;
 });
}
export const listSavedPrompts=()=>library();
export function savePrompt(name:string,prompt:string,answerFields:string[]){
 name=name.trim();
 if(!name||name.length>80)return Promise.reject(new Error('Enter a prompt name of 1–80 characters.'));
 if(!prompt.trim()||prompt.length>100000||!validAnswerFields(answerFields))return Promise.reject(new Error('Enter a valid prompt and answer fields first.'));
 return library(entries=>{
  if(entries.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('That name is already in use. Choose another name.');
  return [...entries,{id:newId(),name,prompt,answerFields:[...answerFields]}];
 });
}
export const deletePrompt=(id:string)=>library(entries=>entries.filter(p=>p.id!==id));
