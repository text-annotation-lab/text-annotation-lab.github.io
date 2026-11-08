"use client";
import {useEffect,useState} from 'react';
import {sourcePreview} from '@/lib/source-preview';
export function SourceTextPreview({file,chunk=false}:{file:File;chunk?:boolean}){
 const [opened,setOpened]=useState(false),[result,setResult]=useState<{text:string;truncated:boolean}|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!opened)return;setResult(null);setError('');let active=true;sourcePreview(file).then(value=>{if(active)setResult(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not preview this file. Open the original document to check the source.');});return()=>{active=false;};},[opened,file]);
 return <details className="chunk-preview source-preview" onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary>{chunk?'View source text (this chunk)':'View source text'}</summary><p className="hint">{chunk?'This is the text of the selected chunk.':'Extracted from your uploaded document in this browser.'} {/\.pdf$/i.test(file.name)?'PDF layout, images, and tables may not be represented here. ':''}Opening this preview makes no API call.</p>{error?<p role="status">{error}</p>:result?<><pre tabIndex={0} aria-label="Source text">{result.text||'This file contains no readable text.'}</pre>{result.truncated&&<p className="hint">Showing the first 200,000 characters. Open the original file to check the rest; the annotation input is unchanged.</p>}</>:<p role="status">Reading source text…</p>}</details>;
}
