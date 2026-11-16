// Which values the agreement figures compare (metrics.ts, `agreement`), as a test for one value: a pair is compared
// when both of its values pass. "Disagree" and "Agree" in the Workspace and Model knowledge use it, so they list the
// texts the figures count, as the same author's separate research tool does (a coder's “NA”, a 9 next to a −3 to 3
// scale, or a value that is not one of a field's categories is left out). It repeats the rule `agreement` applies
// to the same arguments; tests/scale-combine.cjs checks that the two keep the same pairs.
import {grownScale,isMissingLabel,ratingRange,type Level} from './metrics';

const isNum=(s:string)=>s.trim()!==''&&!Number.isNaN(Number(s));
export function comparableValues(pairs:[string,string][],level:Level,allowed:string[]=[],{scaleSeen=false,range,known}:{scaleSeen?:boolean;range?:[number,number];known?:string[]}={}):(value:string)=>boolean{
 const numericCodebook=!scaleSeen&&allowed.length>0&&allowed.every(isNum),allowedNums=allowed.filter(isNum).map(Number);
 const seed:[number,number]|null=!scaleSeen?null:range??(allowedNums.length?[Math.min(...allowedNums),Math.max(...allowedNums)]:null);
 let fits:((v:string)=>boolean)|null=null,onNumbers=false;
 if(scaleSeen){
  let block:[number,number]|null=null;
  if(seed&&ratingRange(seed)){const values:number[]=[];for(const [x,y] of pairs)for(const v of [x,y])if(isNum(v))values.push(Number(v));block=grownScale(seed,values);}
  const [lo,hi]=block??[-Infinity,Infinity];
  fits=v=>isNum(v)&&Number(v)>=lo-1e-9&&Number(v)<=hi+1e-9;onNumbers=true;
 }else if(level!=='nominal'||numericCodebook){
  onNumbers=true;
  const lo=allowedNums.length>=2?Math.min(...allowedNums):-Infinity,hi=allowedNums.length>=2?Math.max(...allowedNums):Infinity;
  const onScale=(v:string)=>isNum(v)&&Number(v)>=lo-1e-9&&Number(v)<=hi+1e-9;
  fits=level==='nominal'?v=>onScale(v)||(v.includes(' | ')&&v.split(' | ').every(onScale)):onScale;
 }else if(new Set(allowed).size>=2){
  const cats=new Set(allowed);
  fits=v=>cats.has(v)||(v.includes(' | ')&&v.split(' | ').every(x=>cats.has(x)));
 }else if(known){
  const cats=new Set(known);
  return v=>!(isMissingLabel(v)&&!cats.has(v));
 }
 if(!fits)return ()=>true;
 const onScale=fits,missing=(v:string)=>!onScale(v)&&isMissingLabel(v);
 const labelled=pairs.filter(([x,y])=>!missing(x)&&!missing(y)),kept=labelled.filter(([x,y])=>onScale(x)&&onScale(y));
 const asWords=onNumbers?labelled.filter(([x,y])=>!isNum(x)||!isNum(y)).length*2>labelled.length:!(kept.length&&kept.length>=labelled.length/2);
 return v=>!missing(v)&&(asWords||onScale(v));
}
