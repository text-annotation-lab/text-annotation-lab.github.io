'use client';
// Research tools for the queue: add human labels or metadata from a
// spreadsheet, and draw a reproducible random sample. Used by the Workspace
// (texts) and by Model knowledge (subjects).
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {applySheet,columnIndex,columnValues,docIds,guessKeyColumn,guessRole,markColumn,matchRows,removeColumn,resultsFileColumns,setRole,validColumnName,type Column,type Role,type Sheet} from '@/lib/research/columns';
import {copiedAnswers} from '@/lib/research/label-guard';
import {SPREADSHEET_ACCEPT,parseSpreadsheet} from '@/lib/research/parse-table';
import {allocationNote,drawStratifiedSample,orderStrata,recordSample,sampleRecord,type SampleRecord} from '@/lib/research/sample';
import type {Row} from '@/lib/research/runs';
import {withRemoved} from '@/lib/research/removed';
import {PasteTextDialog,TableImportDialog,type AddTexts} from './import-texts';
import {askThen} from '@/lib/ask';

// removed: the deleted texts kept for their runs, when a change reaches them too (a label sheet).
type Apply=(rows:Row[],columns:Column[],samples:SampleRecord[],notice:string,filter?:{column:string;value:string},removed?:Row[])=>void;
// `lead` is shown first in the row of tools (the cost calculator). With `onAddTexts` (the Workspace), texts can be
// pasted, and `tableFile` is a table chosen in the drop zone whose rows are to become texts.
// removed: texts deleted from the study but kept for the runs that used them (adding one again brings it back).
// fields: the answer fields of the study (the prompt's and its runs'), for the guess at what a column holds.
type Props={rows:Row[];removed?:Row[];fields?:string[];columns:Column[];samples:SampleRecord[];unit:'text'|'subject';disabled?:boolean;onApply:Apply;lead?:ReactNode;onAddTexts?:AddTexts;tableFile?:File;onTableDone?:()=>void};
const plural=(n:number,unit:string)=>`${n.toLocaleString('en-US')} ${unit}${n===1?'':'s'}`;
const list=(names:string[],limit=5)=>names.slice(0,limit).join(', ')+(names.length>limit?`, and ${names.length-limit} more`:'');

export function ResearchTools({rows,removed,fields,columns,samples,unit,disabled,onApply,lead,onAddTexts,tableFile,onTableDone}:Props){
 const [dialog,setDialog]=useState<''|'labels'|'sample'|'paste'>(''),[labelSheet,setLabelSheet]=useState<{sheet:Sheet;fileName:string}>();
 const labels=columns.filter(c=>c.role==='label'),meta=columns.filter(c=>c.role==='meta');
 return <div className="research-tools">
  <div className="research-tools-actions">
   {lead}
   {onAddTexts&&<button type="button" className="textbutton" disabled={disabled} onClick={()=>setDialog('paste')}>Paste text…</button>}
   <button type="button" className="textbutton" disabled={disabled||!rows.length} onClick={()=>{setLabelSheet(undefined);setDialog('labels');}}>Add labels or metadata from a spreadsheet…</button>
   <button type="button" className="textbutton" disabled={disabled||rows.length<2} onClick={()=>setDialog('sample')}>Draw a sample…</button>
  </div>
  {columns.length>0&&<details className="research-columns">
   <summary>{[labels.length?`Human labels: ${list(labels.map(c=>c.name),3)}`:'',meta.length?`Metadata: ${list(meta.map(c=>c.name),3)}`:''].filter(Boolean).join(' · ')}</summary>
   <ul>{columns.map(column=><li key={column.name}>
    <span className="research-column-name">{column.name}</span>
    <select aria-label={`What ${column.name} holds`} value={column.role} disabled={disabled} onChange={event=>onApply(rows,setRole(columns,column.name,event.target.value as 'label'|'meta'),samples,'')}><option value="label">Human labels</option><option value="meta">Metadata</option></select>
    <button type="button" className="textbutton" disabled={disabled} onClick={()=>{const drawn=samples.filter(s=>s.column.toLowerCase()===column.name.toLowerCase()).length;askThen(`Remove the column “${column.name}” and its values from every ${unit}?${drawn?` The record of the ${drawn===1?'sample':`${drawn} samples`} drawn into it (rule and seed) goes too.`:''} This cannot be undone (add it again from a spreadsheet if needed).`,()=>{const next=removeColumn(rows,columns,column.name);onApply(next.docs,next.columns,samples.filter(s=>s.column.toLowerCase()!==column.name.toLowerCase()),`Column “${column.name}” removed.`);},{yes:'Remove column',danger:true});}}>Remove</button>
   </li>)}</ul>
  </details>}
  {dialog==='labels'&&<LabelsDialog rows={rows} removed={removed} fields={fields} columns={columns} samples={samples} unit={unit} onApply={onApply} initial={labelSheet} onClose={()=>{setDialog('');setLabelSheet(undefined);}}/>}
  {dialog==='paste'&&onAddTexts&&<PasteTextDialog rows={rows} removed={removed} onAdd={onAddTexts} onClose={()=>setDialog('')}/>}
  {tableFile&&onAddTexts&&!dialog&&<TableImportDialog key={tableFile.name+'/'+tableFile.size+'/'+tableFile.lastModified} file={tableFile} rows={rows} removed={removed} onAdd={onAddTexts} onClose={()=>onTableDone?.()} onUseAsLabels={(sheet,fileName)=>{setLabelSheet({sheet,fileName});setDialog('labels');onTableDone?.();}}/>}
  {dialog==='sample'&&<SampleDialog rows={rows} columns={columns} samples={samples} unit={unit} onApply={onApply} onClose={()=>setDialog('')}/>}
 </div>;
}

