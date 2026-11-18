// Draw a random sample of texts, reproducible from a seed, and mark it in a
// column (for example sample = validation). The rules follow the author's
// research workbench: proportional allocation over the chosen strata (largest
// remainder, at least one text per stratum when the sample is large enough),
// then a seeded shuffle of each stratum's texts in name order.
import {columnIndex,type Column} from './columns';

export type SampleRow={id:string;name:string;cells?:string[];[key:string]:any};
export type SampleOptions={size:number;strata:string[];exclude:{column:string;value:string}|null;markedAs?:{column:string;value:string}|null;seed:number;
 // 2 (the default) keeps apart strata whose joined names coincide ("A · B / C" and "A / B · C", or a blank and "(none)");
 // pass 1 to redraw a sample recorded with sampling method 1, which grouped by the joined name.
 method?:1|2};
// Named `stratum`, not `key`: a study backup leaves out any field called `key`.
export type Stratum={stratum:string;available:number;drawn:number};
export type SampleResult={ids:string[];strata:Stratum[];eligible:number;taken:{value:string;n:number}[]};
// Recorded with each draw, so a later reader knows which rules made the sample from the seed. Draws made
// before November 16, 2026 recorded it with the site's name, which plainMethod leaves out.
export const SAMPLING_METHOD='sampling method 2';
// The method number a record names, for redrawing it (records without one were made with method 1).
export const methodNumber=(method:string):1|2=>/sampling method 1\b/.test(method)?1:2;
export const plainMethod=(method:string)=>method.replace(/^Text Annotation Lab (?=sampling method)/,'');
export type SampleRecord={column:string;value:string;date:string;size:number;eligible:number;seed:number;strata:string[];allocation:Stratum[];exclude:{column:string;value:string}|null;taken:{value:string;n:number}[];method:string};

// The same small seeded generator (mulberry32) as the statistics use.
export function seeded(seed:number){
 return()=>{
  seed=(seed+0x6d2b79f5)|0;
  let t=Math.imul(seed^(seed>>>15),1|seed);
  t=(t+Math.imul(t^(t>>>7),61|t))^t;
  return ((t^(t>>>14))>>>0)/4294967296;
 };
}
const norm=(s:string|undefined)=>(s??'').trim().toLowerCase();
// Character by character: the same order in every browser and language.
const byCode=(a:string,b:string)=>a<b?-1:a>b?1:0;
export const orderStrata=(strata:string[])=>[...strata].sort(byCode);

