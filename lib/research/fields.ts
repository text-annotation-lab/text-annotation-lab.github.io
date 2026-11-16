// The answers of a result read by field, and what a comparison reads them from (a run, one annotation of it, or a
// column). Used by the research workspace's view (view.ts) and by the agreement figures (agreement.ts).
import {resultAnswer} from '../answer-fields';
import {fieldSpec,PLAIN_FIELD,type AnswerSettings} from '../answer-types';
import {jsonAnswers,jsonKeyOrder,jsonValue} from '../json-reply';
import {normalizeLabel} from './normalize';
import {rowForRun,type Row} from './runs';
import {requestsOf} from './repeats';

// The single score or category of a prompt without named answer fields.
export const SCORE_FIELD='';
export const fieldLabel=(field:string)=>field||'Score / category';
type Answered={score?:string;answerFields?:string[];answerSettings?:AnswerSettings;answers?:Record<string,string>};
// A plain-text reply that is JSON also answers under each of its keys.
const splitReply=(row:Answered)=>row.answerSettings?.plain?jsonAnswers(row.answers):null;
export const valueOf=(row:Answered,field:string)=>!field?(row.answerFields?.length?'':String(row.score??'')):row.answerFields?.includes(field)?resultAnswer(row,field):jsonValue(splitReply(row),field);
// Answer fields with at least one completed value, in the order they were defined. The keys of plain-text
// replies that are JSON come before the reply itself, the scores of each group before its explanation.
export function fieldsOf(rows:Row[]):string[]{
 const fields:string[]=[],replies:Record<string,string>[]=[];let score=false;
 for(const row of rows){
  if(row.status!=='done')continue;
  if(row.answerFields?.length){for(const name of row.answerFields)if(!fields.includes(name))fields.push(name);}else score=true;
  const reply=splitReply(row);if(reply)replies.push(reply);
 }
 if(replies.length){
  const named=new Set(fields),keys=jsonKeyOrder(replies).filter(key=>!named.has(key)),at=fields.indexOf(PLAIN_FIELD);
  fields.splice(at<0?fields.length:at,0,...keys);
 }
 return score?[SCORE_FIELD,...fields]:fields;
}
// The field to compare: the chosen one, else the one named like the column, else the first that is not an explanation.
export function pickField(fields:string[],chosen:string,like=''):string{
 if(fields.includes(chosen))return chosen;
 const named=fields.find(f=>f&&f.toLowerCase()===like.trim().toLowerCase());
 return named??fields.find(f=>f.toLowerCase()!=='explanation')??fields[0]??SCORE_FIELD;
}
// rep: one annotation of a run that makes several per text (its number), instead of the run's combined answers.
export type CompareSource={kind:'run';run:number;rep?:number}|{kind:'column';name:string};
export const sourceKey=(source:CompareSource)=>source.kind==='run'?'run:'+source.run+(source.rep?'#'+source.rep:''):'col:'+source.name;
export function parseSource(key:string):CompareSource|undefined{
 if(key.startsWith('run:')){
  const [run,rep]=key.slice(4).split('#').map(Number),whole=(n:number)=>Number.isInteger(n)&&n>0;
  return whole(run)&&(rep===undefined||whole(rep))?{kind:'run',run,...(rep?{rep}:{})}:undefined;
 }
 return key.startsWith('col:')&&key.length>4?{kind:'column',name:key.slice(4)}:undefined;
}
// What a run source reads for a text: the run's result or, with `rep`, that annotation of it read as a result
// of its own (absent when the result has no such annotation).
export function sourceResult<T extends Row>(row:T,source:{run:number;rep?:number}):T{
 const result=rowForRun(row,source.run);
 if(!source.rep||result.status!=='done')return result;
 return requestsOf(result).find(request=>request.replicate===source.rep)?.result??{...result,status:'absent'} as T;
}
// `yesNo`: a yes / no field, where 1 and 0, y and n, and ja and nej also read as yes and no.
export const sameLabel=(a:string,b:string,yesNo=false)=>normalizeLabel(a,yesNo)===normalizeLabel(b,yesNo);
export const isYesNo=(row:Row,field:string)=>Boolean(field)&&fieldSpec(row.answerSettings,field)?.type==='boolean';
