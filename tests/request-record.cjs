// Research mode's record of a request: the body kept once with marks where the document goes, what the
// provider notes of its reply, and how the record travels with retries, runs, and backups. Every provider
// call is intercepted; no provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const root=process.cwd(),cache=new Map();let calls=[],mock=async()=>Response.json({});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):require(id);
 new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});
 return exports;
}
const route=load('app/api/annotate/route.ts'),batchRoute=load('app/api/batch/route.ts'),batch=load('lib/batch-provider.ts'),providers=load('lib/providers.ts'),frames=load('lib/request-frame.ts'),knowledgeLib=load('lib/model-knowledge.ts');
const {extractText}=load('lib/extract-text.ts'),records=load('lib/research/requests.ts'),runs=load('lib/research/runs.ts'),safety=load('lib/workflow-safety.ts'),backup=load('lib/study-backup.ts');

const PROMPT='Classify the tone of the text.\nRate hope from 1 to 5.';
// The prompt as the request handlers hold it: a form field's line breaks are CR LF.
const SENT_PROMPT='Classify the tone of the text.\r\nRate hope from 1 to 5.';
const pdf=new File([new Uint8Array([37,80,68,70,45,49,46,52,10,1,2,3,250,251,252])],'Report “A”.pdf',{type:'application/pdf'});
const txt=new File(['A document with “quotes” and\nlines. It names <<DOCUMENT_TEXT>> and <<FILE_BASE64>> itself.'],'text one.txt');
const SUBJECT=[{heading:'Film',value:'Jaws'},{heading:'Year',value:'1975'}];
const formats={
 standard:{fields:[],settings:undefined},
 named:{fields:['Tone','Explanation'],settings:undefined},
 plain:{fields:['response'],settings:{plain:true}},
 typed:{fields:['hope','kind','note'],settings:{fields:[{name:'hope',type:'ordinal',values:['1','2','3','4','5'],description:'Hope.'},{name:'kind',type:'category',values:['a','b'],description:''},{name:'note',type:'text',values:[],description:'A note.'}]}},
 typedNoRationale:{fields:['flag','n'],settings:{rationale:false,fields:[{name:'flag',type:'boolean',values:['yes','no'],description:''},{name:'n',type:'number',values:[],description:''}]}},
};
const answerText=JSON.stringify({explanation:'Because.',score:'A',answers:{f0:'1',f1:'a',f2:'y'}});
// A provider's reply to an annotation request. `text` is what the model wrote; `stop` and `model` are the provider's own notes.
function providerReply(provider,{text=answerText,model,stop}={}){
 if(provider==='openai')return {status:stop||'completed',...(stop?{incomplete_details:{reason:'max_output_tokens'}}:{}),model:model===undefined?'gpt-6-luna-2026-10-01':model,id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text}]}]};
 if(provider==='anthropic')return {stop_reason:stop||'end_turn',model:model===undefined?'claude-sonnet-5-5-20260901':model,id:'msg_test',usage:{input_tokens:10,output_tokens:2},content:[{type:'text',text}]};
 if(provider==='gemini')return {modelVersion:model===undefined?'gemini-3.8-flash-002':model,responseId:'gem_test',candidates:[{finishReason:stop||'STOP',content:{parts:[{text}]}}],usageMetadata:{totalTokenCount:12}};
 return {id:'gen_test',model:model===undefined?'openai/gpt-6-luna':model,provider:'OpenAI',choices:[{finish_reason:stop||'stop',message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}};
}
const keyOf=provider=>provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test';
function annotate(provider,model,effort,format,{cacheOn=false,kind='txt',record,web=false}={}){
 const form=new FormData(),knowledge=kind==='knowledge';
 for(const [k,v]of Object.entries({provider,model,effort,prompt:PROMPT,answerFields:JSON.stringify(format.fields)}))form.set(k,v);
 if(format.settings)form.set('answerSettings',JSON.stringify(format.settings));
 if(cacheOn)form.set('requestSettings','{"cache":true}');
 if(record!==undefined)form.set('record',record);
 if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify(SUBJECT));form.set('webSearch',String(web));}else form.set('file',kind==='pdf'?pdf:txt);
 return route.POST(new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(provider)},body:form}));
}
const base64=async file=>Buffer.from(await file.arrayBuffer()).toString('base64');

