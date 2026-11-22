'use client';
// Export: an Excel workbook and a supplementary repository for one run, a research repository of the whole
// study, and a backup of the study. Every file is made in the browser (lib/research/export-packages.ts).
import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {extractText} from '@/lib/extract-text';
import {dateStamp,publicColumns,runLines,slugName,unitOf,type Dataset} from '@/lib/research/export';
import {labelPairs} from '@/lib/research/export-agreement';
import {documentReader,reportableRuns} from '@/lib/research/export-data';
import {intervalsOf} from '@/lib/research/intervals';
import type {RecordedRequest} from '@/lib/research/requests';
import {fieldLabel} from '@/lib/research/view';
import {downloadBytes,downloadText} from './download';

// A data set of the study with the requests its runs sent.
export type ExportSource=Dataset&{requests?:RecordedRequest[]};
const EMPTY:ExportSource={kind:'texts',rows:[],runs:[],columns:[],samples:[]};
const DATASET_NAMES={texts:'Uploaded texts',knowledge:'Model knowledge'} as const;
// The label and metadata columns left out of the supplementary repository, remembered per study and data set in
// this browser (a column added later is included until it is unticked).
const leftOutKey=(study:string,kind:string)=>`text-annotation-lab:public-left-out:${kind}:${study}`;
function readLeftOut(key:string):string[]{
 try{const value=JSON.parse(localStorage.getItem(key)??'[]');return Array.isArray(value)?value.filter(item=>typeof item==='string'):[];}catch{return [];}
}
const when=(time:string)=>{const date=new Date(time);return !time||Number.isNaN(date.getTime())?'':date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});};

// The download being built. It is kept outside the page, so leaving the tab and coming back still shows it
// (the build goes on meanwhile), and a second one cannot start before it is done.
type Kind='excel'|'research'|'supplementary'|'backup';
// choices: what the download was started with, shown again when the tab is opened during the build.
type Choices={run?:number;researchLogs:boolean;options:{texts:boolean;explanations:boolean;logs:boolean;columns?:string[]}};
type Building={job:{kind:Kind;data:Dataset['kind'];step:string;choices:Choices}|null;error:string};
let building:Building={job:null,error:''};
const watchers=new Set<()=>void>();
const show=(next:Building)=>{building=next;watchers.forEach(watcher=>watcher());};
const watch=(watcher:()=>void)=>{watchers.add(watcher);return()=>{watchers.delete(watcher);};};
// Resolves once the page has shown what changed, so a step's name is on screen before its work holds the page
// (at once in a hidden tab, which does not paint).
const painted=()=>new Promise<void>(resolve=>{
 if(document.visibilityState!=='visible')return resolve();
 const done=()=>{clearTimeout(timer);resolve();},timer=setTimeout(done,100);
 requestAnimationFrame(()=>setTimeout(done,0));
});
// work: makes and downloads the file; what it returns is said on the page after the download (what the file lacks).
async function build(kind:Kind,data:Dataset['kind'],label:string,choices:Choices,work:(progress:(step:string)=>Promise<void>)=>Promise<string|void>){
 if(building.job)return;
 const step=async(text:string)=>{show({job:{kind,data,step:text,choices},error:''});await painted();};
 await step('Preparing');
 try{const note=await work(step);show({job:null,error:note?`The ${label} was downloaded, but not in full. ${note}`:''});}
 catch(error){show({job:null,error:`The ${label} could not be made${error instanceof Error&&error.message?`: ${error.message.replace(/\.$/,'')}`:''}. Your results are still here; please try again.`});}
}

