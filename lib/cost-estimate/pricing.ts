// Text Annotation Lab estimator. Jens’s Annotation Lab retains its earlier version.
// USD per million tokens, first-party Standard APIs. No subscription/free credits.
export const PRICE_DATE='2026-11-22';
export const OPENROUTER_PRICE_DATE='2026-11-18';
export const SOURCES={openrouter:'https://openrouter.ai/models',openai:'https://developers.openai.com/api/docs/pricing',anthropic:'https://platform.claude.com/docs/en/about-claude/pricing',gemini:'https://ai.google.dev/gemini-api/docs/pricing'};
export type Provider=keyof typeof SOURCES;
// cacheRead: the price of input read from the provider's prompt cache, as a share of the input price; absent
// where the provider's pricing page lists no figure for the model (checked November 16, 2026). In a batch it is
// halved like every other rate, unless cacheReadBatch gives the batch's own share of the standard input price.
export type Price={provider:Provider;input:number;output:number;batch:boolean;threshold?:number;longInput?:number;longOutput?:number;tokenMultiplier?:number;cacheRead?:number;cacheReadBatch?:number;changes?:{from:string;input:number;output:number}[];note?:string};
const oa=(input:number,output:number,cacheRead?:number):Price=>({provider:'openai',input,output,batch:true,threshold:272000,longInput:input*2,longOutput:output*1.5,...(cacheRead?{cacheRead}:{})});
const cl=(input:number,output:number,cacheRead=.1):Price=>({provider:'anthropic',input,output,batch:true,tokenMultiplier:1.3,cacheRead});
const gg=(input:number,output:number,cacheRead?:number):Price=>({provider:'gemini',input,output,batch:true,...(cacheRead?{cacheRead}:{})});
const flash:Price={...gg(.75,3.75,.1),changes:[{from:'2027-01-01',input:1.5,output:7.5}]};
// OpenRouter catalogue checked 2026-11-18. Credit-purchase fees are not inference usage.
const or=(input:number,output:number):Price=>({provider:'openrouter',input,output,batch:false,note:'OpenRouter catalogue rates checked November 18, 2026. Routing and price changes can affect actual usage.'});
export const PRICES:Record<string,Price>={
 'openai/gpt-6-luna':{...or(.1,.5),threshold:272000,longInput:.2,longOutput:.75},
 'anthropic/claude-haiku-5.5':{...or(.1,.5),threshold:100000,longInput:.5,longOutput:2.5,tokenMultiplier:1.3},
 'google/gemini-3.1-flash-lite':or(.25,1.5),
 'openai/gpt-6.1-terra':{...or(1,5),threshold:272000,longInput:2,longOutput:7.5},
 'openai/gpt-6-sol':{...or(2,10),threshold:272000,longInput:4,longOutput:15},
 'openai/gpt-6.1-sol':{...or(2,10),threshold:272000,longInput:4,longOutput:15},
 'openai/gpt-6.2-sol':{...or(2,10),threshold:272000,longInput:4,longOutput:15},
 'openai/gpt-6.2-astra':{...or(8,40),threshold:272000,longInput:16,longOutput:60},
 'google/gemini-4-hydrogen':or(1.5,7.5),
 'google/gemini-4-carbon':or(2,10),
 'google/gemini-3.8-flash':or(.825,4.125),
 'anthropic/claude-sonnet-5.5':{...or(2,10),tokenMultiplier:1.3},
 'anthropic/claude-fable-5.2':{...or(8,40),tokenMultiplier:1.3},
 'gpt-6-luna':oa(.1,.5,.1),'gpt-6.1-terra':oa(1,5,.05),'gpt-6.2-sol':oa(2,10,.05),'gpt-6.1-sol':oa(2,10,.05),'gpt-6-sol':oa(2,10),'gpt-6.2-astra':oa(8,40,.05),'gpt-6-astra':oa(10,50,.1),
 'gpt-5.6-luna':oa(.2,1.2),'gpt-5.6-terra':oa(2,12),'gpt-5.6-sol':{...oa(4,20),note:'GPT-5.6 Sol promotional rates are available until November 30, 2026.'},
 'claude-haiku-5-5':{...cl(.1,.5),threshold:100000,longInput:.5,longOutput:2.5},
 'claude-haiku-4-5-20251001':{...cl(1,5),tokenMultiplier:1},
 'claude-sonnet-5-5':cl(2,10,.05),'claude-opus-5-5':cl(4,20,.05),'claude-fable-5-2':cl(8,40,.025),'claude-fable-5-1':cl(10,50,.025),
 'claude-sonnet-4-6':{...cl(3,15),tokenMultiplier:1},'claude-opus-4-6':{...cl(5,25),tokenMultiplier:1},
 'claude-sonnet-4-5':{...cl(3,15),tokenMultiplier:1,threshold:200000,longInput:6,longOutput:22.5},
 'claude-opus-4-5':{...cl(5,25),tokenMultiplier:1},
 'gemini-2.5-flash-lite':{...gg(.1,.4,.1),cacheReadBatch:.1},'gemini-3.1-flash-lite':gg(.25,1.5,.1),'gemini-3.5-flash-lite':gg(.3,2.5,.1),
 'gemini-2.5-flash':gg(.3,2.5),'gemini-3.8-flash':flash,'gemini-3.6-flash':flash,
 'gemini-3.5-flash':{...flash,note:'Google routes this legacy identifier to Gemini 3.6 Flash; its tariff is used.'},
 'gemini-2.5-pro':{...gg(1.25,10),threshold:200000,longInput:2.5,longOutput:15},
 'gemini-4-hydrogen':gg(1.5,7.5),
 'gemini-4-neon':gg(3,15,.05),
 'gemini-4-argon':{...gg(2,10,.05),changes:[{from:'2026-12-01',input:4,output:20}]},
 'gemini-4-carbon':{...gg(2,10),changes:[{from:'2026-12-01',input:4,output:20}]},
 'gemini-3.1-pro-preview':{...gg(2,12,.1),cacheReadBatch:.1,threshold:200000,longInput:4,longOutput:18},
};
// A Claude model's context window in tokens (directly or through OpenRouter), or undefined where the Lab does not
// know it; then no text is called too long. Claude 5 models, and Opus and Sonnet 4.6 and later, take 1,000,000
// tokens; earlier Claude models 200,000.
export function contextWindow(provider:Provider,model:string):number|undefined{
 const id=provider==='anthropic'?model:provider==='openrouter'&&model.startsWith('anthropic/')?model.slice(10):'';
 if(/^claude-(fable|mythos)-5|^claude-(opus|sonnet|haiku)-5|^claude-(opus|sonnet)-4[-.][6-9]/.test(id))return 1000000;
 if(/^claude-/.test(id))return 200000;
 return undefined;
}
export function priceFor(provider:Provider,model:string,date=new Date().toISOString().slice(0,10)):Price|undefined{
 const key=PRICES[model]?model:model.replace(/-\d{4}-\d{2}-\d{2}$/,'');
 const p=PRICES[key];if(!p||p.provider!==provider)return;
 const change=p.changes?.filter(c=>c.from<=date).at(-1);return change?{...p,input:change.input,output:change.output}:p;
}

