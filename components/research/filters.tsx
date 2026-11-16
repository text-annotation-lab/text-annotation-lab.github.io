'use client';
// The row of controls above the research results table (search, filters, which
// run to show, and what to compare with), and the extra detail of one text.
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {columnValues,columnIndex,type Column} from '@/lib/research/columns';
import {DEFAULT_VIEW,fieldLabel,valueOf,viewNarrowed,type View} from '@/lib/research/view';
import type {Row,RunSummary} from '@/lib/research/runs';
import {annotationsOf,repeatsOf,requestsOf} from '@/lib/research/repeats';
import {Technical,type DetailStudy} from './technical';
import {modelName} from '@/lib/providers';

export type MenuItem={label:string;onSelect:()=>void;disabled?:boolean;danger?:boolean};
// A small menu for the actions that are used rarely (clearing results or the workspace).
function MoreMenu({items}:{items:MenuItem[]}){
 const [open,setOpen]=useState(false),box=useRef<HTMLSpanElement>(null);
 useEffect(()=>{
  if(!open)return;
  const away=(event:MouseEvent)=>{if(!box.current?.contains(event.target as Node))setOpen(false);},escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);box.current?.querySelector('button')?.focus();}};
  document.addEventListener('mousedown',away);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('mousedown',away);document.removeEventListener('keydown',escape);};
 },[open]);
 return <span className="research-menu" ref={box}><Button type="button" variant="outline" className="research-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>More<ChevronDown size={15} aria-hidden="true"/></Button>{open&&<span className="research-menu-list" role="menu">{items.map(item=><button key={item.label} type="button" role="menuitem" className={item.danger?'danger':undefined} disabled={item.disabled} onClick={()=>{setOpen(false);item.onSelect();}}>{item.label}</button>)}</span>}</span>;
}

