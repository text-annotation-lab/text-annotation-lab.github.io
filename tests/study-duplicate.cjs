// Research mode's Duplicate actions in Studies: Duplicate settings & prompt, and Duplicate with texts & subjects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
function load(file){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
(async()=>{
 const {indexedDB}=require('fake-indexeddb');global.indexedDB=indexedDB;
 const nativeClone=global.structuredClone;global.structuredClone=value=>{
  function copy(v){if(v instanceof File)return new File([v],v.name,{type:v.type,lastModified:v.lastModified});if(v instanceof Blob)return v.slice(0,v.size,v.type);if(Array.isArray(v))return v.map(copy);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)]));return v;}return copy(value);
 };
 const dup=load('lib/study-duplicate.ts'),studies=load('lib/studies.ts'),{createWorkspaceStorage,workspaceRevision}=load('lib/workspace-storage.ts');
 const file=new File(['A text.'],'one.txt',{type:'text/plain'}),chunkSource=new File(['Long text.'],'long.txt',{type:'text/plain'});
 const settings={prompt:'Rate it.',answerFields:['score'],answerSettings:{plain:false},model:'gpt-6-luna',effort:'medium',provider:'openai',customModel:'',chunkWords:500,chunkMethod:'words',processing:'batch',concurrency:16,repeats:3,requestSettings:{system:'Be careful.',caching:true},scoreScale:{min:-3,max:3},provenance:{importedAt:'2026-11-01'}};
 const texts={...settings,
  docs:[
   {id:'d1',name:'one.txt',file,cells:['1975','pilot'],chartYear:1975,chartGroup:'A',status:'done',score:'3',explanation:'Because.',runId:'r1',runNo:2,earlier:[{runNo:1,score:'2'}],requestId:'q1',modelReported:'gpt-6-luna-2026',usage:{inputTokens:9},history:[{status:'error'}],annotations:[{score:'3'}],layout:'message',batchId:'b1'},
   {id:'d2',name:'long.txt (1/2)',file:new File(['Long'],'long-1.txt'),sourceId:'src',sourceName:'long.txt',sourceFile:chunkSource,chunkIndex:0,chunkCount:2,wordsPerChunk:500,wordStart:1,wordEnd:500,status:'error',error:'Timed out.'},
   {id:'d3',name:'gone.txt',file,status:'done',score:'1',removedAt:'2026-11-10'}],
  columns:[{name:'year',role:'meta'},{name:'gold',role:'label'}],samples:[{name:'sample',value:'validation',ids:['d1']}],
  removed:[{id:'d4',name:'old.txt'}],requests:[{id:'q1',url:'https://api.openai.com/v1/responses',body:'{}'}],runs:[{number:1},{number:2}],batchJob:null,revision:7,snapshot:true};
 const knowledge={prompt:'Is it known?',answerFields:[],mode:'table',headings:'Title\tYear',webSearch:true,input:'Dracula\t1897',processing:'now',concurrency:4,repeats:1,requestSettings:{caching:false},
  items:[
   {id:'k1',subjectId:'k1',runNumber:1,name:'Jaws · 1975',fields:[{heading:'Title',value:'Jaws'},{heading:'Year',value:'1975'}],cells:['x'],status:'done',score:'KNOWN',research:{text:'found'},requestId:'q2'},
   {id:'k2',subjectId:'k1',runNumber:2,name:'Jaws · 1975',fields:[{heading:'Title',value:'Jaws'},{heading:'Year',value:'1975'}],status:'done',score:'KNOWN'},
   {id:'k3',subjectId:'k3',runNumber:1,name:'Alien',fields:[{heading:'Title',value:'Alien'}],status:'error',error:'No reply.'},
   {id:'k4',name:'Gone',fields:[{heading:'Title',value:'Gone'}],status:'pending',removedAt:'2026-11-12'}],
  columns:[{name:'era',role:'meta'}],samples:[],requests:[{id:'q2',url:'x',body:'{}'}],batchJob:null};

 // Settings and prompt only: no texts, subjects, columns, samples, or anything of a run.
 const [bare,bareK]=dup.duplicateWorkspaces([texts,knowledge],false);
 for(const [key,value] of Object.entries(settings))assert.deepEqual(bare[key],value,'Settings & prompt keeps '+key);
 for(const key of ['docs','columns','samples','removed','requests','runs','batchJob'])assert(!(key in bare),'Settings & prompt leaves out '+key);
 assert.deepEqual(Object.keys(bareK).sort(),['answerFields','concurrency','headings','mode','processing','prompt','repeats','requestSettings','webSearch'],'Model knowledge keeps its prompt and settings only');
 // With texts: each text as it was before it was annotated, with its columns; removed texts are not copied.
 const [full,fullK]=dup.duplicateWorkspaces([texts,knowledge],true);
 assert.deepEqual(full.docs.map(d=>d.id),['d1','d2']);
 assert.deepEqual(Object.keys(full.docs[0]).sort(),['cells','chartGroup','chartYear','file','id','name','status']);
 assert.equal(full.docs[0].status,'pending');assert.equal(full.docs[0].file,file,'The file itself is kept');assert.deepEqual(full.docs[0].cells,['1975','pilot']);
 assert.equal(full.docs[1].sourceFile,chunkSource);assert.equal(full.docs[1].chunkCount,2);assert.equal(full.docs[1].status,'pending');assert(!('error' in full.docs[1]));
 assert.deepEqual(full.columns,texts.columns);assert.deepEqual(full.samples,texts.samples);
 for(const key of ['removed','requests','runs','batchJob'])assert(!(key in full),'With texts still leaves out '+key);
 assert.deepEqual(fullK.items,[
  {id:'k1',name:'Jaws · 1975',fields:knowledge.items[0].fields,cells:['x'],subjectId:'k1',runNumber:1,status:'pending'},
  {id:'k3',name:'Alien',fields:knowledge.items[2].fields,subjectId:'k3',runNumber:1,status:'pending'}],'One row per subject, without its results');
 assert.equal(fullK.input,'Dracula\t1897');assert.deepEqual(fullK.columns,knowledge.columns);
 assert.deepEqual(dup.duplicateWorkspaces([undefined,{deleted:true}],true),[undefined,undefined],'An empty workspace stays empty');
 assert.equal(dup.copyName('Pilot'),'Pilot (copy)');assert.equal(dup.copyName('x'.repeat(80)).length,80);

 // In browser storage: the copy replaces the working copy in one step; saved studies stay as they were.
 const tStore=createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID)),kStore=createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID,true));
 await studies.studySnapshot('initialize');await tStore.restore();await kStore.restore();
 await tStore.save(texts);await kStore.save(knowledge);
 const now=()=>[workspaceRevision(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID)),workspaceRevision(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID,true))];
 const untitled=await studies.studySnapshot('duplicate',{revisions:now(),withTexts:true});assert.deepEqual(untitled.working,{name:'Untitled working copy'},'An untitled working copy’s copy stays untitled');
 await Promise.all([tStore.restore(),kStore.restore()]);await tStore.save(texts);await kStore.save(knowledge);
 const saved=await studies.studySnapshot('save-new',{name:'Pilot',revisions:now()});assert.equal(saved.working.name,'Pilot');
 await assert.rejects(()=>studies.studySnapshot('duplicate',{revisions:[0,0]}),/Another tab/,'A stale tab cannot duplicate');
 const copied=await studies.studySnapshot('duplicate',{revisions:now(),withTexts:true});
 assert.deepEqual(copied.working,{name:'Pilot (copy)'},'The copy opens unsaved, named after the study');
 assert.equal(copied.studies.length,saved.studies.length,'Nothing is added to the saved studies');
 const t2=createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID)),k2=createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID,true));
 const [ct,ck]=await Promise.all([t2.restore(),k2.restore()]);
 assert.deepEqual(ct.docs.map(d=>[d.id,d.status]),[['d1','pending'],['d2','pending']]);assert.equal(ct.prompt,'Rate it.');assert(!ct.runs&&!ct.requests);
 assert.equal(await ct.docs[0].file.text(),'A text.');assert.deepEqual(ck.items.map(i=>i.id),['k1','k3']);
 const original=createWorkspaceStorage(studies.studyWorkspaceKey(saved.working.sourceId));const kept=await original.restore();
 assert.equal(kept.docs[0].score,'3','The saved study keeps its results');assert.equal(kept.runs.length,2);
 // Save and duplicate: the work is saved under a new name first, then the copy of it opens.
 await t2.save({...ct,prompt:'Changed prompt.'});
 const both=await studies.studySnapshot('save-and-duplicate',{name:'Pilot v2',revisions:now(),withTexts:false});
 assert.deepEqual(both.working,{name:'Pilot v2 (copy)'});assert(both.studies.some(s=>s.name==='Pilot v2'));
 const v2=both.studies.find(s=>s.name==='Pilot v2');const v2Store=createWorkspaceStorage(studies.studyWorkspaceKey(v2.id));assert.equal((await v2Store.restore()).prompt,'Changed prompt.');
 const t3=createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID));const c3=await t3.restore();assert.equal(c3.prompt,'Changed prompt.');assert(!c3.docs,'Settings & prompt copies no texts');
 await createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID,true)).restore();
 await assert.rejects(()=>studies.studySnapshot('save-and-duplicate',{name:'Pilot',revisions:now()}),/already has that name/);
 // A working copy with a batch at the provider is never duplicated (its results could not be collected).
 await t3.save({...c3,batchJob:{id:'b9'}});
 await assert.rejects(()=>studies.studySnapshot('duplicate',{revisions:now()}),/saved batch/);
 global.structuredClone=nativeClone;

 // The page: research mode only, in More options.
 const manager=fs.readFileSync('components/study-manager.tsx','utf8'),page=fs.readFileSync('app/page.tsx','utf8');
 assert(page.includes('<StudyManager compact={research} duplicates={research}>'),'Only research mode offers the Duplicate actions');
 assert(manager.includes("{duplicates&&<><button className=\"textbutton\" disabled={disabled} onClick={()=>openFresh('settings')}>Duplicate settings & prompt</button><button className=\"textbutton\" disabled={disabled} onClick={()=>openFresh('texts')}>Duplicate with texts & subjects</button></>}"));
 console.log('PASS: Duplicate settings & prompt and Duplicate with texts & subjects copy what they name and nothing of a run, keep saved studies as they were, save first when asked, and refuse a stale tab or a saved batch.');
})().catch(e=>{console.error(e);process.exit(1);});
