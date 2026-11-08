// Text Annotation Lab estimator. Jens’s Annotation Lab retains its earlier version.
// USD per million tokens, first-party Standard APIs. No subscription/free credits.
export const PRICE_DATE='2026-10-28';
export const SOURCES={openrouter:'https://openrouter.ai/models',openai:'https://developers.openai.com/api/docs/pricing',anthropic:'https://platform.claude.com/docs/en/about-claude/pricing',gemini:'https://ai.google.dev/gemini-api/docs/pricing'};
export type Provider=keyof typeof SOURCES;
export type Price={provider:Provider;input:number;output:number;batch:boolean;threshold?:number;longInput?:number;longOutput?:number;tokenMultiplier?:number;changes?:{from:string;input:number;output:number}[];note?:string};
const oa=(input:number,output:number):Price=>({provider:'openai',input,output,batch:true,threshold:272000,longInput:input*2,longOutput:output*1.5});
const cl=(input:number,output:number):Price=>({provider:'anthropic',input,output,batch:true,tokenMultiplier:1.3});
const gg=(input:number,output:number):Price=>({provider:'gemini',input,output,batch:true});
const flash:Price={...gg(.75,3.75),changes:[{from:'2027-01-01',input:1.5,output:7.5}]};
// OpenRouter catalogue checked 2026-10-31. Credit-purchase fees are not inference usage.
const or=(input:number,output:number):Price=>({provider:'openrouter',input,output,batch:false,note:'OpenRouter catalogue rates checked October 31, 2026. Routing and price changes can affect actual usage.'});
export const PRICES:Record<string,Price>={
 'openai/gpt-6-luna':{...or(.1,.5),threshold:272000,longInput:.2,longOutput:.75},
 'anthropic/claude-haiku-5.5':{...or(.1,.5),threshold:100000,longInput:.5,longOutput:2.5,tokenMultiplier:1.3},
 'google/gemini-3.1-flash-lite':or(.25,1.5),
 'openai/gpt-6.1-terra':{...or(1,5),threshold:272000,longInput:2,longOutput:7.5},
 'openai/gpt-6-sol':{...or(2,10),threshold:272000,longInput:4,longOutput:15},
 'google/gemini-3.8-flash':{...or(.75,3.75),note:'OpenRouter standard endpoint rates checked November 1, 2026. Routing and service tiers can change actual costs.'},
 'anthropic/claude-sonnet-5.5':{...or(2,10),tokenMultiplier:1.3},
 'gpt-6-luna':oa(.1,.5),'gpt-6.1-terra':oa(1,5),'gpt-6.1-sol':oa(2,10),'gpt-6-sol':oa(2,10),'gpt-6-astra':oa(10,50),
 'gpt-5.6-luna':oa(.2,1.2),'gpt-5.6-terra':oa(2,12),'gpt-5.6-sol':{...oa(4,20),note:'GPT-5.6 Sol promotional rates are confirmed through at least November 21, 2026.'},
 'claude-haiku-5-5':{...cl(.1,.5),threshold:100000,longInput:.5,longOutput:2.5},
 'claude-haiku-4-5-20251001':{...cl(1,5),tokenMultiplier:1},
 'claude-sonnet-5-5':cl(2,10),'claude-opus-5-5':cl(4,20),'claude-fable-5-1':cl(10,50),
 'claude-sonnet-4-6':{...cl(3,15),tokenMultiplier:1},'claude-opus-4-6':{...cl(5,25),tokenMultiplier:1},
 'claude-sonnet-4-5':{...cl(3,15),tokenMultiplier:1,threshold:200000,longInput:6,longOutput:22.5},
 'claude-opus-4-5':{...cl(5,25),tokenMultiplier:1},
 'gemini-2.5-flash-lite':gg(.1,.4),'gemini-3.1-flash-lite':gg(.25,1.5),'gemini-3.5-flash-lite':gg(.3,2.5),
 'gemini-2.5-flash':gg(.3,2.5),'gemini-3.8-flash':flash,'gemini-3.6-flash':flash,
 'gemini-3.5-flash':{...flash,note:'Google routes this legacy identifier to Gemini 3.6 Flash; its tariff is used.'},
 'gemini-2.5-pro':{...gg(1.25,10),threshold:200000,longInput:2.5,longOutput:15},
 'gemini-4-argon':{...gg(2,10),changes:[{from:'2026-12-01',input:4,output:20}]},
 'gemini-3.1-pro-preview':{...gg(2,12),threshold:200000,longInput:4,longOutput:18},
};
export function priceFor(provider:Provider,model:string,date=new Date().toISOString().slice(0,10)):Price|undefined{
 const key=PRICES[model]?model:model.replace(/-\d{4}-\d{2}-\d{2}$/,'');
 const p=PRICES[key];if(!p||p.provider!==provider)return;
 const change=p.changes?.filter(c=>c.from<=date).at(-1);return change?{...p,input:change.input,output:change.output}:p;
}
