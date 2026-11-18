// Prompt caching (research mode): the option marks the prompt for the provider's cache, where the provider
// caches at a mark (Anthropic, OpenAI, and their models through OpenRouter); Gemini caches by itself. Without
// the option every request is the standard Lab's. Cached tokens are priced where the Lab lists a rate, the
// estimate allows for cache writes and reads, and the setting is recorded on every result. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=async()=>Response.json({});
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+(fs.existsSync(path.resolve(path.dirname(filename),id+'.tsx'))?'.tsx':'.ts')))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-12,`${message||'amount'}: ${actual} is not ${expected}`);

(async()=>{
 const rs=load('lib/request-settings.ts'),route=load('app/api/annotate/route.ts'),batchRoute=load('app/api/batch/route.ts'),batch=load('lib/batch-provider.ts'),cost=load('lib/cost-estimate/run-cost.ts'),pricing=load('lib/cost-estimate/pricing.ts'),engine=load('lib/cost-estimate/engine.ts'),notes=load('lib/cache-note.ts'),backup=load('lib/study-backup.ts'),runs=load('lib/research/runs.ts'),exporting=load('lib/research/export.ts'),safety=load('lib/workflow-safety.ts'),providers=load('lib/providers.ts');
 assert(!/\bimport\b/.test(fs.readFileSync(path.join(root,'lib/request-settings.ts'),'utf8').replace(/\/\/.*$/gm,'')),'The request settings import nothing, so any module may use them');

 // --- The setting ------------------------------------------------------------------------
 assert.deepEqual(rs.cleanRequestSettings({cache:true,other:1}),{cache:true});
 for(const none of [undefined,null,'cache',{},{cache:false},{cache:'true'},[true]])assert.equal(rs.cleanRequestSettings(none),undefined);
 assert.equal(rs.readRequestSettings(null),undefined,'A request without the setting is the standard Lab’s');
 assert.deepEqual(rs.readRequestSettings('{"cache":true}'),{cache:true});
 for(const bad of ['{','{}','true','{"cache":false}','{"cache":true,"ttl":"1h"}','null'])assert.throws(()=>rs.readRequestSettings(bad),/request settings/,bad);

 // --- How each provider caches -----------------------------------------------------------
 assert.deepEqual(rs.cacheSupport('anthropic','claude-sonnet-5-5'),{kind:'marked',vendor:'anthropic',minTokens:512,write:1.25,batchWrite:2});
 assert.equal(rs.cacheSupport('anthropic','claude-haiku-4-5-20251001').minTokens,4096);assert.equal(rs.cacheSupport('anthropic','claude-haiku-5-5').minTokens,512);
 assert.deepEqual(rs.cacheSupport('openai','gpt-6-luna'),{kind:'marked',vendor:'openai',minTokens:1024,write:1.25,batchWrite:1.25});
 assert.deepEqual(rs.cacheSupport('gemini','gemini-3.8-flash'),{kind:'automatic',vendor:'gemini',minTokens:4096});
 assert.deepEqual(rs.cacheSupport('gemini','gemini-3.1-flash-lite'),{kind:'automatic',vendor:'gemini'},'No minimum is claimed where the provider documents none');
 assert.equal(rs.cacheSupport('openrouter','anthropic/claude-haiku-5.5').vendor,'anthropic');assert.equal(rs.cacheSupport('openrouter','openai/gpt-6-luna').vendor,'openai');assert.equal(rs.cacheSupport('openrouter','google/gemini-4-hydrogen').kind,'automatic');
 assert.equal(rs.cacheSupport('openrouter','other/model'),undefined);
 for(const [provider,spec] of Object.entries(providers.PROVIDERS))for(const model of spec.models)assert(rs.cacheSupport(provider,model),`${provider} ${model}: the Lab knows how every listed model caches`);
 assert.deepEqual(rs.sentRequestSettings('anthropic','claude-sonnet-5-5',{cache:true}),{cache:true});
 assert.equal(rs.sentRequestSettings('gemini','gemini-3.8-flash',{cache:true}),undefined,'Nothing is sent or recorded where the provider caches by itself');
 assert.equal(rs.sentRequestSettings('openai','gpt-6-luna',undefined),undefined);

 // --- What each provider receives --------------------------------------------------------
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:['anthropic/claude-haiku-5.5','medium']};
 const answer=JSON.stringify({explanation:'Because.',score:'A'});
 const reply=provider=>provider==='openai'?{status:'completed',id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text:answer}]}]}:provider==='anthropic'?{stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:900},content:[{type:'text',text:answer}]}:provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text:answer}]}}],usageMetadata:{totalTokenCount:12}}:{id:'test-response',choices:[{finish_reason:'stop',message:{content:answer}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}};
 const PROMPT='Classify the tone of the text.';
 function request(provider,setting,model=models[provider][0],knowledge=false){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model,effort:models[provider][1],prompt:PROMPT,answerFields:'[]'}))form.set(k,v);
  if(setting!==undefined)form.set('requestSettings',typeof setting==='string'?setting:JSON.stringify(setting));
  if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify([{heading:'Film',value:'Jaws'}]));}else form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 async function sent(provider,setting,model,knowledge){calls=[];mock=async()=>Response.json(reply(provider));const response=await route.POST(request(provider,setting,model,knowledge));assert.equal(response.status,200,provider);assert.equal(calls.length,1);return {body:JSON.parse(calls[0].options.body),out:await response.json()};}
 // The request with the mark removed again: it must be the standard request, to the letter. The mark divides the
 // message with the text: the prompt with the opening <text> tag, which every text shares, and the rest.
 const joined=content=>({type:content[0].type,text:content.map(part=>part.text).join('')});
 const unmarked={
  openai:body=>{const content=body.input[0].content;assert.deepEqual(Object.keys(content[0]).sort(),['prompt_cache_breakpoint','text','type']);return {...body,input:[{role:'user',content:[joined(content)]}]};},
  anthropic:body=>({...body,messages:[{role:'user',content:[joined(body.messages[0].content)]}]}),
  openrouter:body=>({...body,messages:[{role:'user',content:body.messages[0].content.map(part=>part.text).join('')}]}),
 };
 for(const provider of Object.keys(models)){
  const off=(await sent(provider)).body,on=(await sent(provider,{cache:true})).body;
  if(provider==='gemini'){assert.deepEqual(on,off,'Gemini caches by itself: the request is unchanged');continue;}
  assert.notDeepEqual(on,off,provider);assert.deepEqual(unmarked[provider](on),off,provider+': only the mark differs');
 }
 let body=(await sent('openai')).body;
 assert.equal(body.instructions,undefined,'No system prompt');assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});assert(!JSON.stringify(body).includes('prompt_cache_breakpoint'),'Without the option OpenAI caching stays off: explicit mode, no mark');
 body=(await sent('openai',{cache:true})).body;
 assert(!('instructions' in body));assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});
 assert.equal(body.input.length,1);assert.equal(body.input[0].role,'user');
 let [shared,own]=body.input[0].content;
 assert.deepEqual(shared,{type:'input_text',text:shared.text,prompt_cache_breakpoint:{mode:'explicit'}});
 assert(shared.text.startsWith(PROMPT)&&shared.text.endsWith('\n\n<text>\n'),'The marked part is the prompt with its answer instructions and the opening tag');
 assert.deepEqual(own,{type:'input_text',text:'A document.\n</text>'},'The text is never marked');
 body=(await sent('anthropic')).body;assert.equal(body.system,undefined);assert(!JSON.stringify(body).includes('cache_control'));
 let anthropic=await sent('anthropic',{cache:true});body=anthropic.body;[shared,own]=body.messages[0].content;
 assert.deepEqual(shared,{type:'text',text:shared.text,cache_control:{type:'ephemeral'}},'Five-minute entry for texts sent now');assert(shared.text.startsWith(PROMPT)&&shared.text.endsWith('\n\n<text>\n'));
 assert.deepEqual(own,{type:'text',text:'A document.\n</text>'});assert.equal(anthropic.out.usage.cache_read_input_tokens,900,'The usage a result keeps names the cached tokens');assert.equal(anthropic.out.tokens,912);
 body=(await sent('anthropic',{cache:true},undefined,true)).body;[shared]=body.messages[0].content;assert.equal(shared.cache_control.type,'ephemeral','Model knowledge requests are marked the same way');assert(shared.text.startsWith(PROMPT)&&shared.text.endsWith('\n\n<entry>\n'));
 body=(await sent('openrouter',{cache:true})).body;assert.equal(body.messages.length,1);assert.deepEqual(body.messages[0].content[0],{type:'text',text:body.messages[0].content[0].text,cache_control:{type:'ephemeral'}});assert(!('prompt_cache_options' in body));
 body=(await sent('openrouter',{cache:true},'openai/gpt-6-luna')).body;assert.deepEqual(body.messages[0].content[0],{type:'text',text:body.messages[0].content[0].text,prompt_cache_breakpoint:{mode:'explicit'}});assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});
 body=(await sent('openrouter',undefined,'openai/gpt-6-luna')).body;assert.equal(typeof body.messages[0].content,'string');assert.deepEqual(body.prompt_cache_options,{mode:'explicit'});
 const google=(await sent('openrouter',{cache:true},'google/gemini-3.1-flash-lite')).body;assert.equal(typeof google.messages[0].content,'string','A Gemini model through OpenRouter gets no mark');
 for(const provider of Object.keys(models))for(const bad of ['{','{"cache":false}','{"cache":true,"x":1}']){calls=[];assert.equal((await route.POST(request(provider,bad))).status,400,provider+' '+bad);assert.equal(calls.length,0,'Nothing is sent with an unreadable setting');}

 // --- Batches ------------------------------------------------------------------------------
 const file=()=>new File(['Text'],'text.txt');
 for(const provider of ['openai','anthropic','gemini']){
  const off=await batch.buildBatchBody(provider,file(),PROMPT,...models[provider],false,false,[]),on=await batch.buildBatchBody(provider,file(),PROMPT,...models[provider],false,false,[],undefined,{cache:true});
  if(provider==='gemini'){assert.deepEqual(on,off);continue;}
  if(provider==='anthropic'){assert.deepEqual(on.messages[0].content[0].cache_control,{type:'ephemeral',ttl:'1h'},'One-hour entry in a batch, whose requests may start far apart');assert.deepEqual(unmarked.anthropic(on),off);}
  else{assert.deepEqual(on.input[0].content[0].prompt_cache_breakpoint,{mode:'explicit'});assert.deepEqual(unmarked.openai(on),off);assert.deepEqual(on.prompt_cache_options,{mode:'explicit'});}
 }
 const batchRequest=(provider,extra={})=>{const f=new FormData();for(const [k,v]of Object.entries({provider,action:'submit',model:models[provider][0],effort:models[provider][1],prompt:PROMPT,runId:'lab_test',ids:JSON.stringify(['lab_test_0']),answerFields:'[]',...extra}))f.set(k,v);f.append('files',new File(['one'],'one.txt'));return new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'provider-test')},body:f});};
 for(const provider of ['openai','anthropic']){
  mock=async url=>Response.json(url.endsWith('/files')?{id:'file-test'}:provider==='openai'?{id:'batch_test'}:{id:'msgbatch_test'});
  const uploaded=async()=>provider==='openai'?await calls[0].options.body.get('file').text():calls.at(-1).options.body instanceof Blob?await calls.at(-1).options.body.text():calls.at(-1).options.body;
  calls=[];assert.equal((await batchRoute.POST(batchRequest(provider,{requestSettings:'{"cache":true}'}))).status,200,provider);
  assert((await uploaded()).includes(provider==='openai'?'"prompt_cache_breakpoint":{"mode":"explicit"}':'"cache_control":{"type":"ephemeral","ttl":"1h"}'),provider+': the submitted batch carries the mark');
  calls=[];assert.equal((await batchRoute.POST(batchRequest(provider))).status,200);assert(!/prompt_cache_breakpoint|cache_control/.test(await uploaded()),provider+': no mark without the option');
  calls=[];assert.equal((await batchRoute.POST(batchRequest(provider,{requestSettings:'{"cache":"yes"}'}))).status,400);assert.equal(calls.length,0);
 }
 assert.equal(batch.parseBatchAnnotation('anthropic',{stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2,cache_read_input_tokens:800,cache_creation_input_tokens:100},content:[{type:'text',text:answer}]}).tokens,912,'A batch result counts its cached input tokens');

 // --- What cached tokens cost ---------------------------------------------------------------
 const charge=row=>cost.recordedCost({status:'done',...row});
 const luna={provider:'openai',model:'gpt-6-luna'},usage=(details,extra={})=>({input_tokens:1000,output_tokens:100,input_tokens_details:details,...extra});
 near(charge({...luna,usage:usage({})}).amount,.00015,'no cache');
 near(charge({...luna,usage:usage({cached_tokens:500})}).amount,(500*.1+500*.1*.1+100*.5)/1e6,'OpenAI read');
 near(charge({...luna,usage:usage({cache_write_tokens:400})}).amount,(600*.1+400*.1*1.25+100*.5)/1e6,'OpenAI write');
 near(charge({...luna,processing:'batch',usage:usage({cached_tokens:500,cache_write_tokens:100})}).amount,(400*.1+500*.1*.1+100*.1*1.25+100*.5)/2e6,'The batch discount applies to cached tokens too');
 assert.equal(charge({provider:'openai',model:'gpt-6-sol',usage:usage({cached_tokens:500})}),undefined,'No listed cache rate: the cost stays unknown');assert(charge({provider:'openai',model:'gpt-6-sol',usage:usage({})}));
 assert.equal(charge({...luna,usage:usage({cached_tokens:1500})}),undefined,'More cached than input tokens is not priced');
 const sonnet={provider:'anthropic',model:'claude-sonnet-5-5'};
 near(charge({...sonnet,usage:{input_tokens:100,cache_read_input_tokens:900,output_tokens:50}}).amount,(100*2+900*2*.05+50*10)/1e6,'Anthropic read');
 near(charge({...sonnet,usage:{input_tokens:100,cache_creation_input_tokens:900,output_tokens:50}}).amount,(100*2+900*2*1.25+50*10)/1e6,'Anthropic five-minute write');
 near(charge({...sonnet,usage:{input_tokens:100,cache_creation_input_tokens:900,cache_creation:{ephemeral_5m_input_tokens:300,ephemeral_1h_input_tokens:600},output_tokens:50}}).amount,(100*2+300*2*1.25+600*2*2+50*10)/1e6,'Anthropic one-hour write');
 near(charge({...sonnet,processing:'batch',usage:{input_tokens:100,cache_creation_input_tokens:900,output_tokens:50}}).amount,(100*2+900*2*2+50*10)/2e6,'A batch writes the one-hour entry');
 near(charge({provider:'anthropic',model:'claude-fable-5-2',usage:{input_tokens:0,cache_read_input_tokens:1000,output_tokens:0}}).amount,1000*8*.025/1e6);
 near(charge({provider:'anthropic',model:'claude-haiku-5-5',usage:{input_tokens:100000,cache_read_input_tokens:100000,output_tokens:0}}).amount,(100000*.5+100000*.5*.1)/1e6,'The long-context price applies to cached tokens as well');
 const lite={provider:'gemini',model:'gemini-3.1-flash-lite'},metadata={promptTokenCount:1000,cachedContentTokenCount:800,candidatesTokenCount:100};
 near(charge({...lite,usage:metadata}).amount,(200*.25+800*.25*.1+100*1.5)/1e6,'Gemini read');near(charge({...lite,processing:'batch',usage:metadata}).amount,(200*.25+800*.25*.1+100*1.5)/2e6);
 near(charge({provider:'gemini',model:'gemini-2.5-flash-lite',processing:'batch',usage:metadata}).amount,(200*.1*.5+800*.1*.1+100*.4*.5)/1e6,'A batch rate of its own where the provider lists one');
 near(charge({provider:'gemini',model:'gemini-4-argon',time:'2026-12-02T10:00:00Z',usage:metadata}).amount,(200*4+800*4*.05+100*20)/1e6,'The share follows a price change');
 assert.equal(charge({provider:'gemini',model:'gemini-4-hydrogen',usage:metadata}),undefined);
 const routed={provider:'openrouter',model:'openai/gpt-6-luna'};
 assert.equal(charge({...routed,usage:{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:500}}}),undefined);assert.deepEqual(charge({...routed,usage:{cost:.01,prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:500}}}),{amount:.01,reported:true});
 for(const [model,price] of Object.entries(pricing.PRICES)){
  assert(price.cacheRead===undefined||price.cacheRead>0&&price.cacheRead<1,model);assert(price.cacheReadBatch===undefined||price.cacheRead!==undefined,model);
  if(price.provider==='anthropic')assert(price.cacheRead,model+': every Claude model has a cache rate');if(price.provider==='openrouter')assert.equal(price.cacheRead,undefined,model+': OpenRouter reports its own charge');
 }
 assert.deepEqual(cost.cacheTokens('anthropic',{cache_read_input_tokens:5,cache_creation_input_tokens:7}),{read:5,write:7,hourWrite:0});assert.deepEqual(cost.cacheTokens('openai',undefined),{read:0,write:0,hourWrite:0});
 const run=cost.latestRunCost([{status:'done',runId:'r',runStartedAt:'2026-11-16T10:00:00Z',...sonnet,usage:{input_tokens:100,cache_creation_input_tokens:900,output_tokens:50}},{status:'done',runId:'r',runStartedAt:'2026-11-16T10:00:00Z',...sonnet,usage:{input_tokens:100,cache_read_input_tokens:900,output_tokens:50}}]);
 assert.equal(run.cacheRead,900);assert.equal(run.cacheWrite,900);assert.equal(run.known,2);
 const React=req('react'),{renderToStaticMarkup}=req('react-dom/server'),{RunCostSummary}=load('lib/cost-estimate/run-cost-summary.tsx');
 const summary=research=>renderToStaticMarkup(React.createElement(RunCostSummary,{research,rows:[{status:'done',runId:'r',runStartedAt:'2026-11-16T10:00:00Z',...sonnet,usage:{input_tokens:100,cache_read_input_tokens:1900,output_tokens:50}}]}));
 assert.match(summary(true),/Prompt cache: 1,900 input tokens read, 0 written\./);assert(!summary(false).includes('Prompt cache:'),'The standard Lab shows no cache line');

 // --- The estimate --------------------------------------------------------------------------
 const long='Score the speech on each dimension of the rubric. '.repeat(200),config={provider:'openai',model:'gpt-6-luna',prompt:long,effort:'none',maxTokens:12000,defaultExplanation:true};
 const inputs=Array.from({length:40},()=>({tokens:engine.textTokens('A representative speech. '.repeat(100))})),base=engine.estimate(config,inputs),on=engine.estimate({...config,cache:true},inputs);
 const size=engine.textTokens('\n'+long),rate=.1/1e6;
 near(on.inputCost.low,base.inputCost.low+size.low*rate*.25+39*size.low*rate*(.1-1),'Lower edge: one write, then reads');
 near(on.inputCost.high,base.inputCost.high+40*size.high*rate*.25,'Upper edge: a write for every text, no reads');
 assert(on.total.low<base.total.low&&on.total.high>base.total.high);assert.deepEqual(on.input,base.input,'Token counts are unchanged');assert.equal(on.visibleCost.high,base.visibleCost.high);
 assert(on.notes.some(n=>n.startsWith('Prompt caching is on. The lower estimate assumes')));assert(!on.notes.includes('No cache savings are assumed.'));assert(base.notes.includes('No cache savings are assumed.'));
 near(engine.estimate({...config,cache:true},inputs.slice(0,1)).inputCost.low,engine.estimate(config,inputs.slice(0,1)).inputCost.low+size.low*rate*.25,'One text only writes');
 const brief=engine.estimate({...config,prompt:PROMPT,cache:true},inputs);assert.deepEqual(brief.total,engine.estimate({...config,prompt:PROMPT},inputs).total,'A prompt under the minimum is not cached');assert(brief.notes.some(n=>/shorter than the 1,024 tokens this model caches from, so nothing is cached/.test(n)));
 const gemini={...config,provider:'gemini',model:'gemini-3.8-flash'};assert.deepEqual(engine.estimate({...gemini,cache:true},inputs).total,engine.estimate(gemini,inputs).total,'Nothing is assumed where the provider caches by itself');
 const unlisted={...config,model:'gpt-6-sol'},unlistedOn=engine.estimate({...unlisted,cache:true},inputs);assert.equal(unlistedOn.total.low,engine.estimate(unlisted,inputs).total.low);assert(unlistedOn.total.high>engine.estimate(unlisted,inputs).total.high);assert(unlistedOn.notes.some(n=>n.includes('lists no cache rate')));
 const claude={...config,provider:'anthropic',model:'claude-sonnet-5-5'},claudeBase=engine.estimate(claude,inputs),claudeSize=engine.textTokens('\n'+long,1.3);
 near(engine.estimate({...claude,cache:true},inputs).inputCost.high,claudeBase.inputCost.high+40*claudeSize.high*2/1e6*.25);
 const inBatch=engine.estimate({...claude,cache:true,batch:true},inputs);near(inBatch.inputCost.high,claudeBase.inputCost.high+40*claudeSize.high*2/1e6,'A batch writes the one-hour entry at twice the input price');near(inBatch.batch.high,inBatch.total.high/2);assert(inBatch.notes.some(n=>n.includes('In a batch, requests can start together')));
 const edge=engine.estimate({...claude,prompt:'Rate the speech on the rubric below. '.repeat(45),cache:true},inputs);assert(edge.notes.some(n=>n.startsWith('The prompt is close to the shortest this model caches (512 tokens).')));
 for(const [model,p] of Object.entries(pricing.PRICES)){const e=engine.estimate({...config,provider:p.provider,model,cache:true},inputs);assert(Number.isFinite(e.total.high)&&e.total.low>0&&e.total.high>=e.total.low,model);}

 // --- The note beside the option ------------------------------------------------------------
 assert.deepEqual(notes.cacheNote('anthropic','claude-sonnet-5-5',''),{available:true,text:'Anthropic stores the prompt for 5 minutes; later texts read it at 5% of the input price, and storing it costs 25% extra. Prompts under 512 tokens are not cached.',about:'Anthropic stores the prompt for 5 minutes; later texts read it at 5% of the input price, and storing it costs 25% extra. Prompts under 512 tokens are not cached.',size:'Cached from 512 tokens.'});
 assert.equal(notes.cacheNote('anthropic','claude-fable-5-2','').text.includes('at 2.5% of the input price'),true);
 const openaiNote=notes.cacheNote('openai','gpt-6-luna',long).text;
 assert(openaiNote.startsWith('OpenAI stores the prompt for 30 minutes; later texts read it at 10% of the input price, and storing it costs 25% extra. Prompts under 1,024 tokens are not cached. This prompt: about '));assert(openaiNote.endsWith(' tokens.'));
 assert.equal(notes.cacheNote('openai','gpt-6-sol','').text,'OpenAI stores the prompt for 30 minutes; later texts read it at a lower price, and storing it costs 25% extra. Prompts under 1,024 tokens are not cached.');
 assert.deepEqual(notes.cacheNote('gemini','gemini-3.8-flash',long),{available:false,text:'Gemini caches repeated prompts by itself, from 4,096 tokens on this model. There is nothing to switch on or off.'});
 assert.equal(notes.cacheNote('gemini','gemini-3.1-flash-lite',long).text,'Gemini caches repeated prompts by itself. There is nothing to switch on or off.');
 assert.equal(notes.cacheNote('openrouter','anthropic/claude-haiku-5.5','').text,'Anthropic stores the prompt for 5 minutes; later texts read it at a lower price, and storing it costs 25% extra. Prompts under 512 tokens are not cached.');
 assert.equal(notes.cacheNote('openrouter','google/gemini-4-hydrogen','').available,false);

 // --- What a study keeps ----------------------------------------------------------------------
 assert(runs.RESULT_KEYS.includes('requestSettings'),'Clearing results clears the record of the setting');
 const retried=safety.queueRetries([{id:'a',status:'error',error:'x',requestSettings:{cache:true}}])[0];assert.equal(retried.requestSettings,undefined);assert.deepEqual(retried.history[0].requestSettings,{cache:true});
 const setup={provider:'anthropic',model:'claude-sonnet-5-5',effort:'medium',prompt:PROMPT,answerFields:[]};
 assert(runs.sameSetup(setup,{...setup}),'The setting is not part of what makes a run');
 const result={status:'done',...setup,score:'A',explanation:'Because.',runNo:1,time:'2026-11-16T10:00:00Z'};
 const study={name:'Cached',createdAt:'2026-11-16T12:00:00Z',texts:{answerFields:[],prompt:PROMPT,requestSettings:{cache:true},runs:[{...setup,number:1,startedAt:'2026-11-16T10:00:00Z'}],batchJob:{runId:'lab_x',provider:'anthropic',model:setup.model,prompt:PROMPT,effort:'medium',docIds:['b'],createdAt:'2026-11-16T10:00:00Z',state:'processing',requestSettings:{cache:true}},docs:[{id:'a',name:'a.txt',file:new File(['Text'],'a.txt'),...result,requestSettings:{cache:true},history:[{status:'error',requestSettings:{cache:true}}]},{id:'b',name:'b.txt',file:new File(['Text'],'b.txt'),status:'queued'}]},knowledge:{answerFields:[],items:[]}};
 const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup(study));
 assert.deepEqual(restored.texts.requestSettings,{cache:true});assert.deepEqual(restored.texts.docs[0].requestSettings,{cache:true});assert.deepEqual(restored.texts.docs[0].history[0].requestSettings,{cache:true});assert.deepEqual(restored.texts.batchJob.requestSettings,{cache:true});assert.equal(restored.texts.docs[1].requestSettings,undefined);
 await assert.rejects(async()=>backup.decodeStudyBackup(await backup.encodeStudyBackup({...study,texts:{...study.texts,requestSettings:{cache:'yes'}}})),'A backup with an unreadable setting is refused');

 // --- Runs and exports ------------------------------------------------------------------------
 const rows=[{id:'a',name:'a.txt',...result,requestSettings:{cache:true}},{id:'b',name:'b.txt',...result,requestSettings:{cache:true}},{id:'c',name:'c.txt',...result,runNo:2,model:'claude-haiku-5-5'},{id:'d',name:'d.txt',...result,runNo:3,model:'claude-opus-5-5',requestSettings:{cache:true}},{id:'e',name:'e.txt',...result,runNo:3,model:'claude-opus-5-5'}];
 const dataset={kind:'texts',rows,runs:[{...setup,number:1,startedAt:'2026-11-16T10:00:00Z'},{...setup,model:'claude-haiku-5-5',number:2,startedAt:'2026-11-16T11:00:00Z'},{...setup,model:'claude-opus-5-5',number:3,startedAt:'2026-11-16T12:00:00Z'}],columns:[],samples:[]};
 assert.deepEqual(exporting.runLines(dataset).map(line=>line.caching),['on','off','in part']);
 const tables=load('lib/research/export-tables.ts'),exported={name:'Cached',dataset,lab:'test'},table=tables.runsOverview(exported,new Map()),at=table[0].indexOf('caching');assert(at>0,'The column is named caching');assert.deepEqual(table.slice(1).map(line=>line[at]),['on','off','in part']);
 assert(!tables.requestsTable(exported,undefined,new Map())[0].includes('prompt_caching'),'The table of requests has no caching column: runs.csv has it for each run');

 // The Excel workbook's settings sheet names the option only where a result was made with it.
 const ExcelJS=req('exceljs'),settingsOf=async docs=>{const book=new ExcelJS.Workbook();await book.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook(docs,{prompt:PROMPT,model:setup.model,effort:'medium',provider:'anthropic'}));const lines=[];book.getWorksheet('Study settings').eachRow(row=>lines.push(String(row.getCell(1).value)+'='+String(row.getCell(2).value)));return lines;};
 const plainSheet=await settingsOf([{name:'a.txt',...result,processing:'instant',concurrency:1}]);assert(!plainSheet.some(line=>line.startsWith('Prompt caching')),'An export without the option is the one it was');
 assert((await settingsOf([{name:'a.txt',...result,processing:'instant',concurrency:1,requestSettings:{cache:true}}])).includes('Prompt caching=On'));
 const mixedSheet=await settingsOf([{name:'a.txt',...result,processing:'instant',concurrency:1,requestSettings:{cache:true}},{name:'b.txt',...result,processing:'instant',concurrency:1}]);
 assert.equal(mixedSheet.filter(line=>line==='Prompt caching=On').length,1,'Results with and without the option are listed as two groups of settings');

 // --- The page: only research mode sends the setting -------------------------------------------
 for(const page of ['app/page.tsx','components/model-knowledge.tsx']){
  const source=fs.readFileSync(path.join(root,page),'utf8');
  assert(/const sentRequest=research\?sentRequestSettings\(provider,model,[^;]*requestSettings,effort\):undefined;/.test(source),page+': the standard Lab never sends or records the setting');
  assert.equal(source.split("form.set('requestSettings'").length-1,2,page+': texts sent now and in a batch');assert.equal(source.split("if(sentRequest)form.set('requestSettings',JSON.stringify(sentRequest));").length-1,2,page);
  // (The recorded request of a run takes the settings the run is sent with: those of the run that "Retry failed" sends again.)
  assert.equal(source.split(/requestSettings:(?:use\.)?sentRequest\b/).length-1,5,page+': every started result, the batch, the recorded request, and the preview hold what is sent');
  assert(source.includes('{research&&<ResearchRequestOptions '),page+': the option is shown in research mode only');
 }

 console.log('PASS: prompt caching: the setting, each provider’s request with and without it (instant and batch), prices of cached tokens, the estimate, the note, backups, runs, and exports. No provider was called.');
})().catch(error=>{console.error(error);process.exit(1);});
