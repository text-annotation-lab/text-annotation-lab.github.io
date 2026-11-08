import {resultAnswer,type NamedAnswers} from './answer-fields';
import {explicitAnswerRules} from './answer-validation';

export type ChartRow=NamedAnswers&{id:string;name:string;status:string;score?:string;explanation?:string;runNumber?:number;prompt?:string;chartYear?:number|null;sourceName?:string};
export type ChartScale={min:number;max:number};
export type ChartField={key:string;label:string;name?:string};
export type ChartPoint={id:string;name:string;value:string;number:number|null;order:number;explanation:string;year?:number};

export function validChartYear(value:unknown):value is number {
 return typeof value==='number' && Number.isInteger(value) && value>=1000 && value<=9999;
}

export function suggestedYear(filename:string):string {
 // Match complete tokens, including years separated by underscores, but never digits inside IDs.
 const stem=filename.replace(/\.[a-z][a-z0-9]{0,9}$/i,'');
 // Abbreviated spans such as 1861–65 are ambiguous. A complete ISO date still supplies one year.
 if(/(?:^|[^\p{L}\p{N}])[1-9]\d{3}\s*[-–—]\s*\d{2}(?![\p{L}\p{N}]|-\d{2}(?:$|[^\p{L}\p{N}]))/u.test(stem))return '';
 const tokens=stem.match(/[\p{L}\p{N}]+/gu) || [];
 const years=tokens.filter(token=>/^[1-9]\d{3}$/.test(token));
 return years.length===1 ? years[0] : '';
}
export type ChartCategory={value:string;points:ChartPoint[]};

export function chartFields(rows:ChartRow[]):ChartField[]{
 const complete=rows.filter(row=>row.status==='done');
 const names=Array.from(new Set(complete.flatMap(row=>row.answerFields||[]))).filter(name=>name.toLowerCase()!=='explanation');
 const fields:ChartField[]=names.map(name=>({key:'field:'+name,label:name,name}));
 if(complete.some(row=>!row.answerFields?.length&&row.score?.trim()))fields.unshift({key:'score',label:'Score / category'});
 return fields;
}

export function chartNumber(value:string):number|null{
 // Do not turn ranges, dates, commas, percentages, or prose into scores.
 if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))return null;
 const number=Number(value);return Number.isFinite(number)?number:null;
}

export function chartData(rows:ChartRow[],field:ChartField){
 const points:ChartPoint[]=[];
 const scales:(ChartScale|undefined)[]=[],rules=new Map<string,ReturnType<typeof explicitAnswerRules>>();
 rows.forEach((row,index)=>{
  if(row.status!=='done')return;
  const value=(field.name===undefined?(!row.answerFields?.length?row.score||'':''):resultAnswer(row,field.name)).trim();
  if(!value||value.toUpperCase()==='INSUFFICIENT_KNOWLEDGE')return;
  const explanationField=row.answerFields?.find(name=>name.toLowerCase()==='explanation');
  points.push({id:row.id,name:row.name+(row.runNumber?` · Run ${row.runNumber}`:''),value,number:chartNumber(value),order:index+1,year:validChartYear(row.chartYear)?row.chartYear:undefined,explanation:row.explanation?.trim()||(explanationField?resultAnswer(row,explanationField):'')});
  const key=JSON.stringify([row.prompt,row.answerFields]);
  if(!rules.has(key))rules.set(key,explicitAnswerRules(row.prompt||'',row.answerFields||[]));
  const rule=rules.get(key)!.find(rule=>rule.name===(field.name||'score'));
  scales.push(rule?{min:rule.min,max:rule.max}:undefined);
 });
 const groups=new Map<string,ChartPoint[]>();
 for(const point of points){const group=groups.get(point.value);if(group)group.push(point);else groups.set(point.value,[point]);}
 const categories:ChartCategory[]=Array.from(groups,([value,points])=>({value,points})).sort((a,b)=>b.points.length-a.points.length||a.value.localeCompare(b.value));
 const numeric=points.length>0&&points.every(point=>point.number!==null),first=scales[0];
 // Use recorded output declarations only when every plotted result agrees.
 // Never let a newly edited prompt, an inferred scale, or a conflicting run clip results.
 const scale=numeric&&first&&scales.every(item=>item?.min===first.min&&item?.max===first.max)&&points.every(point=>point.number!>=first.min&&point.number!<=first.max)?first:undefined;
 const magnitude=points.reduce((largest,point)=>Math.max(largest,Math.abs(point.number||0)),0);
 // Normalize before summing so large finite scores cannot overflow the mean.
 const mean=numeric?(magnitude?Math.max(-1,Math.min(1,points.reduce((sum,point)=>sum+point.number!/magnitude/points.length,0)))*magnitude:0):undefined;
 return {points,categories,numeric,scale,mean,excluded:rows.length-points.length};
}

