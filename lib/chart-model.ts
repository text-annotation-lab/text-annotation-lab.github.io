// Turns annotation rows into the values the results charts show.
// Pure functions only: no DOM, no storage, no network.
import {resultAnswer,type NamedAnswers} from './answer-fields';
import {explicitAnswerRules} from './answer-validation';
import {chartNumber,suggestedYear,validChartYear} from './results-chart';

export type ChartSourceRow=NamedAnswers&{
 id:string;name:string;status:string;score?:string;explanation?:string;
 prompt?:string;model?:string;effort?:string;time?:string;startedAt?:string;
 runNumber?:number;subjectId?:string;sourceId?:string;sourceName?:string;chunkIndex?:number;
 chartYear?:number|null;chartGroup?:string|null;fields?:{heading:string;value:string}[];
};
export type Field={key:string;label:string;name?:string};
export type FieldKind='scale'|'category'|'text';
/** One plotted unit: a text, a whole document (chunks combined) or a subject (runs combined). */
export type Unit={
 key:string;name:string;ids:string[];
 values:string[];numbers:(number|null)[];
 value:string;number:number|null;
 year?:number;group?:string;explanation:string;
};
export type ScaleType='sequential'|'diverging';
export type Scale={min:number;max:number;type:ScaleType;lowLabel:string;highLabel:string;source:'declared'|'prompt'|'data'|'custom'};

const ABSTAIN='INSUFFICIENT_KNOWLEDGE';

export function chartFieldList(rows:ChartSourceRow[]):Field[]{
 const done=rows.filter(row=>row.status==='done');
 const names=Array.from(new Set(done.flatMap(row=>row.answerFields||[]))).filter(name=>name.toLowerCase()!=='explanation');
 const fields:Field[]=names.map(name=>({key:'field:'+name,label:name,name}));
 if(done.some(row=>!row.answerFields?.length&&row.score?.trim()))fields.unshift({key:'score',label:'Score / category'});
 return fields;
}

export function fieldValue(row:ChartSourceRow,field:Field){
 return (field.name===undefined?(!row.answerFields?.length?row.score||'':''):resultAnswer(row,field.name)).trim();
}

function explanationOf(row:ChartSourceRow){
 const named=row.answerFields?.find(name=>name.toLowerCase()==='explanation');
 return row.explanation?.trim()||(named?resultAnswer(row,named).trim():'');
}

/** Identical prompt, model, effort and fields count as one setting. */
export function settingsKey(row:ChartSourceRow){return JSON.stringify([row.prompt??'',row.model??'',row.effort??'',row.answerFields??[]]);}

export function settingsSummary(rows:ChartSourceRow[]){
 const done=rows.filter(row=>row.status==='done');
 // The latest settings are those of the most recent result; without times, the last one in the list.
 const counts=new Map<string,{count:number;latest:string;last:number}>();
 done.forEach((row,index)=>{
  const key=settingsKey(row),stamp=row.time||row.startedAt||'',entry=counts.get(key);
  if(entry){entry.count++;if(stamp>=entry.latest){entry.latest=stamp;entry.last=index;}}else counts.set(key,{count:1,latest:stamp,last:index});
 });
 let latestKey='',latestStamp='',latestIndex=-1;
 for(const [key,{latest,last}] of counts)if(!latestKey||latest>latestStamp||latest===latestStamp&&last>latestIndex){latestKey=key;latestStamp=latest;latestIndex=last;}
 return {count:counts.size,latestKey,latestCount:counts.get(latestKey)?.count??0};
}

/** Classifies a field from its values: numbers make a scale; many long, unique answers are free text. */
export function fieldKind(values:string[]):FieldKind{
 if(values.length&&values.every(value=>chartNumber(value)!==null))return 'scale';
 const distinct=new Set(values).size,long=values.filter(value=>value.length>40).length;
 if(distinct>12&&distinct/values.length>.6)return 'text';
 if(values.length>=5&&long/values.length>.5&&distinct/values.length>.5)return 'text';
 return 'category';
}

