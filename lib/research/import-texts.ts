// Texts from a table (one row per text) or from pasted text, for research
// mode's import dialogs. Each text becomes a plain-text document named after
// its ID, so labels in a spreadsheet can be matched to it by that ID later.
import {parseSpreadsheet,readTableText,uniqueHeader} from './parse-table';
import {stem,validColumnName,type NewText,type Sheet} from './columns';

export const CORPUS_TABLE_ACCEPT='.csv,.tsv,.xlsx,.json,.jsonl';
const MAX_TABLE_MEGABYTES=100;
const tidy=(value:unknown)=>String(value??'').normalize('NFC').trim();
const fold=(value:unknown)=>tidy(value).toLowerCase();

// JSON and JSON Lines: one object per text; its keys are the columns.
function recordsToSheet(records:unknown[]):Sheet{
 const keys:string[]=[],index=new Map<string,number>(),rows:string[][]=[];
 const cell=(value:unknown)=>value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
 for(const record of records){
  if(!record||typeof record!=='object'||Array.isArray(record))continue;
  const row:string[]=[];
  for(const [key,value] of Object.entries(record)){
   let i=index.get(key);
   if(i===undefined){i=keys.length;index.set(key,i);keys.push(key);}
   row[i]=cell(value).trim();
  }
  if(row.some(Boolean))rows.push(row);
 }
 // Blank keys and keys that differ only in case are named as a spreadsheet's columns are.
 const header=uniqueHeader(keys.map((key,i)=>tidy(key)||'Column '+(i+1)));
 return {header,rows:rows.map(row=>Array.from({length:header.length},(_,i)=>row[i]??''))};
}
export async function parseCorpusTable(file:File):Promise<Sheet>{
 if(file.size>MAX_TABLE_MEGABYTES*1024*1024)throw new Error(`Choose a table of up to ${MAX_TABLE_MEGABYTES} MB.`);
 if(/\.jsonl$/i.test(file.name)){
  const records:unknown[]=[];
  (await readTableText(file)).replace(/^﻿/,'').split(/\r?\n/).forEach((line,i)=>{
   if(!line.trim())return;
   try{records.push(JSON.parse(line));}catch{throw new Error(`Line ${i+1} is not valid JSON. A JSON Lines file holds one object per line.`);}
  });
  return recordsToSheet(records);
 }
 if(/\.json$/i.test(file.name)){
  let data:any;
  const text=await readTableText(file);try{data=JSON.parse(text.replace(/^﻿/,''));}catch{throw new Error('This file is not valid JSON.');}
  const records=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:null;
  if(!records)throw new Error('Expected a JSON array of objects, one per text.');
  return recordsToSheet(records);
 }
 return parseSpreadsheet(file,MAX_TABLE_MEGABYTES);
}

// A first guess at the column that holds the texts: a telling name, or else the longest values.
export function guessTextColumn(sheet:Sheet):number{
 const named=sheet.header.findIndex(name=>/^(text|content|body|document|conversation|paragraph|response)$/i.test(name.trim()));
 if(named>=0)return named;
 const sample=sheet.rows.slice(0,50);let best=0,longest=-1;
 sheet.header.forEach((_,i)=>{
  const mean=sample.reduce((sum,row)=>sum+(row[i]?.length||0),0)/Math.max(1,sample.length);
  if(mean>longest){longest=mean;best=i;}
 });
 return best;
}
// The column that identifies the texts, when its name says so; otherwise -1 (the rows are numbered).
export function guessIdColumn(sheet:Sheet):number{
 const named=sheet.header.findIndex(name=>/^(id|doc_?id|text_?id|item_?id|uid|key)$/i.test(name.trim()));
 if(named>=0)return named;
 // Else a column named like an ID ("post_id", "tweet id") with a different value in every row.
 return sheet.header.findIndex((name,i)=>/(^|[\s_-])id$/i.test(name.trim())&&sheet.rows.length>0&&new Set(sheet.rows.map(row=>fold(row[i]))).size===sheet.rows.length&&sheet.rows.every(row=>tidy(row[i])));
}

const idText=(value:unknown)=>tidy(value).replace(/[\u0000-\u001f\u007f]+/g,' ').slice(0,120).trim();
// Every text is stored as a plain-text document, so its name ends in .txt.
export const textName=(id:string)=>/\.txt$/i.test(id)?id:id+'.txt';

