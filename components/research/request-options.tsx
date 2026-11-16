'use client';
// Research mode: the request settings in Processing options, and "Preview request".
import {useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {PROVIDERS,type Provider} from '@/lib/providers';
import {MAX_OUTPUT_TOKENS,budgetedClaude,cleanRequestSettings,defaultOutputLimit,outputFloor,plainOpenAI,sentRequestSettings,summarizesReasoning,takesTemperature,temperatureCeiling,type RequestSettings} from '@/lib/request-settings';
import {PREVIEW_PLACEHOLDER,previewRequest,type RequestView} from '@/lib/research/request-view';
import type {FrameSettings} from '@/lib/request-frame';
import {CacheOption} from './cache-option';

const count=(n:number)=>n.toLocaleString('en-US');
// A number typed into a box takes effect once it is a number the setting allows; an emptied box clears the
// setting. Leaving the box shows what is in effect.
function NumberBox({id,value,placeholder,min,max,step,disabled,describedBy,onCommit}:{id:string;value?:number;placeholder:string;min:number;max:number;step:number;disabled?:boolean;describedBy:string;onCommit:(value:number|undefined)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 return <input id={id} className="research-number" type="number" inputMode="decimal" min={min} max={max} step={step} placeholder={placeholder} disabled={disabled} aria-describedby={describedBy} value={draft??(value===undefined?'':String(value))}
  onChange={event=>{const text=event.target.value,n=Number(text);setDraft(text);if(!text.trim())onCommit(undefined);else if(Number.isFinite(n)&&n>=min&&n<=max&&(step<1||Number.isInteger(n)))onCommit(n);}} onBlur={()=>setDraft(null)}/>;
}

// Prompt caching, temperature, output limit, reasoning summary, and (OpenAI) the provider's logs. Every box
// shows what a request to the selected model carries; a choice that does not apply to this model is kept for
// other models. `prompt` is the prompt as a request sends it.
export function RequestOptions({provider,model,effort,prompt,value,disabled,onChange}:{provider:Provider;model:string;effort:string;prompt:string;value?:RequestSettings;disabled?:boolean;onChange:(value:RequestSettings|undefined)=>void}){
 const sent=sentRequestSettings(provider,model,value,effort),set=(changes:Partial<RequestSettings>)=>onChange(cleanRequestSettings({...value,...changes}));
 const takes=takesTemperature(provider,model,effort),ceiling=temperatureCeiling(provider),usual=defaultOutputLimit(provider,model),floor=outputFloor(provider,model,effort),reasons=summarizesReasoning(effort,provider,model);
 return <>
  <CacheOption provider={provider} model={model} prompt={prompt} value={value} disabled={disabled} onChange={next=>set({cache:next?.cache})}/>
  <div className="processing-choice"><label htmlFor="request-temperature">Temperature</label><NumberBox id="request-temperature" value={takes?sent?.temperature:undefined} placeholder={takes?'Model default':'Not sent'} min={0} max={ceiling} step={0.1} disabled={disabled||!takes} describedBy="request-temperature-help" onCommit={temperature=>set({temperature})}/></div>
  <p id="request-temperature-help" className="hint batch-explainer">{takes?`Empty: no temperature is sent and the model uses its own. From 0 to ${ceiling}. Many reasoning models accept only their default and reject a request with another value.`:provider==='openrouter'?'Claude models that reason take no temperature, so none is sent.':`Claude models that reason take no temperature, so none is sent. ${budgetedClaude(model)&&!model.startsWith('claude-haiku-4-5')?'This model':'Claude Haiku 4.5'} takes one with reasoning off.`}</p>
  <div className="processing-choice"><label htmlFor="request-max-output">Max output tokens</label><NumberBox id="request-max-output" value={sent?.maxOutput??usual} placeholder={String(usual)} min={floor} max={MAX_OUTPUT_TOKENS} step={1} disabled={disabled} describedBy="request-max-output-help" onCommit={maxOutput=>set({maxOutput})}/></div>
  <p id="request-max-output-help" className="hint batch-explainer">The most tokens a reply may use, reasoning included; a reply that reaches the limit counts as failed. The Lab’s own limit for this model is {count(usual)}.{floor>16?` This reasoning setting needs at least ${count(floor)}.`:''}</p>
  <label className="research-check research-output-check research-request-option"><input type="checkbox" checked={reasons&&Boolean(value?.summary)} disabled={disabled||!reasons} onChange={event=>set({summary:event.target.checked?true:undefined})}/><span>Record the model’s reasoning summary<small>{reasons?'A readable summary of the model’s reasoning, kept with each result and in the exports. Some models return none.':provider==='openai'&&plainOpenAI(model)?'This model has no reasoning to summarize.':'Reasoning is switched off for this model, so there is nothing to summarize.'}</small></span></label>
  {provider==='openai'&&<label className="research-check research-output-check research-request-option"><input type="checkbox" checked={value?.store!==false} disabled={disabled} onChange={event=>set({store:event.target.checked?undefined:false})}/><span>Show requests in OpenAI’s logs<small>Lets you inspect them on platform.openai.com. OpenAI keeps stored requests for a limited time; switch this off for confidential texts.</small></span></label>}
 </>;
}

// "Preview request": the request a run would send for the first text, built by the code that sends it.
// settings: what the run would be made with. document: the first text (absent: a placeholder stands in).
// note: a sentence added to the description (Model knowledge with web search).
export type PreviewSource={settings:FrameSettings;document:()=>Promise<{filename:string;text:string}|{filename:string;pdf:true}|undefined>;note?:string};
export function RequestPreview({unit,source,disabled}:{unit:'text'|'subject';source:()=>PreviewSource;disabled?:boolean}){
 const [view,setView]=useState<(RequestView&{unit:'text'|'subject';provider:Provider;first:boolean;note?:string})|null>(null),[problem,setProblem]=useState('');
 async function open(){
  setProblem('');
  try{
   const {settings,document,note}=source(),doc=await document();
   setView({...previewRequest(settings,doc??{filename:unit==='subject'?'subject.txt':'example.txt',text:PREVIEW_PLACEHOLDER[unit]}),unit,provider:settings.provider,first:Boolean(doc),note});
  }catch{setProblem('The request could not be shown. Check that the first text opens correctly.');}
 }
 const shown=(text:string)=>text.length>200000?text.slice(0,200000)+`\n\n[${count(text.length-200000)} more characters are sent and not shown here.]`:text;
 return <div className="research-preview-slot">
  <button type="button" className="textbutton research-preview-button" disabled={disabled} onClick={()=>void open()} title={`Show the request that would be sent for the first ${unit}`}>Preview request</button>
  {problem&&<p className="hint" role="alert">{problem}</p>}
  {view&&<Dialog open onOpenChange={next=>{if(!next)setView(null);}}>
   <DialogContent className="research-dialog research-wide research-preview">
    <DialogTitle>Request preview{view.first?` (first ${view.unit})`:''}</DialogTitle>
    <DialogDescription>This request is sent to {PROVIDERS[view.provider].label} for each {view.unit}{view.first?`, here with the first ${view.unit}`:`. A placeholder stands where the ${view.unit} goes`}. Your API key travels separately in a header and is never part of a request’s record.{view.note?' '+view.note:''}</DialogDescription>
    <h3>Prompt as sent</h3>
    <p className="hint">Your prompt with the instructions the Lab adds for the answer format.{view.cached?' It carries the mark for the provider’s prompt cache.':''}</p>
    <pre className="research-preview-text" tabIndex={0}>{shown(view.prompt)}</pre>
    <h3>Message with the {view.unit}</h3>
    <pre className="research-preview-text" tabIndex={0}>{shown(view.message)}</pre>
    <h3>Settings sent with it</h3>
    <p className="hint">Sent to <code>{view.url}</code></p>
    <pre className="research-preview-text research-preview-code" tabIndex={0}>{JSON.stringify(view.settings,null,2)}</pre>
    <details className="research-preview-whole"><summary>The whole request as JSON</summary><pre className="research-preview-text research-preview-code" tabIndex={0}>{shown(JSON.stringify(view.body,null,2))}</pre></details>
   </DialogContent>
  </Dialog>}
 </div>;
}
