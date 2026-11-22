// The comparison report: two runs compared on every answer field both can be compared on, in one Excel
// workbook. Summary (the figures with 95% intervals, also on the texts where at least one run gave a score other
// than 0), a draft sentence per field, every compared pair ordered for expert review, the same figures per group of
// a column (optional), the two runs' settings, a table of the values per field, and notes on how to read them.
// The pairing and the statistics are those of Runs & agreement.
import {agreementJob,pairSources,runJob,type AgreementJob,type Pairing} from './agreement';
import {cellOf,columnIndex} from './columns';
import {explanationOf,runLines,unitOf,type Dataset,type RunLine} from './export';
import {requestLines} from './export-data';
import {comparableFields,intervalsHere,textsOfRun,type Intervals} from './export-agreement';
import {hashOf,promptHashes,runFacts,type Table} from './export-tables';
import {defaultOutputLimit} from '../request-settings';
import {buildWorkbook,type Sheet} from './export-workbook';
import {BOOTSTRAP_RESAMPLES,isTie,type Agreement,type CiStat} from './metrics';
import {rowForRun,runState,type Row} from './runs';
import {fieldLabel,valueOf} from './view';
import {scaleText} from './score-scale';

export type ReportOptions={tolerance:number;groupBy?:string;intervals?:Intervals;onProgress?:(note:string)=>void;now?:Date};
type Cells=Record<string,string|number|null>;
type Stats=Agreement;

const isNum=(value:string)=>value.trim()!==''&&!Number.isNaN(Number(value));
const r4=(x:number|null|undefined)=>x===null||x===undefined||!Number.isFinite(x)?null:Math.round(x*10000)/10000;
const count=(n:number)=>n.toLocaleString('en-US');
// A table from rows of named cells: the columns in the order they first appear (a figure that cannot be computed
// for any row has no column).
function tableOf(rows:Cells[],order?:string[]):Table{
 const header=order||[...new Set(rows.flatMap(row=>Object.keys(row)))];
 return [header,...rows.map(row=>header.map(key=>row[key]??''))];
}
// A fixed number in [0, 1) made from a text (FNV-1a), so a random draw from the Review sheet is the same every time.
export function stableRandom(text:string):number{
 let h=0x811c9dc5;
 for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),0x01000193);
 return Math.round(((h>>>0)/4294967296)*1e6)/1e6;
}
// The explanation a run gave for a field: the field's own (tone_explanation), its group's (tone for tone_valence),
// the run's single explanation, or the explanation of a plain score.
function explanationFor(result:Row,field:string):string{
 const group=field.includes('_')?field.slice(0,field.lastIndexOf('_')):'';
 for(const name of ['explanation','reasoning']){
  for(const key of [...(field?[`${field}_${name}`]:[]),...(group?[`${group}_${name}`]:[]),name]){const value=valueOf(result,key);if(value)return value;}
 }
 return explanationOf(result);
}

