// Research mode: what the prompt caching option does at the selected provider, for Processing options.
import {cacheSupport} from './request-settings';
import {textTokens,tokens} from './cost-estimate/engine';
import {priceFor,type Provider} from './cost-estimate/pricing';
const percent=(share:number)=>`${+(share*100).toFixed(1)}%`;
// available: the option can be switched for this model. prompt: the prompt as a request sends it. fixed: where
// the prompt has placeholders that are filled in for each text, the length of the part before the first one,
// which is all that the texts' prompts share and so all that is stored. system: research mode's own system prompt,
// which is stored with it.
export function cacheNote(provider:Provider,model:string,prompt:string,fixed?:number,system?:string):{available:boolean;text:string}{
 const support=cacheSupport(provider,model),min=support?.minTokens?.toLocaleString('en-US');
 if(!support)return {available:false,text:'Not available for this model.'};
 if(support.kind==='automatic')return {available:false,text:`${support.vendor==='openai'?'OpenAI':support.vendor==='anthropic'?'Anthropic':'Gemini'} caches repeated prompts by itself${min?`, from ${min} tokens on this model`:''}. There is nothing to switch on or off.`};
 const own=system?.trim()?system:'',shared=fixed===undefined?prompt:prompt.slice(0,fixed);
 if(prompt.trim()&&!shared.trim()&&!own)return {available:false,text:'The prompt begins with a placeholder, so no part of it is the same for every text. There is nothing to cache.'};
 const price=priceFor(provider,model),batch=provider!=='openrouter';
 const life=support.vendor==='anthropic'?`5 minutes${batch?' (1 hour in a batch)':''}`:'30 minutes';
 const read=price?.cacheRead===undefined?'at a lower price':`at ${percent(price.cacheRead)} of the input price`;
 const stored=`${percent(support.write!-1)} extra${batch&&support.batchWrite!==support.write?` (${percent(support.batchWrite!-1)} in a batch)`:''}`;
 const length=shared.trim()||own?textTokens(own+(own&&shared.trim()?'\n':'')+(shared.trim()?shared:''),price?.tokenMultiplier||1):undefined;
 const sized=!length?'':own?(fixed===undefined?` The system prompt and this prompt: about ${tokens(length)} tokens.`:` Only the system prompt and the part of the prompt before the first placeholder are stored: about ${tokens(length)} tokens.`):fixed===undefined?` This prompt: about ${tokens(length)} tokens.`:` Only the part before the first placeholder is stored: about ${tokens(length)} tokens.`;
 return {available:true,text:`${support.vendor==='anthropic'?'Anthropic':'OpenAI'} stores the prompt for ${life}; later texts read it ${read}, and storing it costs ${stored}. Prompts under ${min} tokens are not cached.${sized}`};
}
