'use client';
// Research mode is the same Lab with more tools. Only the switch is part of
// the page from the start; the research screens load when they are first shown.
import {lazy,Suspense,type ComponentProps} from 'react';
import './research/research.css';

export function ModeSwitch({on,onChange,disabled}:{on:boolean;onChange:(on:boolean)=>void;disabled?:boolean}){
 return <button type="button" role="switch" aria-checked={on} aria-label="Research mode" className={'mode-switch'+(on?' on':'')} disabled={disabled} onClick={()=>onChange(!on)} title={on?'Back to the standard Lab. Your texts, prompt, and results stay as they are.':'Adds tools for research: several runs per text, agreement with human labels, sampling, and more exports. Your texts, prompt, and results stay as they are.'}><span className="mode-switch-track" aria-hidden="true"><span className="mode-switch-thumb"/></span><span className="mode-switch-label">Research<span className="mode-switch-more"> mode</span></span></button>;
}

const load=()=>import('./research/panels');
const Keys=lazy(()=>load().then(module=>({default:module.KeysControl})));
const Tools=lazy(()=>load().then(module=>({default:module.ResearchTools})));
const Filters=lazy(()=>load().then(module=>({default:module.ResearchFilters})));
const Detail=lazy(()=>load().then(module=>({default:module.ResearchDetail})));
const Runs=lazy(()=>load().then(module=>({default:module.RunsPanel})));
const Exports=lazy(()=>load().then(module=>({default:module.ExportPanel})));
const loading=<p className="hint" role="status">Loading…</p>;

export function ResearchKeys(props:ComponentProps<typeof Keys>){return <Suspense fallback={null}><Keys {...props}/></Suspense>;}
export function ResearchTools(props:ComponentProps<typeof Tools>){return <Suspense fallback={null}><Tools {...props}/></Suspense>;}
export function ResearchFilters(props:ComponentProps<typeof Filters>){return <Suspense fallback={null}><Filters {...props}/></Suspense>;}
export function ResearchDetail(props:ComponentProps<typeof Detail>){return <Suspense fallback={null}><Detail {...props}/></Suspense>;}
export function ResearchRuns(props:ComponentProps<typeof Runs>){return <Suspense fallback={loading}><Runs {...props}/></Suspense>;}
export function ResearchExport(props:ComponentProps<typeof Exports>){return <Suspense fallback={loading}><Exports {...props}/></Suspense>;}
