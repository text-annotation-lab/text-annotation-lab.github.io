// Research mode: a text whose request fails is marked and the run carries on; the run stops by itself only when
// its first requests all failed in a way every request would meet. Checked here: which failures count as such,
// the rule, what the annotate route tells the page, and the notices. (The runs themselves: research-mode.cjs and
// model-knowledge.cjs.) All provider traffic is mocked. No paid requests or real keys are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
let calls=[],mock=async()=>Response.json({});
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}

(async()=>{
 const errors=load('lib/provider-errors.ts'),early=load('lib/research/early-stop.ts'),route=load('app/api/annotate/route.ts'),providers=load('lib/providers.ts');
 const {sharedFailure,providerFailure,connectionFailure}=errors,{earlyStopper,takeShared,earlyStopNotice,carriedOnNotice}=early;
 const all=['openai','anthropic','gemini','openrouter'];
 assert.equal(connectionFailure,early.connectionFailure);

 // --- Which failures every request of a run would meet -------------------------------------
 for(const provider of all){
  // The key, the account, or the model.
  for(const status of [401,402,404])assert.equal(sharedFailure(provider,status,null),'account',`${provider} ${status}`);
  assert.equal(sharedFailure(provider,403,{error:{message:'Your project does not have access to this model.'}}),'account');
  for(const code of ['invalid_api_key','api_key_invalid','api_key_expired','authentication_error','insufficient_quota','billing_not_active','quota_exceeded','billing_error','credit_balance_exhausted','insufficient_credits','organization_spend_limit_exceeded'])
   for(const status of [400,403,429])assert.equal(sharedFailure(provider,status,{error:{code}}),'account',`${provider} ${status} ${code}`);
  assert.equal(sharedFailure(provider,400,{error:{type:'invalid_request_error',message:'Your credit balance is too low to access the API.'}}),'account');
  // A limit that cannot be waited out is the account's; a rate limit passes.
  assert.equal(sharedFailure(provider,429,{error:{code:'rate_limit_exceeded'}}),undefined);
  assert.equal(sharedFailure(provider,429,{error:{code:'rate_limit_exceeded'}},new Headers({'retry-after':'30'})),undefined);
  assert.equal(sharedFailure(provider,429,{error:{code:'rate_limit_exceeded'}},new Headers({'retry-after':'121'})),'account');
  assert.equal(sharedFailure(provider,429,{error:{message:'You exceeded the limit of requests per day.'}}),'account');
  // Server errors, timeouts, and an input that is too large say nothing about the other requests.
  for(const status of [408,413,422,500,502,503,504,529])assert.equal(sharedFailure(provider,status,{error:{message:'Something went wrong.'}}),undefined,`${provider} ${status}`);
  // HTTP 400 about one text: its size or its content.
  for(const message of ['This model’s maximum context length is 128000 tokens.','Your input exceeds the context window of this model.','prompt is too long: 210000 tokens > 200000 maximum','input length and max_tokens exceed context limit: 180000 + 32000 > 200000','The input token count (1100000) exceeds the maximum number of tokens allowed (1048576).','Too many tokens in the request.','Your input was flagged by our safety system.','This request violates our usage policies.','Blocked by the content filter.','A maximum of 100 PDF pages may be provided.'])
   assert.equal(sharedFailure(provider,400,{error:{message}}),undefined,`${provider}: ${message}`);
  for(const code of ['context_length_exceeded','request_too_large','input_too_long','invalid_prompt'])assert.equal(sharedFailure(provider,400,{error:{code,message:'Rejected.'}}),undefined,code);
  // A provider may refuse one text under its content rules with a 403.
  assert.equal(sharedFailure(provider,403,{error:{message:'Your chosen model requires moderation and your input was flagged.'}}),undefined);
  // Another HTTP 400: a mark that stands for its message. The same message gives the same mark, whatever IDs it carries.
  const mark=message=>sharedFailure(provider,400,{error:{type:'invalid_request_error',message}});
  const a=mark('Unsupported parameter: temperature is not supported with this model. Request ID req_011CabcDEF'),b=mark('Unsupported parameter: temperature is not supported with this model. Request ID req_999ZZZzzz'),c=mark('Unsupported parameter: temperature  is not supported with this model. (request id: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed)');
  assert.match(a,/^same:[0-9a-f]{8}$/);assert.equal(a,b);assert.equal(mark('Unsupported value 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed for x'),mark('Unsupported value 2c0e7cde-ccfe-4c3e-8c6e-bc9efcce5cfe for x'));
  assert.notEqual(a,mark('Invalid schema for response_format.'));assert.notEqual(a,mark(''));assert.match(sharedFailure(provider,400,null),/^same:[0-9a-f]{8}$/);
  void c;
  // The mark carries none of the provider's words, and neither does the reply.
  const secret={error:{code:'SECRET_CODE',message:'SECRET sk-userkey and a passage of the text'}},out=providerFailure(provider,400,secret);
  assert.deepEqual(Object.keys(out).sort(),['error','shared']);assert.match(out.shared,/^same:[0-9a-f]{8}$/);assert(!/secret|sk-userkey|passage/i.test(JSON.stringify(out)));
  assert.equal(providerFailure(provider,401,null).shared,'account');assert(!('shared' in providerFailure(provider,500,null)));assert(!('shared' in providerFailure(provider,429,{error:{code:'rate_limit_exceeded'}})));
 }
 // Gemini answers an invalid key with HTTP 400.
 assert.equal(sharedFailure('gemini',400,{error:{code:400,message:'API key not valid. Please pass a valid API key.',status:'INVALID_ARGUMENT',details:[{reason:'API_KEY_INVALID'}]}}),'account');
 // OpenRouter: its key's allowance, and what the provider behind it says (read from the wrapped error).
 assert.equal(sharedFailure('openrouter',403,{error:{code:403,message:'Key limit exceeded.',metadata:{limit_source:'openrouter_key_limit'}}}),'account');
 assert.equal(sharedFailure('openrouter',429,{error:{code:429,metadata:{limit_source:'openrouter_key_limit'}}}),'account');
 assert.equal(sharedFailure('openrouter',400,{error:{code:400,message:'Provider returned error',metadata:{provider_name:'Anthropic',raw:JSON.stringify({error:{type:'invalid_request_error',message:'prompt is too long: 210000 tokens > 200000 maximum'}})}}}),undefined);
 const wrapped=text=>sharedFailure('openrouter',400,{error:{code:400,message:'Provider returned error',metadata:{provider_name:'OpenAI',raw:JSON.stringify({error:{message:text}})}}});
 assert.match(wrapped('Unsupported parameter: temperature.'),/^same:/);assert.notEqual(wrapped('Unsupported parameter: temperature.'),wrapped('Unsupported parameter: reasoning.'));

 // No connection at all, as the browsers word it; not a timeout, a cancel, or anything else.
 for(const error of [new TypeError('Failed to fetch'),new TypeError('fetch failed'),new TypeError('NetworkError when attempting to fetch resource.'),new TypeError('Load failed'),new TypeError('Failed to fetch dynamically imported module: https://lab.test/assets/route.js'),new Error('Connection refused')])
  assert.deepEqual(connectionFailure(error),{shared:'connection'},error.message);
 for(const error of [new DOMException('The operation timed out.','TimeoutError'),new DOMException('The operation was aborted.','AbortError'),new Error('The request timed out'),new Error('Unexpected token < in JSON'),new TypeError('Cannot read properties of undefined'),null,undefined,'Failed to fetch',42])
  assert.deepEqual(connectionFailure(error),{},String(error));

 // --- The rule ----------------------------------------------------------------------------
 const run=(...answers)=>{const stop=earlyStopper();return answers.map(([text,shared])=>stop(text,shared));};
 // Three requests, at least two texts, all failed with a mark.
 assert.deepEqual(run(['a','account'],['b','account'],['c','account']),[undefined,undefined,{answered:3,connection:false}]);
 assert.deepEqual(run(['a','account'],['b','account']),[undefined,undefined],'Two are too few');
 assert.deepEqual(run(['a','account'],['a','account'],['b','account']).at(-1),{answered:3,connection:false});
 // The annotations of one text never stop a run; the next text does.
 assert.deepEqual(run(['a','account'],['a','account'],['a','account'],['a','account'],['b','account']),[undefined,undefined,undefined,undefined,{answered:5,connection:false}]);
 // A result, or a failure that may be about its text, among the requests so far: the run goes on, whatever follows.
 assert(run(['a'],...Array.from({length:20},(_,i)=>['t'+i,'account'])).every(stop=>stop===undefined));
 assert(run(['a','account'],['b'],...Array.from({length:20},(_,i)=>['t'+i,'account'])).every(stop=>stop===undefined));
 // HTTP 400s count only with one and the same message; they count together with the other marks.
 assert.deepEqual(run(['a','same:1'],['b','same:1'],['c','same:1']).at(-1),{answered:3,connection:false});
 assert(run(['a','same:1'],['b','same:2'],['c','same:1'],['d','same:2']).every(stop=>stop===undefined));
 assert.deepEqual(run(['a','account'],['b','same:1'],['c','account']).at(-1),{answered:3,connection:false});
 // The connection is named when any of them was a connection failure.
 assert.deepEqual(run(['a','connection'],['b','connection'],['c','connection']).at(-1),{answered:3,connection:true});
 assert.deepEqual(run(['a','account'],['b','connection'],['c','account']).at(-1),{answered:3,connection:true});
 // The stop is reported for every later request too (requests under way come back after it).
 assert.deepEqual(run(['a','account'],['b','account'],['c','account'],['d','account']).map(stop=>stop?.answered),[undefined,undefined,3,4]);

 // The mark is taken off the reply.
 const reply={error:'Failed.',shared:'account',retryAfterMs:0};assert.equal(takeShared(reply),'account');assert.deepEqual(reply,{error:'Failed.',retryAfterMs:0});
 for(const value of [null,undefined,'text',{},{shared:''},{shared:7},{shared:null}])assert.equal(takeShared(value),undefined);

 // --- What the annotate route tells the page ----------------------------------------------
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:[providers.defaultModel('openrouter'),'medium']};
 function request(provider,knowledge=false,webSearch=false){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model:models[provider][0],effort:models[provider][1],prompt:'Classify the tone of the text.',answerFields:'[]'}))form.set(k,v);
  if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify([{heading:'Film',value:'Jaws'}]));form.set('webSearch',String(webSearch));}else form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 const told=async(provider,knowledge,webSearch,reply)=>{calls=[];mock=reply;const response=await route.POST(request(provider,knowledge,webSearch));return {status:response.status,out:await response.json()};};
 for(const provider of all)for(const [knowledge,webSearch] of [[false,false],[true,false],...(provider==='openrouter'?[]:[[true,true]])]){
  const name=`${provider}${knowledge?' knowledge':''}${webSearch?' with web search':''}`;
  let {status,out}=await told(provider,knowledge,webSearch,async()=>Response.json({error:{code:'invalid_api_key',message:'Incorrect API key provided: sk-SECRET.'}},{status:401}));
  assert.equal(status,401,name);assert.equal(out.shared,'account',name);assert(!JSON.stringify(out).includes('SECRET'));
  ({status,out}=await told(provider,knowledge,webSearch,async()=>Response.json({error:{message:'Unsupported parameter SECRET.'}},{status:400})));
  assert.equal(status,400,name);assert.match(out.shared,/^same:[0-9a-f]{8}$/,name);assert(!JSON.stringify(out).includes('SECRET'));
  const again=await told(provider,knowledge,webSearch,async()=>Response.json({error:{message:'Unsupported parameter SECRET.'}},{status:400}));assert.equal(again.out.shared,out.shared,'The same failure gives the same mark');
  ({out}=await told(provider,knowledge,webSearch,async()=>Response.json({error:{code:'context_length_exceeded',message:'This model’s maximum context length is 128000 tokens.'}},{status:400})));
  assert(!('shared' in out),name+': a text that is too long is about that text');
  for(const failure of [500,503,413])({out}=await told(provider,knowledge,webSearch,async()=>Response.json({error:{message:'Failed.'}},{status:failure})),assert(!('shared' in out),`${name} ${failure}`));
  // No connection: no HTTP reply. A timeout is not one.
  ({status,out}=await told(provider,knowledge,webSearch,async()=>{throw new TypeError('Failed to fetch');}));
  assert.equal(status,502,name);assert.equal(out.shared,'connection',name);assert.equal(calls.length,1);
  ({status,out}=await told(provider,knowledge,webSearch,async()=>{throw new DOMException('The operation timed out.','TimeoutError');}));
  assert.equal(status,502,name);assert(!('shared' in out),name+': a timeout');
  // A reply that came back and is unusable says something about its text only.
  ({out}=await told(provider,knowledge,webSearch,async()=>new Response('not JSON',{status:200})));assert(!('shared' in out),name+': an unreadable reply');
 }
 // What the Lab itself refuses (here: a file it cannot send) carries no mark.
 {const form=new FormData();for(const [k,v]of Object.entries({provider:'openai',model:models.openai[0],effort:'medium',prompt:'Classify.',answerFields:'[]'}))form.set(k,v);form.set('file',new File([''],'empty.txt'));
  const response=await route.POST(new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer sk-test'},body:form}));assert.equal(response.status,400);assert(!('shared' in await response.json()));}

 // --- What the person is told -------------------------------------------------------------
 assert.equal(earlyStopNotice({answered:3,connection:false},'text'),'Stopped: the first 3 requests all failed the same way, which points to the settings or the account rather than the texts. Requests under way will finish, and completed results are kept. See the error of a failed text before running again.');
 assert.equal(earlyStopNotice({answered:5,connection:true},'subject'),'Stopped: the first 5 requests all failed the same way, which points to the connection rather than the subjects. Requests under way will finish, and completed results are kept. See the error of a failed subject before running again.');
 assert.equal(carriedOnNotice(1,1,'workspace'),'The request failed. “Remaining” sends it again.');
 assert.equal(carriedOnNotice(1,40,'workspace'),'1 of 40 requests failed, and the run carried on. “Remaining” sends it again.');
 assert.equal(carriedOnNotice(12,2400,'workspace'),'12 of 2,400 requests failed, and the run carried on. “Remaining” sends them again.');
 assert.equal(carriedOnNotice(3,3,'workspace'),'All 3 requests failed. “Remaining” sends them again.');
 assert.equal(carriedOnNotice(2,5,'workspace',true),'2 of 5 requests failed. “Remaining” sends them again.');
 assert.equal(carriedOnNotice(2,5,'knowledge'),'2 of 5 requests failed, and the run carried on. “Queue failed items for retry” makes them ready to run again.');
 assert.equal(carriedOnNotice(1,1,'knowledge'),'The request failed. “Queue failed items for retry” makes it ready to run again.');

 // --- Where it applies --------------------------------------------------------------------
 // Both modes carry on: both run loops make the rule in either mode, and the old stop at the first error is gone.
 for(const file of ['app/page.tsx','components/model-knowledge.tsx']){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert(source.includes('const early=earlyStopper();'),file);
  assert(!source.includes('Stopped starting new annotations after an error.'),file);
  assert(source.includes('back=true;shared=takeShared(sent.out);'),file+': the mark is taken off the reply before anything of it is kept');
  // The Lab's own messages are never read for a mark: only an error thrown before a reply came back is.
  assert(/early\((?:d|item)\.id,back\?shared:connectionFailure\((?:e|error)\)\.shared\)/.test(source),file);
 }
 // The small module the pages load holds no provider code.
 assert(!/import /.test(fs.readFileSync(path.join(root,'lib/research/early-stop.ts'),'utf8')));

 console.log('Carry on: shared failures told from failures of one text for four providers, the stop after three, the route’s marks, and the notices.');
})().catch(error=>{console.error(error);process.exit(1);});
