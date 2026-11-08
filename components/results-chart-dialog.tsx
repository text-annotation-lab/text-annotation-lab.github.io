'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {chartFields,chartData,validChartYear,numericChartLayout,type ChartPoint,type ChartCategory,type ChartRow,type ChartScale} from '@/lib/results-chart';
import type {ResultsChartDialogProps} from './results-chart';
import {ResultsFigure} from './results-figure';
import {ChartYearReview} from './chart-year-review';
import {resultsFigureSvg,figureStyles,rankedPageSize,rankedDistribution,defaultFigureStyle,type RankedOptions,type FigureStyle,type FigureData} from '@/lib/results-figure';
import './results-chart.css';

const numberLabel=(value:number)=>Math.abs(value)>=1e6||(value!==0&&Math.abs(value)<.001)?value.toExponential(2):new Intl.NumberFormat('en-US',{maximumSignificantDigits:5}).format(value);
const excerpt=(value:string)=>value.length>180?value.slice(0,177)+'…':value;

function NumericChart({points,total,label,subjectLabel,onInspect,scale}:{points:ChartPoint[];total:number;label:string;subjectLabel:string;onInspect:(id:string)=>void;scale?:ChartScale}){
 const container=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null);
 const [width,setWidth]=useState(680),[hovered,setHovered]=useState<number|null>(null),[focused,setFocused]=useState(0),[selected,setSelected]=useState<number|null>(null);
 const instructions=useId();
 useEffect(()=>{const element=container.current;if(!element)return;const resize=()=>setWidth(Math.max(280,element.clientWidth));resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const element=container.current;if(!element)return;
  const document=element.ownerDocument;
  const dismiss=(event:PointerEvent)=>{
   const target=event.target;
   if(!(target instanceof Element)||!element.closest('[role="dialog"]')?.contains(target))return;
   if(element.contains(target)&&target.closest('.chart-dot,.chart-details'))return;
   // Return focus before removing a detail card that contains the active button.
   if(element.contains(document.activeElement))svg.current?.focus({preventScroll:true});
   setSelected(null);setHovered(null);
  };
  document.addEventListener('pointerdown',dismiss);
  return()=>document.removeEventListener('pointerdown',dismiss);
 },[]);
 const layout=useMemo(()=>numericChartLayout(points,total,width,scale),[points,total,width,scale]);
 const activeIndex=hovered??selected,active=activeIndex===null?undefined:points[activeIndex],pinned=activeIndex!==null&&activeIndex===selected;
 const cardWidth=Math.min(pinned?440:260,width-16);
 return <div className="results-chart-plot" ref={container}>
  <p id={instructions} className="sr-only">Use Left and Right Arrow to explore points, or Home and End to jump to the first and last. Press Enter to keep a point's details open in the chart.</p>
  <svg ref={svg} tabIndex={-1} viewBox={`0 0 ${width} 332`} width="100%" height="332" role="group" aria-label={`${label} by ${subjectLabel.toLowerCase()} order`} aria-describedby={instructions}>
   {layout.ticks.map((tick,index)=><g key={index} aria-hidden="true"><line x1={layout.left} x2={layout.right} y1={tick.y} y2={tick.y} className={tick.value===0?'chart-grid chart-zero':'chart-grid'}/><text x={layout.left-12} y={tick.y+4} textAnchor="end">{numberLabel(tick.value)}</text></g>)}
   <line x1={layout.left} x2={layout.right} y1={layout.bottom+16} y2={layout.bottom+16} className="chart-axis" aria-hidden="true"/>
   {layout.xTicks.map(order=><g key={order} aria-hidden="true"><line x1={layout.x(order)} x2={layout.x(order)} y1={layout.bottom+16} y2={layout.bottom+20} className="chart-axis"/><text x={layout.x(order)} y={302} textAnchor="middle">{order}</text></g>)}
   <text x={(layout.left+layout.right)/2} y={326} textAnchor="middle" aria-hidden="true">{subjectLabel} order</text>
   {points.map((point,index)=><circle key={point.id} data-point-index={index} cx={layout.x(point.order)} cy={layout.y(point.number!)} r={activeIndex===index?7:5} className="chart-dot" role="button" tabIndex={focused===index?0:-1} aria-pressed={selected===index} aria-label={`${point.name}: ${point.value}. Show details.`} onMouseEnter={()=>setHovered(index)} onMouseLeave={()=>setHovered(null)} onFocus={()=>{setFocused(index);setHovered(index);}} onBlur={()=>setHovered(null)} onClick={()=>setSelected(index)} onKeyDown={event=>{
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(index);return;}
    const next=event.key==='Home'?0:event.key==='End'?points.length-1:event.key==='ArrowRight'||event.key==='ArrowDown'?Math.min(points.length-1,index+1):event.key==='ArrowLeft'||event.key==='ArrowUp'?Math.max(0,index-1):undefined;
    if(next!==undefined){event.preventDefault();setFocused(next);svg.current?.querySelector<SVGCircleElement>(`[data-point-index="${next}"]`)?.focus();}
   }}/>) }
  </svg>
  {active&&<div className={`chart-tooltip${pinned?' chart-details':''}`} role={pinned?'region':'tooltip'} aria-label={pinned?'Selected point details':undefined} style={{width:cardWidth,left:Math.min(Math.max(8,layout.x(active.order)-cardWidth/2),Math.max(8,width-cardWidth-8)),top:pinned?8:layout.y(active.number!)>135?16:164}}><strong>{active.name}</strong><span>{label}: {active.value}</span>{active.explanation&&<p>{pinned?active.explanation:excerpt(active.explanation)}</p>}{pinned&&<div className="chart-detail-actions"><button type="button" onClick={()=>onInspect(active.id)}>{subjectLabel==='Document'?'Open text':'Open result'}</button><button type="button" aria-label="Dismiss point details" onClick={()=>{setSelected(null);setHovered(null);svg.current?.focus();}}>Dismiss</button></div>}</div>}
 </div>;
}