export type TablePlan={texts:NewText[];names:string[];empty:number;twice:number;repeated:string[];tooLong:string[]};
// The texts a table gives. Rows with an empty text are left out, and so is a
// row that repeats an earlier one in every column. A text without an ID is
// named after the table and its row number; an ID used twice gets _2, _3, …
export function planTable(sheet:Sheet,textIndex:number,idIndex:number,fileName:string):TablePlan{
 const base=stem(tidy(fileName.split(/[\\/]/).pop()))||'table';
 const kept:{row:string[];number:number}[]=[],seen=new Set<string>();let empty=0,twice=0;
 sheet.rows.forEach((row,i)=>{
  if(!String(row[textIndex]??'').trim()){empty++;return;}
  const key=JSON.stringify(row);
  if(seen.has(key)){twice++;return;}
  seen.add(key);kept.push({row,number:i+1});
 });
 const others=sheet.header.map((_,i)=>i).filter(i=>i!==textIndex&&i!==idIndex);
 const tooLong=others.filter(i=>!validColumnName(sheet.header[i])).map(i=>sheet.header[i]);
 const from=others.filter(i=>validColumnName(sheet.header[i])&&kept.some(({row})=>tidy(row[i])));
 const used=new Set<string>(),repeated:string[]=[];
 const texts=kept.map(({row,number})=>{
  const given=(idIndex>=0?idText(row[idIndex]):'')||`${base}_${number}`;
  let id=given;
  if(used.has(fold(textName(id)))){let n=2;while(used.has(fold(textName(`${given}_${n}`))))n++;id=`${given}_${n}`;repeated.push(given);}
  used.add(fold(textName(id)));
  return {name:textName(id),text:String(row[textIndex]),values:from.map(i=>row[i]??'')};
 });
 return {texts,names:from.map(i=>sheet.header[i]),empty,twice,repeated,tooLong};
}

// Split pasted text into texts. Each text is what lies between the separators
// (a line break; at blank lines, the blank lines too), kept as pasted.
export function splitPasted(text:string,mode:'none'|'blank'|'line'):string[]{
 if(!text.trim())return [];
 if(mode==='none')return [text];
 const body=text.replace(/^(?:[^\S\r\n]*\r?\n)+/,'').replace(/(?:\r?\n[^\S\r\n]*)+$/,'');
 const parts=mode==='blank'?body.split(/\r?\n(?:[^\S\r\n]*\r?\n)+/):body.split(/\r?\n/);
 return parts.filter(part=>part.trim()!=='');
}
export function pastedTexts(parts:string[],prefix:string):NewText[]{
 const id=idText(prefix).replace(/\s+/g,'_')||'pasted';
 return parts.map((text,i)=>({name:textName(parts.length===1?id:`${id}_${i+1}`),text,values:[]}));
}
export const countWords=(text:string)=>(text.match(/\S+/g)||[]).length;

// Fit new texts into the study: a text the study already holds (the same name
// and the same text) is left out, and a text whose name is taken by a
// different text gets _2, _3, … so every name stays unique. removed: texts
// deleted from the study but kept for the runs that used them; one of them
// added again (the same name and the same text) is brought back (`back`).
type Held={id?:string;name:string;file?:Blob;removedAt?:string};
// A text over the Lab's 20 MB limit for one document (a backup could not hold it, and no model reads that much).
export const MAX_TEXT_BYTES=20*1024*1024;
export class TooLong extends Error{}
export async function fitIntoStudy(texts:NewText[],existing:Held[],removed:Held[]=[]):Promise<{texts:NewText[];already:number;renamed:number;back:number}>{
 const encoder=new TextEncoder(),long=texts.filter(text=>encoder.encode(text.text).length>MAX_TEXT_BYTES);
 if(long.length)throw new TooLong(`${long.length===1?`The text “${long[0].name}” is`:`${long.length} texts (the first: “${long[0].name}”) are`} larger than 20 MB, the limit for one document. Split ${long.length===1?'it':'them'} into smaller texts, then add the ${long.length===1?'text':'texts'} again. Nothing was added.`);
 const held=new Map<string,Held[]>();
 for(const doc of [...existing,...removed.map(doc=>({...doc,removedAt:doc.removedAt||'removed'}))]){const key=fold(doc.name),list=held.get(key);if(list)list.push(doc);else held.set(key,[doc]);}
 // A new name avoids the names in the study and the names of the other new texts.
 const used=new Set(held.keys()),coming=new Set(texts.map(text=>fold(text.name))),contents=new Map<Blob,Promise<string>>(),fitted:NewText[]=[];
 const read=(file:Blob)=>{let content=contents.get(file);if(!content){content=file.text();contents.set(file,content);}return content;};
 let already=0,renamed=0;const returning=new Set<Held>();
 for(const text of texts){
  const same=held.get(fold(text.name));
  if(same){
   const size=new Blob([text.text]).size;let found:Held|undefined;
   for(const doc of same)if(doc.file&&doc.file.size===size&&!returning.has(doc)&&await read(doc.file)===text.text){found=doc;break;}
   if(found?.removedAt&&found.id){returning.add(found);fitted.push({...text,name:found.name,back:found.id});continue;}
   if(found){already++;continue;}
  }
  let name=text.name;
  if(used.has(fold(name))){
   const id=name.replace(/\.txt$/i,'');let n=2;
   while(used.has(fold(textName(`${id}_${n}`)))||coming.has(fold(textName(`${id}_${n}`))))n++;
   name=textName(`${id}_${n}`);renamed++;
  }
  used.add(fold(name));fitted.push(name===text.name?text:{...text,name});
 }
 return {texts:fitted,already,renamed,back:returning.size};
}
