import type {Provider} from './providers';
import type {AnswerSettings} from './answer-types';
import type {RequestSettings} from './request-settings';
export type BatchJob={responseFormat?:string;answerFields?:string[];answerSettings?:AnswerSettings;requestSettings?:RequestSettings;id?:string;runId:string;provider:Provider;model:string;prompt:string;effort:string;docIds:string[];createdAt:string;state:'submitting'|'unknown'|'processing'|'ready';completed?:number;total?:number;providerState?:string};
export type BatchResult={rawResponse?:string;answers?:Record<string,string>;id:string;score?:string;explanation?:string;tokens?:number;usage?:any;responseId?:string;error?:string;
 // Research mode: the model the provider names, why it stopped, and the text it returned.
 modelReported?:string;stopReason?:string;output?:string};
export type BatchUpdate={id:string;terminal:boolean;state:string;completed:number;total:number;results?:BatchResult[]};
