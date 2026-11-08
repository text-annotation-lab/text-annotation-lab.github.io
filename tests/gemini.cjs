const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(),ts=require(path.join(root,'node_modules/typescript'));
let enabled=true,calls=[];let mock=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'ignore'},{text:'{"score":"4","explanation":"Evidence"}'}]}}],usageMetadata:{totalTokenCount:30}});
function load(file){const filename=path.join(root,file);const exports={};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports,require:(id)=>{if(id.includes('provider-errors'))return load('lib/provider-errors.ts');if(id.includes('extract-text'))return {supportedFile:/\.(txt|pdf)$/i,extractText:f=>f.text()};if(id.includes('batch-limits'))return load('lib/batch-limits.ts');if(id.includes('knowledge-web'))return load('lib/knowledge-web.ts');if(id.includes('model-knowledge'))return load('lib/model-knowledge.ts');if(id.includes('providers'))return {...load('lib/providers.ts'),GEMINI_ENABLED:enabled};if(id.includes('anthropic'))return load('lib/anthropic.ts');if(id.includes('gemini'))return load('lib/gemini.ts');if(id.startsWith('@/'))return load(id.slice(2)+'.ts');if(id.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts')));return require(id);},Response,Request,File,FormData,URL,AbortSignal,Uint8Array,btoa,fetch:async(url,options)=>{calls.push({url,options});return mock(url,options);}};new Function(...Object.keys(context),code)(...Object.values(context));return exports;}
function request(provider='gemini',model='gemini-3.1-flash-lite',file=new File(['sample'],'test.txt'),effort=provider==='gemini'?'minimal':'medium'){const f=new FormData();f.set('provider',provider);f.set('model',model);f.set('effort',effort);f.set('prompt','Rate text');f.set('file',file);return new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:provider==='gemini'?'Bearer AIzaFAKE_KEY_FOR_TEST_ONLY_12345':'Bearer sk-test'},body:f});}
(async()=>{
let route=load('app/api/annotate/route.ts');let r=await route.POST(request());assert.equal(r.status,200);assert.equal((await r.json()).score,'4');assert.equal(calls.length,1);assert.match(calls[0].url,/generativelanguage/);let body=JSON.parse(calls[0].options.body);assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'MINIMAL');assert.equal(calls[0].options.headers.Authorization,undefined);
r=await route.POST(request('gemini','gemini-3.5-flash',new File(['%PDF-test'],'test.pdf')));assert.equal(r.status,200);assert.equal(JSON.parse(calls.at(-1).options.body).contents[0].parts[1].inlineData.mimeType,'application/pdf');
const settings=load('lib/providers.ts');
for(const model of settings.PROVIDERS.gemini.models){
 const effort=settings.defaultEffort('gemini',model);assert(settings.reasoningOptions('gemini',model).includes(effort));
 r=await route.POST(request('gemini',model,new File(['sample'],'test.txt'),effort));assert.equal(r.status,200,model);
 const config=JSON.parse(calls.at(-1).options.body).generationConfig;assert.equal(config.maxOutputTokens,model==='gemini-4-argon'?32768:12000);assert.equal(config.responseMimeType,'application/json');
 if(model.startsWith('gemini-2.5-')){assert.equal(config.thinkingConfig.thinkingBudget,effort==='off'?0:-1);assert.equal(config.thinkingConfig.thinkingLevel,undefined);}else{assert.equal(config.thinkingConfig.thinkingLevel,effort.toUpperCase());assert.equal(config.thinkingConfig.thinkingBudget,undefined);}
}
assert.equal(settings.modelAccessLabel('gemini','gemini-3.1-flash-lite'),'Free API tier');
assert.equal(settings.modelAccessLabel('gemini','gemini-3.8-flash'),'Free API tier');
assert.equal(settings.modelAccessLabel('gemini','gemini-3.6-flash'),'Free API tier');
assert.equal(settings.modelAccessLabel('gemini','gemini-2.5-pro'),'Free tier · restricted');
assert.equal(settings.modelAccessLabel('gemini','gemini-4-argon'),'Paid API');
assert.equal(settings.modelAccessLabel('gemini','gemini-3.1-pro-preview'),'Paid API');
assert.equal(settings.modelAccessLabel('openai','gpt-6.1-terra'),'Paid API');
assert.equal(settings.modelAccessLabel('anthropic','claude-haiku-5-5'),'Paid API');
assert.match(settings.modelAccessHint('gemini','gemini-3.1-flash-lite'),/billing-enabled project/);
assert(settings.PROVIDERS.openai.models.includes('gpt-6.1-terra'));assert(settings.reasoningOptions('openai','gpt-6.1-terra').includes('none'));
r=await route.POST(request('gemini','gemini-2.5-flash-lite',new File(['%PDF-test'],'test.pdf'),'4096'));assert.equal(r.status,200);assert.equal(JSON.parse(calls.at(-1).options.body).generationConfig.thinkingConfig.thinkingBudget,4096);
for(const [model,effort] of [['gemini-4-argon','minimal'],['gemini-3.8-flash','minimal'],['gemini-3.1-pro-preview','minimal'],['gemini-2.5-pro','off'],['gemini-2.5-flash-lite','low']]){const count=calls.length;assert.equal((await route.POST(request('gemini',model,new File(['sample'],'test.txt'),effort))).status,400);assert.equal(calls.length,count);}
const opaque=request();opaque.headers.set('authorization','Bearer fake.key+with/punctuation=');assert.equal((await route.POST(opaque)).status,200);assert.equal(calls.at(-1).options.headers['x-goog-api-key'],'fake.key+with/punctuation=');
const spaced=request();spaced.headers.set('authorization','Bearer fake key');assert.equal((await route.POST(spaced)).status,401);
const missing=request();missing.headers.delete('authorization');assert.equal((await route.POST(missing)).status,401);
const before=calls.length;r=await route.POST(request('gemini','gpt-5.6-luna'));assert.equal(r.status,400);assert.equal(calls.length,before);
mock=async()=>Response.json({error:{details:[{retryDelay:'30s'}]}},{status:429});r=await route.POST(request());assert.equal(r.status,429);assert.match((await r.json()).error,/30s/);
mock=async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS'}]});assert.equal((await route.POST(request())).status,422);
mock=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'not json'}]}}]});assert.equal((await route.POST(request())).status,422);
mock=async()=>{throw Error('network')};assert.equal((await route.POST(request())).status,502);
enabled=false;assert.equal((await load('app/api/annotate/route.ts').POST(request())).status,400);
mock=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"score":"2","explanation":"OpenAI evidence"}'}]}]});r=await route.POST(request('openai','gpt-5.6-luna'));assert.equal(r.status,200);assert.match(calls.at(-1).url,/api.openai.com/);assert.equal(calls.at(-1).options.headers['x-goog-api-key'],undefined);
const {createResultsWorkbook}=load('lib/export-results.ts');const ExcelJS=require(path.join(root,'node_modules/exceljs'));const buffer=await createResultsWorkbook([{name:'a',status:'done',score:'2',prompt:'p',model:'gpt-5.6-luna',effort:'medium'},{name:'b',status:'done',score:'4',prompt:'p',model:'gemini-3.5-flash',effort:'low',provider:'gemini'}],{prompt:'p',model:'gpt-5.6-luna',effort:'medium'});const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);const rows=[];book.getWorksheet('Study settings').eachRow(r=>rows.push(r.values));assert(rows.some(r=>r.includes('Google (Gemini)')));assert(rows.some(r=>r.includes('OpenAI (ChatGPT)')));assert(rows.some(r=>r.includes('Reasoning effort')));
console.log('PASS: Gemini text/PDF, schema parsing, invalid model, quota, incomplete/malformed output, network error, disabled flag, OpenAI routing, mixed-provider Excel. No live API requests.');
})().catch(e=>{console.error(e);process.exit(1)});
