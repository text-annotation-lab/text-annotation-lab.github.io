// Offline tests: every network request is intercepted. Never use real keys.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
let calls=[],mock=async(url)=>Response.json(url.includes('googleapis')?{totalTokens:1234}:{input_tokens:1234});const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',source)(out,id=>{if(id.includes('extract-text'))return {supportedFile:/\.(txt|pdf|docx)$/i,extractText:f=>f.text()};if(id.startsWith('@/'))return load(path.resolve(id.slice(2)+'.ts'));if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id+'.ts'));return require(id);},async(url,options)=>{calls.push({url,options});return mock(url,options);});return out;}
const {POST}=load('app/api/count-tokens/route.ts');
function req(provider='openai',file=new File(['The actual source text.'],'paper.txt'),knowledge=false,web=false){const model=provider==='openai'?'gpt-6-luna':provider==='anthropic'?'claude-haiku-5-5':'gemini-3.1-flash-lite',effort=provider==='gemini'?'minimal':'medium';const f=new FormData();for(const [k,v] of Object.entries({provider,model,effort,prompt:'Classify and explain using my rubric.'}))f.set(k,v);if(knowledge){f.set('mode','model-knowledge');f.set('webSearch',String(web));f.set('fields',JSON.stringify([{heading:'Title',value:'Dracula'}]));}else f.set('file',file);return new Request('https://lab.test/api/count-tokens',{method:'POST',headers:{origin:'https://lab.test',Authorization:provider==='openai'?'Bearer sk-test':'Bearer mock-test-key'},body:f});}
(async()=>{
 for(const provider of ['openai','anthropic','gemini']){
  const r=await POST(req(provider));assert.equal(r.status,200);assert.equal((await r.json()).inputTokens,1234);const call=calls.at(-1),body=JSON.parse(call.options.body);
  assert(/count_tokens$|input_tokens$|:countTokens$/.test(call.url),'Only count-only endpoints are allowed');
  assert(JSON.stringify(body).includes('The actual source text.'));assert(JSON.stringify(body).includes('Classify and explain using my rubric.'));assert(JSON.stringify(body).includes('explanation'),'Prepared response schema is included');
  if(provider==='gemini'){assert(body.generateContentRequest.systemInstruction);assert(body.generateContentRequest.generationConfig.responseSchema);assert.equal(body.contents,undefined);assert.equal(call.options.headers.Authorization,undefined);}
  if(provider==='anthropic'){assert(body.output_config.format.schema);assert(body.thinking);assert.equal(call.options.headers.Authorization,undefined);}
  if(provider==='openai'){assert(body.text.format.schema);assert.equal(body.store,undefined);assert.equal(body.tools,undefined);}
  const pdf=await POST(req(provider,new File(['%PDF-testing'],'test.pdf')));assert.equal(pdf.status,200);assert(JSON.stringify(JSON.parse(calls.at(-1).options.body)).includes('JVBERi10ZXN0aW5n'));
  const k=await POST(req(provider,undefined,true,true));assert.equal(k.status,200);const payload=JSON.parse(calls.at(-1).options.body);assert(JSON.stringify(payload).includes('Dracula'));assert(JSON.stringify(payload).includes('web research'));assert.equal(payload.tools,undefined,'Counting never executes search');
 }
 const bad=req();bad.headers.set('origin','https://evil.test');const before=calls.length;assert.equal((await POST(bad)).status,403);assert.equal(calls.length,before);
 const missing=req();missing.headers.delete('authorization');assert.equal((await POST(missing)).status,401);
 mock=async()=>Response.json({error:{message:'rejected'}},{status:429});const limited=await POST(req());assert.equal(limited.status,429);assert.match((await limited.json()).error,/rate limit/);
 mock=async()=>Response.json({input_tokens:-1});assert.equal((await POST(req())).status,502);
 // The client uses exact provider counts without adding the prompt or applying
 // Claude's tokenizer multiplier again; edits invalidate them immediately.
 const {countStudentInputs,studentEstimate}=load('lib/student-estimate.ts');let clientCalls=0;mock=async(url)=>{assert.equal(url,'/api/count-tokens');clientCalls++;return Response.json({inputTokens:4321});};
 const a={id:'a',status:'pending',file:new File(['Source one'],'one.txt')},b={id:'b',status:'pending',file:new File(['Source two'],'two.txt')};
 const config={provider:'anthropic',model:'claude-haiku-5-5',effort:'medium',prompt:'Return a category and explanation.',rows:[a,b],apiKey:'mock-key',signal:new AbortController().signal};
 let e=await countStudentInputs(config);assert.equal(e.input.low,8642);assert.equal(e.input.high,8642);assert.equal(e.inputBasis,'provider');assert.equal(clientCalls,2);
 e=await studentEstimate(config);assert.equal(e.input.low,8642);assert.equal(clientCalls,2);
 e=await countStudentInputs({...config,rows:[b]});assert.equal(e.input.low,4321);assert.equal(clientCalls,2);
 e=await studentEstimate({...config,prompt:'A new task.'});assert.equal(e.inputBasis,'approximate');assert.notEqual(e.input.low,e.input.high);
 const web=await countStudentInputs({...config,knowledge:true,webSearch:true,rows:[{id:'s',status:'pending',fields:[{heading:'Title',value:'Dracula'}]}]});assert(web.input.high>web.input.low,'Future search input still has uncertainty');
 console.log('PASS: all three count-only endpoints, prompts/schema/PDFs/items, no inference/search calls, credential routing, origin/rate-limit handling, exact input totals, caching, and invalidation after input/settings edits. All traffic mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
