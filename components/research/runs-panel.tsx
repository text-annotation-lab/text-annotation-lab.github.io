'use client';
// Runs & agreement: every run with its settings, and how far two sources of
// labels agree (a run with human labels, or one run with another).
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {PROVIDERS,modelName,reasoningOptionLabel,type Provider} from '@/lib/providers';
import {defaultOutputLimit} from '@/lib/request-settings';
import {agreementJob,agreementTable,autoLevel,disagreements,leftOutNote,pairSources,runJob,sourceFields,sourceLabel,statLines,type LevelChoice} from '@/lib/research/agreement';
import {computeIntervals,intervalsOf} from '@/lib/research/intervals';
import {comparisonReport,groupColumns} from '@/lib/research/comparison-report';
import {fileStem,runLines,sourceOf,unitOf,type Dataset,type RunLine} from '@/lib/research/export';
import {scaleText} from '@/lib/research/score-scale';
import {requestLines,requestParts,runRequests} from '@/lib/research/export-data';
import {formText} from '@/lib/request-frame';
import {runFacts,type RunFacts} from '@/lib/research/export-tables';
import type {RecordedRequest} from '@/lib/research/requests';
import {LABEL_LENGTH,retryable,runState,type RunState} from '@/lib/research/runs';
import {toCsv} from '@/lib/research/parse-table';
import {fieldLabel,parseSource,pickField,sourceKey,type CompareSource} from '@/lib/research/view';
import type {Agreement} from '@/lib/research/metrics';
import {answersLabel} from '@/lib/answer-types';
import {downloadBytes,downloadText} from './download';

const when=(time:string)=>{const date=new Date(time);return !time||Number.isNaN(date.getTime())?'—':date.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});};
// In the table the date and the time may go on two lines, so the table fits a laptop screen.
const whenCell=(time:string)=>{const date=new Date(time);return !time||Number.isNaN(date.getTime())?'—':<><span className="research-nowrap">{date.toLocaleDateString('en-US',{dateStyle:'medium'})},</span> <span className="research-nowrap">{date.toLocaleTimeString('en-US',{timeStyle:'short'})}</span></>;};
const money=(amount:number)=>amount===0?'$0':amount<0.0001?'< $0.0001':'$'+amount.toFixed(amount<0.1?4:2);
const BOOTSTRAPPED=new Set(['cohenKappa','weightedKappa','weightedKappaLinear','krippendorffAlpha','gwetAC1','gwetAC2Linear','meanDifference','mae']);
const EMPTY:Dataset={kind:'texts',rows:[],runs:[],columns:[],samples:[]};
const DATASET_NAMES={texts:'Uploaded texts',knowledge:'Model knowledge'} as const;
const count=(n:number)=>n.toLocaleString('en-US');
// How a run's state is shown: the classes are those of a text's status in the results table.
const STATE_CLASS:Record<RunState,string>={running:'running',submitted:'queued',completed:'done',failed:'error'};
// The data of the panel: a dataset with the requests its runs kept.
type PanelData=Dataset&{requests?:RecordedRequest[]};