// Your own price for a model (research mode, lib/own-prices.ts), in USD per million tokens. In the estimate
// before a run it replaces the listed input and output prices. The model's other listed terms stay: the batch
// discount, the token multiplier, and the cache-read share. Its listed prices for long requests and for later
// dates do not apply to a typed price. A model without a listed price gets its provider's usual terms; Claude
// models from Opus 4.7 on count about 30% more tokens for the same text than earlier ones.
export type OwnPrice={input:number;output:number};
const earlierClaude=(id:string)=>/^claude-(?:\d|instant)/.test(id)||/^claude-(?:opus|sonnet|haiku)-4(?:[-.][0-6])?(?:-\d{8}|-latest)?(?::[\w-]+)?$/.test(id);
export function ownRates(provider:Provider,model:string,own:OwnPrice,date?:string):Price{
 const listed=priceFor(provider,model,date);
 if(listed){const {threshold,longInput,longOutput,changes,note,...terms}=listed;return {...terms,input:own.input,output:own.output};}
 const claude=provider==='anthropic'?model:provider==='openrouter'&&model.startsWith('anthropic/')?model.slice(10):'';
 return {provider,input:own.input,output:own.output,batch:provider!=='openrouter',...(claude&&!earlierClaude(claude)?{tokenMultiplier:1.3}:{}),...(provider==='anthropic'?{cacheRead:.1}:{})};
}
