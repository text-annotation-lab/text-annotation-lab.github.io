// Research mode's model menu: any model of a provider by its ID, and the models on the account behind a key.
// The Lab's own lists stay as they are, and every request to a listed model is unchanged; a model outside the
// lists gets its settings from its family. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=async()=>Response.json({});
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+(fs.existsSync(path.resolve(path.dirname(filename),id+'.tsx'))?'.tsx':'.ts')))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url:String(url),options});return mock(String(url),options);});return exports;}
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

(async()=>{
 const providers=load('lib/providers.ts'),rs=load('lib/request-settings.ts'),frame=load('lib/request-frame.ts'),route=load('app/api/annotate/route.ts'),models=load('app/api/models/route.ts'),errors=load('lib/provider-errors.ts'),notes=load('lib/cache-note.ts'),safety=load('lib/workflow-safety.ts'),backup=load('lib/study-backup.ts'),estimate=load('lib/student-estimate.ts'),web=load('lib/knowledge-web.ts');
 const {PROVIDERS}=providers;

 // --- What counts as a model ID -------------------------------------------------------------------
 for(const [provider,id] of [['openai','gpt-6.1-sol-2026-10-01'],['openai','o3'],['openai','ft:gpt-4.1-mini-2025-04-14:lab::Abc123'],['anthropic','claude-opus-4-6'],['anthropic','claude-3-5-sonnet-20241022'],['gemini','gemini-3.7-flash'],['gemini','gemma-3-27b-it'],['openrouter','meta-llama/llama-3.3-70b-instruct:free'],['openrouter','qwen/qwen4-max'],['openrouter','~anthropic/claude-sonnet-latest']])assert(providers.validModelId(provider,id),provider+' '+id);
 for(const [provider,id] of [['openai',''],['openai','gpt 6'],['openai','gpt-6/../x'],['openai','claude-opus-5-5'],['openai','gemini-3.8-flash'],['openai','x'.repeat(129)],['openai',7],['anthropic','gpt-6-sol'],['anthropic','opus'],['gemini','gpt-6-luna'],['gemini','claude-opus-5-5'],['gemini','models/gemini-3.8-flash'],['gemini','gemini-3.8-flash?key=x'],['gemini','tuned:model'],['openrouter','gpt-6-luna'],['openrouter','openai/'],['openrouter','/gpt-6-luna'],['openrouter','openai/gpt 6']])assert(!providers.validModelId(provider,id),provider+' '+id);
 for(const provider of Object.keys(PROVIDERS))for(const model of PROVIDERS[provider].models){assert(providers.validModelId(provider,model),model);assert(providers.isListedModel(provider,model));}
 assert(!providers.isListedModel('openai','gpt-4.1'));

 // A saved model outside the lists is kept only when the study says it was chosen so.
 assert.equal(providers.selectedModel('openai','gpt-4.1'),'gpt-6-luna','Without the note, an unlisted model gives way to the default, as before');
 assert.equal(providers.selectedModel('openai','gpt-4.1',true),'gpt-4.1');
 assert.equal(providers.selectedModel('openai','claude-opus-5-5',true),'gpt-6-luna','Not another provider’s model');
 assert.equal(providers.selectedModel('gemini','gemini-2.5-flash'),providers.defaultModel('gemini'),'A model the Lab no longer lists still gives way');
 assert.equal(providers.selectedModel('anthropic','claude-opus-5-5',true),'claude-opus-5-5');

 // --- Families ------------------------------------------------------------------------------------
 for(const id of ['claude-haiku-4-5-20251001','claude-haiku-4-5','claude-sonnet-4-5-20250929','claude-opus-4-1-20250805','claude-sonnet-4-20250514','claude-opus-4-5','claude-3-7-sonnet-20250219','claude-3-5-haiku-latest','claude-3-haiku-20240307'])assert(rs.budgetedClaude(id),id);
 for(const id of ['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-2','claude-mythos-5-2','claude-opus-4-6','claude-sonnet-4-6','claude-opus-4-7','claude-opus-4-8','claude-opus-5','claude-sonnet-10','claude-newname-6'])assert(!rs.budgetedClaude(id),id);
 for(const id of ['gpt-6-luna','gpt-6.1-sol','gpt-5.6-terra','gpt-6.1-sol-2026-10-01','gpt-7','gpt-12-sol'])assert(rs.marksOpenAICache(id),id);
 for(const id of ['gpt-5.5','gpt-5','gpt-5.4-mini','gpt-4.1','gpt-4o','o3','o4-mini','chatgpt-4o-latest'])assert(!rs.marksOpenAICache(id),id);
 for(const id of ['gpt-4.1','gpt-4o-mini','gpt-3.5-turbo','chatgpt-4o-latest'])assert(rs.plainOpenAI(id),id);
 for(const id of ['gpt-5','gpt-6-luna','o3'])assert(!rs.plainOpenAI(id),id);
 // Every listed model falls where it always did.
 for(const model of PROVIDERS.anthropic.models)assert.equal(rs.budgetedClaude(model),model.startsWith('claude-haiku-4-5'),model);
 for(const model of PROVIDERS.openai.models){assert(rs.marksOpenAICache(model),model);assert(!rs.plainOpenAI(model),model);}
 for(const model of PROVIDERS.openrouter.models.filter(model=>model.startsWith('openai/')))assert(rs.marksOpenAICache(model.slice(7)),model);

 // --- Reasoning settings of a model outside the lists -----------------------------------------------
 const all=['default','none','minimal','low','medium','high','xhigh','max'];
 assert.deepEqual(providers.reasoningOptions('openai','gpt-5.5'),all);assert.equal(providers.defaultEffort('openai','gpt-5.5'),'medium');
 assert.deepEqual(providers.reasoningOptions('openai','gpt-4.1'),['default']);assert.equal(providers.defaultEffort('openai','gpt-4.1'),'default');
 assert.deepEqual(providers.reasoningOptions('anthropic','claude-opus-4-6'),['low','medium','high','xhigh','max']);assert.equal(providers.defaultEffort('anthropic','claude-opus-4-6'),'high');
 assert.deepEqual(providers.reasoningOptions('anthropic','claude-sonnet-4-5-20250929'),['off','1024','4096','8192']);assert.equal(providers.defaultEffort('anthropic','claude-sonnet-4-5-20250929'),'off');
 assert.deepEqual(providers.reasoningOptions('gemini','gemini-3.7-flash'),['default','minimal','low','medium','high','xhigh']);assert.equal(providers.defaultEffort('gemini','gemini-3.7-flash'),'default');
 assert.deepEqual(providers.reasoningOptions('gemini','gemini-2.5-flash'),['off','dynamic','1024','4096','8192'],'Gemini 2.5 keeps its budgets');assert.equal(providers.defaultEffort('gemini','gemini-2.5-flash'),'dynamic');
 assert.deepEqual(providers.reasoningOptions('gemini','gemini-2.5-pro'),['dynamic','1024','4096','8192']);
 assert.deepEqual(providers.reasoningOptions('openrouter','qwen/qwen4-max'),all);assert.equal(providers.defaultEffort('openrouter','qwen/qwen4-max'),'default');
 for(const [provider,model] of [['openai','gpt-5.5'],['openai','gpt-4.1'],['anthropic','claude-opus-4-6'],['anthropic','claude-3-5-haiku-latest'],['gemini','gemini-3.7-flash'],['gemini','gemini-2.5-flash'],['openrouter','qwen/qwen4-max']])assert(providers.reasoningOptions(provider,model).includes(providers.defaultEffort(provider,model)),model);
 assert.equal(providers.reasoningOptionLabel('default'),'model default');
 // No listed model is offered "default".
 for(const provider of Object.keys(PROVIDERS))for(const model of PROVIDERS[provider].models)assert(!providers.reasoningOptions(provider,model).includes('default'),model);

 // What the provider's list says a model takes narrows the menu; the setting in use stays on offer.
 assert.deepEqual(providers.effortChoices('openrouter','qwen/qwen4-max',['none','low','high','xhigh']),['default','none','low','high','xhigh']);
 assert.deepEqual(providers.effortChoices('openrouter','mistralai/mistral-small',[]),['default'],'A model without reasoning');
 assert.deepEqual(providers.effortChoices('openrouter','qwen/qwen4-max',['high'],'medium'),['default','medium','high']);
 assert.deepEqual(providers.effortChoices('openrouter','qwen/qwen4-max',undefined),all,'Nothing known: every setting');
 assert.deepEqual(providers.effortChoices('anthropic','claude-sonnet-4-6',['low','medium','high','max']),['low','medium','high','max']);
 assert.deepEqual(providers.effortChoices('anthropic','claude-sonnet-4-5',[]),['off','1024','4096','8192'],'A budgeted model keeps its budgets');
 assert.deepEqual(providers.effortChoices('openai','gpt-6-luna',['low']),providers.reasoningOptions('openai','gpt-6-luna'),'A listed model keeps the Lab’s own settings');

 // --- Names -----------------------------------------------------------------------------------------
 assert.equal(providers.modelLabel('meta-llama/llama-3.3-70b-instruct'),'meta-llama/llama-3.3-70b-instruct','Not named after a vendor it does not come from');
 assert.equal(providers.modelLabel('openai/gpt-6-luna'),'OpenAI · GPT-6 Luna');assert.equal(providers.modelLabel('anthropic/claude-haiku-5.5'),'Anthropic · Claude Haiku 5.5');

 // --- Requests ----------------------------------------------------------------------------------------
 const doc={filename:'a.txt',text:'A document.'},body=(provider,model,effort,extra={})=>frame.providerBody({provider,model,effort,prompt:'P',schemaPrompt:'P',answerFields:[],...extra},doc);
 // OpenAI: "default" sends no reasoning setting; an earlier model takes no cache mode.
 let sent=body('openai','gpt-5.5','default');
 assert(!('reasoning' in sent));assert(!('prompt_cache_options' in sent));assert.equal(sent.instructions,'P');assert.equal(sent.model,'gpt-5.5');assert.equal(sent.max_output_tokens,12000);
 sent=body('openai','gpt-5.5','high');assert.deepEqual(sent.reasoning,{effort:'high'});
 sent=body('openai','gpt-5.5','default',{request:{summary:true}});assert.deepEqual(sent.reasoning,{summary:'auto'},'A summary can be asked for without naming an effort');
 sent=body('openai','gpt-4.1','default',{request:{summary:true,temperature:0.2,cache:true}});assert(!('reasoning' in sent),'No summary from a model without reasoning');assert.equal(sent.temperature,0.2);assert.equal(sent.instructions,'P','No cache mark for a model that caches by itself');assert(!('prompt_cache_options' in sent));
 sent=body('openai','gpt-6.1-sol-2026-10-01','medium',{request:{cache:true}});assert.deepEqual(sent.prompt_cache_options,{mode:'explicit'});assert.equal(sent.input[0].role,'developer','A dated snapshot of a current model caches at the mark');
 sent=body('openai','gpt-5.5','default',{batch:true});assert(!('reasoning' in sent)&&!('prompt_cache_options' in sent));
 // Claude: an earlier model reasons within a budget or not at all; a later one adaptively.
 sent=body('anthropic','claude-sonnet-4-5-20250929','off');assert.deepEqual(sent.thinking,{type:'disabled'});assert.deepEqual(Object.keys(sent.output_config),['format']);
 sent=body('anthropic','claude-sonnet-4-5-20250929','4096');assert.deepEqual(sent.thinking,{type:'enabled',budget_tokens:4096});
 sent=body('anthropic','claude-sonnet-4-5-20250929','off',{request:{temperature:0.4}});assert.equal(sent.temperature,0.4);
 sent=body('anthropic','claude-sonnet-4-5-20250929','4096',{request:{temperature:0.4,maxOutput:2000}});assert(!('temperature' in sent),'None while it reasons');assert.equal(sent.max_tokens,4097,'The limit stays above the budget');
 sent=body('anthropic','claude-opus-4-6','medium',{request:{summary:true,temperature:0.4}});assert.deepEqual(sent.thinking,{type:'adaptive',display:'summarized'});assert.equal(sent.output_config.effort,'medium');assert(!('temperature' in sent));
 // Gemini: "default" sends no thinking level.
 sent=body('gemini','gemini-3.7-flash','default');assert(!('thinkingConfig' in sent.generationConfig));
 sent=body('gemini','gemini-3.7-flash','default',{request:{summary:true}});assert.deepEqual(sent.generationConfig.thinkingConfig,{includeThoughts:true});
 sent=body('gemini','gemini-3.7-flash','low');assert.deepEqual(sent.generationConfig.thinkingConfig,{thinkingLevel:'LOW'});
 sent=body('gemini','gemini-2.5-flash','dynamic');assert.deepEqual(sent.generationConfig.thinkingConfig,{thinkingBudget:-1});
 assert.equal(frame.requestUrl('gemini','gemini-3.7-flash'),'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent');
 // OpenRouter: "default" sends no reasoning setting, so a model without one still finds a provider.
 sent=body('openrouter','mistralai/mistral-small','default');assert(!('reasoning' in sent));assert.deepEqual(sent.provider,{require_parameters:true});assert(!('prompt_cache_options' in sent));assert.equal(sent.messages[0].content,'P');
 sent=body('openrouter','qwen/qwen4-max','high',{request:{summary:true,cache:true}});assert.deepEqual(sent.reasoning,{effort:'high',exclude:false});assert.equal(sent.messages[0].content,'P','No cache mark where the Lab does not know the vendor’s caching');
 sent=body('openrouter','openai/gpt-4.1','default',{request:{cache:true}});assert(!('prompt_cache_options' in sent));assert.equal(sent.messages[0].content,'P');
 sent=body('openrouter','openai/gpt-6.1-sol-pro','medium',{request:{cache:true}});assert.deepEqual(sent.prompt_cache_options,{mode:'explicit'});assert.equal(typeof sent.messages[0].content,'object');
 sent=body('openrouter','anthropic/claude-opus-4.6','medium',{request:{cache:true}});assert.deepEqual(sent.messages[0].content[0].cache_control,{type:'ephemeral'});

 // Which settings reach such a model.
 assert.deepEqual(rs.sentRequestSettings('openai','gpt-4.1',{cache:true,temperature:0.2,summary:true,store:false},'default'),{temperature:0.2,store:false});
 assert.deepEqual(rs.sentRequestSettings('openai','gpt-5.5',{cache:true,summary:true},'default'),{summary:true});
 assert(rs.takesTemperature('anthropic','claude-3-5-haiku-latest','off'));assert(!rs.takesTemperature('anthropic','claude-3-7-sonnet-20250219','1024'));assert(!rs.takesTemperature('anthropic','claude-opus-4-6','low'));assert(!rs.takesTemperature('openrouter','anthropic/claude-3.5-haiku','default'));
 assert.equal(rs.outputFloor('anthropic','claude-sonnet-4-5','8192'),8193);assert.equal(rs.outputFloor('anthropic','claude-opus-4-6','high'),16);
 assert(rs.summarizesReasoning('default','openai','gpt-5.5'));assert(!rs.summarizesReasoning('default','openai','gpt-4.1'));assert(rs.summarizesReasoning('default','openrouter','openai/gpt-4.1'),'Through OpenRouter the reply’s reasoning is kept where there is any');
 // Caching: an earlier OpenAI model caches by itself, like Gemini.
 assert.deepEqual(rs.cacheSupport('openai','gpt-5.5'),{kind:'automatic',vendor:'openai',minTokens:1024});assert.equal(rs.cacheSupport('openai','gpt-6.1-sol-2026-10-01').kind,'marked');
 assert.deepEqual(rs.cacheSupport('openrouter','openai/gpt-4.1'),{kind:'automatic',vendor:'openai',minTokens:1024});assert.equal(rs.cacheSupport('openrouter','qwen/qwen4-max'),undefined);
 assert.equal(rs.cacheSupport('anthropic','claude-3-5-haiku-latest').minTokens,2048);assert.equal(rs.cacheSupport('anthropic','claude-3-7-sonnet-20250219').minTokens,1024);
 assert.deepEqual(notes.cacheNote('openai','gpt-5.5','P'),{available:false,text:'OpenAI caches repeated prompts by itself, from 1,024 tokens on this model. There is nothing to switch on or off.'});
 assert.deepEqual(notes.cacheNote('openrouter','qwen/qwen4-max','P'),{available:false,text:'Not available for this model.'});
 // The web research request of Model knowledge follows the same rules.
 calls=[];mock=async()=>Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://example.org/a',title:'A'}],query:'q'}},{type:'message',content:[{type:'output_text',text:'Notes.'}]}],usage:{total_tokens:5}});
 await web.researchKnowledge('openai','gpt-5.5','default','sk-test',[{heading:'Title',value:'Jaws'}],'P').catch(()=>{});
 {const research=JSON.parse(calls[0].options.body);assert(!('reasoning' in research)&&!('prompt_cache_options' in research),'The search request names no effort and no cache mode for such a model');}
 calls=[];await web.researchKnowledge('openai','gpt-6-luna','low','sk-test',[{heading:'Title',value:'Jaws'}],'P').catch(()=>{});
 {const research=JSON.parse(calls[0].options.body);assert.deepEqual(research.reasoning,{effort:'low'});assert.deepEqual(research.prompt_cache_options,{mode:'explicit'});}

 // --- Through the request handler -------------------------------------------------------------------
 const answer=JSON.stringify({score:'A',explanation:'Because.'});
 const replies={openai:{id:'r1',status:'completed',model:'gpt-5.5-2026-04-23',output:[{type:'message',content:[{type:'output_text',text:answer}]}],usage:{total_tokens:10}},anthropic:{id:'m1',model:'claude-opus-4-6',stop_reason:'end_turn',content:[{type:'text',text:answer}],usage:{input_tokens:5,output_tokens:5}},gemini:{candidates:[{finishReason:'STOP',content:{parts:[{text:answer}]}}],usageMetadata:{totalTokenCount:10},modelVersion:'gemini-3.7-flash'},openrouter:{id:'g1',model:'qwen/qwen4-max',choices:[{finish_reason:'stop',message:{content:answer}}],usage:{total_tokens:10,cost:0.001}}};
 function request(provider,model,effort,extra={}){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model,effort,prompt:'Label the document A or B.',answerFields:'[]',...extra}))form.set(k,v);
  form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 for(const [provider,model,effort] of [['openai','gpt-5.5','default'],['anthropic','claude-opus-4-6','medium'],['gemini','gemini-3.7-flash','default'],['openrouter','qwen/qwen4-max','default']]){
  calls=[];mock=async()=>Response.json(replies[provider]);
  const response=await route.POST(request(provider,model,effort,{record:'true'})),out=await response.json();
  assert.equal(response.status,200,provider+' '+JSON.stringify(out));assert.equal(calls.length,1);assert.equal(out.score,'A');
  const sentBody=JSON.parse(calls[0].options.body);
  if(provider==='gemini')assert(calls[0].url.includes('/models/gemini-3.7-flash:generateContent'));else assert.equal(sentBody.model,model);
  assert.equal(JSON.stringify(sentBody),JSON.stringify(frame.fillRequest(frame.requestFrame({provider,model,effort,prompt:'Label the document A or B.',answerFields:[]},false).body,{filename:'text.txt',text:'A document.'})),provider+': the record of the request is the request');
 }
 // What is not a model of the provider, or not a setting of the model's family, is refused before anything is sent.
 for(const [provider,model,effort] of [['openai','claude-opus-5-5','high'],['openai','gpt 5','default'],['openai','gpt-4.1','medium'],['anthropic','gpt-6-sol','high'],['anthropic','claude-opus-4-6','off'],['anthropic','claude-sonnet-4-5','high'],['gemini','gpt-6-luna','default'],['gemini','gemini-3.7-flash','dynamic'],['openrouter','gpt-6-luna','default'],['openai','gpt-6-luna','default'],['anthropic','claude-opus-5-5','default'],['openrouter','openai/gpt-6-luna','default']]){
  calls=[];const response=await route.POST(request(provider,model,effort));
  assert.equal(response.status,400,provider+' '+model+' '+effort);assert.equal((await response.json()).error,'Unsupported model or reasoning setting.');assert.equal(calls.length,0);
 }
 assert.equal(safety.setupErrors('openai','sk-test','P','gpt-5.5','default').model,'');
 assert.equal(safety.setupErrors('openai','sk-test','P','','default').model,'Choose an available model.');
 assert.equal(safety.setupErrors('anthropic','sk-ant-test','P','gpt-6-sol','high').model,'Choose an available model.');
 assert.equal(safety.setupErrors('openai','sk-test','P','gpt-4.1','medium').model,'Choose a supported reasoning setting.');

 // A setting the model does not take is named; the provider's words are not shown.
 const refused=async(provider,model,effort,status,error,extra)=>{calls=[];mock=async()=>Response.json({error},{status});const response=await route.POST(request(provider,model,effort,extra));assert.equal(response.status,status);const text=(await response.json()).error;assert(!text.includes('SECRET'),text);return text;};
 assert.equal(await refused('openai','gpt-5.5','xhigh',400,{message:"Unsupported value: 'reasoning.effort' does not support 'xhigh' with this model. SECRET",param:'reasoning.effort',code:'unsupported_value'}),'OpenAI does not accept this reasoning setting for the model. Choose another under “Reasoning effort”. (HTTP 400.)');
 assert.equal(await refused('anthropic','claude-3-5-haiku-latest','1024',400,{type:'invalid_request_error',message:'SECRET thinking: this model does not support extended thinking'}),'Anthropic does not accept this reasoning setting for the model. Choose another under “Reasoning effort”. (HTTP 400.)');
 assert.equal(await refused('anthropic','claude-3-5-haiku-latest','off',400,{type:'invalid_request_error',message:'SECRET output_config.format: structured outputs are not supported by this model'}),'Anthropic does not accept structured answers from this model. Choose “Plain text” under Answer fields. (HTTP 400.)');
 assert.match(await refused('openrouter','mistralai/mistral-small','high',404,{code:404,message:'No endpoints found that support the requested parameters. SECRET'}),/^OpenRouter has no provider for this model that takes every setting of the request\. Set “Reasoning effort” to “model default”\./);
 assert.match(await refused('openai','gpt-5.5','default',404,{message:'The model `gpt-5.5` does not exist or you do not have access to it. SECRET',code:'model_not_found'}),/^OpenAI could not find the requested model or resource\./);
 // A listed model's errors read as before.
 assert.match(await refused('openai','gpt-6-luna','medium',400,{message:"Unsupported value: 'reasoning.effort' SECRET",param:'reasoning.effort'}),/^OpenAI rejected the request\. Check that the document opens correctly/);
 assert.match(await refused('openrouter','openai/gpt-6-luna','medium',404,{code:404,message:'No endpoints found that support the requested parameters. SECRET'}),/^OpenRouter could not find the requested model or resource\./);
 // A request setting that was refused is still named first.
 assert.match(await refused('openai','gpt-5.5','high',400,{message:"Unsupported parameter: 'temperature' SECRET",param:'temperature'},{requestSettings:JSON.stringify({temperature:0.5})}),/^OpenAI does not accept a temperature for this model/);

 // The estimate takes any model; where the Lab has no price it says so.
 {const result=await estimate.studentEstimate({provider:'openai',model:'gpt-5.5',effort:'default',prompt:'P',rows:[{status:'pending',file:new File(['A document.'],'a.txt')}]});assert.match(result.unknown,/^No verified price is available for this model\./);}
 await assert.rejects(()=>estimate.studentEstimate({provider:'openai',model:'claude-opus-5-5',effort:'high',prompt:'P',rows:[]}),/Choose a supported model\./);

 // --- The models on the account -------------------------------------------------------------------------
 const list=(provider,key='')=>models.POST(new Request('https://lab.test/api/models',{method:'POST',headers:{origin:'https://lab.test','X-Lab-Provider':provider,...(key?{authorization:'Bearer '+key}:{})}}));
 const keys={openai:'sk-test-0123456789abcdef',anthropic:'sk-ant-test-0123456789',gemini:'AIzaTest0123456789abcdef',openrouter:'sk-or-v1-0123456789abcdef'};
 // OpenAI: models that answer in text, newest first.
 calls=[];mock=async()=>Response.json({object:'list',data:[{id:'gpt-4.1',created:100},{id:'gpt-6.1-sol-2026-10-01',created:300},{id:'text-embedding-3-large',created:400},{id:'gpt-6-realtime',created:500},{id:'o3',created:200},{id:'gpt-image-2',created:600},{id:'whisper-1',created:1},{id:'ft:gpt-4.1:lab::A1',created:700},{id:'bad id',created:800},{id:7}]});
 let response=await list('openai',keys.openai);assert.equal(response.status,200);
 assert.deepEqual((await response.json()).models,[{id:'gpt-6.1-sol-2026-10-01'},{id:'o3'},{id:'gpt-4.1'}]);
 assert.equal(calls[0].url,'https://api.openai.com/v1/models');assert.equal(calls[0].options.headers.Authorization,'Bearer '+keys.openai);assert.equal(calls.length,1);
 // Anthropic: names, the levels of effort each model takes, and every page of the list.
 const cap=(...levels)=>({effort:{supported:levels.length>0,...Object.fromEntries(['low','medium','high','xhigh','max'].map(level=>[level,{supported:levels.includes(level)}]))}});
 calls=[];mock=async url=>Response.json(url.includes('after_id=claude-opus-4-6')?{data:[{id:'claude-sonnet-4-5-20250929',display_name:'Claude Sonnet 4.5',capabilities:cap()},{id:'claude-old',display_name:'<b>Odd</b> name'}],has_more:false,last_id:'claude-old'}:{data:[{id:'claude-fable-5-2',display_name:'Claude Fable 5.2',capabilities:cap('low','medium','high','xhigh','max')},{id:'claude-opus-4-6',display_name:'Claude Opus 4.6',capabilities:cap('low','medium','high','max')},{id:'gpt-not-claude'}],has_more:true,last_id:'claude-opus-4-6'});
 response=await list('anthropic',keys.anthropic);assert.equal(response.status,200);
 assert.deepEqual((await response.json()).models,[{id:'claude-fable-5-2',name:'Claude Fable 5.2',efforts:['low','medium','high','xhigh','max']},{id:'claude-opus-4-6',name:'Claude Opus 4.6',efforts:['low','medium','high','max']},{id:'claude-sonnet-4-5-20250929',name:'Claude Sonnet 4.5',efforts:[]},{id:'claude-old'}]);
 assert.equal(calls.length,2);assert.equal(calls[0].options.headers['x-api-key'],keys.anthropic);assert(calls[1].url.endsWith('&after_id=claude-opus-4-6'));
 // Gemini: models that generate text, without the "models/" prefix.
 calls=[];mock=async()=>Response.json({models:[{name:'models/gemini-3.7-flash',displayName:'Gemini 3.7 Flash',supportedGenerationMethods:['generateContent','countTokens']},{name:'models/gemini-embedding-2',supportedGenerationMethods:['embedContent']},{name:'models/gemini-3.1-flash-image',supportedGenerationMethods:['generateContent']},{name:'models/gemini-4-carbon',displayName:'Gemini 4 Carbon',supportedGenerationMethods:['generateContent']},{name:'models/gemma-3-27b-it',supportedGenerationMethods:['generateContent']},{name:'models/gemini-live-3',supportedGenerationMethods:['bidiGenerateContent']}]});
 response=await list('gemini',keys.gemini);assert.deepEqual((await response.json()).models,[{id:'gemini-3.7-flash',name:'Gemini 3.7 Flash'},{id:'gemini-4-carbon',name:'Gemini 4 Carbon'}]);
 assert.equal(calls[0].options.headers['x-goog-api-key'],keys.gemini);assert(!calls[0].url.includes(keys.gemini),'The key is not part of the address');
 // OpenRouter: the models the account may use that answer in text, with the reasoning levels each takes.
 calls=[];mock=async()=>Response.json({data:[{id:'qwen/qwen4-max',name:'Qwen: Qwen4 Max',architecture:{output_modalities:['text']},supported_parameters:['reasoning','temperature'],reasoning:{mandatory:false,supported_efforts:['xhigh','high','low','none'],default_effort:'high'}},{id:'mistralai/mistral-small',name:'Mistral Small',architecture:{output_modalities:['text']},supported_parameters:['temperature']},{id:'deepseek/r2',name:'DeepSeek R2',architecture:{output_modalities:['text']},supported_parameters:['reasoning']},{id:'google/lyria-3',architecture:{output_modalities:['audio']},supported_parameters:[]},{id:'openai/gpt-5.4-image-2',architecture:{output_modalities:['image','text']},supported_parameters:['reasoning']}]});
 response=await list('openrouter',keys.openrouter);assert.deepEqual((await response.json()).models,[{id:'qwen/qwen4-max',name:'Qwen: Qwen4 Max',efforts:['none','low','high','xhigh']},{id:'mistralai/mistral-small',name:'Mistral Small',efforts:[]},{id:'deepseek/r2',name:'DeepSeek R2'}]);
 assert.equal(calls[0].url,'https://openrouter.ai/api/v1/models/user');
 // A key goes only to its own provider, and a refused key is explained without the provider's words.
 for(const [provider,key] of [['openai',''],['openai',keys.anthropic],['anthropic',keys.openai],['openrouter',keys.openai],['openai',keys.openrouter],['gemini',keys.openai],['openai','sk-admin-0123456789abcdef']]){calls=[];response=await list(provider,key);assert.equal(response.status,401,provider+' '+key);assert.equal(calls.length,0);}
 calls=[];response=await list('mistral',keys.openai);assert.equal(response.status,400);assert.equal(calls.length,0);
 mock=async()=>Response.json({error:{message:'Incorrect API key provided: sk-test SECRET',code:'invalid_api_key'}},{status:401});
 response=await list('openai',keys.openai);assert.equal(response.status,401);{const text=(await response.json()).error;assert.match(text,/^The list of models could not be read\. OpenAI rejected the API key\./);assert(!text.includes('SECRET'));}
 mock=async()=>{throw new TypeError('network');};response=await list('openai',keys.openai);assert.equal(response.status,502);assert.match((await response.json()).error,/^The list of models could not be read\. Check your connection/);
 mock=async()=>Response.json({unexpected:true});response=await list('gemini',keys.gemini);assert.notEqual(response.status,401);assert.match((await response.json()).error,/^The list of models could not be read\./);
 assert.match(read('lib/local-api.ts'),/'\/api\/models':\(\)=>import\('@\/app\/api\/models\/route'\)/);

 // --- A study keeps such a model --------------------------------------------------------------------------
 const study={name:'Any model',createdAt:'2026-11-16T12:00:00Z',texts:{answerFields:[],prompt:'P',provider:'openai',model:'gpt-5.5',customModel:true,effort:'default',docs:[]},knowledge:{answerFields:[],items:[]}};
 {const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup(study)).texts;assert.equal(restored.model,'gpt-5.5');assert.equal(restored.customModel,true);assert.equal(restored.effort,'default');}
 {const {customModel,...texts}=study.texts,restored=backup.decodeStudyBackup(await backup.encodeStudyBackup({...study,texts})).texts;assert(!('customModel' in restored)||restored.customModel===undefined);}
 await assert.rejects(async()=>backup.decodeStudyBackup(await backup.encodeStudyBackup({...study,texts:{...study.texts,customModel:'yes'}})));

 // --- The page ----------------------------------------------------------------------------------------------
 const page=read('app/page.tsx'),wrappers=read('components/research-mode.tsx'),menu=read('components/research/model-choice.tsx');
 assert(page.includes('selectedModel(p,v.model,v.customModel===true)'),'A stored model outside the lists is kept only with the study’s note');
 assert.equal(page.split('prompt,model,effort,provider,customModel,chunkWords').length-1,5,'Every save of the study carries the note');
 assert(page.includes('const customModel=!isListedModel(provider,model)||undefined;'));
 assert(page.includes("{research?<ResearchModel fallback={modelCell} provider={provider} model={model} apiKey={keyRejected?'':key} disabled={workspaceLocked||!ready} onChange={chooseModel} onModels={setAccountModels}/>:modelCell}"),'The standard Lab keeps its own menu, and research mode shows it until its screens have loaded');
 assert(page.includes('const modelCell=<div><label>Model</label><Select value={model} onValueChange={chooseModel} disabled={workspaceLocked||!ready}>'));
 assert(!/from '@\/components\/research\//.test(page)&&!/from '@\/app\/api\//.test(page),'The research screens and the request handlers load on demand');
 assert(wrappers.includes("const Model=lazy(()=>load().then(module=>({default:module.ModelChoice})));"));
 assert(!page.includes('Other model ID')&&menu.includes('Other model ID…')&&menu.includes('Back to the list')&&menu.includes('on your account'));
 assert(menu.includes("fetch('/api/models',{method:'POST',headers:{Authorization:'Bearer '+key,'X-Lab-Provider':provider}"),'The key travels in a header to the request handler, as for every other request');
 assert(!/localStorage|sessionStorage|indexedDB/.test(menu),'The account’s list is kept in memory only');
 // The methods text of an export names no effort where none was sent.
 assert(read('lib/research/export-packages.ts').includes("run.effort&&run.effort!=='default'?`reasoning effort “${reasoningOptionLabel(run.effort).toLowerCase()}”`:'the provider’s default reasoning effort'"));
 console.log('model choice checks passed');
})().catch(error=>{console.error(error);process.exit(1);});
