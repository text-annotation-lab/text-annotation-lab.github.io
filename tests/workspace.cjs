// Component workflow checks with a small hook/event harness, not a browser renderer.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
const root=process.cwd();
function transpile(file,require,scope={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8')+(file==='app/page.tsx'?'\nexport {StudyWorkspace};':''),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('exports','require',...Object.keys(scope),code)(exports,require,...Object.values(scope));return exports;
}
const providers=transpile('lib/providers.ts',require);
function localModule(file){return transpile(file,id=>id.startsWith('.')?localModule(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id));}
const chunkText=localModule('lib/chunk-text.ts');
function harness(initial,save=async()=>{},fetcher=async()=>Response.json({score:'POSITIVE',explanation:'Evidence'}),preparePanel=()=>undefined,initialHash=''){
 const slots=[],effects=[],listeners=new Map(),writes=[],calls=[];let cursor=0,pending=[],dirty=true,tree;
 const react={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useEffect(fn,deps){const i=cursor++,previous=effects[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}};
 const jsx=(type,props)=>({type,props});
 const storage={restore:async()=>initial,save:async value=>{writes.push(value);return save(value);}};
 const imports=id=>id==='@/components/reading-panels'?{ReadingPanels:'ReadingPanels',prepareReadingPanel:preparePanel}:id==='@/lib/section-navigation'?{focusSectionWhenReady:()=>()=>{}}:id==='react'?react:id==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:id==='@/lib/document-uploads'?localModule('lib/document-uploads.ts'):id==='@/lib/annotation-queue'?localModule('lib/annotation-queue.ts'):id==='@/lib/workflow-safety'?localModule('lib/workflow-safety.ts'):id==='@/lib/annotation-feedback'?localModule('lib/annotation-feedback.ts'):id==='@/lib/studies'?localModule('lib/studies.ts'):id==='@/lib/batch-limits'?localModule('lib/batch-limits.ts'):id==='@/lib/providers'?providers:id==='@/lib/workspace-storage'?{createWorkspaceStorage:()=>storage}:id==='@/lib/chunk-text'?chunkText:id==='@/lib/chunk-documents'?localModule('lib/chunk-documents.ts'):id==='@/components/named-answer-detail'?transpile('components/named-answer-detail.tsx',id=>id.startsWith('@/lib/')?localModule(id.slice(2)+'.ts'):require(id)):id==='@/components/provider-key-status'?{useProviderKeyCheck:()=>({check:{status:'unverified'},refresh:()=>{}}),ProviderKeyStatus:'ProviderKeyStatus'}:id.startsWith('@/lib/')&&fs.existsSync(id.slice(2)+'.ts')?localModule(id.slice(2)+'.ts'):new Proxy({},{get:(_,key)=>String(key)});
 const window={scrollY:900,scrollTo({top}){this.scrollY=top;},location:{hash:initialHash,pathname:'/',search:''},history:{scrollRestoration:'auto',replaceState(_a,_b,url){window.location.hash=url.includes('#')?'#'+url.split('#')[1]:'';},pushState(...args){this.replaceState(...args);}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 const Home=transpile('app/page.tsx',imports,{window,document:{getElementById:()=>null},requestAnimationFrame:()=>0,cancelAnimationFrame(){},confirm:()=>true,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}}).StudyWorkspace;
 function render(){cursor=0;dirty=false;tree=Home({});const queue=pending;pending=[];queue.forEach(fn=>fn());}
 async function flush(){for(let n=0;n<8;n++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}return tree;}
 function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
 function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
 function find(predicate){const result=nodes(tree).find(predicate);assert(result,'Expected a matching rendered control: '+nodes(tree).filter(n=>n.props?.onClick).map(n=>String(n.type)+':'+text(n)).join(', '));return result;}
 const button=label=>find(n=>['Button','button'].includes(n.type)&&text(n).trimStart().startsWith(label));
 async function configure(){find(n=>n.type==='ModelKnowledge').props.onStudyReady(true);find(n=>n.props?.id==='key').props.onChange({target:{value:'sk-workflow-test'}});find(n=>n.props?.id==='prompt').props.onChange({target:{value:'Classify tone'}});await flush();button('Processing options').props.onClick();await flush();if(find(n=>n.props?.id==='processing-mode').props.value==='instant')find(n=>n.props?.id==='annotation-concurrency').props.onChange({target:{value:'1'}});await flush();}
 async function add(files){await find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files,value:''}});await flush();}
 render();return {flush,configure,add,button,find,text,listeners,calls,writes,latest:()=>writes.at(-1),window};
}
(async()=>{
 // A slow reading tab must not replace the current page with a short placeholder.
 const deferred=new Map();
 const transition=harness(undefined,async()=>{},undefined,section=>section==='workspace'||section==='model-knowledge'?undefined:new Promise((resolve,reject)=>deferred.set(section,{resolve,reject})));
 await transition.flush();const transitionTabs=()=>transition.find(n=>n.type==='Tabs');
 transitionTabs().props.onValueChange('get-started');await transition.flush();
 assert.equal(transitionTabs().props.value,'workspace');assert.equal(transitionTabs().props['aria-busy'],true);assert.equal(transition.window.location.hash,'#workspace');
 transitionTabs().props.onValueChange('about');await transition.flush();
 deferred.get('get-started').resolve();await transition.flush();assert.equal(transitionTabs().props.value,'workspace','An older load must not override the latest selection');
 deferred.get('about').resolve();await transition.flush();assert.equal(transitionTabs().props.value,'about');assert.equal(transition.window.location.hash,'#about');assert.equal(transitionTabs().props['aria-busy'],undefined);
 transitionTabs().props.onValueChange('tips');await transition.flush();transitionTabs().props.onValueChange('model-knowledge');await transition.flush();
 deferred.get('tips').resolve();await transition.flush();assert.equal(transitionTabs().props.value,'model-knowledge','Returning to a workspace cancels the deferred tab');
 transition.window.location.hash='#corpus-billboard';transition.listeners.get('hashchange')();await transition.flush();assert.equal(transitionTabs().props.value,'model-knowledge');
 deferred.get('corpus').resolve();await transition.flush();assert.equal(transitionTabs().props.value,'corpus');assert.equal(transition.window.location.hash,'#corpus-billboard');
 transitionTabs().props.onValueChange('resources');await transition.flush();deferred.get('resources').reject(new Error('Offline'));await transition.flush();assert.equal(transitionTabs().props.value,'resources','Failed loads still reach the retry view');assert.equal(transitionTabs().props['aria-busy'],undefined);
 const keepSpeed=harness({provider:'openai',model:'gpt-6-luna',effort:'medium',concurrency:4,docs:[]});await keepSpeed.flush();keepSpeed.button('Processing options').props.onClick();await keepSpeed.flush();assert.equal(keepSpeed.find(n=>n.props?.id==='annotation-concurrency').props.value,4);
 // Visits and refreshes discard a stale section URL and scroll position, not the study.
 const reopened=harness({prompt:'Keep my prompt',docs:[]},undefined,undefined,undefined,'#about');await reopened.flush();
 const reopenedTabs=()=>reopened.find(n=>n.type==='Tabs');
 assert.equal(reopenedTabs().props.value,'workspace');assert.equal(reopened.window.location.hash,'#workspace');
 assert.equal(reopened.window.scrollY,0);assert.equal(reopened.window.history.scrollRestoration,'manual');
 assert.equal(reopened.find(n=>n.props?.id==='prompt').props.value,'Keep my prompt');
 reopenedTabs().props.onValueChange('about');await reopened.flush();reopened.window.scrollY=700;
 reopened.listeners.get('pageshow')({persisted:true});await reopened.flush();
 assert.equal(reopenedTabs().props.value,'workspace');assert.equal(reopened.window.scrollY,0);assert.equal(reopened.window.location.hash,'#workspace');
 reopened.window.scrollY=400;reopenedTabs().props.onValueChange('get-started');await reopened.flush();
 assert.equal(reopened.window.scrollY,400,'Ordinary tab clicks must not reset scroll');
 // In-session section links and back/forward-style hash changes still work.
 const navigation=harness();await navigation.flush();assert.equal(navigation.window.location.hash,'#workspace');const tabs=()=>navigation.find(n=>n.type==='Tabs');tabs().props.onValueChange('model-knowledge');await navigation.flush();assert.equal(navigation.window.location.hash,'#model-knowledge');assert.equal(tabs().props.value,'model-knowledge');navigation.window.location.hash='#corpus-billboard';navigation.listeners.get('hashchange')();await navigation.flush();assert.equal(tabs().props.value,'corpus');navigation.window.location.hash='#model-knowledge';navigation.listeners.get('hashchange')();await navigation.flush();assert.equal(tabs().props.value,'model-knowledge');
 // New controls: duplicate decisions never silently mutate the queue.
 const dupe=harness();await dupe.flush();await dupe.configure();await dupe.add([new File(['same'],'same.txt')]);assert.equal(dupe.latest().docs.length,1);
 await dupe.add([new File(['same'],'same.txt'),new File(['different'],'other.txt')]);assert.equal(dupe.latest().docs.length,1);dupe.button('Exclude duplicate files').props.onClick();await dupe.flush();assert.equal(dupe.latest().docs.length,2);
 await dupe.add([new File(['same'],'same.txt')]);dupe.button('Keep all selected files').props.onClick();await dupe.flush();assert.equal(dupe.latest().docs.length,3);
 await dupe.add([new File(['same'],'same.txt')]);dupe.button('Cancel import').props.onClick();await dupe.flush();assert.equal(dupe.latest().docs.length,3);assert.equal(dupe.calls.length,0);
 assert.throws(()=>dupe.button('Load 3 synthetic sample texts'));assert.throws(()=>dupe.button('Queue failed items for retry'));assert.match(dupe.text(dupe.find(n=>n.props?.className==='progressline')),/3 texts ready/);assert.equal(dupe.latest().prompt,'Classify tone');
 const mismatch=harness();await mismatch.flush();await mismatch.configure();await mismatch.add([new File(['hello'],'test.txt')]);mismatch.find(n=>n.props?.id==='key').props.onChange({target:{value:'sk-ant-wrong-provider'}});await mismatch.flush();await mismatch.button('Run all').props.onClick();await mismatch.flush();assert.equal(mismatch.calls.length,0);assert.equal(mismatch.latest().docs[0].status,'pending');assert(mismatch.text(mismatch.find(n=>n.type==='main')).includes('This key appears'));
 const header=harness();await header.flush();
 const knowledge=()=>header.find(n=>n.type==='ModelKnowledge').props;
 const headerText=()=>header.text(header.find(n=>n.type==='header'));
 assert.match(headerText(),/Preparing workspace/);
 knowledge().onSaveStateChange('saved');await header.flush();assert.match(headerText(),/Autosaved in this browser/);
 knowledge().onSaveStateChange('saving');await header.flush();assert.match(headerText(),/Autosaved in this browser/,'A quick save must not flicker the header');
 knowledge().onSaveStateChange('saved');await header.flush();knowledge().onSaveStateChange('saving');await header.flush();await new Promise(resolve=>setTimeout(resolve,1600));await header.flush();assert.match(headerText(),/Autosaving/);assert(!headerText().includes('Autosaved in this browser'));
 knowledge().onSaveStateChange('error');await header.flush();assert.match(headerText(),/Working copy not saved/);
 knowledge().onSaveStateChange('saved');await header.flush();assert.match(headerText(),/Autosaved in this browser/);
 // Busy/ready state is independent of persistence: merely running a task does not report a save failure.
 knowledge().onStudyReady(false);await header.flush();assert.match(headerText(),/Autosaved in this browser/);
 const h=harness();await h.flush();await h.configure();
 await h.add([new File(['one'],'one.txt'),new File(['two'],'two.md'),new File([''],'empty.txt'),new File(['no'],'bad.exe')]);
 assert.equal(h.latest().docs.length,2);assert(!Object.hasOwn(h.latest(),'key'));
 const run=h.button('Run all').props.onClick();await run;await h.flush();
 assert.equal(h.calls.length,2);assert(h.latest().docs.every(d=>d.status==='done'));assert.equal(h.calls[0].options.body.get('prompt'),'Classify tone');
 const row=h.find(n=>n.type==='TableRow'&&n.props['aria-label']==='View annotation and explanation for one.txt');row.props.onClick();await h.flush();assert.match(h.text(h.find(n=>n.props?.id==='annotation-detail')),/one.txtPOSITIVEEvidence/);
 const second=h.find(n=>n.type==='TableRow'&&n.props['aria-label']==='View annotation and explanation for two.md');let rowPrevented=false;second.props.onKeyDown({target:second,currentTarget:second,key:'Enter',preventDefault(){rowPrevented=true;}});await h.flush();assert(rowPrevented);assert.match(h.text(h.find(n=>n.props?.id==='annotation-detail')),/two.md/);
 row.props.onKeyDown({target:row,currentTarget:row,key:' ',preventDefault(){}});await h.flush();assert.match(h.text(h.find(n=>n.props?.id==='annotation-detail')),/one.txt/);
 h.button('Clear results').props.onClick();await h.flush();assert(h.latest().docs.every(d=>d.status==='pending'&&!d.score&&!d.explanation));

 // Incomplete successful HTTP responses must remain reviewable, never count as completed.
 const malformed=harness(undefined,async()=>{},async()=>Response.json({score:'2'}));await malformed.flush();await malformed.configure();await malformed.add([new File(['a'],'invalid.txt'),new File(['b'],'waiting.txt')]);
 await malformed.button('Run all').props.onClick();await malformed.flush();assert.deepEqual(malformed.latest().docs.map(d=>d.status),['error','pending']);assert.equal(malformed.calls.length,1);assert.match(malformed.latest().docs[0].rawResponse,/"score":"2"/);assert(malformed.latest().docs[0].error);
 assert.equal(malformed.text(malformed.find(n=>n.props?.id==='annotation-detail')).split(malformed.latest().docs[0].error).length-1,1,'Show errors only once');
 assert(malformed.latest().docs[0].runId);assert.equal(malformed.latest().docs[0].runSize,2);
 malformed.button('Clear results').props.onClick();await malformed.flush();assert(malformed.latest().docs.every(d=>!Object.hasOwn(d,'rawResponse')&&!Object.hasOwn(d,'responseFormat')&&!d.error&&d.status==='pending'));
 const stale=harness({docs:[{id:'stale',name:'stale.txt',file:new File(['x'],'stale.txt'),status:'error',rawResponse:'Old answer',responseFormat:'old format',error:'Old error'}],provider:'openai',model:providers.defaultModel('openai'),effort:'medium'});await stale.flush();stale.button('Clear results').props.onClick();await stale.flush();assert.equal(stale.latest().docs[0].rawResponse,undefined);assert.equal(stale.latest().docs[0].responseFormat,undefined);
 let resolve;const paused=harness(undefined,async()=>{},()=>new Promise(r=>resolve=r));await paused.flush();await paused.configure();await paused.add([new File(['one'],'one.txt'),new File(['two'],'two.txt')]);
 const running=paused.button('Run all').props.onClick();await paused.flush();paused.button('Pause').props.onClick();resolve(Response.json({score:'1',explanation:'One'}));await running;await paused.flush();
 assert.equal(paused.calls.length,1);assert.deepEqual(paused.latest().docs.map(d=>d.status),['done','pending']);
 let count=0;const retry=harness(undefined,async()=>{},async()=>++count===2?Response.json({error:'Quota reached'},{status:429}):Response.json({score:'2',explanation:'Good'}));await retry.flush();await retry.configure();await retry.add([new File(['a'],'a.txt'),new File(['b'],'b.txt'),new File(['c'],'c.txt')]);
 await retry.button('Run all').props.onClick();await retry.flush();assert.deepEqual(retry.latest().docs.map(d=>d.status),['done','error','pending']);assert.equal(retry.calls.length,2);
 retry.button('Queue for retry').props.onClick();await retry.flush();await retry.button('Run all').props.onClick();await retry.flush();assert.equal(retry.calls.length,4);assert(retry.latest().docs.every(d=>d.status==='done'));assert.equal(retry.latest().docs[1].history.length,1);assert.equal(retry.latest().docs[1].history[0].status,'error');
 const swap=harness();await swap.flush();await swap.configure();swap.find(n=>n.type==='Select'&&n.props.value==='openai').props.onValueChange('anthropic');await swap.flush();assert.equal(swap.find(n=>n.props?.id==='key').props.value,'');assert.equal(swap.latest().model,providers.defaultModel('anthropic'));
 const restored=harness({docs:[{id:'x',name:'x.txt',file:new File(['x'],'x.txt'),status:'running'}],prompt:'p',provider:'openai',model:'retired-model',effort:'invalid'});await restored.flush();
 assert.equal(restored.latest()?.docs[0].status,'error','Interrupted work should be persisted as retryable');assert.equal(restored.latest().model,providers.defaultModel('openai'));
 let finishSave;const unsaved=harness(undefined,()=>new Promise(r=>finishSave=r));await unsaved.flush();await unsaved.configure();let prevented=false;unsaved.listeners.get('beforeunload')({preventDefault(){prevented=true;}});assert(prevented,'Leaving with a pending save should warn');finishSave();await unsaved.flush();
 const conflict=harness(undefined,async()=>{throw new Error('Another tab saved changes. Download results you want to keep, then reload this tab before continuing.');});await conflict.flush();await conflict.configure();assert.equal(conflict.button('Annotate next').props.disabled,true);
 const split=harness();await split.flush();await split.configure();
 assert.equal(split.button('Split into chunks').props['aria-expanded'],false);
 split.button('Split into chunks').props.onClick();await split.flush();
 split.find(n=>n.props?.id==='chunk-words').props.onChange({target:{value:'2'}});await split.flush();
 await split.add([new File(['one two three four five'],'article.txt'),new File(['short'],'short.txt')]);
 await split.button('Split ready documents').props.onClick();await split.flush();
 const splitDocs=split.latest().docs;assert.equal(splitDocs.length,4);assert.deepEqual(splitDocs.slice(0,3).map(d=>[d.wordStart,d.wordEnd]),[[1,2],[3,4],[5,5]]);
 assert.equal(await splitDocs[0].file.text(),'one two ');assert.equal(splitDocs[3].name,'short.txt');
 split.button('Restore whole documents').props.onClick();await split.flush();assert.equal(split.latest().docs.length,2);assert.equal(await split.latest().docs[0].file.text(),'one two three four five');
 await split.button('Split ready documents').props.onClick();await split.flush();await split.button('Run all').props.onClick();await split.flush();
 assert.equal(split.calls.length,4);assert(split.calls.every(call=>call.options.body.get('prompt')==='Classify tone'));assert.equal(await split.calls[2].options.body.get('file').text(),'five');
 split.button('Clear results').props.onClick();await split.flush();assert.equal(split.latest().docs[0].sourceName,'article.txt');assert.equal(split.latest().docs[0].wordEnd,2);
 const resumed=harness(split.latest());await resumed.flush();resumed.button('Processing options').props.onClick();await resumed.flush();resumed.button('Split into chunks').props.onClick();await resumed.flush();assert.equal(resumed.find(n=>n.props?.id==='chunk-words').props.value,'2');
 assert.equal(resumed.button('Restore whole documents').props.disabled,false);
 // Batch lifecycle: persist before submission, collect keyed results, resume, and never retry an uncertain paid submission.
 const b=harness(undefined,async()=>{},async(url,options)=>{
  assert.equal(url,'/api/batch');const action=options.body.get('action');
  if(action==='submit')return Response.json({id:'batch_test'});
  if(action==='check')return Response.json({id:'batch_test',terminal:true,state:'completed',completed:2,total:2});
  const job=b.latest().batchJob;return Response.json({id:'batch_test',terminal:true,state:'completed',completed:2,total:2,results:[{id:job.runId+'_1',score:'NEGATIVE',explanation:'Second'},{id:job.runId+'_0',error:'Expired'}]});
 });
 await b.flush();await b.configure();await b.add([new File(['one'],'one.txt'),new File(['two'],'two.txt')]);
 b.find(n=>n.props?.id==='processing-mode').props.onChange({target:{value:'batch'}});await b.flush();
 await b.button('Submit batch').props.onClick();await b.flush();
 assert.equal(b.calls.length,1);assert.equal(b.latest().batchJob.id,'batch_test');assert(b.latest().docs.every(d=>d.status==='queued'));
 assert.equal(b.button('Clear workspace').props.disabled,true);assert.equal(b.button('Annotate next').props.disabled,true);assert(!JSON.stringify(b.latest()).includes('sk-workflow-test'));
 const resumedBatch=harness(b.latest());await resumedBatch.flush();assert(resumedBatch.button('Check status'));assert.equal(resumedBatch.find(n=>n.props?.id==='key').props.value,'');
 await b.button('Check status').props.onClick();await b.flush();assert.equal(b.latest().batchJob.state,'ready');
 await b.button('Collect results').props.onClick();await b.flush();assert.equal(b.latest().batchJob,null);assert.equal(b.latest().docs[0].status,'error');assert.equal(b.latest().docs[1].score,'NEGATIVE');assert.equal(b.latest().docs[1].processing,'batch');assert.equal(b.latest().docs[1].prompt,'Classify tone');
 const ambiguous=harness(undefined,async()=>{},async()=>{throw Error('network')});await ambiguous.flush();await ambiguous.configure();await ambiguous.add([new File(['x'],'x.txt')]);ambiguous.find(n=>n.props?.id==='processing-mode').props.onChange({target:{value:'batch'}});await ambiguous.flush();
 await ambiguous.button('Submit batch').props.onClick();await ambiguous.flush();assert.equal(ambiguous.latest().batchJob.state,'unknown');assert.equal(ambiguous.calls.length,1);assert.equal(ambiguous.button('Submit batch').props.disabled,true);assert(ambiguous.button('No batch to recover'));
 const interruptedBatch=harness({...ambiguous.latest(),batchJob:{...ambiguous.latest().batchJob,state:'submitting'}});await interruptedBatch.flush();assert(interruptedBatch.button('No batch to recover'));assert.equal(interruptedBatch.calls.length,0);
 const noSave=harness(undefined,async()=>{throw Error('Storage unavailable')});await noSave.flush();await noSave.configure();await noSave.add([new File(['x'],'x.txt')]);noSave.find(n=>n.props?.id==='processing-mode').props.onChange({target:{value:'batch'}});await noSave.flush();await noSave.button('Submit batch').props.onClick();await noSave.flush();assert.equal(noSave.calls.length,0,'failed persistence must block paid submission');
 const mismatched=harness({...ambiguous.latest(),batchJob:{...ambiguous.latest().batchJob,id:'batch_other',state:'ready'}},async()=>{},async()=>Response.json({terminal:true,results:[{id:'another_run_0',score:'1',explanation:'wrong job'}]}));await mismatched.flush();await mismatched.configure();await mismatched.button('Collect results').props.onClick();await mismatched.flush();assert(mismatched.button('Collect results'),'different batch must not be collected');assert.equal(mismatched.writes.length,0,'wrong-batch collection must not change saved documents');
 const many=harness(undefined,async()=>{},async(url,{body})=>body.get('action')==='submit'?Response.json({id:'batch_many'}):Response.json({terminal:true,results:Array.from({length:3100},(_,i)=>({id:many.latest().batchJob.runId+'_'+(3099-i),score:String(3099-i),explanation:'Article '+(3099-i)}))}));await many.flush();await many.configure();await many.add(Array.from({length:3100},(_,i)=>new File(['Article '+i],'article-'+i+'.txt')));many.find(n=>n.props?.id==='processing-mode').props.onChange({target:{value:'batch'}});await many.flush();await many.button('Submit batch').props.onClick();await many.flush();assert.equal(many.calls[0].options.body.getAll('files').length,3100);assert.equal(many.latest().batchJob.docIds.length,3100);const largeSaved=many.latest();const reloadMany=harness({...largeSaved,batchJob:{...largeSaved.batchJob,state:'ready'}},async()=>{},async()=>Response.json({terminal:true,results:Array.from({length:3100},(_,i)=>({id:largeSaved.batchJob.runId+'_'+(3099-i),score:String(3099-i),explanation:'Article '+(3099-i)}))}));await reloadMany.flush();await reloadMany.configure();await reloadMany.button('Collect results').props.onClick();await reloadMany.flush();assert.equal(reloadMany.latest().docs.length,3100);assert.equal(reloadMany.latest().docs[3099].score,'3099');assert(reloadMany.latest().docs.every(d=>d.status==='done'));const pages=reloadMany.find(n=>n.type==='ResultPages');assert.equal(pages.props.total,3100);pages.props.onPageChange(30);await reloadMany.flush();assert(reloadMany.find(n=>n.type==='TableRow'&&n.props?.['aria-label']==='View annotation and explanation for article-3099.txt'));
 console.log('PASS: 3,100-document submission, reload recovery, out-of-order collection, and result pagination; saved jobs, key secrecy, pending-work locks, ambiguous-submission and storage failure protection.');
 console.log('PASS: chunk splitting, exact per-chunk payloads, independent annotation calls, source metadata, undo, clear-results preservation, and saved-setting restoration.');
 console.log('PASS: queue success, stop on error, targeted retry, pause, clear results, provider/key isolation, interrupted restoration, pending-save exit warning, and storage conflict blocking. Component event harness; no browser or paid calls.');
})().catch(error=>{console.error(error);process.exit(1);});
