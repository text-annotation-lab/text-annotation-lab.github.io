// All provider traffic is mocked. No paid requests or real keys are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
let calls=[],mock, pdfText='A readable PDF.', destroyed=0;
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;new Function('exports','require','fetch',code)(exports,id=>id==='unpdf'?{getDocumentProxy:async()=>({numPages:1,loadingTask:{destroy:async()=>destroyed++}}),extractText:async()=>({text:pdfText})}:id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id),async(url,options)=>{calls.push({url,options,body:typeof options.body==='string'?JSON.parse(options.body):options.body});return mock(url,options);});return exports;}
const providers=load('lib/providers.ts'),safety=load('lib/workflow-safety.ts'),annotate=load('app/api/annotate/route.ts').POST,balance=load('app/api/openrouter-balance/route.ts').POST,count=load('app/api/count-tokens/route.ts').POST,batch=load('app/api/batch/route.ts').POST,engine=load('lib/cost-estimate/engine.ts');
const key='sk-or-v1-fake-test',origin='https://lab.test';
function req({provider='openrouter',model=providers.defaultModel(provider),apiKey=key,web=false,knowledge=false,named=false,file=new File(['A synthetic sentence.'],'test.txt')}={}){const f=new FormData();for(const [k,v]of Object.entries({provider,model,effort:'medium',prompt:'Classify this item.',answerFields:JSON.stringify(named?['Tone']:[])}))f.set(k,v);if(knowledge){f.set('mode','model-knowledge');f.set('fields',JSON.stringify([{heading:'Title',value:'Synthetic book'}]));f.set('webSearch',String(web));}else f.set('file',file);return new Request(origin+'/api/annotate',{method:'POST',headers:{origin,authorization:'Bearer '+apiKey},body:f});}
function bReq(apiKey=key,requestOrigin=origin){return new Request(origin+'/api/openrouter-balance',{method:'POST',headers:{origin:requestOrigin,authorization:'Bearer '+apiKey}});}
const good=(extra={})=>({id:'test-response',choices:[{finish_reason:'stop',message:{content:JSON.stringify({score:'YES',explanation:'Synthetic evidence.'})}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150,completion_tokens_details:{reasoning_tokens:20}},...extra});
(async()=>{
 const checkKey=load('app/api/check-key/route.ts').POST;
 const checkRequest=(provider,apiKey,source=origin)=>new Request(origin+'/api/check-key',{method:'POST',headers:{
  origin:source,authorization:'Bearer '+apiKey,'X-Lab-Provider':provider,
 }});
 for(const [provider,token,host,header] of [
  ['openai','sk-proj-example-test','api.openai.com','authorization'],
  ['anthropic','sk-ant-example-test','api.anthropic.com','x-api-key'],
  ['gemini','AIza-example-test','generativelanguage.googleapis.com','x-goog-api-key'],
  ['gemini','AQ.example-test','generativelanguage.googleapis.com','x-goog-api-key'],
 ]){
  mock=async(url,options)=>{
   assert.equal(new URL(url).host,host);assert(!url.includes(token));assert.equal(options.body,undefined);
   assert.equal(options.headers.get(header),header==='authorization'?'Bearer '+token:token);
   assert.equal(options.redirect,'manual');
   return Response.json(provider==='gemini'?{models:[{}]}:{data:[{}]});
  };
  const response=await checkKey(checkRequest(provider,token));
  assert.deepEqual(await response.json(),{status:'accepted'});assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const sent=calls.length;
 for(const req of [checkRequest('openai',key),checkRequest('openai','sk-ant-example-test'),
  checkRequest('anthropic','sk-ant-admin01-example'),checkRequest('other','sk-proj-example-test'),
  checkRequest('openai','sk-proj-example-test','https://other.test')]){
  assert(!(await checkKey(req)).ok);
 }
 assert.equal(calls.length,sent);
 for(const [http,error,expected] of [[401,{code:'invalid_api_key'},'rejected'],
  [400,{details:[{reason:'API_KEY_INVALID'}]},'rejected'],[401,{type:'authentication_error'},'rejected'],
  [403,{message:'restricted'},'unverified'],[429,{},'unverified'],[503,{},'unverified']]){
  mock=async()=>Response.json({error},{status:http});
  assert.deepEqual(await (await checkKey(checkRequest('openai','sk-proj-example-test'))).json(),{status:expected});
 }
 calls.length=0;
 assert.equal(providers.availableProvider('openrouter'),'openrouter');
 assert.deepEqual(providers.PROVIDERS.openrouter.models,['openai/gpt-6-luna','anthropic/claude-haiku-5.5','google/gemini-3.1-flash-lite','openai/gpt-6-sol','anthropic/claude-sonnet-5.5','google/gemini-3.8-flash']);
 assert.equal(safety.setupErrors('openrouter',key,'prompt','openai/gpt-6-luna','medium').key,'');
 assert.match(safety.setupErrors('openai',key,'prompt','gpt-6-luna','medium').key,/OpenRouter/);
 for(const model of providers.PROVIDERS.openrouter.models){
  assert.equal(providers.selectedModel('openrouter',model),model);assert(providers.reasoningOptions('openrouter',model).includes(providers.defaultEffort('openrouter',model)));
  for(const knowledge of [false,true]){mock=async()=>Response.json(good());const r=await annotate(req({model,knowledge})),result=await r.json();assert.equal(r.status,200,JSON.stringify(result));assert.equal(result.score,'YES');assert.equal(result.rawResponse,undefined);const call=calls.at(-1);assert.equal(call.url,'https://openrouter.ai/api/v1/chat/completions');assert.equal(call.options.headers.Authorization,'Bearer '+key);assert.equal(call.body.model,model);assert.equal(call.body.max_tokens,12000);assert.equal(call.body.provider.require_parameters,true);assert.equal(call.body.response_format.json_schema.strict,true);assert.deepEqual(call.body.reasoning,{effort:'medium',exclude:true});assert.equal(call.body.tools,undefined);assert.equal(call.body.plugins,undefined);assert.deepEqual(call.body.prompt_cache_options,model.startsWith('openai/')?{mode:'explicit'}:undefined);}
 }
 mock=async()=>Response.json(good({choices:[{finish_reason:'stop',message:{content:JSON.stringify({score:'',explanation:'Evidence.',answers:{f0:'YES'}})}}]}));
 let r=await annotate(req({named:true}));assert.equal(r.status,200,JSON.stringify(await r.clone().json()));assert.equal((await r.json()).answers.f0,'YES');
 mock=async()=>Response.json(good());
 for(const model of providers.PROVIDERS.openrouter.models){
  const bytes='%PDF-synthetic-unchanged-bytes';r=await annotate(req({model,file:new File([bytes],'scan.pdf')}));assert.equal(r.status,200);assert.equal((await r.json()).inputMode,'pdf-native');
  const body=calls.at(-1).body;assert.deepEqual(body.plugins,[{id:'file-parser',pdf:{engine:'native'}}]);assert.equal(body.messages[1].content[1].type,'file');assert.equal(body.messages[1].content[1].file.filename,'scan.pdf');assert.equal(atob(body.messages[1].content[1].file.file_data.split(',')[1]),bytes);assert.equal(destroyed,0,'Whole PDFs are never locally stripped to text');
 }
 let before=calls.length;

 for(const options of [{provider:'openai'},{provider:'anthropic'},{provider:'gemini'},{apiKey:'sk-direct-key'},{model:'invalid'},{knowledge:true,web:true}]){before=calls.length;assert((await annotate(req(options))).status>=400);assert.equal(calls.length,before);}
 for(const route of [count,batch]){before=calls.length;assert.equal((await route(req())).status,400);assert.equal(calls.length,before);}
 for(const finish_reason of ['length','content_filter',null]){mock=async()=>Response.json(good({choices:[{finish_reason,message:{content:'{}'}}]}));assert.equal((await annotate(req())).status,422);}
 mock=async()=>Response.json(good({choices:[{finish_reason:'stop',message:{refusal:'No',content:'{}'}}]}));assert.equal((await annotate(req())).status,422);
 mock=async()=>Response.json(good({choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}));assert.equal((await annotate(req())).status,422);
 for(const status of [200,402]){mock=async()=>Response.json({error:{code:402,message:'SECRET should never be echoed',metadata:{limit_source:'openrouter_key_limit'}}},{status});r=await annotate(req());assert.equal(r.status,402);const out=await r.text();assert.match(out,/spending allowance/);assert(!out.includes('SECRET'));}
 mock=async()=>Response.json({error:{code:402,metadata:{limit_source:'openrouter_in_flight_budget'}}},{status:402});assert.match(await (await annotate(req())).text(),/active requests/);
 // Preserve actionable upstream diagnostics without exposing raw messages, keys,
 // document text, or automatically submitting another paid request.
 mock=async()=>Response.json({id:'charged-incomplete',choices:[{finish_reason:'length',message:{content:''}}],usage:{cost:.0123,total_tokens:120}});r=await annotate(req());assert.equal(r.status,422);assert.equal((await r.json()).usage.cost,.0123);
 const diagnosticCases=[
  [{metadata:{provider_name:'Anthropic',error_type:'rate_limit_exceeded',provider_code:'rate_limited'}},/Anthropic provider reports a temporary rate limit/],
  [{metadata:{provider_name:'OpenAI',raw:JSON.stringify({error:{code:'rate_limit_exceeded',message:'SECRET tokens per minute'}})}},/OpenAI provider reports a tokens-per-minute limit/],
  [{metadata:{provider_name:'Google AI Studio',raw:{error:{status:'RESOURCE_EXHAUSTED',message:'SECRET requests per minute',details:[{retryDelay:'30s'}]}}}},/requests-per-minute limit.*Suggested wait: 30s/],
  [{metadata:{raw:'SECRET model is temporarily rate-limited upstream. Please retry shortly.'}},/temporary rate limit/],
  [{metadata:{raw:JSON.stringify({error:{code:'rate_limit_exceeded',message:'SECRET requests per day'}})}},/daily request or token limit/],
  [{metadata:{provider_name:'OpenAI',raw:JSON.stringify({error:{code:'insufficient_quota',message:'SECRET'}})}},/upstream account quota or credit limit/],
  [{metadata:{limit_source:'upstream_provider_shared_pool'}},/temporary rate limit/],
  [{metadata:{provider_name:'SECRET',raw:'SECRET'}},/did not provide a more specific reason/],
  [{metadata:{raw:'{malformed SECRET'}},/did not provide a more specific reason/],
  [{metadata:{raw:{error:{status:'RESOURCE_EXHAUSTED',message:'SECRET'}}}},/did not provide a more specific reason/],
 ];
 for(const [error,expected] of diagnosticCases){
  before=calls.length;mock=async()=>Response.json({error:{code:429,...error}},{status:429});
  r=await annotate(req());assert.equal(r.status,429);const out=(await r.json()).error;
  assert.match(out,expected);if(out.includes('requests-per-minute limit')){assert(!out.includes('token limits'));assert.match(out,/queueing a retry/);}assert.match(out,/HTTP 429/);assert(!out.includes('SECRET'));assert.equal(calls.length,before+1);
 }
 for(const status of [200,429]){
  mock=async()=>Response.json({error:{code:429,metadata:{error_type:'rate_limit_exceeded'}}},{status,headers:{'Retry-After':'12'}});
  r=await annotate(req());assert.equal(r.status,429);assert.match((await r.json()).error,/temporary rate limit.*Wait at least 12 seconds/);
 }
 before=calls.length;assert.equal((await balance(bReq(key,'https://evil.test'))).status,403);assert.equal((await balance(bReq('sk-direct-key'))).status,401);assert.equal(calls.length,before);
 for(const remaining of [5,4.999,0]){mock=async()=>Response.json({data:{limit:5,limit_remaining:remaining,usage:5-remaining,limit_reset:null,label:'PRIVATE',account_balance:100}});r=await balance(bReq());assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');const out=await r.json();assert.equal(out.remaining,remaining);assert.equal(out.limit,5);assert.equal(out.reset,null);assert.equal(out.label,undefined);assert.equal(out.account_balance,undefined);assert.equal(calls.at(-1).url,'https://openrouter.ai/api/v1/key');assert.equal(calls.at(-1).options.cache,'no-store');}
 mock=async()=>Response.json({data:{limit:null,limit_remaining:null,usage:1,limit_reset:null}});assert.equal((await (await balance(bReq())).json()).remaining,null);
 mock=async()=>Response.json({data:{usage:1}});assert.equal((await balance(bReq())).status,502);
 mock=async()=>{throw Error('SECRET')};assert(!((await (await balance(bReq())).text()).includes('SECRET')));
 assert.deepEqual(engine.usageSample('openrouter',good().usage),{input:100,output:50,reasoning:20,visible:30});
 const estimate=engine.estimate({provider:'openrouter',model:'openai/gpt-6-luna',prompt:'Classify',effort:'medium'},[{tokens:{low:100,high:200}}]);assert(estimate.total.high>0);assert.equal(estimate.batch,undefined);
 const backup=load('lib/study-backup.ts'),encoded=await backup.encodeStudyBackup({name:'OpenRouter study',createdAt:new Date().toISOString(),texts:{provider:'openrouter',model:'openai/gpt-6-luna',apiKey:key,docs:[]},knowledge:{items:[]}});assert(!encoded.includes(key));assert.equal(backup.decodeStudyBackup(encoded).texts.provider,'openrouter');
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{ProviderKeyStatus}=load('components/provider-key-status.tsx');
 for(const remaining of [5,0]){const html=renderToStaticMarkup(React.createElement(ProviderKeyStatus,{value:{empty:false,check:{status:'accepted',balance:{limit:5,remaining,used:5-remaining,reset:null,checkedAt:'2026-10-31T12:00:00Z'}},refresh:()=>{},pauseAllowance:false}}));assert(html.includes('$'+remaining.toFixed(2)+' remaining'));assert(html.includes('No automatic reset'));assert(!html.includes(key));}
 console.log('PASS: OpenRouter routing, all six models, knowledge mode, named answers, whole PDF forwarding, refusal/truncation, allowance errors, credential isolation, balance privacy, estimates, and study round-trip. All API traffic mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