export function drawStratifiedSample(docs:SampleRow[],columns:Column[],o:SampleOptions):SampleResult{
 const value=(doc:SampleRow,column:string)=>{const i=columnIndex(columns,column);return i<0?'':doc.cells?.[i]??'';};
 const strata=orderStrata(o.strata);
 const notExcluded=docs.filter(d=>!o.exclude||norm(value(d,o.exclude.column))!==norm(o.exclude.value));
 // Texts already marked with another value in the sample's column belong to
 // another sample there and are left out, so samples in one column stay disjoint.
 const takenBy=new Map<string,number>();
 const eligible=notExcluded.filter(d=>{
  const held=o.markedAs?value(d,o.markedAs.column):'';
  const other=held.trim()!==''&&held!==o.markedAs!.value?held:'';
  if(other)takenBy.set(other,(takenBy.get(other)??0)+1);
  return !other;
 });
 const taken=[...takenBy].map(([v,n])=>({value:v,n})).sort((a,b)=>b.n-a.n||byCode(a.value,b.value));
 const groups=new Map<string,SampleRow[]>(),nameOf=new Map<string,string>();
 for(const d of eligible){
  // Each stratum is named by its values joined ("1950s · AQ"; a blank one "(none)"). Method 1 also grouped by that
  // name, so values that join alike fell into one stratum; method 2 groups by the values themselves and orders by the
  // name first, so where no names coincide it draws exactly as method 1.
  const name=strata.map(c=>value(d,c).trim()||'(none)').join(' · ')||'all';
  const key=(o.method??2)>=2?JSON.stringify(strata.map(c=>value(d,c).trim())):name;
  nameOf.set(key,name);
  groups.set(key,[...(groups.get(key)??[]),d]);
 }
 const byName=(a:string,b:string)=>byCode(nameOf.get(a)!,nameOf.get(b)!)||byCode(a,b);
 const keys=[...groups.keys()].sort(byName);
 const size=Math.min(Math.max(0,Math.round(o.size)||0),eligible.length);
 const n=(k:string)=>groups.get(k)!.length;
 const quota=new Map<string,number>(keys.map(k=>[k,(size*n(k))/Math.max(1,eligible.length)]));
 const take=new Map<string,number>(keys.map(k=>[k,Math.floor(quota.get(k)!)]));
 if(size>=keys.length)for(const k of keys)if((take.get(k)??0)===0)take.set(k,1);
 const total=()=>[...take.values()].reduce((s,x)=>s+x,0);
 // Too few: add to the strata furthest below their share. Too many (from the minimum of one): take from the largest.
 const short=(k:string)=>quota.get(k)!-take.get(k)!;
 const byRemainder=[...keys].sort((a,b)=>short(b)-short(a)||byName(a,b));
 let moved=true;
 while(total()<size&&moved){
  moved=false;
  for(const k of byRemainder){if(total()>=size)break;if(take.get(k)!<n(k)){take.set(k,take.get(k)!+1);moved=true;}}
 }
 const bySize=[...keys].sort((a,b)=>take.get(b)!-take.get(a)!||byName(a,b));
 moved=true;
 while(total()>size&&moved){
  moved=false;
  for(const k of bySize){if(total()<=size)break;if(take.get(k)!>1){take.set(k,take.get(k)!-1);moved=true;}}
 }
 const rnd=seeded(o.seed),ids:string[]=[];
 for(const k of keys){
  const items=[...groups.get(k)!].sort((a,b)=>byCode(a.name,b.name)||byCode(a.id,b.id));
  for(let i=items.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
  ids.push(...items.slice(0,take.get(k)!).map(d=>d.id));
 }
 return {ids,strata:keys.map(k=>({stratum:nameOf.get(k)!,available:n(k),drawn:take.get(k)!})),eligible:eligible.length,taken};
}

export function allocationNote(strata:Stratum[]):string{
 const empty=strata.filter(s=>s.drawn===0).length;
 return empty?`proportional allocation; ${empty} of ${strata.length} strata received no text because the sample is smaller than the number of strata`:'proportional allocation, at least one per stratum';
}
// One sentence for the methods record of a study.
export function sampleNote(r:SampleRecord):string{
 const left=r.taken.length?`, not from ${r.taken.reduce((n,t)=>n+t.n,0)} texts already marked ${r.taken.map(t=>`${r.column} = ${t.value}`).join(' or ')}`:'';
 return `Sample ${r.column} = ${r.value} (${r.date}): ${r.size} of ${r.eligible} texts drawn at random`+
  (r.strata.length?` within ${r.strata.join(' × ')} strata (${allocationNote(r.allocation)})`:'')+
  (r.exclude?`, excluding ${r.exclude.column} = ${r.exclude.value}`:'')+left+`; seed ${r.seed} (${plainMethod(r.method)}).`;
}
export function sampleRecord(o:SampleOptions&{markedAs:{column:string;value:string}},r:SampleResult,date:string):SampleRecord{
 return {column:o.markedAs.column,value:o.markedAs.value,date,size:r.ids.length,eligible:r.eligible,seed:o.seed,strata:orderStrata(o.strata),allocation:r.strata,exclude:o.exclude,taken:r.taken,method:o.method===1?'sampling method 1':SAMPLING_METHOD};
}
// A redraw of the same column and value replaces its earlier record.
export function recordSample(samples:SampleRecord[],record:SampleRecord):SampleRecord[]{
 return [...samples.filter(s=>!(norm(s.column)===norm(record.column)&&s.value===record.value)),record];
}
export function cleanSamples(value:unknown):SampleRecord[]{
 if(!Array.isArray(value))return [];
 const text=(v:unknown)=>typeof v==='string'?v:'',count=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
 return value.filter(s=>s&&typeof s==='object'&&text(s.column)&&text(s.value)).map(s=>({
  column:text(s.column),value:text(s.value),date:text(s.date),size:count(s.size),eligible:count(s.eligible),seed:count(s.seed),
  strata:Array.isArray(s.strata)?s.strata.filter((x:unknown)=>typeof x==='string'):[],
  allocation:Array.isArray(s.allocation)?s.allocation.filter((x:any)=>x&&typeof x==='object').map((x:any)=>({stratum:text(x.stratum),available:count(x.available),drawn:count(x.drawn)})):[],
  exclude:s.exclude&&typeof s.exclude==='object'&&text(s.exclude.column)?{column:text(s.exclude.column),value:text(s.exclude.value)}:null,
  taken:Array.isArray(s.taken)?s.taken.filter((x:any)=>x&&typeof x==='object').map((x:any)=>({value:text(x.value),n:count(x.n)})):[],
  method:plainMethod(text(s.method))||'sampling method 1',
 }));
}
