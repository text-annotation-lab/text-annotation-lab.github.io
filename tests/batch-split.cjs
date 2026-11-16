// Research mode: a batch run larger than one provider batch is sent as several batches in the same run.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const cache=new Map();let calls=[],mock;
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('exports','require','fetch',code)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id),async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}
const route=load('app/api/batch/route.ts'),split=load('lib/research/batch-split.ts'),limits=load('lib/batch-limits.ts');
const settings={openai:['gpt-6-luna','medium'],anthropic:['claude-haiku-4-5-20251001','4096'],gemini:['gemini-3.8-flash','medium']};
const keyOf=provider=>provider==='openai'?'sk-test':'provider-test';
function post(form,query=''){return route.POST(new Request('https://lab.test/api/batch'+query,{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(form.get('provider'))},body:form}));}
function runForm(provider,action,{subjects,files,copies,runId='lab_split'}={}){
 const form=new FormData(),[model,effort]=settings[provider],count=(subjects||files).length,total=copies?copies.reduce((n,c)=>n+c,0):count;
 for(const [k,v]of Object.entries({provider,action,model,effort,prompt:'Rate the subject.',runId,ids:JSON.stringify(Array.from({length:total},(_,i)=>runId+'_'+i))}))form.set(k,v);
 if(copies)form.set('copies',JSON.stringify(copies));
 if(subjects){form.set('mode','model-knowledge');form.set('subjects',JSON.stringify(subjects));}else for(const file of files)form.append('files',file);
 return form;
}
function sendForm(provider,part,runId='lab_split'){const form=new FormData();for(const [k,v]of Object.entries({provider,action:'send',model:settings[provider][0],runId,part:String(part)}))form.set(k,v);return form;}
const providerOk=provider=>async url=>Response.json(url.endsWith('/files')?{id:'file-split'+calls.length}:provider==='openai'?{id:'batch_split'+calls.length}:provider==='anthropic'?{id:'msgbatch_split'+calls.length}:{name:'batches/split'+calls.length});
async function rowsOf(provider,call){if(provider==='openai')return (await call.options.body.get('file').text()).split('\n').map(s=>JSON.parse(s));const body=JSON.parse(await call.options.body.text());return provider==='anthropic'?body.requests:body.batch.input_config.requests.requests;}
(async()=>{
 // Grouping: whole items, in order, within bytes and requests; an item too large for any batch is named.
 assert.deepEqual(split.groupParts([40,40,40],[1,1,1],{bytes:100,requests:10},10,1),[{items:[0,2],requests:[0,2],bytes:92},{items:[2,3],requests:[2,3],bytes:51}]);
 assert.deepEqual(split.groupParts([1,1,1,1,1],[2,2,2,2,2],{bytes:1e6,requests:5},0,0).map(p=>p.items),[[0,2],[2,4],[4,5]]);
 assert.deepEqual(split.groupParts([10,10],[3,3],{bytes:1e6,requests:6},0,0).map(p=>p.requests),[[0,6]]);
 assert.deepEqual(split.groupParts([10,200,10],[1,1,1],{bytes:100,requests:10},0,0),{tooLarge:1});
 assert.deepEqual(split.groupParts([10],[11],{bytes:1e6,requests:10},0,0),{tooLarge:0});
 console.log('PASS: batches hold whole items in order, within bytes and requests');

 // The state of a run sent as several batches, and what a reload does with batches not yet sent.
 const base={runId:'lab_x',provider:'openai',model:'m',prompt:'p',effort:'medium',docIds:['a','b','c','d'],createdAt:'2026-11-16T10:00:00Z',state:'submitting'};
 let job=split.withParts(base,[{items:[0,2],requests:[0,2],state:'waiting'},{items:[2,4],requests:[2,4],state:'waiting'}]);
 assert.equal(job.state,'submitting');
 job=split.withPart(split.withPart(job,0,{id:'batch_1',state:'processing',completed:1,total:2}),1,{id:'batch_2',state:'ready',completed:2,total:2});
 assert.equal(job.state,'ready','a batch that has ended can be collected while another still runs');assert.equal(split.withPart(job,1,{state:'processing'}).state,'processing');assert.equal(job.completed,3);assert.equal(job.total,4);
 assert.equal(split.withPart(job,0,{state:'collected'}).state,'ready');
 assert(split.partsDone(split.withPart(split.withPart(job,0,{state:'collected'}),1,{state:'unsent'})));
 const reloaded=split.restoredParts(split.withParts(base,[{items:[0,2],requests:[0,2],id:'batch_1',state:'processing'},{items:[2,3],requests:[2,3],state:'submitting'},{items:[3,4],requests:[3,4],state:'waiting'}]));
 assert.deepEqual(reloaded.job.parts.map(p=>p.state),['processing','unknown','unsent']);assert.deepEqual([...reloaded.release],['d']);assert.equal(reloaded.job.state,'unknown');
 assert.equal(split.restoredParts(split.withParts(base,[{items:[0,4],requests:[0,4],state:'waiting'}])).job,null);
 assert.equal(split.restoredParts({...base,id:'batch_1'}).job.state,'unknown');assert.equal(split.restoredParts({...base,id:'batch_1'}).release.size,0);
 console.log('PASS: the run’s state follows its batches; after a reload a batch under way needs checking and those not sent are released');

 // Sending: each batch recorded before and after; a refused batch stops the rest; an unconfirmed one needs checking.
 const saved=[];let job2=split.withParts(base,[{items:[0,2],requests:[0,2],state:'waiting'},{items:[2,3],requests:[2,3],state:'waiting'},{items:[3,4],requests:[3,4],state:'waiting'}]);
 let out=await split.sendParts(job2,async k=>'batch_'+k,async j=>{saved.push(j.parts.map(p=>p.state).join());});
 assert.deepEqual(out.job.parts.map(p=>p.id),['batch_0','batch_1','batch_2']);assert.equal(out.stopped,undefined);assert.equal(saved.length,6);assert.equal(saved[0],'submitting,waiting,waiting');assert.equal(saved[1],'processing,waiting,waiting');
 assert.match(split.sentNotice(out.job,undefined,'texts'),/^Submitted as 3 batches in one run\./);
 out=await split.sendParts(job2,async k=>{if(k===1)throw Object.assign(new Error('The model is not available for batches. No batch was submitted.'),{uncertain:false});return 'batch_'+k;},async()=>{});
 assert.deepEqual(out.job.parts.map(p=>p.state),['processing','unsent','unsent']);assert.equal(out.stopped.at,1);
 assert.equal(split.sentNotice(out.job,out.stopped,'texts'),'Batch 2 of 3 was not submitted: The model is not available for batches. Batch 1 was submitted and continues in this run. The 2 texts of the batches not sent are back in the queue; send them once the submitted batches are collected.');
 assert.deepEqual([...split.textsIn(out.job,['unsent'])],['c','d']);
 out=await split.sendParts(job2,async k=>{if(k===2)throw new Error('Submission was not confirmed.');return 'batch_'+k;},async()=>{});
 assert.deepEqual(out.job.parts.map(p=>p.state),['processing','processing','unknown']);assert.equal(out.job.state,'unknown');
 assert.match(split.sentNotice(out.job,out.stopped,'subjects'),/^Submission of batch 3 of 3 was not confirmed\. Do not submit again yet\..* Batches 1 and 2 were submitted and continue in this run\.$/);
 let saves=0;out=await split.sendParts(job2,async k=>'batch_'+k,async()=>{if(++saves===4)throw new Error('quota');});
 assert.deepEqual(out.job.parts.map(p=>p.state),['processing','processing','unsent']);assert.equal(out.stopped.at,2);
 console.log('PASS: batches go up one by one, each recorded; the first one not sent stops the rest');

 // Notices after checking and collecting.
 const three=split.withParts(base,[{items:[0,2],requests:[0,2],id:'b1',state:'collected'},{items:[2,3],requests:[2,3],id:'b2',state:'processing'},{items:[3,4],requests:[3,4],id:'b3',state:'ready'}]);
 assert.equal(split.partsNotice(three,'collect',1,'','texts'),'Results of 1 batch collected. 1 of the 3 batches is still processing. You can close this page once the workspace is saved. Collect results to take in the batches that have ended.');
 assert.equal(split.partsNotice(split.withPart(split.withPart(three,1,{state:'collected'}),2,{state:'collected'}),'collect',2,'','texts'),'Batch results collected from all 3 batches of this run. Any failed texts are marked for review; completed results are kept.');
 assert.equal(split.partsNotice(split.withPart(three,1,{state:'ready'}),'check',0,'','texts'),'The batches still to collect have ended. Collect results to see their annotations and any errors.');
 assert.match(split.splitQuestion({parts:[{},{},{}],bytes:430e6,requests:9000,bySize:true},'openai'),/^This run is about 430 MB of requests, more than OpenAI accepts in one batch \(200 MB, of which the Lab uses at most 95%\), so it will be sent as 3 batches in the same run/);
 assert.match(split.splitQuestion({parts:[{},{}],bytes:20e6,requests:10200,bySize:false},'anthropic'),/^This run is 10,200 requests, more than the Lab sends in one batch \(10,000\), so it will be sent as 2 batches/);
 console.log('PASS: the question before sending and the notices name the batches');

 // The route: prepare groups the run, send puts up one batch at a time, never twice.
 const subjects=Array.from({length:10500},(_,i)=>[{heading:'Title',value:'Work '+i}]);
 calls=[];mock=providerOk('openai');
 let res=await post(runForm('openai','prepare',{subjects}),'?split=1');assert.equal(res.status,200,await res.clone().text());
 let plan=await res.json();assert.equal(calls.length,0,'preparing sends nothing');
 assert.deepEqual(plan.parts.map(p=>[p.items,p.requests]),[[[0,10000],[0,10000]],[[10000,10500],[10000,10500]]]);assert.equal(plan.requests,10500);assert.equal(plan.bySize,false);
 res=await post(sendForm('openai',1));assert.equal(res.status,200);const second=(await res.json()).id;
 let rows=await rowsOf('openai',calls[0]);assert.equal(rows.length,500);assert.equal(rows[0].custom_id,'lab_split_10000');assert.equal(rows.at(-1).custom_id,'lab_split_10499');
 assert.deepEqual(JSON.parse(calls[1].options.body).metadata,{lab_run_id:'lab_split',lab_batch:'2 of 2'});assert(second.startsWith('batch_'));
 calls=[];res=await post(sendForm('openai',1));assert.equal(res.status,409);assert.equal(calls.length,0,'a batch is never sent twice');assert.equal((await res.json()).uncertain,false);
 res=await post(sendForm('openai',0));assert.equal(res.status,200);rows=await rowsOf('openai',calls[0]);assert.equal(rows.length,10000);assert.equal(rows[0].custom_id,'lab_split_0');assert.equal(rows.at(-1).custom_id,'lab_split_9999');
 calls=[];res=await post(sendForm('openai',0));assert.equal(res.status,409);assert.equal(calls.length,0);
 console.log('PASS: 10,500 subjects prepared as 2 OpenAI batches of 10,000 and 500 requests, each sent once with its run and batch named');

 // Copies of an item stay in the same batch; one run sent as a single batch is named as before.
 calls=[];res=await post(runForm('openai','prepare',{subjects:subjects.slice(0,3334),copies:Array(3334).fill(3)}),'?split=1');plan=await res.json();
 assert.deepEqual(plan.parts.map(p=>p.requests),[[0,9999],[9999,10002]]);assert.deepEqual(plan.parts.map(p=>p.items),[[0,3333],[3333,3334]]);
 res=await post(runForm('openai','prepare',{subjects:subjects.slice(0,5)}),'?split=1');plan=await res.json();assert.equal(plan.parts.length,1);
 res=await post(sendForm('openai',0));assert.equal(res.status,200);assert.deepEqual(JSON.parse(calls.at(-1).options.body).metadata,{lab_run_id:'lab_split'});
 console.log('PASS: all annotations of an item go in the same batch; a run of one batch is sent as before');

 // By size: Gemini's inline batches hold 18 MB, so 30 MB of texts go as two batches, each named.
 const article='A long article. '.repeat(6250);
 const files=Array.from({length:300},(_,i)=>new File([article+i],i+'.txt'));
 calls=[];mock=providerOk('gemini');res=await post(runForm('gemini','prepare',{files}),'?split=1');assert.equal(res.status,200,await res.clone().text());plan=await res.json();
 assert.equal(plan.parts.length,2);assert.equal(plan.bySize,true);assert(plan.parts.every(p=>p.bytes<=limits.MAX_GEMINI_PREPARED_BYTES));assert.equal(plan.parts[0].items[1],plan.parts[1].items[0]);
 for(const k of [0,1]){calls=[];res=await post(sendForm('gemini',k));assert.equal(res.status,200);const body=JSON.parse(await calls[0].options.body.text());assert.equal(body.batch.display_name,`Text Annotation Lab lab_split (batch ${k+1} of 2)`);assert(calls[0].options.body.size<=limits.MAX_GEMINI_PREPARED_BYTES);assert.equal(body.batch.input_config.requests.requests[0].metadata.key,'lab_split_'+plan.parts[k].requests[0]);}
 assert.match(split.splitQuestion(plan,'gemini'),/more than Gemini accepts in one batch \(20 MB, of which the Lab uses at most 18 MB\)/);
 console.log('PASS: 30 MB of texts prepared as two Gemini batches within 18 MB each');

 // A text too large for any batch with its annotations is refused before anything is sent; so is a discarded run.
 calls=[];res=await post(runForm('gemini','prepare',{files:[new File(['x'.repeat(1900000)],'big.txt')],copies:[10]}),'?split=1');assert.equal(res.status,413);assert.match((await res.json()).error,/^Text 1 of this run is larger, with its annotations, than one Gemini batch can hold/);assert.equal(calls.length,0);
 res=await post(runForm('anthropic','prepare',{subjects:subjects.slice(0,4)}),'?split=1');assert.equal(res.status,200);
 const discard=new FormData();discard.set('provider','anthropic');discard.set('action','discard');assert.equal((await post(discard)).status,200);
 calls=[];res=await post(sendForm('anthropic',0));assert.equal(res.status,409);assert.equal(calls.length,0);
 console.log('PASS: an item too large for one batch, and a discarded run, send nothing');

 // Student mode keeps its limits: the plain submit still refuses more than 10,000 items, and prepare needs no split flag to
 // keep the 54 MB upload limit.
 calls=[];mock=providerOk('openai');res=await post(runForm('openai','submit',{subjects:subjects.slice(0,10001)}));assert.equal(res.status,400);assert.equal(calls.length,0);
 res=await post(runForm('openai','prepare',{subjects:subjects.slice(0,10001)}),'?split=1');assert.equal(res.status,200);
 assert.equal(limits.SPLIT_LIMITS.openai.bytes,190e6);assert.equal(limits.SPLIT_LIMITS.anthropic.bytes,243.2e6);
 console.log('PASS: the standard Lab keeps one batch of up to 10,000 items');
})().catch(error=>{console.error(error);process.exit(1);});