function PageControls({page,pages,onChange,label,showPageNumber=true}:{page:number;pages:number;onChange:(page:number)=>void;label:string;showPageNumber?:boolean}){
 return pages>1?<div className="chart-pages" aria-label={label}><Button variant="outline" disabled={page===0} onClick={()=>onChange(page-1)}>Previous</Button>{showPageNumber&&<span>{page+1} / {pages}</span>}<Button variant="outline" disabled={page===pages-1} onClick={()=>onChange(page+1)}>Next</Button></div>:null;
}

function CategoryChart({categories,total,onInspect}:{categories:ChartCategory[];total:number;onInspect:(id:string)=>void}){
 const [selected,setSelected]=useState<string|null>(null),[page,setPage]=useState(0),[resultPage,setResultPage]=useState(0);
 const largest=categories[0]?.points.length||1,pages=Math.ceil(categories.length/20),safePage=Math.min(page,pages-1);
 const id=useId();
 return <div className="category-chart">
  {categories.slice(safePage*20,safePage*20+20).map((category,index)=>{
   const expanded=selected===category.value,panelId=id+'-'+index,matchPages=Math.ceil(category.points.length/10),matchPage=Math.min(resultPage,matchPages-1);
   return <div key={category.value} className="category-chart-group">
    <button type="button" className="category-chart-bar" aria-expanded={expanded} aria-controls={expanded?panelId:undefined} aria-label={`${category.value}: ${category.points.length} of ${total} results. Show matching results.`} onClick={()=>{setSelected(expanded?null:category.value);setResultPage(0);}} title={category.value}>
     <span className="category-chart-label">{category.value}</span><span className="category-chart-track" aria-hidden="true"><span style={{width:100*category.points.length/largest+'%'}}/></span><span className="category-chart-count">{category.points.length}<small>{Math.round(100*category.points.length/total)}%</small></span>
    </button>
    {expanded&&<div id={panelId} className="category-chart-matches" role="region" aria-label={category.value+' results'}>
     {category.points.slice(matchPage*10,matchPage*10+10).map(point=><button type="button" className="chart-result-link" key={point.id} onClick={()=>onInspect(point.id)}><strong>{point.name}</strong>{point.explanation&&<span>{excerpt(point.explanation)}</span>}<span className="chart-open-label">Open result →</span></button>)}
     <PageControls page={matchPage} pages={matchPages} onChange={setResultPage} label="Matching results pages"/>
    </div>}
   </div>;
  })}
  <PageControls page={safePage} pages={pages} onChange={value=>{setPage(value);setSelected(null);}} label="Category pages"/>
 </div>;
}

