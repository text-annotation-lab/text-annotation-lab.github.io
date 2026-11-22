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
const providers=localModule('lib/providers.ts');
function localModule(file){return transpile(file,id=>id.startsWith('.')?localModule(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id));}
const chunkText=localModule('lib/chunk-text.ts');
function harness(initial,save=async()=>{},fetcher=async()=>Response.json({score:'POSITIVE',explanation:'Evidence'}),preparePanel=()=>undefined,props={}){
 const slots=[],effects=[],listeners=new Map(),writes=[],calls=[];let cursor=0,pending=[],dirty=true,tree;
 const react={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;dirty=true;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useMemo(fn,deps){const i=cursor++,slot=slots[i];if(slot&&slot.deps.length===deps.length&&slot.deps.every((d,j)=>Object.is(d,deps[j])))return slot.value;const value=fn();slots[i]={value,deps};return value;},useEffect(fn,deps){const i=cursor++,previous=effects[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}};
 const jsx=(type,props)=>({type,props});
 const storage={restore:async()=>initial,save:async value=>{writes.push(value);return save(value);}};
 const imports=id=>id==='@/lib/own-prices'?{useOwnPrices:()=>({}),ownPrice:()=>undefined}:id==='@/components/reading-panels'?{ReadingPanels:'ReadingPanels',prepareReadingPanel:preparePanel}:id==='@/lib/section-navigation'?{focusSectionWhenReady:()=>()=>{}}:id==='react'?react:id==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:id==='@/lib/annotation-queue'?localModule('lib/annotation-queue.ts'):id==='@/lib/workflow-safety'?localModule('lib/workflow-safety.ts'):id==='@/lib/annotation-feedback'?localModule('lib/annotation-feedback.ts'):id==='@/lib/studies'?localModule('lib/studies.ts'):id==='@/lib/batch-limits'?localModule('lib/batch-limits.ts'):id==='@/lib/providers'?providers:id==='@/lib/workspace-storage'?{createWorkspaceStorage:()=>storage}:id==='@/lib/chunk-text'?chunkText:id==='@/lib/chunk-documents'?localModule('lib/chunk-documents.ts'):id==='@/components/named-answer-detail'?transpile('components/named-answer-detail.tsx',id=>id.startsWith('@/lib/')?localModule(id.slice(2)+'.ts'):require(id)):id==='@/components/provider-key-status'?{useProviderKeyCheck:()=>({check:{status:'unverified'},refresh:()=>{}}),ProviderKeyStatus:'ProviderKeyStatus'}:id.startsWith('@/lib/')&&fs.existsSync(id.slice(2)+'.ts')?localModule(id.slice(2)+'.ts'):new Proxy({},{get:(_,key)=>String(key)});
 const window={scrollTo(){},location:{hash:'',pathname:'/',search:''},history:{replaceState(){},pushState(){}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name)};
 const Home=transpile('app/page.tsx',imports,{window,document:{getElementById:()=>null},requestAnimationFrame:()=>0,cancelAnimationFrame(){},confirm:()=>true,fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options);}}).StudyWorkspace;
 function render(){cursor=0;dirty=false;tree=Home(props);const queue=pending;pending=[];queue.forEach(fn=>fn());}
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
 assert.deepEqual(tabs(),STUDENT_TABS);assert.equal(toggle().on,false);assert.deepEqual(parts(),[]);assert.equal(h.all(n=>n.type==='DetailSteps').length,0);
 assert.equal(h.find(n=>n.props?.id==='key').props.value,'sk-workflow-test');assert.equal(h.find(n=>n.type==='header').props.className,undefined);
 assert.throws(()=>h.button('Remaining'));assert.throws(()=>h.button('All ('));assert.throws(()=>h.button('Random sample of'));assert.equal(h.all(n=>n.props?.role==='radio').length,0);
 await h.button('Run all').props.onClick();await h.flush();
 assert.deepEqual(h.latest().docs.map(doc=>doc.status),['done','done','done']);assert.equal(h.calls.length,3);
 // The standard Lab keeps no record of a request: it does not ask for one, and neither a text nor the workspace holds one.
 assert(h.calls.every(call=>call.options.body.get('record')===null));assert(h.latest().docs.every(doc=>['requestId','modelReported','stopReason','output','lab'].every(key=>!(key in doc))));assert(!('requests' in h.latest())||h.latest().requests===undefined);
 assert.deepEqual(heads(),['Document','Status','Score / category'],'The standard results table has no research columns');
 // Results made in the standard Lab already belong to run 1, so research mode can pick them up.
 assert.deepEqual(h.latest().docs.map(doc=>doc.runNo),[1,1,1]);assert.equal(h.latest().runs.length,1);assert.equal(h.latest().runs[0].prompt,'Classify tone');assert(!('scope' in h.latest().runs[0]),'The standard Lab records no scope');
 const before=JSON.stringify(h.latest().docs.map(({file,...doc})=>doc));

 // Switching on: other tabs and tools, the same texts and results.
 toggle().onChange(true);await h.flush();
 assert.equal(toggle().on,true);assert.deepEqual(tabs(),RESEARCH_TABS);assert.equal(h.find(n=>n.type==='header').props.className,'research-header');
 assert.deepEqual(parts(),RESEARCH_PARTS);
 assert.throws(()=>h.find(n=>n.props?.id==='key'),'Keys are entered in the header in research mode');
 assert.deepEqual(h.find(n=>n.type==='ResearchKeys').props.keyring,{openai:'sk-workflow-test'},'A key typed before switching is carried along');
 assert.equal(JSON.stringify(h.latest().docs.map(({file,...doc})=>doc)),before);
 assert.deepEqual(heads(),['','Document','Status','Score / category','Run']);
 // The details of a text: Previous and Next with its place among the texts, and what the technical details need of the study.
 {const steps=()=>h.find(n=>n.type==='DetailSteps').props,detail=()=>h.find(n=>n.type==='ResearchDetail').props,region=()=>h.find(n=>n.props?.id==='annotation-detail').props;
  assert.equal(steps().total,3);assert.equal(detail().row.id,String(steps().index));assert.equal(detail().study.kind,'texts');assert.deepEqual([...detail().study.versions],[[1,1]]);assert.equal(typeof region().onKeyDown,'function');
  steps().onStep(0);await h.flush();assert.equal(steps().index,0);assert.equal(detail().row.id,'0');
  steps().onStep(2);await h.flush();assert.equal(steps().index,2);assert.equal(detail().row.id,'2');
  steps().onStep(3);await h.flush();assert.equal(steps().index,2,'There is no text after the last');}
 const runsPanel=()=>h.find(n=>n.type==='ResearchRuns').props;
 const page=()=>h.find(n=>n.type==='Tabs').props;
 page().onValueChange('runs');await h.flush();assert.equal(page().value,'runs');
 assert.equal(runsPanel().datasets[0].kind,'texts');assert.equal(runsPanel().datasets[0].rows.length,3);assert.equal(runsPanel().datasets[0].runs.length,1);assert.equal(runsPanel().datasets[1].kind,'knowledge');
 page().onValueChange('workspace');await h.flush();
 const main=()=>h.text(h.find(n=>n.type==='main'));
 for(const coaching of ['Test it on a varied sample','Select a row to compare','Add a few documents, then annotate'])assert(!main().includes(coaching),coaching);

 // The standard Lab's run buttons give way to All and Remaining, and Now or Batch sits beside them instead of under Processing options.
 assert.throws(()=>h.button('Run all'));assert.throws(()=>h.button('Submit batch'));assert(!main().includes('TRY')&&!main().includes('RUN'));
 const modes=()=>h.all(n=>n.type==='button'&&n.props.role==='radio');
 assert.deepEqual(modes().map(n=>[h.text(n),n.props['aria-checked']]),[['Now',true],['Batch · ½ price',false]]);
 modes()[1].props.onClick();await h.flush();assert.equal(h.latest().processing,'batch');assert.equal(modes()[1].props['aria-checked'],true);assert(main().includes('results usually arrive within 24 hours')&&main().includes('Batch limits'));
 modes()[0].props.onClick();await h.flush();assert.equal(h.latest().processing,'instant');assert(!main().includes('Results arrive later'));
 h.button('Processing options').props.onClick();await h.flush();assert.throws(()=>h.find(n=>n.props?.id==='processing-mode'));h.find(n=>n.props?.id==='annotation-concurrency');h.button('Processing options').props.onClick();await h.flush();
 // All: a second run; the first results are kept. No text remains: the standard Lab sends the answer fields as
 // research mode does, so its results count as made with the current settings.
 assert(h.text(h.button('All (')).includes('All (3)'));assert(h.text(h.button('Remaining')).includes('Remaining (0)'));assert.equal(h.button('Remaining').props.disabled,true);
 await h.button('All (').props.onClick();await h.flush();
 assert.equal(h.calls.length,6);assert.deepEqual(h.latest().docs.map(doc=>[doc.status,doc.runNo,doc.earlier.length,doc.earlier[0].runNo,doc.earlier[0].score]),Array(3).fill(['done',2,1,1,'POSITIVE']));
 assert.deepEqual(h.latest().runs.map(run=>run.number),[1,2]);
 // Research mode records the request of every result, once for the run, with marks where the text goes, and the build of the Lab.
 assert(h.calls.slice(3).every(call=>call.options.body.get('record')==='true'));
 assert.deepEqual(h.latest().requests.map(request=>[request.id,request.url]),[['q1','https://api.openai.com/v1/responses']]);
 {const body=JSON.parse(h.latest().requests[0].body);assert.equal(body.model,providers.defaultModel('openai'));assert.equal(body.instructions,undefined);const words=body.input[0].content.map(part=>part.text).join('');assert(words.startsWith('Classify tone'));assert(words.endsWith('\n\n<text>\n<<DOCUMENT_TEXT>>\n</text>'));assert(!words.includes('DOCUMENT_FILENAME'));}
 assert(h.latest().docs.every(doc=>doc.requestId==='q1'&&doc.lab==='development'&&!('requestId' in doc.earlier[0])),'The earlier, standard run stays without a record');
 assert(h.latest().docs.every(doc=>doc.layout==='message')&&h.latest().runs.every(run=>run.layout==='message'),'Results and runs record the layout they were sent in');
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
 assert(h.text(h.button('All (')).includes('All (2)'));assert(main().includes('The run buttons apply to the 2 shown texts.'));
 filters().onChange({...filters().view,show:'all',compare:''});await h.flush();
 // Research mode keeps one row of run buttons: the clearing actions are in the menu on the line above the table.
 assert.equal(h.all(n=>n.type==='div'&&n.props.className==='clear-actions').length,0);
 assert.deepEqual(h.find(n=>n.type==='ResultPages'||n.type?.name==='ResultPages').props.extra.props.items.map(item=>[item.label,Boolean(item.danger),Boolean(item.disabled)]),[['Delete selected texts…',true,true],['Delete all texts…',true,false]]);
 assert.equal(filters().actions,undefined,'research mode has no chart or Excel button above the table: the Results panel and the Export tab have them');

 // Deleting run 2 brings back the results of run 1.
 runsPanel().onDeleteRun(2);await h.flush();
 assert.equal(h.latest().requests,undefined,'A request that no result names any longer is dropped');assert(h.latest().docs.every(doc=>!('requestId' in doc)));
 assert.deepEqual(h.latest().docs.map(doc=>[doc.status,doc.runNo,doc.earlier]),Array(3).fill(['done',1,undefined]));assert.deepEqual(h.latest().docs.map(doc=>doc.cells),[['POSITIVE'],['NEGATIVE'],['NEGATIVE']],'Labels stay');

 // Remaining: the texts with no result from the current settings. A changed prompt leaves all three; they become a new run and the old results are kept.
 const setPrompt=async value=>{h.find(n=>n.props?.id==='prompt').props.onChange({target:{value}});await h.flush();};
 await setPrompt('Classify tone again');
 // The cost calculator sits first in the row of tools, and its estimate covers what Remaining would annotate.
 const estimate=()=>h.find(n=>n.type==='ResearchTools').props.lead.props;
 assert.equal(h.all(n=>n.props?.revision).length,0);assert.equal(estimate().research,true);assert.deepEqual(JSON.parse(estimate().revision).at(-1),['0','1','2']);
 assert(h.text(h.button('Remaining')).includes('Remaining (3)'));assert(h.text(h.button('All (')).includes('All (3)'));
 const callsBefore=h.calls.length;await h.button('Remaining').props.onClick();await h.flush();
 assert.equal(h.calls.length,callsBefore+3);assert.deepEqual(h.latest().docs.map(doc=>[doc.status,doc.runNo,doc.prompt,doc.earlier.map(entry=>entry.runNo)]),Array(3).fill(['done',3,'Classify tone again',[1]]));
 assert.equal(h.latest().requests.length,1);assert(JSON.parse(h.latest().requests[0].body).input[0].content[0].text.startsWith('Classify tone again'));assert(h.latest().docs.every(doc=>doc.requestId===h.latest().requests[0].id));
 assert(h.text(h.button('Remaining')).includes('Remaining (0)'));
 // Back at the first prompt no text remains: each has a result from that prompt, made in the standard Lab.
 await setPrompt('Classify tone');assert(h.text(h.button('Remaining')).includes('Remaining (0)'));

 // Switching off from a research tab returns to the Workspace; nothing is lost and nothing research shows.
 page().onValueChange('runs');await h.flush();assert.equal(page().value,'runs');
 const kept=JSON.stringify(h.latest().docs.map(({file,...doc})=>doc));
 toggle().onChange(false);await h.flush();
 assert.equal(page().value,'workspace');assert.deepEqual(tabs(),STUDENT_TABS);assert.deepEqual(parts(),[]);assert.equal(h.all(n=>n.type==='DetailSteps').length,1,'Previous and Next in both modes');assert.equal(typeof h.find(n=>n.props?.id==='annotation-detail').props.onKeyDown,'function');assert.equal(h.all(n=>n.type==='ResearchDetail').length,0);assert.equal(h.all(n=>n.props?.revision).length,1,'The standard Lab keeps its cost calculator under the run buttons');assert.equal(JSON.parse(h.find(n=>n.props?.revision).props.revision).at(-1),0);assert.deepEqual(heads(),['Document','Status','Score / category']);
 assert.equal(JSON.stringify(h.latest().docs.map(({file,...doc})=>doc)),kept);assert.deepEqual(h.latest().columns,[{name:'tone_human',role:'label'}],'Labels wait for the next visit to research mode');
 // No key is ever part of what is saved.
 assert(!JSON.stringify(h.writes.map(write=>({...write,docs:write.docs?.map(({file,...doc})=>doc)}))).includes('sk-workflow-test'));assert(h.writes.every(write=>!Object.hasOwn(write,'key')&&!Object.hasOwn(write,'keyring')));

 // A whole corpus as a table, and pasted text: research mode only.
 const corpus=start();await corpus.flush();await corpus.configure();
 const dropzone=()=>corpus.find(n=>n.type==='input'&&n.props.type==='file').props,corpusMain=()=>corpus.text(corpus.find(n=>n.type==='main'));
 assert.equal(dropzone().accept,'.txt,.md,.pdf,.docx,.html,.htm,.rtf');assert(corpusMain().includes('Upload one file per text you want to annotate.'));
 await corpus.add([new File(['id,text\na,Hello'],'corpus.csv')]);
 assert.equal(corpus.latest().docs.length,3,'The standard Lab does not take tables');
 corpus.find(n=>n.type==='ModeSwitch').props.onChange(true);await corpus.flush();
 const corpusTools=()=>corpus.find(n=>n.type==='ResearchTools').props;
 assert(dropzone().accept.endsWith('.rtf,.csv,.tsv,.xlsx,.json,.jsonl'));assert(corpusMain().includes('or a whole corpus as a table (CSV, TSV, XLSX, JSON, JSONL)'));
 assert.equal(corpusTools().tableFile,undefined);
 // A table waits for the import dialog; a file chosen with it is added as a document as usual.
 await corpus.add([new File(['id,text\na,Hello'],'corpus.csv'),new File(['Plain'],'plain.txt')]);
 assert.equal(corpusTools().tableFile.name,'corpus.csv');assert.deepEqual(corpus.latest().docs.map(doc=>doc.name),['text-0.txt','text-1.txt','text-2.txt','plain.txt']);
 // Its rows join the study as plain-text documents, with the other columns as labels or metadata.
 assert.equal(corpusTools().onAddTexts([{name:'a.txt',text:'Hello',values:['1961','POSITIVE']}],['year','tone_human'],'1 text added from corpus.csv.'),true);corpusTools().onTableDone();await corpus.flush();
 assert.equal(corpusTools().tableFile,undefined);
 const fromTable=corpus.latest().docs.at(-1);
 assert.deepEqual([corpus.latest().docs.length,fromTable.name,fromTable.status,fromTable.file.name,fromTable.file.type,fromTable.cells],[5,'a.txt','pending','a.txt','text/plain',['1961','POSITIVE']]);assert.equal(await fromTable.file.text(),'Hello');
 assert.deepEqual(corpus.latest().columns,[{name:'year',role:'meta'},{name:'tone_human',role:'label'}]);assert(corpusMain().includes('1 text added from corpus.csv.'));
 assert.equal(corpusTools().onAddTexts([],[],''),false);
 // The new text is annotated like any other.
 const callsWith=corpus.calls.length;await corpus.button('Remaining').props.onClick();await corpus.flush();
 assert.equal(corpus.calls.length,callsWith+5);assert.equal(corpus.calls.at(-1).options.body.get('file').name,'a.txt');assert.deepEqual(corpus.latest().docs.map(doc=>doc.status),Array(5).fill('done'));

 // Without a key, a run in research mode opens the keys dialog instead of calling a provider.
 const empty=harness({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium'});await empty.flush();
 empty.find(n=>n.type==='ModeSwitch').props.onChange(true);await empty.flush();
 assert.equal(empty.find(n=>n.type==='ResearchKeys').props.open,false);
 assert(empty.text(empty.button('Remaining')).includes('Remaining (3)'));await empty.button('Remaining').props.onClick();await empty.flush();
 assert.equal(empty.calls.length,0);assert.equal(empty.find(n=>n.type==='ResearchKeys').props.open,true);
 empty.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-tab-only'},false);await empty.flush();
 await empty.button('Annotate next').props.onClick();await empty.flush();
 assert.equal(empty.calls.length,1);assert.deepEqual(empty.latest().docs.map(doc=>doc.status),['done','pending','pending']);

 // Typed answer fields: research mode's editor, what a request carries, what a result records, and the standard Lab's view.
 {
  const replies=[];
  const typed=harness({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1},async()=>{},async()=>Response.json(replies.shift()||{score:'',explanation:'',answers:{f0:'positive',f1:'Dry.'}}));
  await typed.flush();await typed.configure();
  const mode=()=>typed.find(n=>n.type==='ModeSwitch').props,editor=()=>typed.find(n=>n.type==='ResearchAnswerFields').props,notes=()=>typed.all(n=>n.type==='p'&&n.props.role==='note').map(n=>typed.text(n));
  assert.deepEqual(editor().names,[],'Both modes have the same answer fields');assert.equal(editor().onScaleChange,undefined,'The scale of the scores is for the statistics of research mode');assert.deepEqual(notes(),[]);
  mode().onChange(true);await typed.flush();
  assert.deepEqual(editor().names,[]);assert.equal(editor().settings,undefined);
  const tone={name:'Tone',type:'category',values:['positive','negative'],description:'Overall tone.'},asked={rationale:false,fields:[tone,{name:'Notes',type:'text',values:[],description:''}]},sentForm={rationale:false,named:true,slugKeys:true,fields:[tone]};
  editor().onChange(['Tone','Notes'],asked);await typed.flush();
  assert.deepEqual(typed.latest().answerFields,['Tone','Notes']);assert.deepEqual(typed.latest().answerSettings,asked,'The study keeps the fields as they were entered');assert.deepEqual(editor().settings,asked);
  await typed.button('All (').props.onClick();await typed.flush();
  assert.equal(typed.calls.length,3);const form=typed.calls.at(-1).options.body;
  assert.equal(form.get('answerFields'),JSON.stringify(['Tone','Notes']));assert.equal(form.get('answerSettings'),JSON.stringify(sentForm),'A request carries only what differs from the standard format');
  assert.deepEqual(typed.latest().docs.map(doc=>[doc.status,doc.runNo,doc.answers.f0,JSON.stringify(doc.answerSettings)]),Array(3).fill(['done',1,'positive',JSON.stringify(sentForm)]));
  assert.deepEqual(typed.latest().runs.map(run=>[run.number,JSON.stringify(run.answerSettings)]),[[1,JSON.stringify(sentForm)]]);
  assert.deepEqual(typed.find(n=>n.type==='ResearchTools').props.fields,['Tone','Notes'],'A spreadsheet column named after an answer field is guessed to hold human labels');
  assert(typed.text(typed.button('Remaining')).includes('Remaining (0)'));
  // Asking for an explanation again is another setup: every text remains, and they form a new run.
  editor().onChange(['Tone','Notes'],{fields:asked.fields});await typed.flush();
  assert(typed.text(typed.button('Remaining')).includes('Remaining (3)'));
  replies.push(...Array(3).fill({score:'',explanation:'Hopeful wording.',answers:{f0:'negative',f1:'Dry.'}}));
  await typed.button('Remaining').props.onClick();await typed.flush();
  assert.deepEqual(typed.latest().docs.map(doc=>[doc.runNo,doc.answers.f0,JSON.stringify(doc.answerSettings),doc.earlier.map(entry=>[entry.runNo,JSON.stringify(entry.answerSettings)])]),Array(3).fill([2,'negative',JSON.stringify({named:true,slugKeys:true,fields:[tone]}),[[1,JSON.stringify(sentForm)]]]));
  assert.deepEqual(typed.latest().runs.map(run=>run.number),[1,2]);
  // Plain text: one field named “response”, and no settings of the fields are sent.
  editor().onChange(['Tone','Notes'],{...asked,plain:true});await typed.flush();
  assert.deepEqual(typed.latest().answerSettings,{...asked,plain:true},'The fields are kept while plain text is on');
  replies.push(...Array(3).fill({score:'',explanation:'',answers:{f0:'The tone is hopeful.'}}));
  await typed.button('Remaining').props.onClick();await typed.flush();
  const plainForm=typed.calls.at(-1).options.body;assert.equal(plainForm.get('answerFields'),JSON.stringify(['response']));assert.equal(plainForm.get('answerSettings'),JSON.stringify({plain:true}));
  assert.deepEqual(typed.latest().docs.map(doc=>[doc.runNo,doc.answerFields,doc.answers]),Array(3).fill([3,['response'],{f0:'The tone is hopeful.'}]));
  assert(typed.all(n=>n.type==='TableHead').map(n=>typed.text(n)).includes('response'),'The reply is the table’s one answer column');
  // The scale of the scores: kept with the study and read by Runs & agreement and the exports; never sent.
  assert.equal(editor().scale,undefined);editor().onScaleChange({min:-3,max:3});await typed.flush();
  assert.deepEqual(typed.latest().scoreScale,{min:-3,max:3});assert.deepEqual(editor().scale,{min:-3,max:3});
  typed.find(n=>n.type==='Tabs').props.onValueChange('runs');await typed.flush();
  assert.deepEqual(typed.find(n=>n.type==='ResearchRuns').props.datasets[0].scoreScale,{min:-3,max:3});
  typed.find(n=>n.type==='Tabs').props.onValueChange('workspace');await typed.flush();
  replies.push({score:'',explanation:'',answers:{f0:'{"tone":2}'}});
  const sentBefore=typed.calls.length;typed.find(n=>n.type==='ResearchFilters').props.onClearChecked?.();await typed.button('All (').props.onClick();await typed.flush();
  assert(typed.calls.length>sentBefore,'A run was sent');
  assert(typed.calls.slice(sentBefore).every(call=>!String(call.options.body.get('answerSettings')).includes('-3')&&![...call.options.body.keys()].some(key=>/scale/i.test(key))),'The scale is not sent');
  editor().onScaleChange(undefined);await typed.flush();assert(!('scoreScale' in typed.latest()));
  // The standard Lab shows the same fields and settings, without the scale.
  mode().onChange(false);await typed.flush();
  assert.deepEqual(notes(),[]);assert.deepEqual(editor().settings,{...asked,plain:true});assert.equal(editor().onScaleChange,undefined);
  editor().onChange(['Notes'],{rationale:false,fields:[{name:'Notes',type:'text',values:[],description:''}]});await typed.flush();
  assert.deepEqual(typed.latest().answerFields,['Notes']);assert.deepEqual(typed.latest().answerSettings,{rationale:false,fields:[{name:'Notes',type:'text',values:[],description:''}]});
 }

 // More annotations at once, and a run that paces itself on rate limits: research mode only.
 {
  const limited=(wait=1)=>Response.json({error:'OpenAI reports a rate limit.',retryAfterMs:wait},{status:429}),fine=()=>Response.json({score:'POSITIVE',explanation:'Evidence'});
  const study=()=>({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:128});
  // The waits are real time here: a quarter of a second after the provider's own.
  const until=async(h,ready)=>{for(let n=0;n<200&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const controls=h=>({select:()=>h.find(n=>n.props?.id==='annotation-concurrency').props,choices:()=>h.find(n=>n.props?.id==='annotation-concurrency').props.children.map(option=>option.props.value),summary:()=>h.text(h.button('Processing options')),help:()=>h.text(h.find(n=>n.props?.id==='parallel-help')),statuses:()=>h.latest().docs.map(doc=>doc.status)});
  // The standard Lab: 1, 2, and 4; a study set to more runs one at a time, and a rate limit is waited out as in research mode.
  let replies=[limited];
  const plain=harness(study(),async()=>{},async()=>(replies.shift()||fine)());await plain.flush();await plain.configure();
  let c=controls(plain);plain.button('Processing options').props.onClick();await plain.flush();
  assert.deepEqual(c.choices(),[1,2,4]);assert.equal(c.select().value,1);assert(c.summary().includes('Instant · one at a time'));assert.throws(()=>c.help(),'No fixed line under the setting');{const info=plain.find(n=>n.props?.topic==='parallel').props.text;assert(info[0].startsWith('Run all can annotate several texts at once.'));assert(!info[0].includes('128'));}
  plain.button('Run all').props.onClick();await plain.flush();await until(plain,()=>c.statuses().every(status=>status==='done'));
  assert.equal(plain.calls.length,4,'The refused request is sent again after the wait');assert.equal(plain.latest().docs[0].concurrency,1);
  assert.equal(plain.latest().concurrency,128,'The study keeps its own setting');
  // Research mode: up to 128, and the study's setting applies.
  plain.find(n=>n.type==='ModeSwitch').props.onChange(true);await plain.flush();
  assert.deepEqual(c.choices(),[1,2,4,8,16,32,64,128]);assert.equal(c.select().value,128);assert(c.summary().includes('Instant · 128 at a time'));
  assert.throws(()=>c.help(),'Research mode has no fixed line under the setting');assert.throws(()=>plain.find(n=>n.props?.topic==='parallel'),'nor an ⓘ: researchers know what parallel requests are');
  c.select().onChange({target:{value:'16'}});await plain.flush();assert.equal(plain.latest().concurrency,16);assert.equal(c.select().value,16);
  c.select().onChange({target:{value:'100'}});await plain.flush();assert.equal(plain.latest().concurrency,1,'Only the offered numbers are taken');
  c.select().onChange({target:{value:'64'}});await plain.flush();
  plain.find(n=>n.type==='ModeSwitch').props.onChange(false);await plain.flush();
  assert.deepEqual(c.choices(),[1,2,4]);assert.equal(c.select().value,1);assert.equal(plain.latest().concurrency,64);
  c.select().onChange({target:{value:'2'}});await plain.flush();assert.equal(plain.latest().concurrency,2);assert.equal(c.select().value,2);

  // A refused request is sent again after the wait, and the run goes on.
  replies=[limited];
  const paced=harness(study(),async()=>{},async()=>(replies.shift()||fine)());await paced.flush();
  paced.find(n=>n.type==='ModeSwitch').props.onChange(true);await paced.flush();paced.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-paced'},false);await paced.flush();
  c=controls(paced);
  paced.button('Remaining').props.onClick();await paced.flush();
  assert.deepEqual(c.statuses(),['running','done','done'],'The refused text waits while the others finish');assert.equal(paced.calls.length,3);
  await until(paced,()=>c.statuses().every(status=>status==='done'));assert.equal(paced.calls.length,4,'Three texts and one request sent again');
  assert(paced.latest().docs.every(doc=>doc.concurrency===128&&doc.error===undefined&&doc.runNo===1));
  const notice=paced.all(n=>n.props?.role==='status'&&String(n.props.className).startsWith('message')).map(n=>paced.text(n)).join(' ');
  assert.match(notice,/the provider reported a rate limit: a pause of about 1 second, then up to one text at a time, rising again as requests get through\./);
  assert(paced.all(n=>n.props?.role==='status'&&n.props.className==='message info').length===1,'The note is information, not a warning');

  // Paused during the wait: the refused text was not annotated and waits as before; the others finish.
  replies=[()=>limited(600)];
  const held=harness(study(),async()=>{},async()=>(replies.shift()||fine)());await held.flush();
  held.find(n=>n.type==='ModeSwitch').props.onChange(true);await held.flush();held.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-paced'},false);await held.flush();
  c=controls(held);
  held.button('Remaining').props.onClick();await held.flush();
  assert.deepEqual(c.statuses(),['running','done','done']);
  held.button('Pause').props.onClick();await until(held,()=>c.statuses()[0]==='pending');
  assert.deepEqual(c.statuses(),['pending','done','done']);assert.equal(held.calls.length,3,'Nothing is sent after a pause');
  const waiting=held.latest().docs[0];assert.equal(waiting.error,undefined);assert.equal(waiting.startedAt,undefined);assert.equal(waiting.concurrency,undefined);
  // The pause is reported once the run has wound down (under load, a moment after the text is back in the queue).
  await until(held,()=>held.all(n=>n.props?.role==='status').some(n=>held.text(n).includes('Paused. Active annotations have finished; completed results are kept.')));
  assert(held.text(held.button('Remaining')).includes('Remaining (1)'));held.button('Remaining').props.onClick();await until(held,()=>c.statuses().every(status=>status==='done'));
  assert.equal(held.calls.length,4);

  // A limit that does not pass: after eight sends the text fails with the provider's message, and the run stops.
  const stuck=harness({...study(),docs:documents().slice(0,1)},async()=>{},async()=>limited(1));await stuck.flush();
  stuck.find(n=>n.type==='ModeSwitch').props.onChange(true);await stuck.flush();stuck.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-paced'},false);await stuck.flush();
  stuck.button('Remaining').props.onClick();await until(stuck,()=>stuck.latest()?.docs[0].status==='error');
  assert.equal(stuck.calls.length,8);assert.equal(stuck.latest().docs[0].status,'error');assert.equal(stuck.latest().docs[0].error,'OpenAI reports a rate limit.');
 }

 // When a text fails, research mode marks it and carries on. A failure every request would meet (the reply marks
 // it `shared`) stops the run once the first three requests, for at least two texts, all failed that way.
 {
  const until=async(h,ready)=>{for(let n=0;n<200&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const five=extra=>({docs:Array.from({length:5},(_,i)=>({id:String(i),name:`text-${i}.txt`,file:new File([`Text ${i}`],`text-${i}.txt`),status:'pending'})),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1,...extra});
  const research=async h=>{await h.flush();h.find(n=>n.type==='ModeSwitch').props.onChange(true);await h.flush();h.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-carry'},false);await h.flush();};
  const notices=h=>h.all(n=>n.props?.role==='alert'||n.props?.role==='status').map(n=>h.text(n)),statuses=h=>(h.latest()?.docs||[]).map(doc=>doc.status),ended=h=>()=>Boolean(h.latest())&&!h.latest().docs.some(doc=>doc.status==='running')&&h.all(n=>['Button','button'].includes(n.type)&&h.text(n).trim()==='Pause').length===0;
  const fine=()=>Response.json({score:'POSITIVE',explanation:'Evidence'}),refusal=()=>Response.json({error:'OpenAI rejected the API key.',shared:'account'},{status:401}),named=options=>options.body.get('file').name;
  // A failure about one text: the others are annotated, the notice counts it, and "Remaining" sends it again.
  let failing=true;const one=harness(five(),async()=>{},async(url,options)=>failing&&named(options)==='text-1.txt'?Response.json({error:'OpenAI reports that the input is too large.'},{status:413}):fine());
  await research(one);one.button('Remaining').props.onClick();await until(one,()=>one.latest()?.docs[4].status==='done');await until(one,ended(one));
  assert.equal(one.calls.length,5);assert.deepEqual(statuses(one),['done','error','done','done','done']);assert.equal(one.latest().docs[1].error,'OpenAI reports that the input is too large.');
  assert(notices(one).includes('1 of 5 requests failed, and the run carried on. “Remaining” sends it again.'),notices(one).join(' | '));
  assert(one.text(one.button('Remaining')).includes('Remaining (1)'));failing=false;one.button('Remaining').props.onClick();await until(one,()=>one.latest().docs[1].status==='done');await until(one,ended(one));
  assert.equal(one.calls.length,6);assert.deepEqual(one.latest().docs.map(doc=>doc.runNo),[1,1,1,1,1],'The text sent again joins the same run');assert.equal(one.latest().docs[1].history.length,1);
  // Every request fails the same way: three requests, and the rest of the texts wait.
  const refused=harness(five(),async()=>{},async()=>refusal());
  await research(refused);refused.button('Remaining').props.onClick();await until(refused,()=>notices(refused).some(text=>text.startsWith('Stopped:')));await until(refused,ended(refused));
  assert.equal(refused.calls.length,3);assert.deepEqual(statuses(refused),['error','error','error','pending','pending']);
  assert(notices(refused).includes('Stopped: the first 3 requests all failed the same way, which points to the settings or the account rather than the texts. Requests under way will finish, and completed results are kept. See the error of a failed text before running again.'));
  assert(!JSON.stringify(refused.latest().docs.map(({file,...doc})=>doc)).includes('"shared"'),'The mark is never kept with a result');
  // No connection: the notice names it.
  const offline=harness(five(),async()=>{},async()=>Response.json({error:'Connection interrupted.',shared:'connection'},{status:502}));
  await research(offline);offline.button('Remaining').props.onClick();await until(offline,()=>notices(offline).some(text=>text.startsWith('Stopped:')));await until(offline,ended(offline));
  assert.equal(offline.calls.length,3);assert(notices(offline).some(text=>text.startsWith('Stopped: the first 3 requests all failed the same way, which points to the connection rather than the texts.')));
  // A reply without a mark is not read for one, whatever its message says (here: a timeout, which the route does not mark).
  const timed=harness(five(),async()=>{},async()=>Response.json({error:'Connection interrupted. Check your provider’s usage before retrying; the request may have completed.'},{status:502}));
  await research(timed);timed.button('Remaining').props.onClick();await until(timed,()=>statuses(timed).every(status=>status==='error'));await until(timed,ended(timed));
  assert.equal(timed.calls.length,5);assert(notices(timed).includes('All 5 requests failed. “Remaining” sends them again.'));
  // A request that never got as far as a reply (the page itself is offline): the connection.
  const unsent=harness(five(),async()=>{},async()=>{throw new TypeError('Failed to fetch');});
  await research(unsent);unsent.button('Remaining').props.onClick();await until(unsent,()=>notices(unsent).some(text=>text.startsWith('Stopped:')));await until(unsent,ended(unsent));
  assert.equal(unsent.calls.length,3);assert(notices(unsent).some(text=>text.includes('which points to the connection rather than the texts.')));
  // An HTTP 400 counts only when it repeats with the same message: two different ones do not stop a run.
  let at=0;const varied=harness(five(),async()=>{},async()=>Response.json({error:'OpenAI rejected the request.',shared:'same:'+(at++%2?'aaaaaaaa':'bbbbbbbb')},{status:400}));
  await research(varied);varied.button('Remaining').props.onClick();await until(varied,()=>statuses(varied).every(status=>status==='error'));await until(varied,ended(varied));
  assert.equal(varied.calls.length,5);assert(notices(varied).includes('All 5 requests failed. “Remaining” sends them again.'));
  // One result among the first requests, then the key stops working: three failures in a row stop the run.
  at=0;const mixed=harness(five(),async()=>{},async()=>at++===0?fine():refusal());
  await research(mixed);mixed.button('Remaining').props.onClick();await until(mixed,()=>statuses(mixed).filter(status=>status==='error').length===3);await until(mixed,ended(mixed));
  assert.equal(mixed.calls.length,4);assert(notices(mixed).some(text=>text.startsWith('Stopped: the last 3 requests failed for the account')));
  // A failure about one text between them starts the count again, and the run goes through.
  at=0;const between=harness(five(),async()=>{},async()=>{at++;return at===1?fine():at===3?Response.json({error:'Too long.'},{status:400}):refusal();});
  await research(between);between.button('Remaining').props.onClick();await until(between,()=>statuses(between).join()==='done,error,error,error,error');await until(between,ended(between));
  assert.equal(between.calls.length,5);assert(notices(between).includes('4 of 5 requests failed, and the run carried on. “Remaining” sends them again.'));
  // Several annotations of one text never stop a run: three failures of the first text, and the second text is still sent.
  const repeated=harness(five({repeats:3}),async()=>{},async()=>refusal());
  await research(repeated);repeated.button('Remaining').props.onClick();await until(repeated,()=>notices(repeated).some(text=>text.startsWith('Stopped:')));await until(repeated,ended(repeated));
  assert.equal(repeated.calls.length,4);assert.deepEqual(statuses(repeated),['error','error','pending','pending','pending']);assert(notices(repeated).some(text=>text.startsWith('Stopped: the first 4 requests all failed the same way')));
  // Several at once: the requests under way when the run stops finish and are kept.
  const many=harness(five({concurrency:4}),async()=>{},async()=>refusal());
  await research(many);many.button('Remaining').props.onClick();await until(many,()=>notices(many).some(text=>text.startsWith('Stopped:')));await until(many,ended(many));
  assert(many.calls.length>=3&&many.calls.length<=4,String(many.calls.length));assert.equal(statuses(many).filter(status=>status==='error').length,many.calls.length);assert.equal(statuses(many).at(-1),'pending');
  // "Annotate next" sends one request and says that it failed.
  const next=harness(five(),async()=>{},async()=>refusal());
  await research(next);next.button('Annotate next').props.onClick();await until(next,()=>statuses(next)[0]==='error');await until(next,ended(next));
  assert.equal(next.calls.length,1);assert(notices(next).includes('The request failed. “Remaining” sends it again.'));
  // The standard Lab does the same: it stops once the first three requests all failed the same way.
  const first=harness(five(),async()=>{},async()=>refusal());await first.flush();first.find(n=>n.props?.id==='key').props.onChange({target:{value:'sk-first'}});await first.flush();
  await first.button('Run all').props.onClick();await first.flush();
  assert.equal(first.calls.length,3);assert.deepEqual(statuses(first),['error','error','error','pending','pending']);assert(!('shared' in first.latest().docs[0]));
  assert(notices(first).some(text=>text.startsWith('Stopped: the first 3 requests all failed the same way')));
 }

 // The runs table: the run buttons name what each start covered, a run can be named, and "Retry failed" sends the
 // requests of a run without a usable answer again, with the settings of that run, and the answers join it.
 {
  const until=async(h,ready)=>{for(let n=0;n<300&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const five=extra=>({docs:Array.from({length:5},(_,i)=>({id:String(i),name:`text-${i}.txt`,file:new File([`Text ${i}`],`text-${i}.txt`),status:'pending'})),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1,...extra});
  const research=async h=>{await h.flush();h.find(n=>n.type==='ModeSwitch').props.onChange(true);await h.flush();h.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-runs'},false);await h.flush();};
  const notices=h=>h.all(n=>n.props?.role==='alert'||n.props?.role==='status').map(n=>h.text(n)),statuses=h=>(h.latest()?.docs||[]).map(doc=>doc.status),ended=h=>()=>Boolean(h.latest())&&!h.latest().docs.some(doc=>doc.status==='running')&&h.all(n=>['Button','button'].includes(n.type)&&h.text(n).trim()==='Pause').length===0;
  const fine=()=>Response.json({score:'POSITIVE',explanation:'Evidence'}),named=options=>options.body.get('file').name;
  const tab=(h,value)=>{h.find(n=>n.type==='Tabs').props.onValueChange(value);return h.flush();},panel=h=>h.find(n=>n.type==='ResearchRuns').props;
  const setPrompt=async(h,value)=>{h.find(n=>n.props?.id==='prompt').props.onChange({target:{value}});await h.flush();};
  let failing=new Set(['text-1.txt','text-3.txt']);
  const h=harness(five(),async()=>{},async(url,options)=>failing.has(named(options))?Response.json({error:'The reply was cut off.'},{status:422}):fine());
  // (Each wait names the state the run ends in: until the page has saved the run's start, the last save shows none running.)
  const settled=(h,run)=>()=>Boolean(h.latest())&&h.latest().docs.every(doc=>doc.runNo===run&&(doc.status==='done'||doc.status==='error'));
  await research(h);await h.button('All (').props.onClick();await until(h,settled(h,1));await until(h,ended(h));
  assert.deepEqual(statuses(h),['done','error','done','error','done']);assert.equal(h.latest().runs[0].scope,'All texts (5)');
  // A label, trimmed; an empty one takes it away.
  await tab(h,'runs');panel(h).onRenameRun(1,'  Pilot run ');await h.flush();assert.equal(h.latest().runs[0].label,'Pilot run');
  panel(h).onRenameRun(1,'');await h.flush();assert(!('label' in h.latest().runs[0]));panel(h).onRenameRun(1,'Pilot');await h.flush();
  // The prompt in the box has changed since; the retry still sends the run's own.
  await tab(h,'workspace');await setPrompt(h,'Classify mood');await tab(h,'runs');
  failing=new Set();const before=h.calls.length;panel(h).onRetryRun(1);
  await until(h,()=>statuses(h).every(status=>status==='done'));await until(h,ended(h));
  assert.equal(h.calls.length,before+2);assert(h.calls.slice(before).every(call=>call.options.body.get('prompt')==='Classify tone'),'The run’s own prompt, not the one in the box');
  assert.deepEqual(h.latest().docs.map(doc=>doc.runNo),[1,1,1,1,1],'The answers join the run');assert.equal(h.latest().runs.length,1,'No new run');
  assert.deepEqual(h.latest().docs.map(doc=>doc.history?.length||0),[0,1,0,1,0]);assert.equal(h.latest().docs[1].history[0].runNo,1);assert.equal(h.latest().docs[1].history[0].error,'The reply was cut off.');
  assert.equal(new Set(h.latest().docs.map(doc=>doc.requestId)).size,1,'The retried texts name the request the run kept');assert.equal(h.latest().requests.length,1);
  assert.deepEqual(h.latest().runs[0].retries.map(retry=>retry.requests),[2]);assert.equal(h.latest().runs[0].label,'Pilot');
  assert(notices(h).includes('Run #1: 2 requests were sent again and all have a usable answer now.'),notices(h).join(' | '));
  assert.equal(h.find(n=>n.type==='Tabs').props.value,'workspace','The Workspace opens on the run');assert.equal(h.find(n=>n.type==='ResearchFilters').props.view.run,1);
  assert.equal(h.find(n=>n.props?.id==='prompt').props.value,'Classify mood','The prompt in the box stays as it was');
  // A failure in the retry is counted, and the notice points back to Retry failed.
  failing=new Set(['text-2.txt']);await setPrompt(h,'Classify tone');await h.button('All (').props.onClick();await until(h,settled(h,2));await until(h,ended(h));
  assert.deepEqual(h.latest().docs.map(doc=>doc.runNo),[2,2,2,2,2]);assert.equal(h.latest().runs[1].scope,'Shown texts (5)','The Workspace shows run 1, so the run buttons cover the texts shown');
  await tab(h,'runs');const again=h.calls.length;panel(h).onRetryRun(2);await until(h,()=>h.calls.length===again+1&&h.latest().docs[2].history?.length===1&&statuses(h)[2]==='error');await until(h,ended(h));
  assert(notices(h).includes('The request failed. “Retry failed” under Runs & agreement sends it again.'),notices(h).join(' | '));assert.equal(h.latest().docs[2].history.length,1);
  // Without a key for the run's provider, nothing is sent and the keys open.
  const keyless=harness(five(),async()=>{},async()=>Response.json({error:'The reply was cut off.'},{status:422}));
  await research(keyless);await keyless.button('Annotate next').props.onClick();await until(keyless,()=>statuses(keyless)[0]==='error');await until(keyless,ended(keyless));
  assert.equal(keyless.latest().runs[0].scope,'One text: text-0.txt');
  keyless.find(n=>n.type==='ResearchKeys').props.onSave({},false);await keyless.flush();await tab(keyless,'runs');const sent=keyless.calls.length;panel(keyless).onRetryRun(1);await keyless.flush();
  assert.equal(keyless.calls.length,sent);assert(notices(keyless).includes('Add a working OpenAI (ChatGPT) API key to send the requests of run #1 again.'),notices(keyless).join(' | '));assert.equal(keyless.find(n=>n.type==='ResearchKeys').props.open,true);
  assert.equal(keyless.latest().docs[0].status,'error','The failed text is left as it was');
  // An earlier run with a missing annotation: it is made within that run, and the text keeps its latest result.
  const cut=new Set(['text-0.txt']);
  const older=harness(five({repeats:3}),async()=>{},async(url,options)=>cut.delete(named(options))?Response.json({error:'The reply was cut off.'},{status:422}):fine());
  await research(older);await older.button('All (').props.onClick();await until(older,settled(older,1));await until(older,ended(older));
  assert.deepEqual(older.latest().docs[0].annotations.map(a=>a.status),['error','done','done']);
  await setPrompt(older,'Classify mood');await older.button('All (').props.onClick();await until(older,()=>older.latest().docs.every(doc=>doc.runNo===2&&doc.status==='done'));await until(older,ended(older));
  await tab(older,'runs');const was=older.calls.length;panel(older).onRetryRun(1);await until(older,()=>older.calls.length===was+1&&older.latest().docs[0].runNo===2&&older.latest().docs[0].earlier?.[0]?.annotations?.every(a=>a.status==='done'));await until(older,ended(older));
  const text0=older.latest().docs[0];
  assert.equal(older.calls.at(-1).options.body.get('prompt'),'Classify tone');assert.deepEqual([text0.runNo,text0.prompt],[2,'Classify mood'],'The text keeps its latest result');
  assert.deepEqual(text0.earlier.map(entry=>[entry.runNo,entry.annotations.map(a=>a.status).join()]),[[1,'done,done,done']],'The missing annotation is made in run 1');
 }

 // A text whose missing annotation fails again is sent once per run, not over and over (a run carries on past a
 // failed text, so the text must not be taken again).
 {
  const until=async(h,ready)=>{for(let n=0;n<300&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const two={docs:Array.from({length:2},(_,i)=>({id:String(i),name:`text-${i}.txt`,file:new File([`Text ${i}`],`text-${i}.txt`),status:'pending'})),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1,repeats:3};
  const named=options=>options.body.get('file').name,ended=h=>()=>!h.latest().docs.some(doc=>doc.status==='running')&&h.all(n=>['Button','button'].includes(n.type)&&h.text(n).trim()==='Pause').length===0;
  // (Past 12 requests the stand-in never answers, so a run that sends over and over fails this check instead of running on.)
  let cut=1;const h=harness(two,async()=>{},async(url,options)=>h.calls.length>12?new Promise(()=>{}):named(options)==='text-0.txt'&&cut-->0?Response.json({error:'The reply was cut off.'},{status:422}):Response.json({score:'POSITIVE',explanation:'Evidence'}));
  await h.flush();h.find(n=>n.type==='ModeSwitch').props.onChange(true);await h.flush();h.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-once'},false);await h.flush();
  h.button('All (').props.onClick();await until(h,()=>Boolean(h.latest())&&h.latest().docs.every(doc=>doc.status==='done'));await until(h,ended(h));
  assert.equal(h.calls.length,6);assert.deepEqual(h.latest().docs[0].annotations.map(a=>a.status),['error','done','done']);
  cut=Infinity;h.button('Remaining').props.onClick();await until(h,()=>h.latest().docs[0].history?.length===1);await until(h,ended(h));
  for(let n=0;n<20;n++){await new Promise(resolve=>setTimeout(resolve,10));await h.flush();}
  assert.equal(h.calls.length,7,'The missing annotation is sent once');assert.deepEqual(h.latest().docs[0].annotations.map(a=>a.status),['error','done','done']);
  assert(h.all(n=>n.props?.role==='alert'||n.props?.role==='status').map(n=>h.text(n)).includes('The request failed. “Remaining” sends it again.'));
 }

 // Annotations per text: each text is sent several times and its answers are combined; what is missing is filled in.
 {
  const until=async(h,ready)=>{for(let n=0;n<200&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const stored=()=>({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1,repeats:3});
  const research=async h=>{await h.flush();h.find(n=>n.type==='ModeSwitch').props.onChange(true);await h.flush();h.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-repeats'},false);await h.flush();};
  const near=(a,b)=>Math.abs(a-b)<1e-9,remaining=h=>h.text(h.button('Remaining'));
  // The standard Lab makes one annotation per text, whatever a study has stored.
  const once=harness(stored());await once.flush();once.find(n=>n.props?.id==='key').props.onChange({target:{value:'sk-once'}});await once.flush();
  once.button('Processing options').props.onClick();await once.flush();assert.throws(()=>once.find(n=>n.props?.id==='annotation-repeats'),'The setting is research mode’s');
  await once.button('Run all').props.onClick();await once.flush();
  assert.equal(once.calls.length,3);assert(once.latest().docs.every(doc=>doc.status==='done'&&!('annotations' in doc)&&doc.repeats===undefined&&doc.score==='POSITIVE'));assert.equal(once.latest().runs[0].repeats,undefined);assert.equal(once.latest().repeats,3,'The stored number is kept for research mode');

  // Research mode, one request at a time. The second annotation of the second text fails, and the person
  // pauses the run there (a failure by itself no longer stops a run; see the carry-on checks below).
  const plan={'text-0.txt':['POSITIVE','NEGATIVE','POSITIVE'],'text-1.txt':['POSITIVE',null,'POSITIVE','NEGATIVE'],'text-2.txt':['NEGATIVE','NEGATIVE','NEGATIVE']},sent=new Map();
  const r=harness(stored(),async()=>{},async(url,options)=>{
   const name=options.body.get('file').name,at=sent.get(name)||0,score=at<plan[name].length?plan[name][at]:'POSITIVE';sent.set(name,at+1);
   if(!score){await r.flush();r.button('Pause').props.onClick();}
   return score?Response.json({score,explanation:`${name} ${at+1}`,tokens:10,usage:{input_tokens:8,output_tokens:2},responseId:`r-${name}-${at+1}`}):Response.json({error:'The request failed.'},{status:400});
  });
  await research(r);
  r.button('Processing options').props.onClick();await r.flush();
  const select=()=>r.find(n=>n.props?.id==='annotation-repeats').props;
  assert.equal(String(select().value),'3');assert.deepEqual(select().children.map(option=>String(option.props.value)),['1','2','3','4','5','6','7','8','9','10']);assert(r.text(r.button('Processing options')).includes('3 annotations per text'));
  assert(remaining(r).includes('Remaining (3)'));r.button('Remaining').props.onClick();await until(r,()=>r.latest()?.docs[1].status==='done');
  let docs=r.latest().docs;
  assert.equal(r.calls.length,5,'Three requests for the first text, two for the second; nothing is started after the pause');assert.deepEqual(docs.map(doc=>doc.status),['done','done','pending']);
  assert.deepEqual([docs[0].score,docs[0].explanation,docs[0].tokens,docs[0].repeats,docs[0].runNo],['POSITIVE','text-0.txt 1',30,3,1]);assert(near(docs[0].consistency.score,2/3));
  assert.deepEqual(docs[0].annotations.map(a=>[a.n,a.status,a.score,a.responseId,a.requestId,a.runId===docs[0].runId,a.processing]),[[1,'done','POSITIVE','r-text-0.txt-1','q1',true,'instant'],[2,'done','NEGATIVE','r-text-0.txt-2','q1',true,'instant'],[3,'done','POSITIVE','r-text-0.txt-3','q1',true,'instant']]);
  for(const key of ['usage','responseId','rawResponse'])assert.equal(docs[0][key],undefined,key+' belongs to each annotation');assert.deepEqual(docs[0].annotations[0].usage,{input_tokens:8,output_tokens:2});
  assert.deepEqual(docs[1].annotations.map(a=>[a.n,a.status,a.error]),[[1,'done',undefined],[2,'error','The request failed.']]);assert.deepEqual([docs[1].score,docs[1].error,docs[1].consistency],['POSITIVE',undefined,undefined],'One usable annotation: its answer, and no share');
  assert.equal(docs[2].annotations,undefined);assert.equal(docs[2].repeats,undefined);assert.equal(docs[0].runSize,9,'A run’s size counts requests');
  assert.deepEqual(r.latest().runs.map(run=>[run.number,run.repeats]),[[1,3]]);assert.equal(r.latest().repeats,3);
  assert(r.all(n=>n.type==='span'&&String(n.props.className).includes('partial')).some(n=>r.text(n)==='1 of 3 annotations'),'A text with fewer annotations than planned says so');
  assert(r.all(n=>n.props?.role==='alert'||n.props?.role==='status').some(n=>r.text(n)==='Paused. Active annotations have finished; completed results are kept. 1 of 5 requests failed. “Remaining” sends it again.'));
  // Remaining: the two missing annotations of the second text, then the third text; all in the same run.
  assert(remaining(r).includes('Remaining (2)'));r.button('Remaining').props.onClick();await until(r,()=>r.latest()?.docs[2].status==='done');
  docs=r.latest().docs;
  assert.equal(r.calls.length,10);assert.deepEqual(docs.map(doc=>[doc.status,doc.runNo,doc.annotations.map(a=>a.status).join()]),Array(3).fill(['done',1,'done,done,done']));assert.equal(r.latest().runs.length,1);
  assert.deepEqual(docs[1].annotations.map(a=>a.score),['POSITIVE','POSITIVE','NEGATIVE']);assert.equal(docs[1].score,'POSITIVE');assert(near(docs[1].consistency.score,2/3));assert.equal(docs[1].tokens,30);
  assert.deepEqual(docs[1].history.map(attempt=>[attempt.status,attempt.replicate,attempt.error,attempt.runNo,attempt.repeats,attempt.model]),[['error',2,'The request failed.',1,3,providers.defaultModel('openai')]],'The failed annotation is kept as a failed attempt');
  assert.notEqual(docs[1].annotations[1].runId,docs[1].annotations[0].runId,'An annotation filled in later names its own click');assert.equal(docs[1].annotations[1].runId,docs[1].runId);assert.equal(docs[1].history[0].runId,docs[1].annotations[0].runId);
  assert.deepEqual([docs[2].score,docs[2].consistency.score],['NEGATIVE',1]);assert(remaining(r).includes('Remaining (0)'));
  assert(!r.all(n=>n.type==='span'&&String(n.props.className).includes('partial')).length);
  // Another number is another run's setting; with one, nothing of the setting is stored.
  select().onChange({target:{value:'2'}});await r.flush();assert.equal(r.latest().repeats,2);assert(remaining(r).includes('Remaining (0)'),'Results made with these settings exist, whatever the number');assert(r.text(r.button('All (')).includes('All (3)'));
  r.button('All (').props.onClick();await until(r,()=>r.latest()?.docs.every(doc=>doc.status==='done'&&doc.runNo===2));
  docs=r.latest().docs;
  assert.equal(r.calls.length,16);assert.deepEqual(r.latest().runs.map(run=>[run.number,run.repeats]),[[1,3],[2,2]]);assert(docs.every(doc=>doc.annotations.length===2&&doc.repeats===2&&doc.earlier.length===1&&doc.earlier[0].annotations.length===3&&doc.earlier[0].repeats===3));
  select().onChange({target:{value:'1'}});await r.flush();assert.equal(r.latest().repeats,undefined);assert(!r.text(r.button('Processing options')).includes('annotations per text'));

  // As a batch: one file per text, sent as many times as it has annotations to make; results come back per request.
  const jobs=[];let returned=()=>[];
  const b=harness({...stored(),processing:'batch'},async()=>{},async(url,options)=>{
   const action=options.body.get('action');assert.equal(url,action==='prepare'?'/api/batch?split=1':'/api/batch');
   // Research mode prepares the run first, then sends it batch by batch (here one).
   if(action==='prepare'){jobs.push({ids:JSON.parse(options.body.get('ids')),copies:options.body.get('copies'),files:options.body.getAll('files').map(file=>file.name)});const n=jobs.at(-1).ids.length;return Response.json({parts:[{items:[0,jobs.at(-1).files.length],requests:[0,n],bytes:1}],bytes:1,requests:n,bySize:false});}
   if(action==='send'){assert.equal(options.body.get('part'),'0');return Response.json({id:'batch_'+jobs.length});}
   if(action==='check')return Response.json({terminal:true,state:'completed',completed:1,total:1});
   return Response.json({terminal:true,state:'completed',results:returned(jobs.at(-1).ids)});
  });
  await research(b);
  await b.button('Remaining').props.onClick();await b.flush();
  assert.deepEqual([jobs[0].copies,jobs[0].ids.length,jobs[0].files.join()],['[3,3,3]',9,'text-0.txt,text-1.txt,text-2.txt']);assert.deepEqual([b.latest().batchJob.repeats,b.latest().batchJob.ns,b.latest().batchJob.id],[3,undefined,'batch_1']);
  assert(b.latest().docs.every(doc=>doc.status==='queued'&&doc.repeats===3&&doc.annotations.length===0&&doc.runSize===9));
  // Request 4 (the second text's second annotation) is not returned, and request 7 (the third text's second) failed.
  returned=ids=>ids.flatMap((id,i)=>i===4?[]:i===7?[{id,error:'Expired'}]:[{id,score:['POSITIVE','NEGATIVE','POSITIVE','POSITIVE','','NEGATIVE','NEGATIVE','','NEGATIVE'][i],explanation:'Reply '+i,tokens:5,usage:{input_tokens:4,output_tokens:1},responseId:'b'+i}]);
  await b.button('Check status').props.onClick();await b.flush();await b.button('Collect results').props.onClick();await b.flush();
  docs=b.latest().docs;
  assert.equal(b.latest().batchJob,null);assert.deepEqual(docs.map(doc=>[doc.status,doc.score,doc.tokens,doc.processing,doc.batchId]),[['done','POSITIVE',15,'batch','batch_1'],['done','NEGATIVE | POSITIVE',10,'batch','batch_1'],['done','NEGATIVE',10,'batch','batch_1']]);
  assert.deepEqual(docs[1].annotations.map(a=>[a.n,a.status,a.error,a.batchId]),[[1,'done',undefined,'batch_1'],[2,'error','No result was returned for this document. Check the provider’s batch report before retrying.','batch_1'],[3,'done',undefined,'batch_1']]);
  assert.deepEqual(docs[2].annotations.map(a=>[a.status,a.error]),[['done',undefined],['error','Expired'],['done',undefined]]);assert.equal(docs[1].consistency.score,0,'A tied vote');assert.equal(docs[0].explanation,'Reply 0');assert.equal(docs[0].annotations[1].responseId,'b1');
  // Remaining submits only what is missing: one request for each of the two texts.
  assert(remaining(b).includes('Remaining (2)'));await b.button('Remaining').props.onClick();await b.flush();
  assert.deepEqual([jobs[1].copies,jobs[1].ids.length,jobs[1].files.join()],['[1,1]',2,'text-1.txt,text-2.txt']);assert.deepEqual(b.latest().batchJob.ns,[[2],[2]]);
  assert.deepEqual(b.latest().docs.map(doc=>[doc.status,doc.annotations.length]),[['done',3],['queued',3],['queued',3]],'A text waiting for its missing annotations keeps those it has');
  returned=ids=>ids.map((id,i)=>({id,score:'POSITIVE',explanation:'Later '+i,tokens:5,responseId:'c'+i}));
  await b.button('Check status').props.onClick();await b.flush();await b.button('Collect results').props.onClick();await b.flush();
  docs=b.latest().docs;
  assert.deepEqual(docs.map(doc=>[doc.status,doc.score,doc.runNo,doc.annotations.map(a=>a.status).join(),doc.annotations[1].batchId]),[['done','POSITIVE',1,'done,done,done','batch_1'],['done','POSITIVE',1,'done,done,done','batch_2'],['done','NEGATIVE',1,'done,done,done','batch_2']]);
  assert.deepEqual(docs[1].history.map(attempt=>[attempt.replicate,attempt.batchId,attempt.status]),[[2,'batch_1','error']]);assert.deepEqual(docs[2].history.map(attempt=>[attempt.replicate,attempt.error]),[[2,'Expired']]);
  assert.equal(b.latest().runs.length,1);assert(remaining(b).includes('Remaining (0)'));
  // A batch that is not accepted leaves a text with the annotations it had, and a text without any waiting.
  const refused=harness({...stored(),processing:'batch',docs:[{...docs[0],annotations:docs[0].annotations.slice(0,2),file:new File(['Text 0'],'text-0.txt')},documents()[1]],runs:b.latest().runs},async()=>{},async()=>Response.json({error:'The provider did not accept the batch.',uncertain:false},{status:400}));
  await research(refused);await refused.button('Remaining').props.onClick();await refused.flush();
  assert.equal(refused.latest().batchJob,null);assert.deepEqual(refused.latest().docs.map(doc=>[doc.status,doc.annotations?.length]),[['done',2],['pending',undefined]]);
  // A run larger than one provider batch: sent as two batches in the same run, each recorded as it goes up, and
  // collected batch by batch as each ends, into one set of results.
  const parts=[{items:[0,2],requests:[0,6],bytes:1},{items:[2,3],requests:[6,9],bytes:1}],ended=new Set(),putUp=[];let refuse=false;
  const twoBatches=async(url,options)=>{
   const action=options.body.get('action'),id=options.body.get('id');
   if(action==='prepare'){assert.equal(url,'/api/batch?split=1');return Response.json({parts,bytes:2,requests:9,bySize:false});}
   if(action==='send'){putUp.push(options.body.get('part'));if(refuse&&options.body.get('part')==='1')return Response.json({error:'This model is not available for batches.',uncertain:false},{status:400});return Response.json({id:'batch_p'+(Number(options.body.get('part'))+1)});}
   if(!ended.has(id))return Response.json({terminal:false,state:'in_progress',completed:0,total:3});
   if(action==='check')return Response.json({terminal:true,state:'completed',completed:3,total:3});
   const runId=s.latest().batchJob.runId,[from,to]=id==='batch_p1'?[0,6]:[6,9];
   return Response.json({terminal:true,state:'completed',completed:to-from,total:to-from,results:Array.from({length:to-from},(_,i)=>({id:runId+'_'+(from+i),score:'POSITIVE',explanation:'Part '+id,tokens:2}))});
  };
  const s=harness({...stored(),processing:'batch'},async()=>{},twoBatches);
  await research(s);await s.button('Remaining').props.onClick();await s.flush();
  let job=s.latest().batchJob;
  assert.deepEqual(putUp,['0','1']);assert.deepEqual(job.parts.map(part=>[part.id,part.state,part.items.join('-')]),[['batch_p1','processing','0-2'],['batch_p2','processing','2-3']]);assert.equal(job.id,undefined);
  assert.deepEqual(s.writes.filter(w=>w.batchJob?.parts).map(w=>w.batchJob.parts.map(part=>part.state).join()).slice(0,5),['waiting,waiting','submitting,waiting','processing,waiting','processing,submitting','processing,processing'],'Each batch is recorded before and after it goes up');
  assert(s.latest().docs.every(doc=>doc.status==='queued'&&doc.runSize===9));
  ended.add('batch_p1');await s.button('Check status').props.onClick();await s.flush();
  assert.deepEqual(s.latest().batchJob.parts.map(part=>part.state),['ready','processing']);
  await s.button('Collect results').props.onClick();await s.flush();
  assert.deepEqual(s.latest().docs.map(doc=>[doc.status,doc.batchId]),[['done','batch_p1'],['done','batch_p1'],['queued',undefined]]);assert.deepEqual(s.latest().batchJob.parts.map(part=>part.state),['collected','processing']);
  ended.add('batch_p2');await s.button('Check status').props.onClick();await s.flush();await s.button('Collect results').props.onClick();await s.flush();
  assert.equal(s.latest().batchJob,null);assert.deepEqual(s.latest().docs.map(doc=>[doc.status,doc.batchId,doc.annotations.length,doc.runNo]),[['done','batch_p1',3,1],['done','batch_p1',3,1],['done','batch_p2',3,1]]);assert.equal(s.latest().runs.length,1);
  assert(s.all(n=>n.props?.role==='status').some(n=>s.text(n).includes('Batch results collected from all 2 batches of this run.')));
  // A batch the provider refuses: the one sent continues, and the texts of the other are back where they were.
  putUp.length=0;refuse=true;ended.clear();
  const r2=harness({...stored(),processing:'batch'},async()=>{},(url,options)=>twoBatches(url,options));
  await research(r2);await r2.button('Remaining').props.onClick();await r2.flush();
  assert.deepEqual(r2.latest().batchJob.parts.map(part=>part.state),['processing','unsent']);assert.deepEqual(r2.latest().docs.map(doc=>doc.status),['queued','queued','pending']);
  assert(r2.all(n=>n.props?.role==='status').some(n=>r2.text(n).startsWith('Batch 2 of 2 was not submitted: This model is not available for batches. Batch 1 was submitted and continues in this run. The 1 texts')));
 }

 // Deleting texts (research mode, the More menu above the table). A text a run used leaves the Workspace but stays
 // with its runs, their comparisons, and the exports; one no run used is deleted outright. Added again, a deleted
 // text gets its results back. It goes for good once no run uses it.
 {
  const until=async(h,ready)=>{for(let n=0;n<300&&!ready();n++){await new Promise(resolve=>setTimeout(resolve,25));await h.flush();}assert(ready(),'The run did not get there in time');};
  const four=()=>({docs:Array.from({length:4},(_,i)=>({id:String(i),name:`text-${i}.txt`,file:new File([`Text ${i}`],`text-${i}.txt`),status:'pending'})),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1,columns:[{name:'year',role:'meta'},{name:'tone_human',role:'label'}]});
  const h=harness(four());await h.flush();h.find(n=>n.type==='ModeSwitch').props.onChange(true);await h.flush();h.find(n=>n.type==='ResearchKeys').props.onSave({openai:'sk-delete'},false);await h.flush();
  const filters=()=>h.find(n=>n.type==='ResearchFilters').props,item=label=>h.find(n=>n.type==='ResultPages'||n.type?.name==='ResultPages').props.extra.props.items.find(entry=>entry.label.startsWith(label)),notices=()=>h.all(n=>n.props?.role==='alert'||n.props?.role==='status').map(n=>h.text(n)).join(' | ');
  const tab=value=>{h.find(n=>n.type==='Tabs').props.onValueChange(value);return h.flush();},panel=()=>h.find(n=>n.type==='ResearchRuns').props,tick=name=>h.find(n=>n.type==='input'&&n.props['aria-label']==='Select '+name).props.onChange({target:{checked:true}});
  // Two texts get a result in run 1, with values in both columns; the other two are never sent.
  h.find(n=>n.type==='ResearchTools').props.onApply(h.latest()?.docs||four().docs,[{name:'year',role:'meta'},{name:'tone_human',role:'label'}],[],'');await h.flush();
  tick('text-0.txt');tick('text-1.txt');await h.flush();await h.button('All (').props.onClick();await until(h,()=>h.latest()?.docs.filter(doc=>doc.status==='done').length===2&&!h.latest().docs.some(doc=>doc.status==='running'));
  h.find(n=>n.type==='ResearchTools').props.onApply(h.latest().docs.map((doc,i)=>({...doc,cells:[String(1960+i),i%2?'NEGATIVE':'POSITIVE']})),[{name:'year',role:'meta'},{name:'tone_human',role:'label'}],[],'');await h.flush();
  assert.equal(filters().checked,2);filters().onClearChecked();await h.flush();assert.equal(filters().checked,0);
  assert.equal(item('Delete selected').disabled,true);
  tick('text-1.txt');tick('text-2.txt');await h.flush();
  assert.equal(item('Delete 2').label,'Delete 2 selected texts…');
  item('Delete 2').onSelect();await h.flush();
  assert.deepEqual(h.latest().docs.map(doc=>doc.name),['text-0.txt','text-3.txt']);
  assert.deepEqual(h.latest().removed.map(doc=>[doc.name,doc.removedPlace,doc.status,doc.runNo,typeof doc.removedAt,doc.cells]),[['text-1.txt',1,'done',1,'string',['1961','NEGATIVE']]],'The text a run used is kept in its place; the unsent one is gone');
  assert(notices().includes('2 texts deleted. The results of 1 of them stay with the runs that made them.'),notices());
  assert.equal(filters().checked,0);assert.equal(filters().total,2);
  // Runs & agreement reads it with its run, in its place; it is not a link to the Workspace, and it is never sent again.
  await tab('runs');
  assert.deepEqual(panel().datasets[0].rows.map(row=>row.name),['text-0.txt','text-1.txt','text-2.txt','text-3.txt'].filter(name=>name!=='text-2.txt'));
  await tab('workspace');
  assert(h.text(h.button('All (')).includes('All (2)'),'The run buttons cover the texts in the Workspace only');
  // Removing a column also takes it from the deleted text, so its values stay in line.
  const tools=()=>h.find(n=>n.type==='ResearchTools').props;
  tools().onApply(h.latest().docs.map(doc=>({...doc,cells:doc.cells?[doc.cells[1]]:undefined})),[{name:'tone_human',role:'label'}],[],'Column “year” removed.');await h.flush();
  assert.deepEqual(h.latest().removed[0].cells,['NEGATIVE']);
  // A label sheet reaches the deleted text too (its label still counts in its run's comparisons); the guess at a
  // column's role knows the study's answer fields.
  assert.deepEqual(tools().removed.map(doc=>doc.name),['text-1.txt']);assert.deepEqual(tools().fields,[]);
  tools().onApply(h.latest().docs,[{name:'tone_human',role:'label'}],[],'1 column added to 3 texts (1 of them deleted but kept for their runs).',undefined,h.latest().removed.map(doc=>({...doc,cells:['MIXED']})));await h.flush();
  assert.deepEqual(h.latest().removed.map(doc=>[doc.name,doc.cells,doc.removedPlace,typeof doc.removedAt]),[['text-1.txt',['MIXED'],1,'string']]);
  await tab('runs');assert.deepEqual(panel().datasets[0].rows.map(row=>[row.name,row.cells]),[['text-0.txt',['POSITIVE']],['text-1.txt',['MIXED']],['text-3.txt',['NEGATIVE']]]);await tab('workspace');
  tools().onApply(h.latest().docs,[{name:'tone_human',role:'label'}],[],'',undefined,h.latest().removed.map(doc=>({...doc,cells:['NEGATIVE']})));await h.flush();
  // The same file added again brings the text back with its result; a changed file of that name is a new text.
  await h.add([new File(['Text 1'],'text-1.txt')]);await h.flush();
  assert.deepEqual(h.latest().docs.map(doc=>[doc.name,doc.status,doc.runNo,doc.removedAt,doc.cells]),[['text-0.txt','done',1,undefined,['POSITIVE']],['text-3.txt','pending',undefined,undefined,['NEGATIVE']],['text-1.txt','done',1,undefined,['NEGATIVE']]]);
  assert(!('removed' in h.latest()),'Nothing is kept as removed any more');
  assert(notices().includes('1 document added. It had been deleted before: the results earlier runs made for it are its again.'),notices());
  // Delete all texts: the two with results stay with run 1, the unsent one goes. Deleting run 1 then lets them go too.
  item('Delete all texts').onSelect();await h.flush();
  assert.deepEqual(h.latest().docs,[]);assert.deepEqual(h.latest().removed.map(doc=>[doc.name,doc.removedPlace]),[['text-0.txt',0],['text-1.txt',1]]);
  assert(h.latest().requests===undefined||h.latest().requests.length>=0);
  await tab('runs');assert.deepEqual(panel().datasets[0].rows.map(row=>row.name),['text-0.txt','text-1.txt']);
  panel().onDeleteRun(1);await h.flush();
  assert(!('removed' in h.latest()),'A deleted text no run uses goes for good');assert.deepEqual(h.latest().docs,[]);
 }

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

 // Research mode asks the browser to keep this site's data, each time it opens; the standard Lab never asks.
 {let asked=0;const real=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{persisted:async()=>false,persist:async()=>{asked++;return true;}}}});
  try{
   const lab=start();await lab.flush();assert.equal(asked,0,'The standard Lab does not ask');
   lab.find(n=>n.type==='ModeSwitch').props.onChange(true);await lab.flush();assert.equal(asked,1,'Research mode asks');
   await lab.add([new File(['Another text'],'another.txt',{type:'text/plain'})]);assert.equal(asked,2,'Adding texts asks again');
   lab.find(n=>n.type==='ModeSwitch').props.onChange(false);await lab.flush();assert.equal(asked,2);
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{persisted:async()=>true,persist:async()=>{asked++;return true;}}}});
   lab.find(n=>n.type==='ModeSwitch').props.onChange(true);await lab.flush();assert.equal(asked,2,'Data already kept: nothing more is asked');
   Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
   lab.find(n=>n.type==='ModeSwitch').props.onChange(false);await lab.flush();lab.find(n=>n.type==='ModeSwitch').props.onChange(true);await lab.flush();
   assert.equal(lab.find(n=>n.type==='ModeSwitch').props.on,true,'A browser without it opens research mode all the same');
  }finally{Object.defineProperty(globalThis,'navigator',real);}
 }

 // One tab at a time (lib/research/tab-lock.ts): switching on is refused while another tab of this browser has research
 // mode, and the standard Lab stays as it was, with a notice. Switching off is never refused.
 {const changes=[];let answer=false;const props={research:false,claimResearch:()=>{if(answer==='off')throw new Error('Switching off asks for nothing');return answer==='held'?true:Promise.resolve(answer);},onResearch:on=>{props.research=on;changes.push(on);}};
  const lab=harness({docs:documents(),prompt:'Classify tone',provider:'openai',model:providers.defaultModel('openai'),effort:'medium',concurrency:1},undefined,undefined,undefined,props);await lab.flush();
  const mode=()=>lab.find(n=>n.type==='ModeSwitch').props,notices=()=>lab.all(n=>n.type==='OtherTabNotice');
  assert.equal(notices().length,0);
  mode().onChange(true);await lab.flush();
  assert.equal(mode().on,false,'Refused: the standard Lab stays');assert.deepEqual(changes,[]);assert.equal(notices().length,1);assert.equal(notices()[0].props.openHere,undefined);
  assert.deepEqual(lab.all(n=>n.type==='TabsTrigger').map(n=>n.props.value),STUDENT_TABS);assert.equal(lab.find(n=>n.type==='header').props.className,undefined);
  answer=true;mode().onChange(true);await lab.flush();
  assert.equal(mode().on,true);assert.deepEqual(changes,[true]);assert.equal(notices().length,0);assert.deepEqual(lab.all(n=>n.type==='TabsTrigger').map(n=>n.props.value),RESEARCH_TABS);
  // The header in research mode: the saved status as a check mark, with the words on hover and for screen readers.
  {const header=()=>lab.find(n=>n.type==='header'),mark=()=>lab.all(n=>n.props?.className==='saved saved-mark');
   assert.equal(mark().length,0,'Not before the workspace is saved');assert.match(lab.text(header()),/Preparing workspace/);
   lab.find(n=>n.type==='ModelKnowledge').props.onSaveStateChange('saved');await lab.flush();
   assert.equal(mark().length,1);assert.equal(mark()[0].props.title,'Autosaved in this browser');assert.match(lab.text(mark()[0]),/^Autosaved in this browser$/);}
  answer='off';mode().onChange(false);await lab.flush();
  assert.equal(lab.all(n=>n.props?.className==='saved saved-mark').length,0,'The standard Lab keeps the words');assert.match(lab.text(lab.find(n=>n.type==='header')),/Autosaved in this browser/);
 assert.equal(mode().on,false);assert.deepEqual(changes,[true,false]);
  answer='held';mode().onChange(true);await lab.flush();assert.equal(mode().on,true,'Already held: switched at once');assert.deepEqual(changes,[true,false,true]);
 }
 console.log('Research mode workspace checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