function unitKeyOf(row:ChartSourceRow,mode:'combined'|'separate'){
 if(mode==='separate')return row.id;
 if(row.sourceId)return 'doc:'+row.sourceId;
 if(row.runNumber!==undefined&&row.subjectId)return 'subject:'+row.subjectId;
 return row.id;
}

/** A year typed in a subject field such as “Year” or “Published”, if it holds exactly one. */
function fieldYear(row:ChartSourceRow){
 const field=row.fields?.find(f=>/^(year|date|published|publication|released?|first published)\b/i.test(f.heading.trim()));
 const years=field?.value.match(/(?<!\d)[1-9]\d{3}(?!\d)/g);
 return years&&new Set(years).size===1?Number(years[0]):undefined;
}
export function suggestedRowYear(row:ChartSourceRow){
 const fromField=fieldYear(row);if(fromField!==undefined)return fromField;
 const guess=suggestedYear(row.sourceName||row.name);return guess?Number(guess):undefined;
}
export function effectiveYear(row:ChartSourceRow){
 if(row.chartYear===null)return undefined;
 if(validChartYear(row.chartYear))return row.chartYear;
 return suggestedRowYear(row);
}

/** Groups a set of rows by an explicit group, falling back to a filename rule. */
export type GroupRule='start'|'end'|`field:${string}`;
export function groupFromName(name:string,rule:GroupRule){
 const stem=name.replace(/\.[a-z][a-z0-9]{0,9}$/i,'').trim();
 if(rule==='start'){const match=/^([\p{L}]+)/u.exec(stem);return match?match[1]:'';}
 const match=/(?:^|[^\p{L}])([\p{L}]{1,12})$/u.exec(stem)||/\d([\p{L}]{1,3})$/u.exec(stem);
 return match?match[1]:'';
}

/** Picks the filename rule that splits the texts into 2–8 groups of at least 2 texts each. */
export function suggestedGroupRule(names:string[],rows:ChartSourceRow[]=[]):GroupRule|undefined{
 const byField=groupableFields(rows);if(byField.length)return `field:${byField[0]}`;
 let best:{rule:GroupRule;score:number}|undefined;
 for(const rule of ['end','start'] as GroupRule[]){
  const counts=new Map<string,number>();let missing=0;
  for(const name of names){const group=groupFromName(name,rule).toLowerCase();if(group)counts.set(group,(counts.get(group)||0)+1);else missing++;}
  if(counts.size<2||counts.size>8||missing>names.length*.1)continue;
  if(Array.from(counts.values()).some(count=>count<2))continue;
  const score=missing*10+counts.size;
  if(!best||score<best.score)best={rule,score};
 }
 return best?.rule;
}

export function suggestedRowGroup(row:ChartSourceRow,rule:GroupRule|undefined){
 if(!rule)return undefined;
 if(rule.startsWith('field:')){const heading=rule.slice(6);const value=row.fields?.find(f=>f.heading===heading)?.value.trim();return value||undefined;}
 const group=groupFromName(row.sourceName||row.name,rule as 'start'|'end');
 return group||undefined;
}
export function effectiveGroup(row:ChartSourceRow,rule:GroupRule|undefined){
 if(row.chartGroup===null)return undefined;
 if(typeof row.chartGroup==='string'&&row.chartGroup.trim())return row.chartGroup.trim();
 return suggestedRowGroup(row,rule);
}
/** Subject fields with 2–8 repeated values can define groups, e.g. “Author gender”. */
export function groupableFields(rows:ChartSourceRow[]){
 const headings=Array.from(new Set(rows.flatMap(row=>row.fields?.map(f=>f.heading)||[])));
 return headings.filter(heading=>{
  const values=rows.map(row=>row.fields?.find(f=>f.heading===heading)?.value.trim()||'').filter(Boolean);
  const distinct=new Set(values);return distinct.size>=2&&distinct.size<=8&&values.length>=rows.length*.8&&Array.from(distinct).every(v=>values.filter(x=>x===v).length>=2);
 });
}

export type ChartOptions={latestOnly:boolean;combine:boolean;groupRule?:GroupRule};

