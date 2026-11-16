// Research mode: settings of a request that leave what is asked of the model unchanged. Without them a request
// is the standard Lab's. They are stored with the study and recorded on every result made with them.
// cache: the prompt is marked for the provider's prompt cache, so that each later text reads it at a lower price.
// This file imports nothing, so anything may import it.
export type RequestSettings={cache?:true};
export function cleanRequestSettings(value:unknown):RequestSettings|undefined{
 return value&&typeof value==='object'&&(value as RequestSettings).cache===true?{cache:true}:undefined;
}
// What a request may carry: exactly the stored form, or nothing.
export function readRequestSettings(raw:FormDataEntryValue|null):RequestSettings|undefined{
 if(raw===null)return undefined;
 let value:unknown;try{value=JSON.parse(String(raw));}catch{throw Error('Could not read the request settings.');}
 const clean=cleanRequestSettings(value);
 if(!clean||JSON.stringify(clean)!==JSON.stringify(value))throw Error('Could not read the request settings.');
 return clean;
}

// How a provider caches a prompt. marked: the Lab marks the end of the prompt, and the provider caches what
// stands before the mark. automatic: the provider caches repeated prompts by itself; nothing is switched.
// minTokens: a shorter prompt is not cached (documented per model; absent where the provider names no number).
// write: what storing the prompt costs, as a multiple of the input price (batch: Anthropic's one-hour entry).
// Checked against the providers' prompt-caching and pricing pages on November 16, 2026.
export type CacheSupport={kind:'marked'|'automatic';vendor:'anthropic'|'openai'|'gemini';minTokens?:number;write?:number;batchWrite?:number};
export function cacheSupport(provider:string,model:string):CacheSupport|undefined{
 const routed=provider==='openrouter',vendor=routed?model.split('/')[0]:provider,id=routed?model.split('/').slice(1).join('/'):model;
 if(vendor==='anthropic')return {kind:'marked',vendor:'anthropic',minTokens:/haiku-4|opus-4[-.][56]/.test(id)?4096:/sonnet-4|opus-4/.test(id)?1024:512,write:1.25,batchWrite:2};
 if(vendor==='gemini'||vendor==='google')return {kind:'automatic',vendor:'gemini',...(/gemini-2\.5-(flash|pro)$/.test(id)?{minTokens:2048}:/gemini-(4-argon|3\.[68]-flash|3\.1-pro)/.test(id)?{minTokens:4096}:{})};
 if(vendor==='openai')return {kind:'marked',vendor:'openai',minTokens:1024,write:1.25,batchWrite:1.25};
}
// Whether the setting changes this request: the option is on, and the model's provider caches at a mark.
export const marksCache=(provider:string,model:string,request?:RequestSettings)=>Boolean(request?.cache)&&cacheSupport(provider,model)?.kind==='marked';
// What is recorded on a result: the setting, where it changed the request.
export const sentRequestSettings=(provider:string,model:string,request?:RequestSettings):RequestSettings|undefined=>marksCache(provider,model,request)?{cache:true}:undefined;

// Anthropic: the lifetime of the cache entry is five minutes, refreshed by every text that reads it; one hour
// in a batch, whose requests may start further apart.
export const anthropicSystem=(prompt:string,request?:RequestSettings,batch=false)=>request?.cache?[{type:'text',text:prompt,cache_control:batch?{type:'ephemeral',ttl:'1h'}:{type:'ephemeral'}}]:prompt;
// OpenAI caches only up to a mark placed in a message, so the prompt is then sent as a developer message that
// carries the mark, in place of `instructions`, which cannot carry one. The entry lives for 30 minutes.
// Without the option, explicit mode with no mark switches caching off: every text is new input.
export const OPENAI_CACHE_MODE={prompt_cache_options:{mode:'explicit'}} as const;
const OPENAI_MARK={prompt_cache_breakpoint:{mode:'explicit'}} as const;
export const openaiPrompt=(prompt:string,input:unknown[],request?:RequestSettings)=>request?.cache?{input:[{role:'developer',content:[{type:'input_text',text:prompt,...OPENAI_MARK}]},...input]}:{instructions:prompt,input};
// OpenRouter passes the mark on to the model's provider; a model whose provider caches by itself gets none.
export function openRouterSystem(prompt:string,model:string,request?:RequestSettings){
 if(!marksCache('openrouter',model,request))return prompt;
 return [{type:'text',text:prompt,...(model.startsWith('anthropic/')?{cache_control:{type:'ephemeral'}}:OPENAI_MARK)}];
}
