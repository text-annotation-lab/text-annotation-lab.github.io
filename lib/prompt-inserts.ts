// Research mode: placeholders in the annotation prompt. {{id}} stands for a text's name and {{meta.<column>}}
// for its value in a metadata column; each is filled in for every text before the prompt is sent. {{text}} places
// the text there instead of after the prompt (see placesText). Anything else written as {{...}} is sent as
// written, and so is every placeholder in the standard Lab.
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
// {{text}}, in any letter case and with spaces inside the braces: where the text goes (research mode). A prompt
// without it is followed by the text between <text> tags (lib/request-frame.ts).
const isText=(written:string)=>written.trim().toLowerCase()==='text';
export const placesText=(prompt:string)=>[...prompt.matchAll(BRACES)].some(match=>isText(match[1]));
// What is written as {{...}} and not filled in, such as {{name}}.
export function strayPlaceholders(prompt:string):string[]{
 const found:string[]=[];
 for(const match of prompt.matchAll(BRACES))if(!insertName(match[1])&&!isText(match[1])&&!found.includes(match[0]))found.push(match[0]);
 return found;
}
// How much of a prompt is the same for every text: everything before the first placeholder that is filled in
// (text: {{text}} counts as one).
export function fixedLength(prompt:string,text=false):number{
 for(const match of prompt.matchAll(BRACES))if(insertName(match[1])||text&&isText(match[1]))return match.index;
 return prompt.length;
}
// The prompt of one text (filled) up to where its last line ends. Where the prompt as written ends with a
// placeholder, only the spaces and line ends written after it are taken off: the value stays as it is, also one
// that is empty or ends with a space, as the record of the request has it (lib/request-frame.ts).
export function promptEnd(filled:string,written:string):string{
 const end=written.trimEnd(),all=[...end.matchAll(BRACES)],last=all[all.length-1];
 if(!last||last.index+last[0].length!==end.length||!insertName(last[1]))return filled.trimEnd();
 const tail=written.slice(end.length);
 for(const after of [tail.replace(/\r\n|\r|\n/g,'\r\n'),tail])if(filled.endsWith(after))return filled.slice(0,filled.length-after.length);
 return filled.trimEnd();
}
// A prompt that places the text: each placeholder put in (put gets its name and how it is written), and each
// {{text}} taken out. spots: where the text goes in the prompt that is returned, in order. One pass, so a value
// that holds "{{text}}" or a mark stays as it is.
export function fillPlaces(prompt:string,put:(name:string,whole:string)=>string):{prompt:string;spots:number[]}{
 let out='',from=0;const spots:number[]=[];
 for(const match of prompt.matchAll(BRACES)){
  const name=insertName(match[1]);if(!name&&!isText(match[1]))continue;
  out+=prompt.slice(from,match.index);from=match.index+match[0].length;
  if(name)out+=put(name,match[0]);else spots.push(out.length);
 }
 return {prompt:out+prompt.slice(from),spots};
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