(async()=>{
 // --- The recorded request, filled with a document, is the request that was sent, byte for byte --------
 const txtText=await extractText(txt),pdfData=await base64(pdf);
 let compared=0;
 for(const [provider,spec] of Object.entries(providers.PROVIDERS)){
  for(const model of spec.models){
   const efforts=providers.reasoningOptions(provider,model);
   for(const effort of new Set([efforts[0],efforts[efforts.length-1]])){
    for(const [formatName,format] of Object.entries(formats)){
     for(const cacheOn of [false,true]){
      for(const kind of ['txt','pdf','knowledge']){
       const knowledge=kind==='knowledge',label=[provider,model,effort,formatName,cacheOn?'cache':'no cache',kind].join(' | ');
       const settings={provider,model,effort,prompt:PROMPT,answerFields:format.fields,answerSettings:format.settings,requestSettings:cacheOn?{cache:true}:undefined,knowledge,layout:'message'};
       const doc=knowledge?{filename:'subject.txt',text:knowledgeLib.knowledgeDocumentText(SUBJECT)}:kind==='pdf'?{filename:pdf.name,file:pdfData}:{filename:txt.name,text:txtText};
       calls=[];mock=async()=>Response.json(providerReply(provider));
       await annotate(provider,model,effort,format,{cacheOn,kind,record:'true'});
       assert.equal(calls.length,1,label);
       const frame=frames.requestFrame(settings,kind==='pdf');
       assert.equal(calls[0].url,frame.url,label);
       assert.equal(calls[0].options.body,JSON.stringify(frames.fillRequest(frame.body,doc)),'Sent now: '+label);
       assert(!frame.body.includes(keyOf(provider)),'A recorded request never holds a key');
       compared++;
       if(provider!=='openrouter'){
        const file=knowledge?new File([knowledgeLib.knowledgeDocumentText(SUBJECT)],'subject.txt',{type:'text/plain'}):kind==='pdf'?pdf:txt;
        const sent=JSON.stringify(await batch.buildBatchBody(provider,file,knowledge?SENT_PROMPT+'\n\n'+knowledgeLib.knowledgeInstructions(false):SENT_PROMPT,model,effort,knowledge,false,format.fields,format.settings,cacheOn?{cache:true}:undefined));
        assert.equal(sent,JSON.stringify(frames.fillRequest(frames.requestFrame({layout:'message',...settings,batch:true},kind==='pdf').body,doc)),'Sent in a batch: '+label);
        compared++;
       }
      }
     }
    }
   }
  }
 }
 assert(compared>2000,'Every listed model was compared');
 // The prompt is recorded with the line breaks it was sent with, whatever form it was written in.
 assert.equal(frames.formText('a\nb\r\nc\rd'),'a\r\nb\r\nc\r\nd');
 for(const written of ['One.\nTwo.','One.\r\nTwo.','One.\rTwo.'])assert.equal(frames.requestFrame({layout:'message',provider:'gemini',model:providers.PROVIDERS.gemini.models[0],effort:providers.reasoningOptions('gemini',providers.PROVIDERS.gemini.models[0])[0],prompt:written,answerFields:[]},false).body,frames.requestFrame({layout:'message',provider:'gemini',model:providers.PROVIDERS.gemini.models[0],effort:providers.reasoningOptions('gemini',providers.PROVIDERS.gemini.models[0])[0],prompt:'One.\r\nTwo.',answerFields:[]},false).body);
 // A batch as the batch handler submits it: each request is the recorded form filled with its document.
 for(const provider of ['openai','anthropic','gemini']){
  const model=providers.PROVIDERS[provider].models[0],effort=providers.reasoningOptions(provider,model)[0],form=new FormData();
  for(const [k,v]of Object.entries({action:'submit',provider,model,effort,prompt:PROMPT,answerFields:'[]',requestSettings:'{"cache":true}',runId:'lab_test',ids:JSON.stringify(['lab_test_0','lab_test_1'])}))form.set(k,v);
  form.append('files',txt);form.append('files',pdf);
  calls=[];mock=async url=>Response.json(provider==='openai'?(String(url).endsWith('/files')?{id:'file-abc'}:{id:'batch_abc'}):provider==='anthropic'?{id:'msgbatch_abc'}:{name:'batches/abc'});
  const response=await batchRoute.POST(new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(provider)},body:form}));
  assert.equal(response.status,200,provider+': '+JSON.stringify(await response.clone().json()));
  const payload=calls[0].options.body,rows=provider==='openai'?(await payload.get('file').text()).split('\n').map(line=>JSON.parse(line).body):provider==='anthropic'?JSON.parse(await payload.text()).requests.map(row=>row.params):JSON.parse(await payload.text()).batch.input_config.requests.requests.map(row=>row.request);
  const settings={provider,model,effort,prompt:PROMPT,answerFields:[],requestSettings:{cache:true},batch:true,layout:'message'};
  assert.deepEqual(rows.map(row=>JSON.stringify(row)),[JSON.stringify(frames.fillRequest(frames.requestFrame(settings,false).body,{filename:txt.name,text:txtText})),JSON.stringify(frames.fillRequest(frames.requestFrame(settings,true).body,{filename:pdf.name,file:pdfData}))],provider+': a submitted batch');
 }
 // A mark inside a document's own text stays text.
 assert(JSON.stringify(frames.fillRequest(frames.requestFrame({layout:'message',provider:'anthropic',model:providers.PROVIDERS.anthropic.models[0],effort:providers.reasoningOptions('anthropic',providers.PROVIDERS.anthropic.models[0])[0],prompt:PROMPT,answerFields:[]},false).body,{filename:'a.txt',text:'See <<DOCUMENT_FILENAME>>.'})).includes('See <<DOCUMENT_FILENAME>>.'));
 // Web-assisted Model knowledge: the search is its own request; the annotation request carries what the search found.
 const found='A source-supported fact.';
 const search=provider=>provider==='openai'?{id:'search_oai',status:'completed',usage:{total_tokens:20},output:[{type:'web_search_call',status:'completed',action:{query:'Jaws',sources:[{url:'https://example.org/jaws',title:'Jaws'}]}},{content:[{type:'output_text',text:found,annotations:[{type:'url_citation',url:'https://example.org/jaws',title:'Jaws',start_index:0,end_index:found.length}]}]}]}:provider==='anthropic'?{id:'search_claude',stop_reason:'end_turn',usage:{input_tokens:12,output_tokens:8},content:[{type:'server_tool_use',name:'web_search',input:{query:'Jaws'}},{type:'web_search_tool_result',content:[{url:'https://example.org/jaws',title:'Jaws'}]},{type:'text',text:found,citations:[{type:'web_search_result_location',url:'https://example.org/jaws',title:'Jaws'}]}]}:{responseId:'search_gemini',usageMetadata:{totalTokenCount:20},candidates:[{finishReason:'STOP',content:{parts:[{text:found}]},groundingMetadata:{webSearchQueries:['Jaws'],groundingChunks:[{web:{uri:'https://example.org/jaws',title:'Jaws'}}],groundingSupports:[{segment:{endIndex:found.length},groundingChunkIndices:[0]}]}}]};
 for(const provider of ['openai','anthropic','gemini']){
  const model=providers.PROVIDERS[provider].models[0],effort=providers.reasoningOptions(provider,model)[0];
  calls=[];mock=async(url,options)=>Response.json(/"tools":|"google_search"/.test(options.body)?search(provider):providerReply(provider,{text:JSON.stringify({explanation:'Supported by [1].',score:'A'})}));
  const response=await annotate(provider,model,effort,formats.standard,{kind:'knowledge',record:'true',web:true}),out=await response.json();
  assert.equal(response.status,200,provider+': '+JSON.stringify(out));assert.equal(calls.length,2);
  const frame=frames.requestFrame({layout:'message',provider,model,effort,prompt:PROMPT,answerFields:[],knowledge:true,webSearch:true},false);
  assert.equal(calls[1].options.body,JSON.stringify(frames.fillRequest(frame.body,{filename:'subject.txt',text:knowledgeLib.knowledgeDocumentText(SUBJECT,out.research)})),provider+': the annotation request of a web-assisted run is rebuilt from the stored research');
  // In a batch no search is made, whatever the workspace's setting.
  assert.equal(frames.requestFrame({layout:'message',provider,model,effort,prompt:PROMPT,answerFields:[],knowledge:true,webSearch:true,batch:true},false).body,frames.requestFrame({layout:'message',provider,model,effort,prompt:PROMPT,answerFields:[],knowledge:true,webSearch:false,batch:true},false).body);
 }

 // --- What a reply carries when recording is on, and that the standard Lab's reply is unchanged ----------
 const NOTES=['modelReported','stopReason','output'];
 const expected={openai:['gpt-6-luna-2026-10-01','completed'],anthropic:['claude-sonnet-5-5-20260901','end_turn'],gemini:['gemini-3.8-flash-002','STOP'],openrouter:['openai/gpt-6-luna via OpenAI','stop']};
 const truncated={openai:['incomplete','incomplete: max_output_tokens'],anthropic:['max_tokens','max_tokens'],gemini:['MAX_TOKENS','MAX_TOKENS'],openrouter:['length','length']};
 for(const provider of Object.keys(providers.PROVIDERS)){
  const model=providers.PROVIDERS[provider].models[0],effort=providers.reasoningOptions(provider,model)[0];
  const ask=async(format,options,reply)=>{calls=[];mock=async()=>Response.json(reply);const response=await annotate(provider,model,effort,format,options);return {status:response.status,out:await response.json()};};
  const on=await ask(formats.typed,{record:'true'},providerReply(provider)),off=await ask(formats.typed,{},providerReply(provider));
  assert.equal(on.status,200,provider+': '+JSON.stringify(on.out));
  assert.deepEqual([on.out.modelReported,on.out.stopReason,on.out.output],[...expected[provider],answerText],provider);
  assert(NOTES.every(key=>!(key in off.out)),provider+': the standard Lab’s reply carries no record');
  assert.deepEqual(Object.fromEntries(Object.entries(on.out).filter(([key])=>!NOTES.includes(key))),off.out,provider+': recording changes nothing else in a reply');
  // A reply that was cut short keeps why.
  const cut=await ask(formats.typed,{record:'true'},providerReply(provider,{stop:truncated[provider][0]}));
  assert.equal(cut.status,422);assert.equal(cut.out.stopReason,truncated[provider][1],provider);assert(cut.out.error);
  const cutStandard=await ask(formats.typed,{},providerReply(provider,{stop:truncated[provider][0]}));assert(NOTES.every(key=>!(key in cutStandard.out)));
  // Only short codes are noted: a provider's message (which could echo a document or a credential) is never kept.
  const unsafe=await ask(formats.typed,{record:'true'},providerReply(provider,{model:'model\n{"error":"Incorrect API key provided: sk-secret"}'}));
  assert.equal(unsafe.status,200);assert(!JSON.stringify(unsafe.out).includes('sk-secret'),provider);
  assert.equal(unsafe.out.modelReported,provider==='openrouter'?'OpenAI':undefined);
  // A rejected reply is kept once (as the raw response), and so is a plain-text answer that is the whole reply.
  const rejected=await ask(formats.typed,{record:'true'},providerReply(provider,{text:JSON.stringify({explanation:'Because.',score:'A',answers:{f0:'9',f1:'a',f2:'y'}})}));
  assert.equal(rejected.status,422);assert(rejected.out.rawResponse.includes('"f0":"9"'));assert(!('output' in rejected.out),provider);
  const plain=await ask(formats.plain,{record:'true'},providerReply(provider,{text:'Mostly hopeful.'}));
  assert.equal(plain.out.answers.f0,'Mostly hopeful.');assert(!('output' in plain.out),provider);assert.equal(plain.out.stopReason,expected[provider][1]);
  const padded=await ask(formats.plain,{record:'true'},providerReply(provider,{text:'\nMostly hopeful.\n'}));
  assert.equal(padded.out.answers.f0,'Mostly hopeful.');assert.equal(padded.out.output,'\nMostly hopeful.\n',provider+': the reply as returned');
  // Only "true" switches recording on; anything else is refused before a provider is called.
  calls=[];assert.equal((await annotate(provider,model,effort,formats.typed,{record:'yes'})).status,400);assert.equal(calls.length,0);
 }
 assert.equal(frames.replyCode('a'.repeat(201)),undefined);assert.equal(frames.replyCode(7),undefined);assert.equal(frames.replyCode('models/gemini-4-argon@001 (preview)'),'models/gemini-4-argon@001 (preview)');

 // --- Batch results ------------------------------------------------------------------------------------
 for(const provider of ['openai','anthropic','gemini']){
  const noted=batch.parseBatchAnnotation(provider,providerReply(provider),false,true),bare=batch.parseBatchAnnotation(provider,providerReply(provider));
  assert.deepEqual([noted.modelReported,noted.stopReason,noted.output],[...expected[provider],answerText],provider);
  assert(NOTES.every(key=>!(key in bare)),provider+': a batch collected by the standard Lab carries no record');
  assert.deepEqual(Object.fromEntries(Object.entries(noted).filter(([key])=>!NOTES.includes(key))),bare);
  const cut=batch.parseBatchAnnotation(provider,providerReply(provider,{stop:truncated[provider][0]}),false,true);
  assert(cut.error);assert.equal(cut.stopReason,truncated[provider][1]);assert(!('output' in cut));
  assert(!('output' in batch.parseBatchAnnotation(provider,providerReply(provider,{text:'Mostly hopeful.'}),true,true)));
  assert.equal(batch.parseBatchAnnotation(provider,providerReply(provider,{text:' Mostly hopeful.'}),true,true).output,' Mostly hopeful.');
 }
 {const source=fs.readFileSync(path.join(root,'app/api/batch/route.ts'),'utf8');assert(source.includes("checkBatch(provider,key,id,action==='collect',f.get('plain')==='true',record==='true',summary==='true',format)"));}

 // --- The list of requests -----------------------------------------------------------------------------
 const frameA={url:'https://a.test',body:'{"a":1}'},frameB={url:'https://a.test',body:'{"b":2}'};
 const first=records.recordRequest(undefined,frameA);assert.deepEqual(first,{list:[{id:'q1',...frameA}],id:'q1'});
 const again=records.recordRequest(first.list,frameA);assert.equal(again.id,'q1');assert.equal(again.list,first.list,'A request already kept leaves the list as it is');
 const second=records.recordRequest(first.list,frameB);assert.equal(second.id,'q2');assert.equal(first.list.length,1,'The list itself is never changed');
 assert.equal(records.recordRequest([{id:'q7',...frameA}],frameB).id,'q8');
 assert.equal(records.cleanRequests(undefined),undefined);assert.equal(records.cleanRequests([]),undefined);
 assert.deepEqual(records.cleanRequests([{id:'q1',...frameA,extra:1},{id:'q1',...frameB},{id:'x',...frameA},{id:'q2',url:5,body:'{}'},null]),[{id:'q1',...frameA}]);
 assert.equal(records.usedRequests(second.list,[{requestId:'q1'},{earlier:[{requestId:'q2'}]}]),second.list);
 assert.deepEqual(records.usedRequests(second.list,[{requestId:'q9',history:[{requestId:'q2'}]}]),[second.list[1]]);
 assert.deepEqual(records.usedRequests(second.list,[{earlier:[{history:[{requestId:'q1'}]}]}]),[second.list[0]]);
 assert.equal(records.usedRequests(second.list,[{}]),undefined);
 assert.deepEqual(records.replyNotes({modelReported:'m',stopReason:'s',output:'o',score:'A',error:'no'}),{modelReported:'m',stopReason:'s',output:'o'});assert.deepEqual(records.replyNotes({modelReported:5}),{});assert.deepEqual(records.replyNotes(null),{});

 // --- Retries, runs, and clearing ----------------------------------------------------------------------
 const failed={id:'t',status:'error',error:'Cut short.',runNo:2,requestId:'q1',modelReported:'m',stopReason:'max_tokens',output:'{"sc',lab:'2026-11-16 abc1234',name:'t.txt'};
 const standardRetry=safety.queueRetries([failed])[0];
 assert.deepEqual(standardRetry.history,[{status:'error',error:'Cut short.',requestId:'q1',modelReported:'m',stopReason:'max_tokens',output:'{"sc',lab:'2026-11-16 abc1234'}]);
 assert(records.RECORDED_KEYS.every(key=>!(key in standardRetry)),'The text waiting again holds nothing of the failed attempt');assert.equal(standardRetry.runNo,2);
 const researchRetry=safety.queueRetries([failed],undefined,['runNo'])[0];
 assert.equal(researchRetry.history[0].runNo,2,'Research mode: a failed attempt keeps its run');assert.equal(researchRetry.runNo,2);
 assert(!('runNo' in safety.queueRetries([{id:'s',status:'error',error:'e',runNo:1}])[0].history[0]),'The standard Lab’s attempts are as before');
 const done={id:'d',name:'d.txt',status:'done',runNo:1,provider:'openai',model:'m',effort:'low',prompt:'p',score:'A',explanation:'e',requestId:'q1',modelReported:'m-1',stopReason:'completed',output:'{}',reasoningSummary:'Weighed both readings.',lab:'2026-11-16 abc1234'};
 const moved=runs.requeue([done],[],new Set(['d'])).docs[0];
 assert.deepEqual(records.RECORDED_KEYS.map(key=>moved.earlier[0][key]),['q1','m-1','completed','{}','Weighed both readings.','2026-11-16 abc1234',undefined]);assert(records.RECORDED_KEYS.every(key=>!(key in moved)));
 assert(records.RECORDED_KEYS.every(key=>!(key in runs.clearRuns(done))));
 assert.equal(runs.rowForRun(moved,1).requestId,'q1');

 // --- Backups ------------------------------------------------------------------------------------------
 const body=JSON.stringify({model:'m',system:'The words api_key, password, and Authorization in a prompt are text.',messages:[{role:'user',content:'<<DOCUMENT_TEXT>>'}]});
 const workspace={prompt:'p',requests:[{id:'q1',url:'https://api.anthropic.com/v1/messages',body}],docs:[{id:'d',name:'d.txt',file:new File(['Text'],'d.txt'),status:'done',score:'A',explanation:'e',runNo:1,requestId:'q1',modelReported:'claude-sonnet-5-5-20260901',stopReason:'end_turn',output:'{"score":"A"}',reasoningSummary:'Compared the text with each category.',lab:'2026-11-16 abc1234',history:[{status:'error',error:'Cut short.',requestId:'q1',stopReason:'max_tokens',runNo:1}]}]};
 const encoded=await backup.encodeStudyBackup({name:'Study',createdAt:new Date().toISOString(),texts:workspace,knowledge:{items:[]}});
 const restored=backup.decodeStudyBackup(encoded).texts;
 assert.deepEqual(restored.requests,workspace.requests,'The requests travel with a study backup, whole');
 assert.deepEqual(records.RECORDED_KEYS.map(key=>restored.docs[0][key]),['q1','claude-sonnet-5-5-20260901','end_turn','{"score":"A"}','Compared the text with each category.',undefined,undefined],'A backup keeps the record of each request but not the build that sent it');assert(!encoded.includes('abc1234')&&JSON.parse(encoded).format==='text-annotation-study','Nothing in a backup names the Lab or its build');
 const older=JSON.parse(encoded);older.format='text-annotation-lab-study';assert.equal(backup.decodeStudyBackup(JSON.stringify(older)).texts.docs[0].requestId,'q1','A backup made before still imports');assert.equal(restored.docs[0].history[0].stopReason,'max_tokens');
 const tampered=JSON.parse(encoded);tampered.workspaces.texts.requests[0].id='../q1';
 assert.throws(()=>backup.decodeStudyBackup(JSON.stringify(tampered)),/Invalid texts workspace at requests/);
 const longNote=JSON.parse(encoded);longNote.workspaces.texts.docs[0].stopReason='x'.repeat(201);
 assert.throws(()=>backup.decodeStudyBackup(JSON.stringify(longNote)),/Invalid texts workspace at docs/);

 // --- The pages: only research mode asks for a record --------------------------------------------------
 for(const page of ['app/page.tsx','components/model-knowledge.tsx']){
  const source=fs.readFileSync(path.join(root,page),'utf8');
  assert.equal(source.split("form.set('record','true')").length-1,2,page+': results made now and results collected from a batch');
  assert(source.includes("if(research)form.set('record','true');")&&source.includes("if(research&&action==='collect'){form.set('record','true');if(job.requestSettings?.summary)form.set('summary','true');}"),page);
  assert(source.includes('if(!research)return {};'),page+': the standard Lab records no request');
 }
 console.log(`PASS: research mode’s record of a request: ${compared} requests equal their recorded form filled with the document (every provider and model, now and in a batch, text, PDF, and Model knowledge), the provider’s notes, retries, runs, and backups. No provider was called.`);
})().catch(error=>{console.error(error);process.exit(1);});
