'use client';
// Research mode is the same Lab with more tools. Only the switch is part of
// the page from the start; the research screens load when they are first shown.
import {lazy,Suspense,useState,type ComponentProps,type ReactNode} from 'react';
import {Button} from '@/components/ui/button';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {samplingSummary,type RequestSettings} from '@/lib/request-settings';
import './research/research.css';

// more: shown under the switch's label (the standard Lab's “What changes?”).
export function ModeSwitch({on,onChange,disabled,more}:{on:boolean;onChange:(on:boolean)=>void;disabled?:boolean;more?:ReactNode}){
 const button=<button type="button" role="switch" aria-checked={on} aria-label="Research mode" className={'mode-switch'+(on?' on':'')} disabled={disabled} onClick={()=>onChange(!on)} title={on?'Back to the standard Lab. Your texts, prompt, and results stay as they are.':'Adds tools for research: several runs per text, agreement with human labels, sampling, and more exports. Your texts, prompt, and results stay as they are.'}><span className="mode-switch-track" aria-hidden="true"><span className="mode-switch-thumb"/></span><span className="mode-switch-label">Research<span className="mode-switch-more"> mode</span></span></button>;
 return more?<span className="mode-switch-group">{button}{more}</span>:button;
}

// "Sampling & limits" under the model (research mode): temperature, output limit, prices, reasoning summary, and
// OpenAI's logs, closed until opened. Its line names the settings that change what is sent.
export function SamplingLimits({sent,children}:{sent?:RequestSettings;children:ReactNode}){
 const set=samplingSummary(sent);
 return <details className="research-sampling"><summary>Sampling &amp; limits{set.length?<span className="research-sampling-set"> · {set.join(' · ')}</span>:null}</summary><div className="research-sampling-body">{children}</div></details>;
}

// What research mode adds to the standard Lab: opened from “What changes?” under the switch, and shown at the top of
// About in research mode.
const CHANGES=[
 'API keys for each provider, kept in this browser if you choose.',
 'Typed answer fields (scales, categories, numbers, yes/no) that the model must answer in that form.',
 'Request settings: system prompt, temperature, output limit, prompt caching, reasoning summary, and any model ID.',
 'Texts from a table with their metadata (also usable in the prompt), random samples, and filters.',
 'Batches of up to 100,000 requests in one run.',
 'Runs & agreement: each run kept with its settings, up to 10 annotations per text, a Results panel with figures and 95% intervals, and agreement between runs and with human labels.',
 'An Export tab: Excel workbook, a complete research repository, a lean supplementary package for a data deposit (one run, with a rerun script), and a study backup.',
 'One tab at a time, so no request is sent, or paid for, twice.',
];
export function ResearchChanges(){
 return <ul className="research-changes">{CHANGES.map(item=><li key={item}>{item}</li>)}</ul>;
}
export function WhatChanges(){
 return <Popover><PopoverTrigger asChild><button type="button" className="what-changes">What changes?</button></PopoverTrigger><PopoverContent align="end" sideOffset={8} className="what-changes-menu" aria-label="What research mode adds"><p className="what-changes-title">Research mode adds</p><ResearchChanges/><p className="what-changes-note">The teaching tabs are hidden while it is on, and charts and Excel files come from Runs &amp; agreement and Export. Your texts, prompt, and results stay as they are.</p></PopoverContent></Popover>;
}

// Research mode works in one tab at a time (lib/research/tab-lock.ts). With openHere: shown instead of the Lab in a tab
// that opened in research mode while another tab has it. Without: shown in the standard Lab when switching on is refused.
export function OtherTabNotice({openHere}:{openHere?:()=>Promise<boolean>}){
 const [stillOpen,setStillOpen]=useState(false);
 return <div className={openHere?'other-tab':'other-tab-note'}><div className="message" role={openHere?'status':'alert'}><strong>Research mode is already open in another tab or window of this browser.</strong> It works in one tab at a time, so that the same requests are never sent (and paid for) twice and changes don’t overwrite each other. {openHere?'Switch to the other tab, or close it or turn research mode off there: this tab then opens research mode when you come back to it, or when you click Open here.':'Close it or turn research mode off there, then switch it on here.'}{openHere&&<div className="other-tab-actions"><Button onClick={async()=>setStillOpen(!(await openHere()))}>Open here</Button>{stillOpen&&<span>It is still open in another tab or window: close it there first.</span>}</div>}</div></div>;
}