export function buildUnits(rows:ChartSourceRow[],field:Field,options:ChartOptions){
 const {latestKey,count:settingsCount}=settingsSummary(rows);
 const done=rows.filter(row=>row.status==='done'&&(!options.latestOnly||settingsCount<2||settingsKey(row)===latestKey));
 const plotted=done.filter(row=>{const value=fieldValue(row,field);return value&&value.toUpperCase()!==ABSTAIN;});
 const abstained=done.filter(row=>fieldValue(row,field).toUpperCase()===ABSTAIN).length;
 const map=new Map<string,ChartSourceRow[]>();
 for(const row of plotted){const key=unitKeyOf(row,options.combine?'combined':'separate'),list=map.get(key);if(list)list.push(row);else map.set(key,[row]);}
 const units:Unit[]=[];
 for(const [key,list] of map){
  const values=list.map(row=>fieldValue(row,field)),numbers=values.map(chartNumber);
  const numeric=numbers.every(number=>number!==null);
  let value=values[0],number=numbers[0];
  if(list.length>1){
   if(numeric){number=numbers.reduce((sum,n)=>sum!+n!,0)!/numbers.length;value=formatNumber(number);}
   else{const counts=new Map<string,number>();values.forEach(v=>counts.set(v,(counts.get(v)||0)+1));value=Array.from(counts).sort((a,b)=>b[1]-a[1])[0][0];number=null;}
  }
  const first=list[0];
  const name=first.sourceId?(first.sourceName||first.name):list.length>1||first.runNumber===undefined?first.name:first.name+(first.runNumber>1?` · Run ${first.runNumber}`:'');
  units.push({key,name,ids:list.map(row=>row.id),values,numbers,value,number,year:effectiveYear(first),group:effectiveGroup(first,options.groupRule),explanation:list.length===1?explanationOf(first):''});
 }
 const kind=fieldKind(plotted.map(row=>fieldValue(row,field)));
 const combinable=new Set(done.map(row=>unitKeyOf(row,'combined'))).size<done.length;
 return {units,kind,rows:plotted,settingsCount,excluded:rows.length-plotted.length,abstained,combinable,hasRuns:rows.some(row=>(row.runNumber||1)>1),hasChunks:rows.some(row=>Boolean(row.sourceId))};
}

export function formatNumber(value:number,digits=2){
 if(!Number.isFinite(value))return '';
 if(Math.abs(value)>=1e6||(value!==0&&Math.abs(value)<.001))return value.toExponential(2).replace('-','−');
 return new Intl.NumberFormat('en-US',{maximumFractionDigits:digits}).format(value).replace('-','−');
}

// ---------- Scale ----------

/** Finds a scale such as “1–7”, “1 to 7” or “−3 to +3” in the prompt. */
export function promptScales(prompt:string){
 const found:{min:number;max:number}[]=[];
 const pattern=/(?<!\d|\d\.)([+\-−]?\d{1,3})\s*(?:–|—|-|to)\s*([+\-−]?\d{1,3})(?!\d|\.\d|\s*%)/g;
 for(const match of prompt.matchAll(pattern)){
  const min=Number(match[1].replace('−','-')),max=Number(match[2].replace('−','-'));
  if(!Number.isInteger(min)||!Number.isInteger(max)||max<=min||max-min>20)continue;
  if(min>=1000||max>=1000)continue;
  found.push({min,max});
 }
 return found;
}

export function suggestedScale(rows:ChartSourceRow[],field:Field,numbers:number[]):Scale|undefined{
 if(!numbers.length)return undefined;
 const low=Math.min(...numbers),high=Math.max(...numbers),integers=numbers.every(Number.isInteger);
 const make=(min:number,max:number,source:Scale['source']):Scale=>({min,max,type:min<0&&max>0?'diverging':'sequential',lowLabel:'',highLabel:'',source});
 const name=field.name||'score';
 const prompts=Array.from(new Set(rows.map(row=>row.prompt||'')));
 const declared=prompts.map(prompt=>explicitAnswerRules(prompt,field.name?rows.find(row=>row.prompt===prompt)?.answerFields||[]:[]).find(rule=>rule.name===name)).filter(Boolean);
 if(declared.length===prompts.length&&declared.length){
  const first=declared[0]!;
  if(declared.every(rule=>rule!.min===first.min&&rule!.max===first.max)&&low>=first.min&&high<=first.max)return make(first.min,first.max,'declared');
 }
 if(integers){
  const candidates=prompts.flatMap(promptScales).filter(scale=>scale.min<=low&&scale.max>=high);
  if(candidates.length){
   const counts=new Map<string,number>();for(const c of candidates){const k=c.min+':'+c.max;counts.set(k,(counts.get(k)||0)+1);}
   const [key]=Array.from(counts).sort((a,b)=>b[1]-a[1])[0];const [min,max]=key.split(':').map(Number);
   return make(min,max,'prompt');
  }
  if(high-low<=20)return make(low,high,'data');
 }
 return undefined;
}

