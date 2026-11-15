// Labels and metadata. A study has a list of columns (human labels, or other
// information about the texts such as year or author), and each text holds its
// values in `cells`, in the same order. Values are kept by position, never
// under the column's name, so any column name is safe in backups.

export type Column={name:string;role:'label'|'meta'};
export type Sheet={header:string[];rows:string[][]};
export type CellRow={id:string;name:string;sourceName?:string;cells?:string[];[key:string]:any};
export type Role=''|'label'|'meta';

const tidy=(value:unknown)=>String(value??'').normalize('NFC').trim();
const fold=(value:unknown)=>tidy(value).toLowerCase();
// A file name without its extension: "1961-Kennedy.txt" and "1961-Kennedy" match.
export const stem=(name:string)=>name.replace(/\.(txt|md|markdown|pdf|docx?|html?|rtf|odt|csv|tsv|xlsx?|ods|jsonl?)$/i,'');
export const validColumnName=(name:string)=>{const n=tidy(name);return n.length>0&&n.length<=60;};

export function cleanColumns(value:unknown):Column[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<string>(),columns:Column[]=[];
 for(const c of value){
  // Keep the position of every column, even an unreadable one, so cells stay aligned.
  const name=c&&typeof c==='object'&&typeof c.name==='string'&&validColumnName(c.name)&&!seen.has(fold(c.name))?tidy(c.name):'Column '+(columns.length+1);
  seen.add(fold(name));columns.push({name,role:c&&c.role==='label'?'label':'meta'});
 }
 return columns;
}
export const columnIndex=(columns:Column[],name:string)=>columns.findIndex(c=>fold(c.name)===fold(name));
export const cellOf=(row:{cells?:string[]},index:number)=>index<0?'':row.cells?.[index]??'';
export function columnValues(rows:{cells?:string[]}[],index:number,limit=200):string[]{
 const values=new Set<string>();
 for(const row of rows){const v=cellOf(row,index);if(v)values.add(v);if(values.size>limit)break;}
 return [...values].sort((a,b)=>a.localeCompare(b,'en',{numeric:true}));
}

// Which spreadsheet row belongs to which text. A row matches a text by file
// name, with or without the extension, ignoring case. A row that names the
// source of chunked texts applies to all of its chunks.
export function matchRows(docs:CellRow[],keys:string[]):{rowOf:Map<string,number>;unmatched:number[];ambiguous:number[];repeated:number[]}{
 const exact=new Map<string,CellRow[]>(),loose=new Map<string,CellRow[]>(),sources=new Map<string,CellRow[]>();
 const push=(map:Map<string,CellRow[]>,key:string,doc:CellRow)=>{if(!key)return;const list=map.get(key);if(list)list.push(doc);else map.set(key,[doc]);};
 for(const doc of docs){
  push(exact,fold(doc.name),doc);push(loose,fold(stem(tidy(doc.name))),doc);
  if(doc.sourceName){push(sources,fold(doc.sourceName),doc);push(sources,fold(stem(tidy(doc.sourceName))),doc);}
 }
 const rowOf=new Map<string,number>(),unmatched:number[]=[],ambiguous:number[]=[],repeated:number[]=[];
 keys.forEach((raw,row)=>{
  const key=fold(raw);if(!key)return;
  // Paths in a manifest ("texts/1961-Kennedy.txt") match by their file name.
  const base=key.split(/[\\/]/).pop()||key;
  let found=exact.get(key)||exact.get(base)||loose.get(fold(stem(key)))||loose.get(fold(stem(base)));
  let chunks=false;
  if(!found){found=sources.get(key)||sources.get(base)||sources.get(fold(stem(base)));chunks=Boolean(found);}
  if(!found){unmatched.push(row);return;}
  if(found.length>1&&!chunks){ambiguous.push(row);return;}
  if(found.some(doc=>rowOf.has(doc.id))){repeated.push(row);return;}
  for(const doc of found)rowOf.set(doc.id,row);
 });
 return {rowOf,unmatched,ambiguous,repeated};
}
// The column that names the texts: the one whose values match the most texts.
export function guessKeyColumn(docs:CellRow[],sheet:Sheet):number{
 let best=0,bestCount=-1;
 sheet.header.forEach((_,index)=>{
  const count=matchRows(docs,sheet.rows.slice(0,2000).map(row=>row[index]||'')).rowOf.size;
  if(count>bestCount){best=index;bestCount=count;}
 });
 return best;
}
// A first guess at what each column holds, from its name.
export function guessRole(name:string):Role{
 return /\b(label|labels|code|coded|coder|coding|human|gold|manual|rating|rated|rater|annotat\w*|score|judg\w*)\b/i.test(name.replace(/[_-]+/g,' '))?'label':'meta';
}

