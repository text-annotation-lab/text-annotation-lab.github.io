// Regressions for the independent audit of November 17, 2026: label sheets keyed by doc_id, cut-off replies that
// keep their tokens, response ID, and partial text, a declared category named like a tie, one bar per declared
// value, retries with the values a run sent, recorded addresses, and copies of imported studies. Mocked requests only.
const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=process.cwd(),ts=require(path.join(root,'node_modules/typescript'));
let enabled=true,calls=[];let mock=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'ignore'},{text:'{"score":"4","explanation":"Evidence"}'}]}}],usageMetadata:{totalTokenCount:30}});
function load(file){const filename=path.join(root,file);const exports={};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports,require:(id)=>{if(id.includes('provider-errors'))return load('lib/provider-errors.ts');if(id.includes('extract-text'))return {supportedFile:/\.(txt|pdf)$/i,extractText:f=>f.text()};if(id.includes('batch-limits'))return load('lib/batch-limits.ts');if(id.includes('knowledge-web'))return load('lib/knowledge-web.ts');if(id.includes('model-knowledge'))return load('lib/model-knowledge.ts');if(id.includes('providers'))return {...load('lib/providers.ts'),GEMINI_ENABLED:enabled};if(id.includes('anthropic'))return load('lib/anthropic.ts');if(id.includes('gemini'))return load('lib/gemini.ts');if(id.startsWith('@/'))return load(id.slice(2)+'.ts');if(id.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts')));return require(id);},Response,Request,File,FormData,URL,AbortSignal,Uint8Array,btoa,fetch:async(url,options)=>{calls.push({url,options});return mock(url,options);}};new Function(...Object.keys(context),code)(...Object.values(context));return exports;}
function request(model='claude-sonnet-5-5',effort='high',file=new File(['sample'],'test.txt'),provider='anthropic',key='sk-ant-test') {const f=new FormData();for(const [k,v] of Object.entries({provider,model,effort,prompt:'Rate text',file}))f.set(k,v);return new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:'Bearer '+key},body:f});}
function loadTs(file){const cache=loadTs.cache||(loadTs.cache=new Map());const {createRequire}=require('node:module'),req=createRequire(path.join(root,'package.json'));const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return loadTs(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};new Function('exports','require',code)(exports,local);return exports;}
(async()=>{
 // 1. A sheet keyed by the exports' doc_id: alpha.md is exported as alpha_2, and a file alpha_2.txt (alpha_2_2)
 // has that name without its extension. The row is ambiguous, not given to the wrong text; alone, alpha_2 finds alpha.md.
 const columns=loadTs('lib/research/columns.ts');
 const three=[{id:'1',name:'alpha.txt'},{id:'2',name:'alpha.md'},{id:'3',name:'alpha_2.txt'}];
 assert.deepEqual([...columns.docIds({kind:'texts',rows:three}).values()],['alpha','alpha_2','alpha_2_2']);
 let sheet=columns.applySheet(three,[],{header:['doc_id','human_code'],rows:[['alpha_2','NEGATIVE']]},0,['','label']);
 assert.deepEqual(sheet.docs.map(d=>d.cells),[undefined,undefined,undefined]);assert.deepEqual([sheet.matched,sheet.ambiguous],[0,['alpha_2']]);
 const two=three.slice(0,2);
 sheet=columns.applySheet(two,[],{header:['doc_id','human_code'],rows:[['alpha_2','NEGATIVE'],['alpha.txt','POSITIVE']]},0,['','label']);
 assert.deepEqual(sheet.docs.map(d=>d.cells),[['POSITIVE'],['NEGATIVE']]);
 sheet=columns.applySheet(three,[],{header:['doc_id','human_code'],rows:[['alpha_2_2','X']]},0,['','label']);assert.deepEqual(sheet.docs.map(d=>d.cells),[undefined,undefined,['X']]);

 // 2. Cut-off replies keep the tokens, the response ID, and (when recording) the text returned so far.
 const route=load('app/api/annotate/route.ts');
 const recorded=(model,provider,key)=>{const r=request(model,'high',undefined,provider,key);return r;};
 mock=async()=>Response.json({id:'msg_cut',model:'claude-sonnet-5-5',stop_reason:'max_tokens',content:[{type:'text',text:'{"score":"3","expl'}],usage:{input_tokens:10,output_tokens:5}});
 let out=await (await route.POST(recorded('claude-sonnet-5-5','anthropic','sk-ant-test'))).json();
 assert.equal(out.tokens,15);assert.equal(out.responseId,'msg_cut');assert.deepEqual(out.usage,{input_tokens:10,output_tokens:5});assert(out.error);
 mock=async()=>Response.json({id:'resp_cut',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{type:'message',content:[{type:'output_text',text:'{"score":"2"'}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}});
 out=await (await route.POST(recorded('gpt-6-sol','openai','sk-test'))).json();
 assert.equal(out.tokens,15);assert.equal(out.responseId,'resp_cut');assert(out.error);
 mock=async()=>Response.json({responseId:'g_cut',candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"score"'}]}}],usageMetadata:{totalTokenCount:15}});
 const gemini=load('lib/gemini.ts');
 const g=await gemini.annotateGemini(new File(['sample'],'test.txt'),'Rate text','gemini-4-hydrogen','high','AIza-test',false,false,[],'Rate text',undefined,undefined,true);
 out=await g.json();assert.equal(out.tokens,15);assert.equal(out.responseId,'g_cut');assert.equal(out.output,'{"score"');assert(out.error);

 // 3. A declared category whose name holds " | " is no tie; a real tie is still left out.
 const metrics=loadTs('lib/research/metrics.ts');
 let a=metrics.agreement(['a | b','other'],['a | b','other'],'nominal',['a | b','other'],1,{withIntervals:false});
 assert.equal(a.n,2);assert.equal(a.cohenKappa,1);
 a=metrics.agreement(['a | other','other','a'],['a','other','a'],'nominal',['a','other'],1,{withIntervals:false});assert.equal(a.n,2);
 const comparable=loadTs('lib/research/comparable.ts');
 assert.equal(comparable.comparableValues([['a | b','other']],'nominal',['a | b','other'])('a | b'),true);

 // 4. Declared values that read alike ("01" and "1") get one bar in the Results panel, not two.
 const summaryFields=loadTs('lib/research/summary-fields.ts');
 const fields=summaryFields.summaryFields([{id:'t',status:'done',runNo:1,answers:{f0:'1'},answerFields:['code'],answerSettings:{named:true,fields:[{name:'code',type:'category',values:['01','1','other'],description:''}]}}],1);
 const code=fields.find(f=>f.key==='code');assert(code,'the field is listed');assert.deepEqual(code.allowed,['1','other']);

 // 5. "Retry failed" sends the values the run sent: read from the failed attempt of that run.
 const inserts=loadTs('lib/research/inserts.ts');
 const row={id:'d',runNo:1,status:'pending',cells:['2024'],history:[{status:'error',runNo:1,inserts:['1990']}]};
 assert.deepEqual(inserts.sentInserts(row,1,1),['1990']);assert.equal(inserts.sentInserts(row,2,1),undefined);
 assert.deepEqual(inserts.sentInserts({id:'d',runNo:3,annotations:[{inserts:['x']}]},3,1),['x']);
 assert.equal(inserts.sentInserts({id:'d',runNo:1,history:[{runNo:1,inserts:['a','b']}]},1,1),undefined,'a record with another number of values is not used');

 // 6. A recorded address that is not the provider's own is not kept.
 const requests=loadTs('lib/research/requests.ts');
 assert.equal(requests.cleanRequests([{id:'q1',url:'http://127.0.0.1:9/v1/messages',body:'{}'}]),undefined);
 assert.equal(requests.officialUrl('https://api.openai.com/v1/responses','openai'),true);

 // 7. A copy of a copy is named after the study, not "(imported) (imported)".
 const backup=fs.readFileSync(path.join(root,'lib/study-backup.ts'),'utf8');
 const strip=new Function('name',"return name.replace(/( \\(imported(?: \\d+)?\\))+$/,'')");
 assert(backup.includes(".replace(/( \\(imported(?: \\d+)?\\))+$/,'')"));
 assert.equal(strip('Audit (imported)'),'Audit');assert.equal(strip('Audit (imported 2) (imported)'),'Audit');assert.equal(strip('Audit (draft)'),'Audit (draft)');
 console.log('PASS: audit regressions (doc_id label sheets, cut-off replies, ties, one bar per value, retry values, recorded addresses, import names). Mocked requests only.');
})().catch(e=>{console.error(e);process.exit(1)});
