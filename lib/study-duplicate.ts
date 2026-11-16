// Research mode's Duplicate actions: a new working copy with the open study's prompt and settings and,
// with `withTexts`, its texts and Model knowledge subjects with their columns and samples. Nothing of a
// run is copied: no results, runs, request records, removed texts, or batch.
const RUN_KEYS=['requests','batchJob','runs','removed'];
const TEXT_KEYS=['docs','items','columns','samples','input'];
// What a text or subject is before it is annotated; everything else on it belongs to a result.
const TEXT_PARTS=['id','name','file','cells','chartYear','chartGroup','sourceId','sourceName','sourceFile','chunkIndex','chunkCount','wordsPerChunk','wordStart','wordEnd','chunkMethod','segmenter'];
const SUBJECT_PARTS=['id','name','fields','cells','chartYear','chartGroup'];

const pick=(value:any,keys:string[])=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const active=(rows:any)=>Array.isArray(rows)?rows.filter(row=>row&&!row.removedAt):[];

function settingsOf(workspace:any,withTexts:boolean){
 const out:any={};
 for(const [key,value] of Object.entries(workspace))if(!RUN_KEYS.includes(key)&&(withTexts||!TEXT_KEYS.includes(key)))out[key]=value;
 return out;
}
export function duplicateTexts(workspace:any,withTexts:boolean){
 if(!workspace||workspace.deleted)return undefined;
 const out=settingsOf(workspace,withTexts);
 if(withTexts&&workspace.docs)out.docs=active(workspace.docs).map(doc=>({...pick(doc,TEXT_PARTS),status:'pending'}));
 return out;
}
export function duplicateKnowledge(workspace:any,withTexts:boolean){
 if(!workspace||workspace.deleted)return undefined;
 const out=settingsOf(workspace,withTexts);
 if(withTexts&&workspace.items){
  // One row per subject: a subject annotated again in student mode has a row for each time.
  const seen=new Set<string>();
  out.items=active(workspace.items).filter(item=>{const subject=item.subjectId||item.id;if(seen.has(subject))return false;seen.add(subject);return true;})
   .map(item=>({...pick(item,SUBJECT_PARTS),subjectId:item.id,runNumber:1,status:'pending'}));
 }
 return out;
}
export const duplicateWorkspaces=(values:any[],withTexts:boolean)=>[duplicateTexts(values[0],withTexts),duplicateKnowledge(values[1],withTexts)];
// “Pilot (copy)”, kept within the 80 characters a study name may have.
export const copyName=(name:string)=>name.trim().slice(0,73).trimEnd()+' (copy)';
