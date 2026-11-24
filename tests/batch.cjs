const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
let calls=[],mock=async()=>Response.json({});
function load(file){const exports={},filename=path.join(root,file);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}
const settings={openai:['gpt-6-luna','medium'],anthropic:['claude-haiku-4-5-20251001','4096'],gemini:['gemini-3.8-flash','medium']};
function request(provider,action='submit',extra={}){const f=new FormData();const [model,effort]=settings[provider]||settings.openai;for(const [k,v]of Object.entries({provider,action,model,effort,prompt:'Rate tone',runId:'lab_test',ids:JSON.stringify(['lab_test_0','lab_test_1']),...extra}))f.set(k,v);if(action==='submit'){f.append('files',new File(['one'],'one.txt'));f.append('files',new File(['%PDF mock'],'two.pdf'));}return new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'provider-test')},body:f});}
const annotation={score:'2',explanation:'Grounded evidence'};
const output=p=>p==='openai'?{status:'completed',id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text:JSON.stringify(annotation)}]}]}:p==='anthropic'?{stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2},content:[{type:'text',text:JSON.stringify(annotation)}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(annotation)}]}}],usageMetadata:{totalTokenCount:12}};
(async()=>{
 const route=load('app/api/batch/route.ts'),lib=load('lib/batch-provider.ts'),knowledge=load('lib/model-knowledge.ts'),ENDED='2026-11-18T21:40:00.000Z';
 for(const provider of ['openai','anthropic','gemini']){
  calls=[];mock=async url=>Response.json(url.endsWith('/files')?{id:'file-test'}:provider==='openai'?{id:'batch_test'}:provider==='anthropic'?{id:'msgbatch_test'}:{name:'batches/test'});
  const res=await route.POST(request(provider));assert.equal(res.status,200);const id=(await res.json()).id;assert(lib.validBatchId(provider,id));
  const last=calls.at(-1),body=JSON.parse(last.options.body instanceof Blob?await last.options.body.text():last.options.body);
  if(provider==='openai'){assert.equal(calls.length,2);const lines=(await calls[0].options.body.get('file').text()).split('\n').map(JSON.parse);assert.deepEqual(lines.map(x=>x.custom_id),['lab_test_0','lab_test_1']);assert.equal(lines[1].body.input[0].content[1].type,'input_file');assert.deepEqual(lines[0].body.prompt_cache_options,{mode:'explicit'});assert.equal(body.completion_window,'24h');assert.equal(body.metadata.lab_run_id,'lab_test');}
  else if(provider==='anthropic'){assert.equal(body.requests[0].params.thinking.budget_tokens,4096);assert.equal(body.requests[1].params.messages[0].content[1].type,'document');assert.equal(body.requests[0].params.cache_control,undefined);}
  else{assert.equal(body.batch.input_config.requests.requests[0].metadata.key,'lab_test_0');assert.equal(body.batch.input_config.requests.requests[1].request.contents[0].parts[1].inlineData.mimeType,'application/pdf');}
  calls=[];mock=async url=>{
   if(url.endsWith('/content'))return new Response(JSON.stringify({custom_id:'lab_test_1',response:{status_code:200,body:output(provider)}})+'\n'+JSON.stringify({custom_id:'lab_test_0',error:{code:'failed'}}));
   if(url.endsWith('/results'))return new Response(JSON.stringify({custom_id:'lab_test_1',result:{type:'succeeded',message:output(provider)}})+'\n'+JSON.stringify({custom_id:'lab_test_0',result:{type:'expired'}}));
   return Response.json(provider==='openai'?{status:'completed',output_file_id:'file-results',completed_at:Date.parse(ENDED)/1000,request_counts:{completed:1,failed:1,total:2}}:provider==='anthropic'?{processing_status:'ended',ended_at:'2026-11-18T21:40:00Z',request_counts:{succeeded:1,expired:1}}:{done:true,metadata:{state:'BATCH_STATE_SUCCEEDED',endTime:'2026-11-18T21:40:00.000000Z'},response:{inlinedResponses:{inlinedResponses:[{metadata:{key:'lab_test_1'},response:output(provider)},{metadata:{key:'lab_test_0'},error:{code:1}}]}}});
  };
  const check=await route.POST(request(provider,'check',{id}));assert.equal(check.status,200);const checked=await check.json();assert.equal(checked.terminal,true);assert.equal(calls.length,1,'status checks must not fetch result files');
  // The provider's own time for the end of the batch is kept: the time its results are collected says nothing of it.
  assert.equal(checked.endedAt,ENDED,provider+': when the batch ended');
  const collection=await route.POST(request(provider,'collect',{id}));assert.equal(collection.status,200);const out=await collection.json();assert.equal(out.endedAt,ENDED);assert.equal(out.results[0].id,'lab_test_1');assert.equal(out.results[0].score,'2');assert.equal(out.results[0].tokens,12);assert(out.results[1].error);
  const limited={...output(provider),id:'test-response',responseId:'test-response',status:'incomplete',stop_reason:'max_tokens',candidates:[{finishReason:'MAX_TOKENS'}]};
  const failed=lib.parseBatchAnnotation(provider,limited);
  assert(failed.error);assert.equal(failed.tokens,12);assert.equal(failed.responseId,'test-response');
  assert.deepEqual(failed.usage,limited.usage||limited.usageMetadata);
  assert(lib.parseBatchAnnotation(provider,null).error);assert(lib.parseBatchAnnotation(provider,provider==='openai'?{...output(provider),output:[{content:[{type:'output_text',text:'{"score":2}'}]}]}:provider==='anthropic'?{...output(provider),content:[{type:'text',text:'null'}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:'[]'}]}}]}).error);
 }
 // A batch that is still running has no end, and where the provider gives no time none is made up.
 calls=[];mock=async()=>Response.json({status:'in_progress',completed_at:null,request_counts:{completed:0,failed:0,total:2}});
 const running=await (await route.POST(request('openai','check',{id:'batch_test'}))).json();assert.equal(running.terminal,false);assert(!('endedAt' in running));
 mock=async()=>Response.json({status:'completed',output_file_id:'file-results',request_counts:{completed:2,failed:0,total:2}});
 const untimed=await (await route.POST(request('openai','check',{id:'batch_test'}))).json();assert.equal(untimed.terminal,true);assert(!('endedAt' in untimed));
 calls=[];mock=async()=>{throw Error('network')};const bad=request('openai');bad.headers.set('origin','https://evil.test');assert.equal((await route.POST(bad)).status,403);assert.equal(calls.length,0);
 assert.equal((await route.POST(request('openai','collect',{id:'../../secrets'}))).status,400);assert.equal(calls.length,0);
 assert.equal((await route.POST(request('openai','submit',{ids:'["lab_test_0","lab_test_0"]'}))).status,400);assert.equal(calls.length,0);
 // Several annotations per text (research mode): each file is sent as many times as `copies` says, one reference per request.
 for(const provider of ['openai','anthropic','gemini']){
  calls=[];mock=async url=>Response.json(url.endsWith('/files')?{id:'file-test'}:provider==='openai'?{id:'batch_test'}:provider==='anthropic'?{id:'msgbatch_test'}:{name:'batches/test'});
  const ids=['lab_test_0','lab_test_1','lab_test_2','lab_test_3'],res=await route.POST(request(provider,'submit',{ids:JSON.stringify(ids),copies:'[3,1]'}));assert.equal(res.status,200,provider);
  const last=calls.at(-1),body=JSON.parse(last.options.body instanceof Blob?await last.options.body.text():last.options.body);
  const sent=provider==='openai'?(await calls[0].options.body.get('file').text()).split('\n').map(JSON.parse).map(line=>[line.custom_id,JSON.stringify(line.body)]):provider==='anthropic'?body.requests.map(item=>[item.custom_id,JSON.stringify(item.params)]):body.batch.input_config.requests.requests.map(item=>[item.metadata.key,JSON.stringify(item.request)]);
  assert.deepEqual(sent.map(item=>item[0]),ids,provider);assert(sent[0][1]===sent[1][1]&&sent[1][1]===sent[2][1]&&sent[2][1]!==sent[3][1],provider+': the first file three times, then the second');
 }
 calls=[];mock=async()=>{throw Error('network')};
 for(const extra of [{copies:'[3,1]'},{copies:'[1]',ids:'["lab_test_0"]'},{copies:'[0,2]'},{copies:'[11,1]',ids:JSON.stringify(Array.from({length:12},(_,i)=>'lab_test_'+i))},{copies:'[1.5,1]'},{copies:'oops'},{copies:'{"0":1}'}]){assert.equal((await route.POST(request('openai','submit',extra))).status,400,JSON.stringify(extra));assert.equal(calls.length,0);}
 const big=request('openai');big.headers.set('content-length','60000000');assert.equal((await route.POST(big)).status,413);assert.equal(calls.length,0);
 mock=async url=>url.endsWith('/files')?Response.json({id:'file-test'}):Promise.reject(Error('network'));const uncertain=await route.POST(request('openai'));assert.equal(uncertain.status,502);assert.equal((await uncertain.json()).uncertain,true);
 mock=async url=>url.endsWith('/files')?Response.json({id:'file-test'}):Response.json({error:{message:'quota'}},{status:429});const quota=await route.POST(request('openai'));assert.equal((await quota.json()).uncertain,false);
 mock=async()=>new Response('',{status:200});assert.equal((await route.POST(request('gemini','cancel',{id:'batches/test'}))).status,200);
 mock=async url=>url.endsWith('/content')?new Response(JSON.stringify({custom_id:'lab_test_0',response:{status_code:200,body:output('openai')}})+'\n'+JSON.stringify({custom_id:'lab_test_0',error:{}})):Response.json({status:'completed',output_file_id:'file-results'});
 assert.equal((await route.POST(request('openai','collect',{id:'batch_test'}))).status,502,'duplicate result IDs must not silently overwrite documents');
 // Model knowledge must use identifiers and method instructions, never document semantics.
 function knowledgeRequest(provider,changes={}){const f=new FormData();const [model,effort]=settings[provider];for(const [k,v]of Object.entries({provider,action:'submit',mode:'model-knowledge',webSearch:'false',model,effort,prompt:'Classify fictiveness.',runId:'lab_knowledge',ids:JSON.stringify(['lab_knowledge_0','lab_knowledge_1']),subjects:JSON.stringify([[{heading:'Title',value:'Dracula'},{heading:'Author',value:'Bram Stoker'}],[{heading:'Title',value:'Unfamiliar subject'}]]),...changes}))f.set(k,v);return new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'provider-test')},body:f});}
 for(const provider of ['openai','anthropic','gemini']){
  calls=[];mock=async url=>Response.json(url.endsWith('/files')?{id:'file-test'}:provider==='openai'?{id:'batch_knowledge'}:provider==='anthropic'?{id:'msgbatch_knowledge'}:{name:'batches/knowledge'});
  assert.equal((await route.POST(knowledgeRequest(provider))).status,200);
  const requests=provider==='openai'?(await calls[0].options.body.get('file').text()).split('\n').map(s=>JSON.parse(s).body):provider==='anthropic'?JSON.parse(await calls[0].options.body.text()).requests.map(r=>r.params):JSON.parse(await calls[0].options.body.text()).batch.input_config.requests.requests.map(r=>r.request);
  assert.equal(requests.length,2);const first=requests[0],content=first.input?.at(-1).content||first.messages?.at(-1).content||first.contents[0].parts,system=typeof content==='string'?content:content.map(part=>part.text||'').join('');assert(!first.instructions&&!first.system&&!first.systemInstruction,'No system prompt');assert(system.includes(knowledge.KNOWLEDGE_INSTRUCTIONS));assert(/\n\n<entry>\nTitle: Dracula\nAuthor: Bram Stoker\n<\/entry>$/.test(system),'The subject follows the prompt between <entry> tags, one “heading: value” line for each field');assert(!system.includes('grounded in the document'));assert(system.includes('Classify fictiveness.'));
  const input=JSON.stringify(first.input||first.messages||first.contents);assert(input.includes('Dracula'));assert(input.includes('Author'));assert(!input.includes('Unfamiliar subject'));assert(!input.includes('Document filename'));assert(!JSON.stringify(first).includes('web_search'));
 }
 for(const changes of [{webSearch:'true'},{mode:'invalid'},{subjects:'[]'},{subjects:'invalid'},{subjects:JSON.stringify([[{heading:'Title',value:''}]])},{subjects:JSON.stringify([[{heading:'Title',value:'A'},{heading:'title',value:'B'}]])},{ids:'["lab_knowledge_0"]'},{subjects:JSON.stringify(Array.from({length:10001},()=>[{heading:'Title',value:'X'}]))}]){calls=[];assert.equal((await route.POST(knowledgeRequest('openai',changes))).status,400);assert.equal(calls.length,0,'invalid knowledge batches must not create paid jobs');}
 console.log('PASS: all three provider submissions, PDF/text and model-knowledge requests, method/abstention instructions, keyed out-of-order results, validation before paid requests, uncertain submissions, cancellation, and duplicate-ID protection. Mocked calls only.');
})().catch(e=>{console.error(e);process.exit(1)});
