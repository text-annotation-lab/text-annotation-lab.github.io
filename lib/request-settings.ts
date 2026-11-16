// Research mode: settings of a request beyond what the standard Lab sends. Without them a request is the
// standard Lab's. They are stored with the study and recorded on every result made with them.
// cache: the prompt is marked for the provider's prompt cache, so that each later text reads it at a lower price.
// temperature: the sampling temperature, where the model takes one.
// maxOutput: the most output tokens a reply may have (reasoning included), where it is not the Lab's own limit.
// summary: the provider is asked for a readable summary of the model's reasoning, which is kept with the result.
// store: false asks OpenAI not to keep the request in its logs (the Lab otherwise asks OpenAI to keep it).
// system: a system prompt of the researcher's own, sent unchanged with every request in the provider's place for
// one, ahead of the message with the annotation prompt and the text (lib/request-frame.ts). Without one, no system
// prompt is sent. The box keeps what was typed; a request carries it only where it holds more than spaces.
// This file imports nothing, so anything may import it.
export type RequestSettings={cache?:true;temperature?:number;maxOutput?:number;summary?:true;store?:false;system?:string};
export const MIN_OUTPUT_TOKENS=16,MAX_OUTPUT_TOKENS=1000000,MAX_TEMPERATURE=2,MAX_SYSTEM_PROMPT=100000;
// The stored form: the settings in this order, and only those that are set.
export function cleanRequestSettings(value:unknown):RequestSettings|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const v=value as Record<string,unknown>,out:RequestSettings={};
 if(v.cache===true)out.cache=true;
 if(typeof v.temperature==='number'&&v.temperature>=0&&v.temperature<=MAX_TEMPERATURE)out.temperature=v.temperature;
 if(typeof v.maxOutput==='number'&&Number.isInteger(v.maxOutput)&&v.maxOutput>=MIN_OUTPUT_TOKENS&&v.maxOutput<=MAX_OUTPUT_TOKENS)out.maxOutput=v.maxOutput;
 if(v.summary===true)out.summary=true;
 if(v.store===false)out.store=false;
 if(typeof v.system==='string'&&v.system!==''&&v.system.length<=MAX_SYSTEM_PROMPT)out.system=v.system;
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

// Model families, told from a model's ID. Research mode accepts models outside the Lab's lists, and these
// rules decide what a request to such a model looks like; every listed model falls where it always did.
// Claude models that reason within a fixed budget, or not at all: Claude 3 and Claude 4 up to 4.5. Later
// Claude models decide how much to reason by themselves, guided by an effort.
export const budgetedClaude=(id:string)=>/^claude-(?:\d|instant)/.test(id)||/^claude-(?:opus|sonnet|haiku)-4(?:-[0-5])?(?:-\d{8}|-latest)?$/.test(id);
// OpenAI models that cache up to a mark (GPT-5.6 and later). Earlier ones cache repeated prompts by themselves.
export const marksOpenAICache=(id:string)=>/^gpt-(?:5\.(?:[6-9]|\d{2})|[6-9]|\d{2})(?:\b|[-.])/.test(id);
// OpenAI models without a reasoning setting.
export const plainOpenAI=(id:string)=>/^(?:gpt-3|gpt-4|chatgpt)/i.test(id);

// How a provider caches a prompt. marked: the Lab marks the end of the prompt, and the provider caches what
// stands before the mark. automatic: the provider caches repeated prompts by itself; nothing is switched.
// minTokens: a shorter prompt is not cached (documented per model; absent where the provider names no number).
// write: what storing the prompt costs, as a multiple of the input price (batch: Anthropic's one-hour entry).
// Checked against the providers' prompt-caching and pricing pages on November 16, 2026.
export type CacheSupport={kind:'marked'|'automatic';vendor:'anthropic'|'openai'|'gemini';minTokens?:number;write?:number;batchWrite?:number};
export function cacheSupport(provider:string,model:string):CacheSupport|undefined{
 const routed=provider==='openrouter',vendor=routed?model.split('/')[0]:provider,id=routed?model.split('/').slice(1).join('/'):model;
 if(vendor==='anthropic')return {kind:'marked',vendor:'anthropic',minTokens:/haiku-4|opus-4[-.][56]/.test(id)?4096:/sonnet-4|opus-4/.test(id)?1024:/^claude-3/.test(id)?(/haiku/.test(id)?2048:1024):512,write:1.25,batchWrite:2};
 if(vendor==='gemini'||vendor==='google')return {kind:'automatic',vendor:'gemini',...(/gemini-2\.5-(flash|pro)$/.test(id)?{minTokens:2048}:/gemini-(4-argon|3\.[68]-flash|3\.1-pro)/.test(id)?{minTokens:4096}:{})};
 if(vendor==='openai')return marksOpenAICache(id)?{kind:'marked',vendor:'openai',minTokens:1024,write:1.25,batchWrite:1.25}:{kind:'automatic',vendor:'openai',minTokens:1024};
}
// Whether the setting changes this request: the option is on, and the model's provider caches at a mark.
export const marksCache=(provider:string,model:string,request?:RequestSettings)=>Boolean(request?.cache)&&cacheSupport(provider,model)?.kind==='marked';

