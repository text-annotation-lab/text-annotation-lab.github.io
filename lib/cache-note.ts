// Research mode: what the prompt caching option does at the selected provider, for Processing options.
import {cacheSupport} from './request-settings';
import {textTokens,tokens} from './cost-estimate/engine';
import {priceFor,type Provider} from './cost-estimate/pricing';
const percent=(share:number)=>`${+(share*100).toFixed(1)}%`;
// available: the option can be switched for this model. prompt: the prompt as a request sends it. fixed: where
// the prompt has placeholders that are filled in for each text, the length of the part before the first one,
// which is all that the texts' prompts share and so all that is stored.
export function cacheNote(provider:Provider,model:string,prompt:string,fixed?:number):{available:boolean;text:string}{
 const support=cacheSupport(provider,model),min=support?.minTokens?.toLocaleString('en-US');
 if(!support)return {available:false,text:'Not available for this model.'};
 if(support.kind==='automatic')return {available:false,text:`${support.vendor==='openai'?'OpenAI':support.vendor==='anthropic'?'Anthropic':'Gemini'} caches repeated prompts by itself${min?`, from ${min} tokens on this model`:''}. There is nothing to switch on or off.`};
 const shared=fixed===undefined?prompt:prompt.slice(0,fixed);
 if(prompt.trim()&&!shared.trim())return {available:false,text:'The prompt begins with a placeholder, so no part of it is the same for every text. There is nothing to cache.'};
 const price=priceFor(provider,model),batch=provider!=='openrouter';
 const life=support.vendor==='anthropic'?`5 minutes${batch?' (1 hour in a batch)':''}`:'30 minutes';
 const read=price?.cacheRead===undefined?'at a lower price':`at ${percent(price.cacheRead)} of the input price`;
 const stored=`${percent(support.write!-1)} extra${batch&&support.batchWrite!==support.write?` (${percent(support.batchWrite!-1)} in a batch)`:''}`;
 const length=shared.trim()?textTokens(shared,price?.tokenMultiplier||1):undefined;
 return {available:true,text:`${support.vendor==='anthropic'?'Anthropic':'OpenAI'} stores the prompt for ${life}; later texts read it ${read}, and storing it costs ${stored}. Prompts under ${min} tokens are not cached.${length?(fixed===undefined?` This prompt: about ${tokens(length)} tokens.`:` Only the part before the first placeholder is stored: about ${tokens(length)} tokens.`):''}${provider==='openai'?' It is then sent as a developer message instead of as instructions.':''}`};
}
