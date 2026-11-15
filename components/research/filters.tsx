'use client';
// The row of controls above the research results table (search, filters, which
// run to show, and what to compare with), and the extra detail of one text.
import {Search} from 'lucide-react';
import {columnValues,columnIndex,type Column} from '@/lib/research/columns';
import {DEFAULT_VIEW,fieldLabel,valueOf,viewNarrowed,type View} from '@/lib/research/view';
import type {Row,RunSummary} from '@/lib/research/runs';
import {modelLabel} from '@/lib/providers';

export function ResearchFilters({view,onChange,columns,rows,runs,fields,field,shown,total,checked,onClearChecked}:{view:View;onChange:(view:View)=>void;columns:Column[];rows:Row[];runs:RunSummary[];fields:string[];field:string;shown:number;total:number;checked:number;onClearChecked:()=>void}){
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
   <option value="latest">Latest result per text</option>{runs.map(run=><option key={run.number} value={run.number}>Run #{run.number} · {modelLabel(run.model)}</option>)}
  </select>
  {(labels.length>0||runs.length>1)&&<label className="research-pick"><span>Compare with</span><select aria-label="Compare with" value={view.compare} onChange={event=>set({compare:event.target.value,show:event.target.value?view.show:['disagree','agree'].includes(view.show)?'all':view.show})}>
   <option value="">Nothing</option>
   {labels.length>0&&<optgroup label="Human labels">{labels.map(c=><option key={c.name} value={'col:'+c.name}>{c.name}</option>)}</optgroup>}
   {runs.length>1&&<optgroup label="Another run">{otherRuns.map(run=><option key={run.number} value={'run:'+run.number}>Run #{run.number} · {modelLabel(run.model)}</option>)}</optgroup>}
   {others.length>0&&<optgroup label="Metadata">{others.map(c=><option key={c.name} value={'col:'+c.name}>{c.name}</option>)}</optgroup>}
  </select></label>}
  {comparing&&fields.length>1&&<select aria-label="Answer field to compare" value={field} onChange={event=>set({field:event.target.value})}>{fields.map(f=><option key={f} value={f}>{fieldLabel(f)}</option>)}</select>}
  <span className="research-filter-count" role="status">{viewNarrowed(view)?`${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} shown`:''}{viewNarrowed(view)&&<button type="button" className="textbutton" onClick={()=>onChange({...DEFAULT_VIEW,compare:view.compare,field:view.field})}>Clear filters</button>}{checked>0&&<>{checked.toLocaleString('en-US')} selected<button type="button" className="textbutton" onClick={onClearChecked}>Clear selection</button></>}</span>
 </div>;
}

const when=(time:unknown)=>{const date=new Date(String(time||''));return Number.isNaN(date.getTime())?'':date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});};
// Labels, metadata, and earlier results of the selected text or subject.
export function ResearchDetail({row,columns}:{row:Row;columns:Column[]}){
 const cells=columns.map((column,i)=>({column,value:row.cells?.[i]??''})).filter(cell=>cell.value);
 const earlier=[...(row.earlier||[])].reverse();
 if(!cells.length&&!earlier.length)return null;
 return <div className="research-detail">
  {cells.length>0&&<dl className="research-cells">{cells.map(({column,value})=><div key={column.name}><dt>{column.name}{column.role==='label'&&<span className="research-tag">human label</span>}</dt><dd>{value}</dd></div>)}</dl>}
  {earlier.length>0&&<details className="research-earlier"><summary>Earlier results ({earlier.length})</summary>{earlier.map((entry,i)=><div key={i} className="research-earlier-entry">
   <p><strong>Run #{entry.runNo}</strong> · {modelLabel(String(entry.model||''))}{when(entry.time)&&` · ${when(entry.time)}`}{entry.status==='error'&&' · failed'}</p>
   {entry.status==='error'?<p className="research-muted">{String(entry.error||'No result.')}</p>:<>
    <dl className="research-cells">{(entry.answerFields?.length?entry.answerFields:['']).map((name:string)=><div key={name}><dt>{fieldLabel(name)}</dt><dd>{valueOf(entry,name)||'—'}</dd></div>)}</dl>
    {entry.explanation&&!Object.values(entry.answers||{}).includes(entry.explanation)&&<p>{entry.explanation}</p>}
   </>}
  </div>)}</details>}
 </div>;
}
