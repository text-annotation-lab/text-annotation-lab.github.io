// Model/API contract audit, checked against first-party docs on 2026-10-29.
// All fetches are intercepted; these are not live account-access tests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const full=['none','low','medium','high','xhigh','max'],thinking=['low','medium','high','xhigh','max'],levels=['minimal','low','medium','high'];
const contracts={
 openai:{'gpt-6-luna':full,'gpt-5.6-luna':full,'gpt-6.1-terra':full,'gpt-6.1-sol':thinking,'gpt-6-sol':full,'gpt-5.6-terra':full,'gpt-5.6-sol':full,'gpt-6-astra':thinking},
 anthropic:{'claude-haiku-5-5':thinking,'claude-haiku-4-5-20251001':['off','1024','4096','8192'],'claude-sonnet-5-5':thinking,'claude-opus-5-5':thinking,'claude-fable-5-1':thinking},
 gemini:{'gemini-2.5-flash-lite':['off','dynamic','1024','4096','8192'],'gemini-3.1-flash-lite':levels,'gemini-3.5-flash-lite':levels,'gemini-2.5-flash':['off','dynamic','1024','4096','8192'],'gemini-3.8-flash':['low','medium','high'],'gemini-3.6-flash':levels,'gemini-3.5-flash':levels,'gemini-2.5-pro':['dynamic','1024','4096','8192'],'gemini-4-argon':['low','medium','high'],'gemini-3.1-pro-preview':['low','medium','high']}
};
let calls=[],mock;const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('exports','require','fetch',code)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id),async(url,options)=>{const body=typeof options.body==='string'?JSON.parse(options.body):options.body;calls.push({url,body,headers:options.headers});return mock(url,body);});return exports;}
const settings=load('lib/providers.ts'),annotate=load('app/api/annotate/route.ts').POST,count=load('app/api/count-tokens/route.ts').POST,batch=load('lib/batch-provider.ts');
const prompt='Classify the synthetic sentence.',fields=[{heading:'Title',value:'Synthetic work'}];
function req(provider,model,effort,file,knowledge=false,web=false){const f=new FormData();for(const [k,v] of Object.entries({provider,model,effort,prompt}))f.set(k,v);if(knowledge){f.set('mode','model-knowledge');f.set('fields',JSON.stringify(fields));f.set('webSearch',String(web));}else f.set('file',file);return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-fake-audit':provider==='anthropic'?'sk-ant-fake-audit':'AIzaFakeAudit')},body:f});}
function good(provider,research=false){const text=research?'Synthetic evidence.':JSON.stringify({score:'YES',explanation:'Synthetic explanation.'});return provider==='openai'?{status:'completed',output:[...(research?[{type:'web_search_call',status:'completed',action:{query:'Synthetic work',sources:[{url:'https://example.org',title:'Example'}]}}]:[]),{content:[{type:'output_text',text}]}]}:provider==='anthropic'?{stop_reason:'end_turn',content:[...(research?[{type:'web_search_tool_result',content:[{url:'https://example.org',title:'Example'}]}]:[]),{type:'text',text}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text}]},...(research?{groundingMetadata:{webSearchQueries:['Synthetic work'],groundingChunks:[{web:{uri:'https://example.org',title:'Example'}}]}}:{})}]};}
function check(provider,model,effort,body){
 if(provider==='openai'){assert.equal(body.model,model);assert.equal(body.reasoning.effort,effort);assert.equal(body.text.format.strict,true);assert.deepEqual([...body.text.format.schema.required].sort(),['explanation','score']);assert.equal(body.prompt_cache_options.mode,'explicit');assert.equal(body.max_output_tokens,12000);}
 else if(provider==='anthropic'){assert.equal(body.model,model);assert.equal(body.max_tokens,12000);assert.equal(body.output_config.format.type,'json_schema');if(model==='claude-haiku-4-5-20251001'){assert.equal(body.thinking.type,effort==='off'?'disabled':'enabled');assert.equal(body.output_config.effort,undefined);if(effort!=='off')assert.equal(body.thinking.budget_tokens,Number(effort));}else{assert.equal(body.thinking.type,'adaptive');assert.equal(body.output_config.effort,effort);}}
 else{const g=body.generationConfig;assert.equal(g.maxOutputTokens,model==='gemini-4-argon'?32768:12000);assert.equal(g.responseMimeType,'application/json');assert.deepEqual([...g.responseSchema.required].sort(),['explanation','score']);assert.deepEqual(g.thinkingConfig,model.startsWith('gemini-2.5-')?{thinkingBudget:effort==='off'?0:effort==='dynamic'?-1:Number(effort)}:{thinkingLevel:effort.toUpperCase()});}
}
function endpoint(provider,model){return provider==='openai'?'https://api.openai.com/v1/responses':provider==='anthropic'?'https://api.anthropic.com/v1/messages':`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;}
function headers(provider,h){assert.equal(Boolean(h.Authorization),provider==='openai');assert.equal(Boolean(h['x-api-key']),provider==='anthropic');assert.equal(Boolean(h['x-goog-api-key']),provider==='gemini');if(provider==='anthropic')assert.equal(h['anthropic-version'],'2023-06-01');}
(async()=>{
 let combinations=0,requests=0;
 for(const [provider,models] of Object.entries(contracts)){
  assert.deepEqual([...settings.PROVIDERS[provider].models].sort(),Object.keys(models).sort());
  for(const [model,efforts] of Object.entries(models)){
   assert.deepEqual(settings.reasoningOptions(provider,model),efforts,model);assert(efforts.includes(settings.defaultEffort(provider,model)));
   for(const effort of efforts){combinations++;
    for(const file of [new File(['A synthetic sentence.'],'audit.txt'),new File(['%PDF-fixture'],'audit.pdf')]){
     mock=async()=>Response.json(good(provider));const n=calls.length,r=await annotate(req(provider,model,effort,file));assert.equal(r.status,200,`${model}/${effort}/${file.name}`);assert.equal((await r.json()).score,'YES');assert.equal(calls.length,n+1);requests++;
     const call=calls.at(-1);assert.equal(call.url,endpoint(provider,model));headers(provider,call.headers);check(provider,model,effort,call.body);
     const b=await batch.buildBatchBody(provider,file,prompt,model,effort);assert.deepEqual(b,call.body,'Batch must preserve the Instant annotation payload');
     const payload=batch.createBatchPayload(provider,'audit-run');payload.append('audit-item',b);const raw=JSON.parse(await payload.finish().text());const row=provider==='openai'?raw:provider==='anthropic'?raw.requests[0]:raw.batch.input_config.requests.requests[0];
     assert.deepEqual(provider==='openai'?row.body:provider==='anthropic'?row.params:row.request,b);
     if(file.name.endsWith('pdf'))assert(JSON.stringify(b).includes('JVBERi1maXh0dXJl'),'PDF bytes remain intact');
     mock=async()=>Response.json(provider==='gemini'?{totalTokens:9}:{input_tokens:9});const counted=await count(req(provider,model,effort,file));assert.equal(counted.status,200);assert.equal((await counted.json()).inputTokens,9);headers(provider,calls.at(-1).headers);assert(/input_tokens$|count_tokens$|:countTokens$/.test(calls.at(-1).url));
    }
   }
   // Model-knowledge research must use the same selected model as scoring.
   mock=async(url,b)=>Response.json(good(provider,Boolean(b.tools)));const n=calls.length,r=await annotate(req(provider,model,efforts.at(-1),undefined,true,true));assert.equal(r.status,200,model+' research');const result=await r.json();assert.equal(calls.length,n+2);for(const call of calls.slice(n)){assert.equal(call.url,endpoint(provider,model));headers(provider,call.headers);if(provider!=='gemini')assert.equal(call.body.model,model);}
   assert.equal(result.research.model,model);if(model==='gemini-4-argon'){assert.equal(calls[n].body.generationConfig.thinkingConfig.thinkingLevel,'MEDIUM');assert.equal(result.research.effort,'medium');assert.equal(calls[n+1].body.generationConfig.thinkingConfig.thinkingLevel,'HIGH');}
   // Wrong-provider identifiers and invalid efforts are rejected before fetch.
   const n2=calls.length;assert.equal((await annotate(req(provider,model,'invalid',new File(['x'],'a.txt')))).status,400);const other=provider==='openai'?'gemini-3.8-flash':'gpt-6-luna';assert.equal((await annotate(req(provider,other,'medium',new File(['x'],'a.txt')))).status,400);assert.equal(calls.length,n2);
  }
 }
 console.log(`PASS: 23 models; ${combinations} model/effort combinations; ${requests} Instant text/PDF requests and matching batch/count payloads; all-model web research and wrong-provider rejection. All traffic mocked; PDF fixtures verify transport, not provider parsing.`);
})().catch(e=>{console.error(e);process.exit(1)});
