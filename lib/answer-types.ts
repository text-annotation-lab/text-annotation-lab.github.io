// Typed answer fields (research mode). A field is free text unless a type is
// set for it; the settings below say what differs from the standard format,
// so a study without them sends exactly the requests it always sent.
export type FieldType='category'|'ordinal'|'number'|'boolean'|'text';
export type FieldSpec={name:string;type:FieldType;values:string[];description:string};
// plain: no fields, the whole reply is kept. rationale false: no shared explanation is asked for.
// named (research mode): each field is sent under its own name and type, and nothing is added to the prompt
// (see wireKeys and lib/answer-fields.ts). Without it, fields go under short keys (f0, f1, …) as text, with a
// paragraph on the answer format after the prompt.
// inPrompt (Model knowledge, research mode): the Lab adds no instructions of its own after the prompt; the prompt
// box holds them, where they can be changed or removed (lib/model-knowledge.ts, knowledgeAddition).
export type AnswerSettings={plain?:true;rationale?:false;named?:true;inPrompt?:true;fields?:FieldSpec[]};
export const FIELD_TYPES:FieldType[]=['category','ordinal','number','boolean','text'];
export const FIELD_TYPE_LABELS:Record<FieldType,string>={category:'Category',ordinal:'Ordinal scale',number:'Number',boolean:'Yes / no',text:'Free text'};
export const MAX_ANSWER_FIELDS=40;
// The one column of a plain-text reply.
export const PLAIN_FIELD='response';
const KNOWLEDGE_ABSTAIN='INSUFFICIENT_KNOWLEDGE';

/** A number as typed: a leading minus sign may be a real minus or an en dash. */
export function toNumber(text:string):number{const t=text.trim().replace(/^[−–]/,'-');return t===''?NaN:Number(t);}

