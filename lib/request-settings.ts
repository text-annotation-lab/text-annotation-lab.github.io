// Research mode: settings of a request beyond what the standard Lab sends. Without them a request is the
// standard Lab's. They are stored with the study and recorded on every result made with them.
// cache: the prompt is marked for the provider's prompt cache, so that each later text reads it at a lower price.
// temperature: the sampling temperature, where the model takes one.
// maxOutput: the most output tokens a reply may have (reasoning included), where it is not the Lab's own limit.
// summary: the provider is asked for a readable summary of the model's reasoning, which is kept with the result.
// store: false asks OpenAI not to keep the request in its logs (the Lab otherwise asks OpenAI to keep it).
// This file imports nothing, so anything may import it.
export type RequestSettings={cache?:true;temperature?:number;maxOutput?:number;summary?:true;store?:false};
export const MIN_OUTPUT_TOKENS=16,MAX_OUTPUT_TOKENS=1000000,MAX_TEMPERATURE=2;
// The stored form: the settings in this order, and only those that are set.
export function cleanRequestSettings(value:unknown):RequestSettings|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const v=value as Record<string,unknown>,out:RequestSettings={};
 if(v.cache===true)out.cache=true;
 if(typeof v.temperature==='number'&&v.temperature>=0&&v.temperature<=MAX_TEMPERATURE)out.temperature=v.temperature;
 if(typeof v.maxOutput==='number'&&Number.isInteger(v.maxOutput)&&v.maxOutput>=MIN_OUTPUT_TOKENS&&v.maxOutput<=MAX_OUTPUT_TOKENS)out.maxOutput=v.maxOutput;
 if(v.summary===true)out.summary=true;
 if(v.store===false)out.store=false;
 return Object.keys(out).length?out:undefined;
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

// The most output tokens the Lab allows a reply when no other limit is set (reasoning included). Gemini 4
// models think at length and get more room.
export const defaultOutputLimit=(provider:string,model:string)=>provider==='gemini'&&model.startsWith('gemini-4-')?32768:12000;
// A model with a fixed reasoning budget (Claude Haiku 4.5) needs a limit above that budget.
export const outputFloor=(provider:string,model:string,effort?:string)=>provider==='anthropic'&&model.startsWith('claude-haiku-4-5')&&/^\d+$/.test(effort||'')?Number(effort)+1:MIN_OUTPUT_TOKENS;
// Whether a model takes a temperature. Claude models from Opus 4.7 on reject one, and a Claude model that
// reasons accepts none, so of the Lab's Claude models only Haiku 4.5 with reasoning off gets it (never through
// OpenRouter, which offers no "off"). Other providers are sent the temperature, and reject it for a model that
// takes none. Anthropic's scale ends at 1.
export function takesTemperature(provider:string,model:string,effort?:string){
 const routed=provider==='openrouter',vendor=routed?model.split('/')[0]:provider;
 return vendor!=='anthropic'||!routed&&model.startsWith('claude-haiku-4-5')&&effort==='off';
}
export const temperatureCeiling=(provider:string)=>provider==='anthropic'?1:MAX_TEMPERATURE;
// Whether there is reasoning to summarize: not with reasoning switched off.
export const summarizesReasoning=(effort?:string)=>effort!=='off'&&effort!=='none';
// What a request carries and a result records: each setting where it changes the request to this provider and
// model. effort: the reasoning setting the request is sent with.
export function sentRequestSettings(provider:string,model:string,request?:RequestSettings,effort?:string):RequestSettings|undefined{
 if(!request)return undefined;
 const out:RequestSettings={};
 if(marksCache(provider,model,request))out.cache=true;
 if(request.temperature!==undefined&&takesTemperature(provider,model,effort))out.temperature=Math.min(request.temperature,temperatureCeiling(provider));
 if(request.maxOutput!==undefined){const limit=Math.max(request.maxOutput,outputFloor(provider,model,effort));if(limit!==defaultOutputLimit(provider,model))out.maxOutput=limit;}
 if(request.summary&&summarizesReasoning(effort))out.summary=true;
 if(request.store===false&&provider==='openai')out.store=false;
 return Object.keys(out).length?out:undefined;
}
// The limit a request is sent with, and how long the Lab waits for its reply: longer where a model thinks at
// length or the limit was raised.
export const outputLimit=(provider:string,model:string,sent?:RequestSettings)=>sent?.maxOutput??defaultOutputLimit(provider,model);
export const requestTimeout=(provider:string,model:string,sent?:RequestSettings)=>provider==='gemini'&&model.startsWith('gemini-4-')||(sent?.maxOutput??0)>defaultOutputLimit(provider,model)?900000:180000;

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
// The settings a request carries, in a few words (the summary line of Processing options, and the list of runs).
export function requestSummary(sent:RequestSettings|undefined):string[]{
 return [sent?.cache?'Prompt caching':'',sent?.temperature!==undefined?`temperature ${sent.temperature}`:'',sent?.maxOutput!==undefined?`max ${sent.maxOutput.toLocaleString('en-US')} output tokens`:'',sent?.summary?'reasoning summary':'',sent?.store===false?'not in OpenAI’s logs':''].filter(Boolean);
}
