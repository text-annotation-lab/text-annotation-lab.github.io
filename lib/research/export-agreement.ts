// Agreement in the exports. A run's answers are compared with every column of human labels that belongs to one
// of its answer fields, and two label columns of the same field with each other (the human–human baseline).
// The pairing and the statistics are those of Runs & agreement (agreement.ts); here the pairs are found
// without anyone choosing them, and each column left out is listed with the reason.
import {fieldSpec,PLAIN_FIELD} from '../answer-types';
import {isExplanationKey} from '../json-reply';
import {agreementJob,oneZero,pairSources,runJob,type AgreementJob,type Pairing} from './agreement';
import {cellOf,columnIndex,type Column} from './columns';
import {unitOf,type Dataset} from './export';
import {requestLines,rowForRun} from './export-data';
import type {Table} from './export-tables';
import {isMissingLabel,type Agreement} from './metrics';
import {normalizeLabel} from './normalize';
import type {Row} from './runs';
import {fieldLabel,fieldsOf,valueOf} from './view';

// Words in a column's name that mark notes or ratings about a field, not labels for it (tone_note, tone_confidence).
const NOT_LABEL_WORDS=new Set(['explanation','explanations','reasoning','rationale','note','notes','comment','comments','memo','confidence','certainty','flag','flags']);
// Words that mark information about a text's author, not a label for the text (author_gender for a gender field).
const AUTHOR_WORDS=new Set(['author','authors']);
const fold=(name:string)=>name.trim().toLowerCase().replace(/[\s-]+/g,'_');
// What a column's name says besides a field's name ("human" in tone_human or human_tone); null when the column is
// not named after the field.
function nameRest(column:string,field:string):string|null{
 const c=fold(column),f=fold(field);
 if(!f)return null;
 if(c===f)return '';
 if(c.startsWith(f+'_'))return c.slice(f.length+1);
 if(c.endsWith('_'+f))return c.slice(0,-(f.length+1));
 return null;
}
// The texts a run sent a request for.
export function textsOfRun(dataset:Dataset,run:number):Row[]{
 const ids=new Set(requestLines(dataset).filter(line=>line.run===run).map(line=>line.row.id));
 return dataset.rows.filter(row=>ids.has(row.id));
}
// The answer fields of a run that labels can be compared with: not an explanation or another free-text field
// (every answer would be a category of its own). The reply of a plain-text run counts only when it is the
// run's single field and every reply is short, as a label is.
export function comparableFields(dataset:Dataset,run:number):string[]{
 const results=textsOfRun(dataset,run).map(row=>rowForRun(row,run)).filter(result=>result.status==='done'),fields=fieldsOf(results);
 const prose=(field:string)=>isExplanationKey(fold(field))||results.every(result=>fieldSpec(result.answerSettings,field)?.type==='text');
 return fields.filter(field=>field===PLAIN_FIELD&&results.some(result=>result.answerSettings?.plain)?fields.length===1&&results.every(result=>valueOf(result,field).length<=100):!field||!prose(field));
}
export type LabelPair={field:string;column:string};
export type Skipped={column:string;reason:string};
// Does a label fit the field: one of its allowed values, or a number on a scale? Categories that no run
// declared cannot be told from other words, so any label fits them.
function fits(label:string,p:Pairing):boolean{
 if(p.numeric){
  const x=Number(label);if(label===''||Number.isNaN(x))return false;
  // A scale read from the answers has no fixed ends: any number may be a label.
  if(p.scaleSeen)return true;
  const scale=p.allowed.map(Number).filter(Number.isFinite);
  return !scale.length||(x>=Math.min(...scale)-1e-9&&x<=Math.max(...scale)+1e-9);
 }
 return !p.allowed.length||p.allowed.includes(label);
}
// Which label columns are compared with which answer field of a run. A label column belongs to the field it
// is named after (tone, tone_human, human_tone; the longest such field), and when the run has a single field,
// to that field whatever its name. Not used: a note or rating, information about the author, a column not
// named after any field, and a column whose labels are mostly not values of the field.
export function labelPairs(dataset:Dataset,run:number):{fields:string[];pairs:LabelPair[];skipped:Skipped[]}{
 const rows=textsOfRun(dataset,run),fields=comparableFields(dataset,run),unit=unitOf(dataset),pairs:LabelPair[]=[],skipped:Skipped[]=[];
 for(const column of dataset.columns.filter(column=>column.role==='label')){
  let field:string|undefined,rest='';
  for(const candidate of fields){const more=nameRest(column.name,candidate);if(more!==null&&(field===undefined||candidate.length>field.length)){field=candidate;rest=more;}}
  if(field===undefined&&fields.length===1){field=fields[0];rest=fold(column.name);}
  if(field===undefined){skipped.push({column:column.name,reason:fields.length?'not named after an answer field':'this run has no answer field to compare labels with'});continue;}
  const words=rest.split('_').filter(Boolean),label=fieldLabel(field);
  let reason='';
  if(words.some(word=>NOT_LABEL_WORDS.has(word)))reason='a note or rating';
  else if(words.some(word=>AUTHOR_WORDS.has(word)))reason='about the author';
  else{
   const p=pairSources(rows,dataset.columns,{kind:'run',run},field,{kind:'column',name:column.name},'',dataset.scoreScale);
   // A missing-value marker (NA for a text nobody coded) is no label, unless the field has it as a value.
   const labels=p.b.filter(value=>!isMissingLabel(value)||fits(value,p));
   if(!labels.length)reason=p.ids.length||p.onlyB?`no labels for ${label} among this run’s ${unit}s with an answer`:`no labels among this run’s ${unit}s`;
   else if(labels.filter(value=>fits(value,p)).length*2<labels.length)reason=`mostly not values of ${label}`;
  }
  if(reason)skipped.push({column:column.name,reason});else pairs.push({field,column:column.name});
 }
 return {fields,pairs,skipped};
}

