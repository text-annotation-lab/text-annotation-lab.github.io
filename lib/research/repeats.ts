// Annotations per text (research mode). A run can annotate each text several times, to see how steady the
// model's answers are. A text still has one result per run: its own fields hold the combined answers, and
// `annotations` holds every annotation with its own reply, tokens, and times. A result made with one
// annotation per text has neither `repeats` nor `annotations`, and is exactly what it always was.
// How answers are combined (the rules of the same author's separate research tool): the value most
// annotations gave for a category, a yes / no, or any other field (a tie reads "a | b"); the median for an
// ordinal scale; the mean for a number. An explanation is never a mix: it is the one written with the
// combined answers, that is, of the annotation closest to them (the first when several are as close).
// Plain-text replies that are JSON are combined value by value into one JSON reply.
import {aggregate} from './metrics';
import {normalizeLabel,toNumber} from './normalize';
import {fieldSpec,type AnswerSettings} from '../answer-types';
import {flattenJsonReply,isExplanationKey} from '../json-reply';

export const MAX_REPEATS=10;
// What several annotations per text (or subject) do, in a sentence, beside the setting.
export function repeatsHint(repeats:number,settings:AnswerSettings|undefined,unit:'text'|'subject'):string{
 if(repeats<2)return 'Use 2 or more to measure how consistent the model is.';
 const each=`Each ${unit} is annotated ${repeats} times, each time with a request of its own.`;
 if(settings?.plain)return `${each} Scores in JSON answers are combined by their median, other values by majority. Compare the repeats with each other under Runs & agreement (choose single annotations on both sides).${repeats%2===0?' Use an odd number: with an even one the median of two middle scores can be a half point (for example, 0.5), which never counts as the same score.':''}`;
 return `${each} Results show the majority (categories), the median (ordinal scales), or the mean (numbers), and how consistent the repeats were.${settings?.fields?.some(field=>field.type==='ordinal')&&repeats%2===0?' Use an odd number so the median of an ordinal scale is a whole number.':''}`;
}
// What stays beside the setting (research mode): a warning only. What the setting does is behind its ⓘ.
export function repeatsWarning(repeats:number,settings:AnswerSettings|undefined):string{
 if(repeats<2||repeats%2)return '';
 if(settings?.plain)return 'Use an odd number: with an even one the median of two middle scores can be a half point (for example, 0.5), which never counts as the same score.';
 return settings?.fields?.some(field=>field.type==='ordinal')?'Use an odd number so the median of an ordinal scale is a whole number.':'';
}
// The number as stored with a study, a run, or a result: only 2 to 10 is ever stored (absent: one).
export const cleanRepeats=(value:unknown):number|undefined=>typeof value==='number'&&Number.isInteger(value)&&value>=2&&value<=MAX_REPEATS?value:undefined;
export const repeatsOf=(result:{repeats?:unknown})=>cleanRepeats(result.repeats)??1;

// n: which of the text's annotations this is, from 1.
export type Annotation={n:number;status:'done'|'error';[key:string]:any};
type FailedAttempt={status:string;[key:string]:any};
type Result={status?:string;repeats?:unknown;annotations?:Annotation[];consistency?:Record<string,number>;answerFields?:string[];answerSettings?:AnswerSettings;history?:FailedAttempt[];[key:string]:any};
// What an annotation keeps for itself. The settings (model, prompt, answer fields) are those of its text's result.
// The first three name the click it was sent with: an annotation made later than its text's others (a missing
// one that was filled in) has its own, so the cost of a click counts only the requests of that click.
const SENT_KEYS=['runId','runStartedAt','runSize'] as const;
const OWN_KEYS=['inputMode','rawResponse','answers','score','explanation','error','tokens','usage','responseId','time','startedAt','processing','batchId','batchEndedAt','concurrency','requestId','modelReported','stopReason','output','reasoningSummary','lab','inserts'] as const;
export const ANNOTATION_KEYS=[...SENT_KEYS,...OWN_KEYS] as const;
// What a failed annotation that was sent again keeps of its text's result, as a failed attempt in `history`.
const SETTING_KEYS=['runId','runStartedAt','runSize','responseFormat','answerFields','answerSettings','requestSettings','provider','model','effort','prompt','runNo','repeats','layout'] as const;

