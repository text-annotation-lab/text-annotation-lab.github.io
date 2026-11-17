const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
let calls=[];
function transpile(file,imports,scope={}){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('exports','require',...Object.keys(scope),code)(exports,imports,...Object.values(scope));return exports;}
function load(file){return transpile(file,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id),{fetch:async(url,options)=>{calls.push({url,options});const result=JSON.stringify({score:'INSUFFICIENT_KNOWLEDGE',explanation:'Unfamiliar subject.'});return Response.json(url.includes('anthropic')?{stop_reason:'end_turn',content:[{type:'text',text:result}]}:url.includes('googleapis')?{candidates:[{finishReason:'STOP',content:{parts:[{text:result}]}}]}:{status:'completed',output:[{content:[{type:'output_text',text:result}]}]});}});}
const knowledge=load('lib/model-knowledge.ts');
function harness(initial,fetcher=async()=>Response.json({score:'INSUFFICIENT_KNOWLEDGE',explanation:'Unknown subject.'}),save=async()=>{}){
 const slots=[],effects=[],writes=[],requests=[],busyChanges=[];let cursor=0,pending=[],dirty=true,tree;
 const react={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useMemo(fn,deps){const i=cursor++,slot=slots[i];if(slot&&slot.deps.length===deps.length&&slot.deps.every((d,j)=>Object.is(d,deps[j])))return slot.value;const value=fn();slots[i]={value,deps};return value;},useEffect(fn,deps){const i=cursor++,previous=effects[i];if(!previous||deps.some((value,j)=>!Object.is(value,previous.deps[j])))pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
 const jsx=(type,props)=>({type,props});
 const Model=transpile('components/model-knowledge.tsx',id=>id==='react'?react:id==='@/lib/reply-text'?load('lib/reply-text.ts'):id==='@/lib/own-prices'?{useOwnPrices:()=>({}),ownPrice:()=>undefined}:id==='react/jsx-runtime'?{jsx,jsxs:jsx}:id==='@/components/named-answer-detail'?transpile('components/named-answer-detail.tsx',id=>id==='@/lib/reply-text'?load('lib/reply-text.ts'):id==='@/lib/answer-validation'?load('lib/answer-validation.ts'):id==='@/lib/answer-fields'?load('lib/answer-fields.ts'):require(id)):id==='@/lib/answer-validation'?load('lib/answer-validation.ts'):id==='@/lib/answer-fields'?load('lib/answer-fields.ts'):id==='@/lib/identifier'?load('lib/identifier.ts'):id==='@/lib/annotation-queue'?load('lib/annotation-queue.ts'):id==='@/lib/workflow-safety'?load('lib/workflow-safety.ts'):id==='@/lib/annotation-feedback'?load('lib/annotation-feedback.ts'):id==='@/lib/studies'?load('lib/studies.ts'):id==='@/lib/batch-limits'?load('lib/batch-limits.ts'):id==='@/lib/model-knowledge'?knowledge:id==='@/lib/providers'?load('lib/providers.ts'):id==='@/lib/workspace-storage'?{createWorkspaceStorage:key=>{assert.equal(key,'study:working-copy-v2:knowledge');return {restore:async()=>initial,save:async value=>{writes.push(value);await save(value);}};}}:id.startsWith('@/lib/research/')||id==='@/lib/request-settings'||id==='@/lib/request-frame'||id==='@/lib/prompt-inserts'||id==='@/lib/version'?load(id.slice(2)+'.ts'):new Proxy({},{get:(_,key)=>String(key)}),{fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options);},document:{getElementById:()=>null},requestAnimationFrame:()=>0,cancelAnimationFrame(){},window:{addEventListener(){},removeEventListener(){}},confirm:()=>true}).ModelKnowledge;
 const props={studyId:'working-copy-v2',provider:'openai',model:'gpt-6-luna',effort:'medium',apiKey:'sk-test',parentLocked:false,renderSetup:options=>jsx('setup',{...options,children:options.extraSetup}),onBusyChange:value=>busyChanges.push(value)};
 async function flush(){for(let i=0;i<8;i++){if(dirty){cursor=0;dirty=false;tree=Model(props);const queue=pending;pending=[];queue.forEach(fn=>fn());}await new Promise(resolve=>setImmediate(resolve));}}
 function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
 function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
 function find(predicate){const node=nodes(tree).find(predicate);assert(node,'Missing control');return node;}
 const button=label=>find(node=>['Button','button'].includes(node.type)&&text(node).trim().startsWith(label));
 return {flush,find,button,text,writes,requests,busyChanges,props,latest:()=>writes.at(-1)||initial};
}
(async()=>{
 const errorUI=harness({prompt:'P',items:[{id:'err',name:'Failed subject',fields:[{heading:'Subject',value:'Failed subject'}],status:'error',error:'Temporary rate limit'}]});await errorUI.flush();errorUI.button('Failed subject').props.onClick();await errorUI.flush();assert.equal(errorUI.text(errorUI.find(n=>n.props?.id==='knowledge-detail')).split('Temporary rate limit').length-1,1);
 const fieldUI=harness({answerFields:['Tone','Complexity'],items:[{id:'queued',name:'New subject',fields:[{heading:'Subject',value:'New'}],status:'pending'},{id:'partial',name:'Partial subject',fields:[{heading:'Subject',value:'Partial'}],status:'done',answerFields:['Tone','Complexity'],answers:{f0:'NEUTRAL',f1:'INSUFFICIENT_KNOWLEDGE'},score:''}]});await fieldUI.flush();
 assert(fieldUI.find(n=>n.type==='TableHead'&&fieldUI.text(n)==='Tone'));assert(fieldUI.find(n=>n.type==='TableHead'&&fieldUI.text(n)==='Complexity'));assert.throws(()=>fieldUI.find(n=>n.type==='TableHead'&&fieldUI.text(n)==='Score / category'));assert.equal(fieldUI.text(fieldUI.find(n=>n.props?.className==='status uncertain')),'Partly assessed');assert.match(fieldUI.text(fieldUI.find(n=>n.props?.className==='progressline')),/1 insufficient knowledge/);
 const duplicateUI=harness();await duplicateUI.flush();assert.throws(()=>duplicateUI.button('Queue failed items for retry'));duplicateUI.find(n=>n.props?.id==='knowledge-input').props.onChange({target:{value:'Book\nBook\nOther'}});await duplicateUI.flush();assert.equal(duplicateUI.button('Add 3 items').props.disabled,true);duplicateUI.button('Exclude duplicate subjects').props.onClick();await duplicateUI.flush();assert.equal(duplicateUI.latest().items.length,2);
 duplicateUI.find(n=>n.props?.id==='knowledge-input').props.onChange({target:{value:'Book\nBook'}});await duplicateUI.flush();duplicateUI.button('Keep all subjects').props.onClick();await duplicateUI.flush();assert.equal(duplicateUI.latest().items.length,4);assert.equal(new Set(duplicateUI.latest().items.map(i=>i.id)).size,4);assert.equal(duplicateUI.requests.length,0);assert.match(duplicateUI.text(duplicateUI.find(n=>n.props?.className==='progressline')),/4 subjects ready/);
 const mismatch=harness({prompt:'P',items:[{id:'mismatch',name:'Book',fields:[{heading:'Subject',value:'Book'}],status:'pending'}]});mismatch.props.apiKey='AIza-wrong-provider';await mismatch.flush();await mismatch.button('Run all').props.onClick();await mismatch.flush();assert.equal(mismatch.requests.length,0);assert.equal(mismatch.latest().items[0].status,'pending');
 const retryUI=harness({prompt:'New prompt',items:[{id:'ok',name:'Good',fields:[{heading:'Subject',value:'Good'}],status:'done',score:'YES',prompt:'Good old prompt',model:'gpt-6-luna'},{id:'bad',name:'Bad',fields:[{heading:'Subject',value:'Bad'}],status:'error',error:'Interrupted',prompt:'Old prompt',model:'gpt-5.6-luna'}]});await retryUI.flush();retryUI.button('Queue failed items for retry').props.onClick();await retryUI.flush();assert.equal(retryUI.requests.length,0);assert.equal(retryUI.latest().items[0].score,'YES');assert.equal(retryUI.latest().items[1].history[0].prompt,'Old prompt');await retryUI.button('Run all').props.onClick();await retryUI.flush();assert.equal(retryUI.requests.length,1);assert.equal(retryUI.latest().items[1].prompt,'New prompt');assert.equal(retryUI.latest().items[0].prompt,'Good old prompt');assert.throws(()=>retryUI.button('Queue failed items for retry'));assert.match(retryUI.text(retryUI.find(n=>n.props?.className==='progressline')),/2 of 2 complete · 1 insufficient knowledge/);
 const saveStates=[];let completeSave;
 const saving=harness(undefined,undefined,()=>new Promise(resolve=>completeSave=resolve));
 saving.props.onSaveStateChange=value=>saveStates.push(value);await saving.flush();
 assert.equal(saveStates.at(-1),'saved');
 saving.find(node=>node.props?.id==='knowledge-input').props.onChange({target:{value:'Pending subject'}});await saving.flush();
 assert.equal(saveStates.at(-1),'saving');completeSave();await saving.flush();assert.equal(saveStates.at(-1),'saved');
 const failedStates=[],failing=harness(undefined,undefined,async()=>{throw Error('Storage unavailable');});
 failing.props.onSaveStateChange=value=>failedStates.push(value);await failing.flush();
 failing.find(node=>node.props?.id==='knowledge-input').props.onChange({target:{value:'Unsaved subject'}});await failing.flush();
 assert.equal(failedStates.at(-1),'error');
 const parse=knowledge.parseKnowledgeItems;
 assert.deepEqual(parse('list','','Pride and Prejudice\r\n\r\nFrankenstein\n').items.map(row=>row[0].value),['Pride and Prejudice','Frankenstein']);
 assert.equal(parse('list','','A title, with commas').items.length,1);
 const csv=parse('structured','Title,Author,Year','"Title, subtitle",Austen,1813\n"A ""quoted"" title",Shelley,');
 assert.equal(csv.items[0][0].value,'Title, subtitle');assert.equal(csv.items[1][0].value,'A "quoted" title');assert.equal(csv.items[1][2].value,'');
 assert.equal(parse('structured','Title,Author','Book\tWriter').items[0][1].value,'Writer');
 assert.equal(parse('structured','Title\tNote','Book\t"First\nSecond"').items[0][1].value,'First\nSecond');
 for(const [headings,data] of [['Title,Title','A,B'],['Title,','A,B'],['Title,Author','Only one'],['Title,Author','"unfinished,A'],['Title,Author','"closed"oops,A']])assert(parse('structured',headings,data).error);
 assert(!knowledge.validKnowledgeFields([{heading:'Subject',value:''}]));assert(!knowledge.validKnowledgeFields([{heading:'A',value:'x'},{heading:'a',value:'y'}]));
 const fields=[{heading:'Title',value:'Unknown work'},{heading:'Author',value:'Unknown author'},{heading:'Year',value:''}];
 const route=load('app/api/annotate/route.ts');
 function request(provider,changes={}){const form=new FormData();for(const [key,value] of Object.entries({mode:'model-knowledge',provider,model:provider==='anthropic'?'claude-sonnet-5-5':'gpt-6-luna',effort:provider==='anthropic'?'high':'medium',prompt:'Classify the subject.',fields:JSON.stringify(fields),...changes}))form.set(key,value);return new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:provider==='anthropic'?'Bearer sk-ant-test':'Bearer sk-test'},body:form});}
 for(const provider of ['openai','anthropic']){const response=await route.POST(request(provider));assert.equal(response.status,200);assert.equal((await response.json()).score,'INSUFFICIENT_KNOWLEDGE');const payload=JSON.parse(calls.at(-1).options.body),system=(payload.input||payload.messages)[0].content.map(part=>part.text).join('');assert(!payload.instructions&&!payload.system,'No system prompt: the prompt goes with the subject');assert(/^Classify the subject\.[^]*\n\n<entry>\nTitle: Unknown work\nAuthor: Unknown author\n<\/entry>$/.test(system),'The subject follows the prompt between <entry> tags, one “heading: value” line for each field with a value');assert.match(system,/not primary source material/);assert.match(system,/INSUFFICIENT_KNOWLEDGE/);assert.match(system,/Do not invent quotations/);const content=JSON.stringify(payload.input||payload.messages);assert(content.includes('Unknown author'));assert(content.includes('Title'));assert(!content.includes('Document filename'));assert(!system.includes('grounded in the document'));}
 const before=calls.length;for(const changes of [{fields:'invalid'},{fields:'[]'},{fields:JSON.stringify([{heading:'Subject',value:''}])},{mode:'bad'}])assert.equal((await route.POST(request('openai',changes))).status,400);assert.equal(calls.length,before);
 const h=harness();await h.flush();h.find(node=>node.type==='setup').props.setPrompt('Classify');h.find(node=>node.props?.id==='knowledge-input').props.onChange({target:{value:'First subject\nSecond subject'}});await h.flush();await h.button('Add 2 items').props.onClick();await h.flush();assert.equal(h.latest().items.length,2);await h.button('Run all').props.onClick();await h.flush();assert.equal(h.requests.length,2);assert.equal(JSON.parse(h.requests[0].options.body.get('fields'))[0].value,'First subject');assert.equal(JSON.parse(h.requests[1].options.body.get('fields'))[0].value,'Second subject');assert(!h.requests[0].options.body.has('file'));assert(h.latest().items.every(item=>item.status==='done'));assert(!JSON.stringify(h.latest()).includes('sk-test'));assert.deepEqual(h.busyChanges,[true,false]);
 const resumed=harness({...h.latest(),items:[{...h.latest().items[0],status:'running'}]});await resumed.flush();assert.equal(resumed.latest().items[0].status,'error');assert.equal(resumed.requests.length,0);
 // Repeats preserve old answers, repeat each subject once, and send only fields.
 const originalResults=JSON.stringify(h.latest().items);await h.button('Repeat study').props.onClick();await h.flush();assert.equal(h.latest().items.length,4);assert.equal(JSON.stringify(h.latest().items.slice(0,2)),originalResults);assert(h.latest().items.slice(2).every(item=>item.runNumber===2&&item.score===undefined&&item.prompt===undefined&&item.research===undefined));assert.equal(h.latest().items[2].subjectId,h.latest().items[0].id);await h.button('Run all').props.onClick();await h.flush();assert.equal(h.requests.length,4);assert(!h.requests[2].options.body.get('fields').includes('Unknown subject'));assert(h.latest().items.every(item=>item.time&&item.instructions));assert(h.latest().items.every(item=>item.webSearch===false));
 await h.find(node=>node.type==='TableRow'&&node.props?.['aria-label']?.includes('First subject, run 1')).props.onClick();await h.flush();await h.button('Annotate subject again').props.onClick();await h.flush();assert.equal(h.latest().items.length,5);assert.equal(h.latest().items.at(-1).runNumber,3);assert.equal(h.latest().items.at(-1).subjectId,h.latest().items[0].id);assert.equal(knowledge.repeatKnowledgeItems(h.latest().items).length,2);assert(knowledge.isInsufficient(' insufficient_knowledge '));assert(!knowledge.isInsufficient('MIXED'));
 let count=0;const errors=harness({...h.latest(),items:h.latest().items.map(item=>({...item,status:'pending'}))},async()=>++count===1?Response.json({score:'X',explanation:'Kept'}):Response.json({error:'Quota'},{status:429}));await errors.flush();await errors.button('Run all').props.onClick();await errors.flush();assert.equal(errors.latest().items[0].score,'X');assert.equal(errors.latest().items[1].status,'error');
 // Parallel runs preserve subject matching, drain on pause, and keep Annotate next single.
 const subjects=Array.from({length:7},(_,i)=>({id:`parallel-${i}`,name:`Subject ${i}`,fields:[{heading:'Subject',value:`Subject ${i}`}],status:'pending'}));
 const releases=[];const parallel=harness({prompt:'Classify',concurrency:4,items:subjects},()=>new Promise(resolve=>releases.push(resolve)));await parallel.flush();
 assert.equal(parallel.button('Processing options').props['aria-expanded'],false);
 parallel.button('Processing options').props.onClick();await parallel.flush();
 assert.equal(parallel.find(n=>n.props?.id==='knowledge-concurrency').props.value,4);
 const running=parallel.button('Run all').props.onClick();await parallel.flush();assert.equal(parallel.requests.length,4);
 assert.equal(parallel.find(n=>n.props?.id==='knowledge-concurrency').props.disabled,true);
 releases[2](Response.json({score:'THIRD',explanation:'Subject 2'}));await parallel.flush();assert.equal(parallel.requests.length,5);assert.equal(parallel.latest().items[2].score,'THIRD');
 parallel.button('Pause').props.onClick();for(const i of [0,1,3,4])releases[i](Response.json({score:String(i),explanation:'Preserved'}));await running;await parallel.flush();
 assert.equal(parallel.requests.length,5);assert.deepEqual(parallel.latest().items.map(i=>i.status),['done','done','done','done','done','pending','pending']);assert(parallel.latest().items.slice(0,5).every(i=>i.concurrency===4));
 const single=parallel.button('Annotate next').props.onClick();await parallel.flush();assert.equal(parallel.requests.length,6);releases[5](Response.json({score:'ONE',explanation:'Single'}));await single;await parallel.flush();assert.equal(parallel.latest().items[5].concurrency,1);assert.equal(parallel.requests.length,6);
 parallel.find(n=>n.props?.id==='knowledge-concurrency').props.onChange({target:{value:'2'}});await parallel.flush();assert.equal(parallel.latest().concurrency,2);
 const restoredParallel=harness(parallel.latest());await restoredParallel.flush();restoredParallel.button('Processing options').props.onClick();await restoredParallel.flush();assert.equal(restoredParallel.find(n=>n.props?.id==='knowledge-concurrency').props.value,2);
 // Research mode: up to 128 at once, and a subject refused for a rate limit is sent again after the wait (real time here).
 {
  const until=async(h,ready)=>{for(let n=0;n<200&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const limited=extra=>Response.json({error:'Rate limit.',retryAfterMs:1,...extra},{status:429}),three=()=>({prompt:'Classify',concurrency:128,items:subjects.slice(0,3)});
  const select=h=>h.find(n=>n.props?.id==='knowledge-concurrency').props,help=h=>h.text(h.find(n=>n.props?.id==='knowledge-parallel-help'));
  let sends=0;const paced=harness(three(),async()=>++sends===1?limited():Response.json({score:'ONE',explanation:'Fine',modelReported:'gpt-6-luna-2026-10-01',stopReason:'completed',output:'{"score":"ONE"}'}));paced.props.research=true;await paced.flush();
  paced.button('Processing options').props.onClick();await paced.flush();
  assert.equal(select(paced).value,128);assert.deepEqual(select(paced).children.map(option=>option.props.value),[1,2,4,8,16,32,64,128]);assert(paced.text(paced.button('Processing options')).includes('Instant · 128 at a time'));
  assert.equal(help(paced),'Run all can annotate up to 128 subjects at once. Each subject gets a separate request; token prices are unchanged. When the provider reports a rate limit, the run waits and goes on with fewer at a time. Annotate next always runs one subject.');
  paced.button('Run all').props.onClick();await paced.flush();assert.deepEqual(paced.latest().items.map(item=>item.status),['running','done','done']);
  await until(paced,()=>paced.latest().items.every(item=>item.status==='done'));
  assert.equal(paced.requests.length,4);assert(paced.latest().items.every(item=>item.concurrency===128&&item.error===undefined));
  // Research mode records the request (once, with marks where the subject goes), the build of the Lab, and what the provider notes.
  assert(paced.requests.every(request=>request.options.body.get('record')==='true'));
  assert.deepEqual(paced.latest().requests.map(request=>[request.id,request.url]),[['q1','https://api.openai.com/v1/responses']]);assert(paced.latest().requests[0].body.includes('<<DOCUMENT_TEXT>>')&&paced.latest().requests[0].body.includes('\\n\\n<entry>\\n<<DOCUMENT_TEXT>>\\n</entry>')&&!paced.latest().requests[0].body.includes('Subject identifiers for one latent-knowledge annotation.'));
  assert(paced.latest().items.every(item=>item.requestId==='q1'&&item.lab==='development'&&item.modelReported==='gpt-6-luna-2026-10-01'&&item.stopReason==='completed'&&item.output==='{"score":"ONE"}'));
  assert(paced.latest().items.every(item=>item.layout==='message'),'Each subject records the layout it was sent in');
  assert.match(paced.text(paced.find(n=>n.props?.role==='status'&&n.props.className==='message info')),/the provider reported a rate limit: a pause of about 1 second, then up to one subject at a time/);
  // A web search already made is not made, and charged, again.
  const searched=harness({...three(),webSearch:true,items:subjects.slice(0,1)},async()=>limited({research:{text:'Notes',sources:[],queries:[],searchedAt:'2026-11-16'},webUsed:true}));searched.props.research=true;await searched.flush();
  await searched.button('Run all').props.onClick();await searched.flush();assert.equal(searched.requests.length,1);assert.equal(searched.latest().items[0].status,'error');
  // The standard Lab: 1, 2, and 4; the study's higher number runs one at a time, and nothing is sent again.
  const standard=harness(three(),async()=>limited());await standard.flush();standard.button('Processing options').props.onClick();await standard.flush();
  assert.equal(select(standard).value,1);assert.deepEqual(select(standard).children.map(option=>option.props.value),[1,2,4]);assert(help(standard).startsWith('Run all can annotate several subjects at once.'));
  await standard.button('Run all').props.onClick();await standard.flush();assert.equal(standard.requests.length,1);assert.deepEqual(standard.latest().items.map(item=>item.status),['error','pending','pending']);assert.equal(standard.latest().concurrency,128);
  // The standard Lab keeps no record of a request.
  assert.equal(standard.requests[0].options.body.get('record'),null);assert.equal(standard.latest().requests,undefined);assert(standard.latest().items.every(item=>['requestId','modelReported','stopReason','output','lab'].every(key=>!(key in item))));
  // When a subject fails, research mode marks it and carries on. A failure every request would meet (the reply
  // marks it `shared`) stops the run once the first three requests, for at least two subjects, all failed that way.
  const five=()=>({prompt:'Classify',concurrency:1,items:subjects.slice(0,5)}),said=(h,text)=>h.find(n=>(n.props?.role==='status'||n.props?.role==='alert')&&h.text(n)===text);
  const fine=()=>Response.json({score:'ONE',explanation:'Fine'}),refusal=()=>Response.json({error:'OpenAI rejected the API key.',shared:'account'},{status:401});
  let nth=0;const carried=harness(five(),async()=>++nth===2?Response.json({error:'The reply was cut off.'},{status:422}):fine());carried.props.research=true;await carried.flush();
  await carried.button('Run all').props.onClick();await carried.flush();
  assert.equal(carried.requests.length,5);assert.deepEqual(carried.latest().items.map(item=>item.status),['done','error','done','done','done']);assert.equal(carried.latest().items[1].error,'The reply was cut off.');
  said(carried,'1 of 5 requests failed, and the run carried on. “Queue failed items for retry” makes it ready to run again.');
  // The details of a subject: Previous and Next with its place among the subjects, and what the technical details need of the study.
  {const steps=()=>carried.find(n=>n.type==='DetailSteps').props,detail=()=>carried.find(n=>n.type==='ResearchDetail').props;
   carried.button('Subject 1').props.onClick();await carried.flush();
   assert.deepEqual([steps().index,steps().total],[1,5]);assert.equal(detail().row.id,'parallel-1');assert.equal(detail().study.kind,'knowledge');assert.deepEqual([...detail().study.versions],[[1,1]]);assert.equal(typeof carried.find(n=>n.props?.id==='knowledge-detail').props.onKeyDown,'function');
   steps().onStep(2);await carried.flush();assert.equal(steps().index,2);assert.equal(detail().row.id,'parallel-2');
   steps().onStep(5);await carried.flush();assert.equal(steps().index,2,'There is no subject after the last');}
  const refused=harness(five(),async()=>refusal());refused.props.research=true;await refused.flush();
  await refused.button('Run all').props.onClick();await refused.flush();
  assert.equal(refused.requests.length,3);assert.deepEqual(refused.latest().items.map(item=>item.status),['error','error','error','pending','pending']);
  said(refused,'Stopped: the first 3 requests all failed the same way, which points to the settings or the account rather than the subjects. Requests under way will finish, and completed results are kept. See the error of a failed subject before running again.');
  assert(refused.latest().items.every(item=>!('shared' in item)&&!JSON.stringify(item).includes('"shared"')),'The mark is never kept with a result');
  // One result among the first requests: the failures are not about every request, and the run goes through.
  nth=0;const mixed=harness(five(),async()=>++nth===1?fine():refusal());mixed.props.research=true;await mixed.flush();
  await mixed.button('Run all').props.onClick();await mixed.flush();
  assert.equal(mixed.requests.length,5);assert.deepEqual(mixed.latest().items.map(item=>item.status),['done','error','error','error','error']);
  said(mixed,'4 of 5 requests failed, and the run carried on. “Queue failed items for retry” makes them ready to run again.');
  // "Annotate next" sends one request and says that it failed.
  const next=harness(five(),async()=>refusal());next.props.research=true;await next.flush();
  await next.button('Annotate next').props.onClick();await next.flush();assert.equal(next.requests.length,1);said(next,'The request failed. “Queue failed items for retry” makes it ready to run again.');
  // The standard Lab stops at the first failure, whatever the reply carries.
  const first=harness(five(),async()=>refusal());await first.flush();
  await first.button('Run all').props.onClick();await first.flush();
  assert.equal(first.requests.length,1);assert.deepEqual(first.latest().items.map(item=>item.status),['error','pending','pending','pending','pending']);assert(!('shared' in first.latest().items[0]));
  first.button('Subject 0').props.onClick();await first.flush();assert.throws(()=>first.find(n=>n.type==='DetailSteps'));assert.throws(()=>first.find(n=>n.type==='ResearchDetail'));assert.equal(first.find(n=>n.props?.id==='knowledge-detail').props.onKeyDown,undefined);
  said(first,'Stopped starting new annotations after an error. Active requests will finish, and completed results are kept. Review the error before retrying.');
 }
 // Research mode, annotations per subject: each subject is sent several times and its answers are combined;
 // Run all makes the missing ones. Web search makes one annotation per subject. The standard Lab makes one.
 {
  const until=async(h,ready)=>{for(let n=0;n<200&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const near=(a,b)=>Math.abs(a-b)<1e-9,said=(h,text)=>h.find(n=>(n.props?.role==='status'||n.props?.role==='alert')&&h.text(n)===text);
  const three=extra=>({prompt:'Classify',concurrency:1,repeats:3,items:subjects.slice(0,3),...extra});
  const repeatsSelect=h=>h.find(n=>n.props?.id==='knowledge-repeats').props,runAll=h=>h.text(h.button('Run all'));
  // The standard Lab: one annotation per subject, whatever the study has stored.
  const once=harness(three(),async()=>Response.json({score:'ONE',explanation:'Fine'}));await once.flush();
  once.button('Processing options').props.onClick();await once.flush();assert.throws(()=>once.find(n=>n.props?.id==='knowledge-repeats'),'The setting is research mode’s');
  await once.button('Run all').props.onClick();await once.flush();
  assert.equal(once.requests.length,3);assert(once.latest().items.every(item=>item.status==='done'&&!('annotations' in item)&&item.repeats===undefined));assert.equal(once.latest().repeats,3,'The stored number is kept for research mode');
  // Research mode, one request at a time: the second annotation of the second subject fails, and the run carries on.
  const plan={'Subject 0':['ONE','TWO','ONE'],'Subject 1':['ONE',null,'ONE','TWO'],'Subject 2':['TWO','TWO','TWO']},sent=new Map();
  const r=harness(three(),async(url,options)=>{
   const name=JSON.parse(options.body.get('fields'))[0].value,at=sent.get(name)||0,score=plan[name][at];sent.set(name,at+1);
   return score?Response.json({score,explanation:`${name} ${at+1}`,tokens:10,usage:{input_tokens:8,output_tokens:2},responseId:`r-${name}-${at+1}`}):Response.json({error:'The reply was cut off.'},{status:422});
  });r.props.research=true;await r.flush();
  r.button('Processing options').props.onClick();await r.flush();
  assert.equal(repeatsSelect(r).value,3);assert.deepEqual(repeatsSelect(r).children.map(option=>String(option.props.value)),['1','2','3','4','5','6','7','8','9','10']);assert(r.text(r.button('Processing options')).includes('3 annotations per subject'));
  assert.match(r.text(r.find(n=>n.props?.id==='knowledge-repeats-help')),/^Each subject is annotated 3 times, each time with a request of its own\./);
  assert.equal(r.find(n=>n.type==='input'&&n.props?.type==='checkbox').props.disabled,true,'Web search makes one annotation per subject');assert.match(r.text(r.find(n=>n.props?.id==='knowledge-search-help')),/^Web search makes one annotation per subject; set Annotations per subject to 1 to use it\./);
  r.button('Run all').props.onClick();await until(r,()=>r.latest()?.items.every(item=>item.status==='done'));
  let items=r.latest().items;
  assert.equal(r.requests.length,9);assert(r.requests.every(request=>request.options.body.get('record')==='true'));
  assert.deepEqual([items[0].score,items[0].explanation,items[0].tokens,items[0].repeats,items[0].runSize],['ONE','Subject 0 1',30,3,9]);assert(near(items[0].consistency.score,2/3));
  assert.deepEqual(items[0].annotations.map(a=>[a.n,a.status,a.score,a.responseId,a.requestId,a.runId===items[0].runId,a.processing]),[[1,'done','ONE','r-Subject 0-1','q1',true,'instant'],[2,'done','TWO','r-Subject 0-2','q1',true,'instant'],[3,'done','ONE','r-Subject 0-3','q1',true,'instant']]);
  for(const key of ['usage','responseId','rawResponse'])assert.equal(items[0][key],undefined,key+' belongs to each annotation');assert.deepEqual(items[0].annotations[0].usage,{input_tokens:8,output_tokens:2});
  assert.deepEqual(items[1].annotations.map(a=>[a.n,a.status,a.error]),[[1,'done',undefined],[2,'error','The reply was cut off.'],[3,'done',undefined]]);assert.deepEqual([items[1].score,items[1].consistency.score],['ONE',1]);
  assert.equal(r.text(r.find(n=>n.type==='span'&&String(n.props.className).includes('partial'))),'2 of 3 annotations');
  said(r,'1 of 9 requests failed, and the run carried on. “Run all” sends it again.');
  assert(runAll(r).includes('Run all (1)'),'The subject with a missing annotation waits');assert.equal(r.button('Repeat study').props.disabled,false);
  // Run all: the missing annotation only, in the same run.
  r.button('Run all').props.onClick();await until(r,()=>!r.latest().items.some(item=>item.status==='running')&&r.requests.length===10);await r.flush();
  items=r.latest().items;
  assert.equal(r.requests.length,10);assert.deepEqual(items[1].annotations.map(a=>[a.status,a.score]),[['done','ONE'],['done','TWO'],['done','ONE']]);assert.equal(items[1].score,'ONE');assert(near(items[1].consistency.score,2/3));assert.equal(items[1].runNumber,undefined,'The same run');
  assert.deepEqual(items[1].history.map(attempt=>[attempt.status,attempt.replicate,attempt.error]),[['error',2,'The reply was cut off.']]);assert(runAll(r).includes('Run all (0)'));
  assert.throws(()=>r.find(n=>n.type==='span'&&String(n.props.className).includes('partial')));assert(r.find(n=>n.props?.className==='research-tag warn'&&r.text(n)==='67%'),'The share of the annotations that gave the value');
  // Another setup leaves a subject's missing annotations alone.
  const partial=harness(three({items:[{...items[1],annotations:items[1].annotations.slice(0,2)}]}));partial.props.research=true;await partial.flush();assert(runAll(partial).includes('Run all (1)'));
  partial.find(n=>n.type==='setup').props.setPrompt('Classify again');await partial.flush();assert(runAll(partial).includes('Run all (0)'));
  // Repeat study: a new run of every subject, with three annotations each.
  r.button('Repeat study').props.onClick();await r.flush();said(r,'Run 2: 3 subjects queued, 3 annotations each. Earlier results are kept. Check the current settings, then choose Annotate next or Run all.');
  // One annotation per subject: nothing of the setting is stored, and web search can be turned on.
  repeatsSelect(r).onChange({target:{value:'1'}});await r.flush();assert.equal(r.latest().repeats,undefined);assert(!r.text(r.button('Processing options')).includes('annotations per subject'));
  const web=r.find(n=>n.type==='input'&&n.props?.type==='checkbox');assert.equal(web.props.disabled,false);web.props.onChange({target:{checked:true}});await r.flush();
  repeatsSelect(r).onChange({target:{value:'3'}});await r.flush();assert.equal(repeatsSelect(r).disabled,true);assert.equal(repeatsSelect(r).value,1);assert.equal(r.text(r.find(n=>n.props?.id==='knowledge-repeats-help')),'Web search makes one annotation per subject. Turn it off to annotate each subject several times.');
  assert.equal(r.find(n=>n.type==='input'&&n.props?.type==='checkbox').props.disabled,false,'Web search can always be turned off');

  // As a batch: each subject's request is repeated as many times as it has annotations to make.
  const jobs=[];let returned=()=>[];
  const b=harness(three({processing:'batch'}),async(url,options)=>{
   const action=options.body.get('action');assert.equal(url,action==='prepare'?'/api/batch?split=1':'/api/batch');
   // Research mode prepares the run first, then sends it batch by batch (here one).
   if(action==='prepare'){jobs.push({ids:JSON.parse(options.body.get('ids')),copies:options.body.get('copies'),subjects:JSON.parse(options.body.get('subjects')).map(fields=>fields[0].value)});const n=jobs.at(-1).ids.length;return Response.json({parts:[{items:[0,jobs.at(-1).subjects.length],requests:[0,n],bytes:1}],bytes:1,requests:n,bySize:false});}
   if(action==='send')return Response.json({id:'batch_'+jobs.length});
   if(action==='check')return Response.json({terminal:true,state:'completed',completed:1,total:1});
   return Response.json({terminal:true,state:'completed',results:returned(jobs.at(-1).ids)});
  });b.props.research=true;await b.flush();
  await b.button('Submit batch').props.onClick();await b.flush();
  assert.deepEqual([jobs[0].copies,jobs[0].ids.length,jobs[0].subjects.join()],['[3,3,3]',9,'Subject 0,Subject 1,Subject 2']);assert.deepEqual([b.latest().batchJob.repeats,b.latest().batchJob.ns,b.latest().batchJob.id],[3,undefined,'batch_1']);
  assert(b.latest().items.every(item=>item.status==='queued'&&item.repeats===3&&item.annotations.length===0&&item.runSize===9));
  // Request 4 (the second subject's second annotation) is not returned, and request 7 (the third subject's second) failed.
  returned=ids=>ids.flatMap((id,i)=>i===4?[]:i===7?[{id,error:'Expired'}]:[{id,score:['ONE','TWO','ONE','ONE','','TWO','TWO','','TWO'][i],explanation:'Reply '+i,tokens:5,usage:{input_tokens:4,output_tokens:1},responseId:'b'+i}]);
  await b.button('Check status').props.onClick();await b.flush();await b.button('Collect results').props.onClick();await b.flush();
  items=b.latest().items;
  assert.equal(b.latest().batchJob,null);assert.deepEqual(items.map(item=>[item.status,item.score,item.tokens,item.processing,item.batchId,item.webSearch]),[['done','ONE',15,'batch','batch_1',false],['done','ONE | TWO',10,'batch','batch_1',false],['done','TWO',10,'batch','batch_1',false]]);
  assert.deepEqual(items[1].annotations.map(a=>[a.n,a.status,a.error,a.batchId]),[[1,'done',undefined,'batch_1'],[2,'error','No result was returned for this subject. Check the provider’s batch report before retrying.','batch_1'],[3,'done',undefined,'batch_1']]);
  assert.deepEqual(items[2].annotations.map(a=>[a.status,a.error]),[['done',undefined],['error','Expired'],['done',undefined]]);assert.equal(items[1].consistency.score,0,'A tied vote');assert.equal(items[0].explanation,'Reply 0');
  // The next batch submits only what is missing: one request for each of the two subjects.
  assert(b.text(b.button('Submit batch')).includes('Submit batch (2)'));await b.button('Submit batch').props.onClick();await b.flush();
  assert.deepEqual([jobs[1].copies,jobs[1].ids.length,jobs[1].subjects.join()],['[1,1]',2,'Subject 1,Subject 2']);assert.deepEqual(b.latest().batchJob.ns,[[2],[2]]);
  assert.deepEqual(b.latest().items.map(item=>[item.status,item.annotations.length]),[['done',3],['queued',3],['queued',3]],'A subject waiting for its missing annotations keeps those it has');
  returned=ids=>ids.map((id,i)=>({id,score:'ONE',explanation:'Later '+i,tokens:5,responseId:'c'+i}));
  await b.button('Check status').props.onClick();await b.flush();await b.button('Collect results').props.onClick();await b.flush();
  items=b.latest().items;
  assert.deepEqual(items.map(item=>[item.status,item.score,item.runNumber||1,item.annotations.map(a=>a.status).join(),item.annotations[1].batchId]),[['done','ONE',1,'done,done,done','batch_1'],['done','ONE',1,'done,done,done','batch_2'],['done','TWO',1,'done,done,done','batch_2']]);
  assert.deepEqual(items[1].history.map(attempt=>[attempt.replicate,attempt.batchId,attempt.status]),[[2,'batch_1','error']]);assert(b.text(b.button('Submit batch')).includes('Submit batch (0)'));
  // A batch that is not accepted leaves a subject with the annotations it had, and one without any waiting.
  const refused=harness(three({processing:'batch',items:[{...items[0],annotations:items[0].annotations.slice(0,2)},subjects[1]]}),async()=>Response.json({error:'The provider did not accept the batch.',uncertain:false},{status:400}));refused.props.research=true;await refused.flush();
  await refused.button('Submit batch').props.onClick();await refused.flush();
  assert.equal(refused.latest().batchJob,null);assert.deepEqual(refused.latest().items.map(item=>[item.status,item.annotations?.length]),[['done',2],['pending',undefined]]);
 }
 // An error prevents new starts while already active results are still collected.
 const errorReleases=[];const parallelError=harness({prompt:'Classify',concurrency:2,items:subjects},()=>new Promise(resolve=>errorReleases.push(resolve)));await parallelError.flush();const errorRun=parallelError.button('Run all').props.onClick();await parallelError.flush();assert.equal(parallelError.requests.length,2);
 errorReleases[0](Response.json({error:'Quota'},{status:429}));await parallelError.flush();assert.equal(parallelError.requests.length,2);assert.equal(parallelError.find(n=>n.type==='setup').props.locked,true);errorReleases[1](Response.json({score:'KEPT',explanation:'Completed in flight'}));await errorRun;await parallelError.flush();assert.equal(parallelError.latest().items[0].status,'error');assert.equal(parallelError.latest().items[1].score,'KEPT');assert.equal(parallelError.requests.length,2);
 const ExcelJS=require('exceljs'),buffer=await load('lib/export-results.ts').createResultsWorkbook([{name:'Subject',fields:[...fields,{heading:'Code',value:'001'},{heading:'Formula',value:'=1+1'}],status:'done',score:'INSUFFICIENT_KNOWLEDGE',explanation:'Unknown',prompt:'Classify',provider:'openai',model:'gpt-6-luna',effort:'medium'}],{workspace:'model-knowledge',prompt:'Classify',model:'gpt-6-luna',effort:'medium'});const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const results=workbook.getWorksheet('Results');assert.equal(results.getCell('A1').value,'Title');assert.equal(results.getCell('D2').value,'001');assert.equal(results.getCell('E2').value,'=1+1');assert.equal(results.getCell('E2').type,ExcelJS.ValueType.String);assert.equal(results.getCell('F2').value,'INSUFFICIENT_KNOWLEDGE');const rows=[];workbook.getWorksheet('Study settings').eachRow(row=>rows.push(row.values));assert(rows.some(row=>row.includes(knowledge.KNOWLEDGE_INSTRUCTIONS)));
 // The settings sheet contains the recorded study, not general teaching material.
 const settingsSheet=workbook.getWorksheet('Study settings');
 assert(!rows.some(row=>['Research use','Published example','Example method','Example validation','Applying the example','Validation and reporting'].includes(row[1])));
 const longPrompt=('First line with “quotes” and emoji 🎬.\n\n'+'x'.repeat(171)+'\r\n').repeat(300);
 const longInstructions=('Instructions remain intact.\n').repeat(50);
 const exportEntry={name:'Subject',fields:[{heading:'Subject',value:'Example'}],status:'done',score:'3',explanation:'Kept',provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:longPrompt,instructions:longInstructions,concurrency:4};
 const longBook=new ExcelJS.Workbook();await longBook.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook([exportEntry,{...exportEntry,concurrency:1}],{workspace:'model-knowledge',prompt:'Current prompt is different',model:'gpt-6-luna',effort:'medium'}));
 const allSettings=[];longBook.getWorksheet('Study settings').eachRow(row=>allSettings.push(row));
 const promptParts=allSettings.filter(row=>String(row.getCell(1).value).startsWith('Annotation prompt'));
 assert(promptParts.length>2);assert.equal(promptParts.map(row=>row.getCell(2).value).join(''),longPrompt.replace(/\r\n/g,'\n'));
 assert.equal(allSettings.filter(row=>String(row.getCell(1).value).startsWith('Additional model instructions')).map(row=>row.getCell(2).value).join(''),longInstructions);
 assert(allSettings.every(row=>row.height<=400));assert.deepEqual(allSettings.filter(row=>row.getCell(1).value==='Parallel annotations').map(row=>row.getCell(2).value),[4,1]);
 const longResults=longBook.getWorksheet('Results'),settingColumn=longResults.getRow(1).values.indexOf('Settings ID');assert.notEqual(longResults.getCell(2,settingColumn).value,longResults.getCell(3,settingColumn).value);
 // Newlines need height even for short text: do not clip sparse multiline prompts.
 const linesPrompt=Array.from({length:15},(_,i)=>`Line ${i}`).join('\n');
 const multilineBook=new ExcelJS.Workbook();await multilineBook.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook([{...exportEntry,prompt:linesPrompt}],{workspace:'model-knowledge',prompt:linesPrompt,model:'gpt-6-luna',effort:'medium'}));
 let promptHeight=0;multilineBook.getWorksheet('Study settings').eachRow(row=>{if(row.getCell(1).value==='Annotation prompt')promptHeight=row.height;});assert(promptHeight>=15*17);
 // Batch lifecycle: save before submission, independent subjects, out-of-order collection,
 // abstention, retained earlier runs, recovery after reload, and no duplicate submission.
 const original={id:'old',subjectId:'s1',runNumber:1,name:'First',fields:[{heading:'Title',value:'First'}],status:'done',score:'REALIST',explanation:'Original answer',prompt:'Earlier prompt',model:'gpt-6-luna',provider:'openai',effort:'medium'};
 const initial={mode:'list',prompt:'Classify',processing:'batch',items:[original,{id:'repeat',subjectId:'s1',runNumber:2,name:'First',fields:original.fields,status:'pending'},{id:'second',subjectId:'s2',runNumber:1,name:'Second',fields:[{heading:'Title',value:'Second'}],status:'pending'}]};
 let submittedIds,jobReference;
 const b=harness(initial,async(url,{body})=>{
  assert.equal(url,'/api/batch');const action=body.get('action');
  if(action==='submit'){assert.equal(b.writes.at(-1).batchJob.state,'submitting');assert.equal(body.get('mode'),'model-knowledge');assert.equal(body.get('webSearch'),'false');assert(!body.has('files'));assert.deepEqual(JSON.parse(body.get('subjects')),initial.items.slice(1).map(item=>item.fields));assert(!body.get('subjects').includes(original.explanation));submittedIds=JSON.parse(body.get('ids'));jobReference=b.writes.at(-1).batchJob;return Response.json({id:'batch_test'});}
  if(action==='check')return Response.json({id:'batch_test',state:'completed',terminal:true,completed:2,total:2});
  return Response.json({id:'batch_test',state:'completed',terminal:true,completed:2,total:2,results:[{id:submittedIds[1],score:'INSUFFICIENT_KNOWLEDGE',explanation:'Unfamiliar'},{id:submittedIds[0],score:'FANTASTIC',explanation:'New answer'}]});
 });await b.flush();await b.button('Submit batch').props.onClick();await b.flush();assert.equal(b.latest().batchJob.id,'batch_test');assert.equal(b.latest().items[1].status,'queued');assert.equal(b.find(n=>n.type==='setup').props.locked,true);assert.equal(b.find(n=>n.type==='setup').props.keyLocked,false,'key must remain editable for recovery');assert.equal(b.button('Repeat study').props.disabled,true);await b.button('Submit batch').props.onClick();assert.equal(b.requests.length,1);await b.button('Check status').props.onClick();await b.flush();await b.button('Collect results').props.onClick();await b.flush();assert.equal(b.latest().batchJob,null);assert.deepEqual(b.latest().items[0],original);assert.equal(b.latest().items[1].score,'FANTASTIC');assert.equal(b.latest().items[2].score,'INSUFFICIENT_KNOWLEDGE');assert(b.latest().items.slice(1).every(item=>item.processing==='batch'&&item.batchId==='batch_test'&&item.time&&item.webSearch===false&&item.instructions===knowledge.KNOWLEDGE_INSTRUCTIONS));assert.deepEqual(b.busyChanges,[true,false]);
 const batchWorkbook=new ExcelJS.Workbook();await batchWorkbook.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook(b.latest().items,{workspace:'model-knowledge',prompt:'Classify',model:'gpt-6-luna',effort:'medium',processing:'batch'}));const batchRows=[];batchWorkbook.getWorksheet('Study settings').eachRow(row=>batchRows.push(row.values));assert(batchRows.some(row=>row.includes('Batch')));assert(!batchRows.some(row=>row.some(value=>typeof value==='string'&&value.includes(knowledge.KNOWLEDGE_STUDY.url))));
 const denied=harness(initial,async()=>{throw Error('must not submit')},async()=>{throw Error('Storage full')});await denied.flush();await denied.button('Submit batch').props.onClick();await denied.flush();assert.equal(denied.requests.length,0,'storage failure must prevent paid submission');
 const uncertain=harness(initial,async()=>{throw Error('Network lost')});await uncertain.flush();await uncertain.button('Submit batch').props.onClick();await uncertain.flush();assert.equal(uncertain.latest().batchJob.state,'unknown');assert.equal(uncertain.latest().items[1].status,'queued');
 const restored=harness({...uncertain.latest(),batchJob:{...uncertain.latest().batchJob,state:'submitting'}},async()=>Response.json({id:'batch_recovered',state:'completed',terminal:true,completed:2,total:2}));await restored.flush();assert.equal(restored.requests.length,0);assert.equal(restored.button('Submit batch').props.disabled,true);restored.find(n=>n.props?.id==='knowledge-recover-batch').props.onChange({target:{value:'batch_recovered'}});await restored.flush();await restored.button('Recover batch').props.onClick();await restored.flush();assert.equal(restored.latest().batchJob.id,'batch_recovered');assert.equal(restored.latest().batchJob.state,'ready');assert.equal(restored.requests[0].options.body.get('action'),'check');
 const queued={...initial,batchJob:{...jobReference,id:'batch_test',state:'ready'},items:initial.items.map(item=>item.status==='pending'?{...item,status:'queued'}:item)};
 for(const results of [[{id:'foreign_0',score:'X',explanation:'Foreign'}],[{id:submittedIds[0],score:'X',explanation:'Duplicate'},{id:submittedIds[0],score:'X',explanation:'Duplicate'}],[{id:submittedIds[0],score:12,explanation:'Invalid'}]]){const wrong=harness(queued,async()=>Response.json({terminal:true,results}));await wrong.flush();await wrong.button('Collect results').props.onClick();await wrong.flush();assert.equal(wrong.latest().batchJob.id,'batch_test');assert.equal(wrong.latest().items[1].status,'queued');}
 const collectionSaveFailure=harness(queued,async()=>Response.json({terminal:true,results:[{id:submittedIds[0],score:'X',explanation:'Kept by provider'}]}),async value=>{if(!value.batchJob)throw Error('Storage full')});await collectionSaveFailure.flush();await collectionSaveFailure.button('Collect results').props.onClick();await collectionSaveFailure.flush();assert.equal(collectionSaveFailure.find(n=>n.type==='setup').props.locked,true,'retain job when collection cannot be saved');
 const search=harness({...initial,processing:'instant',webSearch:true});await search.flush();search.button('Processing options').props.onClick();await search.flush();assert.equal(search.find(n=>n.type==='option'&&n.props?.value==='batch').props.disabled,true);await search.button('Run all').props.onClick();await search.flush();assert(search.requests.every(r=>r.options.body.get('webSearch')==='true'));
 const batchUi=harness(initial);await batchUi.flush();const webControl=batchUi.find(n=>n.type==='input'&&n.props?.type==='checkbox');assert.equal(webControl.props.disabled,true);assert.throws(()=>batchUi.find(n=>n.props?.className==='hint run-guidance'),'Batch setup should not show the active-run reminder');
 const cancel=harness({...queued,batchJob:{...queued.batchJob,state:'processing'}},async()=>Response.json({cancelRequested:true}));await cancel.flush();await cancel.button('Cancel batch').props.onClick();await cancel.flush();assert.equal(cancel.requests[0].options.body.get('action'),'cancel');assert.equal(cancel.latest().batchJob.id,'batch_test','cancellation must keep the job for partial result collection');
 assert.equal(parse('list','',Array.from({length:10000},(_,i)=>'Subject '+i).join('\n')).items.length,10000);assert(parse('list','',Array.from({length:10001},()=> 'X').join('\n')).error);assert.equal(parse('structured','Title,Author',Array.from({length:3100},(_,i)=>'Title '+i+',Author '+i).join('\n')).items.length,3100);
 const manyInitial={prompt:'Classify',processing:'batch',items:Array.from({length:3100},(_,i)=>({id:'subject-'+i,name:'Subject '+i,fields:[{heading:'Subject',value:'Subject '+i}],status:'pending'}))};const many=harness(manyInitial,async()=>Response.json({id:'batch_many'}));await many.flush();await many.button('Submit batch').props.onClick();await many.flush();assert.equal(JSON.parse(many.requests[0].options.body.get('subjects')).length,3100);const largeSaved=many.latest(),reload=harness({...largeSaved,batchJob:{...largeSaved.batchJob,state:'ready'}},async()=>Response.json({terminal:true,results:Array.from({length:3100},(_,i)=>({id:largeSaved.batchJob.runId+'_'+(3099-i),score:String(3099-i),explanation:'Subject '+(3099-i)}))}));await reload.flush();await reload.button('Collect results').props.onClick();await reload.flush();assert(reload.latest().items.every(item=>item.status==='done'));assert.equal(reload.latest().items[3099].score,'3099');reload.find(n=>n.type==='ResultPages').props.onPageChange(30);await reload.flush();assert(reload.find(n=>n.type==='TableRow'&&n.props?.['aria-label']?.includes('Subject 3099,')));const largeBook=new ExcelJS.Workbook();await largeBook.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook(reload.latest().items,{workspace:'model-knowledge',prompt:'Classify',model:'gpt-6-luna',effort:'medium'}));assert.equal(largeBook.getWorksheet('Results').rowCount,3101);
 console.log('PASS: 10,000-subject parsing; 3,100-subject submission, recovery, keyed collection, pagination, and full Excel export; independent repeats and existing batch protections. Mocked requests only.');
})().catch(error=>{console.error(error);process.exit(1);});
