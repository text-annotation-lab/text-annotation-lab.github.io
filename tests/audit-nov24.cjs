// Regressions for the full-site review of November 24, 2026. Providers, prices, and messages: no temperature for
// the Gemini models that ignore one, cache minimums, cache-read prices, announced price changes, a value at the
// end of a prompt sent whole, no empty part before a PDF, a prompt that opens like the earlier layout, billing
// advice for an empty Claude balance, reasoning that cannot be turned off, long texts in other scripts, and a
// cost estimate that never falls below zero. Mocked only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require(path.join(root,'node_modules/typescript')),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=()=>Response.json({});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};
 new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;
}
(async()=>{
 const rs=load('lib/request-settings.ts'),frame=load('lib/request-frame.ts'),inserts=load('lib/prompt-inserts.ts'),pricing=load('lib/cost-estimate/pricing.ts'),engine=load('lib/cost-estimate/engine.ts'),providers=load('lib/providers.ts');

 // Temperature. Google ignores one from Gemini 3.6 Flash and 3.5 Flash-Lite on, so none is sent or recorded.
 for(const [model,takes] of [['gemini-2.5-flash-lite',true],['gemini-3.1-flash-lite',true],['gemini-3.1-pro-preview',true],['gemini-3.5-flash-lite',false],['gemini-3.6-flash',false],['gemini-3.8-flash',false],['gemini-4-hydrogen',false],['gemini-4-argon',false],['gemini-4-carbon',false],['gemini-4-neon',false],['gemini-5-pro',false],['gemini-3.10-flash',false]]){
  assert.equal(rs.takesTemperature('gemini',model,'low'),takes,model);
  assert.equal(rs.takesTemperature('openrouter','google/'+model,'low'),takes,'google/'+model);
  const body=frame.providerBody({provider:'gemini',model,effort:'low',prompt:'Rate the tone.',schemaPrompt:'Rate the tone.',answerFields:[],request:{temperature:0.3}},{filename:'a.txt',text:'A text.'});
  assert.equal(body.generationConfig.temperature,takes?0.3:undefined,model);
  assert.deepEqual(rs.sentRequestSettings('gemini',model,{temperature:0.3},'low'),takes?{temperature:0.3}:undefined,model);
 }
 // OpenRouter offers OpenAI's models from GPT-5.6 on without a temperature; the direct API still takes one before GPT-6.2.
 for(const model of ['gpt-5.6-luna','gpt-6-luna','gpt-6-sol','gpt-6.1-terra','gpt-6.2-sol']){assert.equal(rs.takesTemperature('openrouter','openai/'+model,'medium'),false,model);assert.equal(rs.takesTemperature('openai',model,'medium'),!model.startsWith('gpt-6.2'),model);}
 assert.equal(rs.takesTemperature('openrouter','mistralai/mistral-small','medium'),true);

 // The shortest prompt a model caches.
 const least=(provider,model)=>rs.cacheSupport(provider,model)?.minTokens;
 for(const [model,min] of [['claude-haiku-5-5',512],['claude-sonnet-5-5',512],['claude-opus-5-5',512],['claude-fable-5-2',512],['claude-haiku-4-5-20251001',4096],['claude-opus-4-6',4096],['claude-opus-4-5',4096],['claude-opus-4-7',2048],['claude-mythos-preview',2048],['claude-opus-4-8',1024],['claude-sonnet-5',1024],['claude-sonnet-4-6',1024],['claude-sonnet-4-5',1024]])assert.equal(least('anthropic',model),min,model);
 for(const model of ['gemini-4-carbon','gemini-4-hydrogen','gemini-4-neon','gemini-4-argon','gemini-3.8-flash','gemini-3.6-flash'])assert.equal(least('gemini',model),4096,model);

 // Prices. Every model on the Lab's lists has a cache-read rate, so a run that read from the cache gets a cost.
 for(const [provider,spec] of Object.entries(providers.PROVIDERS))for(const model of spec.models)assert(pricing.priceFor(provider,model)?.cacheRead!==undefined,provider+' '+model+' has a cache-read rate');
 assert.equal(pricing.priceFor('openai','gpt-6-sol').cacheRead,.1);assert.equal(pricing.priceFor('gemini','gemini-4-hydrogen').cacheRead,.05);
 // A dated snapshot and its alias share a price.
 assert.deepEqual(pricing.priceFor('anthropic','claude-haiku-4-5'),pricing.priceFor('anthropic','claude-haiku-4-5-20251001'));assert(pricing.priceFor('anthropic','claude-haiku-4-5'));
 // Announced changes: Gemini 4 Carbon doubles on December 1, also through OpenRouter; Gemini 2.5 Pro and Flash
 // are then served, and billed, as newer models.
 const at=(provider,model,date)=>{const p=pricing.priceFor(provider,model,date);return [p.input,p.output];};
 assert.deepEqual(at('openrouter','google/gemini-4-carbon','2026-11-30'),[2,10]);assert.deepEqual(at('openrouter','google/gemini-4-carbon','2026-12-01'),[4,20]);
 assert.deepEqual(at('gemini','gemini-4-carbon','2026-11-30'),[2,10]);assert.deepEqual(at('gemini','gemini-4-carbon','2026-12-01'),[4,20]);
 const pro=pricing.priceFor('gemini','gemini-2.5-pro','2026-11-30'),later=pricing.priceFor('gemini','gemini-2.5-pro','2026-12-01'),flash=pricing.priceFor('gemini','gemini-3.8-flash','2026-12-01');
 assert(pro.threshold,'Gemini 2.5 Pro has a long-request price until December 1');assert.equal(later.threshold,undefined);assert.equal(later.longInput,undefined);assert.deepEqual([later.input,later.output],[flash.input,flash.output]);
 assert(!('from' in later),'the date of a change is not part of a price');

 // A value at the end of a prompt is sent whole: an empty one, or one that ends with a space, leaves the cache
 // mark where it is and the request as the record has it.
 {const prompt=frame.formText('Rate the sentiment.\nSpeaker: {{meta.speaker}}\n'),head='Rate the sentiment.\r\nSpeaker: ',settings={named:true,fields:[{name:'Sentiment',type:'category',values:['pos','neg'],description:''}]};
  const sent=value=>frame.providerBody({provider:'anthropic',model:'claude-haiku-5-5',effort:'low',prompt:inserts.fillInserts(prompt,[value]),schemaPrompt:prompt,answerFields:['Sentiment'],settings,request:{cache:true},inserts:true},{filename:'a.txt',text:'World'});
  const record=frame.requestFrame({provider:'anthropic',model:'claude-haiku-5-5',effort:'low',prompt,answerFields:['Sentiment'],answerSettings:settings,requestSettings:{cache:true},inserts:true,layout:'message'},false);
  for(const value of ['Lincoln','','Lincoln ','  ']){
   const body=sent(value),content=body.messages[0].content;
   assert.equal(content[0].text,head,'the part every text shares ends before the placeholder ('+JSON.stringify(value)+')');assert(content[0].cache_control);
   assert.equal(content.map(part=>part.text).join(''),head+value+'\n\n<text>\nWorld\n</text>');
   assert.deepEqual(frame.fillRequest(record.body,{filename:'a.txt',text:'World',inserts:new Map([['meta.speaker',value]])}),JSON.parse(JSON.stringify(body)),'the record, filled in, is the request ('+JSON.stringify(value)+')');
  }
  assert.equal(inserts.promptEnd('Rate. \n','Rate. \n'),'Rate.');assert.equal(inserts.promptEnd('Year: \r\n','Year: {{meta.year}}\n'),'Year: ');assert.equal(inserts.promptEnd('Year: 1900 \n\n','Year: {{meta.year}}\n\n'),'Year: 1900 ');assert.equal(inserts.promptEnd('By X.\nAnswer in JSON.\n','By {{id}}.\nAnswer in JSON.\n'),'By X.\nAnswer in JSON.');
 }
 // A prompt that is only the place for the text, with the instructions in the system prompt: a PDF goes alone.
 for(const provider of ['anthropic','openai','gemini','openrouter']){
  const model=providers.PROVIDERS[provider].models[0],body=frame.providerBody({provider,model,effort:'low',prompt:'',schemaPrompt:'{{text}}',answerFields:['S'],settings:{named:true,fields:[{name:'S',type:'category',values:['a','b'],description:''}]},request:{system:'Rate the tone.'},spots:[0]},{filename:'a.pdf',pdf:'AAAA'});
  const content=provider==='openai'?body.input[body.input.length-1].content:provider==='gemini'?body.contents[body.contents.length-1].parts:body.messages[body.messages.length-1].content;
  assert.equal(content.length,1,provider+': the PDF alone');assert(!content.some(part=>part.text===''||part.type==='text'||part.type==='input_text'),provider+': no empty text part');
 }
 // A prompt of today's layout that opens with the words the earlier layout opened its document line with.
 assert.deepEqual(frame.framePrompt('',[{type:'text',text:'Document filename: check tone.\n\n<text>\n<<DOCUMENT_TEXT>>\n</text>'}]),{prompt:'Document filename: check tone.'});
 assert.deepEqual(frame.framePrompt('Rate the tone.',[{type:'text',text:frame.documentNote('anthropic',false,'<<DOCUMENT_FILENAME>>')},{type:'text',text:'<<DOCUMENT_TEXT>>'}]),{prompt:'Rate the tone.'});
 assert.deepEqual(frame.framePrompt('Rate the tone.',frame.documentNote('openrouter',false,'<<DOCUMENT_FILENAME>>')+'\n\n<<DOCUMENT_TEXT>>'),{prompt:'Rate the tone.'});

 // An empty Claude balance arrives as HTTP 400: the advice is about billing, not about the document.
 {const {providerError}=load('lib/provider-errors.ts'),text=providerError('anthropic',400,{type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'}});
  assert.match(text,/billing or credit problem/);assert(!/document/.test(text),text);assert.match(text,/\(HTTP 400\.\)$/);
  assert.match(providerError('anthropic',400,{type:'error',error:{type:'invalid_request_error',message:'messages: text content blocks must be non-empty'}}),/rejected the request/);
 }

 // OpenRouter: a model that must reason and names no levels is not offered "none".
 {const models=load('app/api/models/route.ts'),entry=(id,reasoning)=>({id,architecture:{output_modalities:['text']},supported_parameters:['reasoning'],reasoning});
  mock=async()=>Response.json({data:[entry('x/must',{mandatory:true,supported_efforts:null}),entry('x/may',{mandatory:false,supported_efforts:null}),entry('x/named',{mandatory:true,supported_efforts:['high','low']})]});
  const response=await models.POST(new Request('https://lab.test/api/models',{method:'POST',headers:{origin:'https://lab.test','X-Lab-Provider':'openrouter',authorization:'Bearer sk-or-v1-0123456789abcdef'}}));
  assert.deepEqual((await response.json()).models,[{id:'x/must',efforts:['minimal','low','medium','high','xhigh','max']},{id:'x/may'},{id:'x/named',efforts:['low','high']}]);
  assert(!providers.effortChoices('openrouter','x/must',['minimal','low','medium','high','xhigh','max']).includes('none'));
 }

 // A long text in another script is read and flagged, not passed over for its size in bytes.
 {const est=load('lib/student-estimate.ts'),russian=new File(['слово '.repeat(38500)],'russian.txt'),english=new File(['word '.repeat(20000)],'english.txt');
  assert(russian.size<200000*3.2,'the earlier shortcut would have passed this file over');
  const rows=[russian,english].map((file,i)=>({id:'r'+i,name:file.name,file,status:'pending'}));
  assert.deepEqual((await est.tooLongTexts({provider:'anthropic',model:'claude-haiku-4-5-20251001',prompt:'Classify the tone.',rows})).names,['russian.txt']);
 }

 // Cost estimate: with web research and prompt caching near a long-request price, no part falls below zero, and
 // the output-limit warning looks at every text.
 {const inputs=Array.from({length:10},()=>({tokens:{low:5000,high:5000}}));
  for(const webSearch of [true,false])for(const size of [60000,85500,120000,200000]){const e=engine.estimate({provider:'anthropic',model:'claude-haiku-5-5',effort:'low',prompt:'x'.repeat(size),system:'y'.repeat(92000),cache:true,webSearch},inputs,[]);assert(e.inputCost.low>=0&&e.inputCost.low<=e.inputCost.high,`input cost ${e.inputCost.low} to ${e.inputCost.high} (${size}, ${webSearch})`);}
  const warning=/output limit constrains/,config={provider:'gemini',model:'gemini-2.5-flash-lite',effort:'dynamic',prompt:'Rate the tone.',maxTokens:2500},short={tokens:{low:50,high:50}},long={tokens:{low:400000,high:400000}};
  const first=engine.estimate(config,[long,short]).notes.some(note=>warning.test(note)),last=engine.estimate(config,[short,long]).notes.some(note=>warning.test(note));
  assert.equal(first,last,'the order of the texts does not decide the warning');
 }
 console.log('audit-nov24 ok');
})().catch(error=>{console.error(error);process.exit(1);});
