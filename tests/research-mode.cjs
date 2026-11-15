// Research mode in the workspace, with the same small hook and event harness as
// the other workspace checks (not a browser renderer): the switch, what each
// mode shows, runs, keys, and that switching never changes texts or results.
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
 const window={scrollTo(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){},pushState(){}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 const Home=transpile('app/page.tsx',imports,{window,document:{getElementById:()=>null},requestAnimationFrame:()=>0,cancelAnimationFrame(){},confirm:()=>true,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}}).StudyWorkspace;
 function render(){cursor=0;dirty=false;tree=Home({});const queue=pending;pending=[];queue.forEach(fn=>fn());}
 async function flush(){for(let n=0;n<8;n++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}return tree;}
 function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
 function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
 function find(predicate){const result=nodes(tree).find(predicate);assert(result,'Expected a matching rendered control: '+nodes(tree).filter(n=>n.props?.onClick).map(n=>String(n.type)+':'+text(n)).join(', '));return result;}
 const button=label=>find(n=>['Button','button'].includes(n.type)&&text(n).trimStart().startsWith(label));
 async function configure(){find(n=>n.props?.id==='key').props.onChange({target:{value:'sk-workflow-test'}});find(n=>n.props?.id==='prompt').props.onChange({target:{value:'Classify tone'}});await flush();}
 async function add(files){await find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files,value:''}});await flush();}
 const all=predicate=>nodes(tree).filter(predicate);
 render();return {flush,configure,add,button,find,all,text,listeners,calls,writes,latest:()=>writes.at(-1)};
}


