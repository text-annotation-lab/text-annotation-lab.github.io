// Pair two sources of labels for the same texts (a run's answers, or a column
// of human labels) and describe how far they agree. The statistics themselves
// are in metrics.ts.
import {agreement,fmtPct,fmtStat,isMissingLabel,type Agreement,type CiStat,type Level} from './metrics';
import {normalizeLabel,isPlainNumber,lowest,highest,abstains} from './normalize';
import {rowForRun,type Row} from './runs';
import {requestsOf} from './repeats';
import {cellOf,columnIndex,type Column} from './columns';
import {fieldLabel,fieldsOf,pickField,sourceResult,valueOf,type CompareSource} from './fields';
import {fieldSpec,type FieldType} from '../answer-types';
import {onScale,scalePoints,scaleText,zeroOne,type ScoreScale} from './score-scale';

export const sourceLabel=(source:CompareSource)=>source.kind==='run'?'Run #'+source.run+(source.rep?' · annotation '+source.rep:''):source.name;
// The answer fields a run recorded; a column has none.
export const sourceFields=(rows:Row[],source:CompareSource)=>source.kind==='run'?fieldsOf(rows.map(row=>rowForRun(row,source.run))):[];
// One value per text, in the order of `rows`; '' where the source has none.
export function sourceValues(rows:Row[],columns:Column[],source:CompareSource,field:string):string[]{
 if(source.kind==='column'){const index=columnIndex(columns,source.name);return rows.map(row=>cellOf(row,index).trim());}
 return rows.map(row=>{const result=sourceResult(row,source);return result.status==='done'?valueOf(result,field).trim():'';});
}
const isNumber=isPlainNumber;
// Codes that only ever mean “no label” (unlike words such as “none”, which may be a category).
const MISSING_CODE=/^(na|n\/a|#n\/a|n\.a\.?|nan|missing|-|–|—|\.|\?)$/i;
// The type a run gave the field (research mode's answer fields) and the values it allowed, when every
// completed result of the run was made with the same ones.
type Typed={type:FieldType;values:string[]};
function runSpec(rows:Row[],run:number,field:string):Typed|undefined{
 if(!field)return undefined;
 let found:Typed|undefined,key='';
 for(const row of rows){
  const result=rowForRun(row,run);if(result.status!=='done')continue;
  const spec=fieldSpec(result.answerSettings,field),own=spec?JSON.stringify([spec.type,spec.values]):'-';
  if(!key){key=own;found=spec&&{type:spec.type,values:spec.values};}else if(own!==key)return undefined;
 }
 return found;
}
const numbersOf=(values:string[])=>values.map(value=>normalizeLabel(value)).filter(isNumber).map(Number);
// A run whose replies are plain text (research mode), whose JSON values are read as fields.
const plainRun=(rows:Row[],run:number)=>rows.some(row=>{const result=rowForRun(row,run);return result.status==='done'&&result.answerSettings?.plain===true;});
// The single answers a run gave for a field: every annotation of a text, not the answer combined from them (a median
// of 1.5 is no answer of the model's). `given`: how many there are; `numbers`: those that are numbers.
type Single={given:number;numbers:number[]};
function singleAnswers(rows:Row[],run:number,field:string):Single{
 let given=0;const numbers:number[]=[];
 for(const row of rows){
  const result=rowForRun(row,run);if(result.status!=='done')continue;
  for(const {result:one} of requestsOf(result)){
   if(one.status!=='done')continue;
   // (An abstention is no answer on the field: it does not decide whether the field is a score.)
   const value=normalizeLabel(valueOf(one,field));if(!value||abstains(value))continue;
   given++;if(isNumber(value))numbers.push(Number(value));
  }
 }
 return {given,numbers};
}
// Scores: a field whose single answers are mostly numbers. The few that are not (an "NA") are left out and reported.
const scored=(single:Single)=>single.numbers.length>0&&single.numbers.length*2>=single.given;
const sameSet=(values:string[],set:string[])=>new Set(values).size===set.length&&values.every(value=>set.includes(value));
// A label next to values of 0 and 1: yes and no (true, false, y, n, ja, nej) are read as 1 and 0.
export const oneZero=(value:string)=>{const read=normalizeLabel(value,true);return read==='true'?'1':read==='false'?'0':normalizeLabel(value);};
const byNumber=(values:string[])=>[...new Set(values)].sort((x,y)=>Number(x)-Number(y));
// A fixed scale of numbers (a field's allowed values, or the study's scale for the scores) next to a run whose scale
// is read from its answers (`other`: that run's numbers). Where they reach beyond the fixed scale, it is widened so
// that no answer is left out: by the whole numbers of their range (a scale of whole numbers, at most 100 points),
// else by the ends of that range. `ends`: the fixed scale's own lowest and highest value.
function widened(list:string[],other:number[]):{allowed:string[];ends:[number,number];extended:boolean}{
 const points=list.map(Number),lo=Math.min(...points),hi=Math.max(...points),extra:number[]=[];
 if(other.length){
  const whole=points.every(Number.isInteger),least=lowest(other),most=highest(other),from=whole?Math.floor(least):least,to=whole?Math.ceil(most):most;
  if(whole&&Math.max(hi,to)-Math.min(lo,from)<=100){for(let x=from;x<lo;x++)extra.push(x);for(let x=hi+1;x<=to;x++)extra.push(x);}
  else extra.push(...[from,to].filter(x=>x<lo||x>hi));
 }
 return {allowed:byNumber([...list,...extra.map(String)]),ends:[lo,hi],extended:extra.length>0};
}
// `allowed`: the field's own values (a scale's points or its categories), when a run declared them. `scaleSeen`:
// numbers with no declared scale, whose scale is read from the answers (`range`). `known`: categories with none
// declared. `basis` says in words what the scale or the categories rest on. `scale`: the study's scale for the
// scores of plain-text runs (never sent to the model), used when every run compared is a plain-text run whose
// values for the field mostly lie on it. `zeroOne`: the values are 0 and 1 (allowed values of exactly 0 and 1, or
// scores read from the answers that are a yes / no in numbers), so a label of yes or no is read as 1 or 0.
export type Pairing={ids:string[];names:string[];a:string[];b:string[];rawA:string[];rawB:string[];onlyA:number;onlyB:number;numeric:boolean;level:Level;allowed:string[];scaleSeen:boolean;range?:[number,number];known?:string[];leftOut:'marker'|'number'|'value';basis:string;studyScale?:ScoreScale;zeroOne?:boolean};
export function pairSources(rows:Row[],columns:Column[],a:CompareSource,fieldA:string,b:CompareSource,fieldB:string,scale?:ScoreScale):Pairing{
 const va=sourceValues(rows,columns,a,fieldA),vb=sourceValues(rows,columns,b,fieldB);
 const specA=a.kind==='run'?runSpec(rows,a.run,fieldA):undefined,specB=b.kind==='run'?runSpec(rows,b.run,fieldB):undefined;
 const typed=[specA,specB].filter((spec):spec is Typed=>Boolean(spec)&&spec!.type!=='text'),twoRuns=a.kind==='run'&&b.kind==='run';
 // One type for the comparison: a single typed run, or two runs that gave the field the same type.
 const type=typed.length&&typed.every(spec=>spec.type===typed[0].type)?typed[0].type:undefined;
 // The values every typed run allowed; none when a typed run named none, so the scale or the categories are then read from the answers.
 const lists=typed.map(spec=>spec.values.map(value=>normalizeLabel(value)).filter(Boolean)),declared=type&&lists.every(list=>list.length>=2)?[...new Set(lists.flat())]:[];
 // Each run's side of the comparison, with its single answers. `words`: a yes / no in words (a yes / no field, or
 // categories yes and no). `codes`: allowed values of exactly 0 and 1.
 const sides=([[a,fieldA,specA],[b,fieldB,specB]] as [CompareSource,string,Typed|undefined][]).flatMap(([source,field,spec])=>{
  if(source.kind!=='run')return [];
  const own=spec&&spec.type!=='text'?spec:undefined,values=own?own.values.map(value=>normalizeLabel(value)).filter(Boolean):[];
  return [{source,own,single:singleAnswers(rows,source.run,field),words:own?.type==='boolean'||(own?.type==='category'&&sameSet(values,['false','true'])),codes:(own?.type==='ordinal'||own?.type==='category')&&sameSet(values,['0','1'])}];
 });
 // A plain-text run whose scores are read on the study's scale for them.
 const onStudy=(side:typeof sides[number])=>Boolean(scale)&&!side.own&&plainRun(rows,side.source.run)&&scored(side.single)&&onScale(side.single.numbers,scale!);
 // The study's scale for the scores of plain-text runs: when every run compared is one, with its scores on it.
 const studyScale=scale&&!type&&sides.length>0&&sides.every(onStudy)?scale:undefined;
 // Values of 0 and 1: allowed values of exactly these, a study's scale of 0 to 1, or scores read from the answers
 // that are a yes / no in numbers.
 const flagged=(side:typeof sides[number])=>side.codes||(onStudy(side)?scale!.min===0&&scale!.max===1:!side.own&&scored(side.single)&&zeroOne(side.single.numbers));
 // Yes / no: a yes / no in words in one run (a yes / no field, or categories yes and no), compared with a column, or
 // with a run that has one in words or as 0 and 1, or answers in words without a type. It also reads 1 and 0, y and
 // n, and ja and nej. Scores that are no yes / no in numbers (a 1 to 5 rating) are not read as yes and no.
 const yesNo=sides.some(side=>side.words)&&sides.every(side=>side.words||flagged(side)||(!side.own&&!scored(side.single)));
 // One run with values of 0 and 1, compared with a column: the column's yes and no are read as 1 and 0.
 const flag=!yesNo&&sides.length===1&&flagged(sides[0]);
 const read=(value:string,source:CompareSource)=>yesNo?normalizeLabel(value,true):flag&&source.kind==='column'?oneZero(value):normalizeLabel(value);
 const p:Pairing={ids:[],names:[],a:[],b:[],rawA:[],rawB:[],onlyA:0,onlyB:0,numeric:false,level:'nominal',allowed:[],scaleSeen:false,leftOut:'marker',basis:'',...(flag?{zeroOne:true}:{})};
 // Every value as it is compared, '' where a source has none.
 const ra=va.map(value=>value?read(value,a):''),rb=vb.map(value=>value?read(value,b):'');
 const both=ra.map((value,i)=>Boolean(value&&rb[i])),firstAnswers=a.kind==='run'||b.kind!=='run';
 const answers=(firstAnswers?ra:rb).filter((_,i)=>both[i]),labels=(firstAnswers?rb:ra).filter((_,i)=>both[i]),answersAll=firstAnswers?va:vb;
 // The run whose answers these are (none when two columns are compared).
 const answering=sides.find(side=>side.source===(firstAnswers?a:b));
 // A missing-value marker in a column ("NA" for a text nobody coded) is a blank cell, not a label: the text counts
 // as having no label, and is neither compared nor reported as left out. Not where the marker is one of the field's
 // categories, nor among categories no run declared (`known` below tells those apart).
 const fill=(blank:(label:string)=>boolean)=>{
  const cell=(value:string,source:CompareSource)=>source.kind==='column'&&value&&blank(value)?'':value;
  rows.forEach((row,i)=>{
   const x=cell(ra[i],a),y=cell(rb[i],b);
   if(x&&!y)p.onlyA++;else if(y&&!x)p.onlyB++;
   if(!x||!y)return;
   p.ids.push(row.id);p.names.push(String(row.name??''));p.rawA.push(va[i]);p.rawB.push(vb[i]);p.a.push(x);p.b.push(y);
  });
  return p;
 };
 if(yesNo){
  p.allowed=['false','true'];p.leftOut='value';p.basis=type==='boolean'?'A yes / no field: 1 and 0, y and n, and ja and nej are read as yes and no.':'Yes and no, in words or as 1 and 0: 1 and 0, y and n, and ja and nej are read as yes and no.';
  return fill(isMissingLabel);
 }
 if(type==='number'){
  // Numbers with no scale: compared at the interval level; Gwet's coefficients need a fixed scale and are not given.
  p.numeric=true;p.level='interval';p.leftOut='number';p.basis='A number field has no fixed scale, so Gwet’s AC1 and AC2 are not given.';
  return fill(isMissingLabel);
 }
 if(type==='category'&&declared.length&&(!twoRuns||typed.length===2)){
  p.allowed=declared;p.leftOut='value';p.basis=`Categories: the field’s ${declared.length} allowed values.`;
  return fill(label=>isMissingLabel(label)&&!declared.includes(label));
 }
 // Categories that are numbers (codes 0 and 1) in one run, scores in a run without a type in the other: the codes,
 // with the study's scale when the scores are read on it, else widened by the scores so that none is left out. They
 // stay categories (no order), and a value that is no number is left out and reported.
 const scores=twoRuns&&typed.length===1?sides.find(side=>!side.own):undefined;
 if(type==='category'&&declared.length&&declared.every(isNumber)&&scores&&scored(scores.single)){
  const study=onStudy(scores),wide=study?{allowed:byNumber([...declared,...scalePoints(scale!)]),extended:false}:widened(declared,scores.single.numbers);
  p.allowed=wide.allowed;p.leftOut='value';if(study)p.studyScale=scale;
  p.basis=`Categories: the field’s ${declared.length} allowed values${study?`, and the scale set for the scores, ${scaleText(scale!)}`:wide.extended?`, extended to ${wide.allowed[0]} to ${wide.allowed.at(-1)} because the run without allowed values answered beyond them`:''}.`;
  return fill(()=>false);
 }
 // Categories in words in one run (a yes / no field, or categories), scores in a run without a type in the other that
 // are no yes / no in numbers: the categories together with the points of the scores' scale (the study's scale, or
 // every whole number of their range when it is at most 100 wide). A value that is neither is left out and reported.
 // Without points (scores between whole numbers, or a range wider than 100), every value counts.
 if(scores&&scored(scores.single)&&(type==='boolean'||(type==='category'&&declared.length))){
  const own=type==='boolean'?['false','true']:declared,numbers=scores.single.numbers,least=lowest(numbers),most=highest(numbers),study=onStudy(scores);
  const points=study?scalePoints(scale!):numbers.every(Number.isInteger)&&most-least<=100?Array.from({length:most-least+1},(_,i)=>String(least+i)):[];
  p.allowed=points.length?[...new Set([...own,...points])]:[];p.leftOut='value';if(study)p.studyScale=scale;
  p.basis=points.length?`Categories: ${type==='boolean'?'yes and no':`the field’s ${own.length} allowed values`}, and the numbers ${points[0]} to ${points.at(-1)} of the run without allowed values${study?' (the scale set for the scores)':''}.`:'';
  return fill(()=>false);
 }
 // Numbers: a declared scale, or the run's single answers are mostly numbers (every value of a column), and at
 // least half of the labels they are compared with are (missing-value markers aside).
 const real=labels.filter(label=>!isMissingLabel(label));
 // Two columns: a missing-value marker in either is no label, so the order of the two does not change the level.
 const realAnswers=answers.filter(value=>!isMissingLabel(value));
 p.numeric=type==='ordinal'||Boolean(studyScale)||(type!=='category'&&answers.length>0&&(answering?scored(answering.single):realAnswers.length>0&&realAnswers.every(isNumber))&&real.filter(isNumber).length*2>=real.length);
 // Each run's fixed scale, when it has one: the values its ordinal field allows, or the study's scale for the scores.
 const fixed=sides.map(side=>side.own?(type==='ordinal'&&declared.length?declared:undefined):onStudy(side)?scalePoints(scale!):undefined);
 if(p.numeric&&studyScale){
  // As an ordinal field's allowed values: every point counts, and a number off the scale is left out and reported.
  p.level='ordinal';p.allowed=scalePoints(studyScale);p.studyScale=studyScale;
  p.basis=`Scale: the scale set for the scores, ${scaleText(studyScale)} (not sent to the model).`;
 }else if(p.numeric){
  p.level='ordinal';
  const lists=fixed.filter((list):list is string[]=>Boolean(list)),ends=(list:string[])=>{const points=list.map(Number);return [Math.min(...points),Math.max(...points)];};
  // In words: the field's allowed values, the scale set for the scores, or both (an ordinal field in one run and
  // plain-text scores on the study's scale in the other).
  const fromField=sides.some((side,i)=>fixed[i]&&side.own),fromStudy=sides.some((side,i)=>fixed[i]&&!side.own),own=fromField?declared:[];
  const named=[fromField?`the field’s allowed values, ${ends(own)[0]} to ${ends(own)[1]}`:'',fromStudy?`the scale set for the scores, ${scaleText(scale!)}${fromField?'':' (not sent to the model)'}`:''].filter(Boolean).join(', and ');
  if(fromStudy)p.studyScale=scale;
  if(lists.length&&lists.length===sides.length){
   // Every run has a fixed scale: their values together.
   p.allowed=byNumber(lists.flat());p.basis=`Scale: ${named}.`;
  }else if(lists.length){
   // One of two runs has a fixed scale, and the other's is read from its answers: the fixed scale, widened where
   // those reach beyond it (`widened`). It keeps its own ends as the range (which sets its midpoint). An answer
   // between whole numbers (a 2.5) in the run without one makes the comparison interval.
   const other=sides.find((_,i)=>!fixed[i])!.single.numbers,wide=widened(lists[0],other);
   if(!other.every(Number.isInteger))p.level='interval';
   p.allowed=wide.allowed;if(wide.extended)p.range=wide.ends;
   p.basis=`Scale: ${named}${wide.extended?`, extended to ${p.allowed[0]} to ${p.allowed.at(-1)} because the run without ${fromField?'allowed values':'its scores on that scale'} answered beyond ${fromField?'them':'it'}`:''}.`;
  }else{
   // The range of the answers is read from every single answer of the run, not only the paired or the combined ones.
   // Two runs: the range seen in either, so the figures do not depend on which run comes first.
   const each=sides.length?(twoRuns?sides:[answering!]).map(side=>side.single.numbers):[numbersOf(answersAll)],seen=each.flat();
   // Whole numbers are an ordinal scale; an answer between them (a 2.5) makes the field interval.
   if(sides.length&&type!=='ordinal'&&!seen.every(Number.isInteger))p.level='interval';
   p.scaleSeen=true;
   // Whole-number scores: every whole number of the range is a point of the scale, also one never used.
   const whole=sides.length>0&&seen.every(Number.isInteger);
   if(flag){
    // A yes / no in numbers against a column: the scale grows from 0 and 1, not from the range of the answers, so
    // a code far from them (a 9 for "can't tell"), the model's or a coder's, is left out and reported.
    p.range=[0,1];if(whole)p.allowed=['0','1'];
    p.basis='Scale: 0 and 1, read from the run’s answers as a yes / no in numbers. A number far from them, such as 9, is left out, and yes and no in the column are read as 1 and 0.';
   }else{
    const range:[number,number]|undefined=seen.length?[lowest(seen),highest(seen)]:undefined;
    p.range=range;
    // Each run's points: every whole number of its own range, when that is at most 100 wide. Two runs: the points
    // of both, and every whole number between them when the range of both is at most 100 wide.
    const points=each.map(numbers=>{const least=lowest(numbers),most=highest(numbers);return numbers.length&&most-least<=100?Array.from({length:most-least+1},(_,i)=>least+i):[];});
    if(range&&whole&&points.every(list=>list.length))p.allowed=(range[1]-range[0]<=100?Array.from({length:range[1]-range[0]+1},(_,i)=>range[0]+i):[...new Set(points.flat())].sort((x,y)=>x-y)).map(String);
    p.basis=range?`Scale: read from ${twoRuns?'the two runs’':'the run’s'} answers, ${range[0]} to ${range[1]}; no allowed values are declared for this field.${whole&&range[1]-range[0]<=100?'':' The scores are not a scale of whole numbers, so Gwet’s AC1 and AC2 are not given.'}`:'';
   }
  }
 }else{
  // Categories: the values a run gives anywhere are real categories (a run that answers "none" keeps it); with two
  // columns, the words both use ("none", "unknown"), but never a code such as "NA" or "-". Any other missing-value
  // marker ("NA" in a coder's column) is left out of the comparison.
  const values=(list:string[])=>new Set(list.filter(Boolean).map(value=>normalizeLabel(value)));
  const setA=values(va),setB=values(vb);
  p.known=a.kind==='run'||b.kind==='run'?[...(a.kind==='run'?setA:[]),...(b.kind==='run'?setB:[])]:[...setA].filter(value=>setB.has(value)&&!MISSING_CODE.test(value));
  return fill(()=>false);
 }
 return fill(isMissingLabel);
}
export type LevelChoice='auto'|Level;
export const autoLevel=(p:Pairing):Level=>p.level;
export type AgreementJob={a:string[];b:string[];level:Level;allowed:string[];tolerance:number;scaleSeen?:boolean;range?:[number,number];known?:string[]};
export function agreementJob(p:Pairing,level:LevelChoice,tolerance:number):AgreementJob{
 return {a:p.a,b:p.b,level:level==='auto'?p.level:level,allowed:p.allowed,tolerance,scaleSeen:p.scaleSeen||undefined,range:p.range,known:p.known};
}
export const runJob=(job:AgreementJob,withIntervals:boolean)=>agreement(job.a,job.b,job.level,job.allowed,job.tolerance,{withIntervals,scaleSeen:job.scaleSeen,range:job.range,known:job.known});

export type StatLine={key:string;label:string;value:string;ci?:[number,number]|null;ciText?:string;help?:string};
const interval=(ci:[number,number]|null|undefined,format:(x:number)=>string)=>ci?`${format(ci[0])} to ${format(ci[1])}`:'';
// The statistics as lines to show or export. `ci` holds the intervals once they are computed.
export function statLines(stats:Agreement,ci:Agreement['ci']|undefined,unit='text'):StatLine[]{
 const levelName={nominal:'nominal',ordinal:'ordinal',interval:'interval'}[stats.level];
 const numeric=stats.weightedKappa!==null||stats.spearman!==null||stats.mae!==null;
 const line=(key:CiStat|'spearman'|'n',label:string,value:number|null,format:(x:number|null)=>string,help?:string):StatLine=>{
  const range=key==='spearman'||key==='n'?undefined:ci?.[key];
  return {key,label,value:format(value),ci:range,ciText:interval(range,x=>format(x)),help};
 };
 const lines:StatLine[]=[{key:'n',label:unit[0].toUpperCase()+unit.slice(1)+'s compared',value:stats.n.toLocaleString('en-US')}];
 lines.push(line('percentAgreement','Percent agreement',stats.percentAgreement,fmtPct,`Share of ${unit}s with exactly the same value.`));
 if(numeric&&stats.withinTolerance!==null)lines.push(line('withinTolerance',`Within ±${stats.tolerance}`,stats.withinTolerance,fmtPct,`Share of ${unit}s whose two values differ by at most the tolerance.`));
 lines.push(line('cohenKappa','Cohen’s κ',stats.cohenKappa,fmtStat,'Agreement beyond chance; every disagreement counts the same.'));
 if(stats.weightedKappaLinear!==null)lines.push(line('weightedKappaLinear','Weighted κ (linear)',stats.weightedKappaLinear,fmtStat,'Near misses on the scale count as partial agreement.'));
 if(stats.weightedKappa!==null)lines.push(line('weightedKappa','Weighted κ (quadratic)',stats.weightedKappa,fmtStat,'Large differences on the scale are penalized more heavily.'));
 lines.push(line('krippendorffAlpha',`Krippendorff’s α (${levelName})`,stats.krippendorffAlpha,fmtStat,'Agreement beyond chance at the chosen level of measurement.'));
 if(stats.gwetAC1!==null)lines.push(line('gwetAC1','Gwet’s AC1',stats.gwetAC1,fmtStat,'Agreement beyond chance; steadier than κ when one value dominates.'));
 if(stats.gwetAC2Linear!==null)lines.push(line('gwetAC2Linear','Gwet’s AC2 (linear)',stats.gwetAC2Linear,fmtStat,'AC1 with partial credit for near misses.'));
 if(stats.spearman!==null)lines.push(line('spearman','Spearman’s ρ',stats.spearman,fmtStat,'Rank correlation between the two sets of values.'));
 if(stats.meanDifference!==null)lines.push(line('meanDifference','Mean difference',stats.meanDifference,x=>fmtStat(x,2),'Average of second minus first; positive means the second source scores higher.'));
 if(stats.mae!==null)lines.push(line('mae','Mean absolute error',stats.mae,x=>fmtStat(x,2),'Average distance between the two values.'));
 return lines;
}
export type Disagreement={id:string;name:string;a:string;b:string;gap:number|null};
// compared: whether a value counts in the figures (`comparableValues`), so that a pair the figures leave out (an
// INSUFFICIENT_KNOWLEDGE, a tie, a 99 next to a scale, a value that is not a category) is not listed.
export function disagreements(p:Pairing,compared:(value:string)=>boolean=()=>true):Disagreement[]{
 const out:Disagreement[]=[];
 p.ids.forEach((id,i)=>{
  if(p.a[i]===p.b[i]||!compared(p.a[i])||!compared(p.b[i]))return;
  const gap=isNumber(p.a[i])&&isNumber(p.b[i])?Math.abs(Number(p.a[i])-Number(p.b[i])):null;
  out.push({id,name:p.names[i],a:p.rawA[i],b:p.rawB[i],gap});
 });
 // Largest differences first on a scale; otherwise in the order of the texts.
 return out.some(d=>d.gap!==null)?out.sort((x,y)=>(y.gap??0)-(x.gap??0)):out;
}
// What was left out of the comparison, in words (empty when nothing was).
export function leftOutNote(stats:Agreement,unit='text',kind:Pairing['leftOut']='marker'):string{
 if(!stats.leftOut.n)return '';
 // (Up to six values are kept: five are shown, and “…” says that there are more.)
 const quoted=(list:string[])=>list.slice(0,5).map(v=>`“${v}”`).join(', ')+(list.length>5?', …':'');
 const ties=stats.leftOut.ties||0,abstained=stats.leftOut.abstained,gave=abstained?abstained.both+abstained.one:0,other=stats.leftOut.n-ties-gave;
 const why=stats.leftOut.range?`not a number on the scale ${stats.leftOut.range[0]} to ${stats.leftOut.range[1]}`:kind==='value'?'not one of the field’s allowed values':kind==='number'?'not a number':'a missing-value marker';
 return [gave?`${gave} ${unit}${gave===1?' was':'s were'} left out because ${abstained!.both===gave?(gave===1?'both models':'both models each time'):abstained!.one===gave?'one model':'a model'} answered INSUFFICIENT_KNOWLEDGE${abstained!.both&&abstained!.one?` (both models: ${abstained!.both}; one: ${abstained!.one})`:''}; agreement is computed on the ${unit}s both judged.`:'',
  ties?`${ties} ${unit}${ties===1?' was':'s were'} left out because the annotations tied, with no majority: ${quoted(stats.leftOut.tiedValues||[])}.`:'',
  other?`${other} ${unit}${other===1?' was':'s were'} left out because a value was ${why}: ${quoted(stats.leftOut.values)}.`:''].filter(Boolean).join(' ');
}
// The comparison as a table for a CSV file.
export function agreementTable(title:{a:string;b:string;field:string;dataset:string;basis?:string},stats:Agreement,ci:Agreement['ci']|undefined,unit='text'):(string|number)[][]{
 const rows:(string|number)[][]=[['statistic','value','ci95_low','ci95_high'],['data',title.dataset,'',''],['first_source',title.a,'',''],['second_source',title.b,'',''],['field',fieldLabel(title.field),'',''],['level',stats.level,'',''],...(title.basis?[['scale_or_categories',title.basis,'','']]:[])];
 const raw:[string,number|null,CiStat|undefined][]=[[unit+'s_compared',stats.n,undefined],['percent_agreement',stats.percentAgreement,'percentAgreement'],['within_tolerance_'+stats.tolerance,stats.withinTolerance,'withinTolerance'],['cohen_kappa',stats.cohenKappa,'cohenKappa'],['weighted_kappa_linear',stats.weightedKappaLinear,'weightedKappaLinear'],['weighted_kappa_quadratic',stats.weightedKappa,'weightedKappa'],['krippendorff_alpha',stats.krippendorffAlpha,'krippendorffAlpha'],['gwet_ac1',stats.gwetAC1,'gwetAC1'],['gwet_ac2_linear',stats.gwetAC2Linear,'gwetAC2Linear'],['spearman_rho',stats.spearman,undefined],['pearson_r',stats.pearson,undefined],['mean_difference',stats.meanDifference,'meanDifference'],['mean_absolute_error',stats.mae,'mae']];
 for(const [name,value,key] of raw){if(value===null)continue;const range=key?ci?.[key]:undefined;rows.push([name,value,range?range[0]:'',range?range[1]:'']);}
 rows.push([unit+'s_left_out',stats.leftOut.n,'','']);
 if(stats.leftOut.abstained)rows.push([unit+'s_left_out_both_insufficient_knowledge',stats.leftOut.abstained.both,'',''],[unit+'s_left_out_one_insufficient_knowledge',stats.leftOut.abstained.one,'','']);
 rows.push([],['confusion_matrix: rows = '+title.a+', columns = '+title.b]);
 rows.push(['',...stats.categories]);
 for(const row of stats.categories)rows.push([row,...stats.categories.map(column=>stats.confusion[row]?.[column]??0)]);
 return rows;
}
export {pickField};
