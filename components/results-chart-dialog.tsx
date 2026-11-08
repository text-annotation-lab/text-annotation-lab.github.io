'use client';
import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import type {ResultsChartDialogProps} from './results-chart';
import {ChartReview} from './chart-review';
import {buildUnits,chartFieldList,formatNumber,groupableFields,mean,median,mostCommon,periodLengths,settingsSummary,suggestedGroupRule,suggestedPeriodLength,suggestedRowGroup,suggestedRowYear,suggestedScale,type ChartSourceRow,type Field,type GroupRule,type Scale,type Unit} from '@/lib/chart-model';
import {OTHER,categoryColors,crowdedDots,distributionCategories,distributionNumbers,distributionScale,downloadPng,downloadSvg,exportFigure,groupsView,runsView,scaleColor,scaleLabel,scalePoints,timeDots,timeShares,type Figure} from '@/lib/chart-figures';
import './results-chart.css';

type Tab='distribution'|'time'|'groups'|'runs'|'list';
const tabLabels:Record<Tab,string>={distribution:'Distribution',time:'Over time',groups:'Compare groups',runs:'Run agreement',list:'Ranked list'};
const excerpt=(value:string,length=220)=>value.length>length?value.slice(0,length-1)+'…':value;

function readStored<T>(key:string):T|undefined{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw) as T:undefined;}catch{return undefined;}}
function writeStored(key:string,value:unknown){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Storage can be unavailable; the chart still works. */}}

