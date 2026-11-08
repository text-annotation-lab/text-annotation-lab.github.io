import type {Provider} from './providers';
export type BatchJob={responseFormat?:string;answerFields?:string[];id?:string;runId:string;provider:Provider;model:string;prompt:string;effort:string;docIds:string[];createdAt:string;state:'submitting'|'unknown'|'processing'|'ready';completed?:number;total?:number;providerState?:string};
export type BatchResult={rawResponse?:string;answers?:Record<string,string>;id:string;score?:string;explanation?:string;tokens?:number;usage?:any;responseId?:string;error?:string};
export type BatchUpdate={id:string;terminal:boolean;state:string;completed:number;total:number;results?:BatchResult[]};
