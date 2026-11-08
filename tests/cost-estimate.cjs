// Offline behavioral tests; provider traffic is forbidden.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',source)(out,id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id),()=>{throw Error('Unexpected provider call');});return out;}
const {estimate,textTokens,usageSample,outputAssumption,money,tokens}=load('lib/cost-estimate/engine.ts');const {PRICES,priceFor}=load('lib/cost-estimate/pricing.ts');
const config={provider:'openai',model:'gpt-6-luna',prompt:'Return a sentiment category and a brief explanation.',effort:'none',maxTokens:12000,defaultExplanation:true};
const inputs=Array.from({length:40},()=>({tokens:textTokens('This is a representative presidential speech. '.repeat(100))}));
const base=estimate(config,inputs);
assert.equal(tokens({low:1234,high:1234}),(1234).toLocaleString());assert.equal(money({low:.123,high:.123}),'$0.12');
assert.equal(base.count,40);assert.equal(base.reasoning.high,0);assert(base.total.low>0&&base.total.high>base.total.low);
assert.equal(base.batch.low,base.total.low/2);assert.equal(base.batch.high,base.total.high/2);
assert(Math.abs(base.total.low-(base.input.low*.1+base.visible.low*.5)/1e6)<1e-12);
assert(Math.abs(base.total.high-(base.input.high*.1+base.visible.high*.5)/1e6)<1e-12);
const system=estimate({...config,system:'Repeated rubric. '.repeat(100)},inputs);assert(system.input.low>base.input.low&&system.total.high>base.total.high);
const medium=estimate({...config,effort:'medium'},inputs),high=estimate({...config,effort:'high'},inputs);assert(high.total.high>medium.total.high&&medium.total.high>base.total.high);
const capped=estimate({...config,effort:'max',maxTokens:100},inputs);assert(capped.visible.high+capped.reasoning.high<=40*100+.000001);
assert(estimate({...config,effort:'1024'},inputs).reasoning.high<=40*1024);
const label=outputAssumption({...config,defaultExplanation:false,prompt:'Return only the category.'});const paragraph=outputAssumption({...config,prompt:'Return a category and one paragraph of explanation.'});const detailed=outputAssumption({...config,prompt:'Return a detailed explanation of 500 words.'});assert(label.tokens.high<paragraph.tokens.high&&paragraph.tokens.high<detailed.tokens.high);
const structured=estimate({...config,fields:[{name:'category',type:'category'},{name:'reasoning',type:'string'},{name:'evidence',type:'string'}]},inputs);assert(structured.total.high>base.total.high);
const chunked=estimate(config,Array.from({length:80},()=>({tokens:textTokens('This is a representative presidential speech. '.repeat(50))})));assert(chunked.total.high>base.total.high);
for(const provider of ['openai','anthropic','gemini']){const model=provider==='openai'?'gpt-6-luna':provider==='anthropic'?'claude-haiku-5-5':'gemini-3.1-flash-lite';const e=estimate({...config,provider,model},inputs);assert.equal(e.batch.high,e.total.high*.5);}
const low=estimate({...config,model:'gpt-6-sol'},[{tokens:{low:270000,high:270000}}]);const long=estimate({...config,model:'gpt-6-sol'},[{tokens:{low:280000,high:280000}}]);assert(long.inputCost.low>low.inputCost.low*1.9);assert(long.visibleCost.high>=low.visibleCost.high*1.5-.00001);
const hShort=estimate({...config,provider:'anthropic',model:'claude-haiku-5-5'},[{tokens:{low:70000,high:70000}}]);const hLong=estimate({...config,provider:'anthropic',model:'claude-haiku-5-5'},[{tokens:{low:80000,high:80000}}]);assert(hLong.inputCost.low>hShort.inputCost.low*4);
assert.equal(priceFor('gemini','gemini-3.8-flash','2026-12-31').input,.75);assert.equal(priceFor('gemini','gemini-3.8-flash','2027-01-01').input,1.5);
assert.equal(priceFor('gemini','gemini-4-argon','2026-11-30').input,2);assert.equal(priceFor('gemini','gemini-4-argon','2026-12-01').input,4);assert.equal(priceFor('gemini','gemini-4-argon','2026-12-01').output,20);
assert.equal(priceFor('openai','gpt-6.1-terra').input,1);assert.equal(priceFor('openai','gpt-6.1-terra').output,5);
assert(estimate({...config,model:'unknown'},inputs).unknown);assert(estimate(config,[]).unknown);assert(estimate({...config,prompt:''},inputs).unknown);
assert.equal(usageSample('openai',{input_tokens:500,output_tokens:200,output_tokens_details:{reasoning_tokens:150}}).visible,50);
assert.equal(usageSample('gemini',{promptTokenCount:500,candidatesTokenCount:50,thoughtsTokenCount:150}).output,200);
assert.equal(usageSample('anthropic',{input_tokens:20,cache_read_input_tokens:30,cache_creation_input_tokens:50,output_tokens:100}).input,100);
assert.equal(usageSample('openai',{total_tokens:900}),undefined);
const calibrated=estimate({...config,effort:'medium'},inputs,Array.from({length:12},()=>({input:500,output:120,visible:70,reasoning:50})));assert(calibrated.total.high<medium.total.high);assert.equal(calibrated.samples,12);
const web=estimate({...config,webSearch:true},inputs);assert(web.total.low>base.total.low&&Math.abs(web.searchCost.low-.4)<1e-10);assert.equal(web.batch,undefined);assert(web.input.low>base.input.low);
const cached=estimate({...config,cache:true},inputs);assert.equal(cached.total.low,base.total.low);assert(cached.total.high>base.total.high);
assert(!money({low:.000001,high:.00002}).includes('$0.00–'));assert(textTokens('漢字'.repeat(100)).high>100);
for(const [model,p] of Object.entries(PRICES)){const e=estimate({...config,provider:p.provider,model},inputs);assert(!e.unknown,model);assert(Number.isFinite(e.total.high)&&e.total.high>=e.total.low,model);}
console.table([{task:'40 short classifications, no reasoning',range:money(base.total)},{task:'40 classifications, medium reasoning',range:money(medium.total)},{task:'40 classifications, high reasoning',range:money(high.total)},{task:'40 classifications with web research',range:money(web.total)},{task:'80 smaller chunks, no reasoning',range:money(chunked.total)}]);
console.log('PASS: arithmetic, all three Batch discounts, prompts/system instructions, reasoning budgets/caps, structured answers, chunking, context tiers, future tariffs, usage calibration, web research, caching, missing rates, and sub-cent display. No provider calls.');
