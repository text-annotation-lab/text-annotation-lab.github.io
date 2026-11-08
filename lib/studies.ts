import {newId} from './identifier';
// Feature entry point. For rollback, redeploy version 104 as documented in
// STUDIES-ROLLBACK.md; saved snapshots are protected against autosave.
export const NAMED_STUDIES_ENABLED = true;
export const ORIGINAL_STUDY = {id: 'current', name: 'Original study'};
export type Study = {id: string; name: string; savedAt?: string};
const CATALOG = 'named-studies-v1';

export function studyWorkspaceKey(id: string, knowledge = false) {
  if (id === ORIGINAL_STUDY.id) return knowledge ? 'model-knowledge-v1' : 'current';
  return `study:${id}:${knowledge ? 'knowledge' : 'texts'}`;
}

export function studyName(value: string) {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error('Enter a study name of 1–80 characters.');
  return name;
}

// Catalog edits are read-modify-write transactions, so simultaneous tabs cannot
// replace one another's newly created studies. Existing workspace keys never move.
function catalog(change?: (studies: Study[]) => Study[]): Promise<Study[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('annotation-desk', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onerror = () => reject(new Error('Could not open saved studies. Your existing work is unchanged.'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('workspace', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('workspace');
      const read = store.get(CATALOG);
      let result: Study[] = [], failure: unknown;
      read.onsuccess = () => {
        try {
          const existing = read.result ?? [ORIGINAL_STUDY];
          if (!Array.isArray(existing) || existing.some(s => !s || typeof s.id !== 'string' || typeof s.name !== 'string')) throw new Error('The study list could not be read. Your saved work is unchanged.');
          result = change ? change(existing) : existing;
          if (change) store.put(result, CATALOG);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = tx.onerror = () => { db.close(); reject(failure || new Error('Could not save the study list. Your existing work is unchanged.')); };
    };
  });
}
export const listStudies = () => catalog();
export async function createStudy(value: string) {
  const name = studyName(value), study = {id: newId(), name};
  const studies = await catalog(existing => {
    if (existing.some(s => s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A study already has that name. Choose another name or open it from the list.');
    return [...existing, study];
  });
  return {studies, study};
}
export async function renameStudy(id: string, value: string) {
  const name = studyName(value);
  return catalog(existing => {
    if (!existing.some(s => s.id === id)) throw new Error('This study is no longer in the list. Reload the page.');
    if (existing.some(s => s.id !== id && s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A study already has that name. Choose another name.');
    return existing.map(s => s.id === id ? {...s, name} : s);
  });
}

// Delete both workspaces and update the list in one transaction. Tombstones stop
// another open tab from recreating deleted work with a late autosave.
export function deleteStudy(id: string): Promise<Study[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('annotation-desk', 1);
    request.onerror = () => reject(new Error('Could not open saved studies.'));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('workspace', 'readwrite'), store = tx.objectStore('workspace');
      let result: Study[] = [], failure: unknown;
      const read = store.get(CATALOG);
      read.onsuccess = () => {
        const existing: Study[] = read.result ?? [ORIGINAL_STUDY];
        if (!existing.some(s => s.id === id)) { failure = new Error('This study was already deleted. Reload the page.'); tx.abort(); return; }
        result = existing.filter(s => s.id !== id);
        for (const key of [studyWorkspaceKey(id), studyWorkspaceKey(id, true)]) {
          const workspace = store.get(key);
          workspace.onsuccess = () => {
            if (workspace.result?.batchJob) { failure = new Error('This study has a saved batch. Collect or resolve it before deleting the study.'); tx.abort(); return; }
            store.put({deleted: true, revision: (workspace.result?.revision ?? 0) + 1}, key);
          };
        }
        store.put(result, CATALOG);
      };
      tx.oncomplete = () => {db.close(); resolve(result);};
      tx.onabort = tx.onerror = () => {db.close(); reject(failure || new Error('Could not delete the study. Your saved work is unchanged.'));};
    };
  });
}

export const WORKING_STUDY_ID = 'working-copy-v2';
const WORKING_META = 'working-copy-meta-v2';
export type WorkingStudy = {sourceId?: string; name: string};
type SnapshotResult = {studies: Study[]; working: WorkingStudy};
type SnapshotOptions = {id?: string; name?: string; preferredId?: string; revisions?: (number | undefined)[]};

// Both workspaces and their metadata change together, or nothing changes.
// File/Blob values remain structured-clone data; API keys never enter storage.
export function studySnapshot(action: 'initialize'|'save-new'|'save-and-blank'|'update'|'load'|'blank', options: SnapshotOptions = {}): Promise<SnapshotResult> {
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('annotation-desk',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
  request.onerror=()=>reject(new Error('Could not open browser storage. Your saved studies are unchanged.'));
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace');
   let result:SnapshotResult, failure:unknown;
   const get=(key:string)=>new Promise<any>((yes,no)=>{const q=store.get(key);q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error);});
   const keys=(id:string)=>[studyWorkspaceKey(id),studyWorkspaceKey(id,true)];
   const readPair=(id:string)=>Promise.all(keys(id).map(get));
   const copy=(value:any,revision:number,snapshot=false)=>{const {revision:old,deleted,snapshot:wasSnapshot,...data}=value||{};return {...data,revision,snapshot};};
   const writePair=(id:string,values:any[],previous:any[],snapshot=false)=>keys(id).forEach((key,i)=>store.put(copy(values[i],(previous[i]?.revision??0)+1,snapshot),key));
   const hasBatch=(values:any[])=>values.some(v=>v?.batchJob);
   void (async()=>{
    try {
     const storedCatalog=await get(CATALOG);
     let studies:Study[]=storedCatalog??[ORIGINAL_STUDY];
     if(!Array.isArray(studies)||studies.some(s=>!s||typeof s.id!=='string'||typeof s.name!=='string'))throw Error('The study list could not be read. Saved work is unchanged.');
     let working:WorkingStudy|undefined=await get(WORKING_META);

     if(action==='initialize'){
      // Workspace components restore large documents/results; do not read them twice.
      if(!working){
       const draft=await readPair(WORKING_STUDY_ID);
       let source:Study|undefined=studies.find(s=>s.id===options.preferredId)||studies[0];
       const values=source?await readPair(source.id):[undefined,undefined];
       if(storedCatalog===undefined&&values.every(v=>!v)){studies=[];source=undefined;}
       if(values.some(v=>v?.deleted))throw Error('This saved study was deleted. Reload and choose another study.');
       writePair(WORKING_STUDY_ID,values,draft);
       if(source)writePair(source.id,values,values,true);
       working={sourceId:source?.id,name:source?.name||'Untitled working copy'};
       store.put(working,WORKING_META);store.put(studies,CATALOG);
      }
     }else{
      const draft=await readPair(WORKING_STUDY_ID);
      if(!working)throw Error('Open the working copy before saving or loading studies.');
      if(!options.revisions||draft.some((v,i)=>(v?.revision??0)!==options.revisions![i]))throw Error('Another tab changed the working copy. Reload before saving or loading a study.');
      if(hasBatch(draft))throw Error('The working copy has a saved batch. Collect or resolve it before saving, loading, or starting a study.');
      if(action==='save-new'||action==='save-and-blank'||action==='update'){
       const target=action==='update'?studies.find(s=>s.id===options.id):{id:newId(),name:studyName(options.name||'')};
       if(!target)throw Error('This saved study no longer exists. Save as a new study instead.');
       if(action!=='update'&&studies.some(s=>s.name.toLocaleLowerCase()===target.name.toLocaleLowerCase()))throw Error('A study already has that name. Choose another name or use Update saved study.');
       const previous=await readPair(target.id);
       // Do not overwrite another study's outstanding provider job.
       if(hasBatch(previous)&&working.sourceId!==target.id)throw Error('That saved study has an unresolved batch. Load and resolve it before updating it.');
       const saved={...target,savedAt:new Date().toISOString()};
       writePair(target.id,draft,previous,true);
       studies=action==='update'?studies.map(s=>s.id===target.id?saved:s):[...studies,saved];
       working={sourceId:target.id,name:target.name};
       if(action==='save-and-blank'){
        // Preserve both workspaces and clear the draft in the same transaction.
        // A failed save must never leave the user in an empty working copy.
        writePair(WORKING_STUDY_ID,[undefined,undefined],draft);
        working={name:'Untitled working copy'};
       }
      }else{
       const target=action==='load'?studies.find(s=>s.id===options.id):undefined;
       if(action==='load'&&!target)throw Error('This saved study no longer exists.');
       const values=target?await readPair(target.id):[undefined,undefined];
       if(values.some(v=>v?.deleted))throw Error('This saved study was deleted.');
       writePair(WORKING_STUDY_ID,values,draft);
       if(target&&!values.every(v=>v?.snapshot))writePair(target.id,values,values,true);
       working={sourceId:target?.id,name:target?.name||'Untitled working copy'};
      }
      store.put(studies,CATALOG);store.put(working,WORKING_META);
     }
     result={studies,working:working!};
    }catch(error){failure=error;tx.abort();}
   })();
   tx.oncomplete=()=>{db.close();resolve(result);};
   tx.onabort=tx.onerror=()=>{db.close();reject(failure||new Error('Could not save or load this study. Existing data is unchanged.'));};
  };
 });
}
