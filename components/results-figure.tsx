'use client';
import {useId,useMemo,useRef,useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {resultsFigureSvg,downloadFigurePng,downloadFigureSvg,rankedDistribution,rankedPageSize,type RankedOptions,type FigureStyle,type FigureData} from '@/lib/results-figure';

export function ResultsFigure({data,label,style,ranked,onBack}:{data:FigureData;label:string;style:FigureStyle;ranked:RankedOptions;onBack:()=>void}){
 const [title,setTitle]=useState(`${label} results`),[format,setFormat]=useState<'png'|'svg'>('png'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const matches=useMemo(()=>style==='ranked'?rankedDistribution(data,ranked.query,ranked.order).bars.length:0,[data,style,ranked.query,ranked.order]);
 const [scope,setScope]=useState<'all'|'page'>(matches>100?'page':'all');
 const selectedScope=matches>100?'page':scope;
 const titleId=useId(),formatId=useId(),scopeId=useId(),input=useRef<HTMLInputElement>(null);
 useEffect(()=>{input.current?.focus();},[]);
 const preview=useMemo(()=>{try{return {figure:resultsFigureSvg(data,label,title,style,{rankedPage:ranked.page,rankedOrder:ranked.order,rankedQuery:ranked.query,rankedScope:selectedScope}),error:''};}catch(error){return {figure:null,error:error instanceof Error?error.message:'Could not prepare this figure.'};}},[data,label,title,style,ranked,selectedScope]);
 async function download(){
  if(!preview.figure||busy)return;setBusy(true);setError('');
  try{if(format==='svg')downloadFigureSvg(preview.figure,title);else await downloadFigurePng(preview.figure,title);}catch(error){setError(error instanceof Error?error.message:'Could not download the figure. Please try again.');}finally{setBusy(false);}
 }
 return <div className="figure-export">
  <label htmlFor={titleId}>Figure title</label>
  <input ref={input} id={titleId} value={title} maxLength={140} onChange={event=>setTitle(event.target.value)} disabled={busy}/>
  {style==='ranked'&&matches>rankedPageSize&&<div className="figure-style"><label htmlFor={scopeId}>Include</label><select id={scopeId} value={selectedScope} disabled={busy} onChange={event=>setScope(event.target.value as 'all'|'page')}><option value="all" disabled={matches>100}>All {matches.toLocaleString('en-US')} {ranked.query.trim()?'matching ':''}results</option><option value="page">Current page</option></select></div>}
  {style==='ranked'&&matches>100&&<p className="chart-instruction">This figure includes the current page. Score distribution shows the whole study in one figure.</p>}
  {preview.figure&&<div className="figure-preview"><img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(preview.figure.svg)} alt={`Preview: ${title.trim()||label+' distribution'}`} width={preview.figure.width} height={preview.figure.height}/></div>}
  {(preview.error||error)&&<p role="alert" className="figure-error">{preview.error||error}</p>}
  <div className="figure-export-actions"><Button variant="outline" onClick={onBack} disabled={busy}>Back to chart</Button><div className="figure-download"><label htmlFor={formatId} className="sr-only">File format</label><select id={formatId} value={format} disabled={busy} onChange={event=>setFormat(event.target.value as 'png'|'svg')}><option value="png">PNG</option><option value="svg">SVG</option></select><Button onClick={download} disabled={!preview.figure||busy}>{busy?'Preparing image…':`Download ${format.toUpperCase()}`}</Button></div></div>
 </div>;
}