// The values a field allows, as sent: categories as typed, a scale's whole numbers, yes and no.
export function allowedValues(spec:Pick<FieldSpec,'type'|'values'>):string[]{
 if(spec.type==='boolean')return ['yes','no'];
 if(spec.type!=='category'&&spec.type!=='ordinal')return [];
 const seen=new Set<string>(),out:string[]=[];
 for(const raw of spec.values){
  const value=spec.type==='ordinal'?(Number.isInteger(toNumber(raw))?String(toNumber(raw)):''):raw.trim(),key=value.toLowerCase();
  if(value&&!seen.has(key)){seen.add(key);out.push(value);}
 }
 return out;
}
const validSpec=(f:any):f is FieldSpec=>Boolean(f)&&typeof f==='object'&&typeof f.name==='string'&&f.name.length>0&&f.name.length<=60&&FIELD_TYPES.includes(f.type)&&Array.isArray(f.values)&&f.values.length<=100&&f.values.every((v:unknown)=>typeof v==='string'&&v.length<=200)&&typeof f.description==='string'&&f.description.length<=2000;
// Settings as stored with a study, a saved prompt, or a result: anything unreadable is dropped.
export function cleanAnswerSettings(value:unknown):AnswerSettings|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const v=value as any,fields:FieldSpec[]=Array.isArray(v.fields)?v.fields.filter(validSpec).slice(0,MAX_ANSWER_FIELDS).map((f:FieldSpec)=>({name:f.name,type:f.type,values:[...f.values],description:f.description})):[];
 const out:AnswerSettings={...(v.plain===true?{plain:true as const}:{}),...(v.rationale===false?{rationale:false as const}:{}),...(v.named===true&&v.plain!==true?{named:true as const}:{}),...(v.inPrompt===true?{inPrompt:true as const}:{}),...(fields.length?{fields}:{})};
 return Object.keys(out).length?out:undefined;
}
export const fieldSpec=(settings:AnswerSettings|undefined,name:string)=>settings?.fields?.find(f=>f.name.toLowerCase()===name.toLowerCase());
// What a request uses and a result records: the field names, and only the settings that differ from
// the standard format. Two setups ask for the same answers exactly when these are the same.
// named: the fields go under their own names and types (research mode). inPrompt: see AnswerSettings.
export function sentAnswers(names:string[]=[],settings?:AnswerSettings,named=settings?.named===true,inPrompt=settings?.inPrompt===true):{names:string[];settings?:AnswerSettings}{
 if(settings?.plain)return {names:[PLAIN_FIELD],settings:{plain:true,...(inPrompt?{inPrompt:true as const}:{})}};
 const fields=names.flatMap(name=>{
  const found=fieldSpec(settings,name);if(!found)return [];
  const spec:FieldSpec={name,type:found.type,values:allowedValues(found),description:found.description.trim()};
  return spec.type==='text'&&!spec.description?[]:[spec];
 });
 const out:AnswerSettings={...(settings?.rationale===false?{rationale:false as const}:{}),...(named?{named:true as const}:{}),...(inPrompt?{inPrompt:true as const}:{}),...(fields.length?{fields}:{})};
 return {names,settings:Object.keys(out).length?out:undefined};
}
// The key of the shared explanation in the named format.
export const RATIONALE_KEY='rationale';
/** A key from a field's name, where the name is not one: “Positive score” → positive_score. */
export function slugKey(label:string):string{
 const s=label.toLowerCase().replace(/æ/g,'ae').replace(/ø/g,'o').replace(/å/g,'a').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
 if(!s)return 'field';
 return /^[a-z_]/.test(s)?s:'f_'+s;
}
// A field explains the answers in place of the shared explanation when it is named Explanation.
export const isExplanationField=(name:string)=>name.toLowerCase()==='explanation';
// The key each field is sent under, in the order of the names. Earlier format: f0, f1, …. Named format: the name
// itself where it is one (letters, digits, and _, not starting with a digit), else a key made from it; never
// “rationale” (the shared explanation's) and never another field's key (a number is added: tone_2).
export function wireKeys(names:string[]=[],settings?:AnswerSettings):string[]{
 if(!settings?.named)return names.map((_,i)=>'f'+i);
 const taken:string[]=[];
 for(const name of names){
  let key=/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)?name:slugKey(name);
  if(key.toLowerCase()===RATIONALE_KEY)key=key+'_field';
  const base=key;for(let n=2;taken.some(k=>k.toLowerCase()===key.toLowerCase());n++)key=base+'_'+n;
  taken.push(key);
 }
 return taken;
}
// Settings as they arrive with a request: already in the form `sentAnswers` gives.
export function readAnswerSettings(raw:unknown,names:string[]):AnswerSettings|undefined{
 if(raw===null||raw===undefined)return undefined;
 let value:unknown;try{value=JSON.parse(String(raw));}catch{throw Error('Could not read the answer format.');}
 const clean=cleanAnswerSettings(value);
 if(!clean||JSON.stringify(sentAnswers(clean.plain?[]:names,clean).settings)!==JSON.stringify(value)||(clean.plain&&(names.length!==1||names[0]!==PLAIN_FIELD)))throw Error('Could not read the answer format.');
 return clean;
}
// Why a value does not fit its field (what was expected), or nothing when it fits.
export function typedProblem(spec:FieldSpec,value:string,knowledge=false):string|undefined{
 const v=value.trim();
 if(spec.type==='text'||(knowledge&&v===KNOWLEDGE_ABSTAIN))return undefined;
 const or=knowledge?', or '+KNOWLEDGE_ABSTAIN:'',list=()=>'one of '+spec.values.slice(0,12).join(', ')+(spec.values.length>12?', …':'')+or;
 if(spec.type==='number')return Number.isFinite(toNumber(v))?undefined:'a number'+or;
 if(spec.type==='ordinal'){
  const n=toNumber(v);
  if(!Number.isInteger(n))return spec.values.length?list():'a whole number'+or;
  return !spec.values.length||spec.values.some(x=>toNumber(x)===n)?undefined:list();
 }
 return !spec.values.length||spec.values.some(x=>x.trim().toLowerCase()===v.toLowerCase())?undefined:list();
}
// The schema of one typed field: a string, limited to the allowed values where there are any.
export function typedSchema(spec:FieldSpec,google:boolean,knowledge:boolean){
 const values=spec.values.length&&knowledge?[...spec.values,KNOWLEDGE_ABSTAIN]:spec.values;
 const kind=spec.type==='category'?(spec.values.length?'one of the allowed categories':'one category label'):spec.type==='ordinal'?(spec.values.length?'one of the allowed whole numbers':'a whole number'):spec.type==='number'?'a number written in digits (for example, 3 or 2.5), with no other text':spec.type==='boolean'?'yes or no':'free text';
 return {type:google?'STRING':'string',description:'Answer for '+spec.name+': '+kind+'.'+(knowledge&&spec.type!=='text'?' Use '+KNOWLEDGE_ABSTAIN+' if it cannot be assessed reliably.':'')+(spec.description?' '+spec.description:''),...(values.length?{enum:values}:{})};
}
// A run's answer format in words, for the list of runs (`full` false: at most eight values per field, no
// descriptions) and for the exported record of runs (`full`: every value and each field's description).
const TYPE_WORDS:Record<FieldType,string>={category:'category',ordinal:'ordinal scale',number:'number',boolean:'yes / no',text:'free text'};
export function answersLabel(names:string[]=[],settings?:AnswerSettings,full=false):string{
 if(settings?.plain)return full?'plain text: the whole reply is stored as “'+PLAIN_FIELD+'” (a reply that is one JSON object also has a column for each of its values); no answer format was sent':'Plain text';
 const note=(name:string)=>{
  const spec=fieldSpec(settings,name);if(!spec)return name;
  const values=spec.type==='boolean'?[]:full?spec.values:spec.values.slice(0,8),more=!full&&spec.values.length>8&&spec.type!=='boolean'?', …':'';
  return name+' ('+TYPE_WORDS[spec.type]+(values.length?': '+values.join(', ')+more:'')+(full&&spec.description?'; description: '+spec.description:'')+')';
 };
 const list=names.length?names.map(note).join(full?' | ':', '):'Score / category';
 return list+(settings?.rationale===false?(full?' | no explanation requested':' · no explanation'):'');
}