export function annotationsOf(result:{annotations?:unknown;[key:string]:any}):Annotation[]{
 if(!Array.isArray(result.annotations))return [];
 return result.annotations.filter((a):a is Annotation=>Boolean(a)&&typeof a==='object'&&Number.isInteger(a.n)&&a.n>=1&&a.n<=MAX_REPEATS&&(a.status==='done'||a.status==='error')).sort((a,b)=>a.n-b.n);
}
// The annotations still to be made: those that failed or never came back.
export function missingRepeats(result:Result):number[]{
 const ok=new Set(annotationsOf(result).filter(a=>a.status==='done').map(a=>a.n)),missing:number[]=[];
 for(let n=1;n<=repeatsOf(result);n++)if(!ok.has(n))missing.push(n);
 return missing;
}
// A usable result with fewer annotations than its run makes per text.
export const incomplete=(result:Result)=>result.status==='done'&&repeatsOf(result)>1&&missingRepeats(result).length>0;
// How many of the planned annotations are usable, for a result with several (undefined otherwise).
export function annotationCount(result:Result):{ok:number;of:number}|undefined{
 const of=repeatsOf(result);
 return of>1?{ok:of-missingRepeats(result).length,of}:undefined;
}

// What claiming a text (or a subject) sets when a run makes several annotations of it: the number, the
// annotations it keeps (those it has, when missing ones are filled in), and none of a single annotation's own
// fields. One annotated once gets none of this (only what an earlier result left of it is cleared).
type Claim={repeats?:number;annotations?:Annotation[];consistency?:Record<string,number>;score?:string;explanation?:string;tokens?:number;responseId?:string;rawResponse?:string};
export function claimRepeats(result:Result,times:number):Claim{
 if(times>1)return {repeats:times,annotations:result.status==='pending'?[]:result.annotations,consistency:undefined,score:undefined,explanation:undefined,tokens:undefined,responseId:undefined,rawResponse:undefined};
 return 'repeats' in result||'annotations' in result||'consistency' in result?{repeats:undefined,annotations:undefined,consistency:undefined}:{};
}

// Every request behind a result, each read as a result of its own: the result itself, or one per annotation
// (the text's settings with that annotation's reply). replicate: the annotation's number, 1 for a single one.
export function requestsOf<T extends Result>(result:T):{result:T;replicate:number}[]{
 const list=annotationsOf(result);
 if(!list.length)return [{result,replicate:Number.isInteger(result.replicate)&&result.replicate>0?result.replicate:1}];
 const base:Result={...result};
 for(const key of [...OWN_KEYS,'annotations','consistency','history','earlier'])delete base[key];
 return list.map(annotation=>({result:{...base,...annotation} as unknown as T,replicate:annotation.n}));
}

const isNumber=(text:string)=>Number.isFinite(toNumber(text));
// A reply's own value for a key: a key such as "constructor" that a reply lacks is empty, not what every object has.
const own=(answers:Record<string,string>,key:string)=>Object.hasOwn(answers,key)?String(answers[key]??''):'';
// Which annotation's explanation goes with the combined answers: the one whose answers are closest to them.
// Numbers count by their distance, other answers as the same or not. An annotation that gave no number where the
// combined answer is one (an abstention, "NA", nothing) comes after every annotation that did, however far that
// one's number lies from the combined one.
function closest(given:Record<string,string>[],combined:Record<string,string>,relevant:string[],numeric:Set<string>):number{
 let best=0,least=Infinity,fewest=Infinity;
 given.forEach((answers,i)=>{
  let distance=0,missing=0;
  for(const key of relevant){
   const mine=own(answers,key),shared=own(combined,key);
   if(numeric.has(key)&&isNumber(shared)){if(isNumber(mine))distance+=Math.abs(toNumber(mine)-toNumber(shared));else missing++;}
   else distance+=normalizeLabel(mine)===normalizeLabel(shared)?0:1;
  }
  if(missing<fewest||missing===fewest&&distance<least){best=i;least=distance;fewest=missing;}
 });
 return best;
}
const agreeing=(values:string[],value:string)=>values.filter(v=>normalizeLabel(v)===normalizeLabel(value)).length/values.length;

