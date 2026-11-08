const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const pending=new Map(),calls=[];
const jsx=(type,props)=>({type,props});
const imports=id=>{
 if(id==='react')return {useState:()=>[0,()=>{}],useEffect:()=>{}};
 if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
 if(id==='@/components/ui/tabs')return {TabsContent:'TabsContent'};
 calls.push(id);return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
};
const mod={};new Function('exports','require',ts.transpileModule(fs.readFileSync('components/reading-panels.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText)(mod,imports);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 assert.equal(mod.prepareReadingPanel('workspace'),undefined);assert.equal(mod.ReadingPanels({section:'workspace'}),null);
 const first=mod.prepareReadingPanel('tips');assert.equal(mod.prepareReadingPanel('corpus'),first,'Shared teaching sections reuse the same in-flight import');await tick();
 const Teaching=()=>null;pending.get('./teaching-panels').resolve({TeachingPanels:Teaching});await first;
 for(const section of ['tips','corpus','resources']){assert.equal(mod.prepareReadingPanel(section),undefined);assert.equal(mod.ReadingPanels({section}).type,Teaching,'A cached section renders immediately without a loading frame');}
 const about=mod.prepareReadingPanel('about');await tick();const About=()=>null;pending.get('./about').resolve({About});await about;
 assert.equal(mod.ReadingPanels({section:'about'}).type,About);assert.equal(mod.ReadingPanels({section:'tips'}).type,Teaching,'Other visits do not evict previously loaded components');
 const failure=mod.prepareReadingPanel('study-example'),rejected=assert.rejects(failure,/Offline/);await tick();pending.get('./study-example').reject(new Error('Offline'));await rejected;
 assert.equal(mod.ReadingPanels({section:'study-example'}).type,'TabsContent');
 const retry=mod.prepareReadingPanel('study-example');await tick();const Example=()=>null;pending.get('./study-example').resolve({StudyExample:Example});await retry;
 assert.equal(mod.ReadingPanels({section:'study-example'}).type,Example);assert.equal(calls.filter(id=>id==='./teaching-panels').length,1);
 console.log('PASS: one import per content group, synchronous revisits, retained components, and retry after a failed import.');
})().catch(error=>{console.error(error);process.exitCode=1;});