export function ResearchFilters({view,onChange,columns,rows,runs,fields,field,shown,total,checked,onClearChecked,actions,menu}:{view:View;onChange:(view:View)=>void;columns:Column[];rows:Row[];runs:RunSummary[];fields:string[];field:string;shown:number;total:number;checked:number;onClearChecked:()=>void;actions?:ReactNode;menu?:MenuItem[]}){
 const set=(changes:Partial<View>)=>onChange({...view,...changes});
 const comparing=Boolean(view.compare),labels=columns.filter(c=>c.role==='label'),others=columns.filter(c=>c.role!=='label');
 const filterIndex=view.column?columnIndex(columns,view.column):-1;
 const otherRuns=runs.filter(run=>view.run==='latest'||run.number!==view.run);
 return <div className="research-filters" role="group" aria-label="Filter and compare results">
  <label className="research-search"><Search size={15} aria-hidden="true"/><input type="search" value={view.query} placeholder="Search" aria-label="Search texts, answers, labels, and metadata" onChange={event=>set({query:event.target.value})}/></label>
  <select aria-label="Show" value={view.show} onChange={event=>set({show:event.target.value})}>
   <option value="all">All texts</option><option value="pending">Ready</option><option value="done">Complete</option><option value="error">Needs attention</option>
   {comparing&&<><option value="disagree">Disagreements</option><option value="agree">Agreements</option></>}
  </select>
  {columns.length>0&&<>
   <select aria-label="Filter by column" value={filterIndex>=0?columns[filterIndex].name:''} onChange={event=>set({column:event.target.value,value:''})}><option value="">Any label or metadata</option>{columns.map(c=><option key={c.name} value={c.name}>{c.name} is…</option>)}</select>
   {filterIndex>=0&&<select aria-label={`Value of ${view.column}`} value={view.value} onChange={event=>set({value:event.target.value})}><option value="">Choose a value…</option>{columnValues(rows,filterIndex).map(v=><option key={v}>{v}</option>)}</select>}
  </>}
  <select aria-label="Results shown" value={String(view.run)} onChange={event=>{const run=event.target.value==='latest'?'latest':Number(event.target.value);set({run,compare:view.compare==='run:'+run?'':view.compare});}}>
   <option value="latest">Latest result per text</option>{runs.map(run=><option key={run.number} value={run.number}>Run #{run.number} · {modelName(run.model)}</option>)}
  </select>
  {(labels.length>0||runs.length>1)&&<label className="research-pick"><span>Compare with</span><select aria-label="Compare with" value={view.compare} onChange={event=>set({compare:event.target.value,show:event.target.value?view.show:['disagree','agree'].includes(view.show)?'all':view.show})}>
   <option value="">Nothing</option>
   {labels.length>0&&<optgroup label="Human labels">{labels.map(c=><option key={c.name} value={'col:'+c.name}>{c.name}</option>)}</optgroup>}
   {runs.length>1&&<optgroup label="Another run">{otherRuns.map(run=><option key={run.number} value={'run:'+run.number}>Run #{run.number} · {modelName(run.model)}</option>)}</optgroup>}
   {others.length>0&&<optgroup label="Metadata">{others.map(c=><option key={c.name} value={'col:'+c.name}>{c.name}</option>)}</optgroup>}
  </select></label>}
  {comparing&&fields.length>1&&<select aria-label="Answer field to compare" value={field} onChange={event=>set({field:event.target.value})}>{fields.map(f=><option key={f} value={f}>{fieldLabel(f)}</option>)}</select>}
  <span className="research-filter-count" role="status">{viewNarrowed(view)?`${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} shown`:''}{viewNarrowed(view)&&<button type="button" className="textbutton" onClick={()=>onChange({...DEFAULT_VIEW,compare:view.compare,field:view.field})}>Clear filters</button>}{checked>0&&<>{checked.toLocaleString('en-US')} selected<button type="button" className="textbutton" onClick={onClearChecked}>Clear selection</button></>}</span>
  {(actions||menu?.length)&&<span className="research-result-actions">{actions}{menu&&menu.length>0&&<MoreMenu items={menu}/>}</span>}
 </div>;
}

const when=(time:unknown)=>{const date=new Date(String(time||''));return Number.isNaN(date.getTime())?'':date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});};
// The answers of one result, or of one of a result's annotations (which answers under its result's fields).
function Answers({of,fields}:{of:Row|Record<string,any>;fields?:string[]}){
 const read={...of,answerFields:fields} as Row;
 return <>
  <dl className="research-cells">{(fields?.length?fields:['']).map((name:string)=><div key={name}><dt>{fieldLabel(name)}</dt><dd>{valueOf(read,name)||'—'}</dd></div>)}</dl>
  {of.explanation&&!Object.values(of.answers||{}).includes(of.explanation)&&<p>{of.explanation}</p>}
 </>;
}
// Labels, metadata, the annotations behind a combined result, and earlier results of the selected text or subject.
// The summary of the model's reasoning, where the request asked for one and the provider returned it.
const summaryOf=(of:{[key:string]:any})=>typeof of.reasoningSummary==='string'&&of.reasoningSummary.trim()?of.reasoningSummary:'';
const Reasoning=({of}:{of:{[key:string]:any}})=>summaryOf(of)?<details className="research-reasoning"><summary>Reasoning summary</summary><pre>{summaryOf(of)}</pre></details>:null;
// study: with it, each result also has its technical details (./technical.tsx).
export function ResearchDetail({row,columns,study}:{row:Row;columns:Column[];study?:DetailStudy}){
 const cells=columns.map((column,i)=>({column,value:row.cells?.[i]??''})).filter(cell=>cell.value);
 const earlier=[...(row.earlier||[])].reverse(),made=row.status==='pending'?[]:annotationsOf(row);
 // A result came back for the text itself (done or failed), so there is a request to show.
 const answered=Boolean(study)&&(row.status==='done'||row.status==='error')&&Boolean(row.provider||row.model);
 if(!cells.length&&!earlier.length&&!made.length&&!summaryOf(row)&&!answered)return null;
 // The number of the run a result belongs to (a Model knowledge subject keeps it as runNumber).
 const runOf=(of:{[key:string]:any})=>typeof of.runNo==='number'?of.runNo:typeof of.runNumber==='number'?of.runNumber:undefined;
 // The technical details of every request behind a result; `n` picks one annotation.
 const technical=(of:{[key:string]:any},run:number|undefined,n?:number)=>study?requestsOf(of).filter(request=>n===undefined||request.replicate===n).map(request=><Technical key={[row.id,run,request.replicate,request.result.time||''].join(':')} row={row} of={request.result} run={run} study={study} label={n===undefined&&annotationsOf(of).length>0?'annotation '+request.replicate:undefined}/>):null;
 return <div className="research-detail">
  {cells.length>0&&<dl className="research-cells">{cells.map(({column,value})=><div key={column.name}><dt>{column.name}{column.role==='label'&&<span className="research-tag">human label</span>}</dt><dd>{value}</dd></div>)}</dl>}
  {made.length===0&&<Reasoning of={row}/>}
  {made.length===0&&answered&&technical(row,runOf(row))}
  {made.length>0&&<details className="research-earlier"><summary>Annotations of this {study?.kind==='knowledge'?'subject':'text'} ({made.filter(a=>a.status==='done').length} of {repeatsOf(row)})</summary>
   <p className="hint">The answers above are the combined ones: the value most annotations gave, the median of a scale, the mean of a number. The explanation is that of the annotation closest to them.</p>
   {made.map(a=><div key={a.n} className="research-earlier-entry">
    <p><strong>Annotation {a.n}</strong>{when(a.time)&&` · ${when(a.time)}`}{typeof a.tokens==='number'&&` · ${a.tokens.toLocaleString('en-US')} tokens`}{a.status==='error'&&' · failed'}</p>
    {a.status==='error'?<><p className="research-muted">{String(a.error||'No result.')}</p>{a.rawResponse&&<details><summary>View returned response</summary><pre>{String(a.rawResponse)}</pre></details>}</>:<Answers of={a} fields={row.answerFields}/>}
    <Reasoning of={a}/>
    {technical(row,runOf(row),a.n)}
   </div>)}
  </details>}
  {earlier.length>0&&<details className="research-earlier"><summary>Earlier results ({earlier.length})</summary>{earlier.map((entry,i)=><div key={i} className="research-earlier-entry">
   <p><strong>Run #{entry.runNo}</strong> · {modelName(String(entry.model||''))}{when(entry.time)&&` · ${when(entry.time)}`}{annotationsOf(entry).length>0&&` · ${annotationsOf(entry).filter(a=>a.status==='done').length} of ${repeatsOf(entry)} annotations, combined`}{entry.status==='error'&&' · failed'}</p>
   {entry.status==='error'?<p className="research-muted">{String(entry.error||'No result.')}</p>:<Answers of={entry} fields={entry.answerFields}/>}
   <Reasoning of={entry}/>
   {technical(entry,runOf(entry))}
  </div>)}</details>}
 </div>;
}
