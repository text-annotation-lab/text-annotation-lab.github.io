import type {Provider} from './providers';
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
 let message:string|undefined;
 if(has('insufficient_quota','billing_error','credit_balance_exhausted','insufficient_credits','enforced_spend_limit_reached'))
  message=`${source} reports an upstream account quota or credit limit. Check the failed request in OpenRouter Activity; if you supplied your own provider key, also check that provider's account. This does not by itself mean your lab key's allowance is exhausted.`;
 else if(/(?:requests|tokens)[ _-]*per[ _-]*day|\b(?:rpd|tpd)\b|daily (?:request|token|quota) limit/i.test(messages))
  message=`${source} reports a daily request or token limit. Retry after that limit resets, or try another model. Fewer parallel annotations will not remove a daily limit.`;
 else if(has('rate_limit_exceeded','rate_limit_error','rate_limited','too_many_requests','slow_down')||/rate[ -]limit|too many requests|(?:requests|tokens)[ _-]*per[ _-]*minute/i.test(messages)||metadata?.limit_source==='upstream_provider_shared_pool'){
  const kind=/tokens[ _-]*per[ _-]*minute|\btpm\b/i.test(messages)?'a tokens-per-minute limit':/requests[ _-]*per[ _-]*minute|\brpm\b/i.test(messages)?'a requests-per-minute limit':'a temporary rate limit';
  const advice=kind==='a tokens-per-minute limit'?'Long texts can reach this limit even with only a few requests. Try fewer parallel annotations or smaller chunks.':'Try 1 or 2 parallel annotations in Processing options to reduce request bursts.';
  message=`${source} reports ${kind}. ${advice} Wait before queueing a retry with Queue for retry, then choose Annotate next or Run all to start it.`;
 }
 return {message,details};
}
// Never return raw provider messages: they can echo credentials or document text.
// Codes guide the explanation only; an HTTP status alone cannot establish billing
// state, whether a request completed, or the cause of a generic quota error.
export function providerError(provider:Provider,status:number,body:unknown,headers?:Headers){
 const label=names[provider],consoleName=consoles[provider];
 const e=(body as any)?.error;
 const diagnostics=provider==='openrouter'?openRouterDiagnostics(e):undefined;
 const details=[...(Array.isArray(e?.details)?e.details:[]),...(diagnostics?.details??[])];
 const codes=[e?.code,e?.type,e?.status,...details.map((d:any)=>d?.reason)].filter((x:unknown)=>typeof x==='string').map((x:string)=>x.toLowerCase());
 const has=(...values:string[])=>values.some(v=>codes.includes(v));
 if(provider==='openrouter'&&e?.metadata?.limit_source==='openrouter_key_limit')return 'This OpenRouter key has reached its spending allowance. No new annotations will start. Ask the person who issued your key about additional funds; completed results are kept.';
 if(provider==='openrouter'&&e?.metadata?.limit_source==='openrouter_in_flight_budget')return 'OpenRouter has reserved the available budget for active requests. Wait for them to finish, refresh the allowance, and use fewer parallel annotations before retrying.';
 if(provider==='openrouter'&&status===402)return 'OpenRouter cannot fund this request with the available credits or allowance. Refresh the allowance and contact the key issuer if needed. A smaller request may fit the remaining budget. Completed results are kept.';
 let message:string;
 if(status===429&&diagnostics?.message)message=diagnostics.message;
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
export function incompleteAnnotation(provider:Provider,reason:unknown){
 const label=names[provider],consoleName=consoles[provider];
 if(['length','max_tokens','max_output_tokens','MAX_TOKENS'].includes(String(reason)))return `${label} reached the output limit before completing the annotation. Try a shorter requested explanation, less reasoning where available, or smaller document chunks. Check ${consoleName} usage before retrying; tokens may have been charged.`;
 if(['refusal','content_filter','SAFETY','RECITATION','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY'].includes(String(reason)))return `${label} blocked or refused this response under its content rules. No usable annotation was returned. Review whether the material can be processed by this provider; repeating the same request may fail again. Check usage before retrying.`;
 return `${label} returned an incomplete response. No usable annotation was returned. Check ${consoleName} usage before retrying; tokens may have been charged.`;
}
export async function providerJson(response:Response){
 try{return await response.json();}catch{return null;}
}
