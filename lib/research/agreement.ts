// Pair two sources of labels for the same texts (a run's answers, or a column
// of human labels) and describe how far they agree. The statistics themselves
// are in metrics.ts.
import {agreement,fmtPct,fmtStat,type Agreement,type CiStat,type Level} from './metrics';
import {normalizeLabel} from './normalize';
import {rowForRun,type Row} from './runs';
import {cellOf,columnIndex,type Column} from './columns';
import {fieldLabel,fieldsOf,pickField,sourceResult,valueOf,type CompareSource} from './fields';
import {fieldSpec,type FieldType} from '../answer-types';
import {onScale,scalePoints,scaleText,type ScoreScale} from './score-scale';

export const sourceLabel=(source:CompareSource)=>source.kind==='run'?'Run #'+source.run+(source.rep?' · annotation '+source.rep:''):source.name;
// The answer fields a run recorded; a column has none.
export const sourceFields=(rows:Row[],source:CompareSource)=>source.kind==='run'?fieldsOf(rows.map(row=>rowForRun(row,source.run))):[];
// One value per text, in the order of `rows`; '' where the source has none.
export function sourceValues(rows:Row[],columns:Column[],source:CompareSource,field:string):string[]{
 if(source.kind==='column'){const index=columnIndex(columns,source.name);return rows.map(row=>cellOf(row,index).trim());}
 return rows.map(row=>{const result=sourceResult(row,source);return result.status==='done'?valueOf(result,field).trim():'';});
}
const isNumber=(value:string)=>value!==''&&!Number.isNaN(Number(value));
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
// A plain-text run's value whose numbers are read on the study's scale for scores: mostly numbers, mostly on it.
function onStudyScale(values:string[],scale:ScoreScale):boolean{
 const given=values.filter(Boolean),numbers=numbersOf(given);
 return numbers.length>0&&numbers.length*2>=given.length&&onScale(numbers,scale);
}
const byNumber=(values:string[])=>[...new Set(values)].sort((x,y)=>Number(x)-Number(y));
// `allowed`: the field's own values (a scale's points or its categories), when a run declared them. `scaleSeen`:
// numbers with no declared scale, whose scale is read from the answers (`range`). `known`: categories with none
// declared. `basis` says in words what the scale or the categories rest on. `scale`: the study's scale for the
// scores of plain-text runs (never sent to the model), used when every run compared is a plain-text run whose
// values for the field mostly lie on it.
export type Pairing={ids:string[];names:string[];a:string[];b:string[];rawA:string[];rawB:string[];onlyA:number;onlyB:number;numeric:boolean;level:Level;allowed:string[];scaleSeen:boolean;range?:[number,number];known?:string[];leftOut:'marker'|'number'|'value';basis:string;studyScale?:ScoreScale};
export function pairSources(rows:Row[],columns:Column[],a:CompareSource,fieldA:string,b:CompareSource,fieldB:string,scale?:ScoreScale):Pairing{
 const va=sourceValues(rows,columns,a,fieldA),vb=sourceValues(rows,columns,b,fieldB);
 const specA=a.kind==='run'?runSpec(rows,a.run,fieldA):undefined,specB=b.kind==='run'?runSpec(rows,b.run,fieldB):undefined;
 const typed=[specA,specB].filter((spec):spec is Typed=>Boolean(spec)&&spec!.type!=='text'),twoRuns=a.kind==='run'&&b.kind==='run';
 // One type for the comparison: a single typed run, or two runs that gave the field the same type.
 const type=typed.length&&typed.every(spec=>spec.type===typed[0].type)?typed[0].type:undefined;
 // A yes / no field also reads 1 and 0, y and n, and ja and nej (in a coder's column, or in a run without the type).
 const yesNo=type==='boolean',read=(value:string)=>normalizeLabel(value,yesNo);
 const p:Pairing={ids:[],names:[],a:[],b:[],rawA:[],rawB:[],onlyA:0,onlyB:0,numeric:false,level:'nominal',allowed:[],scaleSeen:false,leftOut:'marker',basis:''};
 rows.forEach((row,i)=>{
  if(va[i]&&!vb[i])p.onlyA++;else if(vb[i]&&!va[i])p.onlyB++;
  if(!va[i]||!vb[i])return;
  p.ids.push(row.id);p.names.push(String(row.name??''));p.rawA.push(va[i]);p.rawB.push(vb[i]);p.a.push(read(va[i]));p.b.push(read(vb[i]));
 });
 const answers=a.kind==='run'||b.kind!=='run'?p.a:p.b,labels=answers===p.a?p.b:p.a,answersAll=answers===p.a?va:vb;
 // The values every typed run allowed; none when a typed run named none, so the scale or the categories are then read from the answers.
 const lists=typed.map(spec=>spec.values.map(value=>normalizeLabel(value)).filter(Boolean)),declared=type&&lists.every(list=>list.length>=2)?[...new Set(lists.flat())]:[];
 if(type==='boolean'){
  p.allowed=['false','true'];p.leftOut='value';p.basis='A yes / no field: 1 and 0, y and n, and ja and nej are read as yes and no.';
  return p;
 }
 if(type==='number'){
  // Numbers with no scale: compared at the interval level; Gwet's coefficients need a fixed scale and are not given.
  p.numeric=true;p.level='interval';p.leftOut='number';p.basis='A number field has no fixed scale, so Gwet’s AC1 and AC2 are not given.';
  return p;
 }
 if(type==='category'&&declared.length&&(!twoRuns||typed.length===2)){
  p.allowed=declared;p.leftOut='value';p.basis=`Categories: the field’s ${declared.length} allowed values.`;
  return p;
 }
 // The study's scale for the scores of plain-text runs: when every run compared is one, with its values on it.
 const runs=[[a,va],[b,vb]].filter(([source])=>(source as CompareSource).kind==='run') as [{kind:'run';run:number},string[]][];
 const studyScale=scale&&!type&&runs.length>0&&runs.every(([source,values])=>plainRun(rows,source.run)&&onStudyScale(values,scale))?scale:undefined;
 // Numbers: a declared scale, or every answer of the run is a number, and so are most of the labels it is compared with.
 p.numeric=type==='ordinal'||Boolean(studyScale)||(type!=='category'&&answers.length>0&&answers.every(isNumber)&&labels.filter(isNumber).length*2>labels.length);
 if(p.numeric&&studyScale){
  // As an ordinal field's allowed values: every point counts, and a number off the scale is left out and reported.
  p.level='ordinal';p.allowed=scalePoints(studyScale);p.studyScale=studyScale;
  p.basis=`Scale: the scale set for the scores, ${scaleText(studyScale)} (not sent to the model).`;
 }else if(p.numeric){
  p.level='ordinal';
  // The range of the answers is read from every answer of the run, not only the paired ones.
  const seen=numbersOf(answersAll);
  if(type==='ordinal'&&declared.length){
   const points=declared.map(Number),lo=Math.min(...points),hi=Math.max(...points);
   // A second run without the type may answer beyond the scale: it is widened by those whole numbers so that no
   // answer is left out, and keeps its own ends as the range (which sets its midpoint).
   const other=twoRuns&&typed.length===1?numbersOf(specA?vb:va):[],extra:string[]=[];
   if(other.length){const from=Math.floor(Math.min(...other)),to=Math.ceil(Math.max(...other));if(Math.max(hi,to)-Math.min(lo,from)<=100){for(let x=from;x<lo;x++)extra.push(String(x));for(let x=hi+1;x<=to;x++)extra.push(String(x));}}
   p.allowed=byNumber([...declared,...extra]);if(extra.length)p.range=[lo,hi];
   p.basis=`Scale: the field’s allowed values, ${lo} to ${hi}${extra.length?`, extended to ${p.allowed[0]} to ${p.allowed.at(-1)} because the run without allowed values answered beyond them`:''}.`;
  }else{
   // Two runs: the range seen in either, so the figures do not depend on which run comes first.
   const seenBoth=twoRuns?[...seen,...numbersOf(answersAll===va?vb:va)]:seen,range:[number,number]|undefined=seenBoth.length?[Math.min(...seenBoth),Math.max(...seenBoth)]:undefined;
   p.scaleSeen=true;p.range=range;
   p.basis=range?`Scale: read from ${twoRuns?'the two runs’':'the run’s'} answers, ${range[0]} to ${range[1]}; no allowed values are declared for this field.`:'';
  }
 }else{
  // Categories: the values a run gives anywhere are real categories (a run that answers "none" keeps it); with two
  // columns, the words both use ("none", "unknown"), but never a code such as "NA" or "-". Any other missing-value
  // marker ("NA" in a coder's column) is left out of the comparison.
  const values=(list:string[])=>new Set(list.filter(Boolean).map(value=>normalizeLabel(value)));
  const setA=values(va),setB=values(vb);
  p.known=a.kind==='run'||b.kind==='run'?[...(a.kind==='run'?setA:[]),...(b.kind==='run'?setB:[])]:[...setA].filter(value=>setB.has(value)&&!MISSING_CODE.test(value));
 }
 return p;
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
export function disagreements(p:Pairing):Disagreement[]{
 const out:Disagreement[]=[];
 p.ids.forEach((id,i)=>{
  if(p.a[i]===p.b[i])return;
  const gap=isNumber(p.a[i])&&isNumber(p.b[i])?Math.abs(Number(p.a[i])-Number(p.b[i])):null;
  out.push({id,name:p.names[i],a:p.rawA[i],b:p.rawB[i],gap});
 });
 // Largest differences first on a scale; otherwise in the order of the texts.
 return out.some(d=>d.gap!==null)?out.sort((x,y)=>(y.gap??0)-(x.gap??0)):out;
}
// What was left out of the comparison, in words (empty when nothing was).
export function leftOutNote(stats:Agreement,unit='text',kind:Pairing['leftOut']='marker'):string{
 if(!stats.leftOut.n)return '';
 const values=stats.leftOut.values.map(v=>`“${v}”`).join(', ')+(stats.leftOut.values.length===5?', …':'');
 const why=stats.leftOut.range?`not a number on the scale ${stats.leftOut.range[0]} to ${stats.leftOut.range[1]}`:kind==='value'?'not one of the field’s allowed values':kind==='number'?'not a number':'a missing-value marker';
 return `${stats.leftOut.n} ${unit}${stats.leftOut.n===1?' was':'s were'} left out because a value was ${why}: ${values}.`;
}
// The comparison as a table for a CSV file.
export function agreementTable(title:{a:string;b:string;field:string;dataset:string;basis?:string},stats:Agreement,ci:Agreement['ci']|undefined,unit='text'):(string|number)[][]{
 const rows:(string|number)[][]=[['statistic','value','ci95_low','ci95_high'],['data',title.dataset,'',''],['first_source',title.a,'',''],['second_source',title.b,'',''],['field',fieldLabel(title.field),'',''],['level',stats.level,'',''],...(title.basis?[['scale_or_categories',title.basis,'','']]:[])];
 const raw:[string,number|null,CiStat|undefined][]=[[unit+'s_compared',stats.n,undefined],['percent_agreement',stats.percentAgreement,'percentAgreement'],['within_tolerance_'+stats.tolerance,stats.withinTolerance,'withinTolerance'],['cohen_kappa',stats.cohenKappa,'cohenKappa'],['weighted_kappa_linear',stats.weightedKappaLinear,'weightedKappaLinear'],['weighted_kappa_quadratic',stats.weightedKappa,'weightedKappa'],['krippendorff_alpha',stats.krippendorffAlpha,'krippendorffAlpha'],['gwet_ac1',stats.gwetAC1,'gwetAC1'],['gwet_ac2_linear',stats.gwetAC2Linear,'gwetAC2Linear'],['spearman_rho',stats.spearman,undefined],['pearson_r',stats.pearson,undefined],['mean_difference',stats.meanDifference,'meanDifference'],['mean_absolute_error',stats.mae,'mae']];
 for(const [name,value,key] of raw){if(value===null)continue;const range=key?ci?.[key]:undefined;rows.push([name,value,range?range[0]:'',range?range[1]:'']);}
 rows.push([unit+'s_left_out',stats.leftOut.n,'','']);
 rows.push([],['confusion_matrix: rows = '+title.a+', columns = '+title.b]);
 rows.push(['',...stats.categories]);
 for(const row of stats.categories)rows.push([row,...stats.categories.map(column=>stats.confusion[row]?.[column]??0)]);
 return rows;
}
export {pickField};