// ---------- Statistics ----------

export const mean=(values:number[])=>values.reduce((sum,value)=>sum+value/values.length,0);
export function median(values:number[]){const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;return n?n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2:NaN;}
export function sd(values:number[]){if(values.length<2)return 0;const m=mean(values);return Math.sqrt(values.reduce((sum,v)=>sum+(v-m)**2,0)/(values.length-1));}
export function mostCommon(values:string[]){
 const counts=new Map<string,number>();values.forEach(v=>counts.set(v,(counts.get(v)||0)+1));
 const sorted=Array.from(counts).sort((a,b)=>b[1]-a[1]);if(!sorted.length)return '';
 return sorted.length>1&&sorted[1][1]===sorted[0][1]?'Tie':sorted[0][0];
}
/** Two-sided 95% t quantile; exact enough for display. */
export function t95(df:number){
 const table=[12.71,4.30,3.18,2.78,2.57,2.45,2.36,2.31,2.26,2.23,2.20,2.18,2.16,2.14,2.13,2.12,2.11,2.10,2.09,2.09];
 if(df<1)return NaN;if(df<=20)return table[df-1];if(df<=30)return 2.06-(df-20)*.0016;if(df<=60)return 2.04-(df-30)*.00067;return df<=120?2.0-(df-60)*.00033:1.98;
}
export function meanInterval(values:number[]){
 const m=mean(values);if(values.length<2)return {mean:m,low:NaN,high:NaN};
 const half=t95(values.length-1)*sd(values)/Math.sqrt(values.length);return {mean:m,low:m-half,high:m+half};
}

// ---------- Time ----------

export function smoothTrend(points:{year:number;value:number}[],span:number){
 if(points.length<5)return [];
 const years=points.map(point=>point.year),first=Math.min(...years),last=Math.max(...years);
 if(last===first)return [];
 const sigma=Math.max(1,span),step=Math.max(1,(last-first)/120),out:{year:number;value:number}[]=[];
 for(let year=first;year<=last+1e-9;year+=step){
  let weights=0,sum=0;
  for(const point of points){const w=Math.exp(-((point.year-year)**2)/(2*sigma*sigma));weights+=w;sum+=w*point.value;}
  if(weights>1e-9)out.push({year,value:sum/weights});
 }
 return out;
}
export function trendWindow(years:number[]){
 // Wider with few texts, so a handful of points gives a gentle line rather than one that chases each dot.
 const first=Math.min(...years),last=Math.max(...years);return Math.max(1,(last-first)/16,1.5*(last-first)/Math.max(1,years.length));
}

export const periodLengths=[5,10,20,25,40,50,100];
export function periodsFor(years:number[],length:number){
 const first=Math.floor(Math.min(...years)/length)*length,last=Math.max(...years),periods:{start:number;end:number}[]=[];
 for(let start=first;start<=last;start+=length)periods.push({start,end:start+length-1});
 return periods;
}
/** The shortest round period with about 8 texts per period on average and at most 12 periods. */
export function suggestedPeriodLength(years:number[]){
 for(const length of periodLengths){
  const periods=periodsFor(years,length),counts=periods.map(p=>years.filter(y=>y>=p.start&&y<=p.end).length).filter(Boolean);
  if(periods.length<=12&&mean(counts)>=8)return length;
 }
 const span=Math.max(...years)-Math.min(...years);
 return periodLengths.find(length=>span/length<=6)||100;
}