function niceStep(raw:number,integers=false){
 if(!Number.isFinite(raw)||raw<=0)return 1;
 const unit=10**Math.floor(Math.log10(raw));
 if(!unit)return Number.MIN_VALUE;
 const fraction=raw/unit,step=(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*unit;
 return integers?Math.max(1,step):step;
}

export function calendarAxis(points:ChartPoint[],left:number,right:number,width:number) {
 let first=Infinity,last=-Infinity;
 for(const point of points) {
  if(!validChartYear(point.year)) throw new Error('Review the years before plotting.');
  first=Math.min(first,point.year);last=Math.max(last,point.year);
 }
 if(!points.length) throw new Error('Add a year to at least one result.');
 const x=(year:number)=>first===last?(left+right)/2:left+(year-first)/(last-first)*(right-left);
 const step=niceStep((last-first)/(width<500?3:6),true);
 const ticks=[first];
 for(let year=Math.ceil(first/step)*step;year<last;year+=step) {
  if(year-first>=step*.65 && last-year>=step*.65) ticks.push(year);
 }
 if(last!==first) ticks.push(last);
 return {x,ticks};
}

export function numericChartLayout(points:ChartPoint[],total:number,width:number,declared?:ChartScale){
 const left=60,right=Math.max(left+100,width-22),top=24,bottom=264;
 let min=Infinity,max=-Infinity;
 for(const point of points){if(point.number!==null){min=Math.min(min,point.number);max=Math.max(max,point.number);}}
 if(!Number.isFinite(min)||!Number.isFinite(max)){min=0;max=0;}
 const integers=points.every(point=>point.number!==null&&Number.isInteger(point.number));
 if(declared&&declared.min<=min&&declared.max>=max){min=declared.min;max=declared.max;}
 const range=max-min,step=niceStep((range||Math.max(Math.abs(min),1))/6,integers);
 let lowBound=min,highBound=max;
 if(!declared||min===max){
  const padding=step/2;
  if(Number.isFinite(min-padding))lowBound=min-padding;
  if(Number.isFinite(max+padding))highBound=max+padding;
 }
 // Normalize before subtracting, so even very large finite values stay finite.
 const scale=Math.max(1,Math.abs(lowBound),Math.abs(highBound)),low=lowBound/scale,high=highBound/scale,span=high-low;
 const x=(order:number)=>total<=1?(left+right)/2:left+10+(order-1)/(total-1)*(right-left-20);
 const y=(number:number)=>span===0?(top+bottom)/2:top+(high-number/scale)/span*(bottom-top);
 const values:number[]=[];
 if(Number.isFinite(range)&&Math.abs(lowBound/step)<1e15&&Math.abs(highBound/step)<1e15){
  const start=Math.ceil(lowBound/step),end=Math.floor(highBound/step);
  for(let index=start;index<=end&&values.length<20;index++)values.push(Number((index*step).toPrecision(12)));
 }
 if(!values.length)values.push(...(min===max?[min]:Array.from({length:5},(_,i)=>min*(1-i/4)+max*(i/4))));
 // Explicit scale endpoints must remain visible even when they are not multiples of a tick step.
 if(declared){for(const endpoint of [min,max])if(!values.some(value=>Math.abs(value-endpoint)<step*.4))values.push(endpoint);}
 const ticks=values.sort((a,b)=>a-b).map(value=>({value,y:y(value)}));
 const xStep=niceStep(Math.max(1,total-1)/(width<500?3:5),true),xTicks=[1];
 for(let value=xStep;value<=total&&xTicks.length<12;value+=xStep)if(value>1)xTicks.push(value);
 if(total>1&&!xTicks.includes(total)){if(total-xTicks[xTicks.length-1]<xStep*.5&&xTicks.length>1)xTicks.pop();xTicks.push(total);}
 return {left,right,top,bottom,x,y,ticks,xTicks};
}
