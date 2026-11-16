// Rate limits in a run that paces itself (research mode): which refused requests may be sent
// again after a wait, how long the wait is, and what the annotate route tells the page.
// All provider traffic is mocked. No paid requests or real keys are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
let calls=[],mock=async()=>Response.json({});
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}

(async()=>{
 const errors=load('lib/provider-errors.ts'),route=load('app/api/annotate/route.ts'),providers=load('lib/providers.ts'),feedback=load('lib/annotation-feedback.ts');
 const {retryWait,providerFailure,providerError,MAX_AUTOMATIC_WAIT_MS}=errors;
 assert.equal(MAX_AUTOMATIC_WAIT_MS,120000);
 const all=['openai','anthropic','gemini','openrouter'];

 // --- Which failures may be sent again ----------------------------------------------------
 // Only HTTP 429, 503, and 529: a request refused there was not processed.
 for(const provider of all){
  for(const status of [400,401,402,403,404,408,413,422,500,502,504])assert.equal(retryWait(provider,status,{error:{code:'rate_limit_exceeded'}}),undefined,`${provider} ${status}`);
  for(const status of [429,503,529])assert.equal(retryWait(provider,status,null),0,`${provider} ${status} names no time`);
  assert.equal(retryWait(provider,429,{error:{code:'rate_limit_exceeded',type:'rate_limit_error'}}),0);
 }
 // A quota, billing, or spending limit is not a short-term rate limit.
 for(const code of ['insufficient_quota','billing_not_active','quota_exceeded','billing_error','credit_balance_exhausted','insufficient_credits','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded'])
  for(const provider of all)for(const body of [{error:{code}},{error:{type:code}},{error:{code:code.toUpperCase()}}])assert.equal(retryWait(provider,429,body),undefined,`${provider} ${code}`);
 assert.equal(retryWait('openrouter',429,{error:{code:429,metadata:{limit_source:'openrouter_key_limit'}}}),undefined);
 assert.equal(retryWait('openrouter',429,{error:{code:429,metadata:{error_type:'enforced_spend_limit_reached'}}}),undefined);
 assert.equal(retryWait('openrouter',429,{error:{code:429,metadata:{error_type:'rate_limit_exceeded'}}}),0);
 assert.equal(retryWait('openrouter',429,{error:{code:429,metadata:{limit_source:'openrouter_in_flight_budget'}}}),0);
 // A daily limit does not pass in minutes.
 assert.equal(retryWait('openai',429,{error:{code:'rate_limit_exceeded',message:'Rate limit reached for gpt-6-luna on requests per day (RPD): Limit 200, Used 200. Please try again in 7m12s.'}}),undefined);
 assert.equal(retryWait('openai',429,{error:{code:'rate_limit_exceeded',message:'Rate limit reached on tokens per day (TPD).'}}),undefined);
 assert.equal(retryWait('gemini',429,{error:{status:'RESOURCE_EXHAUSTED',details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]},{retryDelay:'30s'}]}}),undefined);
 assert.equal(retryWait('gemini',429,{error:{status:'RESOURCE_EXHAUSTED',details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}]},{retryDelay:'30s'}]}}),30000);
 assert.equal(retryWait('openrouter',429,{error:{code:429,message:'Daily request limit reached.',metadata:{error_type:'rate_limit_exceeded'}}}),undefined);

 // --- The wait the provider names ---------------------------------------------------------
 const openai=message=>({error:{code:'rate_limit_exceeded',message}});
 assert.equal(retryWait('openai',429,openai('Rate limit reached for gpt-6-luna in organization org-x on requests per min (RPM): Limit 500, Used 500, Requested 1. Please try again in 120ms. Visit the site.')),120);
 assert.equal(retryWait('openai',429,openai('Limit 30000, Used 29000, Requested 2500. Please try again in 1.2s.')),1200);
 assert.equal(retryWait('openai',429,openai('Please try again in 20s.')),20000);
 assert.equal(retryWait('openai',429,openai('Please try again in 1m30s.')),90000);
 assert.equal(retryWait('openai',429,openai('Please try again in 2m0s.')),120000);
 assert.equal(retryWait('openai',429,openai('Please try again in 6m0s.')),undefined,'More than two minutes is left to the person');
 assert.equal(retryWait('openai',429,openai('Please try again in 1h0m0s.')),undefined);
 assert.equal(retryWait('openai',429,openai('Please try again later.')),0);
 assert.equal(retryWait('gemini',429,{error:{status:'RESOURCE_EXHAUSTED',message:'You exceeded your current quota. Please retry in 34.07s.'}}),34070);
 assert.equal(retryWait('gemini',429,{error:{details:[{retryDelay:'12.5s'}]}}),12500);
 assert.equal(retryWait('gemini',429,{error:{details:[{retryDelay:'300s'}]}}),undefined);
 assert.equal(retryWait('gemini',429,{error:{details:[{retryDelay:'soon'}]}}),0);
 // The header, where the browser may read it, comes first.
 assert.equal(retryWait('anthropic',429,{type:'error',error:{type:'rate_limit_error',message:'This request would exceed your rate limit.'}},new Headers({'retry-after':'7'})),7000);
 assert.equal(retryWait('anthropic',529,{type:'error',error:{type:'overloaded_error'}},new Headers({'retry-after':'1.5'})),1500);
 assert.equal(retryWait('openai',429,openai('Please try again in 20s.'),new Headers({'retry-after':'3'})),3000);
 assert.equal(retryWait('openai',503,{},new Headers({'retry-after':'121'})),undefined);
 assert.equal(retryWait('openai',503,{},new Headers({'retry-after':'not a time'})),0);
 const soon=retryWait('openai',503,{},new Headers({'retry-after':new Date(Date.now()+30000).toUTCString()}));assert(soon>27000&&soon<=30000,String(soon));
 assert.equal(retryWait('openai',503,{},new Headers({'retry-after':new Date(Date.now()-5000).toUTCString()})),0,'A time already past is no wait');
 assert.equal(retryWait('openrouter',429,{error:{code:429,metadata:{error_type:'rate_limit_exceeded'}}},new Headers({'Retry-After':'12'})),12000);
 // Only a number is taken from the provider; its words never travel.
 for(const provider of all){
  const body={error:{message:'SECRET sk-userkey try again in SECRET',code:'SECRET',details:[{retryDelay:'SECRET'}]}},out=providerFailure(provider,429,body,new Headers({'retry-after':'SECRET'}));
  assert.deepEqual(Object.keys(out).sort(),['error','retryAfterMs']);assert.equal(out.retryAfterMs,0);assert(!JSON.stringify(out).includes('SECRET'));
  assert.equal(out.error,providerError(provider,429,body,new Headers({'retry-after':'SECRET'})),'The message is the one the Lab already gave');
  // Neither is sent again. (`shared` marks a failure every request would meet; see tests/carry-on.cjs.)
  assert.deepEqual(Object.keys(providerFailure(provider,401,{error:{code:'invalid_api_key'}})),['error','shared']);
  assert.deepEqual(Object.keys(providerFailure(provider,429,{error:{code:'insufficient_quota'}})),['error','shared']);
 }

 // --- What the annotate route tells the page ----------------------------------------------
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:[providers.defaultModel('openrouter'),'medium']};
 function request(provider,knowledge=false,webSearch=false){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model:models[provider][0],effort:models[provider][1],prompt:'Classify the tone of the text.',answerFields:'[]'}))form.set(k,v);
  if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify([{heading:'Film',value:'Jaws'}]));form.set('webSearch',String(webSearch));}else form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 const limited={openai:{error:{code:'rate_limit_exceeded',message:'Please try again in 2s.'}},anthropic:{type:'error',error:{type:'rate_limit_error',message:'Rate limited.'}},gemini:{error:{status:'RESOURCE_EXHAUSTED',details:[{retryDelay:'2s'}]}},openrouter:{error:{code:429,message:'Rate limited.',metadata:{error_type:'rate_limit_exceeded'}}}};
 const waits={openai:2000,anthropic:0,gemini:2000,openrouter:0};
 for(const provider of all)for(const knowledge of [false,true]){
  calls=[];mock=async()=>Response.json(limited[provider],{status:429});
  let response=await route.POST(request(provider,knowledge)),out=await response.json();
  assert.equal(response.status,429);assert.equal(out.retryAfterMs,waits[provider],`${provider}: a rate limit carries its wait`);assert.match(out.error,/rate limit|rate or quota limit/i);assert.equal(calls.length,1,'The route itself sends once');
  mock=async()=>Response.json({error:{type:'overloaded_error'}},{status:provider==='anthropic'?529:503});
  response=await route.POST(request(provider,knowledge));out=await response.json();assert.equal(out.retryAfterMs,0,`${provider}: overloaded`);
  for(const [status,body] of [[401,{error:{code:'invalid_api_key'}}],[429,{error:{code:'insufficient_quota',type:'insufficient_quota'}}],[500,{}],[400,{}]]){
   mock=async()=>Response.json(body,{status});response=await route.POST(request(provider,knowledge));out=await response.json();
   assert.equal(response.status,status);assert(!('retryAfterMs' in out),`${provider} ${status}: not sent again`);assert.equal(typeof out.error,'string');
  }
 }
 // OpenRouter can report a rate limit inside a reply with HTTP 200.
 mock=async()=>Response.json(limited.openrouter);let response=await route.POST(request('openrouter')),out=await response.json();assert.equal(response.status,429);assert.equal(out.retryAfterMs,0);
 // Model knowledge with web search: a search refused for a rate limit was not made, so the subject may be sent again.
 for(const provider of ['openai','anthropic','gemini']){
  calls=[];mock=async()=>Response.json(limited[provider],{status:429});
  response=await route.POST(request(provider,true,true));out=await response.json();
  assert.equal(response.status,429);assert.equal(out.retryAfterMs,waits[provider]);assert.match(out.error,/^Web research failed\./);assert(!out.research);assert.equal(calls.length,1);
  mock=async()=>Response.json({error:{code:'insufficient_quota'}},{status:429});
  response=await route.POST(request(provider,true,true));out=await response.json();assert(!('retryAfterMs' in out));
 }

 // --- What the person is told -------------------------------------------------------------
 const at=new Date(2026,10,16,14,3,22).getTime();
 const notice=feedback.rateLimitNotice({at,waitMs:12250,atOnce:64},'text');
 assert.match(notice,/^At .*3.*22.* the provider reported a rate limit: a pause of about 12 seconds, then up to 64 texts at a time, rising again as requests get through\.$/);
 assert.match(feedback.rateLimitNotice({at,waitMs:400,atOnce:1},'subject'),/a pause of about 1 second, then up to one subject at a time/);
 assert.equal(feedback.isRateLimitNotice(notice),true);assert.equal(feedback.isRateLimitNotice('OpenAI reports a rate limit. Wait before retrying.'),false);assert.equal(feedback.isPlainConfirmation(notice),false);
 // --- A study backup keeps up to 128 at once ----------------------------------------------
 const backup=load('lib/study-backup.ts');
 const row={id:'a',name:'a.txt',status:'done',score:'1',explanation:'Why.',prompt:'P',provider:'openai',model:'gpt-6-luna',effort:'medium',processing:'instant'};
 const study=n=>({name:'Fast study',createdAt:'2026-11-16',texts:{concurrency:n,docs:[{...row,concurrency:n,file:new File(['Text'],'a.txt')}]},knowledge:{concurrency:n,items:[{...row,fields:[{heading:'Subject',value:'A'}],concurrency:n}]}});
 const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup(study(128)));
 assert.equal(restored.texts.concurrency,128);assert.equal(restored.texts.docs[0].concurrency,128);assert.equal(restored.knowledge.concurrency,128);assert.equal(restored.knowledge.items[0].concurrency,128);
 const tooMany=await backup.encodeStudyBackup(study(128)).then(json=>json.replaceAll('"concurrency":128','"concurrency":129'));
 assert.throws(()=>backup.decodeStudyBackup(tooMany));

 console.log('Rate limits: waits read from four providers, quota and daily limits left alone, the route reports them, and backups keep up to 128 at once.');
})().catch(error=>{console.error(error);process.exit(1);});
