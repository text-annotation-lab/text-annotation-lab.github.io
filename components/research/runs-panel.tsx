'use client';
// Runs & agreement: every run with its settings, and how far two sources of
// labels agree (a run with human labels, or one run with another).
import {useEffect,useMemo,useState} from 'react';
import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {modelName,reasoningOptionLabel} from '@/lib/providers';
import {agreementJob,agreementTable,autoLevel,disagreements,leftOutNote,pairSources,runJob,sourceFields,sourceLabel,statLines,type LevelChoice} from '@/lib/research/agreement';
import {computeIntervals} from '@/lib/research/intervals';
import {fileStem,runLines,sourceOf,unitOf,type Dataset} from '@/lib/research/export';
import {toCsv} from '@/lib/research/parse-table';
import {fieldLabel,parseSource,pickField,sourceKey,type CompareSource} from '@/lib/research/view';
import type {Agreement} from '@/lib/research/metrics';
import {answersLabel} from '@/lib/answer-types';
import {downloadText} from './download';

const when=(time:string)=>{const date=new Date(time);return !time||Number.isNaN(date.getTime())?'—':date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});};
const money=(amount:number)=>amount===0?'$0':amount<0.0001?'< $0.0001':'$'+amount.toFixed(amount<0.1?4:2);
const BOOTSTRAPPED=new Set(['cohenKappa','weightedKappa','weightedKappaLinear','krippendorffAlpha','gwetAC1','gwetAC2Linear','meanDifference','mae']);
const EMPTY:Dataset={kind:'texts',rows:[],runs:[],columns:[],samples:[]};
const DATASET_NAMES={texts:'Uploaded texts',knowledge:'Model knowledge'} as const;

