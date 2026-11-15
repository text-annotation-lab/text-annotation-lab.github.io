'use client';
// Research tools for the queue: add human labels or metadata from a
// spreadsheet, and draw a reproducible random sample. Used by the Workspace
// (texts) and by Model knowledge (subjects).
import {useMemo,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {applySheet,columnIndex,columnValues,guessKeyColumn,guessRole,markColumn,matchRows,removeColumn,setRole,validColumnName,type Column,type Role,type Sheet} from '@/lib/research/columns';
import {SPREADSHEET_ACCEPT,parseSpreadsheet} from '@/lib/research/parse-table';
import {allocationNote,drawStratifiedSample,orderStrata,recordSample,sampleRecord,type SampleRecord} from '@/lib/research/sample';
import type {Row} from '@/lib/research/runs';

type Apply=(rows:Row[],columns:Column[],samples:SampleRecord[],notice:string,filter?:{column:string;value:string})=>void;
// `lead` is shown first in the row of tools (the cost calculator).
type Props={rows:Row[];columns:Column[];samples:SampleRecord[];unit:'text'|'subject';disabled?:boolean;onApply:Apply;lead?:ReactNode};
const plural=(n:number,unit:string)=>`${n.toLocaleString('en-US')} ${unit}${n===1?'':'s'}`;
const list=(names:string[],limit=5)=>names.slice(0,limit).join(', ')+(names.length>limit?`, and ${names.length-limit} more`:'');

export function ResearchTools({rows,columns,samples,unit,disabled,onApply,lead}:Props){
 const [dialog,setDialog]=useState<''|'labels'|'sample'>('');
 const labels=columns.filter(c=>c.role==='label'),meta=columns.filter(c=>c.role==='meta');
 return <div className="research-tools">
  <div className="research-tools-actions">
   {lead}
   <button type="button" className="textbutton" disabled={disabled||!rows.length} onClick={()=>setDialog('labels')}>Add labels or metadata from a spreadsheet…</button>
   <button type="button" className="textbutton" disabled={disabled||rows.length<2} onClick={()=>setDialog('sample')}>Draw a sample…</button>
  </div>
  {columns.length>0&&<details className="research-columns">
   <summary>{[labels.length?`Human labels: ${list(labels.map(c=>c.name),3)}`:'',meta.length?`Metadata: ${list(meta.map(c=>c.name),3)}`:''].filter(Boolean).join(' · ')}</summary>
   <ul>{columns.map(column=><li key={column.name}>
    <span className="research-column-name">{column.name}</span>
    <select aria-label={`What ${column.name} holds`} value={column.role} disabled={disabled} onChange={event=>onApply(rows,setRole(columns,column.name,event.target.value as 'label'|'meta'),samples,'')}><option value="label">Human labels</option><option value="meta">Metadata</option></select>
    <button type="button" className="textbutton" disabled={disabled} onClick={()=>{if(!confirm(`Remove the column “${column.name}” and its values from every ${unit}?`))return;const next=removeColumn(rows,columns,column.name);onApply(next.docs,next.columns,samples.filter(s=>s.column.toLowerCase()!==column.name.toLowerCase()),`Column “${column.name}” removed.`);}}>Remove</button>
   </li>)}</ul>
  </details>}
  {dialog==='labels'&&<LabelsDialog rows={rows} columns={columns} samples={samples} unit={unit} onApply={onApply} onClose={()=>setDialog('')}/>}
  {dialog==='sample'&&<SampleDialog rows={rows} columns={columns} samples={samples} unit={unit} onApply={onApply} onClose={()=>setDialog('')}/>}
 </div>;
}

function LabelsDialog({rows,columns,samples,unit,onApply,onClose}:Props&{onClose:()=>void}){
 const [sheet,setSheet]=useState<Sheet>(),[fileName,setFileName]=useState(''),[error,setError]=useState(''),[reading,setReading]=useState(false);
 const [keyIndex,setKeyIndex]=useState(0),[roles,setRoles]=useState<Role[]>([]);
 async function choose(file:File|undefined){
  if(!file)return;
  setReading(true);setError('');
  try{
   const parsed=await parseSpreadsheet(file);
   if(!parsed.header.length||!parsed.rows.length)throw new Error('This file has no rows below its header row.');
   const key=guessKeyColumn(rows,parsed);
   setSheet(parsed);setFileName(file.name);setKeyIndex(key);
   setRoles(parsed.header.map((name,i)=>i===key||!validColumnName(name)?'':columnIndex(columns,name)>=0?columns[columnIndex(columns,name)].role:guessRole(name)));
  }catch(problem){setSheet(undefined);setError(problem instanceof Error?problem.message:'This file could not be read.');}
  finally{setReading(false);}
 }
 const match=useMemo(()=>sheet?matchRows(rows,sheet.rows.map(row=>row[keyIndex]||'')):undefined,[sheet,keyIndex,rows]);
 const chosen=roles.filter((role,i)=>role&&i!==keyIndex).length;
 function apply(){
  if(!sheet||!match)return;
  const result=applySheet(rows,columns,sheet,keyIndex,roles);
  const notes=[`${plural(chosen,'column')} added to ${plural(result.matched,unit)}.`,result.unmatched.length?`${plural(result.unmatched.length,'row')} matched no ${unit}: ${list(result.unmatched)}.`:'',result.ambiguous.length?`${plural(result.ambiguous.length,'row')} matched more than one ${unit} and ${result.ambiguous.length===1?'was':'were'} skipped: ${list(result.ambiguous)}.`:'',result.repeated.length?`${plural(result.repeated.length,'row')} repeated a ${unit} that an earlier row had already matched and ${result.repeated.length===1?'was':'were'} skipped.`:'',result.changed?`${plural(result.changed,'earlier value')} replaced.`:''];
  onApply(result.docs,result.columns,samples,notes.filter(Boolean).join(' '));onClose();
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
  <DialogContent className="research-dialog research-wide">
   <DialogTitle>Add labels or metadata from a spreadsheet</DialogTitle>
   <DialogDescription>Choose a CSV or Excel file with one row per {unit}. One column names the {unit}s{unit==='text'?' (the file name, with or without its extension)':''}; the others can be added as human labels, to compare with the model’s answers, or as metadata such as year or author.</DialogDescription>
   <label className="research-file"><span>{fileName||'Choose a spreadsheet'}</span><input type="file" accept={SPREADSHEET_ACCEPT} aria-label="Choose a spreadsheet" onChange={event=>{void choose(event.target.files?.[0]);event.target.value='';}}/></label>
   {reading&&<p className="hint" role="status">Reading the spreadsheet…</p>}
   {error&&<p className="message" role="alert">{error}</p>}
   {sheet&&match&&<>
    <div className="research-field-row"><label htmlFor="labels-key">Column that names the {unit}s</label><select id="labels-key" value={keyIndex} onChange={event=>{const next=Number(event.target.value);setKeyIndex(next);setRoles(current=>current.map((role,i)=>i===next?'':role||(i===keyIndex&&validColumnName(sheet.header[i])?guessRole(sheet.header[i]):role)));}}>{sheet.header.map((name,i)=><option key={i} value={i}>{name}</option>)}</select></div>
    <p className={match.rowOf.size?'hint':'message'} role="status">{match.rowOf.size.toLocaleString('en-US')} of {plural(rows.length,unit)} matched by {plural(sheet.rows.length,'row')}.{match.unmatched.length?` ${plural(match.unmatched.length,'row')} matched no ${unit}: ${list(match.unmatched.map(row=>sheet.rows[row][keyIndex]||'(blank)'),3)}.`:''}{match.ambiguous.length?` ${plural(match.ambiguous.length,'row')} matched more than one ${unit}.`:''}</p>
    <div className="research-table-scroll"><table className="research-table"><thead><tr><th>Column</th><th>First values</th><th>Add as</th></tr></thead><tbody>{sheet.header.map((name,i)=>i===keyIndex?null:<tr key={i}>
     <td>{name}</td><td className="research-muted">{list([...new Set(sheet.rows.map(row=>row[i]).filter(Boolean))].slice(0,4),4)||'—'}</td>
     <td>{validColumnName(name)?<select aria-label={`Add ${name} as`} value={roles[i]||''} onChange={event=>setRoles(current=>current.map((role,j)=>j===i?event.target.value as Role:role))}><option value="label">Human labels</option><option value="meta">Metadata</option><option value="">Do not add</option></select>:<span className="research-muted">Name too long</span>}</td>
    </tr>)}</tbody></table></div>
    <p className="hint">Blank cells never erase a value that is already there. A column with the same name as an existing one updates it.</p>
   </>}
   <div className="research-dialog-actions"><Button type="button" disabled={!sheet||!match?.rowOf.size||!chosen} onClick={apply}>Add {chosen?plural(chosen,'column'):'columns'}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
  </DialogContent>
 </Dialog>;
}

function SampleDialog({rows,columns,samples,unit,onApply,onClose}:Props&{onClose:()=>void}){
 const [size,setSize]=useState(String(Math.min(50,Math.max(1,Math.round(rows.length/2))))),[seed,setSeed]=useState(()=>String(1+Math.floor(Math.random()*99999)));
 const [strata,setStrata]=useState<string[]>([]),[excludeColumn,setExcludeColumn]=useState(''),[excludeValue,setExcludeValue]=useState('');
 const [column,setColumn]=useState('sample'),[value,setValue]=useState('validation');
 const values=useMemo(()=>new Map(columns.map((c,i)=>[c.name,columnValues(rows,i)])),[rows,columns]);
 // Columns that group the texts (period, author, …): a few distinct values, not one per text.
 const groupColumns=orderStrata(columns.map(c=>c.name).filter(name=>{const n=values.get(name)?.length||0;return n>=2&&n<=200;}));
 const exclude=excludeColumn&&excludeValue?{column:excludeColumn,value:excludeValue}:null;
 const markedAs=validColumnName(column)&&value.trim()?{column:column.trim(),value:value.trim()}:null;
 const options={size:Number(size)||0,strata,exclude,markedAs,seed:Math.round(Number(seed))||0};
 const draw=useMemo(()=>drawStratifiedSample(rows as any,columns,options),[rows,columns,size,seed,strata.join('\n'),excludeColumn,excludeValue,column,value]);
 const markIndex=markedAs?columnIndex(columns,markedAs.column):-1;
 const already=markedAs&&markIndex>=0?rows.filter(row=>(row.cells?.[markIndex]??'')===markedAs.value).length:0;
 const taken=draw.taken.reduce((n,t)=>n+t.n,0),empty=draw.strata.filter(s=>s.drawn===0).length;
 function apply(){
  if(!markedAs||!draw.ids.length)return;
  const marked=markColumn(rows,columns,new Set(draw.ids),markedAs.column,markedAs.value,true);
  const record=sampleRecord({...options,markedAs},draw,new Date().toISOString().slice(0,10));
  onApply(marked.docs,marked.columns,recordSample(samples,record),`${plural(draw.ids.length,unit)} marked ${markedAs.column} = ${markedAs.value} (seed ${record.seed}). The draw is recorded with the study and listed under Export.`,{column:markedAs.column,value:markedAs.value});
  onClose();
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
  <DialogContent className="research-dialog research-wide">
   <DialogTitle>Draw a sample</DialogTitle>
   <DialogDescription>Draws {unit}s at random and marks them in a column. The same seed gives the same sample from the same eligible {unit}s; the rule and the seed are recorded with the study.</DialogDescription>
   <div className="research-grid">
    <div><label htmlFor="sample-size">Number of {unit}s</label><input id="sample-size" type="number" inputMode="numeric" min={1} max={rows.length} value={size} onChange={event=>setSize(event.target.value)}/></div>
    <div><label htmlFor="sample-seed">Seed</label><input id="sample-seed" type="number" inputMode="numeric" value={seed} onChange={event=>setSeed(event.target.value)}/></div>
   </div>
   <fieldset className="research-strata"><legend>Stratify by</legend>{groupColumns.length?groupColumns.map(name=><label key={name} className="research-check"><input type="checkbox" checked={strata.includes(name)} onChange={event=>setStrata(groupColumns.filter(other=>other===name?event.target.checked:strata.includes(other)))}/>{name}</label>):<p className="hint">No grouping columns yet. Add metadata such as period or author from a spreadsheet to stratify.</p>}</fieldset>
   {columns.length>0&&<div className="research-grid">
    <div><label htmlFor="sample-exclude">Leave out {unit}s where</label><select id="sample-exclude" value={excludeColumn} onChange={event=>{setExcludeColumn(event.target.value);setExcludeValue('');}}><option value="">(leave nothing out)</option>{columns.filter(c=>(values.get(c.name)?.length||0)<=200).map(c=><option key={c.name}>{c.name}</option>)}</select></div>
    {excludeColumn&&<div><label htmlFor="sample-exclude-value">is</label><select id="sample-exclude-value" value={excludeValue} onChange={event=>setExcludeValue(event.target.value)}><option value="">Choose…</option>{(values.get(excludeColumn)||[]).map(v=><option key={v}>{v}</option>)}</select></div>}
   </div>}
   <div className="research-grid">
    <div><label htmlFor="sample-column">Mark in column</label><input id="sample-column" value={column} maxLength={60} onChange={event=>setColumn(event.target.value)}/></div>
    <div><label htmlFor="sample-value">with the value</label><input id="sample-value" value={value} maxLength={60} onChange={event=>setValue(event.target.value)}/></div>
   </div>
   <p className="hint" role="status">{plural(draw.ids.length,unit)} of {draw.eligible.toLocaleString('en-US')} eligible{strata.length?`, ${allocationNote(draw.strata)}`:''}.{taken?` ${plural(taken,unit)} already marked with another value in “${column.trim()}” ${taken===1?'is':'are'} left out, so samples in one column do not overlap.`:''}{already?` Drawing again replaces the ${already.toLocaleString('en-US')} now marked ${column.trim()} = ${value.trim()}.`:''}</p>
   {strata.length>0&&<div className="research-table-scroll"><table className="research-table"><thead><tr><th>{strata.join(' · ')}</th><th>Eligible</th><th>Drawn</th></tr></thead><tbody>{draw.strata.map(s=><tr key={s.stratum} className={s.drawn?'':'research-muted'}><td>{s.stratum}</td><td>{s.available}</td><td>{s.drawn}</td></tr>)}</tbody></table></div>}
   {empty>0&&<p className="hint">{empty} of {draw.strata.length} groups get no {unit} because the sample is smaller than the number of groups.</p>}
   <div className="research-dialog-actions"><Button type="button" disabled={!markedAs||!draw.ids.length} onClick={apply}>Mark {plural(draw.ids.length,unit)}{markedAs?` as ${markedAs.column} = ${markedAs.value}`:''}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
  </DialogContent>
 </Dialog>;
}
