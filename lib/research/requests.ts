// Research mode keeps every request a run sent. The body of a request is the same for every text of a run but
// for the text itself, so it is kept once, with marks where the document goes (lib/request-frame.ts), in a
// list stored with the workspace. A result names its request by `requestId`.
// Not kept: API keys (they travel in request headers, never in a body) and a provider's whole reply. The
// workspace is one record that is written again at every save, and whole replies would about double it; a
// result keeps the model the provider names, why it stopped, and the text it returned.
import type {RequestFrame} from '../request-frame';

export type RecordedRequest={id:string;url:string;body:string};
// What recording adds to a result. lab: the build of the Lab that sent the request.
export type Recorded={requestId?:string;modelReported?:string;stopReason?:string;output?:string;lab?:string};
export const RECORDED_KEYS=['requestId','modelReported','stopReason','output','lab'] as const;
type Referring={requestId?:string;earlier?:{[key:string]:any}[];history?:{[key:string]:any}[]};

const valid=(r:any):r is RecordedRequest=>Boolean(r)&&typeof r==='object'&&typeof r.id==='string'&&/^q[1-9]\d{0,8}$/.test(r.id)&&typeof r.url==='string'&&r.url.length<=1000&&typeof r.body==='string'&&r.body.length<=1000000;
// The list as read from browser storage or a study backup (absent when empty).
export function cleanRequests(value:unknown):RecordedRequest[]|undefined{
 if(!Array.isArray(value))return undefined;
 const seen=new Set<string>(),list=value.filter(valid).filter(r=>!seen.has(r.id)&&Boolean(seen.add(r.id))).map(r=>({id:r.id,url:r.url,body:r.body}));
 return list.length?list:undefined;
}
// The id of a request in the list; a request not yet in it is added (the list itself is never changed).
export function recordRequest(list:RecordedRequest[]|undefined,frame:RequestFrame):{list:RecordedRequest[];id:string}{
 const current=list||[],known=current.find(r=>r.url===frame.url&&r.body===frame.body);
 if(known)return {list:current,id:known.id};
 const id='q'+(current.reduce((n,r)=>Math.max(n,Number(r.id.slice(1))),0)+1);
 return {list:[...current,{id,url:frame.url,body:frame.body}],id};
}
// The requests that a result, an earlier run's result, or a failed attempt still names.
export function usedRequests<T extends Referring>(list:RecordedRequest[]|undefined,rows:T[]):RecordedRequest[]|undefined{
 if(!list?.length)return undefined;
 const used=new Set<string>();
 for(const row of rows)for(const result of [row,...(row.earlier||[]),...(row.history||[]),...(row.earlier||[]).flatMap(e=>e.history||[])])if(typeof result.requestId==='string')used.add(result.requestId);
 const kept=list.filter(r=>used.has(r.id));
 return kept.length===list.length?list:kept.length?kept:undefined;
}
// What a reply from the Lab's request handlers adds to a result when recording is on.
export function replyNotes(out:unknown):Recorded{
 const o=(out&&typeof out==='object'?out:{}) as Record<string,unknown>,notes:Recorded={};
 for(const key of ['modelReported','stopReason','output'] as const)if(typeof o[key]==='string')notes[key]=o[key] as string;
 return notes;
}
// A result about to be made: nothing of an earlier attempt's record stays on it.
export const NOT_RECORDED:Record<(typeof RECORDED_KEYS)[number],undefined>={requestId:undefined,modelReported:undefined,stopReason:undefined,output:undefined,lab:undefined};