export function RunsPanel({datasets,studyName,locked,onShowRun,onDeleteRun,onOpenText}:{datasets:Dataset[];studyName?:string;locked:boolean;onShowRun:(run:number)=>void;onDeleteRun:(run:number)=>void;onOpenText:(id:string)=>void}){
 const [kind,setKind]=useState<Dataset['kind']>('texts');
 const available=datasets.filter(d=>d.rows.length>0);
 const dataset=available.find(d=>d.kind===kind)||available[0]||datasets[0]||EMPTY;
 const unit=unitOf(dataset),lines=useMemo(()=>runLines(dataset),[dataset.rows,dataset.runs]);
 const [aKey,setAKey]=useState(''),[bKey,setBKey]=useState(''),[fieldChoice,setFieldChoice]=useState(''),[level,setLevel]=useState<LevelChoice>('auto'),[tolerance,setTolerance]=useState('1');
 const [intervals,setIntervals]=useState<{key:string;ci:Agreement['ci']}>();

 const runSources:CompareSource[]=lines.filter(run=>run.done>0).map(run=>({kind:'run',run:run.number}));
 // Each annotation of a run that makes several per text, to compare one with another (a retest).
 const singleSources:CompareSource[]=lines.filter(run=>run.done>0&&(run.repeats||1)>1).flatMap(run=>Array.from({length:run.repeats!},(_,i):CompareSource=>({kind:'run',run:run.number,rep:i+1})));
 const columnSources:CompareSource[]=[...dataset.columns.filter(c=>c.role==='label'),...dataset.columns.filter(c=>c.role!=='label')].map(c=>({kind:'column',name:c.name}));
 const sources=[...runSources,...singleSources,...columnSources],keys=sources.map(sourceKey);
 // With one run and nothing to compare it with, the first two of its annotations are compared.
 const retest=runSources.length+columnSources.length<2?singleSources[0]:undefined;
 const a=(keys.includes(aKey)?parseSource(aKey):undefined)||retest||runSources[runSources.length-1]||columnSources[0];
 const rest=sources.filter(source=>!a||sourceKey(source)!==sourceKey(a));
 const firstLabel=rest.find(source=>source.kind==='column'&&dataset.columns.find(c=>c.name===source.name)?.role==='label');
 const sibling=a?.kind==='run'&&a.rep?rest.find(source=>source.kind==='run'&&source.run===a.run&&source.rep):undefined;
 const b=(bKey&&bKey!==(a&&sourceKey(a))&&keys.includes(bKey)?parseSource(bKey):undefined)||firstLabel||sibling||[...rest].reverse().find(source=>source.kind==='run'&&!source.rep)||rest[0];

 const fieldsA=a?sourceFields(dataset.rows,a):[],fieldsB=b?sourceFields(dataset.rows,b):[];
 const fields=a?.kind==='run'?fieldsA:fieldsB;
 const field=pickField(fields,fieldChoice,a?.kind==='column'?a.name:b?.kind==='column'?b.name:'');
 const fieldA=a?.kind==='run'?field:'',fieldB=b?.kind==='run'?pickField(fieldsB,field):'';
 const pairing=useMemo(()=>a&&b?pairSources(dataset.rows,dataset.columns,a,fieldA,b,fieldB):undefined,[dataset.rows,dataset.columns,a&&sourceKey(a),b&&sourceKey(b),fieldA,fieldB]);
 const tol=Math.max(0,Number(tolerance)||0);
 const job=useMemo(()=>pairing?agreementJob(pairing,level,tol):undefined,[pairing,level,tol]);
 const stats=useMemo(()=>job?runJob(job,false):undefined,[job]);
 const jobKey=job?JSON.stringify([dataset.kind,a&&sourceKey(a),b&&sourceKey(b),fieldA,fieldB,job.level,job.tolerance,job.a.length,job.a.join('\u0001'),job.b.join('\u0001')]):'';
 useEffect(()=>{
  if(!job||!stats||stats.n<10)return;
  let stop=()=>{};
  const timer=setTimeout(()=>{stop=computeIntervals(job,ci=>setIntervals({key:jobKey,ci}));},300);
  return()=>{clearTimeout(timer);stop();};
 },[jobKey]);
 const ci=intervals?.key===jobKey?intervals.ci:undefined;
 const differing=useMemo(()=>pairing?disagreements(pairing):[],[pairing]);
 const [showAll,setShowAll]=useState(false);

 function downloadComparison(){
  if(!stats||!a||!b)return;
  downloadText(`${fileStem(studyName,dataset)}-agreement.csv`,toCsv(agreementTable({a:sourceLabel(a)+(fieldA?` (${fieldLabel(fieldA)})`:''),b:sourceLabel(b)+(fieldB?` (${fieldLabel(fieldB)})`:''),field,dataset:sourceOf(dataset),basis:pairing?.basis},stats,ci,unit)),'text/csv');
 }
 const option=(source:CompareSource)=><option key={sourceKey(source)} value={sourceKey(source)}>{source.kind!=='run'?source.name:source.rep?sourceLabel(source):`Run #${source.run} · ${modelName(lines.find(run=>run.number===source.run)?.model||'')}`}</option>;
 const whole=(s:CompareSource)=>s.kind==='run'&&!s.rep,single=(s:CompareSource)=>s.kind==='run'&&Boolean(s.rep);
 const group=(list:CompareSource[])=><>{list.some(whole)&&<optgroup label="Runs">{list.filter(whole).map(option)}</optgroup>}{list.some(single)&&<optgroup label="Single annotations (retest)">{list.filter(single).map(option)}</optgroup>}{list.some(s=>s.kind==='column')&&<optgroup label="Labels and metadata">{list.filter(s=>s.kind==='column').map(option)}</optgroup>}</>;
 const categories=stats?.categories||[];

 return <div className="research-page">
  <div className="research-page-head">
   <div><p className="eyebrow">RESEARCH MODE</p><h2 id="runs" tabIndex={-1}>Runs &amp; agreement</h2></div>
   {available.length>1&&<div className="research-segment" role="group" aria-label="Data">{available.map(d=><button key={d.kind} type="button" aria-pressed={d.kind===dataset.kind} onClick={()=>{setKind(d.kind);setAKey('');setBKey('');setFieldChoice('');}}>{DATASET_NAMES[d.kind]}</button>)}</div>}
  </div>
  {dataset.kind==='knowledge'&&<p className="hint">Model knowledge: the model judged named subjects from what it has learned; no texts were supplied.</p>}

  <section aria-labelledby="runs-list">
   <h3 id="runs-list">Runs</h3>
   {lines.length?<div className="research-table-scroll"><table className="research-table research-runs"><thead><tr><th>Run</th><th>Started</th><th>Model</th><th>Prompt</th><th>Answer fields</th><th>Complete</th><th>Failed</th><th>Cost</th>{dataset.kind==='texts'&&<th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{lines.map(run=><tr key={run.number}>
    <td><strong>#{run.number}</strong></td>
    <td>{when(run.startedAt)}</td>
    <td>{modelName(run.model)}{run.effort&&<span className="research-muted"> · {reasoningOptionLabel(run.effort)}</span>}{(run.repeats||1)>1&&<span className="research-tag" title={`${run.repeats} annotations per ${unit}; the answers shown are the combined ones`}>×{run.repeats}</span>}{run.webSearch&&<span className="research-tag">web search</span>}{run.caching!=='off'&&<span className="research-tag">{run.caching==='on'?'prompt caching':'prompt caching in part'}</span>}{run.temperature!==undefined&&<span className="research-tag">temperature {run.temperature}</span>}{run.maxOutput!==undefined&&<span className="research-tag">max {run.maxOutput.toLocaleString('en-US')} output tokens</span>}{run.summary!=='off'&&<span className="research-tag">{run.summary==='on'?'reasoning summary':'reasoning summary in part'}</span>}{run.mixed&&<span className="research-tag warn" title={`Results in this run were made with different settings. The long results table lists the settings of every ${unit}.`}>settings vary</span>}</td>
    <td><details className="research-prompt"><summary>v{run.promptVersion}</summary><pre>{run.prompt||'(no prompt recorded)'}</pre></details></td>
    <td>{answersLabel(run.answerFields,run.answerSettings)}</td>
    <td>{run.done.toLocaleString('en-US')}{run.active>0&&<span className="research-muted"> · {run.active} in progress</span>}{run.fewer>0&&<span className="research-muted"> · {run.fewer.toLocaleString('en-US')} with fewer than {run.repeats} annotations</span>}</td>
    <td>{run.failed||'—'}</td>
    <td title={run.costKnown<run.costCount?`Known for ${run.costKnown} of ${run.costCount} annotations`:undefined}>{run.costKnown?money(run.cost)+(run.costKnown<run.costCount?'+':''):'—'}</td>
    {dataset.kind==='texts'&&<td className="research-row-actions"><button type="button" className="textbutton" onClick={()=>onShowRun(run.number)}>Show in Workspace</button><button type="button" className="textbutton" disabled={locked} onClick={()=>{if(confirm(`Delete run #${run.number} and its ${run.done+run.failed} results? Texts keep the results of their other runs. This cannot be undone.`))onDeleteRun(run.number);}}>Delete</button></td>}
   </tr>)}</tbody></table></div>:<p className="research-empty">No runs yet. {dataset.kind==='texts'?'Annotate texts in the Workspace. Each setup you run (model, reasoning effort, prompt, and answer fields) is listed here as a numbered run.':'Annotate subjects under Model knowledge. Each repeat of the study is listed here as a numbered run.'}</p>}
  </section>

  <section aria-labelledby="agreement-heading">
   <h3 id="agreement-heading">Agreement</h3>
   {!a||!b?<p className="research-empty">Agreement compares two sets of values for the same {unit}s. {dataset.kind==='texts'?'Add human labels from a spreadsheet in the Workspace, or annotate the same texts in a second run (for example with another model).':'Add human labels from a spreadsheet under Model knowledge, or repeat the study to compare two runs.'}</p>:<>
    <div className="research-selectors">
     <div><label htmlFor="agreement-a">Annotations</label><select id="agreement-a" value={sourceKey(a)} onChange={event=>setAKey(event.target.value)}>{group(sources)}</select></div>
     <div><label htmlFor="agreement-b">Compared with</label><select id="agreement-b" value={sourceKey(b)} onChange={event=>setBKey(event.target.value)}>{group(rest)}</select></div>
     {fields.length>1&&<div><label htmlFor="agreement-field">Answer field</label><select id="agreement-field" value={field} onChange={event=>setFieldChoice(event.target.value)}>{fields.map(f=><option key={f} value={f}>{fieldLabel(f)}</option>)}</select></div>}
     <div><label htmlFor="agreement-level">Level of measurement</label><select id="agreement-level" value={level} onChange={event=>setLevel(event.target.value as LevelChoice)}><option value="auto">Auto ({pairing?autoLevel(pairing):'nominal'})</option><option value="nominal">Nominal (categories)</option><option value="ordinal">Ordinal (ranked scale)</option><option value="interval">Interval (equal steps)</option></select></div>
     {pairing?.numeric&&<div><label htmlFor="agreement-tolerance">Tolerance (±)</label><input id="agreement-tolerance" type="number" inputMode="decimal" min={0} step="any" value={tolerance} onChange={event=>setTolerance(event.target.value)}/></div>}
    </div>
    {stats&&pairing&&(stats.n?<>
     <div className="research-stats">{statLines(stats,ci,unit).map(line=><div key={line.key} className="research-stat" title={line.help}>
      <span className="research-stat-label">{line.label}</span><strong>{line.value}</strong>
      {line.key!=='n'&&line.key!=='spearman'&&<span className="research-stat-ci">{line.ciText?`95% CI ${line.ciText}`:stats.n<10?'':BOOTSTRAPPED.has(line.key)&&!ci?'95% CI: computing…':''}</span>}
     </div>)}</div>
     <p className="hint">{[pairing.onlyA?`${pairing.onlyA.toLocaleString('en-US')} ${unit}${pairing.onlyA===1?' has':'s have'} a value only in ${sourceLabel(a)}`:'',pairing.onlyB?`${pairing.onlyB.toLocaleString('en-US')} only in ${sourceLabel(b)}`:''].filter(Boolean).join('; ')}{pairing.onlyA||pairing.onlyB?'; these are not compared. ':''}{leftOutNote(stats,unit,pairing.leftOut)} {pairing.basis} {stats.n<10?`Intervals need at least 10 compared ${unit}s.`:`Intervals for the coefficients are bootstrap percentile intervals (10,000 resamples of the ${unit}s, fixed seed); those for shares are Wilson intervals.`} Values are compared after trimming and ignoring case.</p>
     {categories.length>0&&(categories.length<=25?<div className="research-table-scroll"><table className="research-table research-confusion"><caption>Rows: {sourceLabel(a)}. Columns: {sourceLabel(b)}.</caption><thead><tr><th/>{categories.map(c=><th key={c} scope="col">{c}</th>)}</tr></thead><tbody>{categories.map(row=><tr key={row}><th scope="row">{row}</th>{categories.map(column=>{const n=stats.confusion[row]?.[column]??0;return <td key={column} className={n?row===column?'agree':'disagree':''}>{n||''}</td>;})}</tr>)}</tbody></table></div>:<p className="hint">{categories.length} distinct values: too many to show as a table. The downloaded comparison includes the full table.</p>)}
     <div className="research-page-actions"><Button type="button" variant="outline" onClick={downloadComparison}><Download size={16}/>Download this comparison (CSV)</Button></div>
     <h4>Disagreements ({differing.length.toLocaleString('en-US')})</h4>
     {differing.length?<><div className="research-table-scroll"><table className="research-table"><thead><tr><th>{unit==='text'?'Document':'Subject'}</th><th>{sourceLabel(a)}</th><th>{sourceLabel(b)}</th></tr></thead><tbody>{differing.slice(0,showAll?2000:25).map(d=><tr key={d.id}><td>{dataset.kind==='texts'?<button type="button" className="docbutton" onClick={()=>onOpenText(d.id)}>{d.name}</button>:d.name}</td><td><span className="answer-cell">{d.a}</span></td><td><span className="answer-cell">{d.b}</span></td></tr>)}</tbody></table></div>{differing.length>25&&<button type="button" className="textbutton" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show fewer':`Show all ${Math.min(differing.length,2000).toLocaleString('en-US')}`}</button>}</>:<p className="hint">The two sources give the same value for every compared {unit}.</p>}
    </>:<p className="research-empty">No {unit} has a value in both {sourceLabel(a)} and {sourceLabel(b)} yet.</p>)}
   </>}
  </section>
 </div>;
}
