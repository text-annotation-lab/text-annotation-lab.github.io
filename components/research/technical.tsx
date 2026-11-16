'use client';
// Research mode: the technical details of one request in the details of a text, and, on demand, the request and
// the response as the logs of an export show them.
import {useState} from 'react';
import {extractText} from '@/lib/extract-text';
import {documentReader,replyOf,requestOf,requestRecord,responseRecord,tokensOf,type ExportStudy} from '@/lib/research/export-data';
import type {RecordedRequest} from '@/lib/research/requests';
import type {Row} from '@/lib/research/runs';

// What the details need of the study: which kind of data it is, the requests it kept, and the prompt version of
// each run.
export type DetailStudy={kind:'texts'|'knowledge';requests?:RecordedRequest[];versions?:Map<number,number>};
const count=(value:number|'')=>value===''?'—':value.toLocaleString('en-US');
// A long request or reply is shown up to this many characters.
const SHOWN=200000;
const shown=(text:string)=>text.length>SHOWN?text.slice(0,SHOWN)+`\n\n[${(text.length-SHOWN).toLocaleString('en-US')} more characters are not shown here. The logs of an export hold them all.]`:text;

// row: the text or subject. of: one request's result (a text's own result, one of its annotations, or an earlier
// one). run: the number of the run the request belongs to. label: which annotation it is, where there are several.
export function Technical({row,of,run,study,label}:{row:Row;of:{[key:string]:any};run?:number;study:DetailStudy;label?:string}){
 const result=of as Row;
 const [full,setFull]=useState<{request:string;response:string}|'reading'|'failed'|null>(null);
 if(!result.provider&&!result.model)return null;
 const tokens=tokensOf(result),reply=replyOf(result),version=run===undefined?undefined:study.versions?.get(run);
 const reasoning=typeof tokens.reasoning==='number'&&tokens.reasoning>0?` (incl. ${count(tokens.reasoning)} reasoning)`:'';
 async function show(){
  setFull('reading');
  try{
   const dataset={kind:study.kind,rows:[],runs:[],columns:[],samples:[]},whole:ExportStudy={name:'',dataset,requests:study.requests,lab:''};
   const doc=await documentReader(dataset,extractText)(row,result);
   const pdf=doc&&'pdf' in doc?`[PDF file: ${doc.filename}, ${doc.pdf.size.toLocaleString('en-US')} bytes; sent as a file, and not shown here]`:'';
   setFull({request:JSON.stringify(requestRecord(requestOf(whole,row,result),doc,result,pdf),null,2),response:JSON.stringify(responseRecord(result),null,2)});
  }catch{setFull('failed');}
 }
 return <details className="research-technical">
  <summary>Technical details{label?' · '+label:''}</summary>
  <dl>
   <div><dt>Model (requested)</dt><dd>{String(result.model||'—')}</dd></div>
   <div><dt>Model (reported)</dt><dd>{String(result.modelReported||'not recorded')}</dd></div>
   <div><dt>Stop reason</dt><dd>{String(result.stopReason||'not recorded')}</dd></div>
   <div><dt>Tokens in / out</dt><dd>{count(tokens.input)} / {count(tokens.output)}{reasoning}</dd></div>
   <div><dt>Cache read / write</dt><dd>{count(tokens.cacheRead)} / {count(tokens.cacheWrite)}</dd></div>
   <div><dt>Response ID</dt><dd>{String(result.responseId||'—')}</dd></div>
   {result.batchId&&<div><dt>Batch ID</dt><dd>{String(result.batchId)}</dd></div>}
   <div><dt>Run</dt><dd>{[run===undefined?'':'#'+run,result.processing==='batch'?'batch':'instant',version?'prompt v'+version:''].filter(Boolean).join(' · ')}</dd></div>
  </dl>
  {reply!==undefined&&<details className="research-technical-part"><summary>Raw model output</summary><pre className="research-preview-text research-preview-code" tabIndex={0}>{shown(reply)}</pre></details>}
  {full===null||full==='reading'?<button type="button" className="textbutton" disabled={full==='reading'} onClick={()=>void show()}>{full==='reading'?'Reading the request…':'Show full request and response'}</button>
   :full==='failed'?<p className="hint" role="alert">The request could not be shown. Check that the text opens correctly.</p>
   :<div className="research-technical-full">
    <p className="hint">As in the logs of an export. The Lab keeps a lean record of a response: the reply, the model and the stop reason the provider named, the token counts, and the IDs. <button type="button" className="textbutton" onClick={()=>setFull(null)}>Hide</button></p>
    <h4>Request</h4><pre className="research-preview-text research-preview-code" tabIndex={0}>{shown(full.request)}</pre>
    <h4>Response</h4><pre className="research-preview-text research-preview-code" tabIndex={0}>{shown(full.response)}</pre>
   </div>}
 </details>;
}