// Plain-text replies. JSON replies are combined value by value: a value that is a number in most replies is
// a score and gets the median of its numbers ("NA" in one reply is left out); any other value, the one most
// replies gave. A reply that is not JSON has nothing to add to them. Without any JSON, the reply most
// annotations gave stands (replies that all differ read "a | b | c"). keep: for a score read on the study's scale
// (scale-combine.ts), the numbers on it, which alone count when the text has any; leftOut counts the others.
export function combinePlain(ok:Annotation[],keep?:(key:string)=>((x:number)=>boolean)|undefined,leftOut?:{n:number}):string{
 const replies=ok.map(a=>String(a.answers?.f0??'')),read=replies.map(flattenJsonReply).filter((x):x is Record<string,string>=>Boolean(x));
 if(!read.length)return aggregate(replies,'majority');
 const keys=[...new Set(read.flatMap(reply=>Object.keys(reply)))];
 const isScore=(key:string)=>{
  const values=read.map(reply=>own(reply,key)).filter(v=>v.trim()!==''),numbers=values.filter(v=>Number.isFinite(toNumber(v)));
  return numbers.length>0&&numbers.length>=values.length/2;
 };
 const labels=keys.filter(key=>!isExplanationKey(key)),scores=labels.filter(isScore),combined:Record<string,string>=Object.create(null);
 for(const key of labels){
  if(!scores.includes(key)){combined[key]=aggregate(read.map(reply=>own(reply,key)),'majority');continue;}
  const numbers=read.map(reply=>toNumber(own(reply,key))).filter(Number.isFinite),fits=keep?.(key),on=fits?numbers.filter(fits):numbers,used=on.length?on:numbers;
  if(leftOut)leftOut.n+=numbers.length-used.length;
  combined[key]=aggregate(used.map(String),'median');
 }
 for(const key of keys.filter(isExplanationKey))combined[key]=own(read[closest(read,combined,relevantTo(key,labels,k=>k),new Set(scores))],key);
 // Keys in the order they were first given; scores as numbers.
 return JSON.stringify(Object.fromEntries(keys.map(key=>[key,scores.includes(key)&&combined[key]!==''?Number(combined[key]):combined[key]])));
}
// The answers an explanation belongs to: "race" for race_explanation; else those of its group (race_negative
// and race_positive); else all of them.
function relevantTo(key:string,labels:string[],nameOf:(label:string)=>string):string[]{
 const name=nameOf(key).toLowerCase(),base=name.replace(/_(explanation|reasoning)$/,'');
 if(base===name)return labels;
 const exact=labels.filter(label=>nameOf(label).toLowerCase()===base),own=exact.length?exact:labels.filter(label=>nameOf(label).toLowerCase().startsWith(base+'_'));
 return own.length?own:labels;
}

// consistency: per answer (f0, f1, …, or score), the share of the annotations that gave the combined value
// (none for free text). It is keyed like `answers`, never by a field's name.
export type Combined={answers?:Record<string,string>;score:string;explanation:string;consistency?:Record<string,number>};
export function combine(ok:Annotation[],names:string[]=[],settings?:AnswerSettings):Combined{
 if(settings?.plain)return {answers:{f0:combinePlain(ok)},score:'',explanation:''};
 const several=ok.length>1,consistency:Record<string,number>={};
 if(!names.length){
  // The single score or category of a prompt without named answer fields.
  const scores=ok.map(a=>String(a.score??'')),score=aggregate(scores,'majority');
  if(several)consistency.score=agreeing(scores,score);
  const source=closest(scores.map(value=>({score:value})),{score},['score'],new Set());
  return {score,explanation:String(ok[source]?.explanation??''),...(several?{consistency}:{})};
 }
 const keys=names.map((_,i)=>'f'+i),nameOf=(key:string)=>names[Number(key.slice(1))],typeOf=(key:string)=>fieldSpec(settings,nameOf(key))?.type;
 // An explanation field: named so, and free text (or without a type).
 const explains=(key:string)=>isExplanationKey(nameOf(key).toLowerCase())&&(typeOf(key)??'text')==='text';
 const labels=keys.filter(key=>!explains(key)&&typeOf(key)!=='text'),numeric=new Set(keys.filter(key=>typeOf(key)==='ordinal'||typeOf(key)==='number'));
 const given=ok.map(a=>(a.answers&&typeof a.answers==='object'?a.answers:{}) as Record<string,string>),answers:Record<string,string>={};
 for(const key of keys){
  if(explains(key))continue;
  const values=given.map(own=>String(own[key]??'')),type=typeOf(key);
  answers[key]=aggregate(values,type==='ordinal'?'median':type==='number'?'mean':'majority');
  // Free text has no share: replies worded differently are not different answers.
  if(several&&type!=='text')consistency[key]=agreeing(values,answers[key]);
 }
 for(const key of keys.filter(explains))answers[key]=String(given[closest(given,answers,relevantTo(key,labels,nameOf),numeric)]?.[key]??'');
 return {answers,score:'',explanation:String(ok[closest(given,answers,labels,numeric)]?.explanation??''),...(several?{consistency}:{})};
}

