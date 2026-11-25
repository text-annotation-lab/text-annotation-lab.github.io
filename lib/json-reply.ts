// A plain-text reply that is JSON. When the whole reply is one JSON object (optionally inside a ```json fence),
// each of its values gets a column of its own beside the reply itself: nested keys are joined with "_", a list is
// kept as written, and an empty value is an empty cell. A reply that holds JSON among other words is not split.
// It counts as failed, because its columns would otherwise be silently empty. Prose, even with {braces}, is
// left alone. This file imports nothing, so anything may import it.
const FENCE=/^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const unfenced=(raw:string)=>{const text=raw.trim(),match=FENCE.exec(text);return match?match[1]:text;};
const written=(value:unknown)=>value===null||value===undefined?'':typeof value==='string'?value:typeof value==='number'||typeof value==='boolean'?String(value):JSON.stringify(value);
// The reply's own column is named "response"; a JSON key of that name gets a prefix, so neither hides the other.
const OWN_COLUMN='response';
export const jsonColumn=(key:string)=>key.toLowerCase()===OWN_COLUMN?'answer_'+key:key;

// A reply that contains a JSON object (`{"key": …`), as opposed to prose that happens to use braces.
export const looksLikeJson=(raw:string)=>/\{\s*"/.test(raw);

// One value per column, or null when the reply as a whole is not a JSON object, or when two of its values would get
// the same column ({"race":{"score":3},"race_score":-3}: both race_score), so that neither silently replaces the other.
export function flattenJsonReply(raw:unknown):Record<string,string>|null{
 if(typeof raw!=='string'||!raw.trim())return null;
 try{
  const parsed:unknown=JSON.parse(unfenced(raw));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return null;
  const entries:[string,string][]=[];
  const walk=(value:unknown,key:string)=>{
   if(value&&typeof value==='object'&&!Array.isArray(value)){for(const [name,inner] of Object.entries(value))walk(inner,key?key+'_'+name:name);}
   else if(key)entries.push([jsonColumn(key),written(value)]);
  };
  walk(parsed,'');
  if(new Set(entries.map(([key])=>key)).size<entries.length)return null;
  // fromEntries defines each key as the reply's own, whatever its name ("__proto__", "constructor").
  return Object.fromEntries(entries);
 }catch{return null;}
}
// The reply contains JSON, but the reply as a whole could not be read as JSON. (A whole reply that is valid JSON
// but no object, such as a list of objects, is kept as it is, in one column.)
const validJson=(raw:string)=>{try{JSON.parse(unfenced(raw));return true;}catch{return false;}};
export const unreadableJson=(raw:string)=>looksLikeJson(raw)&&!flattenJsonReply(raw)&&!validJson(raw);
// A whole reply that is one JSON object, two of whose values would get the same column (see flattenJsonReply).
export function collidingJson(raw:string):boolean{
 try{const parsed:unknown=JSON.parse(unfenced(raw));return Boolean(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))&&!flattenJsonReply(raw);}catch{return false;}
}

// The same reply is read once, however often a table or a comparison asks for it: results keep their
// `answers` object for as long as they exist, and a result that is replaced gets a new one.
const read=new WeakMap<object,Record<string,string>|null>();
export function jsonAnswers(answers:Record<string,string>|undefined):Record<string,string>|null{
 if(!answers||typeof answers!=='object')return null;
 let flat=read.get(answers);
 if(flat===undefined){flat=flattenJsonReply(answers.f0);read.set(answers,flat);}
 return flat;
}
export const jsonValue=(flat:Record<string,string>|null,key:string)=>flat&&Object.hasOwn(flat,key)?flat[key]:'';

// The model writes its reasoning first, but a reader wants the scores first.
export const isExplanationKey=(key:string)=>/(^|_)(explanation|reasoning)$/i.test(key);
// The order of the columns over all the replies of a table, so every row has the same columns in the same order,
// whichever text comes first: keys as first seen, grouped by what stands before their last "_" (a nested
// object), the reasoning last in its group; with flat names ("race", "race_explanation") each explanation
// right after its own score.
export function jsonKeyOrder(replies:(Record<string,string>|null|undefined)[]):string[]{
 const all:string[]=[],seen=new Set<string>();
 for(const reply of replies)if(reply)for(const key of Object.keys(reply))if(!seen.has(key)){seen.add(key);all.push(key);}
 const groupOf=(key:string)=>key.includes('_')?key.slice(0,key.lastIndexOf('_')):'';
 const groups=new Map<string,number>();
 for(const key of all)if(!groups.has(groupOf(key)))groups.set(groupOf(key),groups.size);
 const sorted=[...all].sort((a,b)=>groups.get(groupOf(a))!-groups.get(groupOf(b))!||Number(isExplanationKey(a))-Number(isExplanationKey(b)));
 const scoreOf=(key:string)=>{
  for(const suffix of ['_explanation','_reasoning'])if(key.toLowerCase().endsWith(suffix)&&seen.has(key.slice(0,-suffix.length)))return key.slice(0,-suffix.length);
  return null;
 };
 const after=new Map<string,string[]>();
 for(const key of sorted){const score=scoreOf(key);if(score!==null)after.set(score,[...(after.get(score)||[]),key]);}
 const keys:string[]=[];
 const place=(key:string)=>{keys.push(key);for(const next of after.get(key)||[])place(next);};
 for(const key of sorted)if(scoreOf(key)===null)place(key);
 return keys;
}