// The settings of one run, in a window: what the run was started with, what its results add (how they were
// sent, retries), the prompt, and the request every text of the run was sent with.
function RunSettings({dataset,run,facts,state,onClose}:{dataset:PanelData;run:RunLine;facts:RunFacts;state:RunState;onClose:()=>void}){
 const unit=unitOf(dataset),knowledge=dataset.kind==='knowledge';
 const sent=useMemo(()=>runRequests({name:'',dataset,requests:dataset.requests,lab:''},run.number),[dataset.rows,dataset.requests,run.number]);
 const frame=(sent.text||sent.pdf)?.frame;
 const body=useMemo(()=>{if(!frame)return '';try{return JSON.stringify(JSON.parse(frame.body),null,2);}catch{return frame.body;}},[frame?.body]);
 // What the Lab added to the prompt (Model knowledge's paragraph; in runs of the earlier answer format, also the
 // paragraph on that format), read from the request: what follows the prompt as written. undefined: the prompt as
 // sent does not begin with it, and it is shown whole.
 const asSent=useMemo(()=>{if(!frame)return undefined;try{return requestParts(frame).prompt;}catch{return undefined;}},[frame?.body]),written=formText(run.prompt||'');
 const lead=asSent===undefined?undefined:[written,written.trimEnd()].find(start=>asSent.startsWith(start)),added=asSent===undefined?'':lead===undefined?undefined:asSent.slice(lead.length).replace(/^\s+/,'');
 const kept=sent.total-sent.rebuilt-sent.unknown;
 const record=sent.rebuilt===0&&sent.unknown===0?'It was kept when the run was made.':kept===0?'It was not kept when the run was made, so it is built again here from the run’s settings by this version of the Lab.':`It was kept when the run was made for ${count(kept)} of ${count(sent.total)} requests; for the others it is built again from their settings.`;
 const batches=facts.batchIds.length?` (${facts.batchIds.join(', ')})`:'';
 const mode=state==='submitted'&&!facts.requests.total?'Batch':facts.processing==='batch'?'Batch'+batches:facts.processing==='instant and batch'?'Instant and batch'+batches:'Instant';
 const item=(name:string,value:ReactNode)=><div><dt>{name}</dt><dd>{value}</dd></div>;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}>
  <DialogContent className="research-dialog research-wide research-preview research-run-settings">
   <DialogTitle>Run #{run.number} settings{run.label?` · ${run.label}`:''}</DialogTitle>
   <DialogDescription>{run.recorded?'The settings this run was started with; every request of the run used them.':'The settings of this run, read from its results.'}{run.mixed?` Results in this run were made with different settings; the table of requests in an export lists them for every ${unit}.`:''}</DialogDescription>
   <dl className="research-cells">
    {item('Provider / model',`${PROVIDERS[run.provider as Provider]?.label||run.provider||'—'} / ${run.model||'—'}`)}
    {item('Reasoning effort',run.effort?reasoningOptionLabel(run.effort):'—')}
    {item('Prompt version','v'+run.promptVersion)}
    {item('Mode',mode)}
    {item('Prompt caching',run.caching)}
    {item(`Annotations per ${unit}`,run.repeats||1)}
    {item('Temperature',run.temperature??'the model’s own')}
    {item('Max output tokens',count(run.maxOutput??defaultOutputLimit(run.provider,run.model))+(run.maxOutput===undefined?' (the Lab’s own limit)':''))}
    {item('Reasoning summary',run.summary==='on'?'recorded':run.summary==='off'?'not requested':'recorded in part')}
    {knowledge&&item('Web search',run.webSearch?'yes':'no')}
    {item('Answer fields',answersLabel(run.answerFields,run.answerSettings))}
    {run.answerSettings?.plain&&dataset.scoreScale&&item('Scale of the scores',`${scaleText(dataset.scoreScale)} (set for the study, for the statistics; not sent)`)}
    {run.scope&&item('Scope',run.scope)}
    {item('Started',when(run.startedAt))}
    {facts.finished&&item('Latest result',when(facts.finished))}
    {run.retries?.length?item('Retries',run.retries.map(retry=>`${count(retry.requests)} request${retry.requests===1?'':'s'} sent again ${when(retry.at)}`).join('; ')):null}
    {facts.requests.replaced>0&&item('Earlier attempts',`${count(facts.requests.replaced)} failed attempt${facts.requests.replaced===1?' was':'s were'} sent again; the exports keep ${facts.requests.replaced===1?'it':'them'}`)}
    {item('Version of the Lab',facts.labs.join('; ')||'not recorded')}
   </dl>
   <h3>Prompt</h3>
   <pre className="research-preview-text" tabIndex={0}>{run.prompt||'(no prompt recorded)'}</pre>
   {added?<><h3>Added by the Lab after the prompt</h3><pre className="research-preview-text" tabIndex={0}>{added}</pre></>:added===undefined&&asSent?<><h3>Prompt as sent</h3><pre className="research-preview-text" tabIndex={0}>{asSent}</pre></>:null}
   {run.system&&<><h3>System prompt</h3><pre className="research-preview-text" tabIndex={0}>{run.system}</pre></>}
   <h3>Shared request body</h3>
   {frame?<>
    <p className="hint">The request sent for each {unit} of this run, to <code>{frame.url}</code>. Marks stand where the {knowledge?'subject goes':'document and its name go'}. {record}{sent.forms>1?` The run sent ${count(sent.forms)} different bodies (a PDF goes as a file, and a batch is worded differently); this is the one most requests used.`:''} No API key is part of it.</p>
    <pre className="research-preview-text research-preview-code" tabIndex={0}>{body}</pre>
   </>:<p className="hint">{sent.total?'The settings of this run’s requests were not recorded, so the request cannot be shown.':'No request of this run has come back yet.'}</p>}
  </DialogContent>
 </Dialog>;
}

