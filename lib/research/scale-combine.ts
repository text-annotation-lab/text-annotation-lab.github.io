// Research mode: the study's scale for the scores (score-scale.ts) beyond the agreement figures. With several
// annotations per text, the numbers of a JSON score in plain-text replies are combined by their median (repeats.ts).
// On the scale, a number off it (a code such as 9 for “can’t tell” next to −3 to 3) is left out of that median, as
// “NA” is, when another annotation of the text gave a number on it; when every number is off it, they are combined
// as before, and the agreement figures leave the combined value out and report it. Which scores are read on the
// scale is decided for each run from every one of its usable annotations, so all of a run's texts are combined
// alike. Results are combined when they come back, and a scale can be set or changed later, so they are combined
// again here whenever they are read; the stored results never change.
import {annotationsOf,combinePlain} from './repeats';
import {toNumber} from './normalize';
import {onScale,type ScoreScale} from './score-scale';
import type {Row} from './runs';
import {isExplanationKey,jsonAnswers} from '../json-reply';

type Result={status?:string;answerSettings?:{plain?:boolean};answers?:Record<string,string>;annotations?:unknown;[key:string]:any};
const NONE=new Set<string>();

const plainDone=(result:Result)=>result.status==='done'&&result.answerSettings?.plain===true;
// A result whose answers are combined from two or more usable annotations.
const combined=(result:Result)=>plainDone(result)&&annotationsOf(result).filter(a=>a.status==='done').length>1;

// The JSON scores of one run that are read on the scale: values that are mostly numbers, with the numbers mostly on
// it (onScale), over every usable annotation of the run (a result made of one annotation is that annotation).
export function scaleKeys(results:Result[],scale:ScoreScale):Set<string>{
 const values=new Map<string,{given:number;numbers:number[]}>();
 for(const result of results){
  if(!plainDone(result))continue;
  const list=annotationsOf(result),sources=list.length?list.filter(a=>a.status==='done'):[result];
  for(const source of sources){
   const reply=jsonAnswers(source.answers);if(!reply)continue;
   for(const [key,value] of Object.entries(reply)){
    if(isExplanationKey(key)||!value.trim())continue;
    let entry=values.get(key);if(!entry){entry={given:0,numbers:[]};values.set(key,entry);}
    entry.given++;const x=toNumber(value);if(Number.isFinite(x))entry.numbers.push(x);
   }
  }
 }
 return new Set([...values].filter(([,v])=>v.numbers.length*2>=v.given&&onScale(v.numbers,scale)).map(([key])=>key));
}

// Every result of a set of texts by run: each text's own (runNo) and its earlier runs'.
function resultsByRun(rows:Row[]):Map<number,Result[]>{
 const byRun=new Map<number,Result[]>(),add=(run:number|undefined,result:Result)=>{if(run===undefined||!plainDone(result))return;const list=byRun.get(run);if(list)list.push(result);else byRun.set(run,[result]);};
 for(const row of rows){
  if(row.status!=='pending')add(row.runNo,row);
  for(const entry of row.earlier||[])add(entry.runNo,entry);
 }
 return byRun;
}
// The scores each run reads on the scale (runs that read none are left out). combinedOnly: only runs with a
// result combined from several annotations.
export function scaleKeysByRun(rows:Row[],scale:ScoreScale|undefined,combinedOnly=false):Map<number,Set<string>>{
 const keys=new Map<number,Set<string>>();
 if(!scale)return keys;
 for(const [run,list] of resultsByRun(rows)){
  if(combinedOnly&&!list.some(combined))continue;
  const own=scaleKeys(list,scale);if(own.size)keys.set(run,own);
 }
 return keys;
}

// The same result combined again on the scale, or the result itself when no number was left out.
const done=new WeakMap<object,{key:string;result:Result;n:number}>();
function onScaleResult<T extends Result>(result:T,keys:Set<string>,scale:ScoreScale):{result:T;n:number}{
 if(!keys.size||!combined(result))return {result,n:0};
 const key=JSON.stringify([scale,[...keys]]),seen=done.get(result);
 if(seen?.key===key)return {result:seen.result as T,n:seen.n};
 const leftOut={n:0},fits=(x:number)=>x>=scale.min&&x<=scale.max;
 const f0=combinePlain(annotationsOf(result).filter(a=>a.status==='done'),name=>keys.has(name)?fits:undefined,leftOut);
 const out=leftOut.n?{...result,answers:{...result.answers,f0}}:result;
 done.set(result,{key,result:out,n:leftOut.n});
 return {result:out,n:leftOut.n};
}

// Texts (or subjects) with every result combined on the scale. leftOut: for each run, how many numbers were left
// out. Texts whose results are unchanged are the same objects.
export function onScaleRows<T extends Row>(rows:T[],scale:ScoreScale|undefined):{rows:T[];leftOut:Map<number,number>}{
 const leftOut=new Map<number,number>(),keys=scaleKeysByRun(rows,scale,true);
 if(!scale||!keys.size)return {rows,leftOut};
 const redo=<R extends Result>(run:number|undefined,result:R):R=>{
  if(run===undefined||result.status!=='done')return result;
  const out=onScaleResult(result,keys.get(run)??NONE,scale);
  if(out.n)leftOut.set(run,(leftOut.get(run)||0)+out.n);
  return out.result;
 };
 const next=rows.map(row=>{
  const own=row.status==='pending'?row:redo(row.runNo,row);
  const earlier=row.earlier?.map(entry=>redo(entry.runNo,entry));
  const moved=Boolean(earlier&&row.earlier&&earlier.some((entry,i)=>entry!==row.earlier![i]));
  return own===row&&!moved?row:{...own,...(moved?{earlier}:{})};
 });
 return {rows:next,leftOut};
}
// Model knowledge's own records (one per subject and run, the run in runNumber), combined on the scale alike.
export function onScaleItems<T extends Result&{runNumber?:number}>(items:T[],scale:ScoreScale|undefined):T[]{
 if(!scale)return items;
 const byRun=new Map<number,Result[]>();
 for(const item of items)if(plainDone(item)){const run=item.runNumber||1,list=byRun.get(run);if(list)list.push(item);else byRun.set(run,[item]);}
 const keys=new Map<number,Set<string>>();
 for(const [run,list] of byRun)if(list.some(combined)){const own=scaleKeys(list,scale);if(own.size)keys.set(run,own);}
 return keys.size?items.map(item=>onScaleResult(item,keys.get(item.runNumber||1)??NONE,scale).result):items;
}
// How many numbers off the scale one run left out when its texts' annotations were combined.
export const offScaleLeftOut=(rows:Row[],run:number,scale:ScoreScale|undefined)=>onScaleRows(rows,scale).leftOut.get(run)||0;
