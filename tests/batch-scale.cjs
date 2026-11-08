const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const cache=new Map();let calls=[],mock;
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('exports','require','fetch',code)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id),async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}
const route=load('app/api/batch/route.ts'),limits=load('lib/batch-limits.ts'),lib=load('lib/batch-provider.ts');
const settings={openai:['gpt-6-luna','medium'],anthropic:['claude-haiku-4-5-20251001','4096'],gemini:['gemini-3.8-flash','medium']};
function request(provider,count,knowledge=false,changes={}){
 const form=new FormData();const [model,effort]=settings[provider];const runId='lab_scale';
 for(const [name,value]of Object.entries({provider,action:'submit',model,effort,prompt:'Classify the subject independently and explain the judgment.',runId,ids:JSON.stringify(Array.from({length:count},(_,i)=>runId+'_'+i)),...changes}))form.set(name,value);
 if(knowledge){form.set('mode','model-knowledge');form.set('subjects',JSON.stringify(Array.from({length:count},(_,i)=>[{heading:'Title',value:'Work '+i},{heading:'Author',value:'Author '+i}])));}
 else{const article='An article about social and cultural developments. '.repeat(provider==='gemini'?60:160);for(let i=0;i<count;i++)form.append('files',new File([article+'\nArticle '+i],i+'.txt'));}
 return new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'provider-test')},body:form});
}
async function decodePayload(provider){if(provider==='openai')return (await calls[0].options.body.get('file').text()).split('\n').map(s=>JSON.parse(s));const body=JSON.parse(await calls[0].options.body.text());return provider==='anthropic'?body.requests:body.batch.input_config.requests.requests;}
function providerSuccess(provider){return async url=>Response.json(url.endsWith('/files')?{id:'file-scale'}:provider==='openai'?{id:'batch_scale'}:provider==='anthropic'?{id:'msgbatch_scale'}:{name:'batches/scale'});}
function streamedResults(provider,count,padding=16000,broken=false){
 const encoder=new TextEncoder();let index=0,chunk;
 return new Response(new ReadableStream({pull(controller){
  if(chunk){controller.enqueue(chunk);chunk=undefined;return;}
  if(index===count){if(broken){controller.enqueue(encoder.encode('{"custom_id":'));broken=false;}else controller.close();return;}
  const i=count-1-index++;const answer={score:i%13===0?'INSUFFICIENT_KNOWLEDGE':String(i),explanation:'Crème — 漢字 😀 '+i};
  const body=provider==='anthropic'?{stop_reason:'end_turn',content:[{type:'thinking',thinking:'x'.repeat(padding)},{type:'text',text:JSON.stringify(answer)}],usage:{input_tokens:3,output_tokens:4}}:{status:'completed',output:[{type:'reasoning',summary:[{text:'x'.repeat(padding)}]},{content:[{type:'output_text',text:JSON.stringify(answer)}]}],usage:{total_tokens:7}};
  const row=provider==='anthropic'?{custom_id:'lab_scale_'+i,result:{type:'succeeded',message:body}}:{custom_id:'lab_scale_'+i,response:{status_code:200,body}};
  const encoded=encoder.encode(JSON.stringify(row)+(i===0?'':'\r\n'));
  // Split inside a multibyte character, not just at record boundaries.
  const split=encoded.findIndex((v,j)=>j>200&&v>127)+1;
  controller.enqueue(encoded.subarray(0,split));chunk=encoded.subarray(split);
 }}));
}
(async()=>{
 for(const provider of ['openai','anthropic','gemini'])for(const knowledge of [false,true]){
  calls=[];mock=providerSuccess(provider);const response=await route.POST(request(provider,3100,knowledge));assert.equal(response.status,200,provider+' '+knowledge+' '+await response.clone().text());
  const rows=await decodePayload(provider);assert.equal(rows.length,3100);const id=row=>provider==='gemini'?row.metadata.key:row.custom_id;assert.equal(id(rows[0]),'lab_scale_0');assert.equal(id(rows.at(-1)),'lab_scale_3099');
  const body=provider==='openai'?rows[0].body:provider==='anthropic'?rows[0].params:rows[0].request;const serialized=JSON.stringify(body);assert(serialized.includes(knowledge?'Work 0':'Article 0'));assert(!serialized.includes(knowledge?'Work 3099':'Article 3099'));
  console.log('PASS:',provider,knowledge?'3,100 subjects':'3,100 full article files',provider==='openai'?calls[0].options.body.get('file').size:calls[0].options.body.size,'prepared bytes');
 }
 // Five 10 MB PDF fixtures exercise the full source limit plus base64 expansion.
 for(const provider of ['openai','anthropic']){
  const form=new FormData(),[model,effort]=settings[provider];for(const [k,v]of Object.entries({provider,action:'submit',model,effort,prompt:'Classify.',runId:'lab_pdfs',ids:JSON.stringify(Array.from({length:5},(_,i)=>'lab_pdfs_'+i))}))form.set(k,v);
  for(let i=0;i<5;i++)form.append('files',new File([new Uint8Array(10*1024*1024)],i+'.pdf'));
  calls=[];mock=providerSuccess(provider);const response=await route.POST(new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'provider-test')},body:form}));assert.equal(response.status,200,await response.clone().text());const bytes=provider==='openai'?calls[0].options.body.get('file').size:calls[0].options.body.size;assert(bytes>66*1024*1024);assert(bytes<limits.MAX_BATCH_PREPARED_BYTES);console.log('PASS:',provider,'50 MB of PDF fixtures accepted with base64 expansion:',bytes,'prepared bytes');
 }
 calls=[];mock=providerSuccess('openai');assert.equal((await route.POST(request('openai',10000,true))).status,200);assert.equal((await decodePayload('openai')).length,10000);
 for(const provider of ['openai','anthropic','gemini']){calls=[];mock=providerSuccess(provider);const tooLarge=await route.POST(request(provider,900,true,{prompt:'x'.repeat(100000)}));assert.equal(tooLarge.status,413);assert.equal(calls.length,0,'expanded prompts must be checked before any provider job');}
 calls=[];assert.equal((await route.POST(request('openai',10001,true))).status,400);assert.equal(calls.length,0);
 // Enforce the upload byte limit even without Content-Length.
 const encoder=new TextEncoder();let uploadStep=0;const huge=new ReadableStream({pull(controller){if(uploadStep++===0)controller.enqueue(encoder.encode('--limit\r\nContent-Disposition: form-data; name="files"; filename="huge.txt"\r\nContent-Type: text/plain\r\n\r\n'));else if(uploadStep===2)controller.enqueue(new Uint8Array(limits.MAX_BATCH_REQUEST_BYTES+1));else controller.close();}});calls=[];const upload=await route.POST(new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer sk-test','content-type':'multipart/form-data; boundary=limit'},body:huge,duplex:'half'}));assert.equal(upload.status,413);assert.equal(calls.length,0);
 for(const provider of ['openai','anthropic']){
  calls=[];mock=async url=>url.endsWith('/content')||url.endsWith('/results')?streamedResults(provider,3100):Response.json(provider==='openai'?{status:'completed',output_file_id:'file-scale',request_counts:{completed:3100,total:3100}}:{processing_status:'ended',request_counts:{succeeded:3100}});
  const out=await lib.checkBatch(provider,'test',provider==='openai'?'batch_scale':'msgbatch_scale',true);assert.equal(out.results.length,3100);assert.equal(out.results[0].id,'lab_scale_3099');assert.equal(out.results.at(-1).id,'lab_scale_0');assert.equal(out.results[1].explanation,'Crème — 漢字 😀 3098');assert(out.results.every(r=>r.tokens===7));assert(!JSON.stringify(out).includes('thinking'));assert(JSON.stringify(out).length<1024*1024);
  console.log('PASS:',provider,'streamed >48 MB raw results, retained 3,100 compact annotations with out-of-order IDs and split Unicode');
 }
 mock=async url=>url.endsWith('/results')?streamedResults('anthropic',3,10,true):Response.json({processing_status:'ended'});await assert.rejects(()=>lib.checkBatch('anthropic','test','msgbatch_scale',true),/incomplete/);
 mock=async url=>url.endsWith('/results')?new Response('x'.repeat(2*1024*1024+1)):Response.json({processing_status:'ended'});await assert.rejects(()=>lib.checkBatch('anthropic','test','msgbatch_scale',true),/too large/);
 console.log('PASS: 10,000-subject capacity, byte limits without Content-Length, repeated-prompt size checks, malformed/truncated and oversized result protection. Mocked provider calls only.');
})().catch(error=>{console.error(error);process.exit(1);});
