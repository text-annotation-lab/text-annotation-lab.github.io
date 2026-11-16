// Research mode, the runs table (Runs & agreement): a label and the scope of each run, its status, requests,
// tokens, and cache use, a window with its settings, and "Retry failed", which sends a run's requests without a
// usable answer again within the run. The rules are in lib/research/runs.ts; the panel is called with a small
// stand-in for React (not a browser renderer). No requests are sent. The page's own part ("Retry failed" sends
// with the run's settings) is in tests/research-mode.cjs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function instance(){const slots=[];let cursor=0;return {react:{useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useEffect(){cursor++;},useMemo(fn){cursor++;return fn();}},begin(){cursor=0;}};}
let current=instance();
const jsx=(type,props)=>({type,props});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>{
  if(id==='react')return new Proxy({},{get:(_,key)=>current.react[key]});
  if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
  if(id.endsWith('.css'))return {};
  if(id==='lucide-react'||id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});
  // The intervals are worked out in a browser worker; here they are not needed.
  if(id==='@/lib/research/intervals')return {computeIntervals:()=>()=>{}};
  const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;
  if(target===null)return req(id);
  return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');
 };
 new Function('exports','require','confirm',code)(exports,local,(...args)=>global.confirm(...args));return exports;
}
function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
function mount(component,props){const mine=instance();return {tree(){current=mine;mine.begin();return component(props);}};}