const pct=(x:number|null)=>x===null?'—':`${(x*100).toFixed(1)}%`;
// A number for the draft text: 2 decimals, or more when that would show a value that is not 0 as 0.00 (so an
// interval that excludes 0 never reads as touching it), with a real minus sign.
const num2=(x:number|null)=>{
 if(x===null)return '—';
 let d=2;
 while(d<4&&x!==0&&Math.abs(x)<0.5*10**-d)d++;
 return x.toFixed(d).replace(/^-(0\.0+)$/,'$1').replace(/^-/,'−');
};
// A draft sentence for a paper on how well two runs agree on one field.
export function comparisonSentence(label:string,a:string,b:string,s:Stats,nBoth:number,unit='text'):string{
 const many=unit+'s';
 if(!s.n)return `No ${many} had a usable value for ${label} in both runs.`;
 const ciP=(k:CiStat)=>s.ci[k]?` (95% CI ${pct(s.ci[k]![0])}–${pct(s.ci[k]![1])})`:'';
 const ciN=(k:CiStat)=>s.ci[k]?` [${num2(s.ci[k]![0])}, ${num2(s.ci[k]![1])}]`:'';
 // (Sent: a request whose answer failed counts there too, so “annotated” would claim too much.)
 const n=`N = ${count(s.n)}${s.n<nBoth?` of ${count(nBoth)} ${many} sent in both runs`:''}`;
 if(s.meanDifference===null)return `For ${label}, ${a} and ${b} gave the same label for ${pct(s.percentAgreement)} of ${many}${ciP('percentAgreement')}; Cohen’s κ = ${num2(s.cohenKappa)}${ciN('cohenKappa')}, Krippendorff’s α = ${num2(s.krippendorffAlpha)}${ciN('krippendorffAlpha')} (${n}).`;
 const within=s.tolerance>0&&s.withinTolerance!==null?` and scores within ${s.tolerance} point${s.tolerance===1?'':'s'} for ${pct(s.withinTolerance)}${ciP('withinTolerance')}`:'';
 const serious=` Scores differed by 2 or more points for ${pct(s.largeDifference)} of ${many}${s.oppositeDirection!==null?` and in direction for ${pct(s.oppositeDirection)}`:''}.`;
 const kappa=s.weightedKappaLinear!==null?`linear-weighted κ = ${num2(s.weightedKappaLinear)}${ciN('weightedKappaLinear')}, `:'';
 const ac2=s.gwetAC2Linear!==null?`linear-weighted Gwet’s AC2 = ${num2(s.gwetAC2Linear)}${ciN('gwetAC2Linear')}, `:'';
 const first=`For ${label}, ${a} and ${b} gave identical scores for ${pct(s.percentAgreement)} of ${many}${ciP('percentAgreement')}${within}; ${kappa}${ac2}Krippendorff’s α (${s.level}) = ${num2(s.krippendorffAlpha)}${ciN('krippendorffAlpha')} (${n}).`;
 const d=s.meanDifference,ci=s.ci.meanDifference;
 const shift=ci&&(ci[0]>0||ci[1]<0)
  ?` ${b} scored on average ${num2(Math.abs(d))} points ${d>0?'higher':'lower'} than ${a} (95% CI ${num2(ci[0])} to ${num2(ci[1])}).`
  :ci?` There was no clear systematic difference between the two (mean difference ${num2(d)}, 95% CI ${num2(ci[0])} to ${num2(ci[1])}).`
  :` The mean difference was ${num2(d)}; with fewer than 10 ${many}, no interval was computed to test for a systematic difference.`;
 return first+serious+shift;
}
// The same figures on the texts where at least one run gave a score other than 0.
function nonZeroSentence(s:Stats,unit:string):string{
 if(!s.n)return `No ${unit} received a non-zero score from either run.`;
 return `On the ${count(s.n)} ${unit}s where at least one run gave a non-zero score, exact agreement was ${pct(s.percentAgreement)}${s.weightedKappaLinear!==null?`, linear-weighted κ = ${num2(s.weightedKappaLinear)}`:''}${s.gwetAC2Linear!==null?` and AC2 = ${num2(s.gwetAC2Linear)}`:''}.`;
}

// Categories in the Review sheet, in the order the sheet is sorted by.
const RANK:Record<string,number>={'tie (no majority)':5,'opposite direction':0,'2+ points':1,differ:1,'between 1 and 2 points':2,'1 point':2,'less than 1 point':2,agree:3,'agree (non-zero)':3,'agree (zero)':4,'not on the scale':5,'not a number':5,'not a category':5};