function DistributionChart({data,label,style,ranked,onRankedChange,onInspect}:{data:FigureData;label:string;style:FigureStyle;ranked:RankedOptions;onRankedChange:(options:RankedOptions)=>void;onInspect:(id:string)=>void}){
 const container=useRef<HTMLDivElement>(null),plot=useRef<HTMLDivElement>(null);
 const [selected,setSelected]=useState<number|null>(null),[page,setPage]=useState(0),[width,setWidth]=useState(800);
 const matches=useMemo(()=>style==='ranked'?rankedDistribution(data,ranked.query,ranked.order).bars.length:0,[data,style,ranked.query,ranked.order]);
 const rankedPages=Math.ceil(matches/rankedPageSize),rankedPage=Math.min(ranked.page,Math.max(0,rankedPages-1));
 useEffect(()=>{setSelected(null);setPage(0);},[ranked.query,ranked.order,ranked.page]);
 useEffect(()=>{const element=container.current;if(!element||(style!=='ranked'&&style!=='year'))return;const resize=()=>setWidth(element.clientWidth);resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();},[style]);
 const preview=useMemo(()=>{try{return {figure:resultsFigureSvg(data,label,`${label} results`,style,{compact:true,interactive:true,rankedPage,rankedQuery:ranked.query,rankedOrder:ranked.order,overviewWidth:width}),error:''};}catch(error){return {figure:null,error:error instanceof Error?error.message:'Could not prepare this chart.'};}},[data,label,style,rankedPage,ranked.query,ranked.order,width]);
 const markup=useMemo(()=>({__html:preview.figure?.svg||''}),[preview]);
 useEffect(()=>{plot.current?.querySelectorAll('[data-figure-bin]').forEach(mark=>mark.setAttribute('aria-pressed',String(Number(mark.getAttribute('data-figure-bin'))===selected)));},[selected,preview]);
 useEffect(()=>{
  const element=container.current;if(!element)return;
  const dismiss=(event:PointerEvent)=>{const target=event.target;if(!(target instanceof Element)||!element.closest('[role="dialog"]')?.contains(target)||target.closest('[data-figure-bin],.distribution-matches'))return;if(element.contains(element.ownerDocument.activeElement))plot.current?.focus({preventScroll:true});setSelected(null);};
  element.ownerDocument.addEventListener('pointerdown',dismiss);return()=>element.ownerDocument.removeEventListener('pointerdown',dismiss);
 },[]);
 const bar=selected===null?undefined:preview.figure?.distribution.bars[selected],pages=Math.ceil((bar?.count||0)/10),safePage=Math.min(page,Math.max(0,pages-1));
 function select(target:EventTarget|null){if(!(target instanceof Element))return;const mark=target.closest('[data-figure-bin]');if(!mark)return;const index=Number(mark.getAttribute('data-figure-bin'));setSelected(value=>value===index?null:index);setPage(0);}
 return <div className={`distribution-chart${style==='ranked'?' ranked-chart':''}`} ref={container}>
  {style==='ranked'&&<>
   <div className="ranked-controls"><input type="search" aria-label="Find a result by name" placeholder="Find a text or subject…" maxLength={140} value={ranked.query} onChange={event=>onRankedChange({...ranked,query:event.target.value,page:0})}/><select aria-label="Score order" value={ranked.order} onChange={event=>onRankedChange({...ranked,order:event.target.value as RankedOptions['order'],page:0})}><option value="lowest">Lowest first</option><option value="highest">Highest first</option></select></div>
   <div className="ranked-navigation"><span role="status">{matches?`${rankedPage*rankedPageSize+1}–${Math.min(matches,(rankedPage+1)*rankedPageSize)} of ${matches.toLocaleString('en-US')}${ranked.query.trim()?' matches':' results'}`:'No matching results'}</span><PageControls page={rankedPage} pages={rankedPages} onChange={next=>onRankedChange({...ranked,page:next})} label="Ranked results pages" showPageNumber={false}/></div>
  </>}
  {preview.figure&&<div className="overview-svg" ref={plot} tabIndex={-1} onClick={event=>select(event.target)} onKeyDown={event=>{if((event.key==='Enter'||event.key===' ')&&(event.target as Element).closest('[data-figure-bin]')){event.preventDefault();select(event.target);}else if(event.key==='Escape'&&selected!==null){event.preventDefault();event.stopPropagation();setSelected(null);plot.current?.focus({preventScroll:true});}}} dangerouslySetInnerHTML={markup}/>}
  {preview.error&&(style==='ranked'&&!matches?<p className="chart-empty">Try another name or clear the search.</p>:<p className="figure-error" role="alert">{preview.error}</p>)}
  {bar&&<div className="distribution-matches category-chart-matches" role="region" aria-label={`${bar.label} results`}>
   <div className="distribution-matches-heading"><strong>{style==='ranked'?`${label}: ${bar.points[0].value}`:`${bar.label} · ${bar.count} ${bar.count===1?'result':'results'}`}</strong><button type="button" onClick={()=>{setSelected(null);plot.current?.focus({preventScroll:true});}}>Dismiss</button></div>
   {bar.points.slice(safePage*10,safePage*10+10).map(point=><div className="distribution-result" key={point.id}><strong>{point.name}</strong>{point.explanation&&<p>{point.explanation}</p>}<button type="button" onClick={()=>onInspect(point.id)}>Open result →</button></div>)}
   <PageControls page={safePage} pages={pages} onChange={setPage} label="Matching results pages"/>
  </div>}
  {preview.figure&&<p className="chart-instruction chart-footer">{style==='year'?'Select a dot to explore its texts. Larger dots contain more than one text.':style==='ranked'?'Select a dot to see its explanation':`Select a ${style==='stacked'?'segment':'bar'} to see its results`}</p>}
 </div>;
}

