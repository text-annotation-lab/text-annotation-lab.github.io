// Pair two sources of labels for the same texts (a run's answers, or a column
// of human labels) and describe how far they agree. The statistics themselves
// are in metrics.ts.
import {agreement,fmtPct,fmtStat,type Agreement,type CiStat,type Level} from './metrics';
import {normalizeLabel} from './normalize';
import {rowForRun,type Row} from './runs';
import {cellOf,columnIndex,type Column} from './columns';
import {fieldLabel,fieldsOf,pickField,valueOf,type CompareSource} from './view';

export const sourceLabel=(source:CompareSource)=>source.kind==='run'?'Run #'+source.run:source.name;
// The answer fields a run recorded; a column has none.
export const sourceFields=(rows:Row[],source:CompareSource)=>source.kind==='run'?fieldsOf(rows.map(row=>rowForRun(row,source.run))):[];
// One value per text, in the order of `rows`; '' where the source has none.
export function sourceValues(rows:Row[],columns:Column[],source:CompareSource,field:string):string[]{
 if(source.kind==='column'){const index=columnIndex(columns,source.name);return rows.map(row=>cellOf(row,index).trim());}
 return rows.map(row=>{const result=rowForRun(row,source.run);return result.status==='done'?valueOf(result,field).trim():'';});
}
const isNumber=(value:string)=>value!==''&&!Number.isNaN(Number(value));
export type Pairing={ids:string[];names:string[];a:string[];b:string[];rawA:string[];rawB:string[];onlyA:number;onlyB:number;numeric:boolean;range?:[number,number]};
export function pairSources(rows:Row[],columns:Column[],a:CompareSource,fieldA:string,b:CompareSource,fieldB:string):Pairing{
 const va=sourceValues(rows,columns,a,fieldA),vb=sourceValues(rows,columns,b,fieldB);
 const p:Pairing={ids:[],names:[],a:[],b:[],rawA:[],rawB:[],onlyA:0,onlyB:0,numeric:false};
 rows.forEach((row,i)=>{
  if(va[i]&&!vb[i])p.onlyA++;else if(vb[i]&&!va[i])p.onlyB++;
  if(!va[i]||!vb[i])return;
  p.ids.push(row.id);p.names.push(String(row.name??''));p.rawA.push(va[i]);p.rawB.push(vb[i]);p.a.push(normalizeLabel(va[i]));p.b.push(normalizeLabel(vb[i]));
 });
 // Numbers: every answer of the run is a number, and so are most of the labels it is compared with.
 const answers=a.kind==='run'||b.kind!=='run'?p.a:p.b,labels=answers===p.a?p.b:p.a;
 p.numeric=answers.length>0&&answers.every(isNumber)&&labels.filter(isNumber).length*2>labels.length;
 if(p.numeric){
  // The scale is read from every answer of the run, not only the paired ones.
  const all=(answers===p.a?va:vb).map(value=>normalizeLabel(value)).filter(isNumber).map(Number);
  p.range=[Math.min(...all),Math.max(...all)];
 }
 return p;
}
export type LevelChoice='auto'|Level;
export const autoLevel=(p:Pairing):Level=>p.numeric?'ordinal':'nominal';
export type AgreementJob={a:string[];b:string[];level:Level;allowed:string[];tolerance:number;scaleSeen?:boolean;range?:[number,number]};
export function agreementJob(p:Pairing,level:LevelChoice,tolerance:number):AgreementJob{
 return {a:p.a,b:p.b,level:level==='auto'?autoLevel(p):level,allowed:[],tolerance,scaleSeen:p.numeric||undefined,range:p.numeric?p.range:undefined};
}
export const runJob=(job:AgreementJob,withIntervals:boolean)=>agreement(job.a,job.b,job.level,job.allowed,job.tolerance,{withIntervals,scaleSeen:job.scaleSeen,range:job.range});

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
export function leftOutNote(stats:Agreement,unit='text'):string{
 if(!stats.leftOut.n)return '';
 const values=stats.leftOut.values.map(v=>`“${v}”`).join(', ')+(stats.leftOut.values.length===5?', …':'');
 const why=stats.leftOut.range?`not a number on the scale ${stats.leftOut.range[0]} to ${stats.leftOut.range[1]}`:'a missing-value marker';
 return `${stats.leftOut.n} ${unit}${stats.leftOut.n===1?' was':'s were'} left out because a value was ${why}: ${values}.`;
}
// The comparison as a table for a CSV file.
export function agreementTable(title:{a:string;b:string;field:string;dataset:string},stats:Agreement,ci:Agreement['ci']|undefined,unit='text'):(string|number)[][]{
 const rows:(string|number)[][]=[['statistic','value','ci95_low','ci95_high'],['data',title.dataset,'',''],['first_source',title.a,'',''],['second_source',title.b,'',''],['field',fieldLabel(title.field),'',''],['level',stats.level,'','']];
 const raw:[string,number|null,CiStat|undefined][]=[[unit+'s_compared',stats.n,undefined],['percent_agreement',stats.percentAgreement,'percentAgreement'],['within_tolerance_'+stats.tolerance,stats.withinTolerance,'withinTolerance'],['cohen_kappa',stats.cohenKappa,'cohenKappa'],['weighted_kappa_linear',stats.weightedKappaLinear,'weightedKappaLinear'],['weighted_kappa_quadratic',stats.weightedKappa,'weightedKappa'],['krippendorff_alpha',stats.krippendorffAlpha,'krippendorffAlpha'],['gwet_ac1',stats.gwetAC1,'gwetAC1'],['gwet_ac2_linear',stats.gwetAC2Linear,'gwetAC2Linear'],['spearman_rho',stats.spearman,undefined],['pearson_r',stats.pearson,undefined],['mean_difference',stats.meanDifference,'meanDifference'],['mean_absolute_error',stats.mae,'mae']];
 for(const [name,value,key] of raw){if(value===null)continue;const range=key?ci?.[key]:undefined;rows.push([name,value,range?range[0]:'',range?range[1]:'']);}
 rows.push([unit+'s_left_out',stats.leftOut.n,'','']);
 rows.push([],['confusion_matrix: rows = '+title.a+', columns = '+title.b]);
 rows.push(['',...stats.categories]);
 for(const row of stats.categories)rows.push([row,...stats.categories.map(column=>stats.confusion[row]?.[column]??0)]);
 return rows;
}
export {pickField};
