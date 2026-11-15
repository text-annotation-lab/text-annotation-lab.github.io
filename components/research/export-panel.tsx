'use client';
// Export: the results of every run as tables for analysis, the settings of
// each run, and the samples drawn.
import {useState} from 'react';
import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {fileStem,longTable,runLines,runsTable,samplesTable,unitOf,wideTable,type Dataset} from '@/lib/research/export';
import {toCsv} from '@/lib/research/parse-table';
import {downloadBytes,downloadText} from './download';

export type Workbook={rows:any[];settings:any;fileName:string};
const EMPTY:Dataset={kind:'texts',rows:[],runs:[],columns:[],samples:[]};
const DATASET_NAMES={texts:'Uploaded texts',knowledge:'Model knowledge'} as const;

export function ExportPanel({datasets,workbooks,studyName}:{datasets:Dataset[];workbooks:Partial<Record<Dataset['kind'],Workbook>>;studyName?:string}){
 const [kind,setKind]=useState<Dataset['kind']>('texts'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const available=datasets.filter(d=>d.rows.length>0);
 const dataset=available.find(d=>d.kind===kind)||available[0]||datasets[0]||EMPTY;
 const unit=unitOf(dataset),runs=runLines(dataset),stem=fileStem(studyName,dataset),workbook=workbooks[dataset.kind];
 const results=runs.reduce((n,run)=>n+run.done,0);
 const csv=(name:string,table:(string|number)[][])=>downloadText(`${stem}-${name}.csv`,toCsv(table),'text/csv');
 async function excel(){
  if(!workbook||busy)return;
  setBusy(true);setError('');
  try{
   const {createResultsWorkbook}=await import('@/lib/export-results');
   const buffer=await createResultsWorkbook(workbook.rows,workbook.settings);
   downloadBytes(workbook.fileName,new Uint8Array(buffer),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch{setError('The Excel download failed. Your results are still here; please try again.');}
  finally{setBusy(false);}
 }
 const item=(title:string,description:string,action:()=>void,label:string,disabled:boolean)=><li><div><strong>{title}</strong><span>{description}</span></div><Button type="button" variant="outline" disabled={disabled} onClick={action}><Download size={16}/>{label}</Button></li>;
 return <div className="research-page">
  <div className="research-page-head">
   <div><p className="eyebrow">RESEARCH MODE</p><h2 id="export" tabIndex={-1}>Export</h2></div>
   {available.length>1&&<div className="research-segment" role="group" aria-label="Data">{available.map(d=><button key={d.kind} type="button" aria-pressed={d.kind===dataset.kind} onClick={()=>setKind(d.kind)}>{DATASET_NAMES[d.kind]}</button>)}</div>}
  </div>
  <p className="hint">{dataset.rows.length.toLocaleString('en-US')} {unit}{dataset.rows.length===1?'':'s'} · {runs.length} {runs.length===1?'run':'runs'} · {results.toLocaleString('en-US')} completed {results===1?'annotation':'annotations'}{dataset.columns.length?` · ${dataset.columns.length} label or metadata ${dataset.columns.length===1?'column':'columns'}`:''}{dataset.kind==='knowledge'?'. Model knowledge: the model judged named subjects from what it has learned; no texts were supplied. Every file from this page says so in its name or its “data” column.':''}</p>
  <ul className="research-exports">
   {item(`Results, one row per ${unit}`,`Each ${unit} with its labels and metadata, and every run’s answers side by side (run1_…, run2_…). Suited to a spreadsheet.`,()=>csv('results-wide',wideTable(dataset)),'CSV',!dataset.rows.length)}
   {item(`Results, one row per ${unit}, run, and answer field`,'Tidy data with each result’s model, reasoning effort, prompt version, time, tokens, and cost. Suited to R, Python, or a pivot table.',()=>csv('results-long',longTable(dataset)),'CSV',!results)}
   {item('Runs and settings','One row per run: provider, model, reasoning effort, answer fields, counts, cost, and the full prompt.',()=>csv('runs',runsTable(dataset)),'CSV',!runs.length)}
   {dataset.samples.length>0&&item('Samples drawn','Each recorded draw: size, eligible texts, seed, strata, and the sampling method, so the sample can be drawn again.',()=>csv('samples',samplesTable(dataset.samples)),'CSV',false)}
   {workbook&&item('Excel workbook',`The Lab’s standard workbook: each ${unit}’s latest result, the current settings, and failed attempts.`,()=>{void excel();},busy?'Preparing…':'Excel',busy||!workbook.rows.length)}
  </ul>
  {error&&<p className="message" role="alert">{error}</p>}
  <p className="hint">Agreement statistics are downloaded from Runs &amp; agreement. To keep or move the whole study, with every run, label, and sample, use Studies → Download study backup.</p>
  <p className="hint">CSV files keep every value exactly as it is. A value that starts with =, +, -, or @ is not escaped, so a spreadsheet program may read it as a formula; analysis software reads it as text.</p>
 </div>;
}
