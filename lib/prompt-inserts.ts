// Research mode: placeholders in the annotation prompt. {{id}} stands for a text's name and {{meta.<column>}}
// for its value in a metadata column; each is filled in for every text before the prompt is sent. Anything else
// written as {{...}} is sent as written, and so is every placeholder in the standard Lab.
// This file imports nothing, so anything may import it.

// Anything written between double braces.
const BRACES=/\{\{([^{}]*)\}\}/gu;
// The name of a placeholder that is filled in ("id", or "meta." and a column's name), or nothing. A column's
// name is taken as written between "meta." and the braces, so it may hold spaces and punctuation, as in
// {{meta.Year (first edition)}}; it has at most 60 characters (lib/research/columns.ts). A name with an angle
// bracket or a line break is not a placeholder.
const insertName=(written:string):string|undefined=>{
 const name=written.trim();
 if(name.toLowerCase()==='id')return 'id';
 const column=/^meta\./i.test(name)?name.slice(5).trim():'';
 return column&&column.length<=60&&!/[<>\r\n]/.test(column)?'meta.'+column:undefined;
};
// The placeholders of a prompt that are filled in, each once, in the order they first appear.
export function promptInserts(prompt:string):string[]{
 const names:string[]=[];
 for(const match of prompt.matchAll(BRACES)){const name=insertName(match[1]);if(name&&!names.includes(name))names.push(name);}
 return names;
}
// What is written as {{...}} and not filled in, such as {{text}}.
export function strayPlaceholders(prompt:string):string[]{
 const found:string[]=[];
 for(const match of prompt.matchAll(BRACES))if(!insertName(match[1])&&!found.includes(match[0]))found.push(match[0]);
 return found;
}
// How much of a prompt is the same for every text: everything before the first placeholder that is filled in.
export function fixedLength(prompt:string):number{
 for(const match of prompt.matchAll(BRACES))if(insertName(match[1]))return match.index;
 return prompt.length;
}
const replaceInserts=(prompt:string,put:(name:string)=>string)=>prompt.replace(BRACES,(whole,written:string)=>{const name=insertName(written);return name?put(name):whole;});
// The prompt of one text. values: one for each name of promptInserts, in that order.
export function fillInserts(prompt:string,values:string[]):string{
 const names=promptInserts(prompt);
 return replaceInserts(prompt,name=>values[names.indexOf(name)]??'');
}
// A recorded request holds a mark in place of each placeholder (lib/request-frame.ts): <<INSERT:id>>, or
// <<INSERT:meta.year>> for {{meta.year}}.
export const INSERT_MARK='<<INSERT:(?:id|meta[.][^<>]{1,60})>>';
export const markInserts=(prompt:string)=>replaceInserts(prompt,name=>`<<INSERT:${name}>>`);
// The marks of a recorded prompt as the placeholders they stand for, to be read by a person.
export const showInserts=(text:string)=>text.replace(new RegExp(INSERT_MARK,'g'),mark=>`{{${mark.slice(9,-2)}}}`);
// The placeholders a recorded request has marks for, each once.
export const markedInserts=(text:string):string[]=>[...new Set(text.match(new RegExp(INSERT_MARK,'g'))||[])].map(mark=>mark.slice(9,-2));
// The value behind each name, for putting one text's values back into a recorded request.
export const insertMap=(prompt:string,values:string[]|undefined):Map<string,string>=>new Map(promptInserts(prompt).map((name,i)=>[name,values?.[i]??'']));

export const MAX_INSERT_LENGTH=20000;
// The values a request carries for its prompt's placeholders: one string for each, or nothing.
export function readInserts(raw:unknown,prompt:string):string[]|undefined{
 if(raw===null||raw===undefined)return undefined;
 const names=promptInserts(prompt);
 if(!Array.isArray(raw)||raw.length!==names.length||!names.length||raw.some(value=>typeof value!=='string'||value.length>MAX_INSERT_LENGTH))throw Error('Could not read the values for the placeholders of the prompt.');
 return raw as string[];
}
