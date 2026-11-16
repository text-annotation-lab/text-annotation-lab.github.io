// Research mode: deleting texts. A text that a run sent a request for is kept, marked as removed, so that
// the run's results, comparisons, and exports still have its name, text, and columns; it no longer shows in
// the Workspace and is never annotated again. A text no run used is deleted outright. A removed text goes
// for good once no run uses it any more (its runs were deleted). `removedPlace` is the text's place among
// the study's texts, so runs and exports list the texts in the order they were added.
import type {Row} from './runs';

export type Removable=Row&{removedAt?:string;removedPlace?:number};

// Whether a run sent a request for the text: a result (done or failed) of a run, an earlier run's result, or a
// failed attempt that waits to be sent again.
export function usedByRuns(doc:Row):boolean{
 if((doc.status==='done'||doc.status==='error'||doc.status==='running'||doc.status==='queued')&&doc.runNo!==undefined)return true;
 if(doc.earlier?.length)return true;
 return Array.isArray(doc.history)&&doc.history.some((attempt:any)=>attempt&&typeof attempt==='object');
}

// The study's texts with the removed ones back in their places: for the runs, the comparisons, and the exports.
export function withRemoved<T extends Removable>(docs:T[],removed:T[]):T[]{
 if(!removed.length)return docs;
 const out=docs.slice();
 for(const doc of [...removed].sort((a,b)=>(a.removedPlace??Infinity)-(b.removedPlace??Infinity)))out.splice(Math.min(doc.removedPlace??out.length,out.length),0,doc);
 return out;
}

// Splits the study's texts, in order, into those in the Workspace and those removed, and notes each removed
// text's place.
function settle<T extends Removable>(all:T[]):{docs:T[];removed:T[]}{
 const docs:T[]=[],removed:T[]=[];
 all.forEach((doc,i)=>{if(doc.removedAt)removed.push(doc.removedPlace===i?doc:{...doc,removedPlace:i});else docs.push(doc);});
 return {docs,removed};
}

// Delete texts. kept: those a run used, now removed; deleted: those deleted outright.
export function removeTexts<T extends Removable>(docs:T[],removed:T[],ids:Set<string>,now:string):{docs:T[];removed:T[];kept:number;deleted:number}{
 let kept=0,deleted=0;
 const all:T[]=[];
 for(const doc of withRemoved(docs,removed)){
  if(doc.removedAt||!ids.has(doc.id)){all.push(doc);continue;}
  if(usedByRuns(doc)){kept++;all.push({...doc,removedAt:now});}else deleted++;
 }
 return {...settle(all),kept,deleted};
}

// After runs were deleted: a removed text that no run uses any more goes for good.
export function pruneRemoved<T extends Removable>(docs:T[],removed:T[]):{docs:T[];removed:T[]}{
 if(!removed.length||removed.every(usedByRuns))return {docs,removed};
 return settle(withRemoved(docs,removed).filter(doc=>!doc.removedAt||usedByRuns(doc)));
}

// Texts added again that a run used before they were deleted: they get their record back, results and all, at
// the end of the study's texts. back: the ids of the removed texts, each with the text that replaces it.
export function bringBack<T extends Removable>(docs:T[],removed:T[],back:Map<string,(doc:T)=>T>):{docs:T[];removed:T[];restored:T[]}{
 const restored:T[]=[];
 const all=withRemoved(docs,removed).filter(doc=>{
  const make=doc.removedAt?back.get(doc.id):undefined;
  if(!make)return true;
  const {removedAt,removedPlace,...rest}=doc;restored.push(make(rest as T));return false;
 });
 const kept=settle(all);
 return {docs:kept.docs,removed:kept.removed,restored};
}

// Files being added that are removed texts again: the same name (in any letter case) and the same bytes. Each
// file gets the id of the removed text it brings back; a removed text is brought back once.
const fold=(name:string)=>name.normalize('NFC').toLowerCase();
async function sameBytes(a:Blob,b:Blob):Promise<boolean>{
 if(a.size!==b.size)return false;
 const [x,y]=await Promise.all([a.arrayBuffer(),b.arrayBuffer()]),p=new Uint8Array(x),q=new Uint8Array(y);
 for(let i=0;i<p.length;i++)if(p[i]!==q[i])return false;
 return true;
}
export async function matchReturning(files:File[],removed:{id:string;name:string;file?:Blob;removedAt?:string}[]):Promise<Map<File,string>>{
 const found=new Map<File,string>(),taken=new Set<string>();
 for(const file of files)for(const doc of removed){
  if(taken.has(doc.id)||!doc.file||fold(doc.name)!==fold(file.name))continue;
  if(await sameBytes(file,doc.file)){found.set(file,doc.id);taken.add(doc.id);break;}
 }
 return found;
}

// Removed texts as stored with the study: only well-formed records that a run still uses.
export function cleanRemoved<T extends Removable>(value:unknown):T[]{
 if(!Array.isArray(value))return [];
 return value.filter((doc:any)=>doc&&typeof doc==='object'&&typeof doc.id==='string'&&typeof doc.name==='string'&&typeof doc.removedAt==='string'&&usedByRuns(doc)) as T[];
}

// When the texts were removed, as a date (YYYY-MM-DD), for the exports.
export const removedOn=(row:{[key:string]:any})=>typeof row.removedAt==='string'?row.removedAt.slice(0,10):'';
