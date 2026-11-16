// A results table of the study's own runs is not a sheet of human labels. The tables in the supplementary
// repository have had no bookkeeping columns since November 16, 2026 (no n_ok or n_error; see
// resultsFileColumns for the columns that still give a results file away), so a sheet is also refused when it
// looks like one: a column under an answer field's name gives one run's answers exactly (for 10 or more texts,
// with 2 or more values), and every other column is the texts' own (their doc_id, text, explanation, or a label or
// metadata column of the study with the same values).
import {PLAIN_FIELD,slugKey} from '../answer-types';
import {columnIndex,type CellRow,type Column,type Sheet} from './columns';
import {rowForRun,type Row} from './runs';
import {valueOf} from './fields';

const fold=(value:unknown)=>String(value??'').normalize('NFC').trim().toLowerCase();
// Columns of the results tables that hold no answers and no labels.
const OWN=new Set(['doc_id','text','rationale','explanation','subject','source','n_characters','file']);

// The run numbers of a set of texts, and each run's answer fields with the column names a results table gives them.
function runFields(rows:Row[]):Map<number,{field:string;names:Set<string>}[]>{
 const runs=new Map<number,{field:string;names:Set<string>}[]>();
 for(const row of rows)for(const run of [row.runNo,...(row.earlier||[]).map(earlier=>earlier.runNo)]){
  if(typeof run!=='number'||runs.has(run))continue;
  const result=rowForRun(row,run);if(result.status!=='done')continue;
  const plain=Boolean(result.answerSettings?.plain),fields:string[]=plain?[PLAIN_FIELD]:result.answerFields?.length?result.answerFields:[''];
  runs.set(run,fields.map(field=>({field:plain?PLAIN_FIELD:field,names:new Set(field?[fold(field),fold(slugKey(field)),'answer_'+fold(slugKey(field))]:['score'])})));
 }
 return runs;
}

// The sheet's columns that copy a run's answers (none: the sheet may hold labels). keyIndex: the column that names
// the texts; rowOf: the text matched by each row of the sheet (matchRows).
export function copiedAnswers(rows:(Row&CellRow)[],columns:Column[],sheet:Sheet,keyIndex:number,rowOf:Map<string,number>):string[]{
 const matched=rows.filter(row=>rowOf.has(row.id));
 if(matched.length<10)return [];
 const cell=(row:Row,i:number)=>fold(sheet.rows[rowOf.get(row.id)!]?.[i]);
 for(const [run,fields] of runFields(rows)){
  const copied:number[]=[];
  sheet.header.forEach((name,i)=>{
   if(i===keyIndex)return;
   const spec=fields.find(f=>f.names.has(fold(name)));if(!spec)return;
   // Each matched text's answer in this run (a text without a usable answer has none).
   const answers=matched.map(row=>{const result=rowForRun(row,run);return result.status==='done'?fold(valueOf(result,spec.field)):'';});
   if(new Set(answers.filter(Boolean)).size>=2&&matched.every((row,k)=>cell(row,i)===answers[k]))copied.push(i);
  });
  if(!copied.length)continue;
  const own=sheet.header.every((name,i)=>{
   if(i===keyIndex||copied.includes(i)||OWN.has(fold(name)))return true;
   const at=columnIndex(columns,name);
   return at>=0&&matched.every(row=>!cell(row,i)||cell(row,i)===fold(row.cells?.[at]));
  });
  if(own)return copied.map(i=>sheet.header[i]);
 }
 return [];
}
