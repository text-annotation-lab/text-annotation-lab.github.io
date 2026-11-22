'use client';
// Research mode: the request settings in Processing options, the system prompt under the annotation prompt, and
// "Preview request".
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {PROVIDERS,type Provider} from '@/lib/providers';
import {MAX_OUTPUT_TOKENS,MAX_SYSTEM_PROMPT,budgetedClaude,cleanRequestSettings,defaultOutputLimit,outputFloor,plainOpenAI,sentRequestSettings,summarizesReasoning,takesTemperature,temperatureCeiling,type RequestSettings} from '@/lib/request-settings';
import {PREVIEW_PLACEHOLDER,previewRequest,type RequestView} from '@/lib/research/request-view';
import type {FrameSettings} from '@/lib/request-frame';
import {priceFor} from '@/lib/cost-estimate/pricing';
import {MAX_OWN_PRICE,ownPrice,setOwnPrice,useOwnPrices} from '@/lib/own-prices';
import {CacheOption} from './cache-option';
import {SettingInfo} from '@/components/setting-info';

const count=(n:number)=>n.toLocaleString('en-US');
// What the Lab adds after the prompt of these settings: on the answer format (the standard Lab's format), and on
// judging from learned knowledge (Model knowledge, unless the prompt holds it). Empty when it adds nothing.
const addedWords=(s:FrameSettings)=>[...(s.answerSettings?.plain||s.answerSettings?.named?[]:['for the answer format']),...(s.knowledge&&!s.answerSettings?.inPrompt?['for judging from learned knowledge']:[])].join(' and ');
// A number typed into a box takes effect once it is a number the setting allows; an emptied box clears the
// setting. Leaving the box shows what is in effect.
function NumberBox({id,value,placeholder,min,max,step,disabled,describedBy,onCommit}:{id:string;value?:number;placeholder:string;min:number;max:number;step:number|'any';disabled?:boolean;describedBy:string;onCommit:(value:number|undefined)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 return <input id={id} className="research-number" type="number" inputMode="decimal" min={min} max={max} step={step} placeholder={placeholder} disabled={disabled} aria-describedby={describedBy} value={draft??(value===undefined?'':String(value))}
  onChange={event=>{const text=event.target.value,n=Number(text);setDraft(text);if(!text.trim())onCommit(undefined);else if(Number.isFinite(n)&&n>=min&&n<=max&&(step==='any'||step<1||Number.isInteger(n)))onCommit(n);}} onBlur={()=>setDraft(null)}/>;
}

// Your own price for the selected model, for the cost estimate before a run (lib/own-prices.ts). A number typed
// into a box becomes your own price, and the other box keeps the price it shows (0 where there is none). An
// emptied box changes nothing, and shows the price again when it is left. The boxes show by themselves only where
// the Lab has no price or your own is in use; for a model with the Lab's price, a link opens them.
function PriceBoxes({provider,model}:{provider:Provider;model:string}){
 const own=ownPrice(provider,model,useOwnPrices()),listed=priceFor(provider,model),shown=own??listed,[asked,setAsked]=useState(false);
 const typed=(which:'input'|'output')=>(value:number|undefined)=>{if(value!==undefined)setOwnPrice(provider,model,{input:shown?.input??0,output:shown?.output??0,[which]:value});};
 if(listed&&!own&&!asked)return <button type="button" className="textbutton research-own-price" onClick={()=>setAsked(true)}>Use your own price</button>;
 return <>
  <div className="research-prices">
   <div><label htmlFor="price-input">Price per million input tokens ($)<SettingInfo topic="prices"/></label><NumberBox id="price-input" value={shown?.input} placeholder="Unknown" min={0} max={MAX_OWN_PRICE} step="any" describedBy="price-help" onCommit={typed('input')}/></div>
   <div><label htmlFor="price-output">Price per million output tokens ($)</label><NumberBox id="price-output" value={shown?.output} placeholder="Unknown" min={0} max={MAX_OWN_PRICE} step="any" describedBy="price-help" onCommit={typed('output')}/></div>
  </div>
  {(!listed||own)&&<p id="price-help" className="hint batch-explainer research-price-help">{!listed&&!own?'The Lab has no price for this model; type its price to have its cost estimated.':''}{own&&<>Your own price is in use and is kept in this browser. <button type="button" className="textbutton" onClick={()=>setOwnPrice(provider,model,null)}>{listed?'Use the Lab’s price':'Remove your price'}</button></>}</p>}
 </>;
}

// Prompt caching (part "cache", in Processing options), or temperature, output limit, your own price, reasoning
// summary, and (OpenAI) the provider's logs (part "sampling", under "Sampling & limits" below the model). Every box
// shows what a request to the selected model carries; a choice that does not apply to this model is kept for
// other models. `prompt` is the prompt as a request sends it; `fixed` is the length of its part before the
// first placeholder, where it has placeholders that are filled in for each text.
export function RequestOptions({part,provider,model,effort,prompt,fixed,value,disabled,onChange}:{part:'cache'|'sampling';provider:Provider;model:string;effort:string;prompt:string;fixed?:number;value?:RequestSettings;disabled?:boolean;onChange:(value:RequestSettings|undefined)=>void}){
 const sent=sentRequestSettings(provider,model,value,effort),set=(changes:Partial<RequestSettings>)=>onChange(cleanRequestSettings({...value,...changes}));
 const takes=takesTemperature(provider,model,effort),ceiling=temperatureCeiling(provider),usual=defaultOutputLimit(provider,model),floor=outputFloor(provider,model,effort),reasons=summarizesReasoning(effort,provider,model);
 if(part==='cache')return <CacheOption provider={provider} model={model} prompt={prompt} fixed={fixed} value={value} disabled={disabled} onChange={next=>set({cache:next?.cache})}/>;
 return <>
  <div className="processing-choice research-first-option"><label htmlFor="request-temperature">Temperature</label><NumberBox id="request-temperature" value={takes?sent?.temperature:undefined} placeholder={takes?'Model default':'Not sent'} min={0} max={ceiling} step={0.1} disabled={disabled||!takes} describedBy="request-temperature-help" onCommit={temperature=>set({temperature})}/></div>
  {!takes&&<p id="request-temperature-help" className="hint batch-explainer">{provider==='openai'||model.startsWith('openai/')?'OpenAI models from GPT-6.2 on take no temperature, so none is sent.':provider==='openrouter'?'Claude models that reason take no temperature, so none is sent.':`Claude models that reason take no temperature, so none is sent. ${budgetedClaude(model)&&!model.startsWith('claude-haiku-4-5')?'This model':'Claude Haiku 4.5'} takes one with reasoning off.`}</p>}
  <div className="processing-choice"><label htmlFor="request-max-output">Max output tokens</label><NumberBox id="request-max-output" value={sent?.maxOutput??usual} placeholder={String(usual)} min={floor} max={MAX_OUTPUT_TOKENS} step={1} disabled={disabled} describedBy="request-max-output-help" onCommit={maxOutput=>set({maxOutput})}/></div>
  <p id="request-max-output-help" className="hint batch-explainer">A reply that reaches it counts as failed. The Lab’s own limit for this model is {count(usual)}.{floor>16?` This reasoning setting needs at least ${count(floor)}.`:''}</p>
  <PriceBoxes provider={provider} model={model}/>
  <label className="research-check research-output-check research-request-option"><input type="checkbox" checked={reasons&&Boolean(value?.summary)} disabled={disabled||!reasons} onChange={event=>set({summary:event.target.checked?true:undefined})}/><span>Record the model’s reasoning summary{!reasons&&<small>{provider==='openai'&&plainOpenAI(model)?'This model has no reasoning to summarize.':'Reasoning is switched off for this model, so there is nothing to summarize.'}</small>}</span></label>
  {provider==='openai'&&<label className="research-check research-output-check research-request-option"><input type="checkbox" checked={value?.store!==false} disabled={disabled} onChange={event=>set({store:event.target.checked?undefined:false})}/><span>Show requests in OpenAI’s logs<small>OpenAI keeps them for a limited time; switch this off for confidential texts.</small></span></label>}
 </>;
}

// A system prompt of the researcher's own (lib/request-settings.ts), under the annotation prompt. It opens by itself
// when the study has one, and stays as the researcher leaves it while they type.
export function SystemPrompt({id,unit,value,disabled,onChange}:{id:string;unit:'text'|'subject';value:string;disabled?:boolean;onChange:(value:string)=>void}){
 const filled=value.trim()!=='',[open,setOpen]=useState(filled);
 useEffect(()=>{if(filled)setOpen(true);},[filled]);
 return <details className="research-system-prompt" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>System prompt (optional)</summary>
  <textarea id={id} aria-label="System prompt" rows={4} maxLength={MAX_SYSTEM_PROMPT} value={value} disabled={disabled} placeholder="Rarely needed. Standing instructions sent separately from the prompt, e.g. a role: “You are an expert in educational assessment.”" onChange={event=>onChange(event.target.value)}/>
 </details>;
}

// "Preview request": the request a run would send for the first text, built by the code that sends it.
// settings: what the run would be made with. document: the first text (absent: a placeholder stands in).
// note: a sentence added to the description (Model knowledge with web search).
// inserts: the first text's value for each placeholder of the prompt that is filled in.
export type PreviewSource={settings:FrameSettings;document:()=>Promise<({filename:string;text:string}|{filename:string;pdf:true})&{inserts?:Map<string,string>}|undefined>;note?:string};
export function RequestPreview({unit,source,disabled}:{unit:'text'|'subject';source:()=>PreviewSource;disabled?:boolean}){
 const [view,setView]=useState<(RequestView&{unit:'text'|'subject';provider:Provider;first:boolean;filled:boolean;pdf:boolean;placed:boolean;added:string;note?:string})|null>(null),[problem,setProblem]=useState('');
 async function open(){
  setProblem('');
  try{
   const {settings,document,note}=source(),doc=await document();
   // Without a first text there are no values to fill in, and the placeholders are shown as written.
   setView({...previewRequest(doc?settings:{...settings,inserts:false},doc??{filename:unit==='subject'?'subject.txt':'example.txt',text:PREVIEW_PLACEHOLDER[unit]}),unit,provider:settings.provider,first:Boolean(doc),filled:Boolean(doc&&settings.inserts),pdf:Boolean(doc&&'pdf' in doc),placed:Boolean(settings.placed),added:addedWords(settings),note});
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
    {view.system!==undefined&&<><h3>System prompt</h3>
    <p className="hint">Your own system prompt, sent unchanged.{view.systemCached?' It carries the mark for the provider’s prompt cache.':''}</p>
    <pre className="research-preview-text" tabIndex={0}>{shown(view.system)}</pre></>}
    <h3>Message as the model reads it</h3>
    <p className="hint">{view.placed&&!view.pdf?`Your prompt with the ${view.unit==='subject'?'subject’s fields':'text'} where it has {{text}}${view.added?`, then the instructions the Lab adds ${view.added}`:''}.`:`Your prompt${view.added?` with the instructions the Lab adds ${view.added}`:''}, then the ${view.unit==='subject'?'subject’s fields between <entry> tags':view.pdf?'PDF as a file':'text between <text> tags'}.${view.placed?' {{text}} is left empty for a PDF.':''}`}{view.filled?` The placeholders hold the values of the first ${view.unit}.`:''}{view.cached?(view.filled?' The part before the first placeholder carries the mark for the provider’s prompt cache.':` The part before the ${view.placed?'first {{text}}':view.unit} carries the mark for the provider’s prompt cache.`):''}</p>
    <pre className="research-preview-text" tabIndex={0}>{shown(view.message)}</pre>
    <h3>Settings sent with it</h3>
    <p className="hint">Sent to <code>{view.url}</code></p>
    <pre className="research-preview-text research-preview-code" tabIndex={0}>{JSON.stringify(view.settings,null,2)}</pre>
    <details className="research-preview-whole"><summary>The whole request as JSON</summary><pre className="research-preview-text research-preview-code" tabIndex={0}>{shown(JSON.stringify(view.body,null,2))}</pre></details>
   </DialogContent>
  </Dialog>}
 </div>;
}