const documents=()=>Array.from({length:3},(_,i)=>({id:String(i),name:`text-${i}.txt`,file:new File([`Text ${i}`],`text-${i}.txt`),status:'pending'}));
const start=()=>harness({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1});
const STUDENT_TABS=['workspace','get-started','tips','corpus','study-example','resources','about','model-knowledge'],RESEARCH_TABS=['workspace','runs','export','about','model-knowledge'];
const RESEARCH_PARTS=['ResearchKeys','ResearchTools','ResearchFilters','ResearchDetail','ResearchRuns','ResearchExport'];
// A stand-in for the browser's local storage, which holds only the mode and (when chosen) the keys.
function fakeStorage(){const items=new Map();return {items,getItem:key=>items.has(key)?items.get(key):null,setItem:(key,value)=>items.set(key,String(value)),removeItem:key=>items.delete(key)};}
(async()=>{
 const h=start();await h.flush();await h.configure();
 const tabs=()=>h.all(n=>n.type==='TabsTrigger').map(n=>n.props.value),heads=()=>h.all(n=>n.type==='TableHead').map(n=>h.text(n)),toggle=()=>h.find(n=>n.type==='ModeSwitch').props;
 const parts=()=>RESEARCH_PARTS.filter(type=>h.all(n=>n.type===type).length);

 // The standard Lab: its eight tabs, its key field, and nothing of research mode but the switch.
 assert.deepEqual(tabs(),STUDENT_TABS);assert.equal(toggle().on,false);assert.deepEqual(parts(),[]);
 assert.equal(h.find(n=>n.props?.id==='key').props.value,'sk-workflow-test');assert.equal(h.find(n=>n.type==='header').props.className,undefined);
 assert.throws(()=>h.button('Run again'));assert.throws(()=>h.button('Random sample of'));
 await h.button('Run all').props.onClick();await h.flush();
 assert.deepEqual(h.latest().docs.map(doc=>doc.status),['done','done','done']);assert.equal(h.calls.length,3);
 assert.deepEqual(heads(),['Document','Status','Score / category'],'The standard results table has no research columns');
 // Results made in the standard Lab already belong to run 1, so research mode can pick them up.
 assert.deepEqual(h.latest().docs.map(doc=>doc.runNo),[1,1,1]);assert.equal(h.latest().runs.length,1);assert.equal(h.latest().runs[0].prompt,'Classify tone');
 const before=JSON.stringify(h.latest().docs.map(({file,...doc})=>doc));

 // Switching on: other tabs and tools, the same texts and results.
 toggle().onChange(true);await h.flush();
 assert.equal(toggle().on,true);assert.deepEqual(tabs(),RESEARCH_TABS);assert.equal(h.find(n=>n.type==='header').props.className,'research-header');
 assert.deepEqual(parts(),RESEARCH_PARTS);
 assert.throws(()=>h.find(n=>n.props?.id==='key'),'Keys are entered in the header in research mode');
 assert.deepEqual(h.find(n=>n.type==='ResearchKeys').props.keyring,{openai:'sk-workflow-test'},'A key typed before switching is carried along');
 assert.equal(JSON.stringify(h.latest().docs.map(({file,...doc})=>doc)),before);
 assert.deepEqual(heads(),['','Document','Status','Score / category','Run']);
 const runsPanel=()=>h.find(n=>n.type==='ResearchRuns').props;
 const page=()=>h.find(n=>n.type==='Tabs').props;
 page().onValueChange('runs');await h.flush();assert.equal(page().value,'runs');
 assert.equal(runsPanel().datasets[0].kind,'texts');assert.equal(runsPanel().datasets[0].rows.length,3);assert.equal(runsPanel().datasets[0].runs.length,1);assert.equal(runsPanel().datasets[1].kind,'knowledge');
 page().onValueChange('workspace');await h.flush();
 const main=()=>h.text(h.find(n=>n.type==='main'));
 for(const coaching of ['Test it on a varied sample','Select a row to compare','Add a few documents, then annotate'])assert(!main().includes(coaching),coaching);

 // Run again: a second run; the first results are kept.
 assert(h.text(h.button('Run again')).includes('Run again (3)'));
 await h.button('Run again').props.onClick();await h.flush();
 assert.equal(h.calls.length,6);assert.deepEqual(h.latest().docs.map(doc=>[doc.status,doc.runNo,doc.earlier.length,doc.earlier[0].runNo,doc.earlier[0].score]),Array(3).fill(['done',2,1,1,'POSITIVE']));
 assert.deepEqual(h.latest().runs.map(run=>run.number),[1,2]);
 // Labels and a sample from the tools are stored with the study.
 const tools=h.find(n=>n.type==='ResearchTools').props;
 tools.onApply(tools.rows.map((row,i)=>({...row,cells:[i?'NEGATIVE':'POSITIVE']})),[{name:'tone_human',role:'label'}],[],'1 column added to 3 texts.');await h.flush();
 assert.deepEqual(h.latest().columns,[{name:'tone_human',role:'label'}]);assert.deepEqual(h.latest().docs.map(doc=>doc.cells),[['POSITIVE'],['NEGATIVE'],['NEGATIVE']]);assert(main().includes('1 column added to 3 texts.'));
 // Comparing with the human labels adds a column to the table and marks each row.
 const filters=()=>h.find(n=>n.type==='ResearchFilters').props;
 filters().onChange({...filters().view,compare:'col:tone_human'});await h.flush();
 assert.deepEqual(heads(),['','Document','Status','Score / category','Run','tone_human']);
 assert.deepEqual(h.all(n=>n.type==='span'&&String(n.props.className).startsWith('research-compare')).map(n=>n.props.className.trim()),['research-compare match','research-compare differ','research-compare differ']);
 filters().onChange({...filters().view,show:'disagree'});await h.flush();assert.equal(filters().shown,2);assert.equal(filters().total,3);
 // With a filter on, the run buttons apply to the shown texts only.
 assert(h.text(h.button('Run again')).includes('Run again (2)'));assert(main().includes('The run buttons apply to the 2 shown texts.'));
 filters().onChange({...filters().view,show:'all',compare:''});await h.flush();

 // Deleting run 2 brings back the results of run 1.
 runsPanel().onDeleteRun(2);await h.flush();
 assert.deepEqual(h.latest().docs.map(doc=>[doc.status,doc.runNo,doc.earlier]),Array(3).fill(['done',1,undefined]));assert.deepEqual(h.latest().docs.map(doc=>doc.cells),[['POSITIVE'],['NEGATIVE'],['NEGATIVE']],'Labels stay');

 // Switching off from a research tab returns to the Workspace; nothing is lost and nothing research shows.
 page().onValueChange('runs');await h.flush();assert.equal(page().value,'runs');
 const kept=JSON.stringify(h.latest().docs.map(({file,...doc})=>doc));
 toggle().onChange(false);await h.flush();
 assert.equal(page().value,'workspace');assert.deepEqual(tabs(),STUDENT_TABS);assert.deepEqual(parts(),[]);assert.deepEqual(heads(),['Document','Status','Score / category']);
 assert.equal(JSON.stringify(h.latest().docs.map(({file,...doc})=>doc)),kept);assert.deepEqual(h.latest().columns,[{name:'tone_human',role:'label'}],'Labels wait for the next visit to research mode');
 // No key is ever part of what is saved.
 assert(!JSON.stringify(h.writes.map(write=>({...write,docs:write.docs?.map(({file,...doc})=>doc)}))).includes('sk-workflow-test'));assert(h.writes.every(write=>!Object.hasOwn(write,'key')&&!Object.hasOwn(write,'keyring')));

 // Without a key, a run in research mode opens the keys dialog instead of calling a provider.
 const empty=harness({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium'});await empty.flush();
 empty.find(n=>n.type==='ModeSwitch').props.onChange(true);await empty.flush();
 assert.equal(empty.find(n=>n.type==='ResearchKeys').props.open,false);
 await empty.button('Run all').props.onClick();await empty.flush();
 assert.equal(empty.calls.length,0);assert.equal(empty.find(n=>n.type==='ResearchKeys').props.open,true);
 empty.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-tab-only'},false);await empty.flush();
 await empty.button('Annotate next').props.onClick();await empty.flush();
 assert.equal(empty.calls.length,1);assert.deepEqual(empty.latest().docs.map(doc=>doc.status),['done','pending','pending']);

 // The mode is remembered in this browser. Keys are remembered only when asked, and only for research mode.
 const storage=fakeStorage();globalThis.window={localStorage:storage};
 const first=start();await first.flush();
 first.find(n=>n.type==='ModeSwitch').props.onChange(true);await first.flush();
 assert.equal(storage.getItem('text-annotation-lab:mode'),'research');
 first.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-tab-only'},false);await first.flush();
 assert.deepEqual([...storage.items.keys()],['text-annotation-lab:mode'],'Without the checkbox, no key is stored');
 first.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-remember-me',anthropic:' sk-ant-too '},true);await first.flush();
 assert.deepEqual(JSON.parse(storage.getItem('text-annotation-lab:research-keys')),{openai:'sk-remember-me',anthropic:'sk-ant-too'});
 const reopened=start();await reopened.flush();
 assert.equal(reopened.find(n=>n.type==='ModeSwitch').props.on,true,'A reload stays in research mode');
 const keys=reopened.find(n=>n.type==='ResearchKeys').props;assert.deepEqual(keys.keyring,{openai:'sk-remember-me',anthropic:'sk-ant-too'});assert.equal(keys.remember,true);
 keys.onSave({},false);await reopened.flush();assert.equal(storage.getItem('text-annotation-lab:research-keys'),null,'Forget all keys removes them from this browser');
 keys.onSave({openai:'sk-remember-me'},true);await reopened.flush();
 reopened.find(n=>n.type==='ModeSwitch').props.onChange(false);await reopened.flush();
 assert.equal(storage.getItem('text-annotation-lab:mode'),null);
 const student=start();await student.flush();
 assert.equal(student.find(n=>n.type==='ModeSwitch').props.on,false);assert.equal(student.find(n=>n.props?.id==='key').props.value,'','The standard Lab never loads a remembered key');
 assert.deepEqual(student.all(n=>n.type==='TabsTrigger').map(n=>n.props.value),STUDENT_TABS);
 delete globalThis.window;
 console.log('Research mode workspace checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
