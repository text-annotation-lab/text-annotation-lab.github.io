const loadedRevisions=new Map<string,number>();
export const workspaceRevision=(key:string)=>loadedRevisions.get(key);
// Each tab tracks the revision it loaded, so an older tab cannot overwrite it.
export function createWorkspaceStorage(workspaceKey='current'){
 let revision:number|undefined;
 let queue:Promise<unknown>=Promise.resolve();
 // A save waiting for the one under way. Every save holds the whole workspace, so a waiting autosave
 // (`replaceable`) gives way to a newer save, and both callers hear when the newer one is written. That keeps
 // saving in step with a run that returns many results a second. A save made on purpose is always written.
 let waiting:{value:Record<string,unknown>;replaceable:boolean;result:Promise<void>}|undefined;
 function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const r=indexedDB.open('annotation-desk',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('workspace');
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });}
 return {
  async restore(){
   const db=await database();
   try{return await new Promise<any>((resolve,reject)=>{
    const tx=db.transaction('workspace'),r=tx.objectStore('workspace').get(workspaceKey);
    tx.oncomplete=()=>{if(r.result?.deleted){reject(new Error('This study was deleted in another tab. Reload to open another study.'));return;}revision=r.result?.revision??0;loadedRevisions.set(workspaceKey,revision!);resolve(r.result);};
    tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Could not read browser storage.'));
   });}finally{db.close();}
  },
  save(value:Record<string,unknown>,options?:{replaceable?:boolean}){
   if(waiting?.replaceable){waiting.value=value;waiting.replaceable=options?.replaceable===true;return waiting.result;}
   const entry={value,replaceable:options?.replaceable===true,result:undefined as unknown as Promise<void>};
   const result=entry.result=queue.then(async()=>{
    if(waiting===entry)waiting=undefined;
    const value=entry.value;
    if(revision===undefined)throw new Error('Workspace has not been restored.');
    const db=await database();
    try{await new Promise<void>((resolve,reject)=>{
     const tx=db.transaction('workspace','readwrite'),store=tx.objectStore('workspace');
     const r=store.get(workspaceKey);let conflict=false;
     r.onsuccess=()=>{
      if(r.result?.snapshot||r.result?.deleted||(r.result?.revision??0)!==revision){conflict=true;tx.abort();return;}
      store.put({...value,revision:revision!+1},workspaceKey);
     };
     tx.oncomplete=()=>{revision=revision!+1;loadedRevisions.set(workspaceKey,revision);resolve();};
     tx.onabort=tx.onerror=()=>reject(conflict?new Error('Another tab saved changes. Choose Studies → More options → Download backup to keep the work in this tab before reloading.'):tx.error||new Error('Could not save browser storage.'));
    });}finally{db.close();}
   });
   waiting=entry;queue=result.catch(()=>{});return result;
  }
 };
}
