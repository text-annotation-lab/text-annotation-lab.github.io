'use client';
// Research mode is the same Lab with more tools. Only the switch is part of
// the page from the start; the research screens load when they are first shown.
import {lazy,Suspense,type ComponentProps,type ReactNode} from 'react';
import './research/research.css';

export function ModeSwitch({on,onChange,disabled}:{on:boolean;onChange:(on:boolean)=>void;disabled?:boolean}){
 return <button type="button" role="switch" aria-checked={on} aria-label="Research mode" className={'mode-switch'+(on?' on':'')} disabled={disabled} onClick={()=>onChange(!on)} title={on?'Back to the standard Lab. Your texts, prompt, and results stay as they are.':'Adds tools for research: several runs per text, agreement with human labels, sampling, and more exports. Your texts, prompt, and results stay as they are.'}><span className="mode-switch-track" aria-hidden="true"><span className="mode-switch-thumb"/></span><span className="mode-switch-label">Research<span className="mode-switch-more"> mode</span></span></button>;
}

const load=()=>import('./research/panels');
const Keys=lazy(()=>load().then(module=>({default:module.KeysControl})));
const Tools=lazy(()=>load().then(module=>({default:module.ResearchTools})));
const Output=lazy(()=>load().then(module=>({default:module.OutputEditor})));
const Options=lazy(()=>load().then(module=>({default:module.RequestOptions})));
const Preview=lazy(()=>load().then(module=>({default:module.RequestPreview})));
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
// fallback: the standard Lab's model menu, shown until the research screens have loaded.
export function ResearchModel({fallback,...props}:ComponentProps<typeof Model>&{fallback:ReactNode}){return <Suspense fallback={fallback}><Model {...props}/></Suspense>;}
export function ResearchFilters(props:ComponentProps<typeof Filters>){return <Suspense fallback={null}><Filters {...props}/></Suspense>;}
export function ResearchDetail(props:ComponentProps<typeof Detail>){return <Suspense fallback={null}><Detail {...props}/></Suspense>;}
export function ResearchRuns(props:ComponentProps<typeof Runs>){return <Suspense fallback={loading}><Runs {...props}/></Suspense>;}
export function ResearchExport(props:ComponentProps<typeof Exports>){return <Suspense fallback={loading}><Exports {...props}/></Suspense>;}
