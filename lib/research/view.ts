// What the research workspace shows: the texts of one run or each text's
// latest result, narrowed by search and filters, optionally next to a column
// of labels or another run.
import {rowForRun,type Row} from './runs';
import {cellOf,columnIndex,type Column} from './columns';
import {pairSources} from './agreement';
import {comparableValues} from './comparable';
import {fieldsOf,isYesNo,parseSource,pickField,sameLabel,sourceResult,valueOf} from './fields';
import type {ScoreScale} from './score-scale';
export {SCORE_FIELD,fieldLabel,valueOf,fieldsOf,pickField,sourceKey,parseSource,sourceResult,sameLabel,type CompareSource} from './fields';

export type View={run:'latest'|number;query:string;show:string;column:string;value:string;compare:string;field:string};
export const DEFAULT_VIEW:View={run:'latest',query:'',show:'all',column:'',value:'',compare:'',field:''};
export type Compared={own:string;other:string;match:boolean|null};
export type ShownRow<T>=T&{compared?:Compared};
export const viewNarrowed=(view:View)=>Boolean(view.query.trim())||view.show!=='all'||Boolean(view.column&&view.value)||view.run!=='latest';

// "Compare with": whether a text's two values agree, as the agreement figures of Runs & agreement read and count
// them. Each run shown is compared over all of its texts (pairSources), so a yes / no field reads 1 and 0 too, and
// a value the figures leave out (a number off the field's scale or the study's scale for the scores, a value that
// is not one of the field's categories) or do not pair (a coder's “NA”, read as a blank cell) is neither a
// disagreement nor an agreement (comparable.ts).
// scale: the study's scale for the scores of plain-text replies (score-scale.ts).
// `study`: every text the agreement figures read (with those removed from the study but kept for their runs), so that
// "Disagree" and "Agree" leave out what the figures leave out.
export function researchRows<T extends Row>(docs:T[],columns:Column[],view:View,scale?:ScoreScale,study:Row[]=docs):{rows:ShownRow<T>[];field:string;fields:string[]}{
 const source=parseSource(view.compare),query=view.query.trim().toLowerCase();
 const filterIndex=view.column&&view.value?columnIndex(columns,view.column):-1;
 const compareIndex=source?.kind==='column'?columnIndex(columns,source.name):-1;
 const base=view.run==='latest'?docs:docs.map(doc=>rowForRun(doc,view.run as number)).filter(row=>row.status!=='absent');
 const fields=fieldsOf(source?.kind==='run'?[...base,...docs.map(doc=>sourceResult(doc,source))]:base);
 const field=pickField(fieldsOf(base).length?fieldsOf(base):fields,view.field,source?.kind==='column'?source.name:'');
 const judged=new Map<string,boolean|null>(),runs=new Set<number>();
 // The compared run's field: the same one for every text, as in the agreement figures. A text whose earlier reply
 // lacks it shows nothing there, not another field's value.
 const theirs=source?.kind==='run'?pickField(fieldsOf(docs.map(doc=>sourceResult(doc,source))),field):'';
 if(source){
  for(const row of base)if(row.status==='done'&&row.runNo!==undefined)runs.add(row.runNo);
  for(const run of runs){
   const p=pairSources(study,columns,{kind:'run',run},field,source,theirs,scale);
   const counts=comparableValues(p.a.map((a,i)=>[a,p.b[i]]),p.level,p.allowed,{scaleSeen:p.scaleSeen,range:p.range,known:p.known});
   p.ids.forEach((id,i)=>judged.set(run+':'+id,counts(p.a[i])&&counts(p.b[i])?p.a[i]===p.b[i]:null));
  }
 }
 const rows:ShownRow<T>[]=[];
 for(const row of base){
  if(filterIndex>=0&&cellOf(row,filterIndex)!==view.value)continue;
  if(view.column&&view.value&&filterIndex<0)continue;
  let shown:ShownRow<T>=row;
  if(source){
   const own=row.status==='done'?valueOf(row,field):'';
   let other='',yesNo=isYesNo(row,field);
   if(source.kind==='column')other=cellOf(row,compareIndex);
   else{const earlier=sourceResult(row,source);other=earlier.status==='done'?valueOf(earlier,theirs):'';yesNo=yesNo||isYesNo(earlier,theirs);}
   // A text the figures do not pair (its label is a coder's “NA”, read as a blank cell) is neither; a result
   // without a run is compared as it reads.
   const paired=row.runNo!==undefined&&runs.has(row.runNo);
   shown={...row,compared:{own,other,match:own&&other?paired?judged.get(row.runNo+':'+row.id)??null:sameLabel(own,other,yesNo):null}};
  }
  if(view.show==='pending'&&row.status!=='pending')continue;
  if(view.show==='done'&&row.status!=='done')continue;
  if(view.show==='error'&&row.status!=='error')continue;
  if(view.show==='disagree'&&shown.compared?.match!==false)continue;
  if(view.show==='agree'&&shown.compared?.match!==true)continue;
  if(query){
   const haystack=[row.name,row.score,...Object.values(row.answers||{}),...(row.cells||[])].filter(Boolean).join('\n').toLowerCase();
   if(!haystack.includes(query))continue;
  }
  rows.push(shown);
 }
 return {rows,field,fields};
}
// The run a text's shown result belongs to; for a text waiting to be annotated again, its most recent earlier run.
export function runTag(row:Row):{run:number;earlier:boolean}|undefined{
 if(row.status!=='pending'&&row.runNo!==undefined)return {run:row.runNo,earlier:false};
 const last=row.earlier?.at(-1);
 return last?{run:last.runNo,earlier:true}:undefined;
}
// A quick, unrecorded pick of n items (for trying a prompt on a few texts).
export function pickRandom<T>(items:T[],n:number,random:()=>number=Math.random):T[]{
 const pool=[...items];
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 return pool.slice(0,Math.max(0,Math.min(Math.round(n)||0,pool.length)));
}
