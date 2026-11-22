// Research mode: your own price for a model, used for the cost estimate before a run. It is kept in the browser,
// per provider and model; the standard Lab never uses it; and it is no part of a study, a backup, or an export.
// No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=0,mock=async()=>Response.json({});
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+(fs.existsSync(path.resolve(path.dirname(filename),id+'.tsx'))?'.tsx':'.ts')))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls++;return mock(String(url),options);});return exports;}
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
// A stand-in for the browser's storage. broken: reading or writing fails, as where storage is switched off.
const store=new Map(),broken={read:false,write:false};
globalThis.window={localStorage:{getItem:key=>{if(broken.read)throw Error('no storage');return store.has(key)?store.get(key):null;},setItem:(key,value)=>{if(broken.write)throw Error('no storage');store.set(key,String(value));},removeItem:key=>{store.delete(key);}},addEventListener(){},removeEventListener(){}};
const STORE='text-annotation-lab:own-prices';

(async()=>{
 const pricing=load('lib/cost-estimate/pricing.ts'),engine=load('lib/cost-estimate/engine.ts'),student=load('lib/student-estimate.ts'),{PROVIDERS}=load('lib/providers.ts'),own=load('lib/own-prices.ts');
 const {ownRates,priceFor,PRICES}=pricing;

 // --- The rates an estimate uses with your own price ------------------------------------------------
 // A listed model: the two prices are replaced; the model's other terms stay; long-request and dated prices go.
 assert.deepEqual(ownRates('openai','gpt-6.1-terra',{input:3,output:9}),{provider:'openai',input:3,output:9,batch:true,cacheRead:.05});
 assert.deepEqual(ownRates('openai','gpt-6-sol',{input:3,output:9}),{provider:'openai',input:3,output:9,batch:true});
 assert.deepEqual(ownRates('anthropic','claude-sonnet-5-5',{input:1,output:2}),{provider:'anthropic',input:1,output:2,batch:true,tokenMultiplier:1.3,cacheRead:.05});
 assert.deepEqual(ownRates('anthropic','claude-haiku-5-5',{input:1,output:2}),{provider:'anthropic',input:1,output:2,batch:true,tokenMultiplier:1.3,cacheRead:.1});
 assert.deepEqual(ownRates('gemini','gemini-4-argon',{input:1,output:2},'2027-06-01'),{provider:'gemini',input:1,output:2,batch:true,cacheRead:.05},'A later listed price does not replace a typed one');
 assert.deepEqual(ownRates('gemini','gemini-2.5-flash-lite',{input:1,output:2}),{provider:'gemini',input:1,output:2,batch:true,cacheRead:.1,cacheReadBatch:.1});
 assert.deepEqual(ownRates('openrouter','anthropic/claude-sonnet-5.5',{input:1,output:2}),{provider:'openrouter',input:1,output:2,batch:false,tokenMultiplier:1.3},'No note about the catalogue’s rates');
 assert.deepEqual(ownRates('openai','gpt-6.1-sol-2026-10-01',{input:1,output:2}),{provider:'openai',input:1,output:2,batch:true,cacheRead:.05},'A dated ID has its model’s terms');
 // Zero is a price.
 assert.deepEqual(ownRates('openai','gpt-6-sol',{input:0,output:0}),{provider:'openai',input:0,output:0,batch:true});
 // A model without a listed price: its provider's usual terms.
 assert.deepEqual(ownRates('openai','gpt-5.5',{input:3,output:12}),{provider:'openai',input:3,output:12,batch:true});
 assert.deepEqual(ownRates('gemini','gemini-3.7-flash',{input:3,output:12}),{provider:'gemini',input:3,output:12,batch:true});
 assert.deepEqual(ownRates('openrouter','mistralai/mistral-small',{input:3,output:12}),{provider:'openrouter',input:3,output:12,batch:false});
 for(const id of ['claude-opus-4-7','claude-opus-4-8','claude-opus-5','claude-sonnet-10','claude-mythos-5-2','claude-opus-4-7-20260301','claude-newname-6'])assert.deepEqual(ownRates('anthropic',id,{input:3,output:12}),{provider:'anthropic',input:3,output:12,batch:true,tokenMultiplier:1.3,cacheRead:.1},id);
 for(const id of ['claude-3-5-haiku-latest','claude-3-haiku-20240307','claude-opus-4-1-20250805','claude-sonnet-4-20250514','claude-opus-4-latest','claude-opus-4','claude-instant-1'])assert.deepEqual(ownRates('anthropic',id,{input:3,output:12}),{provider:'anthropic',input:3,output:12,batch:true,cacheRead:.1},id);
 for(const id of ['anthropic/claude-opus-4.7','anthropic/claude-opus-5','anthropic/claude-opus-4.8:thinking'])assert.deepEqual(ownRates('openrouter',id,{input:3,output:12}),{provider:'openrouter',input:3,output:12,batch:false,tokenMultiplier:1.3},id);
 for(const id of ['anthropic/claude-3.5-haiku','anthropic/claude-haiku-4.5','anthropic/claude-opus-4.6:thinking','anthropic/claude-sonnet-4'])assert.deepEqual(ownRates('openrouter',id,{input:3,output:12}),{provider:'openrouter',input:3,output:12,batch:false},id);
 // The rule for Claude models agrees with every Claude price the Lab lists.
 for(const [id,price] of Object.entries(PRICES)){const claude=price.provider==='anthropic'?id:price.provider==='openrouter'&&id.startsWith('anthropic/')?id:'';if(!claude)continue;const {[id]:listed,...others}=PRICES;pricing.PRICES[id]=undefined;try{assert.equal(ownRates(price.provider,id,{input:1,output:1}).tokenMultiplier??1,price.tokenMultiplier??1,id);}finally{pricing.PRICES[id]=listed;}}
 // Typing the listed price changes nothing in the estimate of a request below any long-request threshold,
 // with and without prompt caching, instant and as a batch.
 const inputs=[{tokens:{low:900,high:1300}},{tokens:{low:2000,high:2600}}],long='Rate the tone of the speech from 1 (bleak) to 5 (hopeful). '.repeat(120);
 let compared=0;
 for(const [id,price] of Object.entries(PRICES))for(const cached of [false,true])for(const batch of [false,true]){
  const c={provider:price.provider,model:id,prompt:long,effort:'medium',...(cached?{cache:true,batch}:{})},listed=priceFor(price.provider,id);
  const a=engine.estimate(c,inputs),b=engine.estimate({...c,rates:ownRates(price.provider,id,{input:listed.input,output:listed.output})},inputs);
  assert.deepEqual({...b,notes:b.notes.filter(note=>note!==listed.note)},{...a,notes:a.notes.filter(note=>note!==listed.note)},id);
  assert.equal(b.notes.includes(listed.note),false,id);compared++;
 }
 assert(compared>=4*30);

 // --- The estimate ------------------------------------------------------------------------------------
 const file=new File(['A real uploaded text. '.repeat(400)],'real.txt'),rows=[{id:'1',file,status:'pending'}];
 const c={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Return sentiment and explain in two sentences.',rows};
 const listed=await student.studentEstimate(c);
 assert(!('ownPrice' in listed));assert(!listed.unknown);assert(listed.total.high>0);
 // Research mode without a price of your own: the same estimate.
 assert.deepEqual(await student.studentEstimate({...c,research:true}),listed);
 // Twice the listed price: twice the estimate, and the estimate carries the price.
 const p=priceFor('openai','gpt-6-luna'),doubled=await student.studentEstimate({...c,research:true,ownPrice:{input:p.input*2,output:p.output*2}});
 assert.deepEqual(doubled.ownPrice,{input:p.input*2,output:p.output*2});
 for(const edge of ['low','high']){assert(Math.abs(doubled.total[edge]-listed.total[edge]*2)<1e-12,edge);assert(Math.abs(doubled.batch[edge]-listed.batch[edge]*2)<1e-12,edge);}
 assert.deepEqual([doubled.input,doubled.visible,doubled.reasoning],[listed.input,listed.visible,listed.reasoning],'The tokens are the same');
 // Only the input price raised: only the input cost changes.
 const dearer=await student.studentEstimate({...c,ownPrice:{input:p.input*10,output:p.output}});
 assert(Math.abs(dearer.inputCost.high-listed.inputCost.high*10)<1e-12);assert.deepEqual([dearer.visibleCost,dearer.reasoningCost],[listed.visibleCost,listed.reasoningCost]);
 // A price of zero is used as it is.
 const free=await student.studentEstimate({...c,ownPrice:{input:0,output:0}});assert.deepEqual(free.total,{low:0,high:0});assert(!free.unknown);
 // A model without a listed price: the standard Lab's message, research mode's, and an estimate once a price is typed.
 const other={...c,model:'gpt-5.5',effort:'default'};
 assert.equal((await student.studentEstimate(other)).unknown,'No verified price is available for this model. Choose a model with listed rates.');
 assert.equal((await student.studentEstimate({...other,research:true})).unknown,'The Lab has no price for this model. Type its price under Sampling & limits to have its cost estimated.');
 const typed=await student.studentEstimate({...other,research:true,ownPrice:{input:3,output:12}});
 assert(!typed.unknown);assert(typed.total.low>0&&typed.total.high>typed.total.low);assert(typed.batch,'A batch at OpenAI, Anthropic, and Gemini costs half');assert.deepEqual(typed.ownPrice,{input:3,output:12});
 const routed=await student.studentEstimate({...c,provider:'openrouter',model:'mistralai/mistral-small',effort:'default',research:true,ownPrice:{input:3,output:12}});
 assert(!routed.unknown);assert.equal(routed.batch,undefined);assert(!routed.notes.some(note=>note.includes('catalogue')));
 // An unlisted model that the Lab does have a price for needs none typed.
 assert(!PROVIDERS.anthropic.models.includes('claude-opus-4-6'));assert(!(await student.studentEstimate({...c,provider:'anthropic',model:'claude-opus-4-6',effort:'high',research:true})).unknown);
 // Prompt caching with a typed price: Claude's usual cache rate; no savings assumed where the Lab knows no rate.
 const cachedClaude=await student.studentEstimate({...c,provider:'anthropic',model:'claude-opus-5',effort:'high',prompt:long,cache:true,research:true,ownPrice:{input:5,output:25}});
 assert(cachedClaude.notes.some(note=>note.startsWith('Prompt caching is on. The lower estimate assumes')),cachedClaude.notes.join(' | '));
 const cachedOpenAI=await student.studentEstimate({...c,model:'gpt-7',effort:'default',prompt:long,cache:true,research:true,ownPrice:{input:5,output:25}});
 assert(cachedOpenAI.notes.some(note=>note.startsWith('Prompt caching is on, but the Lab lists no cache rate for this model')),cachedOpenAI.notes.join(' | '));
 // Nothing left to estimate: that message stands, with or without a price.
 const done=[{id:'1',file,status:'done'}];
 for(const extra of [{},{research:true},{research:true,ownPrice:{input:3,output:12}}])assert.match((await student.studentEstimate({...other,...extra,rows:done})).unknown,/^All annotations are complete\./);
 // Counting the input with the provider keeps the price.
 mock=async url=>{assert.equal(url,'/api/count-tokens');return Response.json({inputTokens:4321});};
 const counted=await student.countStudentInputs({...c,research:true,ownPrice:{input:7,output:9},apiKey:'sk-test-0123456789abcdef',signal:new AbortController().signal});
 assert.equal(counted.inputBasis,'provider');assert.deepEqual(counted.ownPrice,{input:7,output:9});assert(Math.abs(counted.inputCost.high-4321*7/1e6)<1e-12);assert.equal(calls,1);

 // --- Where the prices are kept -------------------------------------------------------------------------
 assert.equal(own.ownPrice('openai','gpt-6-luna'),undefined);assert.equal(store.size,0,'Reading stores nothing');
 own.setOwnPrice('openai','gpt-6-luna',{input:1,output:.075});
 assert.deepEqual(own.ownPrice('openai','gpt-6-luna'),{input:1,output:.075});
 assert.equal(store.get(STORE),'{"openai:gpt-6-luna":{"input":1,"output":0.075}}');assert.deepEqual([...store.keys()],[STORE]);
 // Per provider and model: the same ID at another provider has no price.
 assert.equal(own.ownPrice('openrouter','gpt-6-luna'),undefined);assert.equal(own.ownPrice('openai','gpt-6-sol'),undefined);
 own.setOwnPrice('openrouter','openai/gpt-6-luna',{input:2,output:4});
 assert.deepEqual(JSON.parse(store.get(STORE)),{'openai:gpt-6-luna':{input:1,output:.075},'openrouter:openai/gpt-6-luna':{input:2,output:4}});
 // Anything that is not a price changes nothing.
 for(const bad of [{input:-1,output:1},{input:1,output:NaN},{input:Infinity,output:1},{input:'1',output:1},{input:1},{input:1,output:own.MAX_OWN_PRICE+1}]){own.setOwnPrice('openai','gpt-6-luna',bad);assert.deepEqual(own.ownPrice('openai','gpt-6-luna'),{input:1,output:.075});}
 // Extra properties are not kept.
 own.setOwnPrice('openai','gpt-6-sol',{input:0,output:own.MAX_OWN_PRICE,note:'x',apiKey:'sk-SECRET'});assert.deepEqual(own.ownPrice('openai','gpt-6-sol'),{input:0,output:own.MAX_OWN_PRICE});assert(!store.get(STORE).includes('SECRET'));
 // Back to the Lab's price.
 own.setOwnPrice('openai','gpt-6-sol',null);own.setOwnPrice('openai','gpt-6-luna',null);
 assert.equal(own.ownPrice('openai','gpt-6-luna'),undefined);assert.equal(store.get(STORE),'{"openrouter:openai/gpt-6-luna":{"input":2,"output":4}}');
 own.setOwnPrice('openai','never-set',null);assert.equal(store.get(STORE),'{"openrouter:openai/gpt-6-luna":{"input":2,"output":4}}');
 // A price typed in another tab stays when one is typed here.
 store.set(STORE,'{"openrouter:openai/gpt-6-luna":{"input":2,"output":4},"anthropic:claude-opus-5-5":{"input":9,"output":9}}');
 own.setOwnPrice('gemini','gemini-4-argon',{input:4,output:20});
 assert.deepEqual(Object.keys(JSON.parse(store.get(STORE))),['openrouter:openai/gpt-6-luna','anthropic:claude-opus-5-5','gemini:gemini-4-argon']);assert.deepEqual(own.ownPrice('anthropic','claude-opus-5-5'),{input:9,output:9});
 // What storage holds is checked entry by entry.
 assert.deepEqual(own.cleanOwnPrices({'openai:gpt-6-luna':{input:1,output:2,extra:3},'openai:a':{input:-1,output:2},'openai:b':{input:1},'openai:c':null,'openai:d':[1,2],'openai:e':{input:'1',output:'2'},'other:gpt':{input:1,output:2},'gpt-6-luna':{input:1,output:2},'openai:':{input:1,output:2},'openai:has space':{input:1,output:2},['openai:'+'x'.repeat(201)]:{input:1,output:2},'gemini:g':{input:0,output:0}}),{'openai:gpt-6-luna':{input:1,output:2},'gemini:g':{input:0,output:0}});
 for(const bad of [null,undefined,'x',7,[],[{input:1,output:2}]])assert.deepEqual(own.cleanOwnPrices(bad),{});
 // The latest 200 are kept.
 const many=Object.fromEntries(Array.from({length:230},(_,i)=>['openai:m'+i,{input:i,output:i}])),kept=own.cleanOwnPrices(many);
 assert.equal(Object.keys(kept).length,200);assert.equal(Object.keys(kept)[0],'openai:m30');assert.equal(Object.keys(kept).at(-1),'openai:m229');
 // A price set again counts as the latest.
 own.setOwnPrice('openrouter','openai/gpt-6-luna',{input:3,output:5});assert.equal(Object.keys(JSON.parse(store.get(STORE))).at(-1),'openrouter:openai/gpt-6-luna');
 // Storage that cannot be written: the prices last while the page is open, each one of them.
 broken.write=true;const before=store.get(STORE);
 own.setOwnPrice('openai','gpt-6-sol',{input:6,output:7});own.setOwnPrice('openai','gpt-6-astra',{input:8,output:9});
 assert.deepEqual(own.ownPrice('openai','gpt-6-sol'),{input:6,output:7});assert.deepEqual(own.ownPrice('openai','gpt-6-astra'),{input:8,output:9});assert.deepEqual(own.ownPrice('gemini','gemini-4-argon'),{input:4,output:20});assert.equal(store.get(STORE),before);
 broken.write=false;own.setOwnPrice('openai','gpt-6-astra',null);
 assert.deepEqual(own.ownPrice('openai','gpt-6-sol'),{input:6,output:7});assert(store.get(STORE).includes('"openai:gpt-6-sol":{"input":6,"output":7}'));
 // Storage that cannot be read at all.
 broken.read=true;broken.write=true;own.setOwnPrice('openai','gpt-6-luna',{input:1,output:1});assert.deepEqual(own.ownPrice('openai','gpt-6-luna'),{input:1,output:1});broken.read=false;broken.write=false;
 // A fresh page reads what the last one stored, and survives storage that holds something else.
 const fresh=()=>{cache.delete(path.join(root,'lib/own-prices.ts'));return load('lib/own-prices.ts');};
 store.set(STORE,'{"openai:gpt-6-luna":{"input":1.5,"output":2.5},"openai:bad":{"input":-1,"output":1}}');
 let next=fresh();assert.deepEqual(next.ownPrice('openai','gpt-6-luna'),{input:1.5,output:2.5});assert.equal(next.ownPrice('openai','bad'),undefined);
 store.set(STORE,'not json');next=fresh();assert.equal(next.ownPrice('openai','gpt-6-luna'),undefined);
 next.setOwnPrice('openai','gpt-6-luna',{input:1,output:2});assert.equal(store.get(STORE),'{"openai:gpt-6-luna":{"input":1,"output":2}}');
 store.delete(STORE);

 // --- Where it is used, and where it is not -------------------------------------------------------------
 // Only research mode reads a price: the workspace and Model knowledge pass one on in research mode alone.
 const page=read('app/page.tsx'),knowledge=read('components/model-knowledge.tsx'),options=read('components/research/request-options.tsx'),panel=read('lib/cost-estimate/panel.tsx');
 for(const source of [page,knowledge]){assert(source.includes('typedPrice=research?ownPrice(provider,model,ownPrices):undefined'));assert.equal(source.split('ownPrice:typedPrice,research').length,3,'The estimate and the provider’s count both take it');}
 // The boxes, with the labels and the hint.
 for(const text of ['Price per million input tokens ($)','Price per million output tokens ($)','placeholder="Unknown"','Use the Lab’s price','Remove your price','Use your own price'])assert(options.includes(text),text);
 assert(read('lib/research/setting-help.ts').includes('Used only for the cost estimate before a run.'),'The ⓘ beside the prices says what they are for');
 assert(panel.includes('Uses your own price for this model:'));
 // No other code knows the prices: not the study, its backups, the exports, or the recorded cost of a run.
 const sources=[];(function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(!['node_modules','dist','.git','tests','public'].includes(entry.name))walk(file);}else if(/\.(ts|tsx)$/.test(entry.name))sources.push(file.split(path.sep).join('/'));}})('.');
 assert(sources.length>60);
 assert.deepEqual(sources.filter(file=>/own-prices|text-annotation-lab:own-prices/.test(read(file))).sort(),['app/page.tsx','components/model-knowledge.tsx','components/research/request-options.tsx','lib/cost-estimate/pricing.ts','lib/own-prices.ts','lib/student-estimate.ts']);
 assert.deepEqual(sources.filter(file=>/\bownRates\b/.test(read(file))).sort(),['lib/cost-estimate/pricing.ts','lib/student-estimate.ts']);
 assert(!/ownPrice|ownRates|own-prices/.test(read('lib/cost-estimate/run-cost.ts')+read('lib/cost-estimate/run-cost-summary.tsx')),'A run’s recorded cost uses the Lab’s listed rates');
 console.log(`PASS: your own price for a model: the rates an estimate uses with it (${compared} comparisons with the listed prices), the estimate in research mode and in the standard Lab, models without a listed price, prompt caching, the provider’s count, the browser’s storage (other tabs, unusable storage, damaged content), and that no study, backup, export, or recorded cost knows it. No provider calls.`);
})().catch(error=>{console.error(error);process.exit(1);});