// The share of a result's annotations that gave its combined value for a field ('' for the single score or
// category); undefined for a result made of one annotation, and for free text.
export function consistencyOf(result:Result,field:string):number|undefined{
 const at=field?(Array.isArray(result.answerFields)?result.answerFields.indexOf(field):-1):0,share=result.consistency?.[field?'f'+at:'score'];
 return at>=0&&typeof share==='number'&&Number.isFinite(share)?share:undefined;
}
// Whether the combined value for a field is a tied vote, which reads "a | b": no annotation gave it as it is.
export function tiedVote(result:Result,field:string):boolean{
 const at=field?(Array.isArray(result.answerFields)?result.answerFields.indexOf(field):-1):0,read=(from:{[key:string]:any})=>String((field?from.answers?.['f'+at]:from.score)??'');
 const value=at<0?'':read(result);
 return value.includes(' | ')&&!annotationsOf(result).some(a=>a.status==='done'&&read(a)===value);
}

// A text's own fields, worked out from its annotations: the combined answers when at least one annotation is
// usable; otherwise a failed result. Tokens are the annotations' total; the reply, the response ID, and the
// usage belong to each annotation and are not repeated on the text.
export function settle(result:Result):Record<string,any>{
 const all=annotationsOf(result),ok=all.filter(a=>a.status==='done');
 const counted=all.filter(a=>typeof a.tokens==='number'&&Number.isFinite(a.tokens)),last=all.map(a=>String(a.time||'')).filter(Boolean).sort().at(-1);
 const shared={tokens:counted.length?counted.reduce((n,a)=>n+a.tokens,0):undefined,time:last,usage:undefined,responseId:undefined,rawResponse:undefined,modelReported:undefined,stopReason:undefined,output:undefined,reasoningSummary:undefined};
 if(!ok.length){
  const first=String(all[0]?.error||'Request failed.');
  return {...shared,status:'error',answers:undefined,score:undefined,explanation:undefined,consistency:undefined,error:!all.length?'No annotation was made.':all.length===1?first:`All ${all.length} annotations failed. The first: ${first}`};
 }
 const combined=combine(ok,result.answerFields,result.answerSettings);
 return {...shared,status:'done',error:undefined,answers:combined.answers,score:combined.score,explanation:combined.explanation,consistency:combined.consistency};
}

// An annotation that came back. It takes the place of a failed annotation with the same number, which
// becomes a failed attempt in `history` (with the settings it was sent with), so no attempt is lost.
export function withAnnotation(result:Result,annotation:Annotation):{annotations:Annotation[];history?:FailedAttempt[]}{
 const all=annotationsOf(result),old=all.find(a=>a.n===annotation.n);
 const annotations=[...all.filter(a=>a.n!==annotation.n),annotation].sort((a,b)=>a.n-b.n);
 if(!old||old.status==='done')return {annotations};
 const attempt:FailedAttempt={status:'error',replicate:old.n};
 for(const key of SETTING_KEYS)if(result[key]!==undefined)attempt[key]=result[key];
 for(const key of ANNOTATION_KEYS)if(old[key]!==undefined)attempt[key]=old[key];
 return {annotations,history:[...(result.history||[]),attempt]};
}
// An annotation as kept: its number and outcome, and of what came back only what an annotation keeps.
export function annotationFrom(n:number,done:boolean,got:Record<string,any>):Annotation{
 const annotation:Annotation={n,status:done?'done':'error'};
 for(const key of ANNOTATION_KEYS)if(got[key]!==undefined)annotation[key]=got[key];
 return annotation;
}
// A text whose requests were not sent after all (a batch that was not submitted): as it was, with the
// annotations it already had; a text without any waits again.
// (Without any, it keeps none of what the claim wrote: the run, the settings, the model, or the request's record.)
const CLAIM_KEYS=['runNo','runId','runStartedAt','runSize','startedAt','usage','error','answerFields','answerSettings','requestSettings','answers','provider','model','prompt','effort','layout','concurrency','processing','batchId','batchEndedAt','requestId','modelReported','stopReason','output','reasoningSummary','lab','inserts'];
export function unclaimed<T extends Result>(result:T):T{
 if(annotationsOf(result).length)return {...result,...settle(result)};
 const {repeats,annotations,consistency,...rest}=result,left:Record<string,unknown>={...rest};
 for(const key of CLAIM_KEYS)delete left[key];
 return {...left,status:'pending'} as unknown as T;
}
