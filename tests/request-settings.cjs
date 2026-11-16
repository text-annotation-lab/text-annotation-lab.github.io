// Research mode's request settings besides prompt caching: temperature, the output limit, a summary of the
// model's reasoning, and OpenAI's logs. Each is sent only where it changes a request to the chosen provider and
// model; without them every request is the standard Lab's. Also "Preview request", what a run and a backup
// keep, and the exports. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=async()=>Response.json({});
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+(fs.existsSync(path.resolve(path.dirname(filename),id+'.tsx'))?'.tsx':'.ts')))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}

(async()=>{
 const rs=load('lib/request-settings.ts'),frame=load('lib/request-frame.ts'),route=load('app/api/annotate/route.ts'),batchRoute=load('app/api/batch/route.ts'),batch=load('lib/batch-provider.ts'),errors=load('lib/provider-errors.ts'),providers=load('lib/providers.ts'),backup=load('lib/study-backup.ts'),runs=load('lib/research/runs.ts'),view=load('lib/research/request-view.ts'),exporting=load('lib/research/export.ts'),tables=load('lib/research/export-tables.ts'),data=load('lib/research/export-data.ts'),estimate=load('lib/student-estimate.ts');

 // --- The stored form ----------------------------------------------------------------------------
 assert.deepEqual(rs.cleanRequestSettings({store:false,summary:true,maxOutput:4000,temperature:0,cache:true,other:1}),{cache:true,temperature:0,maxOutput:4000,summary:true,store:false});
 assert.deepEqual(Object.keys(rs.cleanRequestSettings({store:false,summary:true,maxOutput:4000,temperature:0,cache:true})),['cache','temperature','maxOutput','summary','store'],'One order, so the same settings are the same text');
 for(const none of [{temperature:-0.1},{temperature:2.1},{temperature:'0'},{temperature:NaN},{maxOutput:15},{maxOutput:1000001},{maxOutput:4000.5},{maxOutput:'4000'},{summary:false},{summary:'yes'},{store:true},{store:'no'}])assert.equal(rs.cleanRequestSettings(none),undefined,JSON.stringify(none));
 assert.deepEqual(rs.cleanRequestSettings({temperature:2,maxOutput:16}),{temperature:2,maxOutput:16});assert.deepEqual(rs.cleanRequestSettings({maxOutput:1000000}),{maxOutput:1000000});
 assert.deepEqual(rs.readRequestSettings('{"temperature":0.2,"maxOutput":4000,"summary":true,"store":false}'),{temperature:0.2,maxOutput:4000,summary:true,store:false});
 for(const bad of ['{"temperature":3}','{"maxOutput":4000,"temperature":0}','{"summary":false}','{"store":true}','{"temperature":0,"top_p":1}'])assert.throws(()=>rs.readRequestSettings(bad),/request settings/,bad);

 // --- What a request to each provider and model carries ----------------------------------------------
 assert.deepEqual(rs.sentRequestSettings('openai','gpt-6-luna',{temperature:0,maxOutput:4000,summary:true,store:false},'medium'),{temperature:0,maxOutput:4000,summary:true,store:false});
 assert.deepEqual(rs.sentRequestSettings('gemini','gemini-3.8-flash',{temperature:1.5,store:false},'medium'),{temperature:1.5},'Only OpenAI has the logs');
 assert.deepEqual(rs.sentRequestSettings('openrouter','openai/gpt-6-luna',{temperature:2,store:false},'low'),{temperature:2});
 // Claude: no temperature for a model that reasons; Haiku 4.5 with reasoning off takes one, up to 1.
 for(const model of providers.PROVIDERS.anthropic.models)for(const effort of providers.effortsFor?providers.effortsFor('anthropic',model):providers.PROVIDERS.anthropic.efforts){
  const takes=model.startsWith('claude-haiku-4-5')&&effort==='off';assert.equal(rs.takesTemperature('anthropic',model,effort),takes,model+' '+effort);
  assert.deepEqual(rs.sentRequestSettings('anthropic',model,{temperature:1.4},effort),takes?{temperature:1}:undefined,model+' '+effort);
 }
 assert.equal(rs.takesTemperature('anthropic','claude-haiku-4-5-20251001','4096'),false);assert.equal(rs.temperatureCeiling('anthropic'),1);assert.equal(rs.temperatureCeiling('openai'),2);
 for(const model of providers.PROVIDERS.openrouter.models)assert.equal(rs.takesTemperature('openrouter',model,'medium'),!model.startsWith('anthropic/'),model);
 // The output limit: the Lab's own is not a setting; a fixed reasoning budget needs room above it.
 for(const [provider,spec] of Object.entries(providers.PROVIDERS))for(const model of spec.models){
  assert.equal(rs.defaultOutputLimit(provider,model),providers.annotationOutputLimit(provider,model),`${provider} ${model}: one limit, wherever it is read`);
  assert.equal(rs.sentRequestSettings(provider,model,{maxOutput:rs.defaultOutputLimit(provider,model)},'medium'),undefined,model+': the Lab’s own limit is the standard request');
 }
 assert.equal(rs.defaultOutputLimit('gemini','gemini-4-argon'),32768);assert.equal(rs.defaultOutputLimit('openai','gpt-6-luna'),12000);
 assert.equal(rs.outputFloor('anthropic','claude-haiku-4-5-20251001','8192'),8193);assert.equal(rs.outputFloor('anthropic','claude-haiku-4-5-20251001','off'),16);assert.equal(rs.outputFloor('anthropic','claude-sonnet-5-5','high'),16);
 assert.deepEqual(rs.sentRequestSettings('anthropic','claude-haiku-4-5-20251001',{maxOutput:2000},'8192'),{maxOutput:8193});assert.deepEqual(rs.sentRequestSettings('anthropic','claude-haiku-4-5-20251001',{maxOutput:2000},'1024'),{maxOutput:2000});
 assert.equal(rs.outputLimit('openai','gpt-6-luna',undefined),12000);assert.equal(rs.outputLimit('openai','gpt-6-luna',{maxOutput:500}),500);
 assert.equal(rs.requestTimeout('openai','gpt-6-luna',undefined),180000);assert.equal(rs.requestTimeout('openai','gpt-6-luna',{maxOutput:500}),180000);assert.equal(rs.requestTimeout('openai','gpt-6-luna',{maxOutput:64000}),900000,'A raised limit gets a longer wait');assert.equal(rs.requestTimeout('gemini','gemini-4-argon',undefined),900000);
 // A summary needs reasoning.
 assert.equal(rs.sentRequestSettings('anthropic','claude-haiku-4-5-20251001',{summary:true},'off'),undefined);assert.deepEqual(rs.sentRequestSettings('anthropic','claude-haiku-4-5-20251001',{summary:true},'1024'),{summary:true});
 assert.equal(rs.sentRequestSettings('gemini','gemini-2.5-flash-lite',{summary:true},'off'),undefined);assert.deepEqual(rs.sentRequestSettings('gemini','gemini-2.5-flash-lite',{summary:true},'dynamic'),{summary:true});
 assert.deepEqual(rs.requestSummary({cache:true,temperature:0,maxOutput:4000,summary:true,store:false}),['Prompt caching','temperature 0','max 4,000 output tokens','reasoning summary','not in OpenAI’s logs']);assert.deepEqual(rs.requestSummary(undefined),[]);

 // --- The request bodies ---------------------------------------------------------------------------
 const PROMPT='Classify the tone of the text.',doc={filename:'text.txt',text:'A document.'};
 const options=(provider,model,effort,request,extra={})=>({provider,model,effort,prompt:PROMPT,schemaPrompt:PROMPT,answerFields:[],request,...extra});
 const cases=[['openai','gpt-6-luna','medium'],['anthropic','claude-sonnet-5-5','medium'],['anthropic','claude-haiku-4-5-20251001','off'],['anthropic','claude-haiku-4-5-20251001','4096'],['gemini','gemini-3.8-flash','medium'],['gemini','gemini-2.5-flash-lite','dynamic'],['openrouter','openai/gpt-6-luna','medium'],['openrouter','anthropic/claude-haiku-5.5','medium']];
 for(const [provider,model,effort] of cases)for(const batchMode of [false,true]){
  if(provider==='openrouter'&&batchMode)continue;
  const plain=frame.providerBody(options(provider,model,effort,undefined,{batch:batchMode}),doc),name=`${provider} ${model} ${effort}${batchMode?' (batch)':''}`;
  // Settings that change nothing for this model leave the standard request, to the letter.
  assert.equal(JSON.stringify(frame.providerBody(options(provider,model,effort,{maxOutput:rs.defaultOutputLimit(provider,model),...(provider==='openai'?{}:{store:false}),...(rs.takesTemperature(provider,model,effort)?{}:{temperature:0.3}),...(effort==='off'?{summary:true}:{})},{batch:batchMode}),doc)),JSON.stringify(plain),name);
  const set=frame.providerBody(options(provider,model,effort,{temperature:0.3,maxOutput:4000,summary:true,store:false},{batch:batchMode}),doc);
  const limit=provider==='openai'?set.max_output_tokens:provider==='gemini'?set.generationConfig.maxOutputTokens:set.max_tokens,temperature=provider==='gemini'?set.generationConfig.temperature:set.temperature;
  assert.equal(limit,provider==='anthropic'&&effort==='4096'?4097:4000,name);
  assert.equal(temperature,rs.takesTemperature(provider,model,effort)?0.3:undefined,name);
  if(provider==='openai'){assert.deepEqual(set.reasoning,{effort,summary:'auto'});assert.equal(set.store,false);assert.equal(plain.store,true);assert.deepEqual(plain.reasoning,{effort});}
  else assert(!('store' in set),name+': no other provider is sent the logs setting');
  if(provider==='anthropic')assert.deepEqual(set.thinking,model.startsWith('claude-haiku-4-5')?(effort==='off'?{type:'disabled'}:{type:'enabled',budget_tokens:4096}):{type:'adaptive',display:'summarized'},name);
  if(provider==='gemini'){assert.equal(set.generationConfig.thinkingConfig.includeThoughts,true);assert(!('includeThoughts' in plain.generationConfig.thinkingConfig));}
  if(provider==='openrouter'){assert.deepEqual(set.reasoning,{effort,exclude:false});assert.deepEqual(plain.reasoning,{effort,exclude:true});}
  // Apart from the settings, the request is the standard one.
  const strip=body=>{const b=JSON.parse(JSON.stringify(body));delete b.temperature;delete b.max_output_tokens;delete b.max_tokens;delete b.store;if(b.generationConfig){delete b.generationConfig.temperature;delete b.generationConfig.maxOutputTokens;delete b.generationConfig.thinkingConfig.includeThoughts;}if(b.reasoning){delete b.reasoning.summary;delete b.reasoning.exclude;}if(b.thinking)delete b.thinking.display;return b;};
  assert.deepEqual(strip(set),strip(plain),name+': nothing else differs');
 }
 // A recorded request holds the settings, and the prompt as sent.
 const recorded=frame.requestFrame({provider:'openai',model:'gpt-6-luna',effort:'low',prompt:PROMPT,answerFields:[],requestSettings:{temperature:0,maxOutput:2000}},false),parts=data.requestParts(recorded);
 assert.equal(parts.temperature,0);assert.equal(parts.limit,2000);assert.equal(data.requestParts(frame.requestFrame({provider:'gemini',model:'gemini-3.8-flash',effort:'low',prompt:PROMPT,answerFields:[],requestSettings:{temperature:1.2}},false)).temperature,1.2);
 assert.equal(data.requestParts(frame.requestFrame({provider:'openai',model:'gpt-6-luna',effort:'low',prompt:PROMPT,answerFields:[]},false)).temperature,undefined);

 // --- The summary of the model's reasoning in a reply -------------------------------------------------
 const answer=JSON.stringify({explanation:'Because.',score:'A'});
 const replies={
  openai:{status:'completed',id:'resp_test',model:'gpt-6-luna-2026-10-01',usage:{total_tokens:12},output:[{type:'reasoning',summary:[{type:'summary_text',text:'Read the text.'},{type:'summary_text',text:'Chose A.'}]},{type:'message',content:[{type:'output_text',text:answer}]}]},
  anthropic:{model:'claude-sonnet-5-5',stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2},content:[{type:'thinking',thinking:'Read the text.'},{type:'thinking',thinking:'Chose A.'},{type:'text',text:answer}]},
  gemini:{modelVersion:'gemini-3.8-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:'Read the text.',thought:true},{text:'Chose A.',thought:true},{text:answer}]}}],usageMetadata:{totalTokenCount:12}},
  openrouter:{id:'test-response',model:'openai/gpt-6-luna',choices:[{finish_reason:'stop',message:{content:answer,reasoning_details:[{type:'reasoning.summary',summary:'Read the text.'},{type:'reasoning.encrypted',data:'xxxx'},{type:'reasoning.text',text:'Chose A.'}]}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}},
 };
 for(const [provider,out] of Object.entries(replies))assert.equal(frame.reasoningSummary(provider,out),'Read the text.\n\nChose A.',provider);
 assert.equal(frame.reasoningSummary('openrouter',{choices:[{message:{content:answer,reasoning:'In one piece.',reasoning_details:[{type:'reasoning.text',text:'Other.'}]}}]}),'In one piece.');
 for(const [provider,out] of [['openai',{output:[{type:'reasoning',summary:[]},{type:'message',content:[]}]}],['anthropic',{content:[{type:'redacted_thinking',data:'x'},{type:'text',text:answer}]}],['gemini',{candidates:[{content:{parts:[{text:answer}]}}]}],['openrouter',{choices:[{message:{content:answer}}]}],['openai',null],['gemini',{}]])assert.equal(frame.reasoningSummary(provider,out),undefined,provider+': a reply without a summary');
 assert.equal(frame.reasoningSummary('anthropic',{content:[{type:'thinking',thinking:'x'.repeat(1000010)}]}).length,1000000);

 // Through the request handlers: research mode keeps the summary with the result; the standard Lab never does.
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:['openai/gpt-6-luna','medium']};
 function request(provider,setting,extra={}){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model:models[provider][0],effort:models[provider][1],prompt:PROMPT,answerFields:'[]',...extra}))form.set(k,v);
  if(setting!==undefined)form.set('requestSettings',typeof setting==='string'?setting:JSON.stringify(setting));
  form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 async function sent(provider,setting,extra){calls=[];mock=async()=>Response.json(replies[provider]);const response=await route.POST(request(provider,setting,extra));assert.equal(response.status,200,provider);assert.equal(calls.length,1);return {body:JSON.parse(calls[0].options.body),out:await response.json()};}
 // The prompt as sent: the message with the text, up to the text (lib/request-frame.ts).
 const promptIn=body=>{const content=body.input?.[0].content??body.messages?.at(-1).content??body.contents[0].parts,text=typeof content==='string'?content:content.map(part=>part.text||'').join('');return text.slice(0,text.lastIndexOf('\n\n<text>\n'));};
 for(const provider of Object.keys(models)){
  const kept=await sent(provider,{temperature:0.3,maxOutput:4000,summary:true},{record:'true'});
  assert.equal(kept.out.reasoningSummary,'Read the text.\n\nChose A.',provider);assert.equal(kept.out.score,'A',provider+': the answer is read as before');assert.equal(kept.out.output,answer,provider+': the reply’s text holds no reasoning');
  assert.equal(provider==='gemini'?kept.body.generationConfig.temperature:kept.body.temperature,provider==='anthropic'?undefined:0.3,provider);
  assert.deepEqual(kept.body,frame.providerBody(options(provider,models[provider][0],models[provider][1],{temperature:0.3,maxOutput:4000,summary:true},{prompt:promptIn(kept.body)}),doc),provider+': the handler sends the body the record is made from');
  assert(!('reasoningSummary' in (await sent(provider,{maxOutput:4000},{record:'true'})).out),provider+': no summary unless one was asked for');
  assert(!('reasoningSummary' in (await sent(provider,{summary:true})).out),provider+': nothing is kept without a record (the standard Lab)');
  const plain=await sent(provider);assert(!('reasoningSummary' in plain.out));assert.deepEqual(plain.body,frame.providerBody(options(provider,models[provider][0],models[provider][1],undefined,{prompt:promptIn(plain.body)}),doc));
 }
 calls=[];assert.equal((await route.POST(request('openai','{"temperature":5}'))).status,400);assert.equal(calls.length,0,'An unreadable setting is refused before anything is sent');
 // A failed request can still carry a summary (a reply cut short at the output limit).
 calls=[];mock=async()=>Response.json({...replies.openai,status:'incomplete',incomplete_details:{reason:'max_output_tokens'}});
 {const response=await route.POST(request('openai',{maxOutput:64,summary:true},{record:'true'})),out=await response.json();assert.equal(response.status,422);assert.equal(out.reasoningSummary,'Read the text.\n\nChose A.');assert.equal(out.stopReason,'incomplete: max_output_tokens');}

 // Batches: the same bodies, and the summary read from each result when it is collected.
 const file=()=>new File(['A document.'],'text.txt');
 for(const provider of ['openai','anthropic','gemini']){
  const body=await batch.buildBatchBody(provider,file(),PROMPT,...models[provider],false,false,[],undefined,{temperature:0.3,maxOutput:4000,summary:true,store:false});
  assert.deepEqual(body,frame.providerBody(options(provider,models[provider][0],models[provider][1],{temperature:0.3,maxOutput:4000,summary:true,store:false},{batch:true,prompt:promptIn(body)}),doc),provider);
  assert.equal(batch.parseBatchAnnotation(provider,replies[provider],false,true,true).reasoningSummary,'Read the text.\n\nChose A.',provider);
  assert(!('reasoningSummary' in batch.parseBatchAnnotation(provider,replies[provider],false,true,false)),provider);assert(!('reasoningSummary' in batch.parseBatchAnnotation(provider,replies[provider],false,false,true)),provider+': never without a record');
  assert.equal(batch.parseBatchAnnotation(provider,replies[provider],false,true,true).score,'A');
 }
 {const f=new FormData();for(const [k,v]of Object.entries({provider:'openai',action:'collect',id:'batch_test',summary:'true'}))f.set(k,v);calls=[];
  assert.equal((await batchRoute.POST(new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer sk-test'},body:f}))).status,400,'A summary is collected only together with the record');assert.equal(calls.length,0);}

 // --- A setting the provider rejects is named; the provider's words are never shown -----------------
 const SECRET='sk-secret-ECHO text of the document';
 const openaiError={error:{message:`Unsupported parameter: 'temperature' is not supported with this model. ${SECRET}`,param:'temperature',code:'unsupported_parameter'}};
 let message=errors.providerError('openai',400,openaiError,undefined,{temperature:0.2});
 assert.equal(message,'OpenAI does not accept a temperature for this model and reasoning setting. Clear Temperature in Processing options, or choose a model that takes one. (HTTP 400.)');
 assert.notEqual(errors.providerError('openai',400,openaiError),message,'The standard Lab’s message is unchanged');assert.equal(errors.providerError('openai',400,openaiError,undefined,{maxOutput:4000}),errors.providerError('openai',400,openaiError),'A setting that was not sent is never blamed');
 assert.equal(errors.providerError('openrouter',404,{error:{message:'No endpoints found that support the requested parameters.'}},undefined,{temperature:0.2}),'OpenRouter does not accept a temperature for this model and reasoning setting. Clear Temperature in Processing options, or choose a model that takes one. (HTTP 404.)');
 assert(errors.providerError('openai',400,{error:{message:'Your organization must be verified to generate reasoning summaries. '+SECRET}},undefined,{summary:true}).startsWith('OpenAI did not accept the request for a reasoning summary.'));
 assert.equal(errors.providerError('anthropic',400,{error:{type:'invalid_request_error',message:'max_tokens: 500000 > 128000, which is the maximum allowed. '+SECRET}},undefined,{maxOutput:500000}),'Anthropic does not accept 500,000 as the output limit for this model. Change “Max output tokens” in Processing options. (HTTP 400.)');
 assert.equal(errors.providerError('openai',401,openaiError,undefined,{temperature:0.2}),errors.providerError('openai',401,openaiError),'Only a rejected request is read for a setting');
 for(const [provider,status,body,request] of [['openai',400,openaiError,{temperature:0.2}],['openai',400,{error:{message:'summary '+SECRET}},{summary:true}],['gemini',400,{error:{message:'maxOutputTokens '+SECRET}},{maxOutput:99}]])assert(!errors.providerError(provider,status,body,undefined,request).includes('ECHO'),provider);

 // --- "Preview request" ------------------------------------------------------------------------------
 for(const [provider,model,effort] of cases){
  const settings={provider,model,effort,prompt:PROMPT,answerFields:[],requestSettings:rs.sentRequestSettings(provider,model,{cache:true,temperature:0.3,maxOutput:4000,summary:true},effort),layout:'message'};
  const shown=view.previewRequest(settings,{filename:'first.txt',text:'The first text.'}),name=provider+' '+model;
  assert.deepEqual(shown.body,frame.fillRequest(frame.requestFrame(settings,false).body,{filename:'first.txt',text:'The first text.'}),name+': the preview is the request a run sends');
  assert(shown.message.startsWith(PROMPT)&&shown.message.endsWith('\n\n<text>\nThe first text.\n</text>')&&shown.message.includes('Lab response format'),name+': the prompt with the Lab’s instructions, then the text');
  assert.equal(shown.system,undefined,name+': no system prompt');assert(!shown.message.includes('first.txt'),name+': no file name');
  assert.deepEqual(view.previewRequest({...settings,layout:undefined},{filename:'first.txt',text:'The first text.'}).body,shown.body,name+': a preview is always of the current layout');
  assert.equal(shown.cached,rs.marksCache(provider,model,{cache:true}),name);
  assert(!JSON.stringify(shown.settings).includes('The first text.')&&!JSON.stringify(shown.settings).includes(PROMPT),name+': the settings hold neither the prompt nor the text');
  assert.equal(shown.settings.max_output_tokens??shown.settings.max_tokens??shown.settings.generationConfig?.maxOutputTokens,provider==='anthropic'&&effort==='4096'?4097:4000,name);
  assert.equal(shown.url,frame.requestUrl(provider,model));
  const pdf=view.previewRequest(settings,{filename:'scan.pdf',pdf:true});assert(pdf.message.startsWith(PROMPT)&&pdf.message.endsWith('\n\n[The PDF file is attached here.]'),name);assert(JSON.stringify(pdf.body).includes('[the PDF file, base64-encoded]'),name);
 }
 assert.equal(view.previewRequest({provider:'openai',model:'gpt-6-luna',effort:'low',prompt:PROMPT,answerFields:[],knowledge:true},{filename:'subject.txt',text:view.PREVIEW_PLACEHOLDER.subject}).message.split('\n\n').at(-1),'<entry>\n(your subject’s fields appear here)\n</entry>');
 assert.deepEqual(view.splitRequest(undefined),{message:'',settings:{},cached:false});

 // --- The cost estimate allows for the limit -----------------------------------------------------------
 assert(/maxTokens:maxOutput\?\?annotationOutputLimit\(provider,model\)/.test(fs.readFileSync(path.join(root,'lib/student-estimate.ts'),'utf8')),'The estimate’s upper edge follows the output limit');
 assert.equal(typeof estimate.studentEstimate,'function');

 // --- What a run and a study keep --------------------------------------------------------------------
 const setup={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:PROMPT,answerFields:[]};
 assert.deepEqual(runs.setupOf({...setup,requestSettings:{cache:true,temperature:0,maxOutput:4000,summary:true,store:false}}),{...setup,temperature:0,maxOutput:4000},'Of the request settings, a run’s setup holds the two that can change an answer');
 assert(runs.sameSetup(setup,runs.setupOf({...setup,requestSettings:{cache:true,summary:true,store:false}})),'Caching, the summary, and the logs do not make a new run');
 assert(!runs.sameSetup(setup,{...setup,temperature:0}),'A temperature makes a new run');assert(!runs.sameSetup({...setup,temperature:0},{...setup,temperature:1}));assert(runs.sameSetup({...setup,temperature:0},{...setup,temperature:0}));
 assert(!runs.sameSetup(setup,{...setup,maxOutput:4000}),'Another output limit makes a new run');
 assert.deepEqual(runs.cleanRuns([{...setup,number:1,startedAt:'2026-11-16T10:00:00Z',temperature:0.5,maxOutput:4000},{...setup,number:2,startedAt:'2026-11-16T11:00:00Z',temperature:'0',maxOutput:4000.5}]).map(run=>[run.temperature,run.maxOutput]),[[0.5,4000],[undefined,undefined]]);
 for(const key of ['requestSettings','reasoningSummary'])assert(runs.RESULT_KEYS.includes(key),key+' is cleared with a result');
 const settings={temperature:0.2,maxOutput:4000,summary:true,store:false},result={status:'done',...setup,score:'A',explanation:'Because.',runNo:1,time:'2026-11-16T10:00:00Z'};
 const study={name:'Settings',createdAt:'2026-11-16T12:00:00Z',texts:{answerFields:[],prompt:PROMPT,requestSettings:settings,runs:[{...setup,temperature:0.2,maxOutput:4000,number:1,startedAt:'2026-11-16T10:00:00Z'}],docs:[{id:'a',name:'a.txt',file:new File(['Text'],'a.txt'),...result,requestSettings:settings,reasoningSummary:'Read the text.',history:[{status:'error',requestSettings:settings,reasoningSummary:'Stopped early.'}]}]},knowledge:{answerFields:[],items:[]}};
 const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup(study)).texts;
 assert.deepEqual(restored.requestSettings,settings);assert.deepEqual(restored.docs[0].requestSettings,settings);assert.equal(restored.docs[0].reasoningSummary,'Read the text.');assert.equal(restored.docs[0].history[0].reasoningSummary,'Stopped early.');assert.deepEqual([restored.runs[0].temperature,restored.runs[0].maxOutput],[0.2,4000]);
 for(const bad of [{temperature:3},{maxOutput:5},{summary:'yes'},{store:true}])await assert.rejects(async()=>backup.decodeStudyBackup(await backup.encodeStudyBackup({...study,texts:{...study.texts,requestSettings:bad}})),JSON.stringify(bad));

 // --- Runs and exports --------------------------------------------------------------------------------
 const rows=[{id:'a',name:'a.txt',...result,requestSettings:settings,reasoningSummary:'Read the text, chose A.'},{id:'b',name:'b.txt',...result,status:'error',error:'Cut short.',score:undefined,explanation:undefined,requestSettings:settings,reasoningSummary:'Stopped early.'},{id:'c',name:'c.txt',...result,runNo:2,model:'gpt-6-sol'},{id:'d',name:'d.txt',...result,runNo:3,requestSettings:{summary:true}},{id:'e',name:'e.txt',...result,runNo:3}];
 const dataset={kind:'texts',rows,runs:[{...setup,temperature:0.2,maxOutput:4000,number:1,startedAt:'2026-11-16T10:00:00Z'},{...setup,model:'gpt-6-sol',number:2,startedAt:'2026-11-16T11:00:00Z'},{...setup,number:3,startedAt:'2026-11-16T12:00:00Z'}],columns:[],samples:[]};
 const lines=exporting.runLines(dataset);assert.deepEqual(lines.map(line=>line.summary),['on','off','in part']);assert.deepEqual(lines.map(line=>[line.temperature,line.maxOutput]),[[0.2,4000],[undefined,undefined],[undefined,undefined]]);
 const exported={name:'Settings',dataset,lab:'test'},overview=tables.runsOverview(exported,new Map()),col=name=>overview[0].indexOf(name);
 assert.deepEqual(overview[0].slice(col('effort'),col('effort')+5),['effort','thinking','temperature','max_output_tokens','caching'],'The run’s model settings together');assert(col('reasoning_summary_requested')>col('notes'),'The Lab’s own column comes after the shared ones');
 assert.deepEqual(overview.slice(1).map(line=>[line[col('reasoning_summary_requested')],line[col('temperature')],line[col('max_output_tokens')]]),[['yes',0.2,4000],['no','default',12000],['in part','default',12000]]);
 const long=tables.requestsTable(exported,undefined,new Map()),at=long[0].indexOf('reasoning_summary');
 assert.equal(long[0][at-1],'rationale');assert.equal(long[0][at+1],'parse_error');assert.deepEqual(long.slice(1).map(line=>line[at]),['Read the text, chose A.','Stopped early.','','',''],'A failed request keeps its summary');
 assert(!tables.requestsTable(exported,undefined,new Map(),{reasoning:false})[0].includes('reasoning_summary'),'Left out of the supplementary table');
 assert(tables.requestsTable(exported,[2],new Map())[0].includes('reasoning_summary'),'The column is there (empty) for a run without summaries');
 const workbook=load('lib/research/export-workbook.ts');assert(workbook.isProse('reasoning_summary'),'Kept as text in the workbook');
 // The supplementary repository of the run with the settings: record, README, methods text, and logs.
 const packages=load('lib/research/export-packages.ts'),packStudy={name:'Settings',lab:'test',dataset:{...dataset,rows:rows.map(row=>({...row,file:new File(['Text of '+row.id],row.name),startedAt:'2026-11-16T10:00:00.000Z',time:'2026-11-16T10:00:03.000Z',processing:'instant'}))}};
 const build=run=>packages.buildSupplementary({study:packStudy,read:data.documentReader(packStudy.dataset,file=>file.text()),now:new Date('2026-11-16T12:00:00Z')},run,{texts:false,explanations:true,logs:true});
 const textOf=async value=>typeof value==='string'?value:value instanceof Blob?await value.text():Buffer.from(value).toString('utf8'),read=async(pack,name)=>textOf(pack.files.find(file=>file.path===pack.name+'/'+name).data);
 const pack=await build(1),record=JSON.parse(await read(pack,'metadata.json')),readme=await read(pack,'README.md');
 assert.deepEqual([record.model.reasoning_summary_requested,record.model.temperature,record.model.max_output_tokens],[true,0.2,4000]);
 assert.equal(record.requests_as_sent.bodies[0].body.temperature,0.2);assert.equal(record.requests_as_sent.bodies[0].body.store,false);assert.deepEqual(record.requests_as_sent.bodies[0].body.reasoning,{effort:'medium',summary:'auto'});
 assert(readme.includes('| Temperature | 0.2 |')&&readme.includes('| Max output tokens | 4000 |'),'README: the settings');
 assert(readme.includes('using reasoning effort “medium”, temperature 0.2, and a maximum of 4,000 output tokens.'),readme.split('\n').find(line=>line.startsWith('> ')));
 assert(!(await read(pack,'results/results_by_replicate.csv')).includes('reasoning_summary'),'The supplementary table of requests leaves the summaries out');
 assert.deepEqual((await read(pack,'logs/responses.jsonl')).trim().split('\n').map(line=>JSON.parse(line).response.reasoning_summary),['Read the text, chose A.','Stopped early.'],'The logs keep them');
 const usual=await build(2),usualRecord=JSON.parse(await read(usual,'metadata.json')),usualReadme=await read(usual,'README.md');
 assert.deepEqual([usualRecord.model.reasoning_summary_requested,usualRecord.model.temperature,usualRecord.model.max_output_tokens],[false,'model default',12000]);
 assert(usualReadme.includes('| Temperature | model default |')&&usualReadme.includes('using reasoning effort “medium” and a maximum of 12,000 output tokens.'),usualReadme.split('\n').find(line=>line.startsWith('> ')));
 assert(!(await read(usual,'logs/responses.jsonl')).includes('reasoning_summary'));
 assert.equal(JSON.parse(await read(await build(3),'metadata.json')).model.reasoning_summary_requested,'in part');

 // The workbook of the workspace's "Download results" names a setting only where a result was made with it.
 const ExcelJS=req('exceljs'),settingsOf=async docs=>{const book=new ExcelJS.Workbook();await book.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook(docs,{prompt:PROMPT,model:setup.model,effort:'medium',provider:'openai'}));const out=[];book.getWorksheet('Study settings').eachRow(row=>out.push(String(row.getCell(1).value)+'='+String(row.getCell(2).value)));return out;};
 const base={name:'a.txt',...result,processing:'instant',concurrency:1},plainSheet=await settingsOf([base]);
 for(const label of ['Temperature','Max output tokens','Reasoning summary'])assert(!plainSheet.some(line=>line.startsWith(label+'=')),label+': an export without the settings is the one it was');
 const setSheet=await settingsOf([{...base,requestSettings:settings}]);for(const line of ['Temperature=0.2','Max output tokens=4000','Reasoning summary=Requested'])assert(setSheet.includes(line),line);
 assert.equal((await settingsOf([{...base,requestSettings:{temperature:0}},{...base,name:'b.txt',requestSettings:{temperature:1}}])).filter(line=>line.startsWith('Temperature=')).length,2,'Results made with different settings are listed as two groups');

 // --- The pages: research mode only ------------------------------------------------------------------
 for(const page of ['app/page.tsx','components/model-knowledge.tsx']){
  const source=fs.readFileSync(path.join(root,page),'utf8');
  assert(/const sentRequest=research\?sentRequestSettings\(provider,model,[^;]*requestSettings,effort\):undefined;/.test(source),page);
  assert(source.includes('{research&&<ResearchRequestOptions '),page+': the settings are shown in research mode only');
  assert(source.includes('<ResearchRequestPreview unit="'+(page==='app/page.tsx'?'text':'subject')+'"'),page);
  assert(!/from '@\/components\/research\/(request-options|panels)'/.test(source),page+': research mode’s panels load only when it is switched on');
 }
 const main=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8');assert(main.includes('const heading=')&&main.includes('{preview?<div className="research-setup-head">{heading}{preview}</div>:heading}'),'The standard Lab’s setup heading is as it was');

 console.log('PASS: request settings (temperature, output limit, reasoning summary, OpenAI’s logs): the stored form, what each provider and model is sent now and in a batch, the summary read from every provider’s reply, rejected settings, the request preview, runs, backups, and exports. No provider was called.');
})().catch(error=>{console.error(error);process.exit(1);});