export function ExportPanel({datasets,studyName,lab,backup}:{datasets:ExportSource[];studyName?:string;lab:string;backup?:()=>Promise<string>}){
 const {job,error}=useSyncExternalStore(watch,()=>building,()=>building);
 // Opened during a build: its data set, run, and options are shown, not the defaults.
 const [kind,setKind]=useState<Dataset['kind']>(()=>job?.data??'texts'),[picked,setPicked]=useState<Partial<Record<Dataset['kind'],number>>>(()=>job&&job.choices.run!==undefined?{[job.data]:job.choices.run}:{});
 const [researchLogs,setResearchLogs]=useState(()=>job?.choices.researchLogs??true),[options,setOptions]=useState(()=>job?.choices.options??{texts:false,explanations:true,logs:false});
 const available=datasets.filter(d=>d.rows.length>0);
 const dataset=available.find(d=>d.kind===kind)||available[0]||datasets[0]||EMPTY;
 // The columns offered for the supplementary repository, and those left out.
 const offered=useMemo(()=>publicColumns(dataset).map(c=>dataset.columns[c].name),[dataset.columns,dataset.rows]),storeKey=leftOutKey(studyName||'',dataset.kind);
 const [leftOut,setLeftOut]=useState<string[]>(()=>readLeftOut(storeKey));
 useEffect(()=>setLeftOut(readLeftOut(storeKey)),[storeKey]);
 const toggleColumn=(name:string)=>{
  const next=leftOut.includes(name)?leftOut.filter(item=>item!==name):[...leftOut,name];setLeftOut(next);
  try{localStorage.setItem(storeKey,JSON.stringify(next));}catch{/* not remembered: the choice still applies to this download */}
 };
 const shownColumns=job?.kind==='supplementary'&&job.choices.options.columns?job.choices.options.columns:offered.filter(name=>!leftOut.includes(name));
 const unit=unitOf(dataset),knowledge=dataset.kind==='knowledge',all=useMemo(()=>runLines(dataset),[dataset.rows,dataset.runs]),runs=useMemo(()=>reportableRuns(dataset),[dataset.rows,dataset.runs]);
 // The run picked; until then the latest finished run with results, else the latest with results. Once shown it
 // stays: a run that is still being sent does not take its place when its first results come in.
 const run=runs.find(r=>r.number===picked[dataset.kind])||runs.find(r=>!r.active)||runs[0];
 useEffect(()=>{if(run&&picked[dataset.kind]!==run.number)setPicked(now=>({...now,[dataset.kind]:run.number}));},[run?.number,dataset.kind]);
 // The label columns agreement is computed for, and those left out, each with the reason.
 const labels=useMemo(()=>{
  if(!run)return {used:[] as string[],unused:[] as string[]};
  const {pairs,skipped}=labelPairs(dataset,run.number);
  return {used:pairs.map(pair=>`${fieldLabel(pair.field)} ↔ ${pair.column}`),unused:skipped.map(skip=>`${skip.column} (${skip.reason})`)};
 },[dataset.rows,dataset.columns,dataset.kind,run?.number]);
 const results=all.reduce((n,r)=>n+r.done,0),busy=Boolean(job),here=(which:Kind)=>job?.kind===which&&(which==='backup'||job.data===dataset.kind);
 const choices:Choices={run:run?.number,researchLogs,options:{...options,columns:shownColumns}},stepLine=(which:Kind,extra='')=>here(which)&&<p className="research-export-step" role="status">{job!.step}…{extra}</p>;
 // The files are made from the study as it is now; the modules that write them are loaded when first needed.
 const context=(progress:(step:string)=>Promise<void>)=>({study:{name:studyName||'Study',dataset,requests:dataset.requests,lab},read:documentReader(dataset,extractText),intervals:intervalsOf,onProgress:progress,backup,now:new Date()});
 const excel=()=>run&&build('excel',dataset.kind,'Excel workbook',choices,async progress=>{
  const {buildRunWorkbook}=await import('@/lib/research/export-packages'),book=await buildRunWorkbook(context(progress),run.number);
  downloadBytes(book.name,book.data,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 });
 const repository=()=>build('research',dataset.kind,'research repository',choices,async progress=>{
  const {buildResearchRepository,zipPackage}=await import('@/lib/research/export-packages'),pack=await buildResearchRepository(context(progress),{logs:researchLogs});
  downloadBytes(pack.name+'.zip',await zipPackage(pack,progress) as BlobPart,'application/zip');
  return pack.warning;
 });
 const supplementary=()=>run&&build('supplementary',dataset.kind,'supplementary repository',choices,async progress=>{
  const {buildSupplementary,zipPackage}=await import('@/lib/research/export-packages'),pack=await buildSupplementary(context(progress),run.number,{...options,columns:shownColumns});
  downloadBytes(pack.name+'.zip',await zipPackage(pack,progress) as BlobPart,'application/zip');
 });
 const studyBackup=()=>backup&&build('backup',dataset.kind,'study backup',choices,async()=>{
  downloadText((slugName(studyName||'')||'study')+'_backup_'+dateStamp(new Date())+'.json',await backup(),'application/json');
 });
 const option=(checked:boolean,change:(checked:boolean)=>void,label:string,hint?:string)=><label className="research-check research-export-option"><input type="checkbox" checked={checked} disabled={busy} onChange={event=>change(event.target.checked)}/><span>{label}{hint&&<small>{hint}</small>}</span></label>;
 const elsewhere=job&&job.kind!=='backup'&&job.data!==dataset.kind;
 return <div className="research-page">
  <div className="research-page-head">
   <div><h2 id="export" tabIndex={-1}>Export</h2></div>
   {available.length>1&&<div className="research-segment" role="group" aria-label="Data">{available.map(d=><button key={d.kind} type="button" aria-pressed={d.kind===dataset.kind} onClick={()=>setKind(d.kind)}>{DATASET_NAMES[d.kind]}</button>)}</div>}
  </div>
  <p className="hint">{dataset.rows.length.toLocaleString('en-US')} {unit}{dataset.rows.length===1?'':'s'} · {all.length} {all.length===1?'run':'runs'} · {results.toLocaleString('en-US')} completed {results===1?'annotation':'annotations'}{dataset.columns.length?` · ${dataset.columns.length} label or metadata ${dataset.columns.length===1?'column':'columns'}`:''}{knowledge?'. Model knowledge: the model judged named subjects from what it has learned; no texts were supplied. The README of each repository says so.':''}</p>
  <section className="research-export-run">
   <label htmlFor="export-run">Run to report</label>
   <select id="export-run" value={run?.number??''} disabled={busy||!runs.length} onChange={event=>setPicked(now=>({...now,[dataset.kind]:Number(event.target.value)}))}>
    {!runs.length&&<option value="">No runs with results yet</option>}
    {runs.map(r=>{const record=dataset.runs.find(x=>x.number===r.number);return <option key={r.number} value={r.number}>{[`Run #${r.number}`,record?.label,record?.scope,`prompt v${r.promptVersion}`,r.model,when(r.startedAt),r.active?'still running':''].filter(Boolean).join(' · ')}</option>;})}
   </select>
   {run&&run.active>0&&<p className="research-export-note">This run is not finished yet: {run.done.toLocaleString('en-US')} of {(run.done+run.failed+run.active).toLocaleString('en-US')} {unit}s have a usable answer so far. Excel and the supplementary repository show the results so far, and say that the run was not finished.</p>}
   <p className="hint">Excel and the supplementary repository describe this one run (typically your final, full run). The research repository always includes every run.{run&&(labels.used.length>0?` Agreement is computed automatically for the columns added as human labels: ${labels.used.join(', ')}.`:labels.unused.length>0?'':' No agreement is computed: no column was added as human labels.')}{labels.unused.length>0&&` Not used for agreement: ${labels.unused.join(', ')}.`}</p>
   {elsewhere&&<p className="research-export-step" role="status">A download for {DATASET_NAMES[job.data]} is being built: {job.step}…</p>}
  </section>
  <div className="research-export-grid">
   <section className="research-export-card">
    <h3>Excel workbook</h3>
    <p className="hint">The chosen run in one workbook: a row per {unit}, a row per request, agreement with human labels, the run’s settings, and an overview of all runs.</p>
    <div className="research-export-go"><Button type="button" variant="outline" disabled={busy||!run} onClick={()=>{void excel();}}><Download size={16}/>{here('excel')?'Building…':'Download Excel'}</Button>{stepLine('excel')}</div>
   </section>
   <section className="research-export-card">
    <h3>Research repository</h3>
    <p className="hint">Everything, for your own archive: every run and prompt version, the {unit}s, all results, the requests and replies, and a backup of the study that can be imported again.</p>
    {option(researchLogs,setResearchLogs,'Include request and response logs')}
    <div className="research-export-go"><Button type="button" variant="outline" disabled={busy||!dataset.rows.length} onClick={()=>{void repository();}} aria-label="Download research repository (.zip)"><Download size={16}/>{here('research')?'Building…':'Download .zip'}</Button>{stepLine('research',' (a large corpus with logs can take several minutes; keep this tab open)')}</div>
   </section>
   <section className="research-export-card">
    <h3>Supplementary repository</h3>
    <p className="hint">What a journal or an OSF or Zenodo deposit needs for the chosen run: a record of the settings, the prompt and output schema, the results, agreement, and a Python script that sends the requests again (with a template marking every inserted value).</p>
    {option(options.texts,texts=>setOptions(now=>({...now,texts})),`Include the ${unit}s`,knowledge?`Off by default. The results name each subject either way; this adds every subject as the requests carried it.${offered.length?' The subjects’ other fields are chosen under “Label and metadata columns” below.':''}`:'Off by default: check copyright and privacy before sharing texts publicly.')}
    {option(options.explanations,explanations=>setOptions(now=>({...now,explanations})),'Include the model’s explanations','The explanation written before the answers. An answer field of your own that holds an explanation is always included.')}
    {option(options.logs,logs=>setOptions(now=>({...now,logs})),'Include request and response logs',`These contain the ${unit}s.`)}
    {offered.length>0&&<details className="research-export-columns"><summary>Label and metadata columns: {shownColumns.length} of {offered.length} included</summary>
     <p className="hint">In results.csv and data/corpus.csv. A column left out stays out of both, also when the prompt’s placeholders read it (the README then says the script needs it); the logs, when included, hold the requests as sent.</p>
     {offered.map(name=><label key={name} className="research-check research-export-option"><input type="checkbox" checked={shownColumns.includes(name)} disabled={busy} onChange={()=>toggleColumn(name)}/><span>{name}</span></label>)}
    </details>}
    <div className="research-export-go"><Button type="button" variant="outline" disabled={busy||!run} onClick={()=>{void supplementary();}} aria-label="Download supplementary repository (.zip)"><Download size={16}/>{here('supplementary')?'Building…':'Download .zip'}</Button>{stepLine('supplementary')}</div>
   </section>
  </div>
  {backup&&<section className="research-export-backup">
   <div><strong>Study backup</strong><span>One file with the whole study: both data sets, the uploaded files, every run, labels, and samples. Studies → Import backup reads it again, on this or another computer.</span>{stepLine('backup')}</div>
   <Button type="button" variant="outline" disabled={busy} onClick={()=>{void studyBackup();}}><Download size={16}/>{here('backup')?'Building…':'Download backup'}</Button>
  </section>}
  {error&&<p className="message" role="alert">{error}</p>}
  <p className="hint">Every file is made in this browser; nothing is uploaded. API keys are never included.</p>
 </div>;
}
