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
// doc_id: the name of each text in the exports' tables, the key that joins them, and what {{id}} fills in. A
// text's name without the extension of its file (article.md → article; a text from a table, named after its ID,
// keeps the ID), a subject's name as it is; a name another text of the study already has gets _2, _3, … in the
// study's order (deleted texts a run used keep their place: lib/research/removed.ts, withRemoved).
type Named={id:unknown;name?:unknown};
const idCache=new WeakMap<Named[],Map<string,string>>();
export function docIds(dataset:{kind:string;rows:Named[]}):Map<string,string>{
 let ids=idCache.get(dataset.rows);if(ids)return ids;
 ids=new Map();const taken=new Set<string>();
 for(const row of dataset.rows){
  const name=String(row.name??''),base=(dataset.kind==='knowledge'?name:stem(name))||String(row.id);
  let id=base;for(let n=2;taken.has(id.toLowerCase());n++)id=`${base}_${n}`;
  taken.add(id.toLowerCase());ids.set(String(row.id),id);
 }
 idCache.set(dataset.rows,ids);return ids;
}
export const docIdOf=(dataset:{kind:string;rows:Named[]},row:Named)=>docIds(dataset).get(String(row.id))??String(row.name??row.id);
export const validColumnName=(name:string)=>{const n=tidy(name);return n.length>0&&n.length<=60;};
// A table that holds a whole corpus, one text per row (research mode's drop zone).
export const CORPUS_TABLE=/\.(csv|tsv|xlsx?|jsonl?)$/i;

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
// more: the later rows that named a text an earlier row had already matched (by text). named: the texts a row
// named that matched more than one of them, which the row leaves alone.
export function matchRows(docs:CellRow[],keys:string[]):{rowOf:Map<string,number>;unmatched:number[];ambiguous:number[];repeated:number[];more:Map<string,number[]>;named:Set<string>}{
 const exact=new Map<string,CellRow[]>(),loose=new Map<string,CellRow[]>(),sources=new Map<string,CellRow[]>();
 const push=(map:Map<string,CellRow[]>,key:string,doc:CellRow)=>{if(!key)return;const list=map.get(key);if(list)list.push(doc);else map.set(key,[doc]);};
 for(const doc of docs){
  push(exact,fold(doc.name),doc);push(loose,fold(stem(tidy(doc.name))),doc);
  if(doc.sourceName){push(sources,fold(doc.sourceName),doc);push(sources,fold(stem(tidy(doc.sourceName))),doc);}
 }
 const rowOf=new Map<string,number>(),unmatched:number[]=[],ambiguous:number[]=[],repeated:number[]=[],more=new Map<string,number[]>(),named=new Set<string>();
 keys.forEach((raw,row)=>{
  const key=fold(raw);if(!key)return;
  // Paths in a manifest ("texts/1961-Kennedy.txt") match by their file name.
  const base=key.split(/[\\/]/).pop()||key;
  let found=exact.get(key)||exact.get(base)||loose.get(fold(stem(key)))||loose.get(fold(stem(base)));
  let chunks=false;
  if(!found){found=sources.get(key)||sources.get(base)||sources.get(fold(stem(base)));chunks=Boolean(found);}
  if(!found){unmatched.push(row);return;}
  if(found.length>1&&!chunks){ambiguous.push(row);for(const doc of found)named.add(doc.id);return;}
  if(found.some(doc=>rowOf.has(doc.id))){repeated.push(row);for(const doc of found)if(rowOf.has(doc.id))more.set(doc.id,[...(more.get(doc.id)||[]),row]);return;}
  for(const doc of found)rowOf.set(doc.id,row);
 });
 return {rowOf,unmatched,ambiguous,repeated,more,named};
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
// A first guess at what each column holds, from its name. A column named after an answer field, alone or with
// marker words (tone, tone_coder2, gold_tone, tone_expert), holds human labels; so does one whose name has a word
// such as coder, rater, gold, or human, with or without a number (coder2).
const MARKER=/^(gold|human|coder|rater|annotator|pilot|expert|final|consensus|standard|coded|reference|adjudicated|manual)\d*$/;
const words=(name:string)=>fold(name).split(/[\s_.-]+/).filter(Boolean);
export function guessRole(name:string,fields:string[]=[]):Role{
 const parts=words(name);let i=0,j=parts.length;
 while(j-i>1&&MARKER.test(parts[j-1]))j--;
 while(j-i>1&&MARKER.test(parts[i]))i++;
 const core=parts.slice(i,j).join('_');
 if(core&&fields.some(field=>words(field).join('_')===core))return 'label';
 return /\b(label|labels|code|coded|coder|coding|human|gold|manual|rating|rated|rater|annotat\w*|score|judg\w*|expert|consensus|adjudicated)\d*\b/i.test(name.replace(/[_-]+/g,' '))?'label':'meta';
}

// Add the chosen columns' values to the texts a sheet lists. For those texts a column gets the sheet's value,
// and a blank cell leaves none. Texts the sheet does not list keep their values, unless `clearUnlisted` (a
// sheet that replaces an earlier one for all texts); a text named by a row that matches more than one text
// keeps its values too. Several rows for one text are merged when no value differs; when values differ (one
// row per coder, say), the sheet cannot be used as it is: `conflicts` names those texts and nothing changes.
// replaced: the chosen columns that already hold values. removed: per such column, the earlier values that
// go (blank here, or not listed). unlisted: the ids of the texts not listed that hold a value in one of them.
export type SheetResult<T>={docs:T[];columns:Column[];matched:number;unmatched:string[];ambiguous:string[];repeated:string[];conflicts:string[];changed:number;added:string[];replaced:string[];removed:Map<string,number>;unlisted:string[]};
export function applySheet<T extends CellRow>(docs:T[],columns:Column[],sheet:Sheet,keyIndex:number,roles:Role[],options:{clearUnlisted?:boolean}={}):SheetResult<T>{
 const next=columns.map(c=>({...c})),targets:{from:number;to:number}[]=[],added:string[]=[];
 sheet.header.forEach((header,from)=>{
  const role=roles[from];if(!role||from===keyIndex||!validColumnName(header))return;
  let to=columnIndex(next,header);
  if(to<0){next.push({name:tidy(header),role});to=next.length-1;added.push(tidy(header));}else next[to].role=role;
  targets.push({from,to});
 });
 const keys=sheet.rows.map(row=>row[keyIndex]||''),match=matchRows(docs,keys);
 // The values each listed text gets: every row that names it, merged.
 const values=new Map<string,string[]>(),conflicts:string[]=[],repeated:string[]=[];
 for(const [id,first] of match.rowOf){
  const rows=[first,...(match.more.get(id)||[])],merged=targets.map(()=>'');let differ=false;
  for(const row of rows)targets.forEach(({from},t)=>{const value=tidy(sheet.rows[row][from]);if(!value)return;if(merged[t]&&merged[t]!==value)differ=true;else merged[t]=value;});
  if(rows.length>1)(differ?conflicts:repeated).push(keys[first]);
  values.set(id,merged);
 }
 const had=new Set(targets.filter(({to})=>docs.some(doc=>doc.cells?.[to])).map(({to})=>to));
 const replaced=targets.filter(({to})=>had.has(to)).map(({to})=>next[to].name),removed=new Map<string,number>();
 let changed=0;const unlisted:string[]=[];
 const result=docs.map(doc=>{
  const listed=values.get(doc.id);
  if(!listed){
   if(match.named.has(doc.id)||!targets.some(({to})=>had.has(to)&&doc.cells?.[to]))return doc;
   unlisted.push(doc.id);if(!options.clearUnlisted)return doc;
  }
  const cells=Array.from({length:next.length},(_,i)=>doc.cells?.[i]??'');
  targets.forEach(({to},t)=>{
   const value=listed?listed[t]:'';
   if(!listed&&!had.has(to))return;
   if(cells[to]&&!value)removed.set(next[to].name,(removed.get(next[to].name)||0)+1);else if(cells[to]&&cells[to]!==value)changed++;
   cells[to]=value;
  });
  return cells.some(Boolean)?{...doc,cells}:(doc.cells?{...doc,cells:undefined}:doc);
 });
 const name=(rows:number[])=>rows.map(row=>keys[row]);
 return {docs:conflicts.length?docs:result,columns:conflicts.length?columns:next,matched:match.rowOf.size,unmatched:name(match.unmatched),ambiguous:name(match.ambiguous),repeated,conflicts,changed,added,replaced,removed,unlisted};
}

// Columns only the Lab's own results files have (the tables of a run and of its requests, and the standard
// Lab's workbook). A sheet with one of them holds the model's answers, not human labels. response_id alone is
// not enough: a survey's export may have a column of that name.
const RESULTS_COLUMNS=new Set(['n_ok','n_error','prompt_hash','model_requested','model_reported','stop_reason','request_id','lab_version','sent_again','reasoning_tokens','cache_read_tokens','cache_write_tokens','annotation id','annotated / collected at (utc)']);
export function resultsFileColumns(header:string[]):string[]{
 return header.filter(name=>RESULTS_COLUMNS.has(fold(name))||/^run\d+_explanation$/.test(fold(name))||/_replicate_agreement$/.test(fold(name)));
}

// Texts added from a table or from pasted text. `values` holds what the table's
// other columns say about each text, in the order of `names`; those columns
// join the study's columns (a column with the same name is reused).
// back: the id of a deleted text that this one brings back (the same name and the same text; research mode).
export type NewText={name:string;text:string;values:string[];back?:string};
export function appendTexts<T extends CellRow>(docs:T[],columns:Column[],texts:NewText[],names:string[],make:(text:NewText)=>T,fields:string[]=[]):{docs:T[];columns:Column[]}{
 const next=columns.map(c=>({...c}));
 const to=names.map(name=>{let index=columnIndex(next,name);if(index<0){next.push({name:tidy(name),role:guessRole(name,fields)==='label'?'label':'meta'});index=next.length-1;}return index;});
 const added=texts.map(text=>{
  const doc=make(text);if(!to.length)return doc;
  // A text brought back keeps its values; the table's values are written over them.
  const cells=Array.from({length:next.length},(_,i)=>doc.cells?.[i]??'');
  to.forEach((index,from)=>{const value=tidy(text.values[from]);if(value)cells[index]=value;});
  return cells.some(Boolean)?{...doc,cells}:doc;
 });
 return {docs:[...docs,...added],columns:next};
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
