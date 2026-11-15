// What the research workspace shows: the texts of one run or each text's
// latest result, narrowed by search and filters, optionally next to a column
// of labels or another run.
import {resultAnswer} from '../answer-fields';
import {fieldSpec} from '../answer-types';
import {normalizeLabel} from './normalize';
import {rowForRun,type Row} from './runs';
import {cellOf,columnIndex,type Column} from './columns';

export type View={run:'latest'|number;query:string;show:string;column:string;value:string;compare:string;field:string};
export const DEFAULT_VIEW:View={run:'latest',query:'',show:'all',column:'',value:'',compare:'',field:''};
export type Compared={own:string;other:string;match:boolean|null};
export type ShownRow<T>=T&{compared?:Compared};

// The single score or category of a prompt without named answer fields.
export const SCORE_FIELD='';
export const fieldLabel=(field:string)=>field||'Score / category';
export const valueOf=(row:{score?:string;answerFields?:string[];answers?:Record<string,string>},field:string)=>field?resultAnswer(row,field):row.answerFields?.length?'':String(row.score??'');
// Answer fields with at least one completed value, in the order they were defined.
export function fieldsOf(rows:Row[]):string[]{
 const fields:string[]=[];let score=false;
 for(const row of rows){
  if(row.status!=='done')continue;
  if(row.answerFields?.length){for(const name of row.answerFields)if(!fields.includes(name))fields.push(name);}else score=true;
 }
 return score?[SCORE_FIELD,...fields]:fields;
}
// The field to compare: the chosen one, else the one named like the column, else the first that is not an explanation.
export function pickField(fields:string[],chosen:string,like=''):string{
 if(fields.includes(chosen))return chosen;
 const named=fields.find(f=>f&&f.toLowerCase()===like.trim().toLowerCase());
 return named??fields.find(f=>f.toLowerCase()!=='explanation')??fields[0]??SCORE_FIELD;
}
export type CompareSource={kind:'run';run:number}|{kind:'column';name:string};
export const sourceKey=(source:CompareSource)=>source.kind==='run'?'run:'+source.run:'col:'+source.name;
export function parseSource(key:string):CompareSource|undefined{
 if(key.startsWith('run:')){const run=Number(key.slice(4));return Number.isInteger(run)&&run>0?{kind:'run',run}:undefined;}
 return key.startsWith('col:')&&key.length>4?{kind:'column',name:key.slice(4)}:undefined;
}
// `yesNo`: a yes / no field, where 1 and 0, y and n, and ja and nej also read as yes and no.
export const sameLabel=(a:string,b:string,yesNo=false)=>normalizeLabel(a,yesNo)===normalizeLabel(b,yesNo);
const isYesNo=(row:Row,field:string)=>Boolean(field)&&fieldSpec(row.answerSettings,field)?.type==='boolean';
export const viewNarrowed=(view:View)=>Boolean(view.query.trim())||view.show!=='all'||Boolean(view.column&&view.value)||view.run!=='latest';

export function researchRows<T extends Row>(docs:T[],columns:Column[],view:View):{rows:ShownRow<T>[];field:string;fields:string[]}{
 const source=parseSource(view.compare),query=view.query.trim().toLowerCase();
 const filterIndex=view.column&&view.value?columnIndex(columns,view.column):-1;
 const compareIndex=source?.kind==='column'?columnIndex(columns,source.name):-1;
 const base=view.run==='latest'?docs:docs.map(doc=>rowForRun(doc,view.run as number)).filter(row=>row.status!=='absent');
 const fields=fieldsOf(source?.kind==='run'?[...base,...docs.map(doc=>rowForRun(doc,source.run))]:base);
 const field=pickField(fieldsOf(base).length?fieldsOf(base):fields,view.field,source?.kind==='column'?source.name:'');
 const rows:ShownRow<T>[]=[];
 for(const row of base){
  if(filterIndex>=0&&cellOf(row,filterIndex)!==view.value)continue;
  if(view.column&&view.value&&filterIndex<0)continue;
  let shown:ShownRow<T>=row;
  if(source){
   const own=row.status==='done'?valueOf(row,field):'';
   let other='',yesNo=isYesNo(row,field);
   if(source.kind==='column')other=cellOf(row,compareIndex);
   else{const earlier=rowForRun(row,source.run),theirs=pickField(fieldsOf([earlier]),field);other=earlier.status==='done'?valueOf(earlier,theirs):'';yesNo=yesNo||isYesNo(earlier,theirs);}
   shown={...row,compared:{own,other,match:own&&other?sameLabel(own,other,yesNo):null}};
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
