import type {Provider} from './providers';
import type {AnswerSettings} from './answer-types';
import type {RequestSettings} from './request-settings';
export type BatchJob={responseFormat?:string;answerFields?:string[];answerSettings?:AnswerSettings;requestSettings?:RequestSettings;id?:string;runId:string;provider:Provider;model:string;prompt:string;effort:string;docIds:string[];createdAt:string;state:'submitting'|'unknown'|'processing'|'ready';completed?:number;total?:number;providerState?:string;
 // Research mode, several annotations per text: how many each text gets in its run, and, per text of docIds, which
 // of them this batch asks for (absent: all of them). Requests are numbered text by text in that order.
 repeats?:number;ns?:number[][];
 // Research mode, a run sent as several provider batches: each batch with the texts (by position in docIds) and the
 // requests it holds, and its own reference and state. Absent when the run went out as one batch.
 parts?:BatchPart[]};
export type BatchPart={items:[number,number];requests:[number,number];id?:string;state:'waiting'|'submitting'|'unknown'|'processing'|'ready'|'collected'|'unsent';completed?:number;total?:number;providerState?:string};
export type BatchResult={rawResponse?:string;answers?:Record<string,string>;id:string;score?:string;explanation?:string;tokens?:number;usage?:any;responseId?:string;error?:string;
 // Research mode: the model the provider names, why it stopped, the text it returned, and the summary of the
 // model's reasoning where the requests asked for one.
 modelReported?:string;stopReason?:string;output?:string;reasoningSummary?:string};
export type BatchUpdate={id:string;terminal:boolean;state:string;completed:number;total:number;results?:BatchResult[]};
