import {explicitAnswerRules} from './answer-validation';
import {MAX_ANSWER_FIELDS,fieldSpec,typedSchema,wireKeys,isExplanationField,allowedValues,toNumber,RATIONALE_KEY,type AnswerSettings,type FieldSpec} from './answer-types';
export {cleanAnswerSettings,sentAnswers,readAnswerSettings,fieldSpec,wireKeys,PLAIN_FIELD,RATIONALE_KEY,type AnswerSettings,type FieldSpec,type FieldType} from './answer-types';
// Stable wire keys keep user labels out of provider schema property names.
export type NamedAnswers={responseFormat?:string;rawResponse?:string;answerFields?:string[];answerSettings?:AnswerSettings;answers?:Record<string,string>};
export function validAnswerFields(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=MAX_ANSWER_FIELDS&&value.every(v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=60)&&new Set(value.map(v=>v.toLowerCase())).size===value.length;}
export function readAnswerFields(raw:FormDataEntryValue|null):string[]{if(raw===null)return [];let value;try{value=JSON.parse(String(raw));}catch{throw Error('Could not read answer fields.');}if(!validAnswerFields(value))throw Error('Use up to '+MAX_ANSWER_FIELDS+' distinct answer field names, each 1–60 characters.');return value;}
// Plain text and the named format add nothing to the prompt. Without settings the text is the standard Lab's, unchanged.
export function answerInstructions(names:string[]=[],settings?:AnswerSettings){
 if(settings?.plain||settings?.named)return '';
 const explanation=names.some(n=>n.toLowerCase()==='explanation'),rationale=settings?.rationale!==false;
 return '\n\nLab response format: Use the supplied JSON schema for packaging your final answer. Apply all substantive definitions, evidence requirements, scales, and abstention rules in the annotation prompt. If its output layout differs, preserve its requested content inside the schema fields. Return actual answer values, never field labels, placeholders, code, or commentary about JSON. '+(rationale||explanation?'Complete the explanation before the final judgments. ':'')+(names.length?
 'Return an empty string in score. Return one value per named field in answers, using these keys: '+JSON.stringify(Object.fromEntries(names.map((n,i)=>['f'+i,n])))+'. '+(explanation?'Put the requested explanation in the named Explanation field and leave the top-level explanation empty.':rationale?'Put one shared explanation covering the named answers in explanation.':'No explanation is requested: leave the top-level explanation empty.')+' For model-knowledge tasks, use INSUFFICIENT_KNOWLEDGE for any judgment that cannot be assessed reliably.':
 rationale?'Put the requested explanation in explanation, and only the final score or category in score, as a string.':'Put only the final score or category in score, as a string. No explanation is requested: leave explanation empty.');
}
// A typed field (research mode) is described by its type; any other field as it always was.
// Plain text has no schema.
export function annotationSchema(names:string[]=[],google=false,prompt='',knowledge=false,settings?:AnswerSettings):any{
 if(settings?.plain)return null;
 if(settings?.named)return namedSchema(names,google,prompt,knowledge,settings);
 const str={type:google?'STRING':'string'},rules=explicitAnswerRules(prompt,names,knowledge);
 const answer=(name:string)=>{const spec=fieldSpec(settings,name);if(spec)return typedSchema(spec,google,knowledge);const rule=rules.find(r=>r.name===name);return {...str,description:'Actual answer for '+name+' using the prompt’s definitions and allowed values; never repeat the field name.'+(rule?' Use an integer from '+rule.min+' to '+rule.max+'.':''),...(rule?{enum:rule.values}:{})};};
 const properties:any={explanation:settings?.rationale===false?{...str,enum:[''],description:'No explanation is requested; return an empty string.'}:{...str,description:'The requested explanation, grounded in the supplied evidence. Follow the prompt’s length and content requirements.'},score:names.length?{...str,enum:[''],description:'Unused when named fields are configured; return an empty string.'}:answer('score')};
 if(names.length){
  const explanatory=names.findIndex(n=>n.toLowerCase()==='explanation');
  if(explanatory>=0)properties.explanation={...str,enum:[''],description:'Explanation is supplied in the named field; leave this empty.'};
  const keys=names.map((_,i)=>'f'+i),ordered=explanatory>=0?[keys[explanatory],...keys.filter((_,i)=>i!==explanatory)]:keys;
  properties.answers={type:google?'OBJECT':'object',properties:Object.fromEntries(ordered.map(key=>{const name=names[Number(key.slice(1))];return [key,name.toLowerCase()==='explanation'&&!fieldSpec(settings,name)?{...str,description:'The explanation requested in the prompt. Follow its length and evidence requirements.'}:answer(name)];})),required:ordered,...(google?{propertyOrdering:ordered}:{additionalProperties:false})};
 }
 return {type:google?'OBJECT':'object',properties,required:Object.keys(properties),...(google?{propertyOrdering:Object.keys(properties)}:{additionalProperties:false})};
}
// The named format (research mode): the shared explanation first, as `rationale`, then each field under its own
// key (wireKeys) and type: a category as text, a scale as a whole number, a number, yes / no as true or false,
// free text as text, each with its allowed values and with its description where it has one. A field named
// Explanation stands in for the shared explanation and comes first. With no fields, the answer is `score`, as
// text. In Model knowledge a field other than free text or a category also accepts INSUFFICIENT_KNOWLEDGE, so
// it goes as text limited to its values (described as in the earlier format). Google's schema takes allowed
// values only for text: a scale there is a whole number from its lowest to its highest value.
function namedSchema(names:string[],google:boolean,prompt:string,knowledge:boolean,settings:AnswerSettings):any{
 const type=(name:'string'|'integer'|'number'|'boolean'|'object')=>google?name.toUpperCase():name,keys=wireKeys(names,settings),rules=explicitAnswerRules(prompt,names,knowledge);
 const described=(spec:FieldSpec|undefined)=>spec?.description?{description:spec.description}:{};
 const field=(name:string):any=>{
  const spec=fieldSpec(settings,name),rule=rules.find(r=>r.name===name);
  if(!spec)return {type:type('string'),...(rule?{enum:rule.values}:{})};
  if(knowledge&&spec.type!=='text'&&spec.type!=='category')return typedSchema(spec,google,knowledge);
  const values=allowedValues(spec);
  if(spec.type==='category')return {...described(spec),type:type('string'),...(values.length?{enum:knowledge?[...values,'INSUFFICIENT_KNOWLEDGE']:values}:{})};
  if(spec.type==='ordinal'){const numbers=values.map(toNumber);return {...described(spec),type:type('integer'),...(numbers.length?google?{minimum:Math.min(...numbers),maximum:Math.max(...numbers)}:{enum:numbers}:{})};}
  return {...described(spec),type:type(spec.type==='number'?'number':spec.type==='boolean'?'boolean':'string')};
 };
 const properties:any={},explaining=names.findIndex(isExplanationField);
 if(settings.rationale!==false&&explaining<0)properties[RATIONALE_KEY]={type:type('string'),description:knowledge?'Brief justification for the annotation.':'Brief justification for the annotation, citing the text where relevant.'};
 if(!names.length)properties.score={type:type('string'),...(rules[0]?{enum:rules[0].values}:{})};
 const order=explaining>=0?[explaining,...names.map((_,i)=>i).filter(i=>i!==explaining)]:names.map((_,i)=>i);
 for(const i of order)properties[keys[i]]=field(names[i]);
 return {type:type('object'),properties,required:Object.keys(properties),...(google?{propertyOrdering:Object.keys(properties)}:{additionalProperties:false})};
}
// A reply's answers in the form results keep: the answers by f0, f1, … as text, the score, and the explanation.
// A number is written as JavaScript writes it (3, 2.5), true and false as yes and no. undefined: the reply is not
// in the answer format. A message: an answer is missing.
export function readReply(result:any,names:string[]=[],settings?:AnswerSettings):{answers?:Record<string,string>;score:string;explanation:string}|string|undefined{
 if(!settings?.named){
  if(!result||typeof result.score!=='string'||typeof result.explanation!=='string')return undefined;
  try{return {answers:answerValues(result,names),score:result.score,explanation:result.explanation};}catch(error){return (error as Error).message;}
 }
 if(!result||typeof result!=='object'||Array.isArray(result))return undefined;
 const text=(value:unknown)=>typeof value==='string'?value:typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='boolean'?(value?'yes':'no'):undefined;
 const shared=settings.rationale!==false&&!names.some(isExplanationField),explanation=shared?result[RATIONALE_KEY]:'';
 if(typeof explanation!=='string')return 'The response is missing its explanation. Check provider usage before retrying.';
 if(!names.length){const score=text(result.score);return score===undefined?undefined:{score,explanation};}
 const keys=wireKeys(names,settings),values=keys.map(key=>text(result[key]));
 if(values.some(value=>value===undefined))return 'The response is missing a named answer field. Check provider usage before retrying.';
 return {answers:Object.fromEntries(values.map((value,i)=>['f'+i,value!])),score:'',explanation};
}
export function hasSeparateExplanation(row:NamedAnswers&{explanation?:string}){const text=row.explanation?.trim();return Boolean(text)&&!Object.values(row.answers||{}).some(value=>value.trim().replace(/\s+/g,' ')===text!.replace(/\s+/g,' '));}
export function answerValues(result:any,names:string[]=[]):Record<string,string>|undefined{if(!names.length)return undefined;const values=result?.answers;if(!values||typeof values!=='object'||Array.isArray(values)||names.some((_,i)=>typeof values['f'+i]!=='string'))throw Error('The response is missing a named answer field. Check provider usage before retrying.');return Object.fromEntries(names.map((_,i)=>['f'+i,values['f'+i]]));}
export function resultFieldNames(rows:NamedAnswers[]){return Array.from(new Set(rows.flatMap(r=>r.answerFields||[])));}
export function resultAnswer(row:NamedAnswers,name:string){const i=row.answerFields?.indexOf(name)??-1;return i<0?'':row.answers?.['f'+i]??'';}

// Current fields preview future results; recorded fields retain their original mapping.
export function resultColumns(rows:(NamedAnswers&{status:string})[],currentFields:string[]=[]){
 const names=resultFieldNames([{answerFields:currentFields},...rows]);
 const showLegacy=rows.some(row=>row.status!=='pending'&&!row.answerFields?.length)||(!currentFields.length&&(!rows.length||rows.some(row=>row.status==='pending')))||!names.length;
 return {names,showLegacy};
}
export function answerLabel(value:string){return value.trim().toUpperCase()==='INSUFFICIENT_KNOWLEDGE'?'Insufficient knowledge':value;}

export function annotationFormatRecord(names:string[]=[],prompt='',knowledge=false,settings?:AnswerSettings){return JSON.stringify({instructions:answerInstructions(names,settings),schema:annotationSchema(names,false,prompt,knowledge,settings)});}
// A plain-text reply as a result: the whole reply is the one answer.
export function plainAnswer(raw:unknown){return typeof raw==='string'&&raw.trim()?{rawResponse:raw,answers:{f0:raw.trim()},score:'',explanation:''}:undefined;}
export const EMPTY_REPLY='The model returned an empty reply. Check your provider’s usage before retrying.';