// `initial` is a table handed over from the import of texts (its rows match texts already in the study).
// A label sheet reaches the texts deleted from the study too: their labels still count in their runs' comparisons.
function LabelsDialog({rows,removed=[],fields=[],columns,samples,unit,onApply,onClose,initial}:Props&{onClose:()=>void;initial?:{sheet:Sheet;fileName:string}}){
 const [sheet,setSheet]=useState<Sheet>(),[fileName,setFileName]=useState(''),[error,setError]=useState(''),[reading,setReading]=useState(false);
 // An Excel workbook with several worksheets that hold data: the file, so that another worksheet can be read.
 const [book,setBook]=useState<File>();
 const [keyIndex,setKeyIndex]=useState(0),[roles,setRoles]=useState<Role[]>([]),[clearUnlisted,setClearUnlisted]=useState(false);
 const all=useMemo(()=>removed.length?[...rows,...removed]:rows,[rows,removed]);
 // Each text's doc_id as the exports give it, so a sheet keyed by doc_id finds the text it names.
 const ids=useMemo(()=>docIds({kind:unit==='subject'?'knowledge':'texts',rows:withRemoved(rows,removed)}),[rows,removed,unit]);
 function adopt(parsed:Sheet,name:string){
  const key=guessKeyColumn(rows,parsed,ids);
  setSheet(parsed);setFileName(name);setKeyIndex(key);
  setRoles(parsed.header.map((header,i)=>i===key||!validColumnName(header)?'':columnIndex(columns,header)>=0?columns[columnIndex(columns,header)].role:guessRole(header,fields)));
 }
 useEffect(()=>{if(initial)adopt(initial.sheet,initial.fileName);},[]);
 async function choose(file:File|undefined,sheetName?:string){
  if(!file)return;
  setReading(true);setError('');setBook(file);
  try{
   const parsed=await parseSpreadsheet(file,20,sheetName);
   if(!parsed.header.length||!parsed.rows.length)throw new Error('This file has no rows below its header row.');
   adopt(parsed,file.name);
  }catch(problem){setSheet(undefined);setError(problem instanceof Error?problem.message:'This file could not be read.');}
  finally{setReading(false);}
 }
 const match=useMemo(()=>sheet?matchRows(all,sheet.rows.map(row=>row[keyIndex]||''),ids):undefined,[sheet,keyIndex,all,ids]);
 const chosen=roles.filter((role,i)=>role&&i!==keyIndex).length;
 // What adding the sheet would do, shown before it is added.
 const plan=useMemo(()=>sheet&&chosen?applySheet(all,columns,sheet,keyIndex,roles,{clearUnlisted,ids}):undefined,[sheet,all,columns,keyIndex,roles,clearUnlisted,chosen,ids]);
 // The Lab's own results files hold the model's answers, which are not human labels.
 const exported=useMemo(()=>sheet?resultsFileColumns(sheet.header):[],[sheet]);
 // A lean results table (the supplementary repository's): a run's answers beside the texts' own columns.
 const copied=useMemo(()=>sheet&&match&&!exported.length?copiedAnswers(all,columns,sheet,keyIndex,match.rowOf):[],[sheet,match,exported,all,columns,keyIndex]);
 const gone=useMemo(()=>new Set(removed.map(row=>row.id)),[removed]),matchedGone=match?[...match.rowOf.keys()].filter(id=>gone.has(id)).length:0,unlistedGone=plan?plan.unlisted.filter(id=>gone.has(id)).length:0;
 const removedValues=(name:string)=>plan?.removed.get(name)||0;
 function apply(){
  if(!sheet||!match||!plan||plan.conflicts.length||exported.length||copied.length)return;
  const result=plan,dropped=[...result.removed.values()].reduce((n,v)=>n+v,0);
  const notes=[`${plural(chosen,'column')} added to ${plural(result.matched,unit)}${matchedGone?` (${matchedGone.toLocaleString('en-US')} of them deleted but kept for their runs)`:''}.`,result.unmatched.length?`${plural(result.unmatched.length,'row')} matched no ${unit}: ${list(result.unmatched)}.`:'',result.ambiguous.length?`${plural(result.ambiguous.length,'row')} matched more than one ${unit} and ${result.ambiguous.length===1?'was':'were'} skipped: ${list(result.ambiguous)}.`:'',result.repeated.length?`${plural(result.repeated.length,unit)} listed more than once with the same values, merged.`:'',result.changed?`${plural(result.changed,'earlier value')} replaced.`:'',dropped?`${plural(dropped,'earlier value')} removed.`:''];
  onApply(result.docs.filter(row=>!gone.has(row.id)),result.columns,samples,notes.filter(Boolean).join(' '),undefined,removed.length?result.docs.filter(row=>gone.has(row.id)):undefined);onClose();
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
  <DialogContent className="research-dialog research-wide">
   <DialogTitle>Add labels or metadata from a spreadsheet</DialogTitle>
   <DialogDescription>Choose a CSV or Excel file with one row per {unit}. One column names the {unit}s{unit==='text'?' (the file name, with or without its extension, or the doc_id from the exports)':''}; the others can be added as human labels, to compare with the model’s answers, or as metadata such as year or author.</DialogDescription>
   <label className="research-file"><span>{fileName||'Choose a spreadsheet'}</span><input type="file" accept={SPREADSHEET_ACCEPT} aria-label="Choose a spreadsheet" onChange={event=>{void choose(event.target.files?.[0]);event.target.value='';}}/></label>
   {book&&sheet?.sheets&&sheet.sheets.length>1&&<div className="research-field-row"><label htmlFor="labels-sheet">Worksheet</label><select id="labels-sheet" value={sheet.sheetName} disabled={reading} onChange={event=>{void choose(book,event.target.value);}}>{sheet.sheets.map(name=><option key={name} value={name}>{name}</option>)}</select></div>}
   {reading&&<p className="hint" role="status">Reading the spreadsheet…</p>}
   {error&&<p className="message" role="alert">{error}</p>}
   {sheet&&match&&<>
    <div className="research-field-row"><label htmlFor="labels-key">Column that names the {unit}s</label><select id="labels-key" value={keyIndex} onChange={event=>{const next=Number(event.target.value);setKeyIndex(next);setRoles(current=>current.map((role,i)=>i===next?'':role||(i===keyIndex&&validColumnName(sheet.header[i])?guessRole(sheet.header[i],fields):role)));}}>{sheet.header.map((name,i)=><option key={i} value={i}>{name}</option>)}</select></div>
    {exported.length>0&&<p className="message" role="alert">This is a results file exported from the Lab: it has the column{exported.length===1?'':'s'} {list(exported,4)}. Its values are the model’s answers, not human labels, so it cannot be added. To add metadata from it, delete those columns and the columns with the model’s answers, then add it again.</p>}
    {copied.length>0&&<p className="message" role="alert">This looks like a results file exported from the Lab: the column{copied.length===1?'':'s'} {list(copied,4)} {copied.length===1?'gives':'give'} a run’s answers exactly, and the other columns are the {unit}s’ own. The model’s answers are not human labels, so the sheet cannot be added. If these are labels that happen to agree with the model everywhere, put them in a column of their own name (for example, tone_human).</p>}
    {plan&&plan.conflicts.length>0&&<p className="message" role="alert">Several rows for the same {unit} with different values ({plan.conflicts.length.toLocaleString('en-US')}): {list(plan.conflicts,3)}. Only one row per {unit} can be used, not one row per coder: put each coder’s labels in a column of their own (tone_coder1, tone_coder2, …). Nothing is added until the sheet is fixed.</p>}
    <p className={match.rowOf.size?'hint':'message'} role="status">{(match.rowOf.size-matchedGone).toLocaleString('en-US')} of {plural(rows.length,unit)} matched by {plural(sheet.rows.length,'row')}{matchedGone?`, and ${plural(matchedGone,`deleted ${unit}`)} kept for ${matchedGone===1?'its':'their'} runs`:''}.{match.unmatched.length?` ${plural(match.unmatched.length,'row')} matched no ${unit}: ${list(match.unmatched.map(row=>sheet.rows[row][keyIndex]||'(blank)'),3)}.`:''}{match.ambiguous.length?` ${plural(match.ambiguous.length,'row')} matched more than one ${unit}.`:''}</p>
    <div className="research-table-scroll"><table className="research-table"><thead><tr><th>Column</th><th>First values</th><th>Add as</th></tr></thead><tbody>{sheet.header.map((name,i)=>i===keyIndex?null:<tr key={i}>
     <td>{name}</td><td className="research-muted">{list([...new Set(sheet.rows.map(row=>row[i]).filter(Boolean))].slice(0,4),4)||'—'}</td>
     <td>{validColumnName(name)?<select aria-label={`Add ${name} as`} value={roles[i]||''} onChange={event=>setRoles(current=>current.map((role,j)=>j===i?event.target.value as Role:role))}><option value="label">Human labels</option><option value="meta">Metadata</option><option value="">Do not add</option></select>:<span className="research-muted">Name too long</span>}</td>
    </tr>)}</tbody></table></div>
    <p className="hint">For the {unit}s this sheet lists, a column that is already there gets the sheet’s values, and a blank cell leaves no value. {unit==='text'?'Texts':'Subjects'} it does not list keep theirs.{plan&&plan.replaced.length>0?` Already present: ${plan.replaced.map(name=>name+(removedValues(name)?` (${plural(removedValues(name),'earlier value')} removed: blank here${clearUnlisted?' or not listed':''})`:'')).join(', ')}.`:''}{plan&&plan.repeated.length>0?` Listed more than once with the same values, merged: ${list(plan.repeated,3)}.`:''}</p>
    {plan&&plan.unlisted.length>0&&<label className="research-check"><input type="checkbox" checked={clearUnlisted} onChange={event=>setClearUnlisted(event.target.checked)}/> Also remove the values of the {plan.unlisted.length===1?unit:plural(plan.unlisted.length,unit)} this sheet does not list (in {list(plan.replaced,3)}{unlistedGone?`; ${plan.unlisted.length===1?'':unlistedGone===plan.unlisted.length?'all ':`${unlistedGone.toLocaleString('en-US')} of them `}deleted but kept for ${unlistedGone===1?'its':'their'} runs`:''}), for example when it replaces an earlier sheet for all {unit}s</label>}
   </>}
   <div className="research-dialog-actions"><Button type="button" disabled={!sheet||!match?.rowOf.size||!chosen||!plan||plan.conflicts.length>0||exported.length>0||copied.length>0} onClick={apply}>Add {chosen?plural(chosen,'column'):'columns'}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
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
 const already=markedAs&&markIndex>=0?rows.filter(row=>(row.cells?.[markIndex]??'').trim().toLowerCase()===markedAs.value.toLowerCase()).length:0;
 const taken=draw.taken.reduce((n,t)=>n+t.n,0),empty=draw.strata.filter(s=>s.drawn===0).length;
 function apply(){
  if(!markedAs||!draw.ids.length)return;
  const marked=markColumn(rows,columns,new Set(draw.ids),markedAs.column,markedAs.value,true);
  const record=sampleRecord({...options,markedAs},draw,new Date().toISOString().slice(0,10));
  onApply(marked.docs,marked.columns,recordSample(samples,record),`${plural(draw.ids.length,unit)} marked ${markedAs.column} = ${markedAs.value} (seed ${record.seed}). The draw is recorded with the study and in its exports.`,{column:markedAs.column,value:markedAs.value});
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
   {strata.length>0&&<div className="research-table-scroll"><table className="research-table"><thead><tr><th>{strata.join(' · ')}</th><th>Eligible</th><th>Drawn</th></tr></thead><tbody>{draw.strata.map((s,i)=><tr key={i} className={s.drawn?'':'research-muted'}><td>{s.stratum}</td><td>{s.available}</td><td>{s.drawn}</td></tr>)}</tbody></table></div>}
   {empty>0&&<p className="hint">{empty} of {draw.strata.length} groups get no {unit} because the sample is smaller than the number of groups.</p>}
   <div className="research-dialog-actions"><Button type="button" disabled={!markedAs||!draw.ids.length} onClick={apply}>Mark {plural(draw.ids.length,unit)}{markedAs?` as ${markedAs.column} = ${markedAs.value}`:''}</Button><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
  </DialogContent>
 </Dialog>;
}
