import {isListedModel,type Provider} from './providers';
import type {RequestSettings} from './request-settings';
export {connectionFailure} from './research/early-stop';
const names={openrouter:'OpenRouter',openai:'OpenAI',anthropic:'Anthropic',gemini:'Gemini'};
const consoles={openrouter:'OpenRouter',openai:'OpenAI Platform',anthropic:'Claude Console',gemini:'Google AI Studio'};
// Interpret upstream diagnostics, but never display arbitrary provider text.
function openRouterDiagnostics(error:any){
 const metadata=error?.metadata;
 let raw=metadata?.raw;
 if(typeof raw==='string'){
  try{raw=raw.length<=16384?JSON.parse(raw):null;}catch{raw=null;}
 }
 const upstream=raw?.error??raw;
 const details=Array.isArray(upstream?.details)?upstream.details:[];
 const codes=[error?.code,error?.type,error?.status,metadata?.error_type,metadata?.provider_code,upstream?.code,upstream?.type,upstream?.status,...details.map((d:any)=>d?.reason)]
  .filter((x:unknown)=>typeof x==='string').map((x:string)=>x.toLowerCase());
 const providerNames:Record<string,string>={'openai':'OpenAI','anthropic':'Anthropic','google':'Google','google ai studio':'Google AI Studio','google vertex':'Google Vertex AI','google vertex ai':'Google Vertex AI','azure':'Azure','amazon bedrock':'Amazon Bedrock'};
 const provider=typeof metadata?.provider_name==='string'?providerNames[metadata.provider_name.toLowerCase()]:undefined;
 const source=provider?`OpenRouter's ${provider} provider`:'OpenRouter or its upstream provider';
 // These strings are used only to recognize common diagnostic phrases. Neither
 // the original message nor excerpts are returned to the browser or exports.
 const messages=[error?.message,upstream?.message,typeof metadata?.raw==='string'?metadata.raw:undefined]
  .filter((x:unknown)=>typeof x==='string').map((x:string)=>x.slice(0,16384)).join(' ');
 const has=(...values:string[])=>values.some(v=>codes.includes(v));
 let message:string|undefined,cause:'quota'|'daily'|'rate'|undefined;
 if(has('insufficient_quota','billing_error','credit_balance_exhausted','insufficient_credits','enforced_spend_limit_reached')){cause='quota';
  message=`${source} reports an upstream account quota or credit limit. Check the failed request in OpenRouter Activity; if you supplied your own provider key, also check that provider's account. This does not by itself mean your lab key's allowance is exhausted.`;
 }else if(/(?:requests|tokens)[ _-]*per[ _-]*day|\b(?:rpd|tpd)\b|daily (?:request|token|quota) limit/i.test(messages)){cause='daily';
  message=`${source} reports a daily request or token limit. Retry after that limit resets, or try another model. Fewer parallel annotations will not remove a daily limit.`;
 }else if(has('rate_limit_exceeded','rate_limit_error','rate_limited','too_many_requests','slow_down')||/rate[ -]limit|too many requests|(?:requests|tokens)[ _-]*per[ _-]*minute/i.test(messages)||metadata?.limit_source==='upstream_provider_shared_pool'){cause='rate';
  const kind=/tokens[ _-]*per[ _-]*minute|\btpm\b/i.test(messages)?'a tokens-per-minute limit':/requests[ _-]*per[ _-]*minute|\brpm\b/i.test(messages)?'a requests-per-minute limit':'a temporary rate limit';
  const advice=kind==='a tokens-per-minute limit'?'Long texts can reach this limit even with only a few requests. Try fewer parallel annotations or smaller chunks.':'Try 1 or 2 parallel annotations in Processing options to reduce request bursts.';
  message=`${source} reports ${kind}. ${advice} Wait before queueing a retry with Queue for retry, then choose Annotate next or Run all to start it.`;
 }
 return {message,details,cause};
}
// Research mode: a request setting the provider did not accept (lib/request-settings.ts), told from the
// parameter its error names. The provider's words are read only to find that parameter; none are returned.
// model: the model of the request. For one outside the Lab's lists, whose settings the Lab cannot know, a
// refused reasoning setting or answer format is named too.
function rejectedSetting(provider:Provider,status:number,e:any,request?:RequestSettings,model?:string):string|undefined{
 const other=model!==undefined&&!isListedModel(provider,model);
 if(!request&&!other||status!==400&&status!==404&&status!==422)return undefined;
 const label=names[provider],said=[e?.param,e?.message,e?.metadata?.raw].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.slice(0,16384)).join(' ');
 if(!request)return other?rejectedForModel(provider,status,said):undefined;
 if(request.temperature!==undefined&&(/temperature/i.test(said)||provider==='openrouter'&&status===404&&/no endpoints/i.test(said)))return `${label} does not accept a temperature for this model and reasoning setting. Clear Temperature under Sampling & limits, or choose a model that takes one.`;
 if(request.summary&&/summar|thinking\.display|include_?thoughts/i.test(said))return `${label} did not accept the request for a reasoning summary. Some models return none, and OpenAI gives summaries of its latest models only to verified organizations. Switch off “Record the model’s reasoning summary” under Sampling & limits to continue.`;
 if(request.maxOutput!==undefined&&/max_?(?:output_?|completion_?)?tokens/i.test(said))return `${label} does not accept ${request.maxOutput.toLocaleString('en-US')} as the output limit for this model. Change “Max output tokens” under Sampling & limits.`;
 return other?rejectedForModel(provider,status,said):undefined;
}
// A model outside the Lab's lists: what the provider's error says the model does not take.
function rejectedForModel(provider:Provider,status:number,said:string):string|undefined{
 const label=names[provider];
 if(provider==='openrouter'&&status===404&&/no endpoints/i.test(said))return 'OpenRouter has no provider for this model that takes every setting of the request. Set “Reasoning effort” to “model default”. If that is not enough, the model may not take structured answers: choose “Plain text” under Answer fields.';
 if(/reasoning|thinking|effort|budget_tokens/i.test(said))return `${label} does not accept this reasoning setting for the model. Choose another under “Reasoning effort”.`;
 if(/response_?format|json_?schema|output_config|structured|response_?schema|text\.format/i.test(said))return `${label} does not accept structured answers from this model. Choose “Plain text” under Answer fields.`;
 return undefined;
}
// Never return raw provider messages: they can echo credentials or document text.
// Codes guide the explanation only; an HTTP status alone cannot establish billing
// state, whether a request completed, or the cause of a generic quota error.
// request: research mode's request settings as sent, so a rejected one can be named.
export function providerError(provider:Provider,status:number,body:unknown,headers?:Headers,request?:RequestSettings,model?:string){
 const label=names[provider],consoleName=consoles[provider];
 const e=(body as any)?.error;
 const diagnostics=provider==='openrouter'?openRouterDiagnostics(e):undefined;
 const details=[...(Array.isArray(e?.details)?e.details:[]),...(diagnostics?.details??[])];
 const codes=[e?.code,e?.type,e?.status,...details.map((d:any)=>d?.reason)].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.toLowerCase());
 const has=(...values:string[])=>values.some(v=>codes.includes(v));
 if(provider==='openrouter'&&e?.metadata?.limit_source==='openrouter_key_limit')return 'This OpenRouter key has reached its spending allowance. No new annotations will start. Ask the person who issued your key about additional funds; completed results are kept.';
 if(provider==='openrouter'&&e?.metadata?.limit_source==='openrouter_in_flight_budget')return 'OpenRouter has reserved the available budget for active requests. Wait for them to finish, refresh the allowance, and use fewer parallel annotations before retrying.';
 if(provider==='openrouter'&&status===402)return 'OpenRouter cannot fund this request with the available credits or allowance. Refresh the allowance and contact the key issuer if needed. A smaller request may fit the remaining budget. Completed results are kept.';
 let message:string;const rejected=rejectedSetting(provider,status,e,request,model);
 if(rejected)message=rejected;
 else if(status===429&&diagnostics?.message)message=diagnostics.message;
 else if(status===401||has('api_key_invalid','api_key_expired','invalid_api_key','authentication_error'))message=`${label} rejected the API key. Copy an active key for this provider from ${consoleName}, then retry.`;
 else if(status===402||has('billing_error','credit_balance_exhausted','insufficient_credits'))message=`${label} reports a billing or credit problem. Check API credits and billing in ${consoleName} before retrying; waiting alone will not resolve it.`;
 else if(has('organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','insufficient_quota','quota_exceeded'))message=`${label} reports an account quota or spending limit. Check the specific limit and its reset date in ${consoleName}. Retry only after access is available again.`;
 else if(status===403)message=`${label} denied access. Check the key’s project permissions, model access, region eligibility, and billing in ${consoleName}. A new key alone may not resolve this.`;
 else if(status===404)message=`${label} could not find the requested model or resource. Check model availability and that you are using the correct provider account.`;
 else if(status===413||has('context_length_exceeded','request_too_large','input_too_long'))message=`${label} reports that the input is too large. Shorten the prompt or split the document into smaller chunks before retrying.`;
 else if(status===429){
  message=has('rate_limit_exceeded','too_many_requests','slow_down','rate_limit_error')?`${label} reports a rate limit. Wait before retrying and reduce Parallel annotations in Processing options. Check ${consoleName} if it continues.`:provider==='openrouter'?'OpenRouter rejected this request with a rate or quota limit, but did not provide a more specific reason. Wait before queueing a retry with Queue for retry, then choose Annotate next or Run all to start it. If that succeeds, a temporary limit is likely; try 1 or 2 parallel annotations. If it keeps failing, check your key allowance and OpenRouter Activity.':`${label} reports a rate or quota limit. Check ${consoleName}: a short-term rate limit calls for waiting or fewer parallel annotations; exhausted credits or a quota require restored access.`;
 }else if(status===503||status===529)message=`${label} is temporarily unavailable or overloaded. Wait before retrying. If it continues, check the provider’s service status or try another model.`;
 else if(status===408||status===504)message=`${label} timed out while processing the request. Check usage before retrying; it may have completed or been charged.`;
 else if(status>=500)message=`${label} reported a server error. Wait before retrying and check the provider’s service status if it continues. Check usage first; the request may have been charged.`;
 else if(status===400)message=`${label} rejected the request. Check that the document opens correctly and that the selected model supports the requested options. If it persists, try a short TXT file to isolate a document problem, and check ${consoleName} for account or request details.`;
 else message=`${label} could not complete the request. Check ${consoleName} for account access and request details before retrying.`;
 let wait='';
 if(status===429||status===503||status===529){
  const raw=headers?.get('retry-after');
  const delay=details.find((d:any)=>typeof d?.retryDelay==='string')?.retryDelay;
  if(raw&&/^\d+(?:\.\d+)?$/.test(raw.trim()))wait=` Wait at least ${Math.ceil(Number(raw))} seconds, as suggested by the provider.`;
  else if(raw&&Number.isFinite(Date.parse(raw)))wait=` Provider’s suggested retry time: ${new Date(raw).toISOString()}.`;
  else if(typeof delay==='string'&&/^\d+(?:\.\d+)?s$/.test(delay))wait=` Suggested wait: ${delay}.`;
 }
 return `${message}${wait} (HTTP ${status}.)`;
}
// The wait a provider names, in milliseconds: its Retry-After header (often not readable from a browser), a
// retryDelay detail (Gemini), or a phrase such as "try again in 1.2s" in its message. Only the number is read.
function namedWait(e:any,details:any[],headers?:Headers):number|undefined{
 const raw=headers?.get('retry-after')?.trim();
 if(raw&&/^\d+(?:\.\d+)?$/.test(raw))return Number(raw)*1000;
 if(raw&&Number.isFinite(Date.parse(raw)))return Math.max(0,Date.parse(raw)-Date.now());
 const delay=details.find((d:any)=>typeof d?.retryDelay==='string')?.retryDelay;
 if(typeof delay==='string'&&/^\d+(?:\.\d+)?s$/.test(delay))return Number(delay.slice(0,-1))*1000;
 const phrase=typeof e?.message==='string'?e.message.slice(0,16384).match(/(?:try again|retry) in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)(?![\w.]*\d)/i)?.[1]:undefined;
 if(!phrase)return undefined;
 const unit:Record<string,number>={ms:1,s:1000,m:60000,h:3600000};let total=0;
 for(const part of phrase.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gi))total+=Number(part[1])*unit[part[2].toLowerCase()];
 return total;
}
const NOT_SHORT_TERM=['billing_error','billing_not_active','credit_balance_exhausted','insufficient_credits','enforced_spend_limit_reached','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','insufficient_quota','quota_exceeded'];
const DAILY=/(?:requests|tokens)[ _-]*per[ _-]*day|\b(?:rpd|tpd)\b|daily (?:request|token|quota) limit|perday/i;
export const MAX_AUTOMATIC_WAIT_MS=120000;
// How long a run that paces itself (research mode) waits before sending a refused request again, in
// milliseconds; 0 when the provider names no time. Only a short-term rate limit or an overloaded provider
// qualifies, because such a request was not processed. Undefined otherwise: a quota, billing, or daily limit,
// any other failure, or a wait of more than two minutes, which is left to the person.
export function retryWait(provider:Provider,status:number,body:unknown,headers?:Headers):number|undefined{
 if(status!==429&&status!==503&&status!==529)return undefined;
 const e=(body as any)?.error,diagnostics=provider==='openrouter'?openRouterDiagnostics(e):undefined;
 const details=[...(Array.isArray(e?.details)?e.details:[]),...(diagnostics?.details??[])];
 if(status===429){
  const codes=[e?.code,e?.type,e?.status,...details.map((d:any)=>d?.reason)].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.toLowerCase());
  if(codes.some(code=>NOT_SHORT_TERM.includes(code))||diagnostics?.cause==='quota'||diagnostics?.cause==='daily')return undefined;
  if(provider==='openrouter'&&e?.metadata?.limit_source==='openrouter_key_limit')return undefined;
  let text=typeof e?.message==='string'?e.message:'';try{text+=' '+JSON.stringify(details);}catch{}
  if(DAILY.test(text.slice(0,16384)))return undefined;
 }
 const wait=namedWait(e,details,headers)??0;
 return wait>MAX_AUTOMATIC_WAIT_MS?undefined:Math.ceil(wait);
}
// Research mode, where a run carries on past a failed text (lib/research/early-stop.ts): whether a failed request
// says something about every request of the run rather than about its own text.
//  'account': the key, the account, or the model: HTTP 401, 402, 403, or 404, a key, billing, or quota code, or a
//   limit that cannot be waited out.
//  'same:…': another HTTP 400 that is not about the size or the content of one text. An unknown wording may still
//   be about one text, so such a failure counts only when it repeats with the same message. The mark stands for
//   the message without its words (a number worked out from it): a provider's words are never returned.
//  Undefined: it may be about its text, or it passes (a rate limit, a server error, a timeout).
const ABOUT_ONE_TEXT=/too long|context length|context window|context limit|maximum context|too many tokens|input token count|context_length_exceeded|request_too_large|input_too_long|invalid_prompt|flagged|moderation|usage polic|safety|content (?:policy|filter)|pdf pages|too many pages/i;
const KEY_CODES=['api_key_invalid','api_key_expired','invalid_api_key','authentication_error'];
function messageMark(text:string):string{
 // (Without the IDs each reply carries, such as a request ID.)
 const same=text.replace(/\b(?:req|msg|msgbatch|batch|file|resp|gen|chatcmpl)[-_][A-Za-z0-9_-]+/g,'').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'').replace(/request[ _-]?id\W*\S+/gi,'').replace(/\s+/g,' ').trim();
 let hash=0x811c9dc5;
 for(let i=0;i<same.length;i++){hash^=same.charCodeAt(i);hash=Math.imul(hash,0x01000193);}
 return (hash>>>0).toString(16).padStart(8,'0');
}
export function sharedFailure(provider:Provider,status:number,body:unknown,headers?:Headers):string|undefined{
 const e=(body as any)?.error,diagnostics=provider==='openrouter'?openRouterDiagnostics(e):undefined;
 const details=[...(Array.isArray(e?.details)?e.details:[]),...(diagnostics?.details??[])];
 const codes=[e?.code,e?.type,e?.status,...details.map((d:any)=>d?.reason)].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.toLowerCase());
 // Read only to recognize what the failure is about; none of it is returned.
 let raw=e?.metadata?.raw;if(raw&&typeof raw==='object')try{raw=JSON.stringify(raw);}catch{raw='';}
 const said=[...codes,e?.message,raw].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.slice(0,16384)).join(' ');
 if(provider==='openrouter'&&e?.metadata?.limit_source==='openrouter_key_limit')return 'account';
 if(codes.some(code=>KEY_CODES.includes(code)||NOT_SHORT_TERM.includes(code))||diagnostics?.cause==='quota')return 'account';
 if(status===401||status===402||status===404)return 'account';
 // A provider may refuse one text under its content rules with a 403.
 if(status===403)return ABOUT_ONE_TEXT.test(said)?undefined:'account';
 if(status===429)return retryWait(provider,status,body,headers)===undefined?'account':undefined;
 if(status!==400)return undefined;
 if(/credit balance/i.test(said))return 'account';
 if(ABOUT_ONE_TEXT.test(said))return undefined;
 return 'same:'+messageMark(said);
}
// The reply for a failed provider request: the message, `retryAfterMs` when a paced run may send it again, and
// `shared` when the failure is one that every request of the run would meet (see sharedFailure). Neither is
// kept with a result.
export function providerFailure(provider:Provider,status:number,body:unknown,headers?:Headers,request?:RequestSettings,model?:string):{error:string;retryAfterMs?:number;shared?:string}{
 const wait=retryWait(provider,status,body,headers),shared=sharedFailure(provider,status,body,headers);
 return {error:providerError(provider,status,body,headers,request,model),...(wait===undefined?{}:{retryAfterMs:wait}),...(shared?{shared}:{})};
}
export function incompleteAnnotation(provider:Provider,reason:unknown){
 const label=names[provider],consoleName=consoles[provider];
 if(['length','max_tokens','max_output_tokens','MAX_TOKENS'].includes(String(reason)))return `${label} reached the output limit before completing the annotation. Try a shorter requested explanation, less reasoning where available, or smaller document chunks. Check ${consoleName} usage before retrying; tokens may have been charged.`;
 if(['refusal','content_filter','SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY'].includes(String(reason)))return `${label} blocked or refused this response under its content rules. No usable annotation was returned. Review whether the material can be processed by this provider; repeating the same request may fail again. Check usage before retrying.`;
 return `${label} returned an incomplete response. No usable annotation was returned. Check ${consoleName} usage before retrying; tokens may have been charged.`;
}
export async function providerJson(response:Response){
 try{return await response.json();}catch{return null;}
}
