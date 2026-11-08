import {explicitAnswerRules} from './answer-validation';
// Stable wire keys keep user labels out of provider schema property names.
export type NamedAnswers={responseFormat?:string;rawResponse?:string;answerFields?:string[];answers?:Record<string,string>};
export function validAnswerFields(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=10&&value.every(v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=60)&&new Set(value.map(v=>v.toLowerCase())).size===value.length;}
export function readAnswerFields(raw:FormDataEntryValue|null):string[]{if(raw===null)return [];let value;try{value=JSON.parse(String(raw));}catch{throw Error('Could not read answer fields.');}if(!validAnswerFields(value))throw Error('Use up to 10 distinct answer field names, each 1–60 characters.');return value;}
export function answerInstructions(names:string[]=[]){
 const explanation=names.some(n=>n.toLowerCase()==='explanation');
 return '\n\nLab response format: Use the supplied JSON schema for packaging your final answer. Apply all substantive definitions, evidence requirements, scales, and abstention rules in the annotation prompt. If its output layout differs, preserve its requested content inside the schema fields. Return actual answer values, never field labels, placeholders, code, or commentary about JSON. Complete the explanation before the final judgments. '+(names.length?
 'Return an empty string in score. Return one value per named field in answers, using these keys: '+JSON.stringify(Object.fromEntries(names.map((n,i)=>['f'+i,n])))+'. '+(explanation?'Put the requested explanation in the named Explanation field and leave the top-level explanation empty.':'Put one shared explanation covering the named answers in explanation.')+' For model-knowledge tasks, use INSUFFICIENT_KNOWLEDGE for any judgment that cannot be assessed reliably.':
 'Put the requested explanation in explanation, and only the final score or category in score, as a string.');
}
export function annotationSchema(names:string[]=[],google=false,prompt='',knowledge=false):any{
 const str={type:google?'STRING':'string'},rules=explicitAnswerRules(prompt,names,knowledge);
 const answer=(name:string)=>{const rule=rules.find(r=>r.name===name);return {...str,description:'Actual answer for '+name+' using the prompt’s definitions and allowed values; never repeat the field name.'+(rule?' Use an integer from '+rule.min+' to '+rule.max+'.':''),...(rule?{enum:rule.values}:{})};};
 const properties:any={explanation:{...str,description:'The requested explanation, grounded in the supplied evidence. Follow the prompt’s length and content requirements.'},score:names.length?{...str,enum:[''],description:'Unused when named fields are configured; return an empty string.'}:answer('score')};
 if(names.length){
  const explanatory=names.findIndex(n=>n.toLowerCase()==='explanation');
  if(explanatory>=0)properties.explanation={...str,enum:[''],description:'Explanation is supplied in the named field; leave this empty.'};
  const keys=names.map((_,i)=>'f'+i),ordered=explanatory>=0?[keys[explanatory],...keys.filter((_,i)=>i!==explanatory)]:keys;
  properties.answers={type:google?'OBJECT':'object',properties:Object.fromEntries(ordered.map(key=>{const name=names[Number(key.slice(1))];return [key,name.toLowerCase()==='explanation'?{...str,description:'The explanation requested in the prompt. Follow its length and evidence requirements.'}:answer(name)];})),required:ordered,...(google?{propertyOrdering:ordered}:{additionalProperties:false})};
 }
 return {type:google?'OBJECT':'object',properties,required:Object.keys(properties),...(google?{propertyOrdering:Object.keys(properties)}:{additionalProperties:false})};
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

export function annotationFormatRecord(names:string[]=[],prompt='',knowledge=false){return JSON.stringify({instructions:answerInstructions(names),schema:annotationSchema(names,false,prompt,knowledge)});}