// Research mode: step through the texts shown, from the details of one. The buttons stay in place (and keep the
// focus) at either end. index: the place of the text shown, from 0; -1 when it is not among them.
export function DetailSteps({index,total,onStep}:{index:number;total:number;onStep:(to:number)=>void}){
 if(index<0||total<2)return null;
 const step=(to:number,label:string,key:string)=><button type="button" className="textbutton" aria-disabled={to<0||to>=total} title={`${label} (${key})`} onClick={()=>{if(to>=0&&to<total)onStep(to);}}>{label}</button>;
 return <span className="research-steps">{step(index-1,'Previous','K')}<span>{(index+1).toLocaleString('en-US')} of {total.toLocaleString('en-US')}</span>{step(index+1,'Next','J')}</span>;
}
// J and K step too, while the details themselves or one of their buttons have the focus.
export function stepKey(event:{key:string;target:unknown;currentTarget:unknown;altKey?:boolean;ctrlKey?:boolean;metaKey?:boolean},index:number,total:number,onStep:(to:number)=>void){
 const key=event.key.toLowerCase(),to=key==='j'?index+1:key==='k'?index-1:-1;
 if(event.altKey||event.ctrlKey||event.metaKey||index<0||to<0||to>=total)return;
 if(event.target!==event.currentTarget&&(event.target as {tagName?:string}|null)?.tagName!=='BUTTON')return;
 onStep(to);
}

const load=()=>import('./research/panels');
const Keys=lazy(()=>load().then(module=>({default:module.KeysControl})));
const Tools=lazy(()=>load().then(module=>({default:module.ResearchTools})));
const Output=lazy(()=>load().then(module=>({default:module.OutputEditor})));
const Options=lazy(()=>load().then(module=>({default:module.RequestOptions})));
const Preview=lazy(()=>load().then(module=>({default:module.RequestPreview})));
const System=lazy(()=>load().then(module=>({default:module.SystemPrompt})));
const Model=lazy(()=>load().then(module=>({default:module.ModelChoice})));
const Filters=lazy(()=>load().then(module=>({default:module.ResearchFilters})));
const Detail=lazy(()=>load().then(module=>({default:module.ResearchDetail})));
const Runs=lazy(()=>load().then(module=>({default:module.RunsPanel})));
const Exports=lazy(()=>load().then(module=>({default:module.ExportPanel})));
const loading=<p className="hint" role="status">Loading…</p>;

export function ResearchKeys(props:ComponentProps<typeof Keys>){return <Suspense fallback={null}><Keys {...props}/></Suspense>;}
export function ResearchTools(props:ComponentProps<typeof Tools>){return <Suspense fallback={null}><Tools {...props}/></Suspense>;}
export function ResearchAnswerFields(props:ComponentProps<typeof Output>){return <Suspense fallback={null}><Output {...props}/></Suspense>;}
export function ResearchRequestOptions(props:ComponentProps<typeof Options>){return <Suspense fallback={null}><Options {...props}/></Suspense>;}
export function ResearchRequestPreview(props:ComponentProps<typeof Preview>){return <Suspense fallback={null}><Preview {...props}/></Suspense>;}
export function ResearchSystemPrompt(props:ComponentProps<typeof System>){return <Suspense fallback={null}><System {...props}/></Suspense>;}
// fallback: the standard Lab's model menu, shown until the research screens have loaded.
export function ResearchModel({fallback,...props}:ComponentProps<typeof Model>&{fallback:ReactNode}){return <Suspense fallback={fallback}><Model {...props}/></Suspense>;}
export function ResearchFilters(props:ComponentProps<typeof Filters>){return <Suspense fallback={null}><Filters {...props}/></Suspense>;}
export function ResearchDetail(props:ComponentProps<typeof Detail>){return <Suspense fallback={null}><Detail {...props}/></Suspense>;}
export function ResearchRuns(props:ComponentProps<typeof Runs>){return <Suspense fallback={loading}><Runs {...props}/></Suspense>;}
export function ResearchExport(props:ComponentProps<typeof Exports>){return <Suspense fallback={loading}><Exports {...props}/></Suspense>;}
