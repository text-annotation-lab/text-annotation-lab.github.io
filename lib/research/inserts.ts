// Research mode: what a text gives the placeholders of the prompt (lib/prompt-inserts.ts), and what the setup
// panel says about them.
import {promptInserts,strayPlaceholders,placesText} from '../prompt-inserts';
import {columnIndex,cellOf,type Column} from './columns';

const metaColumn=(columns:Column[],name:string)=>{const index=columnIndex(columns,name.slice(5));return index>=0&&columns[index].role==='meta'?index:-1;};
// One value for each name: {{id}} is the text's doc_id (its name without the file's extension, as in the exports;
// lib/research/export.ts), {{meta.<column>}} its value in that metadata column. Runs before 2026-11-16 filled in
// {{id}} with the name as it was; each result keeps the values it was sent with. A column of human labels is never
// sent to the model, and a column the study does not have gives nothing.
export function insertValues(names:string[],row:{cells?:string[]},columns:Column[],id:string):string[]{
 return names.map(name=>name==='id'?id:cellOf(row,metaColumn(columns,name)));
}
// The lines under the prompt box. unit: what a request is about ("text" or "subject").
export function insertNotes(prompt:string,columns:Column[],unit:'text'|'subject'):string[]{
 const names=promptInserts(prompt),stray=strayPlaceholders(prompt),written=(name:string)=>`{{${name}}}`,list=(items:string[])=>items.join(', ');
 const columnOf=(name:string)=>columnIndex(columns,name.slice(5));
 const filled=names.filter(name=>name==='id'||metaColumn(columns,name)>=0);
 const labels=names.filter(name=>name!=='id'&&columnOf(name)>=0&&metaColumn(columns,name)<0).map(name=>name.slice(5));
 const missing=names.filter(name=>name!=='id'&&columnOf(name)<0).map(name=>name.slice(5));
 const example=columns.find(column=>column.role==='meta');
 const notes:string[]=[];
 const placed=placesText(prompt);
 if(placed)notes.push(`The ${unit==='subject'?'subject’s fields go':'text goes'} where the prompt has {{text}}, instead of after the prompt.`);
 if(filled.length)notes.push(`Filled in for each ${unit}: ${list(filled.map(written))}.`);
 else if(!names.length&&!stray.length&&!placed)notes.push(`{{text}} in the prompt places each ${unit} there instead of after the prompt${example?`; ${written('meta.'+example.name)} inserts its value of that column, and ${written('id')} its name${unit==='text'?' without the file extension':''}`:''}.`);
 if(missing.length)notes.push(`No such metadata column: ${list(missing)} (filled in empty).`);
 if(labels.length)notes.push(`Human labels are not sent to the model: ${list(labels)} (filled in empty).`);
 if(stray.length)notes.push(`Sent as written: ${list(stray)}.`);
 return notes;
}
// "Retry failed" sends a run's requests again with the values that run sent, not the study's values of today (a
// metadata column may have been edited since). They are read from what the text kept of that run: its earliest
// failed attempt, its result, or one of its annotations, whichever recorded them first. undefined: none recorded
// (a run made before values were kept), and today's values are filled in.
export function sentInserts(row:{[key:string]:any},run:number,count:number):string[]|undefined{
 const fits=(value:unknown):value is string[]=>Array.isArray(value)&&value.length===count&&value.every(v=>typeof v==='string');
 const ofRun=(record:any)=>record&&typeof record==='object'&&record.runNo===run;
 const records:any[]=[];
 for(const result of [row,...(Array.isArray(row.earlier)?row.earlier:[])]){
  if(!result||typeof result!=='object')continue;
  for(const attempt of Array.isArray(result.history)?result.history:[])if(ofRun(attempt)||ofRun(result)&&attempt?.runNo===undefined)records.push(attempt,...(Array.isArray(attempt?.annotations)?attempt.annotations:[]));
  if(ofRun(result))records.push(result,...(Array.isArray(result.annotations)?result.annotations:[]));
 }
 return records.map(record=>record?.inserts).find(fits);
}