// Add the chosen columns' values to the texts they match. A blank cell never
// erases a value that is already there.
export function applySheet<T extends CellRow>(docs:T[],columns:Column[],sheet:Sheet,keyIndex:number,roles:Role[]):{docs:T[];columns:Column[];matched:number;unmatched:string[];ambiguous:string[];repeated:string[];changed:number;added:string[]}{
 const next=columns.map(c=>({...c})),targets:{from:number;to:number}[]=[],added:string[]=[];
 sheet.header.forEach((header,from)=>{
  const role=roles[from];if(!role||from===keyIndex||!validColumnName(header))return;
  let to=columnIndex(next,header);
  if(to<0){next.push({name:tidy(header),role});to=next.length-1;added.push(tidy(header));}else next[to].role=role;
  targets.push({from,to});
 });
 const keys=sheet.rows.map(row=>row[keyIndex]||''),match=matchRows(docs,keys);
 let changed=0;
 const result=docs.map(doc=>{
  const row=match.rowOf.get(doc.id);if(row===undefined)return doc;
  const cells=Array.from({length:next.length},(_,i)=>doc.cells?.[i]??'');
  for(const {from,to} of targets){const value=tidy(sheet.rows[row][from]);if(!value)continue;if(cells[to]&&cells[to]!==value)changed++;cells[to]=value;}
  return {...doc,cells};
 });
 const name=(rows:number[])=>rows.map(row=>keys[row]);
 return {docs:result,columns:next,matched:match.rowOf.size,unmatched:name(match.unmatched),ambiguous:name(match.ambiguous),repeated:name(match.repeated),changed,added};
}

// Write one value in one column for the chosen texts (used to mark a sample).
// With `clearOthers`, texts that held this value before and are not chosen lose it.
export function markColumn<T extends CellRow>(docs:T[],columns:Column[],ids:Set<string>,name:string,value:string,clearOthers=false):{docs:T[];columns:Column[]}{
 const next=columns.map(c=>({...c}));let index=columnIndex(next,name);
 if(index<0){next.push({name:tidy(name),role:'meta'});index=next.length-1;}
 return {columns:next,docs:docs.map(doc=>{
  const held=doc.cells?.[index]??'';
  const target=ids.has(doc.id)?value:clearOthers&&held===value?'':held;
  if(target===held&&(doc.cells?.length??0)>=next.length)return doc;
  if(target===held&&!doc.cells?.length)return doc;
  const cells=Array.from({length:next.length},(_,i)=>doc.cells?.[i]??'');cells[index]=target;
  return {...doc,cells};
 })};
}
export function removeColumn<T extends CellRow>(docs:T[],columns:Column[],name:string):{docs:T[];columns:Column[]}{
 const index=columnIndex(columns,name);if(index<0)return {docs,columns};
 return {columns:columns.filter((_,i)=>i!==index),docs:docs.map(doc=>{
  if(!doc.cells?.length)return doc;
  const cells=doc.cells.filter((_,i)=>i!==index);
  return {...doc,cells:cells.some(Boolean)?cells:undefined};
 })};
}
export function setRole(columns:Column[],name:string,role:'label'|'meta'):Column[]{
 const index=columnIndex(columns,name);
 return index<0?columns:columns.map((c,i)=>i===index?{...c,role}:c);
}
