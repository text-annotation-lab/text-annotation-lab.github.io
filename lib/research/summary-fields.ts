// The Results panel's view of one run (Runs & agreement): the run's texts or subjects, with their metadata and
// combined answers, and the fields it can summarize. The figures themselves are in summary.ts.
import {allowedValues,fieldSpec,isExplanationField,PLAIN_FIELD,type FieldSpec} from '../answer-types';
import {cellOf,type Column} from './columns';
import {fieldLabel,fieldsOf,valueOf} from './fields';
import {normalizeLabel,toNumber} from './normalize';
import {incomplete,requestsOf} from './repeats';
import {rowForRun,type Row} from './runs';
import {farFromZeroOne,zeroOne,type ScoreScale} from './score-scale';
import type {ComparableField,RunItem} from './summary';

// The texts of a run (also those deleted from the study but kept for it), in the study's order: the result each
// shows for the run, its metadata and label columns by name, and its combined value of a field.
export function runItems(rows:Row[],columns:Column[],run:number):RunItem[]{
 const items:RunItem[]=[];
 for(const row of rows){
  const result=rowForRun(row,run);if(result.status==='absent')continue;
  const meta:Record<string,string>={};columns.forEach((column,i)=>{meta[column.name]=cellOf(row,i);});
  const done=result.status==='done',fewer=done&&incomplete(result);
  items.push({id:row.id,status:done?(fewer?'partial':'ok'):result.status==='error'?'error':'none',fewer,meta,value:field=>done?valueOf(result,field):''});
 }
 return items;
}

const sameSet=(xs:string[],ys:string[])=>new Set(xs).size===ys.length&&xs.every(x=>ys.includes(x));
// A typed answer field (not free text), with its allowed values and the way the run wrote them.
function typedField(key:string,spec:FieldSpec):ComparableField{
 const written=spec.type==='category'||spec.type==='ordinal'?allowedValues(spec):[];
 const allowed=spec.type==='boolean'?['false','true']:written.map(value=>normalizeLabel(value)).filter(Boolean);
 const names=new Map<string,string>();for(const value of written){const k=normalizeLabel(value);if(k&&!names.has(k))names.set(k,value);}
 return {key,label:fieldLabel(key),level:spec.type==='ordinal'?'ordinal':spec.type==='number'?'interval':'nominal',allowed,names,
  // Categories that are exactly yes and no are a yes / no field too.
  yesNo:spec.type==='boolean'||(spec.type==='category'&&sameSet(allowed,['false','true']))};
}

// The fields of a run the panel can summarize: its answer fields that are not free text (with their types), and
// fields without a type whose single answers are mostly numbers (the scores in plain-text replies that are JSON, or
// in older runs). Scores are read from every single annotation, not the combined answers (a median of 1.5 must not
// make whole-number scores an interval field). `scale`: the study's scale for the scores of plain-text replies.
export function summaryFields(rows:Row[],run:number,scale?:ScoreScale):ComparableField[]{
 const results=rows.map(row=>rowForRun(row,run)).filter(result=>result.status==='done');
 const settings=results.find(result=>result.answerSettings)?.answerSettings,plain=settings?.plain===true;
 const fields:ComparableField[]=[];
 for(const key of fieldsOf(results)){
  if(key===PLAIN_FIELD&&plain||isExplanationField(key))continue;
  const spec=plain?undefined:fieldSpec(settings,key);
  if(spec){if(spec.type!=='text')fields.push(typedField(key,spec));continue;}
  const values:number[]=[];
  for(const result of results)for(const {result:one} of requestsOf(result)){
   if(one.status!=='done')continue;
   const value=valueOf(one,key).trim();if(value)values.push(toNumber(value));
  }
  const nums=values.filter(Number.isFinite);
  if(!nums.length||nums.length<values.length/2)continue;
  const codes=(()=>{const far=nums.filter(farFromZeroOne);return new Set(far).size<=2&&far.length<=nums.length/10;})();
  if(scale&&plain){
   // Scores mostly on the study's scale are read on it, as on an ordinal field's allowed values; a key answered
   // only with 0 and 1 (and codes far off them and off the scale) stays a yes / no in numbers.
   const off=(x:number)=>x<scale.min||x>scale.max;
   const flag=codes&&nums.every(x=>x===0||x===1||(farFromZeroOne(x)&&off(x)));
   if(!flag&&nums.filter(x=>!off(x)).length*2>=nums.length){
    fields.push({key,label:fieldLabel(key),level:'ordinal',allowed:Array.from({length:scale.max-scale.min+1},(_,i)=>String(scale.min+i)),range:[scale.min,scale.max],yesNo:false});
    continue;
   }
  }
  const whole=nums.every(Number.isInteger);let lo=Infinity,hi=-Infinity;
  for(const x of nums){lo=Math.min(lo,x);hi=Math.max(hi,x);}
  // Whole-number scores: every value from the lowest to the highest seen is a point of the scale.
  const allowed=whole&&hi-lo<=100?Array.from({length:hi-lo+1},(_,i)=>String(lo+i)):[];
  fields.push({key,label:fieldLabel(key),level:whole?'ordinal':'interval',allowed,scaleSeen:true,range:[lo,hi],yesNo:false,zeroOne:zeroOne(nums)});
 }
 return fields;
}