function ChartBody({rows,subjectLabel,onInspect,chosen,onChoose,onSaveYears}:{rows:ChartRow[];onSaveYears?:ResultsChartDialogProps['onSaveYears'];subjectLabel:string;onInspect:(id:string)=>void;chosen:string;onChoose:(key:string)=>void}){
 const [exporting,setExporting]=useState(false),[chosenStyles,setChosenStyles]=useState<Record<string,FigureStyle>>({});
 const [ranked,setRanked]=useState<RankedOptions>({query:'',order:'lowest',page:0});
 const fields=useMemo(()=>chartFields(rows),[rows]);
 const field=fields.find(item=>item.key===chosen)||fields[0],selectId=useId();
 const [reviewing,setReviewing]=useState(false);
 const allData=useMemo(()=>field?chartData(rows,field):null,[rows,field]);
 const reviewRows=useMemo(()=>{
  if(!reviewing||!allData) return [];
  const ids=new Set(allData.points.map(point=>point.id));
  return rows.filter(row=>ids.has(row.id));
 },[reviewing,allData,rows]);
 const styles=allData?figureStyles(allData):[];
 if(allData?.numeric && onSaveYears) styles.push({value:'year',label:'Plot by year'});
 const styleId=useId();
 const preferred=chosenStyles[field?.key]||(allData?defaultFigureStyle(allData):'distribution');
 const style=styles.some(option=>option.value===preferred)?preferred:'distribution';
 const data=useMemo(()=>{
  if(style!=='year'||!field) return allData;
  const dated=chartData(rows.filter(row=>validChartYear(row.chartYear)),field);
  return {...dated,excluded:rows.length-dated.points.length};
 },[style,field,allData,rows]);
 const label=field?.name===undefined?(allData?.numeric?'Score':'Category'):field.label;
 function chooseStyle(next:FigureStyle){
  if(next==='year'){setReviewing(true);return;}
  setReviewing(false);
  setChosenStyles(current=>({...current,[field.key]:next}));
 }
 return <>
  <div className="chart-toolbar">{fields.length>1?<div className="chart-field"><label htmlFor={selectId}>Answer field</label><select id={selectId} value={field.key} onChange={event=>{setReviewing(false);onChoose(event.target.value);}}>{fields.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></div>:<strong className="chart-field-title">{field?label:'Results'}</strong>}<span className="chart-count" title="Unfinished results, missing answers, and insufficient knowledge are not plotted.">{data?.points.length||0} results{data?.mean!==undefined&&` · Mean: ${Math.abs(data.mean)>=1e6||(data.mean!==0&&Math.abs(data.mean)<.001)?numberLabel(data.mean):new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(data.mean)}`}{Boolean(data?.excluded)&&` · ${data!.excluded} not plotted`}</span></div>
  {!!allData?.points.length&&styles.length>1&&<div className="figure-style"><label htmlFor={styleId}>Chart style</label><select id={styleId} value={reviewing?'year':style} onChange={event=>chooseStyle(event.target.value as FigureStyle)}>{styles.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>{style==='year'&&!reviewing&&<button className="textbutton" onClick={()=>setReviewing(true)}>Review years</button>}</div>}
  {reviewing&&onSaveYears?<ChartYearReview rows={reviewRows} onCancel={()=>setReviewing(false)} onApply={years=>{
   onSaveYears(years);setChosenStyles(current=>({...current,[field.key]:'year'}));setReviewing(false);
  }}/>:!data?.points.length?<p className="chart-empty">No completed values to chart{field?' for this field':''}.</p>:exporting?<ResultsFigure key={field.key} data={data} label={label} style={style} ranked={ranked} onBack={()=>setExporting(false)}/>:<>{data.numeric&&style==='points'?<><NumericChart key={field.key} points={data.points} total={rows.length} label={label} subjectLabel={subjectLabel} onInspect={onInspect} scale={data.scale}/><p className="chart-instruction chart-footer">Hover to preview · Click to keep details open</p></>:!data.numeric&&data.categories.length>40?<><p className="chart-instruction">Click a bar to see its results.</p><CategoryChart key={field.key} categories={data.categories} total={data.points.length} onInspect={onInspect}/></>:<DistributionChart key={`${field.key}-${style}`} data={data} label={label} style={style} ranked={ranked} onRankedChange={setRanked} onInspect={onInspect}/>}<div className="chart-export-action"><Button variant="outline" onClick={()=>setExporting(true)}>Download figure</Button></div></>}
 </>;
}

export default function ResultsChartDialog({rows,open,onOpenChange,onInspect,onSaveYears,subjectLabel='Document'}:ResultsChartDialogProps){
 const pending=useRef<string|null>(null),heading=useRef<HTMLHeadingElement>(null),[chosen,setChosen]=useState('');
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="results-chart-dialog" onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus();}} onCloseAutoFocus={event=>{if(pending.current){event.preventDefault();const id=pending.current;pending.current=null;requestAnimationFrame(()=>onInspect(id));}}}><DialogTitle ref={heading} tabIndex={-1}>Results chart</DialogTitle><DialogDescription className="sr-only">Explore completed annotations and open their original results.</DialogDescription><ChartBody rows={rows} onSaveYears={onSaveYears} subjectLabel={subjectLabel} chosen={chosen} onChoose={setChosen} onInspect={id=>{pending.current=id;onOpenChange(false);}}/></DialogContent></Dialog>;
}