// Two label columns paired on a run's texts, on the scale or categories of the field they belong to (`like`:
// the field's pairing with the run's answers). As there, a missing-value marker that is not a value of the field
// (“NA” for a text nobody coded) is a blank cell: the text has no label, and is neither compared nor left out.
function columnPairing(rows:Row[],columns:Column[],first:string,second:string,like:Pairing):Pairing{
 const a=columnIndex(columns,first),b=columnIndex(columns,second),yesNo=like.allowed.length===2&&like.allowed[0]==='false'&&like.allowed[1]==='true',read=(value:string)=>yesNo?normalizeLabel(value,true):like.zeroOne?oneZero(value):normalizeLabel(value);
 const cell=(value:string)=>{const label=value?read(value):'';return label&&isMissingLabel(label)&&!fits(label,like)?'':label;};
 const p:Pairing={...like,ids:[],names:[],a:[],b:[],rawA:[],rawB:[],onlyA:0,onlyB:0};
 for(const row of rows){
  const va=cellOf(row,a).trim(),vb=cellOf(row,b).trim(),x=cell(va),y=cell(vb);
  if(x&&!y)p.onlyA++;else if(y&&!x)p.onlyB++;
  if(!x||!y)continue;
  p.ids.push(row.id);p.names.push(String(row.name??''));p.rawA.push(va);p.rawB.push(vb);p.a.push(x);p.b.push(y);
 }
 return p;
}
// source: 'model' for the run's answers, or the first of two label columns. withLabel: the run's texts with a
// value in the compared column; stats.n of them were compared.
export type AgreementLine={run:number;field:string;source:string;comparedWith:string;stats:Agreement;withLabel:number;basis:string};
// How the 95% intervals are computed: in a background worker on the page, directly elsewhere.
export type Intervals=(job:AgreementJob)=>Promise<Agreement['ci']>;
export const intervalsHere:Intervals=async job=>runJob(job,true).ci;
// Near misses within one point count as “within tolerance”, as in Runs & agreement by default.
const TOLERANCE=1;
export async function runAgreement(dataset:Dataset,run:number,intervals:Intervals=intervalsHere):Promise<{lines:AgreementLine[];pairs:LabelPair[];skipped:Skipped[]}>{
 const {pairs,skipped}=labelPairs(dataset,run),rows=textsOfRun(dataset,run),lines:AgreementLine[]=[],own=new Map<string,Pairing>();
 const line=async(field:string,source:string,comparedWith:string,p:Pairing):Promise<AgreementLine>=>{
  const job=agreementJob(p,'auto',TOLERANCE),stats=runJob(job,false);
  // Intervals need at least 10 compared texts (metrics.ts).
  return {run,field,source,comparedWith,stats:{...stats,ci:stats.n>=10?await intervals(job):{}},withLabel:p.ids.length+p.onlyB,basis:p.basis};
 };
 for(const {field,column} of pairs){
  const p=pairSources(rows,dataset.columns,{kind:'run',run},field,{kind:'column',name:column},'',dataset.scoreScale);
  if(!own.has(field))own.set(field,p);
  lines.push(await line(field,'model',column,p));
 }
 for(const [field,like] of own){
  const columns=pairs.filter(pair=>pair.field===field).map(pair=>pair.column);
  for(let i=0;i<columns.length;i++)for(let j=i+1;j<columns.length;j++)lines.push(await line(field,columns[i],columns[j],columnPairing(rows,dataset.columns,columns[i],columns[j],like)));
 }
 return {lines,pairs,skipped};
}
// The agreement figures as a table, one row per comparison.
// keyOf: the column of a line's field in the results tables (the field's name where not given).
export function agreementTable(lines:AgreementLine[],keyOf:(line:AgreementLine)=>string=line=>fieldLabel(line.field)):Table{
 // Four decimals: more would not be meaningful for a coefficient or a bootstrap interval.
 const round=(x:number)=>Math.round(x*10000)/10000,value=(x:number|null|undefined):string|number=>x===null||x===undefined||!Number.isFinite(x)?'':round(x);
 const stats=['percent_agreement','cohen_kappa','weighted_kappa_linear','weighted_kappa_quadratic','krippendorff_alpha','gwet_ac1','gwet_ac2_linear'] as const;
 const keys={percent_agreement:'percentAgreement',cohen_kappa:'cohenKappa',weighted_kappa_linear:'weightedKappaLinear',weighted_kappa_quadratic:'weightedKappa',krippendorff_alpha:'krippendorffAlpha',gwet_ac1:'gwetAC1',gwet_ac2_linear:'gwetAC2Linear'} as const;
 // Model knowledge: the abstentions left out (both models, one model), where there are any.
 const abstained=lines.some(a=>a.stats.leftOut.abstained);
 const header=['run','field','annotations','compared_with','level_of_measurement','n','n_with_label','n_left_out_not_on_scale',...(abstained?['n_both_insufficient_knowledge','n_one_insufficient_knowledge']:[]),...stats.flatMap(name=>[name,name+'_ci_low',name+'_ci_high']),'spearman_rho','pearson_r','mean_absolute_error'];
 return [header,...lines.map(a=>[a.run,keyOf(a),a.source==='model'?`model (run ${a.run})`:a.source,a.comparedWith,a.stats.level,a.stats.n,a.withLabel,a.stats.leftOut.n,...(abstained?[a.stats.leftOut.abstained?.both??0,a.stats.leftOut.abstained?.one??0]:[]),
  ...stats.flatMap(name=>{const ci=a.stats.ci[keys[name]];return [value(a.stats[keys[name]]),ci?round(ci[0]):'',ci?round(ci[1]):''];}),value(a.stats.spearman),value(a.stats.pearson),value(a.stats.mae)])];
}
