// The Model knowledge workspace keeps one row per subject and run. For the
// research views it is read the way texts are: one row per subject, holding
// its latest run and the results of earlier runs.
import {RESULT_KEYS,type Earlier,type Row} from './runs';

const KNOWLEDGE_KEYS=['webSearch','webUsed','research','instructions'] as const;
const subjectOf=(item:Row)=>String(item.subjectId||item.id);
export function knowledgeRows(items:Row[]):Row[]{
 const groups=new Map<string,Row[]>();
 for(const item of items){const key=subjectOf(item),list=groups.get(key);if(list)list.push(item);else groups.set(key,[item]);}
 return [...groups].map(([id,list])=>{
  const ordered=[...list].sort((a,b)=>(a.runNumber||1)-(b.runNumber||1)),current=ordered[ordered.length-1];
  const earlier:Earlier[]=ordered.slice(0,-1).filter(item=>item.status==='done'||item.status==='error').map(item=>{
   const entry:Earlier={status:item.status,runNo:item.runNumber||1};
   for(const key of [...RESULT_KEYS,...KNOWLEDGE_KEYS])if(key!=='runNo'&&item[key]!==undefined)entry[key]=item[key];
   return entry;
  });
  return {...current,id,itemId:current.id,runNo:current.runNumber||1,earlier:earlier.length?earlier:undefined,cells:list.find(item=>item.cells?.length)?.cells};
 });
}
// One row per subject, for matching a spreadsheet's rows or drawing a sample.
export function subjectRows(items:Row[]):Row[]{
 const seen=new Map<string,Row>();
 for(const item of items){
  const key=subjectOf(item),first=seen.get(key);
  if(!first)seen.set(key,{...item,id:key});
  else if(!first.cells?.length&&item.cells?.length)first.cells=item.cells;
 }
 return [...seen.values()];
}
// Write the subjects' labels and metadata back to every run of each subject.
export function applySubjectCells<T extends Row>(items:T[],subjects:Row[]):T[]{
 const cells=new Map(subjects.map(subject=>[String(subject.id),subject.cells]));
 return items.map(item=>{
  const next=cells.get(subjectOf(item));
  return next===item.cells||(!next?.length&&!item.cells?.length)?item:{...item,cells:next?.length?next:undefined};
 });
}
