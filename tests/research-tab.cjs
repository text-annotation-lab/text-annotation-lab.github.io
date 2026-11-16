// Research mode works in one tab at a time (lib/research/tab-lock.ts): the lock itself with two stand-in tabs of one
// browser, and the page around the workspace (Home), which shows a notice instead of the Lab in a tab that opens in
// research mode while another tab has it. The standard Lab takes no part.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
const root=process.cwd();
function transpile(file,require,scope={}){
 const exports={};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('exports','require',...Object.keys(scope),code)(exports,require,...Object.values(scope));return exports;
}
function localModule(file){return transpile(file,id=>id.startsWith('.')?localModule(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id));}
const {tabLock,LOCK}=localModule('lib/research/tab-lock.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve)),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function settle(){for(let n=0;n<6;n++)await tick();}

// The browser's Web Locks, shared by the tabs of one browser: a lock asked for with ifAvailable is given at once or
// refused, also to the tab that holds it, and held until the callback's promise settles (or the tab is closed).
function browser(){
 let holder=null,release=null;const requests=[];
 return {
  requests,holder:()=>holder,
  close(tab){if(holder===tab){holder=null;release?.();}},
  locks(tab){return {request(name,options,callback){
   requests.push({tab,name,options});
   return Promise.resolve().then(async()=>{
    if(holder!==null)return callback(null);
    holder=tab;
    const closed=new Promise(resolve=>{release=resolve;});
    try{return await Promise.race([callback({name}),closed]);}finally{if(holder===tab)holder=null;}
   });
  }};},
 };
}
function tab(shared,name,focused=()=>true){
 const seen=[];const lock=tabLock(shared.locks(name),waiting=>seen.push(waiting),focused);
 return {lock,seen,waiting:()=>seen.at(-1)};
}

(async()=>{
 // Two tabs: the first gets research mode, the second is refused and shows the notice.
 {const shared=browser(),a=tab(shared,'a'),b=tab(shared,'b');
  assert.equal(await a.lock.ask(),true);assert.equal(shared.holder(),'a');assert.equal(a.lock.held(),true);assert.equal(a.waiting(),false);
  assert.equal(shared.requests[0].name,LOCK);assert.equal(LOCK,'text-annotation-lab-research');assert.deepEqual(shared.requests[0].options,{ifAvailable:true});
  assert.equal(await b.lock.ask(),false);assert.equal(b.waiting(),true);assert.equal(b.lock.held(),false);
  // Asking again in the tab that has it sends nothing.
  const sent=shared.requests.length;assert.equal(await a.lock.ask(),true);assert.equal(shared.requests.length,sent);
  // visibilitychange and focus together send one request.
  const before=shared.requests.length;const both=await Promise.all([b.lock.ask(),b.lock.ask()]);
  assert.deepEqual(both,[false,false]);assert.equal(shared.requests.length,before+1);
  // The first tab turns research mode off: the second gets it when the user turns to it.
  a.lock.release();await settle();assert.equal(shared.holder(),null);assert.equal(a.lock.held(),false);
  assert.equal(await b.lock.ask(),true);assert.equal(b.waiting(),false);assert.equal(shared.holder(),'b');
  // And the first is refused now; a claim (switching on in the standard Lab) does not show the notice.
  const shown=a.seen.length;assert.equal(await a.lock.claim(),false);assert.equal(a.seen.length,shown);
  shared.close('b');await settle();
  assert.equal(await a.lock.claim(),true);assert.equal(shared.holder(),'a');
 }
 // At page load, a refused tab asks again a few times for a moment, also without the focus: a page loaded in place of
 // the Lab's own page asks before the old page has let go.
 {const shared=browser(),a=tab(shared,'a'),b=tab(shared,'b',()=>false);
  await a.lock.ask();assert.equal(await b.lock.ask(),false);assert.equal(b.waiting(),true);
  shared.close('a');await wait(650);await settle();
  assert.equal(shared.holder(),'b');assert.equal(b.lock.held(),true);assert.equal(b.waiting(),false);
 }
 // After that, a tab the user has left stops asking; one that keeps the focus asks again.
 {const shared=browser(),a=tab(shared,'a');await a.lock.ask();
  let focus=false;const b=tab(shared,'b',()=>focus);
  await b.lock.ask();await wait(1600);const asked=shared.requests.filter(r=>r.tab==='b').length;
  assert.equal(await b.lock.ask(),false);shared.close('a');await wait(650);await settle();
  assert.equal(shared.holder(),null,'A tab the user has left does not take research mode');assert(shared.requests.filter(r=>r.tab==='b').length<=asked+1);
  const again=tab(shared,'again');await again.lock.ask();focus=true;assert.equal(await b.lock.ask(),false);shared.close('again');await wait(650);await settle();
  assert.equal(shared.holder(),'b','A focused tab gets it a moment after the other tab closes');
 }
 // Research mode turned off while a request is on its way: the lock is let go at once.
 {const shared=browser(),a=tab(shared,'a');const asking=a.lock.claim();a.lock.release();
  await asking;await settle();assert.equal(shared.holder(),null);assert.equal(a.lock.held(),false);
  assert.equal(await a.lock.claim(),true,'Asked again afterwards, it is given');
 }
 // Locks unusable (e.g. a sandboxed frame): research mode works without them.
 {const seen=[];const broken=tabLock({request:()=>Promise.reject(new DOMException('denied','SecurityError'))},w=>seen.push(w),()=>true);
  assert.equal(await broken.ask(),true);assert.equal(broken.held(),true);assert.notEqual(seen.at(-1),true);
  // But not when the lock answered and only this tab's own handling failed: another tab may hold it.
  const answered=tabLock({request:async(name,options,callback)=>{callback(null);throw new Error('after the answer');}},()=>{},()=>true);
  assert.equal(await answered.ask(),false);assert.equal(answered.held(),false);
 }

 // The page around the workspace (Home), with a small hook harness and stand-ins for the browser.
 const page=homeHarness();
 // The standard Lab: no lock is asked for, and the Lab opens at once.
 {const shared=browser(),h=page(shared,'a',null);await h.flush();
  assert.equal(h.workspace().research,false);assert.equal(shared.requests.length,0);assert.equal(h.notice(),undefined);
 }
 // Research mode with no other tab: the Lab opens in research mode (nothing is shown while asking, a few ms).
 {const shared=browser(),h=page(shared,'a','research');assert.equal(h.tree(),null,'Nothing is loaded before the answer');
  await h.flush();assert.equal(h.workspace().research,true);assert.equal(shared.holder(),'a');assert.equal(h.notice(),undefined);
  // Turning research mode off in the workspace lets it go.
  h.workspace().onResearch(false);await h.flush();assert.equal(shared.holder(),null);assert.equal(h.workspace().research,false);
  // Switching on asks once.
  assert.equal(await h.workspace().claimResearch(),true);h.workspace().onResearch(true);await h.flush();assert.equal(shared.holder(),'a');assert.equal(h.workspace().research,true);
  assert.equal(h.workspace().claimResearch(),true,'Held: answered at once');
 }
 // Research mode while another tab has it: a notice instead of the Lab, with the header, the switch, and the footer.
 {const shared=browser(),other=tab(shared,'other');await other.lock.ask();
  const h=page(shared,'b','research');await h.flush();
  assert.equal(h.workspace(),undefined,'The study is not loaded in a waiting tab');
  const notice=h.notice();assert(notice);assert.equal(typeof notice.props.openHere,'function');
  assert.equal(h.find(n=>n.type==='header').props.className,'research-header');assert.equal(h.find(n=>n.type==='ModeSwitch').props.on,true);assert(h.find(n=>n.type==='footer'));
  // Open here while the other tab still has it: still waiting.
  assert.equal(await notice.props.openHere(),false);await h.flush();assert(h.notice());
  // The other tab is closed; the user comes back to this one (focus): it opens, loading the study afresh.
  other.lock.release();await settle();const asked=shared.requests.length;
  h.fire('focus');await h.flush();assert(shared.requests.length>asked);
  assert.equal(h.notice(),undefined);assert.equal(h.workspace().research,true);assert.equal(shared.holder(),'b');
 }
 // The switch in a waiting tab goes back to the standard Lab, which opens at once, and is remembered.
 {const shared=browser(),other=tab(shared,'other');await other.lock.ask();
  const h=page(shared,'b','research');await h.flush();assert(h.notice());
  h.find(n=>n.type==='ModeSwitch').props.onChange(false);await h.flush();
  assert.equal(h.notice(),undefined);assert.equal(h.workspace().research,false);assert.equal(h.storage.getItem('text-annotation-lab:mode'),null);
  const asked=shared.requests.length;h.fire('focus');h.fire('visibilitychange');await h.flush();assert.equal(shared.requests.length,asked,'The standard Lab asks for nothing');
  assert.equal(shared.holder(),'other');
 }
 // Browsers without Web Locks open research mode directly.
 {const h=page(null,'a','research');assert.notEqual(h.tree(),null);await h.flush();assert.equal(h.workspace().research,true);assert.equal(h.workspace().claimResearch,undefined);}
 console.log('Research mode tab checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});

function homeHarness(){
 return (shared,name,mode)=>{
  const slots=[],effects=[],listeners=new Map();let cursor=0,pending=[],dirty=true,tree;
  const react={useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useMemo(fn,deps){const i=cursor++,slot=slots[i];if(slot&&slot.deps.length===deps.length&&slot.deps.every((d,j)=>Object.is(d,deps[j])))return slot.value;const value=fn();slots[i]={value,deps};return value;},useEffect(fn,deps){const i=cursor++,previous=effects[i];if(!previous||!deps||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){pending.push(()=>{previous?.cleanup?.();effects[i]={deps,cleanup:fn()};});}}};
  const jsx=(type,props)=>({type,props});
  const items=new Map(),storage={getItem:key=>items.has(key)?items.get(key):null,setItem:(key,value)=>items.set(key,String(value)),removeItem:key=>items.delete(key)};
  if(mode)storage.setItem('text-annotation-lab:mode',mode);
  const on=(name,fn)=>listeners.set(name,fn),off=name=>listeners.delete(name);
  const window={localStorage:storage,addEventListener:on,removeEventListener:off};window.parent=window;
  const document={visibilityState:'visible',hasFocus:()=>true,addEventListener:on,removeEventListener:off};
  const navigator=shared?{locks:shared.locks(name)}:{};
  globalThis.window=window;
  const imports=id=>id==='react'?react:id==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:id==='@/lib/research/tab-lock'||id==='@/lib/research/mode'||id==='@/lib/studies'?localModule(id.slice(2)+'.ts'):new Proxy({},{get:(_,key)=>key==='__esModule'?false:String(key)});
  const Home=transpile('app/page.tsx',imports,{window,document,navigator}).default;
  function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);if(node.type==='StudyManager'&&typeof node.props.children==='function')nodes(node.props.children({id:'working',name:'Study'},null,()=>{},0,{current:{}},()=>{}),out);else nodes(node.props?.children,out);return out;}
  function render(){cursor=0;dirty=false;tree=Home({});const queue=pending;pending=[];queue.forEach(fn=>fn());}
  async function flush(){for(let n=0;n<10;n++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));}globalThis.window=window;return tree;}
  const all=predicate=>nodes(tree).filter(predicate),find=predicate=>all(predicate)[0];
  render();
  return {flush,tree:()=>tree,find,storage,fire:name=>listeners.get(name)?.(),notice:()=>find(n=>n.type==='OtherTabNotice'),workspace:()=>find(n=>typeof n.type==='function'&&n.type.name==='StudyWorkspace')?.props};
 };
}