// The most output tokens the Lab allows a reply when no other limit is set (reasoning included). Gemini 4
// models think at length and get more room.
export const defaultOutputLimit=(provider:string,model:string)=>provider==='gemini'&&model.startsWith('gemini-4-')?32768:12000;
// A model with a fixed reasoning budget (Claude Haiku 4.5 and earlier) needs a limit above that budget.
export const outputFloor=(provider:string,model:string,effort?:string)=>provider==='anthropic'&&budgetedClaude(model)&&/^\d+$/.test(effort||'')?Number(effort)+1:MIN_OUTPUT_TOKENS;
// Whether a model takes a temperature. Claude models from Opus 4.7 on reject one, and a Claude model that
// reasons accepts none, so of the Lab's Claude models only Haiku 4.5 with reasoning off gets it, like the
// earlier Claude models (never through OpenRouter, which offers no "off"). Other providers are sent the
// temperature, and reject it for a model that takes none. Anthropic's scale ends at 1.
export function takesTemperature(provider:string,model:string,effort?:string){
 const routed=provider==='openrouter',vendor=routed?model.split('/')[0]:provider;
 return vendor!=='anthropic'||!routed&&budgetedClaude(model)&&effort==='off';
}
export const temperatureCeiling=(provider:string)=>provider==='anthropic'?1:MAX_TEMPERATURE;
// Whether there is reasoning to summarize: not with reasoning switched off, and not from an OpenAI model
// without a reasoning setting.
export const summarizesReasoning=(effort?:string,provider?:string,model?:string)=>effort!=='off'&&effort!=='none'&&!(provider==='openai'&&model!==undefined&&plainOpenAI(model));
// What a request carries and a result records: each setting where it changes the request to this provider and
// model. effort: the reasoning setting the request is sent with.
export function sentRequestSettings(provider:string,model:string,request?:RequestSettings,effort?:string):RequestSettings|undefined{
 if(!request)return undefined;
 const out:RequestSettings={};
 if(marksCache(provider,model,request))out.cache=true;
 if(request.temperature!==undefined&&takesTemperature(provider,model,effort))out.temperature=Math.min(request.temperature,temperatureCeiling(provider));
 if(request.maxOutput!==undefined){const limit=Math.max(request.maxOutput,outputFloor(provider,model,effort));if(limit!==defaultOutputLimit(provider,model))out.maxOutput=limit;}
 if(request.summary&&summarizesReasoning(effort,provider,model))out.summary=true;
 if(request.store===false&&provider==='openai')out.store=false;
 if(request.system?.trim())out.system=request.system;
 return Object.keys(out).length?out:undefined;
}
// The limit a request is sent with, and how long the Lab waits for its reply: longer where a model thinks at
// length or the limit was raised.
export const outputLimit=(provider:string,model:string,sent?:RequestSettings)=>sent?.maxOutput??defaultOutputLimit(provider,model);
export const requestTimeout=(provider:string,model:string,sent?:RequestSettings)=>provider==='gemini'&&model.startsWith('gemini-4-')||(sent?.maxOutput??0)>defaultOutputLimit(provider,model)?900000:180000;

// fixed (in the three functions below): how much of the prompt is the same for every text, where the prompt
// has placeholders that are filled in for each text (lib/prompt-inserts.ts). The mark then stands at the end of
// that part, and the rest of the prompt follows in a part of its own; a prompt that begins with a placeholder
// has nothing to cache and is sent as without the option.
export const cachedParts=(prompt:string,fixed:number|undefined,part:(text:string)=>object,mark:object):object[]|undefined=>{
 if(fixed===undefined||fixed>=prompt.length)return [{...part(prompt),...mark}];
 return prompt.slice(0,fixed).trim()?[{...part(prompt.slice(0,fixed)),...mark},part(prompt.slice(fixed))]:undefined;
};
// Anthropic: the lifetime of the cache entry is five minutes, refreshed by every text that reads it; one hour
// in a batch, whose requests may start further apart.
export const anthropicMark=(batch=false)=>({cache_control:batch?{type:'ephemeral',ttl:'1h'}:{type:'ephemeral'}});
export const anthropicSystem=(prompt:string,request?:RequestSettings,batch=false,fixed?:number)=>request?.cache&&cachedParts(prompt,fixed,text=>({type:'text',text}),anthropicMark(batch))||prompt;
// OpenAI caches only up to a mark placed in a message, and `instructions` cannot carry one: a system prompt that
// carries the mark is sent as a developer message. The entry lives for 30 minutes. Without the option, explicit
// mode with no mark switches caching off: every text is new input.
export const OPENAI_CACHE_MODE={prompt_cache_options:{mode:'explicit'}} as const;
export const OPENAI_MARK={prompt_cache_breakpoint:{mode:'explicit'}} as const;
export function openaiPrompt(prompt:string,input:unknown[],request?:RequestSettings,fixed?:number){
 const content=request?.cache?cachedParts(prompt,fixed,text=>({type:'input_text',text}),OPENAI_MARK):undefined;
 return content?{input:[{role:'developer',content},...input]}:{instructions:prompt,input};
}
// OpenRouter passes the mark on to the model's provider; a model whose provider caches by itself gets none.
export function openRouterSystem(prompt:string,model:string,request?:RequestSettings,fixed?:number){
 if(!marksCache('openrouter',model,request))return prompt;
 return cachedParts(prompt,fixed,text=>({type:'text',text}),model.startsWith('anthropic/')?{cache_control:{type:'ephemeral'}}:OPENAI_MARK)||prompt;
}
// The settings a request carries, in a few words (the summary line of Processing options, and the list of runs).
// The system prompt is not among them: it stands under the annotation prompt.
export function requestSummary(sent:RequestSettings|undefined):string[]{
 return [sent?.cache?'Prompt caching':'',sent?.temperature!==undefined?`temperature ${sent.temperature}`:'',sent?.maxOutput!==undefined?`max ${sent.maxOutput.toLocaleString('en-US')} output tokens`:'',sent?.summary?'reasoning summary':'',sent?.store===false?'not in OpenAI’s logs':''].filter(Boolean);
}
