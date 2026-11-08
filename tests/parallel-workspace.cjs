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
function harness(initial,save=async()=>{},fetcher=async()=>Response.json({score:'POSITIVE',explanation:'Evidence'}),preparePanel=()=>undefined){
 const slots=[],effects=[],listeners=new Map(),writes=[],calls=[];let cursor=0,pending=[],dirty=true,tree;
 const react={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useEffect(fn,deps){const i=cursor++,previous=effects[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}};
 const jsx=(type,props)=>({type,props});
 const storage={restore:async()=>initial,save:async value=>{writes.push(value);return save(value);}};
 const imports=id=>id==='@/components/reading-panels'?{ReadingPanels:'ReadingPanels',prepareReadingPanel:preparePanel}:id==='@/lib/section-navigation'?{focusSectionWhenReady:()=>()=>{}}:id==='react'?react:id==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:id==='@/lib/annotation-queue'?localModule('lib/annotation-queue.ts'):id==='@/lib/workflow-safety'?localModule('lib/workflow-safety.ts'):id==='@/lib/annotation-feedback'?localModule('lib/annotation-feedback.ts'):id==='@/lib/studies'?localModule('lib/studies.ts'):id==='@/lib/batch-limits'?localModule('lib/batch-limits.ts'):id==='@/lib/providers'?providers:id==='@/lib/workspace-storage'?{createWorkspaceStorage:()=>storage}:id==='@/lib/chunk-text'?chunkText:id==='@/lib/chunk-documents'?localModule('lib/chunk-documents.ts'):id==='@/components/named-answer-detail'?transpile('components/named-answer-detail.tsx',id=>id.startsWith('@/lib/')?localModule(id.slice(2)+'.ts'):require(id)):id==='@/components/provider-key-status'?{useProviderKeyCheck:()=>({check:{status:'unverified'},refresh:()=>{}}),ProviderKeyStatus:'ProviderKeyStatus'}:id.startsWith('@/lib/')&&fs.existsSync(id.slice(2)+'.ts')?localModule(id.slice(2)+'.ts'):new Proxy({},{get:(_,key)=>String(key)});
 const window={scrollTo(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 const Home=transpile('app/page.tsx',imports,{window,document:{getElementById:()=>null},requestAnimationFrame:()=>0,cancelAnimationFrame(){},confirm:()=>true,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}}).StudyWorkspace;
 function render(){cursor=0;dirty=false;tree=Home({});const queue=pending;pending=[];queue.forEach(fn=>fn());}
 async function flush(){for(let n=0;n<8;n++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}return tree;}
 function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
 function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
 function find(predicate){const result=nodes(tree).find(predicate);assert(result,'Expected a matching rendered control: '+nodes(tree).filter(n=>n.props?.onClick).map(n=>String(n.type)+':'+text(n)).join(', '));return result;}
 const button=label=>find(n=>['Button','button'].includes(n.type)&&text(n).trimStart().startsWith(label));
 async function configure(){find(n=>n.props?.id==='key').props.onChange({target:{value:'sk-workflow-test'}});find(n=>n.props?.id==='prompt').props.onChange({target:{value:'Classify tone'}});await flush();}
 async function add(files){await find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files,value:''}});await flush();}
 render();return {flush,configure,add,button,find,text,listeners,calls,writes,latest:()=>writes.at(-1)};
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const documents=()=>Array.from({length:7},(_,i)=>({id:String(i),name:`text-${i}.txt`,file:new File([`Text ${i}`],`text-${i}.txt`),status:'pending'}));
async function parallelHarness(mode=4){
 const releases=[];
 const h=harness({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:mode},async()=>{},()=>new Promise(resolve=>releases.push(resolve)));
 await h.flush();await h.configure();
 assert.equal(h.button('Processing options').props['aria-expanded'],false);
 assert(h.text(h.find(n=>n.type==='aside')).includes('Processing options'),'Options belong beneath the prompt in the setup panel');
 assert(!h.text(h.find(n=>n.type==='section'&&n.props.className==='panel queue')).includes('Parallel annotations'),'Queue stays focused on documents and results');
 h.button('Processing options').props.onClick();await h.flush();
 return {h,releases};
}
(async()=>{
 const {h,releases}=await parallelHarness();
 assert.equal(h.find(n=>n.props?.id==='annotation-concurrency').props.value,4);
 const running=h.button('Run all').props.onClick();await h.flush();
 assert.equal(h.calls.length,4);assert.equal(h.latest().docs.filter(d=>d.status==='running').length,4);
 assert.equal(h.find(n=>n.props?.id==='annotation-concurrency').props.disabled,true);
 // Completing text 2 first must keep the score attached to text 2 and refill one slot.
 releases[2](Response.json({score:'THIRD',explanation:'Text 2'}));await h.flush();
 assert.equal(h.calls.length,5);assert.equal(h.latest().docs[2].score,'THIRD');
 h.button('Pause').props.onClick();
 for(const i of [0,1,3,4])releases[i](Response.json({score:String(i),explanation:'Kept'}));
 await running;await h.flush();assert.equal(h.calls.length,5);
 assert.deepEqual(h.latest().docs.map(d=>d.status),['done','done','done','done','done','pending','pending']);
 assert.equal(h.latest().concurrency,4);assert(!Object.hasOwn(h.latest(),'key'));
 assert.equal(h.find(n=>n.props?.id==='annotation-concurrency').props.disabled,false);
 const next=h.button('Annotate next').props.onClick();await h.flush();assert.equal(h.calls.length,6);
 releases[5](Response.json({score:'ONE',explanation:'Single test'}));await next;await h.flush();assert.equal(h.calls.length,6);
 h.find(n=>n.props?.id==='annotation-concurrency').props.onChange({target:{value:'2'}});await h.flush();assert.equal(h.latest().concurrency,2);
 h.find(n=>n.props?.id==='processing-mode').props.onChange({target:{value:'batch'}});await h.flush();assert.equal(h.latest().concurrency,2);assert.equal(h.text(h.button('Submit batch')).includes('Submit batch'),true);
 assert(h.text(h.button('Processing options')).includes('Batch · No chunking'));
 assert(!h.text(h.find(n=>n.props?.id==='processing-options-settings')).includes('Parallel annotations'));
 h.button('Processing options').props.onClick();await h.flush();
 assert.equal(h.button('Processing options').props['aria-expanded'],false);
 assert(h.text(h.button('Processing options')).includes('Batch · No chunking'));
 const fail=await parallelHarness();const failedRun=fail.h.button('Run all').props.onClick();await fail.h.flush();
 fail.releases[1](Response.json({error:'Rate limit'},{status:429}));await fail.h.flush();assert.equal(fail.h.calls.length,4);assert.equal(fail.h.latest().docs[1].status,'error');
 assert.equal(fail.h.button('Run all').props.disabled,true);
 for(const i of [0,2,3])fail.releases[i](Response.json({score:'OK',explanation:'Finished'}));
 await failedRun;await fail.h.flush();assert.deepEqual(fail.h.latest().docs.map(d=>d.status),['done','error','done','done','pending','pending','pending']);
 const legacy=await parallelHarness(null);assert.equal(legacy.h.find(n=>n.props?.id==='annotation-concurrency').props.value,1);
 const fresh=harness();await fresh.flush();
 assert(fresh.text(fresh.button('Processing options')).includes('Instant · one at a time · No chunking'));
 assert.equal(fresh.button('Processing options').props['aria-expanded'],false);
 const old=harness({docs:[],provider:'openai',model:providers.defaultModel('openai'),effort:'medium'});await old.flush();
 assert(old.text(old.button('Processing options')).includes('Instant · one at a time · No chunking'));
 const saved=await parallelHarness(1);assert.equal(saved.h.find(n=>n.props?.id==='annotation-concurrency').props.value,1);
 console.log('Parallel workspace checks passed: restore/save settings, bounded scheduling, out-of-order results, pause, single-text test, batch selection, and rate-limit drain.');
})().catch(error=>{console.error(error);process.exitCode=1;});