// How far two sources agree, in words and a bar: how many got the same answer, how far apart the others are, and
// the commonest mix-ups of categories.
function Glance({stats,unit}:{stats:Agreement;unit:string}){
 const n=stats.n,g=stats.gaps,plural=(k:number)=>`${count(k)} ${unit}${k===1?'':'s'}`,share=(k:number)=>`${Math.round(k/Math.max(1,n)*100)}%`;
 const same=g?g.same:Math.round((stats.percentAgreement??0)*n),diff=n-same;
 const small=g?g.secondHigherSmall+g.secondLowerSmall:0,large=g?g.secondHigherLarge+g.secondLowerLarge:0;
 const higher=g?g.secondHigherSmall+g.secondHigherLarge:0,lower=g?g.secondLowerSmall+g.secondLowerLarge:0;
 // With half points among the differences (combined answers such as 0.5 or 1.5), the middle group is every
 // difference under 2 points, not “off by 1”.
 const segments=g?[{n:same,kind:'same',label:'Same answer'},{n:small,kind:'near',label:g.fractional?'Off by less than 2':'Off by 1'},{n:large,kind:'far',label:'Off by 2 or more'}]:[{n:same,kind:'same',label:'Same answer'},{n:diff,kind:'far',label:'Different answer'}];
 const mixups=g?[]:stats.categories.flatMap(x=>stats.categories.filter(y=>y!==x&&(stats.confusion[x]?.[y]??0)>0).map(y=>({x,y,n:stats.confusion[x][y]}))).sort((p,q)=>q.n-p.n).slice(0,3);
 const opposite=stats.oppositeDirection!==null&&stats.midpoint!==null?Math.round(stats.oppositeDirection*n):0;
 return <div className="research-glance">
  <h4>At a glance</h4>
  <p><strong>{plural(same)}</strong> ({share(same)}) got the same answer from both sides{diff>0?<>; <strong>{plural(diff)}</strong> ({share(diff)}) got different answers.</>:'.'}</p>
  <div className="research-glance-bar" role="img" aria-label={segments.map(x=>`${x.label}: ${x.n}`).join(', ')}>{segments.map(x=><div key={x.kind} className={x.kind} style={{width:`${x.n/Math.max(1,n)*100}%`}} title={`${x.label}: ${x.n}`}/>)}</div>
  <div className="research-glance-legend">{segments.map(x=><span key={x.kind}><i className={x.kind}/>{x.label}: <strong>{count(x.n)}</strong> ({share(x.n)})</span>)}</div>
  {g&&diff>0&&<ul>
   <li>When they differ, the “Compared with” side gives the <strong>higher</strong> value in {plural(higher)} and the <strong>lower</strong> value in {plural(lower)}.</li>
   {opposite>0&&<li>In {plural(opposite)} ({share(opposite)}) the two land on opposite sides of the middle of the scale ({stats.midpoint}): they disagree about the direction, not just the degree.</li>}
  </ul>}
  {mixups.length>0&&<><p className="research-glance-title">Most common mix-ups (Annotations → Compared with):</p><ul>{mixups.map(m=><li key={m.x+'\u0001'+m.y}>“{m.x}” where the other side says “{m.y}”: <strong>{plural(m.n)}</strong></li>)}</ul></>}
 </div>;
}