// The sheets of the report (also used by the tests, which read them without Excel).
export async function comparisonSheets(dataset:Dataset,first:number,second:number,options:ReportOptions):Promise<Sheet[]>{
 const unit=unitOf(dataset),many=unit+'s',Many=unit[0].toUpperCase()+unit.slice(1)+'s',intervals=options.intervals||intervalsHere,tolerance=Math.max(0,options.tolerance);
 const lines=runLines(dataset),runA=lines.find(run=>run.number===first),runB=lines.find(run=>run.number===second);
 if(!runA||!runB)throw new Error('Both runs must have results.');
 const all=requestLines(dataset),factsA=runFacts(dataset,runA,all),factsB=runFacts(dataset,runB,all);
 const fieldsB=new Set(comparableFields(dataset,second)),fields=comparableFields(dataset,first).filter(field=>fieldsB.has(field));
 // The texts sent in both runs (with a usable or a failed answer in each).
 const sentB=new Set(textsOfRun(dataset,second).map(row=>row.id)),both=textsOfRun(dataset,first).filter(row=>sentB.has(row.id));
 const name=(run:RunLine)=>`${run.model} (run #${run.number})`;
 const ciOf=async(job:AgreementJob,stats:Stats):Promise<Stats>=>({...stats,ci:stats.n>=10?await intervals(job):{}});
 const subset=(p:Pairing,keep:(i:number)=>boolean):Pairing=>{const at=p.ids.map((_,i)=>i).filter(keep);return {...p,ids:at.map(i=>p.ids[i]),names:at.map(i=>p.names[i]),a:at.map(i=>p.a[i]),b:at.map(i=>p.b[i]),rawA:at.map(i=>p.rawA[i]),rawB:at.map(i=>p.rawB[i])};};

 // Per field: the texts with a usable value in both runs, compared as in Runs & agreement.
 const compared:{field:string;p:Pairing;all:Stats;nonZero:Stats|null}[]=[];
 for(const [i,field] of fields.entries()){
  options.onProgress?.(`field ${i+1} of ${fields.length}`);
  const p=pairSources(both,dataset.columns,{kind:'run',run:first},field,{kind:'run',run:second},field,dataset.scoreScale);
  const job=agreementJob(p,'auto',tolerance),all=await ciOf(job,runJob(job,false));
  // Shared zeros (“no evaluation” from both runs) raise agreement: also report the texts where at least one run is
  // not 0, when some texts got 0 from both.
  const zeroOnScale=all.meanDifference!==null&&(p.allowed.includes('0')||p.a.includes('0')||p.b.includes('0'));
  const nz=subset(p,i=>p.a[i]!=='0'||p.b[i]!=='0');
  const nonZero=zeroOnScale&&nz.ids.length<p.ids.length?await (async()=>{const j=agreementJob(nz,'auto',tolerance);return ciOf(j,runJob(j,false));})():null;
  compared.push({field,p,all,nonZero});
 }

 const tolName=`within_${tolerance}_point${tolerance===1?'':'s'}`;
 const withCi=(label:string,s:Stats,key:CiStat,value:number|null):Cells=>value===null?{}:{[label]:r4(value),[`${label}_ci_low`]:r4(s.ci[key]?.[0]),[`${label}_ci_high`]:r4(s.ci[key]?.[1])};
 const summaryRow=(label:string,texts:string,s:Stats,inBoth:number):Cells=>({
  field:label,texts,level:s.level,n_compared:s.n,n_texts_in_both_runs:inBoth,
  ...(s.leftOut.n?{n_left_out_not_on_scale:s.leftOut.n}:{}),
  ...withCi('exact_agreement',s,'percentAgreement',s.percentAgreement),
  ...(tolerance>0?withCi(tolName,s,'withinTolerance',s.withinTolerance):{}),
  ...withCi('differ_2_or_more_points',s,'largeDifference',s.largeDifference),
  ...withCi('opposite_direction',s,'oppositeDirection',s.oppositeDirection),
  ...withCi('weighted_kappa_linear',s,'weightedKappaLinear',s.weightedKappaLinear),
  ...withCi('weighted_kappa_quadratic',s,'weightedKappa',s.weightedKappa),
  ...withCi('krippendorff_alpha',s,'krippendorffAlpha',s.krippendorffAlpha),
  ...withCi('cohen_kappa',s,'cohenKappa',s.cohenKappa),
  ...withCi('gwet_ac2_linear',s,'gwetAC2Linear',s.gwetAC2Linear),
  ...withCi('gwet_ac1',s,'gwetAC1',s.gwetAC1),
  ...withCi('mean_difference_second_minus_first',s,'meanDifference',s.meanDifference),
  ...withCi('mean_absolute_difference',s,'mae',s.mae),
  ...(s.spearman!==null?{spearman_rho:r4(s.spearman)}:{}),
 });
 const sheets:Sheet[]=[];
 sheets.push({name:'Summary',table:tableOf(compared.flatMap(({field,all,nonZero})=>[summaryRow(fieldLabel(field),'all',all,both.length),...(nonZero?[summaryRow(fieldLabel(field),'at least one non-zero',nonZero,both.length)]:[])])),frozen:2});
 sheets.push({name:'Draft text',table:tableOf(compared.map(({field,all,nonZero})=>({field:fieldLabel(field),draft_text:comparisonSentence(fieldLabel(field),name(runA),name(runB),all,both.length,unit)+(nonZero?' '+nonZeroSentence(nonZero,unit):'')}))),prose:column=>column==='draft_text'});

 // Every compared pair, ordered for expert review: opposite directions first, then the largest differences.
 const groupAt=options.groupBy?columnIndex(dataset.columns,options.groupBy):-1,groupBy=groupAt>=0?options.groupBy!:'';
 const groupOf=(row:Row)=>groupAt>=0?cellOf(row,groupAt).trim():'';
 const byId=new Map(both.map(row=>[row.id,row]));
 const review=compared.flatMap(({field,p,all})=>{
  const numeric=all.meanDifference!==null;
  // Pairs left out of the statistics (n_left_out_not_on_scale) are not in their table of values.
  const onNumbers=numeric||p.scaleSeen||all.level!=='nominal'||(p.allowed.length>0&&p.allowed.every(isNum));
  return p.ids.map((id,i)=>{
   const x=p.a[i],y=p.b[i],row=byId.get(id)!;
   const leftOut=all.leftOut.n>0&&!all.confusion[x]?.[y];
   const diff=numeric&&!leftOut?Number(y)-Number(x):null,mid=all.midpoint;
   const opposite=numeric&&!leftOut&&mid!==null&&((Number(x)<mid&&Number(y)>mid)||(Number(x)>mid&&Number(y)<mid));
   // By the size of the difference, as in the Summary. Combined answers from an even number of annotations can be
   // half points: 0.5 is “less than 1 point”, 1.5 “between 1 and 2 points”.
   const size=diff===null?null:Math.abs(diff);
   const category=leftOut&&(isTie(x)||isTie(y))?'tie (no majority)':leftOut?(!onNumbers?'not a category':isNum(x)&&isNum(y)?'not on the scale':'not a number')
    :x===y?(numeric?(Number(x)===0?'agree (zero)':'agree (non-zero)'):'agree')
    :opposite?'opposite direction'
    :size===null?'differ'
    :size>=2-1e-9?'2+ points':size>1+1e-9?'between 1 and 2 points':size>=1-1e-9?'1 point':'less than 1 point';
   return {group:groupOf(row),cells:{
    file:String(row.name??''),field:fieldLabel(field),
    ...(groupBy?{['\u0000group']:groupOf(row)}:{}),
    // A value that is not a number (left out): as the run wrote it.
    first:numeric?(isNum(x)?Number(x):p.rawA[i]):x,second:numeric?(isNum(y)?Number(y):p.rawB[i]):y,
    difference:diff,category,
    first_explanation:explanationFor(rowForRun(row,first),field),second_explanation:explanationFor(rowForRun(row,second),field),
    // Sort by category, then by this column, to draw a reproducible random selection within a category.
    random:stableRandom(`${row.name??row.id}|${field}`),judgment:'',note:'',
   } as Cells};
  });
 });
 review.sort((p,q)=>RANK[String(p.cells.category)]-RANK[String(q.cells.category)]||Math.abs(Number(q.cells.difference??0))-Math.abs(Number(p.cells.difference??0)));

 // Exploratory: the same figures per group (for example per decade); small groups give wide intervals.
 const groups=groupBy?[...new Set(both.map(groupOf))].sort((p,q)=>p.localeCompare(q,undefined,{numeric:true})):[];
 const byGroup:Cells[]=[];
 for(const [i,{field,p}] of compared.entries()){
  if(groups.length)options.onProgress?.(`by ${groupBy}, field ${i+1} of ${compared.length}`);
  for(const g of groups){
   const sub=subset(p,k=>groupOf(byId.get(p.ids[k])!)===g),job=agreementJob(sub,'auto',tolerance),s=await ciOf(job,runJob(job,false));
   const {field:label,...rest}=summaryRow(fieldLabel(field),'',s,both.filter(row=>groupOf(row)===g).length);
   delete rest.texts;
   byGroup.push({field:label,['\u0000group']:g||'(none)',...rest});
  }
 }
 // A group column named like one of the report's own columns gets a prefix, so neither overwrites the other.
 const own=new Set([...review.flatMap(r=>Object.keys(r.cells)),...byGroup.flatMap(r=>Object.keys(r))]);
 const groupColumn=own.has(groupBy)?`group_${groupBy}`:groupBy;
 const named=(cells:Cells)=>Object.fromEntries(Object.entries(cells).map(([key,value])=>[key==='\u0000group'?groupColumn:key,value]));
 sheets.push({name:'Review',table:tableOf(review.map(r=>named(r.cells))),frozen:2,numbers:column=>column==='first'||column==='second',prose:column=>column.endsWith('_explanation')});
 if(groupBy)sheets.push({name:`By ${groupBy}`,table:tableOf(byGroup.map(named)),frozen:2});

 // The two runs' settings, side by side.
 const hashes=await promptHashes(dataset),removedIn=(run:number)=>textsOfRun(dataset,run).filter(row=>row.removedAt).length,removed=removedIn(first)+removedIn(second)>0;
 const settings=(run:RunLine,facts:ReturnType<typeof runFacts>):Record<string,string>=>{
  const state=runState(dataset.rows,run),unfinished=state==='running'?'not finished: it was still running':state==='submitted'?'not finished: its batch was still being processed':'';
  return {
   run:`#${run.number}${run.label?` (${run.label})`:''}`,provider:run.provider||'',model:run.model||'',model_reported_by_api:facts.models.join(', '),
   effort:run.effort||'model default',max_output_tokens:String(run.maxOutput??defaultOutputLimit(run.provider,run.model,run.startedAt)),
   prompt_version:`v${run.promptVersion} (${hashOf(hashes,run.prompt,run.system)})`,
   mode:facts.processing==='batch'?'batch API':facts.processing==='instant and batch'?'immediate requests and batch API':'immediate requests',
   started:run.startedAt||'',status:unfinished||state,texts_in_run:String(facts.texts-removedIn(run.number)),texts_with_results:String(facts.texts-facts.active),
   ...(removed?{texts_removed_from_study_since:String(removedIn(run.number))}:{}),
   annotations_per_text:String(run.repeats||1),
  };
 };
 const sa=settings(runA,factsA),sb=settings(runB,factsB);
 sheets.push({name:'Runs',table:tableOf(Object.keys(sa).map(key=>({setting:key,first:sa[key],second:sb[key]})),['setting','first','second'])});

 // A table of the values per field (rows: the first run, columns: the second); not for long scales.
 for(const {field,all} of compared){
  if(all.categories.length<2||all.categories.length>15)continue;
  const corner='first \\ second';
  sheets.push({name:`Table ${fieldLabel(field)}`,table:tableOf(all.categories.map(row=>({[corner]:row,...Object.fromEntries(all.categories.map(column=>[column,all.confusion[row]?.[column]??0]))})),[corner,...all.categories]),numbers:column=>column===corner});
 }

 const date=(options.now||new Date()).toISOString().slice(0,10);
 const unfinished=(run:RunLine)=>{const state=runState(dataset.rows,run);return state==='running'||state==='submitted'?[{note:`Run #${run.number} was not finished when this report was made (${state==='running'?'it was still running':'its batch was still being processed'}): the figures are those of its results so far and may change once it is done.`}]:[];};
 const plain=compared.some(({p})=>p.scaleSeen),scaled=compared.find(({p})=>p.studyScale)?.p.studyScale;
 const notes:Cells[]=[
  {note:`Exported on ${date}.`},
  {note:`First: ${name(runA)}. Second: ${name(runB)}. ${Many} compared: those with a usable value for the field in both runs. n_texts_in_both_runs: ${many} sent in both runs, including those whose request failed in one (no usable answer).`},
  ...unfinished(runA),...unfinished(runB),
  {note:`Exact agreement: share of ${many} with the same value.${tolerance>0?` Within ${tolerance} point${tolerance===1?'':'s'}: share whose scores differ by at most that much.`:''} Differ by 2 or more points and opposite direction (one below the middle of the scale, the other above): serious disagreements.`},
  {note:`“At least one non-zero” rows repeat the statistics on ${many} where at least one run gave a score other than 0, because many shared zeros raise exact agreement and Gwet’s AC1 and AC2. The subset is chosen by the scores themselves, so read these rows as descriptive.`},
  {note:`Weighted kappa (linear or quadratic weights by the distance between values over the field’s scale${scaled?`; for the scores in plain-text replies, over the scale set for them, ${scaleText(scaled)}`:''}${plain?'; for scores with no declared scale, over the range of scores seen in either run':''}), Gwet’s AC2 (linear weights), and Krippendorff’s alpha give partial credit for near misses; Cohen’s kappa and Gwet’s AC1 treat values as categories. AC1 and AC2 stay steady when one score (such as 0) dominates, where kappa can drop sharply. AC1 and AC2 are not given for Number fields, which have no fixed scale, and unlike kappa and alpha they depend on the number of points on the scale${plain?': where the scale is read from the scores seen, a field where no text got the scale’s end points is computed over fewer points and gets a lower AC1 and AC2 than over the full scale':''}.`},
  {note:'Mean difference: second minus first (positive: the second run scores higher on average). Mean absolute difference: the average distance, whatever the direction.'},
  {note:`_ci_low and _ci_high: 95% intervals. Shares (exact agreement, within the tolerance, 2 or more points, opposite direction): Wilson score intervals. Coefficients and differences: bootstrap intervals (${count(BOOTSTRAP_RESAMPLES)} resamples of ${many}, fixed seed, so the same data gives the same interval). Fewer than 10 compared ${many}: no intervals.`},
  {note:`Review sheet: every compared score, opposite directions first, then the largest differences. Each score is in one category there, so opposite-direction rows are not also listed as “2+ points” (the Summary’s share of 2 or more points includes them). To draw at random within a category (for example 30 opposite-direction cases), sort by category and then by “random,” and take the first rows; the numbers never change, so the draw can be repeated. The judgment and note columns are for your own labels.`},
  ...(review.some(r=>RANK[String(r.cells.category)]===5)?[{note:'Review sheet, last rows: values left out of the statistics (“tie (no majority),” where a text’s annotations tied; “not a number,” such as NA; “not on the scale”; or “not a category,” such as a 0.5 median against a yes / no field), as the runs gave them.'}]:[]),
  ...(groupBy?[{note:`“By ${groupBy}” sheet: the same figures per value of ${groupBy}; exploratory, as small groups give wide intervals.`}]:[]),
  ...(!fields.length?[{note:'The two runs have no answer field in common that can be compared (free text and explanations are not compared).'}]:[]),
 ];
 sheets.push({name:'Notes',table:tableOf(notes,['note']),prose:()=>true});
 return sheets;
}

export async function comparisonReport(dataset:Dataset,first:number,second:number,options:ReportOptions):Promise<ArrayBuffer>{
 return buildWorkbook(await comparisonSheets(dataset,first,second,options));
}
// Columns that group texts (a decade, a journal): 2 to 30 different values among the texts, not one per text.
export function groupColumns(dataset:Dataset):string[]{
 return dataset.columns.map(column=>column.name).filter(name=>{
  const at=columnIndex(dataset.columns,name),values=new Set(dataset.rows.map(row=>cellOf(row,at).trim()).filter(Boolean));
  return values.size>=2&&values.size<=30;
 });
}
