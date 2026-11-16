// Research mode: scores with a fixed scale beyond the agreement figures. With several annotations per text, the
// numbers of a JSON score in plain-text replies are combined by their median (repeats.ts). A score has a fixed
// scale when it is read on the study's scale for the scores (score-scale.ts), or when it is a yes / no in numbers
// (0 and 1), as the same author's separate research tool reads it. A number off that scale (a code such as 9 for
// “can’t tell” next to −3 to 3, or next to 0 and 1) is left out of the median, as “NA” is, when another annotation
// of the text gave a number on it; when every number is off it, they are combined as before, and the agreement
// figures leave the combined value out and report it. Which scores have a fixed scale is decided for each run from
// every one of its usable annotations, so all of a run's texts are combined alike. Results are combined when they
// come back, and a scale can be set or changed later, so they are combined again here whenever they are read; the
// stored results never change.
import {annotationsOf,combinePlain} from './repeats';
import {toNumber} from './normalize';
import {farFromZeroOne,onScale,zeroOne,type ScoreScale} from './score-scale';
import type {Row} from './runs';
import {isExplanationKey,jsonAnswers} from '../json-reply';

type Result={status?:string;answerSettings?:{plain?:boolean};answers?:Record<string,string>;annotations?:unknown;[key:string]:any};
// How a score's numbers are kept when combined: on the study's scale, or not far from 0 and 1.
export type Rule='scale'|'flag';
const NONE=new Map<string,Rule>();

const plainDone=(result:Result)=>result.status==='done'&&result.answerSettings?.plain===true;
// A result whose answers are combined from two or more usable annotations.
const combined=(result:Result)=>plainDone(result)&&annotationsOf(result).filter(a=>a.status==='done').length>1;

// Each value of a result's single answers that are JSON: its key, and the value as a number (NaN for text). Kept
// per result while its answers stay the same objects.
const read=new WeakMap<object,{annotations:unknown;answers:unknown;values:[string,number][]}>();
function singleValues(result:Result):[string,number][]{
 const seen=read.get(result);
 if(seen&&seen.annotations===result.annotations&&seen.answers===result.answers)return seen.values;
 const values:[string,number][]=[],list=annotationsOf(result),sources=list.length?list.filter(a=>a.status==='done'):[result];
 for(const source of sources){
  const reply=jsonAnswers(source.answers);if(!reply)continue;
  for(const [key,value] of Object.entries(reply))if(!isExplanationKey(key)&&value.trim())values.push([key,toNumber(value)]);
 }
 read.set(result,{annotations:result.annotations,answers:result.answers,values});
 return values;
}
// The JSON scores of one run that have a fixed scale: values that are mostly numbers, over every usable annotation
// of the run (a result made of one annotation is that annotation), with the numbers mostly on the study's scale
// (onScale), or else a yes / no in numbers (zeroOne).
export function scaleKeys(results:Result[],scale?:ScoreScale):Map<string,Rule>{
 const values=new Map<string,{given:number;numbers:number[]}>();
 for(const result of results){
  if(!plainDone(result))continue;
  for(const [key,x] of singleValues(result)){
   let entry=values.get(key);if(!entry){entry={given:0,numbers:[]};values.set(key,entry);}
   entry.given++;if(Number.isFinite(x))entry.numbers.push(x);
  }
 }
 const rules=new Map<string,Rule>();
 for(const [key,v] of values){
  if(!v.numbers.length||v.numbers.length*2<v.given)continue;
  if(scale&&onScale(v.numbers,scale))rules.set(key,'scale');else if(zeroOne(v.numbers))rules.set(key,'flag');
 }
 return rules;
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
// The scores of each run that have a fixed scale (runs with none are left out). combinedOnly: only runs with a
// result combined from several annotations.
export function scaleKeysByRun(rows:Row[],scale:ScoreScale|undefined,combinedOnly=false):Map<number,Map<string,Rule>>{
 const keys=new Map<number,Map<string,Rule>>();
 for(const [run,list] of resultsByRun(rows)){
  if(combinedOnly&&!list.some(combined))continue;
  const own=scaleKeys(list,scale);if(own.size)keys.set(run,own);
 }
 return keys;
}

// The same result combined again with its scores' fixed scales, or the result itself when no number was left out.
const done=new WeakMap<object,{key:string;result:Result;n:number}>();
function onScaleResult<T extends Result>(result:T,rules:Map<string,Rule>,scale:ScoreScale|undefined):{result:T;n:number}{
 if(!rules.size||!combined(result))return {result,n:0};
 const key=JSON.stringify([scale??null,[...rules]]),seen=done.get(result);
 if(seen?.key===key)return {result:seen.result as T,n:seen.n};
 const leftOut={n:0},fits=(x:number)=>Boolean(scale)&&x>=scale!.min&&x<=scale!.max,near=(x:number)=>!farFromZeroOne(x);
 const f0=combinePlain(annotationsOf(result).filter(a=>a.status==='done'),name=>{const rule=rules.get(name);return rule==='scale'?fits:rule==='flag'?near:undefined;},leftOut);
 const out=leftOut.n?{...result,answers:{...result.answers,f0}}:result;
 done.set(result,{key,result:out,n:leftOut.n});
 return {result:out,n:leftOut.n};
}

// Texts (or subjects) with every result combined with its scores' fixed scales. leftOut: for each run, how many
// numbers were left out. Texts whose results are unchanged are the same objects.
export function onScaleRows<T extends Row>(rows:T[],scale:ScoreScale|undefined):{rows:T[];leftOut:Map<number,number>}{
 const leftOut=new Map<number,number>(),keys=scaleKeysByRun(rows,scale,true);
 if(!keys.size)return {rows,leftOut};
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
// Model knowledge's own records (one per subject and run, the run in runNumber), combined alike.
export function onScaleItems<T extends Result&{runNumber?:number}>(items:T[],scale:ScoreScale|undefined):T[]{
 const byRun=new Map<number,Result[]>();
 for(const item of items)if(plainDone(item)){const run=item.runNumber||1,list=byRun.get(run);if(list)list.push(item);else byRun.set(run,[item]);}
 const keys=new Map<number,Map<string,Rule>>();
 for(const [run,list] of byRun)if(list.some(combined)){const own=scaleKeys(list,scale);if(own.size)keys.set(run,own);}
 return keys.size?items.map(item=>onScaleResult(item,keys.get(item.runNumber||1)??NONE,scale).result):items;
}
// How many numbers off their score's scale one run left out when its texts' annotations were combined.
export const offScaleLeftOut=(rows:Row[],run:number,scale:ScoreScale|undefined)=>onScaleRows(rows,scale).leftOut.get(run)||0;
