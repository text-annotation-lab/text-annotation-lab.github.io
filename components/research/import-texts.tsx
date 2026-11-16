'use client';
// Research mode: add texts from a table (one row per text) or from pasted text.
import {useEffect,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {guessKeyColumn,matchRows,type CellRow,type NewText,type Sheet} from '@/lib/research/columns';
import {countWords,fitIntoStudy,guessIdColumn,guessTextColumn,parseCorpusTable,pastedTexts,planTable,splitPasted} from '@/lib/research/import-texts';

// Adds the texts to the study; false when the workspace cannot take them right now.
export type AddTexts=(texts:NewText[],names:string[],message:string)=>boolean;
type Existing=CellRow&{file?:Blob};
const plural=(n:number,unit:string)=>`${n.toLocaleString('en-US')} ${unit}${n===1?'':'s'}`;
const BUSY='The texts could not be added while the workspace is busy. Try again in a moment.';
function leftOut(already:number,renamed:number,back=0,added=0){
 return (back?` ${back===added?(back===1?'It had':'They had'):`${back.toLocaleString('en-US')} of them had`} been deleted before: the results earlier runs made for ${back===1?'it are its':'them are theirs'} again.`:'')+(already?` ${plural(already,'text')} already in this study ${already===1?'was':'were'} left out.`:'')+(renamed?` ${plural(renamed,'text')} got a new name because ${renamed===1?'its name was':'their names were'} taken by a different text.`:'');
}

export function PasteTextDialog({rows,removed,onAdd,onClose}:{rows:Existing[];removed?:Existing[];onAdd:AddTexts;onClose:()=>void}){
 const [text,setText]=useState(''),[mode,setMode]=useState<'none'|'blank'|'line'>('none'),[prefix,setPrefix]=useState('pasted'),[adding,setAdding]=useState(false),[problem,setProblem]=useState('');
 const parts=useMemo(()=>splitPasted(text,mode),[text,mode]);
 async function add(){
  if(!parts.length||adding)return;
  setAdding(true);setProblem('');
  try{
   const fitted=await fitIntoStudy(pastedTexts(parts,prefix),rows,removed);
   if(!fitted.texts.length){setProblem(parts.length===1?'This text is already in the study under the same name.':'These texts are already in the study under the same names.');return;}
   if(onAdd(fitted.texts,[],`${plural(fitted.texts.length,'text')} added from pasted text.${leftOut(fitted.already,fitted.renamed,fitted.back,fitted.texts.length)}`))onClose();else setProblem(BUSY);
  }catch{setProblem('The pasted text could not be added. Try again.');}
  finally{setAdding(false);}
 }
 const close=()=>{if(adding)return;if(text.trim()&&!confirm('Close without adding what you pasted?'))return;onClose();};
 return <Dialog open onOpenChange={open=>{if(!open)close();}}>
  <DialogContent className="research-dialog research-wide">
   <DialogTitle>Paste text</DialogTitle>
   <DialogDescription>Paste one text, or several to split into separate texts. Each text is stored as a plain-text document named after the ID prefix.</DialogDescription>
   <textarea className="research-paste" rows={12} autoFocus value={text} aria-label="Text to add" placeholder="Paste one or more texts…" onChange={event=>setText(event.target.value)}/>
   <div className="research-grid">
    <div><label htmlFor="paste-split">Split into separate texts</label><select id="paste-split" value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="none">No: one text</option><option value="blank">At blank lines (paragraphs)</option><option value="line">At every line</option></select></div>
    <div><label htmlFor="paste-prefix">ID prefix</label><input id="paste-prefix" value={prefix} maxLength={60} onChange={event=>setPrefix(event.target.value.replace(/\s+/g,'_'))}/></div>
   </div>
   <p className="hint" role="status">{plural(parts.length,'text')} · {plural(countWords(text),'word')}</p>
   {problem&&<p className="message" role="alert">{problem}</p>}
   <div className="research-dialog-actions"><Button type="button" disabled={!parts.length||adding} onClick={add}>{adding?'Adding…':`Add ${parts.length?plural(parts.length,'text'):'texts'}`}</Button><Button type="button" variant="outline" disabled={adding} onClick={close}>Cancel</Button></div>
  </DialogContent>
 </Dialog>;
}

export function TableImportDialog({file,rows,removed,onAdd,onClose,onUseAsLabels}:{file:File;rows:Existing[];removed?:Existing[];onAdd:AddTexts;onClose:()=>void;onUseAsLabels:(sheet:Sheet,fileName:string)=>void}){
 const [sheet,setSheet]=useState<Sheet>(),[error,setError]=useState(''),[textIndex,setTextIndex]=useState(0),[idIndex,setIdIndex]=useState(-1),[adding,setAdding]=useState(false),[problem,setProblem]=useState('');
 useEffect(()=>{
  let current=true;
  parseCorpusTable(file).then(parsed=>{
   if(!current)return;
   if(!parsed.header.length||!parsed.rows.length){setError('This table has no rows below its header row.');return;}
   const text=guessTextColumn(parsed),id=guessIdColumn(parsed);
   setSheet(parsed);setTextIndex(text);setIdIndex(id===text?-1:id);
  }).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'This table could not be read.');});
  return()=>{current=false;};
 },[file]);
 const plan=useMemo(()=>sheet?planTable(sheet,textIndex,idIndex,file.name):undefined,[sheet,textIndex,idIndex,file.name]);
 // A sheet of labels or metadata for texts already here would otherwise become one junk text per row.
 const matched=useMemo(()=>sheet&&rows.length?matchRows(rows,sheet.rows.map(row=>row[guessKeyColumn(rows,sheet)]||'')).rowOf.size:0,[sheet,rows]);
 async function add(){
  if(!plan?.texts.length||adding)return;
  setAdding(true);setProblem('');
  try{
   const fitted=await fitIntoStudy(plan.texts,rows,removed);
   if(!fitted.texts.length){setProblem('Every text in this table is already in the study.');return;}
   const columns=plan.names.length?` ${plural(plan.names.length,'column')} kept as labels or metadata.`:'';
   if(onAdd(fitted.texts,plan.names,`${plural(fitted.texts.length,'text')} added from ${file.name}.${columns}${leftOut(fitted.already,fitted.renamed,fitted.back,fitted.texts.length)}`))onClose();else setProblem(BUSY);
  }catch{setProblem('The table could not be imported. Try again.');}
  finally{setAdding(false);}
 }
 const close=()=>{if(!adding)onClose();};
 const shown=sheet?sheet.header.map((_,i)=>i).slice(0,6):[];
 return <Dialog open onOpenChange={open=>{if(!open)close();}}>
  <DialogContent className="research-dialog research-wide">
   <DialogTitle>Import table: {file.name}</DialogTitle>
   <DialogDescription>Each row becomes one text. Choose the column that holds the texts and, if the table has one, the column that identifies them.</DialogDescription>
   {!sheet&&!error&&<p className="hint" role="status">Reading the table…</p>}
   {error&&<p className="message" role="alert">{error}</p>}
   {sheet&&plan&&<>
    {matched>0&&matched>=sheet.rows.length/2&&<div className="message research-notice"><p>{matched.toLocaleString('en-US')} of {plural(sheet.rows.length,'row')} match texts already in this study by name. If this file holds labels or metadata for those texts, add it as columns instead of importing the texts again.</p><Button type="button" variant="outline" disabled={adding} onClick={()=>onUseAsLabels(sheet,file.name)}>Add as labels or metadata instead</Button></div>}
    <div className="research-grid">
     <div><label htmlFor="table-text">Text column</label><select id="table-text" value={textIndex} onChange={event=>{const next=Number(event.target.value);setTextIndex(next);if(next===idIndex)setIdIndex(-1);}}>{sheet.header.map((name,i)=><option key={i} value={i}>{name}</option>)}</select></div>
     <div><label htmlFor="table-id">ID column</label><select id="table-id" value={idIndex} onChange={event=>setIdIndex(Number(event.target.value))}><option value={-1}>(number the rows)</option>{sheet.header.map((name,i)=>i===textIndex?null:<option key={i} value={i}>{name}</option>)}</select></div>
    </div>
    {plan.repeated.length>0&&<p className="message">{plural(plan.repeated.length,'text')} {plan.repeated.length===1?'has':'have'} the same ID as another (for example “{plan.repeated[0]}”) and will get _2, _3, and so on. Choose an ID column with a different value in each row, so that labels in a spreadsheet can be matched to the texts later.</p>}
    {(plan.empty>0||plan.twice>0)&&<p className="hint" role="status">{plan.texts.length.toLocaleString('en-US')} of the {plural(sheet.rows.length,'row')} will be added.{plan.empty?` ${plural(plan.empty,'row')} with an empty text ${plan.empty===1?'is':'are'} left out.`:''}{plan.twice?` ${plural(plan.twice,'row')} that ${plan.twice===1?'repeats':'repeat'} another row in every column ${plan.twice===1?'is':'are'} left out.`:''}</p>}
    <p className="hint">{plan.names.length?`The other columns are kept as labels or metadata: ${plan.names.slice(0,8).join(', ')}${plan.names.length>8?', …':''}. Columns with human labels can be compared with the model’s answers under Runs & agreement; you can change what each column holds after the import.`:'This table has no other columns to keep as labels or metadata.'}{plan.tooLong.length?` ${plural(plan.tooLong.length,'column')} with a name of more than 60 characters ${plan.tooLong.length===1?'is':'are'} not kept.`:''}</p>
    <div className="research-table-scroll"><table className="research-table research-preview"><thead><tr>{shown.map(i=><th key={i}>{sheet.header[i]}{i===textIndex&&<span className="research-tag">used as text</span>}{i===idIndex&&<span className="research-tag">used as ID</span>}</th>)}</tr></thead><tbody>{sheet.rows.slice(0,5).map((row,r)=><tr key={r}>{shown.map(i=><td key={i}><div className="research-snippet">{row[i]}</div></td>)}</tr>)}</tbody></table></div>
    {sheet.header.length>6&&<p className="hint">The preview shows the first 6 of {sheet.header.length} columns and the first rows.</p>}
   </>}
   {problem&&<p className="message" role="alert">{problem}</p>}
   <div className="research-dialog-actions"><Button type="button" disabled={!plan?.texts.length||adding} onClick={add}>{adding?'Importing…':`Import ${plan?.texts.length?plural(plan.texts.length,'text'):'texts'}`}</Button><Button type="button" variant="outline" disabled={adding} onClick={close}>Cancel</Button></div>
  </DialogContent>
 </Dialog>;
}
