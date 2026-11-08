import {priceFor,type Provider,type Price,PRICE_DATE,SOURCES} from './pricing';
export type Range={low:number;high:number};
export type Input={tokens:Range;pdf?:boolean;requestTokens?:number};
export type Sample={input?:number;output:number;reasoning?:number;visible?:number};
export type EstimateConfig={provider:Provider;model:string;prompt:string;system?:string;schema?:string;effort:string;maxTokens?:number;thinkingBudget?:number;fields?:{name:string;type:string;description?:string}[];defaultExplanation?:boolean;cache?:boolean;webSearch?:boolean;rates?:Price;date?:string};
export type Estimate={count:number;inputBasis?:'provider'|'approximate';total:Range;batch?:Range;input:Range;visible:Range;reasoning:Range;inputCost:Range;visibleCost:Range;reasoningCost:Range;searchCost:Range;notes:string[];samples:number;outputAssumption:string;priceDate:string;source:string;unknown?:string};
export const add=(a:Range,b:Range):Range=>({low:a.low+b.low,high:a.high+b.high});
export const scale=(a:Range,n:number):Range=>({low:a.low*n,high:a.high*n});
const range=(low:number,high:number):Range=>({low,high});
const zero=()=>range(0,0);
// Local text heuristic: English prose ~4 characters/token; punctuation, code,
// and non-Latin scripts widen the range. This is not an exact tokenizer.
export function textTokens(text:string,multiplier=1):Range{
 const nonLatin=(text.match(/[^\u0000-\u024f]/gu)||[]).length;
 const rest=Math.max(0,text.length-nonLatin),punct=(text.match(/[{}\[\]_:<>\\/]/g)||[]).length;
 return range(Math.ceil((rest/4.8+nonLatin*.5+punct*.1)*multiplier),Math.ceil((rest/3.2+nonLatin*2+punct*.2)*multiplier));
}
export function outputAssumption(c:EstimateConfig):{tokens:Range;label:string}{
 const p=(c.prompt+'\n'+(c.system||'')).toLowerCase();
 let low=60,high=180,label='a category plus a short explanation';
 const only=/(?:only|nothing (?:else|more)).{0,35}(?:label|category|score|number)|(?:label|category|score|number).{0,35}(?:only|nothing (?:else|more))|no (?:explanation|justification)/.test(p);
 const words=[...p.matchAll(/(\d{1,5})(?:\s*[–-]\s*(\d{1,5}))?[ -]words?\b/g)].at(-1);
 if(only&&!c.defaultExplanation){low=3;high=18;label='a short label or score';}
 else if(words){const n=Number(words[1]),m=Number(words[2]||words[1]);low=n*1.1;high=m*1.8+20;label=`roughly ${n===m?n:n+'–'+m} words, as requested`;}
 else if(/detailed|in.depth|comprehensive|extended|long explanation/.test(p)){low=220;high=700;label='a detailed explanation';}
 else if(/paragraph/.test(p)){const n=Number(p.match(/(\d+)\s+paragraphs?/)?.[1]||1);low=100*n;high=260*n;label=n===1?'one explanatory paragraph':`${n} explanatory paragraphs`;}
 else if(/sentence/.test(p)){const n=Number(p.match(/(\d+)\s+(?:short\s+)?sentences?/)?.[1]||2);low=15*n+12;high=40*n+25;label=`about ${n} explanatory sentences`;}
 else if(!c.defaultExplanation&&!/explain|reason|justif|rationale|evidence|summari|analy[sz]/.test(p)){low=8;high=60;label='a short classification or structured answer';}
 if(c.fields?.length){low+=c.fields.length*8;high+=c.fields.length*18;let included=(!only&&(c.defaultExplanation||/explain|reason|justif|paragraph|sentence|rationale|evidence/.test(p)))?1:0;for(const f of c.fields){if(f.type==='string'&&/reason|explan|evidence|justif|rationale/.test((f.name+' '+f.description).toLowerCase())){if(included)included--;else{low+=40;high+=130;}}}label+=' with the configured output fields';}
 else if(/json|structured/.test(p)){low+=15;high+=45;}
 // Multiple requested classifications/domains need more than one label.
 const listed=p.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+/g)?.length||0;
 if(!only&&listed>2){low+=listed*3;high+=listed*12;}
 return {tokens:range(Math.max(1,Math.ceil(low)),Math.max(1,Math.ceil(high))),label};
}
export function reasoningAssumption(c:EstimateConfig,input:Range):Range{
 if(['none','off','disabled'].includes(c.effort))return zero();
 const numeric=Number(c.effort),budget=c.thinkingBudget||(Number.isFinite(numeric)&&numeric>0?numeric:undefined);
 const e=budget?(budget<=1024?'low':budget<=4096?'medium':'high'):c.effort;
 const bounds:Record<string,number[]>={minimal:[0,180],low:[80,650],medium:[300,2200],high:[800,5500],xhigh:[1500,9000],max:[2500,14000],dynamic:[150,4500],omit:[150,4500]};
 const b=bounds[e]||bounds.omit;
 const complexity=Math.min(2,1+Math.max(0,input.high-6000)/100000);
 return range(Math.min(b[0]*complexity,budget||Infinity),Math.min(b[1]*complexity,budget||Infinity));
}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function usageSample(provider:Provider,usage:any):Sample|undefined{
 if(!usage)return;
 const input=provider==='openrouter'?usage.prompt_tokens:provider==='gemini'?usage.promptTokenCount:provider==='anthropic'?(finite(usage.input_tokens)?usage.input_tokens+(usage.cache_creation_input_tokens||0)+(usage.cache_read_input_tokens||0):undefined):usage.input_tokens;
 const output=provider==='openrouter'?usage.completion_tokens:provider==='gemini'?(finite(usage.candidatesTokenCount)?usage.candidatesTokenCount+(usage.thoughtsTokenCount||0):undefined):usage.output_tokens;
 const reasoning=provider==='openrouter'?usage.completion_tokens_details?.reasoning_tokens:provider==='openai'?usage.output_tokens_details?.reasoning_tokens:provider==='gemini'?usage.thoughtsTokenCount:undefined;
 if(!finite(output))return;
 return {input:finite(input)?input:undefined,output,...(finite(reasoning)&&reasoning<=output?{reasoning,visible:output-reasoning}:{})};
}
function calibrated(values:number[],fallback:Range):Range{
 if(!values.length)return fallback;
 const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
 // Keep a broad interval even after a small pilot; this is not a confidence interval.
 const lo=sorted[Math.floor((n-1)*.1)]*.65,hi=sorted[Math.ceil((n-1)*.9)]*1.5;
 const weight=Math.min(.85,n/12);
 return range(fallback.low*(1-weight)+lo*weight,fallback.high*(1-weight)+hi*weight);
}
export function estimate(c:EstimateConfig,inputs:Input[],samples:Sample[]=[]):Estimate{
 const price=c.rates||priceFor(c.provider,c.model,c.date),assumption=outputAssumption(c),notes:string[]=[];
 const valid=samples.filter(s=>finite(s.output)&&s.output<=1000000).slice(-40);
 const answer=calibrated(valid.flatMap(s=>finite(s.visible)?[s.visible]:[]),assumption.tokens);
 const result:Estimate={count:inputs.length,total:zero(),input:zero(),visible:zero(),reasoning:zero(),inputCost:zero(),visibleCost:zero(),reasoningCost:zero(),searchCost:zero(),notes,samples:valid.length,outputAssumption:assumption.label,priceDate:c.provider==='openrouter'?'2026-10-31':PRICE_DATE,source:SOURCES[c.provider]};
 if(!price){result.unknown='No verified price is available for this model. Choose a model with listed rates.';return result;}
 if(!inputs.length){result.unknown='Add texts or items to the queue to estimate their cost.';return result;}
 if(!c.prompt.trim()){result.unknown='Add your annotation instructions to estimate output length.';return result;}
 if(price.note)notes.push(price.note);
 const multiplier=price.tokenMultiplier||1;
 const promptTokens=textTokens((c.system||'')+'\n'+c.prompt,multiplier);
 const fieldTokens=c.schema?textTokens(c.schema,multiplier):c.fields?.length?textTokens(JSON.stringify(c.fields),multiplier):zero();
 const overhead=add(promptTokens,add(fieldTokens,range(35,100)));
 for(const item of inputs){
  let input=finite(item.requestTokens)?range(item.requestTokens,item.requestTokens):add(scale(item.tokens,multiplier),overhead),visible={...answer},reasoning=calibrated(valid.flatMap(s=>finite(s.reasoning)?[s.reasoning]:[]),reasoningAssumption(c,input));
  const combined=valid.filter(s=>s.reasoning===undefined);
  if(combined.length){
   const total=calibrated(combined.map(s=>s.output),add(visible,reasoning));
   const share=reasoning.high/(visible.high+reasoning.high||1);
   visible=scale(total,1-share);reasoning=scale(total,share);
  }
  const max=c.maxTokens||12000;
  // The output cap covers the answer plus hidden reasoning; don't budget it twice.
  for(const edge of ['low','high'] as const){const total=visible[edge]+reasoning[edge];if(total>max){const ratio=max/total;visible[edge]*=ratio;reasoning[edge]*=ratio;}}
  // Independent clipping must retain ordered component ranges.
  visible.low=Math.min(visible.low,visible.high);reasoning.low=Math.min(reasoning.low,reasoning.high);
  if(c.webSearch){input=add(input,add(overhead,add(scale(item.tokens,multiplier),range(1600,11000))));visible=add(visible,range(250,900));reasoning=add(reasoning,range(100,3500));
   const search=c.provider==='gemini'?range(0,c.model.startsWith('gemini-2.5-')?.035:.042):range(.01,.03);result.searchCost=add(result.searchCost,search);
  }
  const cost=(tokens:Range,output=false):Range=>{
   const base=output?price.output:price.input,long=output?price.longOutput:price.longInput;
   return range(tokens.low*(price.threshold&&input.low>price.threshold?long??base:base)/1e6,tokens.high*(price.threshold&&input.high>price.threshold?long??base:base)/1e6);
  };
  // Cache writes can cost more than ordinary input. Hits depend on timing and
  // provider routing, so the conservative high edge includes a fresh write.
  const inputCost=cost(input);if(c.cache)inputCost.high*=1.25;
  result.input=add(result.input,input);result.visible=add(result.visible,visible);result.reasoning=add(result.reasoning,reasoning);
  result.inputCost=add(result.inputCost,inputCost);result.visibleCost=add(result.visibleCost,cost(visible,true));result.reasoningCost=add(result.reasoningCost,cost(reasoning,true));
 }
 result.total=add(add(result.inputCost,result.visibleCost),add(result.reasoningCost,result.searchCost));
 if(price.batch&&!c.webSearch)result.batch=scale(result.total,.5);
 notes.push(c.cache?'Cache hits are not assumed. The upper estimate allows for fresh cache writes; actual reuse may lower the cost.':'No cache savings are assumed.');
 result.inputBasis=inputs.every(i=>finite(i.requestTokens))?'provider':'approximate';
 if(result.inputBasis==='provider')notes.push(c.webSearch?'The provider counted the original request inputs. Additional web-research text is still estimated.':'Input uses the provider’s count for each complete request, including instructions and response formatting. The billed count can still differ slightly.');
 else if(c.provider==='openrouter')notes.push('Input is a rough local estimate; provider token counting is unavailable through OpenRouter in this Lab.');
 else notes.push('Input is a rough local estimate. Use “Count input tokens with provider” for a model-specific count.');
 if(inputs.some(i=>i.pdf)&&result.inputBasis!=='provider')notes.push('Whole PDFs include page-image allowances as well as extracted text. Scans and complex layouts make this estimate less certain.');
 if(valid.some(s=>s.reasoning===undefined))notes.push('Completed usage calibrates combined output. This provider does not report a separate reasoning count; the answer/reasoning split remains an assumption.');
 if(c.webSearch)notes.push('Includes a separate research call, research notes, retrieved text, and 1–3 searches per item. Search use can exceed this assumption; Google free search allowances are account-dependent.');
 if(c.provider==='gemini')notes.push('Uses paid API rates. Free-tier allowances and credits may reduce your bill.');
 if((c.maxTokens||12000)<assumption.tokens.high+reasoningAssumption(c,inputs[0].tokens).high)notes.push('The output limit constrains this estimate. It can also truncate annotations; a low cost does not guarantee a complete answer.');
 notes.push('Actual costs may differ. Token counts, answer length, and reasoning are approximate; retries, taxes, and account-specific rates are excluded.');
 return result;
}
export function money(r:Range):string{
 if(r.high===0)return '$0';if(r.high<.001)return 'less than $0.001';
 const digits=r.high<.1?3:r.high<10?2:0,f=10**digits;
 if(r.low===r.high)return '$'+r.low.toFixed(digits);
 const low=Math.floor(r.low*f)/f;return (low===0&&r.low>0?'<$'+(1/f).toFixed(digits):'$'+low.toFixed(digits))+'–$'+(Math.ceil(r.high*f)/f).toFixed(digits);
}
export function tokens(r:Range):string{return r.low===r.high?Math.round(r.low).toLocaleString():Math.round(r.low).toLocaleString()+'–'+Math.round(r.high).toLocaleString();}