function Segmented<T extends string>({options,value,onChange,label}:{options:{value:T;label:string}[];value:T;onChange:(value:T)=>void;label:string}){
 return <div className="chart-seg" role="radiogroup" aria-label={label}>{options.map(option=><button type="button" key={option.value} role="radio" aria-checked={value===option.value} className={value===option.value?'on':''} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div>;
}

function Stats({items}:{items:[string,ReactNode,ReactNode?][]}){
 return <dl className="chart-stats">{items.map(([label,value,extra])=><div key={label}><dt>{label}</dt><dd>{value}{extra?<small>{extra}</small>:null}</dd></div>)}</dl>;
}

function ScaleKey({scale,onEdit}:{scale:Scale;onEdit:()=>void}){
 const points=scalePoints(scale),shown=points.length<=11?points:points.filter((_,i)=>i%Math.ceil(points.length/11)===0);
 return <div className="chart-scale"><span className="chart-key" aria-hidden="true"><small>{scaleLabel(scale,scale.min)}{scale.lowLabel?' '+scale.lowLabel:''}</small><span>{shown.map(p=><i key={p} style={{background:scaleColor(scale,p)}}/>)}</span><small>{scaleLabel(scale,scale.max)}{scale.highLabel?' '+scale.highLabel:''}</small></span>
  <span className="chart-scale-meta">Scale {scaleLabel(scale,scale.min)} to {scaleLabel(scale,scale.max)} · {scale.type==='sequential'?'low to high':'neutral middle'}{scale.source==='data'?' · read from the results':''}</span>
  <button type="button" className="chart-link" onClick={onEdit}>Edit scale</button></div>;
}

function ScaleEditor({scale,suggested,onSave,onCancel}:{scale:Scale;suggested:Scale;onSave:(scale:Scale)=>void;onCancel:()=>void}){
 const [min,setMin]=useState(String(scale.min)),[max,setMax]=useState(String(scale.max)),[type,setType]=useState(scale.type),[low,setLow]=useState(scale.lowLabel),[high,setHigh]=useState(scale.highLabel);
 const lo=Number(min.replace('−','-')),hi=Number(max.replace('−','-')),ok=Number.isInteger(lo)&&Number.isInteger(hi)&&hi>lo&&hi-lo<=20&&lo<=suggested.min&&hi>=suggested.max;
 const id=useId();
 return <div className="chart-scale-editor" role="group" aria-label="Edit scale">
  <div className="row"><label htmlFor={id+'min'}>Lowest score</label><input id={id+'min'} value={min} inputMode="numeric" maxLength={4} onChange={e=>setMin(e.target.value)}/><label htmlFor={id+'max'}>Highest score</label><input id={id+'max'} value={max} inputMode="numeric" maxLength={4} onChange={e=>setMax(e.target.value)}/></div>
  <div className="row"><span className="label">Colors</span><Segmented label="Scale type" value={type} onChange={setType} options={[{value:'sequential',label:'Low to high'},{value:'diverging',label:'Neutral middle'}]}/></div>
  <p className="hint">{type==='sequential'?'One color that darkens toward the highest score. Use it for amounts, such as complexity or intensity.':'Two colors with gray in the middle. Use it when the middle means neutral, such as −3 (very negative) to +3 (very positive).'}</p>
  <div className="row"><label htmlFor={id+'low'}>Label for lowest (optional)</label><input id={id+'low'} className="wide" value={low} maxLength={30} placeholder="e.g., plain" onChange={e=>setLow(e.target.value)}/><label htmlFor={id+'high'}>Label for highest</label><input id={id+'high'} className="wide" value={high} maxLength={30} placeholder="e.g., formal, dense" onChange={e=>setHigh(e.target.value)}/></div>
  {!ok&&<p className="figure-error" role="alert">Use whole numbers, at most 20 apart, that include every result ({formatNumber(suggested.min)} to {formatNumber(suggested.max)}).</p>}
  <div className="actions"><button type="button" className="chart-link" onClick={()=>onSave({...suggested,source:suggested.source})}>Reset to suggestion</button><span/><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={!ok} onClick={()=>onSave({min:lo,max:hi,type,lowLabel:low.trim(),highLabel:high.trim(),source:'custom'})}>Apply</Button></div>
 </div>;
}

function useWidth(){
 const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(760);
 useEffect(()=>{const element=ref.current;if(!element)return;const resize=()=>{if(element.clientWidth)setWidth(Math.max(280,Math.floor(element.clientWidth)));};resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
 return [ref,width] as const;
}

function ChartBody({rows,subjectLabel,onInspect,onSaveYears,onSaveGroups}:{rows:ChartSourceRow[];subjectLabel:string;onInspect:(id:string)=>void;onSaveYears?:ResultsChartDialogProps['onSaveYears'];onSaveGroups?:ResultsChartDialogProps['onSaveGroups']}){
 const noun=subjectLabel==='Subject'?'subjects':'texts',supportsRuns=rows.some(row=>row.runNumber!==undefined);
 const fields=useMemo(()=>chartFieldList(rows),[rows]);
 const [fieldKey,setFieldKey]=useState(''),field:Field|undefined=fields.find(f=>f.key===fieldKey)||fields[0];
 const settings=useMemo(()=>settingsSummary(rows),[rows]);
 const [latestOnly,setLatestOnly]=useState(true),[combine,setCombine]=useState(true);
 const allNames=useMemo(()=>rows.filter(r=>r.status==='done').map(r=>r.sourceName||r.name),[rows]);
 const ruleOptions=useMemo(()=>{
  const done=rows.filter(r=>r.status==='done');
  return [...groupableFields(done).map(h=>({value:`field:${h}`,label:`The “${h}” field`})),...(noun==='texts'?[{value:'start',label:'The start of each filename'},{value:'end',label:'The end of each filename'}]:[]),{value:'',label:'Nothing (type them in)'}];
 },[rows,noun]);
 const [groupRule,setGroupRule]=useState<GroupRule|''|undefined>(undefined);
 const autoRule=useMemo(()=>suggestedGroupRule(allNames,rows.filter(r=>r.status==='done')),[allNames,rows]);
 const rule=(groupRule===undefined?autoRule:groupRule||undefined) as GroupRule|undefined;
 const built=useMemo(()=>field?buildUnits(rows,field,{latestOnly,combine,groupRule:rule}):undefined,[rows,field,latestOnly,combine,rule]);
 const [tab,setTab]=useState<Tab>('distribution');
 const [scaleEdits,setScaleEdits]=useState<Record<string,Scale>>(()=>readStored('lab-chart-scales')||{});
 const [editingScale,setEditingScale]=useState(false);
 const [review,setReview]=useState<'year'|'group'|null>(null);
 const [timeMode,setTimeMode]=useState<'dots'|'periods'|undefined>(),[trend,setTrend]=useState(true),[periodChoice,setPeriodChoice]=useState<number|undefined>();
 const [picked,setPicked]=useState<number|null>(null),[matchPage,setMatchPage]=useState(0);
 const [showTable,setShowTable]=useState(false),[exporting,setExporting]=useState(false);
 const [query,setQuery]=useState(''),[order,setOrder]=useState<'highest'|'lowest'>('highest'),[listPage,setListPage]=useState(0);
 const [plotRef,width]=useWidth();
 useEffect(()=>{setPicked(null);setMatchPage(0);},[tab,fieldKey,timeMode,trend,periodChoice,latestOnly,combine,rule]);

 if(!field||!built)return <p className="chart-empty">No completed results to chart yet.</p>;
 const {units,kind}=built;
 const numbers=units.map(u=>u.number).filter((v):v is number=>v!==null);
 // The scale comes from the individual results, not from averages across runs or chunks.
 const rawNumbers=units.flatMap(u=>u.numbers).filter((v):v is number=>v!==null);
 const suggested=kind==='scale'?suggestedScale(built.rows,field,rawNumbers):undefined;
 const scaleKey=`${field.label}`;
 const stored=scaleEdits[scaleKey];
 const scale=kind!=='scale'?undefined:stored&&rawNumbers.every(v=>v>=stored.min&&v<=stored.max)?stored:suggested;
 const categories=kind==='category'?(()=>{const counts=new Map<string,number>();units.forEach(u=>counts.set(u.value,(counts.get(u.value)||0)+1));const sorted=Array.from(counts).sort((a,b)=>b[1]-a[1]).map(([v])=>v);return sorted.length>8?[...sorted.slice(0,7)]:sorted;})():undefined;
 const tabs:Tab[]=['distribution','time','groups',...(supportsRuns?['runs' as Tab]:[]),'list'];
 const view=kind==='text'?'list':tab;
 // Downloaded figures are drawn at a fixed print width, without the interactive layer.
 const o={width:exporting?860:width,interactive:!exporting,noun};
 const byId=new Map(rows.map(row=>[row.id,row]));
 const unitOf=new Map<string,Unit>();units.forEach(u=>u.ids.forEach(id=>unitOf.set(id,u)));

 // ----- figure for the current view -----
 let figure:Figure|undefined,empty:ReactNode=null,stats:[string,ReactNode,ReactNode?][]=[],read='',legend:{label:string;color:string}[]=[];
 const dated=units.filter(u=>u.year!==undefined),grouped=units.filter(u=>u.group!==undefined);
 // With many texts per year the dots pile up, so shares per period become the default.
 const timeView:'dots'|'periods'=kind==='category'?'periods':!scale?'dots':timeMode??(dated.length&&crowdedDots(dated,width)?'periods':'dots');
 const groupNames=Array.from(new Set(grouped.map(u=>u.group!))).sort((a,b)=>a.localeCompare(b));
 const categoryLegend=categories?[...Array.from(categoryColors(categories)).map(([label,color])=>({label,color})),...(units.some(u=>!categories.includes(u.value))?[{label:'Other',color:OTHER}]:[])]:[];
 try{
  if(view==='distribution'){
   if(kind==='scale'&&scale){figure=distributionScale(units,scale,o);
    stats=[[noun==='texts'?'Texts':'Subjects',units.length],['Middle score (median)',formatNumber(median(numbers))],['Average',formatNumber(mean(numbers),1)],['Most common',mostCommon(units.map(u=>scaleLabel(scale,Math.round(u.number!))))],['Lowest – highest',`${scaleLabel(scale,Math.min(...numbers))} – ${scaleLabel(scale,Math.max(...numbers))}`]];
    read=`Each bar counts the ${noun} that received that score. Every point on the scale is shown, even when no ${noun.replace(/s$/,'')} received it, so you see where results sit on the whole scale. Select a bar to read those ${noun} and the model’s explanations.`;}
   else if(kind==='scale'){figure=distributionNumbers(units,o);stats=[[noun==='texts'?'Texts':'Subjects',units.length],['Middle value (median)',formatNumber(median(numbers))],['Average',formatNumber(mean(numbers))],['Lowest – highest',`${formatNumber(Math.min(...numbers))} – ${formatNumber(Math.max(...numbers))}`]];
    read=`Each bar counts the ${noun} whose value falls in that range. Select a bar to read them.`;}
   else{figure=distributionCategories(units,o);const top=mostCommon(units.map(u=>u.value));stats=[[noun==='texts'?'Texts':'Subjects',units.length],['Most common',top.length>28?top.slice(0,27)+'…':top],['Categories',new Set(units.map(u=>u.value)).size]];
    read=`Each bar counts the ${noun} the model put in that category, largest first. Select a bar to read them and the model’s explanations.`;}
  }else if(view==='time'){
   if(!dated.length)empty=<div className="chart-empty-state"><strong>No years yet</strong><p>{noun==='texts'?'Put the year in each filename, such as 1945_Roosevelt.txt, or type the years in yourself.':'Add a “Year” field to your subjects, or type the years in yourself.'}</p>{onSaveYears&&<Button variant="outline" onClick={()=>setReview('year')}>Enter years</Button>}</div>;
   else{
    const years=dated.map(u=>u.year!),length=periodChoice||suggestedPeriodLength(years);
    if(timeView==='dots'){figure=timeDots(dated,scale,trend,o);read=`Each dot is one ${noun.replace(/s$/,'')}, placed at its year and exact score.${trend?' The line is a smoothed average: it shows the general direction, not a prediction.':''} Select a dot to read the ${noun.replace(/s$/,'')} and the model’s explanation.`;}
    else{figure=timeShares(dated,kind==='scale'?scale:undefined,categories,length,o);read=`Each column is one ${length}-year period and adds up to 100%.${scale?' The bold number is the score.':''} Check the count under each column: with few ${noun} in a period, one ${noun.replace(/s$/,'')} moves the column a lot.`;if(categories)legend=categoryLegend;}
    const first=Math.min(...years),last=Math.max(...years);
    stats=[[`${noun==='texts'?'Texts':'Subjects'} with a year`,`${dated.length} of ${units.length}`],['Years',first===last?String(first):`${first}–${last}`]];
    if(numbers.length&&kind==='scale'){const early=dated.filter(u=>u.year!<=median(years)).map(u=>u.number!),late=dated.filter(u=>u.year!>median(years)).map(u=>u.number!);if(early.length&&late.length)stats.push(['Average, earlier half',formatNumber(mean(early),1)],['Average, later half',formatNumber(mean(late),1)]);}
   }
  }else if(view==='groups'){
   if(groupNames.length<2)empty=<div className="chart-empty-state"><strong>{groupNames.length===1?'Only one group so far':'No groups yet'}</strong><p>{noun==='texts'?`Groups let you compare, for example, women’s and men’s obituaries or two campaigns. The Lab can read groups from your filenames (such as …F.txt and …M.txt) or you can type them in.`:'Groups let you compare subjects, for example by author or period. The Lab can read them from one of your subject fields, or you can type them in.'}</p>{onSaveGroups&&<Button variant="outline" onClick={()=>setReview('group')}>Set up groups</Button>}</div>;
   else if(kind==='scale'&&!scale)empty=<div className="chart-empty-state"><strong>Groups need a score scale</strong><p>These values are not whole-number scores on a short scale (such as 1 to 7), so the groups cannot be shown as shares of each score. Use “Show as table” on the Distribution tab, or Download Excel, to compare them.</p></div>;
   else{
    figure=groupsView(grouped,groupNames,kind==='scale'?scale:undefined,categories,o);if(categories)legend=categoryLegend;
    if(kind==='scale'&&scale){const avgs=groupNames.map(g=>({g,m:mean(grouped.filter(u=>u.group===g).map(u=>u.number!))}));
     stats=avgs.slice(0,4).map(({g,m})=>[`${g}, average`,formatNumber(m,2)] as [string,ReactNode]);
     if(avgs.length===2)stats.push([`${avgs[1].g} minus ${avgs[0].g}`,formatNumber(avgs[1].m-avgs[0].m,2),'points']);
     read=`Each bar is one group and adds up to 100%${scale.type==='diverging'?', centered on the neutral score, so lower scores extend left and higher ones right':''}. ${width<620?'Below':'On the right'}, each dot is a group’s average; the short bar shows how much it could shift with a different sample of ${noun} (a 95% range). If two ranges don’t overlap, the difference is unlikely to be chance alone; ranges that overlap a little can still differ. Neither shows whether the model judged correctly.`;}
    else{stats=groupNames.slice(0,4).map(g=>[g,`${grouped.filter(u=>u.group===g).length} ${noun}`] as [string,ReactNode]);read=`Each bar is one group and adds up to 100%, so groups of different sizes can be compared. Select a segment to read those ${noun}.`;}
   }
  }else if(view==='runs'){
   const repeated=units.filter(u=>u.values.length>1);
   if(!combine)empty=<div className="chart-empty-state"><strong>Runs are counted separately</strong><p>Switch “Count” back to one value per subject to compare runs.</p></div>;
   else if(!repeated.length)empty=<div className="chart-empty-state"><strong>No repeated runs yet</strong><p>Run some subjects again with the same settings (use “Repeat” in the results). This tab then shows whether the model gives the same answer each time.</p></div>;
   else{figure=runsView(units,kind==='scale'?scale:undefined,o);
    const spreads=repeated.map(u=>kind==='scale'?Math.max(...u.numbers as number[])-Math.min(...u.numbers as number[]):new Set(u.values).size-1);
    stats=[['Same answer in every run',`${spreads.filter(d=>d===0).length} of ${repeated.length}`],...(kind==='scale'?[['Within one point',`${spreads.filter(d=>d<=1).length} of ${repeated.length}`] as [string,ReactNode],['Largest difference',`${formatNumber(Math.max(...spreads))} points`] as [string,ReactNode]]:[])];
    read=`One row per subject, one dot per run with the same settings. Subjects whose runs disagree come first: read their explanations to see why. The other tabs use each subject’s ${kind==='scale'?'average':'most common answer'} across its runs.`;}
  }
 }catch(error){empty=<p className="figure-error" role="alert">{error instanceof Error?error.message:'Could not draw this chart.'}</p>;}

 const pick=picked===null?undefined:figure?.picks[picked];
 const matchIds=pick?pick.ids:[],matchRows=matchIds.map(id=>byId.get(id)).filter(Boolean) as ChartSourceRow[];
 const pages=Math.ceil(matchRows.length/10),safePage=Math.min(matchPage,Math.max(0,pages-1));
 function select(target:EventTarget|null){if(!(target instanceof Element))return;const mark=target.closest('[data-pick]');if(!mark)return;const index=Number(mark.getAttribute('data-pick'));setPicked(current=>current===index?null:index);setMatchPage(0);}

 const caption=autoCaption({field,units,kind,scale,view,trend:view==='time'&&timeView==='dots'&&trend,rows:built.rows,noun,period:view==='time'&&timeView==='periods'?periodChoice||(dated.length?suggestedPeriodLength(dated.map(u=>u.year!)):0):0,groups:groupNames});
 const yearEntries=units.map(unit=>{const row=byId.get(unit.ids[0])!;const year=row.chartYear===null?'':typeof row.chartYear==='number'?String(row.chartYear):String(suggestedRowYear(row)??'');return {unit,initial:year};});
 const groupEntries=units.map(unit=>{const row=byId.get(unit.ids[0])!;const g=row.chartGroup===null?'':typeof row.chartGroup==='string'?row.chartGroup:suggestedRowGroup(row,rule)??'';return {unit,initial:g};});

 if(review){
  return <ChartReview kind={review} noun={noun} entries={review==='year'?yearEntries:groupEntries} onCancel={()=>setReview(null)}
   rules={review==='group'?ruleOptions:undefined} rule={rule||''} onRuleChange={value=>setGroupRule(value as GroupRule|'')}
   onApply={values=>{
    const years=new Map<string,number|null>(),groupsOut=new Map<string,string|null>();
    for(const unit of units){const value=values.get(unit.key)??'';for(const id of unit.ids){years.set(id,value?Number(value):null);groupsOut.set(id,value||null);}}
    if(review==='year'){onSaveYears?.(years);setTab('time');}else{onSaveGroups?.(groupsOut);setTab('groups');}
    setReview(null);
   }}/>;
 }

 const ranked=[...units].filter(u=>u.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a,b)=>kind==='scale'?(order==='highest'?b.number!-a.number!:a.number!-b.number!)||a.name.localeCompare(b.name):a.value.localeCompare(b.value)||a.name.localeCompare(b.name));
 const listPages=Math.ceil(ranked.length/25),safeList=Math.min(listPage,Math.max(0,listPages-1));

 if(exporting&&figure)return <FigureExport figure={figure} caption={caption} legend={legend} defaultTitle={`${field.label}${view==='time'?' over time':view==='groups'?' by group':view==='runs'?': agreement between runs':''}`} onBack={()=>setExporting(false)}/>;

 return <>
  <div className="chart-top">
   {fields.length>1?<label className="chart-field">Answer field <select value={field.key} onChange={event=>{setFieldKey(event.target.value);setEditingScale(false);}}>{fields.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label>:<strong className="chart-field-title">{field.label}</strong>}
   <span className="chart-count"><b>{units.length}</b> {units.length===1?noun.replace(/s$/,''):noun} plotted{built.excluded?<> · {built.excluded} left out{built.abstained?` (${built.abstained} insufficient knowledge)`:''}</>:null}{view==='time'&&dated.length>0&&onSaveYears?<> · <button type="button" className="chart-link" onClick={()=>setReview('year')}>Review years</button></>:null}{view==='groups'&&groupNames.length>1&&onSaveGroups?<> · <button type="button" className="chart-link" onClick={()=>setReview('group')}>Edit groups</button></>:null}</span>
  </div>
  {settings.count>1&&<div className="chart-notice" role="note"><p><strong>These results come from {settings.count} different settings.</strong> The prompt, model, or reasoning effort changed during the study, so the scores may not be comparable.</p><label><input type="checkbox" checked={latestOnly} onChange={e=>setLatestOnly(e.target.checked)}/> Chart only the latest settings ({settings.latestCount} {noun})</label></div>}
  {built.combinable&&<div className="chart-count-choice"><span>Count</span><Segmented label="How to count" value={combine?'one':'each'} onChange={v=>setCombine(v==='one')} options={built.hasChunks?[{value:'one',label:'One value per document'},{value:'each',label:'Each chunk'}]:[{value:'one',label:`One value per ${noun.replace(/s$/,'')}`},{value:'each',label:'Each run'}]}/><small>{combine?(built.hasChunks?`Chunks of the same document are combined (${kind==='scale'?'average':'most common answer'}).`:`Runs of the same ${noun.replace(/s$/,'')} are combined (${kind==='scale'?'average':'most common answer'}).`):'Every result counts on its own, so repeated texts weigh more.'}</small></div>}
  {kind==='text'?<p className="chart-notice" role="note">“{field.label}” holds written answers rather than scores or categories, so it is listed rather than charted.</p>:
   <div className="chart-tabs" role="tablist" aria-label="Chart type">{tabs.map(t=><button type="button" role="tab" key={t} aria-selected={view===t} className={view===t?'on':''} onClick={()=>{setTab(t);setShowTable(false);}}>{tabLabels[t]}</button>)}</div>}
  {scale&&view!=='list'&&(editingScale&&suggested?<ScaleEditor scale={scale} suggested={suggested} onCancel={()=>setEditingScale(false)} onSave={next=>{const all={...scaleEdits};if(next.source==='custom')all[scaleKey]=next;else delete all[scaleKey];setScaleEdits(all);writeStored('lab-chart-scales',all);setEditingScale(false);}}/>:<ScaleKey scale={scale} onEdit={()=>setEditingScale(true)}/>)}
  {view==='time'&&dated.length>0&&kind!=='text'&&<div className="chart-options">
   {kind==='scale'&&scale&&<><span>Show</span><Segmented label="Show" value={timeView} onChange={setTimeMode} options={[{value:'dots',label:`Each ${noun.replace(/s$/,'')}`},{value:'periods',label:'Share per period'}]}/></>}
   {timeView==='dots'?<label className="chart-check"><input type="checkbox" checked={trend} onChange={e=>setTrend(e.target.checked)}/> Show trend line</label>:
    <label className="chart-check">Periods of <select value={periodChoice||suggestedPeriodLength(dated.map(u=>u.year!))} onChange={e=>setPeriodChoice(Number(e.target.value))}>{periodLengths.map(l=><option key={l} value={l}>{l} years</option>)}</select></label>}
  </div>}
  {view!=='list'&&stats.length>0&&!empty&&<Stats items={stats}/>}
  {view==='list'?<RankedList units={ranked} page={safeList} pages={listPages} onPage={setListPage} query={query} onQuery={q=>{setQuery(q);setListPage(0);}} order={order} onOrder={setOrder} scale={scale} kind={kind} noun={noun} onInspect={onInspect} explanation={unit=>unit.explanation||byId.get(unit.ids[0])?.explanation||''}/>:<>
   <div className="chart-plot" ref={plotRef}>{empty||(figure&&<div className="chart-svg" onClick={event=>select(event.target)} onKeyDown={event=>{if((event.key==='Enter'||event.key===' ')&&(event.target as Element).closest('[data-pick]')){event.preventDefault();select(event.target);}else if(event.key==='Escape'&&picked!==null){event.preventDefault();event.stopPropagation();setPicked(null);}}} dangerouslySetInnerHTML={{__html:figure.svg}}/>)}</div>
   {legend.length>0&&figure&&<ul className="chart-legend">{legend.map(item=><li key={item.label}><i style={{background:item.color}}/>{item.label}</li>)}</ul>}
   {figure?.notes.map(note=><p key={note} className="chart-note">{note}</p>)}
   {pick&&<div className="chart-matches" role="region" aria-label={`${pick.label}: matching ${noun}`}>
    <div className="chart-matches-head"><strong>{pick.label} · {matchRows.length} {matchRows.length===1?noun.replace(/s$/,''):noun}</strong><button type="button" className="chart-link" onClick={()=>setPicked(null)}>Close</button></div>
    {matchRows.slice(safePage*10,safePage*10+10).map(row=>{const unit=unitOf.get(row.id);return <div className="chart-match" key={row.id}><div><strong>{row.sourceId?`${row.sourceName||row.name} · chunk ${row.chunkIndex}`:row.name}{row.runNumber&&row.runNumber>1?` · Run ${row.runNumber}`:''}</strong><span>{field.label}: {unit?.values[unit.ids.indexOf(row.id)]??''}</span></div>{row.explanation&&<p>{excerpt(row.explanation,400)}</p>}<button type="button" className="chart-link" onClick={()=>onInspect(row.id)}>Open {noun==='texts'?'text':'result'} →</button></div>;})}
    {pages>1&&<div className="chart-pages"><Button variant="outline" disabled={safePage===0} onClick={()=>setMatchPage(safePage-1)}>Previous</Button><span>{safePage+1} / {pages}</span><Button variant="outline" disabled={safePage===pages-1} onClick={()=>setMatchPage(safePage+1)}>Next</Button></div>}
   </div>}
   {read&&!empty&&<p className="chart-read"><strong>How to read this:</strong> {read}</p>}
   {showTable&&figure&&<DataTable units={view==='groups'?grouped:view==='time'?dated:units} showYear={view==='time'} showGroup={view==='groups'} label={field.label} noun={noun}/>}
  </>}
  {view!=='list'&&<div className="chart-foot"><Button variant="outline" disabled={!figure} onClick={()=>setShowTable(v=>!v)}>{showTable?'Hide table':'Show as table'}</Button><Button className="chart-primary" disabled={!figure} onClick={()=>setExporting(true)}>Download figure</Button></div>}
 </>;
}

function RankedList({units,page,pages,onPage,query,onQuery,order,onOrder,scale,kind,noun,onInspect,explanation}:{units:Unit[];page:number;pages:number;onPage:(p:number)=>void;query:string;onQuery:(q:string)=>void;order:'highest'|'lowest';onOrder:(o:'highest'|'lowest')=>void;scale?:Scale;kind:string;noun:string;onInspect:(id:string)=>void;explanation:(u:Unit)=>string}){
 return <div className="chart-list">
  <div className="chart-list-controls"><input type="search" aria-label={`Find ${noun} by name`} placeholder={`Find a ${noun.replace(/s$/,'')}…`} value={query} maxLength={140} onChange={e=>onQuery(e.target.value)}/>{kind==='scale'&&<select aria-label="Order" value={order} onChange={e=>onOrder(e.target.value as 'highest'|'lowest')}><option value="highest">Highest first</option><option value="lowest">Lowest first</option></select>}</div>
  {!units.length?<p className="chart-empty">No matching {noun}. Try another name.</p>:<ol className={'chart-list-rows'+(kind==='text'?' plain':'')} start={page*25+1}>{units.slice(page*25,page*25+25).map(unit=><li key={unit.key}>
   {kind!=='text'&&<span className="chart-chip" style={scale&&unit.number!==null?{background:scaleColor(scale,Math.round(unit.number))}:undefined} data-dark={scale&&unit.number!==null?String(isDark(scaleColor(scale,Math.round(unit.number)))):undefined}>{unit.value}</span>}
   <div><strong>{unit.name}</strong>{kind==='text'?<p>{excerpt(unit.value,300)}</p>:explanation(unit)&&<p>{excerpt(explanation(unit),180)}</p>}</div>
   <button type="button" className="chart-link" onClick={()=>onInspect(unit.ids[0])}>Open →</button></li>)}</ol>}
  {pages>1&&<div className="chart-pages"><Button variant="outline" disabled={page===0} onClick={()=>onPage(page-1)}>Previous</Button><span>{page*25+1}–{Math.min(units.length,page*25+25)} of {units.length}</span><Button variant="outline" disabled={page===pages-1} onClick={()=>onPage(page+1)}>Next</Button></div>}
 </div>;
}
function isDark(hex:string){const v=parseInt(hex.slice(1),16),c=[v>>16,(v>>8)&255,v&255].map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2]<.3;}

function DataTable({units,showYear,showGroup,label,noun}:{units:Unit[];showYear:boolean;showGroup:boolean;label:string;noun:string}){
 const rows=[...units].sort((a,b)=>showYear?(a.year!-b.year!):showGroup?a.group!.localeCompare(b.group!):a.name.localeCompare(b.name));
 return <div className="chart-table"><table><caption className="sr-only">Data behind the chart</caption><thead><tr><th scope="col">{noun==='texts'?'Text':'Subject'}</th>{showYear&&<th scope="col">Year</th>}{showGroup&&<th scope="col">Group</th>}<th scope="col">{label}</th></tr></thead>
  <tbody>{rows.slice(0,500).map(u=><tr key={u.key}><td>{u.name}</td>{showYear&&<td>{u.year}</td>}{showGroup&&<td>{u.group}</td>}<td>{u.value}{u.values.length>1?<small> ({u.values.join(', ')})</small>:null}</td></tr>)}</tbody></table>
  {rows.length>500&&<p className="chart-note">The first 500 rows are shown. Use Download Excel for all results.</p>}</div>;
}

function autoCaption({field,units,kind,scale,view,trend,rows,noun,period,groups}:{field:Field;units:Unit[];kind:string;scale?:Scale;view:Tab;trend:boolean;rows:ChartSourceRow[];noun:string;period:number;groups:string[]}){
 const models=Array.from(new Set(rows.map(r=>r.model).filter(Boolean))) as string[];
 const efforts=Array.from(new Set(rows.map(r=>r.effort).filter(Boolean))) as string[];
 const days=rows.map(r=>(r.time||r.startedAt||'').slice(0,10)).filter(Boolean).sort();
 const parts:string[]=[];
 const count=view==='time'?units.filter(u=>u.year!==undefined).length:view==='groups'?units.filter(u=>u.group!==undefined).length:units.length;
 parts.push(`${field.label} for ${count} ${noun}${view==='time'?', by year':view==='groups'?` in ${groups.length} groups (${groups.join(', ')})`:''}.`);
 if(scale)parts.push(`Scale ${scaleLabel(scale,scale.min)}${scale.lowLabel?` (${scale.lowLabel})`:''} to ${scaleLabel(scale,scale.max)}${scale.highLabel?` (${scale.highLabel})`:''}.`);
 if(models.length)parts.push(`Annotated by ${models.join(', ')}${efforts.length===1?` (${efforts[0]} reasoning effort)`:''}${days.length?`, ${days[0]===days[days.length-1]?days[0]:`${days[0]} to ${days[days.length-1]}`}`:''}.`);
 if(view==='time'&&trend)parts.push('Line: smoothed average.');
 if(view==='time'&&period)parts.push(`Periods of ${period} years.`);
 if(view==='groups'&&kind==='scale')parts.push('Dots: group averages with 95% ranges.');
 if(units.some(u=>u.values.length>1))parts.push('Repeated runs or chunks combined per text.');
 return parts.join(' ');
}

function FigureExport({figure,caption,legend,defaultTitle,onBack}:{figure:Figure;caption:string;legend:{label:string;color:string}[];defaultTitle:string;onBack:()=>void}){
 const [title,setTitle]=useState(defaultTitle),[text,setText]=useState(caption),[format,setFormat]=useState<'png'|'svg'>('png'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const id=useId();
 const full=useMemo(()=>exportFigure({...figure,svg:figure.svg.replace(/ data-pick="\d+" role="button" tabindex="0" aria-label="[^"]*"/g,'').replace(/<rect class="pick-hit"[^>]*\/>/g,'').replace(/<title>[^<]*<\/title>/g,'')},title.trim(),text,legend),[figure,title,text,legend]);
 async function download(){if(busy)return;setBusy(true);setError('');try{if(format==='svg')downloadSvg(full,title);else await downloadPng(full,title);}catch(e){setError(e instanceof Error?e.message:'Could not download the figure. Please try again.');}finally{setBusy(false);}}
 return <div className="chart-export">
  <label htmlFor={id+'t'}>Figure title</label><input id={id+'t'} value={title} maxLength={140} onChange={e=>setTitle(e.target.value)} placeholder="Say what the figure shows"/>
  <p className="hint">A good title states what the reader should see, for example “Inaugural addresses became plainer after 1930.”</p>
  <label htmlFor={id+'c'}>Caption</label><textarea id={id+'c'} value={text} maxLength={800} rows={3} onChange={e=>setText(e.target.value)}/>
  <div className="chart-export-caption"><button type="button" className="chart-link" onClick={()=>{navigator.clipboard?.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{});}}>{copied?'Caption copied':'Copy caption'}</button></div>
  <div className="chart-export-preview"><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(full.svg)} alt={`Preview: ${title}`} width={full.width} height={full.height}/></div>
  {error&&<p role="alert" className="figure-error">{error}</p>}
  <div className="chart-foot"><Button variant="outline" onClick={onBack} disabled={busy}>Back to chart</Button><div className="chart-download"><label htmlFor={id+'f'} className="sr-only">File format</label><select id={id+'f'} value={format} disabled={busy} onChange={e=>setFormat(e.target.value as 'png'|'svg')}><option value="png">PNG</option><option value="svg">SVG</option></select><Button className="chart-primary" onClick={download} disabled={busy}>{busy?'Preparing image…':`Download ${format.toUpperCase()}`}</Button></div></div>
 </div>;
}

export {ChartBody};
export default function ResultsChartDialog({rows,open,onOpenChange,onInspect,onSaveYears,onSaveGroups,subjectLabel='Document'}:ResultsChartDialogProps){
 const pending=useRef<string|null>(null),heading=useRef<HTMLHeadingElement>(null);
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="results-chart-dialog" onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus();}} onCloseAutoFocus={event=>{if(pending.current){event.preventDefault();const id=pending.current;pending.current=null;requestAnimationFrame(()=>onInspect(id));}}}>
  <DialogTitle ref={heading} tabIndex={-1}>Results chart</DialogTitle><DialogDescription className="sr-only">Explore completed annotations as charts and open the results behind them.</DialogDescription>
  <ChartBody rows={rows} onSaveYears={onSaveYears} onSaveGroups={onSaveGroups} subjectLabel={subjectLabel} onInspect={id=>{pending.current=id;onOpenChange(false);}}/>
 </DialogContent></Dialog>;
}