// onRenameRun, onRetryRun: uploaded texts only (a run of Model knowledge has no record to carry a label, and its
// failed subjects are queued for retry in its own workspace).
export function RunsPanel({datasets,studyName,locked,onShowRun,onDeleteRun,onOpenText,onRenameRun,onRetryRun}:{datasets:PanelData[];studyName?:string;locked:boolean;onShowRun:(run:number)=>void;onDeleteRun:(run:number)=>void;onOpenText:(id:string)=>void;onRenameRun:(run:number,label:string)=>void;onRetryRun:(run:number)=>void}){
 const [kind,setKind]=useState<Dataset['kind']>('texts');
 const available=datasets.filter(d=>d.rows.length>0);
 const dataset=available.find(d=>d.kind===kind)||available[0]||datasets[0]||EMPTY;
 const unit=unitOf(dataset),lines=useMemo(()=>runLines(dataset),[dataset.rows,dataset.runs]);
 const [aKey,setAKey]=useState(''),[bKey,setBKey]=useState(''),[fieldChoice,setFieldChoice]=useState(''),[level,setLevel]=useState<LevelChoice>('auto'),[tolerance,setTolerance]=useState('1');
 const [intervals,setIntervals]=useState<{key:string;ci:Agreement['ci']}>();
 // The runs table: each run's requests and tokens, how many requests have no usable answer, and the run whose
 // settings window is open.
 const texts=dataset.kind==='texts',[inspect,setInspect]=useState<number>();
 const facts=useMemo(()=>{const all=requestLines(dataset);return new Map(lines.map(run=>[run.number,runFacts(dataset,run,all)]));},[lines]);
 // A text deleted from the study is never sent again; it stays in its runs' results.
 const retries=useMemo(()=>{const active=dataset.rows.filter(row=>!row.removedAt);return new Map(lines.map(run=>[run.number,texts?retryable(active,run.number).requests:0]));},[lines,texts]);
 const inspected=lines.find(run=>run.number===inspect);
 function retry(run:RunLine,requests:number){
  const what=`${count(requests)} request${requests===1?'':'s'} of run #${run.number}`,batch=facts.get(run.number)?.processing!=='instant';
  // Sent now, also for a run that was made as a batch; a large number is asked about first.
  if((batch||requests>50)&&!confirm(`Send ${what} again now? They go out as immediate requests at the full price${batch?' (this run was made as a batch, at half price)':''}, with the settings of the run, and the answers join the run.`))return;
  onRetryRun(run.number);
 }

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
 // Two label columns are compared on the texts in the study; a run also on the texts it used that were deleted since.
 const pairing=useMemo(()=>a&&b?pairSources(a.kind==='column'&&b.kind==='column'?dataset.rows.filter(row=>!row.removedAt):dataset.rows,dataset.columns,a,fieldA,b,fieldB,dataset.scoreScale):undefined,[dataset.rows,dataset.columns,dataset.scoreScale,a&&sourceKey(a),b&&sourceKey(b),fieldA,fieldB]);
 const gone=useMemo(()=>new Set(dataset.rows.filter(row=>row.removedAt).map(row=>row.id)),[dataset.rows]);
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
 // The comparison report of two runs (an Excel file): the column it is broken down by, how far it has got while
 // it is built, and what went wrong.
 const runVsRun=a?.kind==='run'&&!a.rep&&b?.kind==='run'&&!b.rep&&a.run!==b.run;
 const groups=useMemo(()=>groupColumns(dataset),[dataset.rows,dataset.columns]);
 const [groupBy,setGroupBy]=useState(''),[report,setReport]=useState<string|null>(null),[reportError,setReportError]=useState('');
 async function downloadReport(){
  if(!runVsRun||report!==null||a?.kind!=='run'||b?.kind!=='run')return;
  setReport('');setReportError('');
  try{
   const bytes=await comparisonReport(dataset,a.run,b.run,{tolerance:tol,groupBy:groups.includes(groupBy)?groupBy:'',intervals:intervalsOf,onProgress:setReport});
   downloadBytes(`${fileStem(studyName,dataset)}-run-${a.run}-vs-run-${b.run}.xlsx`,bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch(error){setReportError(`The comparison report could not be made: ${error instanceof Error?error.message:String(error)}`);}
  finally{setReport(null);}
 }

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
   {lines.length?<div className="research-table-scroll"><table className="research-table research-runs"><thead><tr><th>Run</th>{texts&&<th>Label</th>}<th>Started</th>{texts&&<th>Scope</th>}<th>Model</th><th>Prompt</th><th>Status</th><th className="num"><span className="research-nowrap">OK / failed</span></th><th className="num">Tokens <span className="research-nowrap">in / out</span></th><th className="num" title="Tokens read from the provider’s prompt cache / written to it">Cache <span className="research-nowrap">read / write</span></th><th className="num">Cost</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{lines.map(run=>{
    const fact=facts.get(run.number)!,state=runState(dataset.rows,run),known=fact.tokens.knownFor>0,failedRequests=retries.get(run.number)||0;
    return <tr key={run.number}>
    <td><strong>#{run.number}</strong></td>
    {texts&&<td><input key={run.label||''} className="research-run-label" aria-label={`Label of run #${run.number}`} placeholder="Add label…" maxLength={LABEL_LENGTH} defaultValue={run.label||''} disabled={locked} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>{if(event.target.value.trim()!==(run.label||''))onRenameRun(run.number,event.target.value);}}/></td>}
    <td className="research-run-started">{whenCell(run.startedAt)}</td>
    {texts&&<td className="research-run-scope">{run.scope||'—'}</td>}
    <td className="research-run-model">{modelName(run.model)}{run.effort&&<span className="research-muted"> · {reasoningOptionLabel(run.effort)}</span>}{run.webSearch&&<span className="research-tag">web search</span>}{run.mixed&&<span className="research-tag warn" title={`Results in this run were made with different settings. The long results table lists the settings of every ${unit}.`}>settings vary</span>}</td>
    <td>v{run.promptVersion}{(run.repeats||1)>1&&<span className="research-tag" title={`${run.repeats} annotations per ${unit}; the answers shown are the combined ones`}>×{run.repeats}</span>}</td>
    <td><span className={'status '+STATE_CLASS[state]}>{state==='submitted'||fact.processing==='batch'?'batch · ':fact.processing==='instant and batch'?'instant and batch · ':''}{state}</span></td>
    <td className="num" title={run.fewer>0?`${count(run.fewer)} ${unit}${run.fewer===1?' has':'s have'} fewer than ${run.repeats} usable annotations`:undefined}>{count(fact.requests.ok)} / {count(fact.requests.failed)}{run.active>0&&<span className="research-muted"> · {count(run.active)} in progress</span>}</td>
    <td className="num">{known?`${count(fact.tokens.input)} / ${count(fact.tokens.output)}`:'—'}</td>
    <td className="num">{known?`${count(fact.tokens.cacheRead)} / ${count(fact.tokens.cacheWrite)}`:'—'}</td>
    <td className="num" title={run.costKnown<run.costCount?`Known for ${run.costKnown} of ${run.costCount} annotations`:undefined}>{run.costKnown?money(run.cost)+(run.costKnown<run.costCount?'+':''):'—'}</td>
    <td className="research-row-actions"><div className="research-run-actions"><button type="button" className="textbutton" onClick={()=>setInspect(run.number)}>Settings</button>{texts&&failedRequests>0&&state!=='running'&&state!=='submitted'&&<button type="button" className="textbutton" disabled={locked} title="Send the requests of this run that have no usable answer again now, with the settings of the run. The new answers join the run." onClick={()=>retry(run,failedRequests)}>Retry failed ({count(failedRequests)})</button>}{texts&&<><button type="button" className="textbutton" onClick={()=>onShowRun(run.number)}>Show in Workspace</button><button type="button" className="textbutton" disabled={locked} onClick={()=>{if(confirm(`Delete run #${run.number} and its ${run.done+run.failed} results? Texts keep the results of their other runs. This cannot be undone.`))onDeleteRun(run.number);}}>Delete</button></>}</div></td>
   </tr>;})}</tbody></table></div>:<p className="research-empty">No runs yet. {dataset.kind==='texts'?'Annotate texts in the Workspace. Each setup you run (model, reasoning effort, prompt, and answer fields) is listed here as a numbered run.':'Annotate subjects under Model knowledge. Each repeat of the study is listed here as a numbered run.'}</p>}
   {inspected&&<RunSettings dataset={dataset} run={inspected} facts={facts.get(inspected.number)!} state={runState(dataset.rows,inspected)} onClose={()=>setInspect(undefined)}/>}
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
     <Glance stats={stats} unit={unit}/>
     <div className="research-stats">{statLines(stats,ci,unit).map(line=><div key={line.key} className="research-stat" title={line.help}>
      <span className="research-stat-label">{line.label}</span><strong>{line.value}</strong>
      {line.key!=='n'&&line.key!=='spearman'&&<span className="research-stat-ci">{line.ciText?`95% CI ${line.ciText}`:stats.n<10?'':BOOTSTRAPPED.has(line.key)&&!ci?'95% CI: computing…':''}</span>}
     </div>)}</div>
     <p className="hint">{[pairing.onlyA?`${pairing.onlyA.toLocaleString('en-US')} ${unit}${pairing.onlyA===1?' has':'s have'} a value only in ${sourceLabel(a)}`:'',pairing.onlyB?`${pairing.onlyB.toLocaleString('en-US')} only in ${sourceLabel(b)}`:''].filter(Boolean).join('; ')}{pairing.onlyA||pairing.onlyB?'; these are not compared. ':''}{leftOutNote(stats,unit,pairing.leftOut)} {pairing.basis} {stats.n<10?`Intervals need at least 10 compared ${unit}s.`:`Intervals for the coefficients are bootstrap percentile intervals (10,000 resamples of the ${unit}s, fixed seed); those for shares are Wilson intervals.`} Values are compared after trimming and ignoring case.</p>
     {categories.length>0&&(categories.length<=25?<div className="research-table-scroll"><table className="research-table research-confusion"><caption>Rows: {sourceLabel(a)}. Columns: {sourceLabel(b)}.</caption><thead><tr><th/>{categories.map(c=><th key={c} scope="col">{c}</th>)}</tr></thead><tbody>{categories.map(row=><tr key={row}><th scope="row">{row}</th>{categories.map(column=>{const n=stats.confusion[row]?.[column]??0;return <td key={column} className={n?row===column?'agree':'disagree':''}>{n||''}</td>;})}</tr>)}</tbody></table></div>:<p className="hint">{categories.length} distinct values: too many to show as a table. The downloaded comparison includes the full table.</p>)}
     <div className="research-page-actions"><Button type="button" variant="outline" onClick={downloadComparison}><Download size={16}/>Download this comparison (CSV)</Button>
      {runVsRun&&<><Button type="button" variant="outline" disabled={report!==null} onClick={downloadReport} title="Every answer field the two runs can be compared on, in one Excel file: the figures with intervals, a sheet for expert review, draft text for a paper, and the runs’ settings"><Download size={16}/>{report===null?'Download comparison report (Excel)':`Building the report…${report?` ${report}`:''}`}</Button>
      {groups.length>0&&<select className="research-report-groups" aria-label="Break the comparison report down by a column" value={groups.includes(groupBy)?groupBy:''} disabled={report!==null} onChange={event=>setGroupBy(event.target.value)} title="Adds a sheet with the same figures for each value of the column (exploratory)"><option value="">No breakdown</option>{groups.map(column=><option key={column} value={column}>Break down by {column}</option>)}</select>}</>}
     </div>
     {reportError&&<p className="message" role="alert">{reportError}</p>}
     <h4>Disagreements ({differing.length.toLocaleString('en-US')})</h4>
     {differing.length?<><div className="research-table-scroll"><table className="research-table"><thead><tr><th>{unit==='text'?'Document':'Subject'}</th><th>{sourceLabel(a)}</th><th>{sourceLabel(b)}</th></tr></thead><tbody>{differing.slice(0,showAll?2000:25).map(d=><tr key={d.id}><td>{dataset.kind==='texts'&&!gone.has(d.id)?<button type="button" className="docbutton" onClick={()=>onOpenText(d.id)}>{d.name}</button>:d.name}{gone.has(d.id)&&<span className="research-tag" title="Deleted from the study; kept for the runs that used it">deleted</span>}</td><td><span className="answer-cell">{d.a}</span></td><td><span className="answer-cell">{d.b}</span></td></tr>)}</tbody></table></div>{differing.length>25&&<button type="button" className="textbutton" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show fewer':`Show all ${Math.min(differing.length,2000).toLocaleString('en-US')}`}</button>}</>:<p className="hint">The two sources give the same value for every compared {unit}.</p>}
    </>:<p className="research-empty">No {unit} has a value in both {sourceLabel(a)} and {sourceLabel(b)} yet.</p>)}
   </>}
  </section>
 </div>;
}
