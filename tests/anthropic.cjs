const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(),ts=require(path.join(root,'node_modules/typescript'));
let enabled=true,calls=[];let mock=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'ignore'},{text:'{"score":"4","explanation":"Evidence"}'}]}}],usageMetadata:{totalTokenCount:30}});
function load(file){const filename=path.join(root,file);const exports={};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports,require:(id)=>{if(id.includes('provider-errors'))return load('lib/provider-errors.ts');if(id.includes('extract-text'))return {supportedFile:/\.(txt|pdf)$/i,extractText:f=>f.text()};if(id.includes('batch-limits'))return load('lib/batch-limits.ts');if(id.includes('knowledge-web'))return load('lib/knowledge-web.ts');if(id.includes('model-knowledge'))return load('lib/model-knowledge.ts');if(id.includes('providers'))return {...load('lib/providers.ts'),GEMINI_ENABLED:enabled};if(id.includes('anthropic'))return load('lib/anthropic.ts');if(id.includes('gemini'))return load('lib/gemini.ts');if(id.startsWith('@/'))return load(id.slice(2)+'.ts');if(id.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts')));return require(id);},Response,Request,File,FormData,URL,AbortSignal,Uint8Array,btoa,fetch:async(url,options)=>{calls.push({url,options});return mock(url,options);}};new Function(...Object.keys(context),code)(...Object.values(context));return exports;}
function request(model='claude-sonnet-5-5',effort='high',file=new File(['sample'],'test.txt'),provider='anthropic',key='sk-ant-test') {const f=new FormData();for(const [k,v] of Object.entries({provider,model,effort,prompt:'Rate text',file}))f.set(k,v);return new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:'Bearer '+key},body:f});}
(async()=>{
 const route=load('app/api/annotate/route.ts');
 const good=()=>Response.json({id:'msg_test',stop_reason:'end_turn',content:[{type:'thinking',thinking:'private'},{type:'text',text:'{"score":"3","explanation":"Evidence"}'}],usage:{input_tokens:12,output_tokens:18}});
 mock=async()=>good();
 for(const model of load('lib/providers.ts').PROVIDERS.anthropic.models){
  const haiku=model.startsWith('claude-haiku-4-5');
  for(const effort of load('lib/providers.ts').reasoningOptions('anthropic',model)){
   const r=await route.POST(request(model,effort));assert.equal(r.status,200);assert.equal((await r.json()).tokens,30);
   const call=calls.at(-1),b=JSON.parse(call.options.body);assert.equal(call.url,'https://api.anthropic.com/v1/messages');assert.equal(call.options.headers['x-api-key'],'sk-ant-test');assert.equal(call.options.headers.Authorization,undefined);assert.equal(call.options.headers['anthropic-version'],'2023-06-01');assert.equal(b.output_config.format.type,'json_schema');
   if(haiku){assert.equal(b.output_config.effort,undefined);assert.equal(b.thinking.type,effort==='off'?'disabled':'enabled');if(effort!=='off')assert.equal(b.thinking.budget_tokens,Number(effort));}else{assert.equal(b.thinking.type,'adaptive');assert.equal(b.output_config.effort,effort);}
  }
 }
 assert.equal((await route.POST(request('claude-sonnet-5-5','high',new File(['%PDF-test'],'test.pdf')))).status,200);assert.equal(JSON.parse(calls.at(-1).options.body).messages[0].content[1].source.media_type,'application/pdf');
 const before=calls.length;
 for(const args of [['claude-haiku-4-5-20251001','high'],['claude-opus-5-5','off'],['gpt-6-sol','high']])assert.equal((await route.POST(request(...args))).status,400);
 mock=async()=>Response.json({error:{type:'authentication_error',message:'Invalid API key'}},{status:401});
 assert.equal((await route.POST(request('claude-sonnet-5-5','high',undefined,'anthropic','alternate-key-format'))).status,401);assert.equal(calls.length,before+1);
 assert.equal(calls.at(-1).options.headers['x-api-key'],'alternate-key-format');
 assert.equal((await route.POST(request('claude-sonnet-5-5','high',undefined,'anthropic','key with spaces'))).status,401);assert.equal(calls.length,before+1);
 mock=async()=>Response.json({error:{type:'invalid_request_error',message:'Unsupported parameter combination'}},{status:400});
 const invalid=await route.POST(request());assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/rejected the request/);
 for(const status of [401,403,404,429,500]){mock=async()=>Response.json({error:'bad'},{status});assert.equal((await route.POST(request())).status,status);}
 for(const stop_reason of ['max_tokens','refusal','pause_turn']){mock=async()=>Response.json({stop_reason});assert.equal((await route.POST(request())).status,422);}
 for(const text of ['not json','null','{"score":3,"explanation":"x"}']){mock=async()=>Response.json({stop_reason:'end_turn',content:[{type:'text',text}]});assert.equal((await route.POST(request())).status,422);}
 mock=async()=>{throw Error('network')};assert.equal((await route.POST(request())).status,502);
 mock=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:'{"score":"2","explanation":"OpenAI evidence"}'}]}]});
 for(const model of ['gpt-6-sol','gpt-6-luna','gpt-6-astra','gpt-6.1-sol'])for(const effort of ((model==='gpt-6-astra'||model==='gpt-6.1-sol')?['low','medium','high','xhigh','max']:['none','low','medium','high','xhigh','max'])){assert.equal((await route.POST(request(model,effort,undefined,'openai','sk-test'))).status,200);assert.equal(JSON.parse(calls.at(-1).options.body).model,model);assert.equal(JSON.parse(calls.at(-1).options.body).reasoning.effort,effort);assert.match(calls.at(-1).url,/api.openai.com/);}
 assert.equal((await route.POST(request('gpt-6-sol','high',undefined,'openai','sk-ant-test'))).status,401);
 for(const effort of ['none','minimal'])assert.equal((await route.POST(request('gpt-6.1-sol',effort,undefined,'openai','sk-test'))).status,400);
 const buffer=await load('lib/export-results.ts').createResultsWorkbook([{name:'a',status:'done',score:'3',prompt:'p',model:'claude-haiku-4-5-20251001',effort:'4096',provider:'anthropic'}],{prompt:'p',model:'gpt-6-sol',effort:'medium'});
 const ExcelJS=require(path.join(root,'node_modules/exceljs')),book=new ExcelJS.Workbook();await book.xlsx.load(buffer);const rows=[];book.getWorksheet('Study settings').eachRow(r=>rows.push(r.values));assert(rows.some(r=>r.includes('Anthropic (Claude)')));assert(rows.some(r=>r.includes('Reasoning effort')));assert(rows.some(r=>r.includes('4096')));
 console.log('PASS: All Claude model/effort combinations, text/PDF, key separation, errors, refusals, malformed responses, exports, and GPT-6 model efforts. Mocked requests only.');
})().catch(e=>{console.error(e);process.exit(1)});