const runs=load('lib/research/runs.ts'),tables=load('lib/research/export-tables.ts'),panel=load('components/research/runs-panel.tsx');
const setup={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Classify tone',answerFields:[]};

// Stored runs keep a label, a scope, and their retries; anything else in their place is dropped.
{
 const [kept]=runs.cleanRuns([{...setup,number:1,startedAt:'2026-11-16T10:00:00Z',label:'  Pilot  ',scope:'All texts (5)',retries:[{at:'2026-11-16T11:00:00Z',requests:2},{at:5,requests:1},{at:'x',requests:-1},null]}]);
 assert.deepEqual([kept.label,kept.scope,kept.retries],['Pilot','All texts (5)',[{at:'2026-11-16T11:00:00Z',requests:2}]]);
 const [bare]=runs.cleanRuns([{...setup,number:1,startedAt:'',label:'   ',scope:7,retries:'often'}]);
 assert(!('label' in bare)&&!('scope' in bare)&&!('retries' in bare),'Nothing is stored for an empty label, scope, or list of retries');
 assert.equal(runs.cleanRuns([{...setup,number:1,startedAt:'',label:'x'.repeat(200)}])[0].label.length,runs.LABEL_LENGTH);
}
// A label is set, trimmed, and taken away again.
{
 const list=[{...setup,number:1,startedAt:''},{...setup,number:2,startedAt:''}];
 const named=runs.labelRun(list,2,'  Second coder ');assert.deepEqual(named.map(run=>run.label),[undefined,'Second coder']);
 assert(!('label' in runs.labelRun(named,2,'  ')[1]));assert.equal(runs.labelRun(list,1,'y'.repeat(200))[0].label.length,runs.LABEL_LENGTH);
}
// The scope says what each start of a run covered; of many, the first and the latest three are kept.
{
 let list=[{...setup,number:1,startedAt:''}];
 list=runs.addScope(list,1,'Random sample of 10');list=runs.addScope(list,1,'Remaining texts (90)');list=runs.addScope(list,1,'Remaining texts (90)');
 assert.equal(list[0].scope,'Random sample of 10; Remaining texts (90)','A start like the one before is not repeated');
 assert.equal(runs.addScope(list,1,'  ')[0].scope,list[0].scope);
 for(const part of ['A','B','C','D'])list=runs.addScope(list,1,part);
 assert.equal(list[0].scope,'Random sample of 10; …; B; C; D');
 assert.deepEqual(runs.addRetry(list,1,{at:'t',requests:3})[0].retries,[{at:'t',requests:3}]);
}

// What "Retry failed" sends: every request of a text whose result in the run failed, and the missing annotations
// of a text with fewer than the run makes. A text waiting to be sent again from the Workspace is not counted.
const failed={status:'error',error:'Cut off',...setup,runNo:1};
const three=(ok,status='done')=>({status,...setup,runNo:2,repeats:3,annotations:[1,2,3].map(n=>({n,status:ok.includes(n)?'done':'error',score:'POSITIVE'})),score:'POSITIVE'});
const docs=[
 {id:'a',name:'a.txt',status:'done',...setup,runNo:1,score:'POSITIVE'},
 {id:'b',name:'b.txt',...failed},
 {id:'c',name:'c.txt',status:'pending',runNo:1,history:[{status:'error',runNo:1}]},
 {id:'d',name:'d.txt',...three([1,3])},
 {id:'e',name:'e.txt',...three([],'error'),error:'All 3 annotations failed.'},
 {id:'f',name:'f.txt',status:'done',...setup,runNo:3,score:'NEGATIVE',earlier:[{...three([2]),runNo:2}]},
];
assert.deepEqual(runs.retryable(docs,1),{ids:['b'],requests:1});
assert.deepEqual(runs.retryable(docs,2),{ids:['d','e','f'],requests:1+3+2},'An incomplete result in an earlier run counts too');
assert.deepEqual(runs.retryable(docs,3),{ids:[],requests:0});

// Before the retry, a text's result in the run becomes its current one; afterward its latest comes back.
{
 const raised=runs.raiseRun(docs,2,new Set(['d','e','f']));
 assert.equal(raised[3],docs[3],'A text whose current result is in the run is left as it is');
 assert.deepEqual([raised[5].runNo,raised[5].status,raised[5].earlier.map(entry=>[entry.runNo,entry.score])],[2,'done',[[3,'NEGATIVE']]]);
 assert.equal(raised[5].annotations.length,3);
 const made={...raised[5],annotations:raised[5].annotations.map(a=>({...a,status:'done'}))},after=raised.map((doc,i)=>i===5?made:doc);
 const lowered=runs.lowerRun(after,2,new Set(['d','e','f']));
 assert.deepEqual([lowered[5].runNo,lowered[5].score,lowered[5].earlier.map(entry=>[entry.runNo,entry.annotations.every(a=>a.status==='done')])],[3,'NEGATIVE',[[2,true]]]);
 assert.equal(lowered[3],after[3],'A text whose latest result is in the run is left as it is');
 // Runs 1, 2, and 3: the retried run goes back between the other two.
 const middle={id:'g',name:'g.txt',status:'done',...setup,runNo:2,score:'X',earlier:[{status:'done',...setup,runNo:1,score:'W'},{status:'done',...setup,runNo:3,score:'Y'}]};
 assert.deepEqual(((doc)=>[doc.runNo,doc.earlier.map(entry=>entry.runNo)])(runs.lowerRun([middle],2,new Set(['g']))[0]),[3,[1,2]]);
 // A failed attempt a text waited with stays with it.
 const waiting={id:'h',name:'h.txt',status:'pending',history:[{status:'error',runNo:3}],earlier:[{...three([1]),runNo:2}]};
 const raisedWaiting=runs.raiseRun([waiting],2,new Set(['h']))[0];
 assert.deepEqual([raisedWaiting.status,raisedWaiting.runNo,raisedWaiting.history.length,raisedWaiting.earlier],['done',2,1,undefined]);
}
// Where a run stands: being sent, waiting in a batch, completed, or failed.
assert.equal(runs.runState([{id:'a',status:'running',runNo:4}],{number:4,done:0,active:1}),'running');
assert.equal(runs.runState([{id:'a',status:'queued',runNo:4}],{number:4,done:0,active:1}),'submitted');
assert.equal(runs.runState([],{number:4,done:2,active:0}),'completed');
assert.equal(runs.runState([],{number:4,done:0,active:0}),'failed');
// The request settings a run's results recorded.
assert.deepEqual(runs.runRequestSettings([{id:'a',status:'error',...setup,runNo:1,requestSettings:{cache:true}},{id:'b',status:'done',...setup,runNo:2,requestSettings:{temperature:0}}],1),{cache:true});
assert.equal(runs.runRequestSettings([{id:'a',status:'done',...setup,runNo:1}],1),undefined);

// The exports carry the label and the scope.
{
 const dataset={kind:'texts',rows:[{id:'a',name:'a.txt',status:'done',...setup,runNo:1,score:'POSITIVE',usage:{input_tokens:100,output_tokens:20}}],runs:[{...setup,number:1,startedAt:'2026-11-16T10:00:00Z',label:'Pilot',scope:'All texts (1)'}],columns:[],samples:[]};
 const overview=tables.runsOverview({name:'S',dataset,lab:'test'},new Map()),at=name=>overview[0].indexOf(name);
 assert.deepEqual([at('run'),at('label')],[0,1]);assert.equal(at('batch_id'),-1,'No run was sent as a batch: no batch_id column');assert.equal(at('scope'),at('mode')+1,'Right after mode');assert(!overview[0].includes('app_version'),'No build');
 assert.deepEqual([overview[1][at('label')],overview[1][at('scope')]],['Pilot','All texts (1)']);
 const source=fs.readFileSync(path.join(root,'lib/research/export-packages.ts'),'utf8');
 assert(source.includes("run:{number:run.number,...(run.label?{label:run.label}:{}),...(run.scope?{scope:run.scope}:{}),"),'The run record names the label and the scope');
}

// The panel: one row per run with its label, scope, status, requests, tokens, and cache use; a Settings window;
// and "Retry failed" where a run of texts has requests without a usable answer.
{
 const at='2026-11-16T10:00:00Z',usage=(input,output,cached)=>({input_tokens:input,output_tokens:output,input_tokens_details:{cached_tokens:cached}});
 const rows=[
  {id:'a',name:'a.txt',status:'done',...setup,runNo:1,score:'POSITIVE',usage:usage(1000,200,600),time:at,startedAt:at,requestId:'q1',lab:'test'},
  {id:'b',name:'b.txt',status:'error',...setup,runNo:1,error:'Cut off',usage:usage(1000,50,0),time:at,startedAt:at,requestId:'q1',lab:'test'},
  {id:'c',name:'c.txt',status:'done',...setup,model:'gpt-6.1-terra',runNo:2,score:'NEGATIVE',usage:usage(500,100,0),time:at,startedAt:at,processing:'batch',batchId:'batch_1'},
 ];
 const requests=[{id:'q1',url:'https://api.openai.com/v1/responses',body:JSON.stringify({model:'gpt-6-luna',instructions:'Classify tone',input:[{role:'user',content:[{type:'input_text',text:'<<DOCUMENT_TEXT>>'}]}]})}];
 const dataset={kind:'texts',rows,runs:[{...setup,number:1,startedAt:at,label:'Pilot',scope:'All texts (2)',retries:[{at,requests:1}]},{...setup,model:'gpt-6.1-terra',number:2,startedAt:at}],columns:[],samples:[],requests};
 const knowledge={kind:'knowledge',rows:[{id:'k',name:'Iago',status:'error',...setup,runNo:1,runNumber:1,error:'Cut off',fields:[{heading:'Subject',value:'Iago'}],usage:usage(10,5,0)}],runs:[],columns:[],samples:[]};
 const calls=[];let asked=[];global.confirm=message=>{asked.push(message);return true;};
 const props={datasets:[dataset,knowledge],studyName:'S',locked:false,onShowRun:n=>calls.push(['show',n]),onDeleteRun:n=>calls.push(['delete',n]),onOpenText(){},onRenameRun:(n,label)=>calls.push(['label',n,label]),onRetryRun:n=>calls.push(['retry',n])};
 const view=mount(panel.RunsPanel,props);
 const table=()=>nodes(view.tree()).find(n=>n.type==='table'&&String(n.props.className).includes('research-runs'));
 const heads=()=>nodes(table()).filter(n=>n.type==='th'&&n.props.children!==undefined).map(text);
 assert.deepEqual(heads().slice(0,11),['Run','Label','Started','Scope','Model','Prompt','Status','OK / failed','Tokens in / out','Cache read / write','Cost']);
 const lines=()=>nodes(table()).filter(n=>n.type==='tr').slice(1);
 const cells=row=>(Array.isArray(row.props.children)?row.props.children:[row.props.children]).flat().filter(cell=>cell&&cell.type==='td').map(text);
 const [first,second]=lines().map(cells);
 assert.deepEqual([first[0],first[3],first[6],first[7],first[8],first[9]],['#1','All texts (2)','completed','1 / 1','2,000 / 250','600 / 0']);
 assert.deepEqual([second[3],second[6],second[7]],['—','batch · completed','1 / 0']);
 // The label: typed into the row, saved when the field is left.
 const label=nodes(lines()[0]).find(n=>n.type==='input');assert.equal(label.props.defaultValue,'Pilot');assert.equal(label.props.maxLength,runs.LABEL_LENGTH);
 label.props.onBlur({target:{value:'Pilot two'}});label.props.onBlur({target:{value:' Pilot '}});assert.deepEqual(calls.filter(c=>c[0]==='label'),[['label',1,'Pilot two']],'An unchanged label is not saved again');
 // Retry failed: the number of requests, and run 2 (nothing failed) has none.
 const buttons=row=>nodes(row).filter(n=>n.type==='button').map(n=>[text(n),n]);
 assert.deepEqual(buttons(lines()[0]).map(([name])=>name),['Settings','Retry failed (1)','Show in Workspace','Delete']);
 assert.deepEqual(buttons(lines()[1]).map(([name])=>name),['Settings','Show in Workspace','Delete']);
 buttons(lines()[0])[1][1].props.onClick();assert.deepEqual(calls.at(-1),['retry',1]);assert.equal(asked.length,0,'A few requests of an instant run are sent without asking');
 // A locked workspace (a run under way) offers no retry or label change.
 const locked=mount(panel.RunsPanel,{...props,locked:true}),lockedRow=nodes(locked.tree()).filter(n=>n.type==='tr')[1];
 assert(nodes(lockedRow).find(n=>n.type==='input').props.disabled);assert(nodes(lockedRow).filter(n=>n.type==='button'&&text(n).startsWith('Retry failed')).every(n=>n.props.disabled));
 // A run that was made as a batch is asked about: a retry is sent now, at the full price.
 const batchRun={...dataset,rows:[...rows,{id:'d',name:'d.txt',status:'error',...setup,model:'gpt-6.1-terra',runNo:2,error:'Expired',processing:'batch',batchId:'batch_1'}]};
 const batched=mount(panel.RunsPanel,{...props,datasets:[batchRun,knowledge]}),batchLine=nodes(batched.tree()).filter(n=>n.type==='tr')[2];
 const retry=nodes(batchLine).find(n=>n.type==='button'&&text(n).startsWith('Retry failed'));
 asked=[];global.confirm=message=>{asked.push(message);return false;};retry.props.onClick();
 assert.deepEqual(asked,['Send 1 request of run #2 again now? They go out as immediate requests at the full price (this run was made as a batch, at half price), with the settings of the run, and the answers join the run.']);assert.notDeepEqual(calls.at(-1),['retry',2],'Nothing is sent when the question is declined');
 // The Settings window: the run's settings, the prompt, and the request every text was sent with.
 buttons(lines()[0])[0][1].props.onClick();
 const dialog=nodes(view.tree()).find(n=>typeof n.type==='function'&&n.type.name==='RunSettings');assert(dialog,'The settings window opens');
 current=instance();const settings=dialog.type(dialog.props);
 const words=text(settings);
 for(const part of ['Run #1 settings · Pilot','OpenAI (ChatGPT) / gpt-6-luna','Prompt caching','Annotations per text','the model’s own','12,000 (the Lab’s own limit)','All texts (2)','1 request sent again','Classify tone','https://api.openai.com/v1/responses','It was kept when the run was made.','No API key is part of it.'])assert(words.includes(part),part);
 assert(text(settings).includes('"instructions": "Classify tone"'),'The shared request body is shown as JSON');
 // Model knowledge: the same columns but the label and the scope; failed subjects are retried in Model knowledge.
 const kview=mount(panel.RunsPanel,props);kview.tree();
 const segment=nodes(kview.tree()).find(n=>n.props?.role==='group'&&n.props['aria-label']==='Data');
 nodes(segment).filter(n=>n.type==='button')[1].props.onClick();
 const ktable=nodes(kview.tree()).find(n=>n.type==='table'&&String(n.props.className).includes('research-runs'));
 assert.deepEqual(nodes(ktable).filter(n=>n.type==='th'&&n.props.children!==undefined).map(text).slice(0,9),['Run','Started','Model','Prompt','Status','OK / failed','Tokens in / out','Cache read / write','Cost']);
 const krow=nodes(ktable).filter(n=>n.type==='tr')[1];
 assert.deepEqual(nodes(krow).filter(n=>n.type==='button').map(text),['Settings']);assert.equal(nodes(krow).filter(n=>n.type==='input').length,0);
 assert(text(krow).includes('failed'));
}

// The page: the run buttons name what they cover, a label is saved with the study, and "Retry failed" is
// offered only in research mode (Runs & agreement exists only there).
{
 const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8');
 assert(page.includes("onRenameRun={renameRun} onRetryRun={retryRun}"));
 assert(page.includes("begunRuns=research?addScope(begun.runs,begun.number,scope||(all?'':`One text: ${eligible[0].name}`)):begun.runs"),'The standard Lab records no scope');
 assert(/const \{provider,model,effort,prompt,sentFields,sentSettings,sentRequest,times,insertNames,placed,key,layout\}=retryOf\?\.use\|\|useNow;/.test(page),'A run reads every setting it sends from one place');
 assert(page.includes("key:runKey,layout:record.layout};"),'Retry failed sends a run’s requests in the layout it was made with');
}
console.log('Runs table: label, scope, status, requests, tokens, cache use, a settings window, and Retry failed within a run.');
