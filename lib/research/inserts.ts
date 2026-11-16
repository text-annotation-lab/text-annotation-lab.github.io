// Research mode: what a text gives the placeholders of the prompt (lib/prompt-inserts.ts), and what the setup
// panel says about them.
import {promptInserts,strayPlaceholders} from '../prompt-inserts';
import {columnIndex,cellOf,type Column} from './columns';

const metaColumn=(columns:Column[],name:string)=>{const index=columnIndex(columns,name.slice(5));return index>=0&&columns[index].role==='meta'?index:-1;};
// One value for each name: {{id}} is the text's name, {{meta.<column>}} its value in that metadata column.
// A column of human labels is never sent to the model, and a column the study does not have gives nothing.
export function insertValues(names:string[],row:{name?:unknown;cells?:string[]},columns:Column[]):string[]{
 return names.map(name=>name==='id'?String(row.name??''):cellOf(row,metaColumn(columns,name)));
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
 if(filled.length)notes.push(`Filled in for each ${unit}: ${list(filled.map(written))}.`);
 else if(!names.length&&!stray.length&&example)notes.push(`${written('meta.'+example.name)} in the prompt inserts each ${unit}’s value of that column; ${written('id')} inserts its name.`);
 if(missing.length)notes.push(`No such metadata column: ${list(missing)} (filled in empty).`);
 if(labels.length)notes.push(`Human labels are not sent to the model: ${list(labels)} (filled in empty).`);
 if(stray.length)notes.push(`Sent as written: ${list(stray)}.${stray.some(item=>/^\{\{\s*text\s*\}\}$/.test(item))?` The ${unit} always follows the prompt in a message of its own.`:''}`);
 return notes;
}
