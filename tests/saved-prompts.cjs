const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const cache={};function load(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
global.indexedDB=require('fake-indexeddb').indexedDB;
const {readStudyPrompts:listSavedPrompts,listSavedPrompts:library,savePrompt,deletePrompt}=load('lib/saved-prompts.ts');
async function records(values){const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('annotation-desk',1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('workspace',values?'readwrite':'readonly'),store=tx.objectStore('workspace');if(values)for(const [key,value] of Object.entries(values))store.put(value,key);const all=store.getAll();tx.oncomplete=()=>resolve(all.result);tx.onabort=tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
(async()=>{
 assert.deepEqual(await listSavedPrompts(),[]);
 await records({current:{prompt:'Legacy prompt',docs:[{id:'keep',score:'2'}]}});
 assert.equal((await listSavedPrompts())[0].prompt,'Legacy prompt');
 await records({'named-studies-v1':[{id:'current',name:'Original study'},{id:'other',name:'Second study'},{id:'empty',name:'Empty'}], 'study:other:texts':{prompt:'Different rubric',answerFields:['Tone','Complexity'],snapshot:true,revision:7},'study:other:knowledge':{prompt:'Knowledge rubric',items:[{id:'unchanged'}]},'study:empty:texts':{prompt:'   '},'study:empty:knowledge':{deleted:true,prompt:'Do not expose'},'study:working-copy-v2:texts':{prompt:'Unsaved draft'}});
 const before=await records(),prompts=await listSavedPrompts();
 assert.equal(prompts.length,3);assert.deepEqual(prompts.find(p=>p.id==='study:other:texts').answerFields,['Tone','Complexity']);assert.equal(prompts.find(p=>p.workspace==='Model knowledge').prompt,'Knowledge rubric');assert(!prompts.some(p=>p.prompt==='Unsaved draft'));
 assert.deepEqual(await records(),before,'Browsing prompts never changes documents, results, snapshots, or revisions');
 // A refreshed picker reflects later saved/imported versions, not a stale study-local cache.
 await records({'study:other:texts':{prompt:'Updated saved rubric',answerFields:[]}});
 assert.equal((await listSavedPrompts()).find(p=>p.id==='study:other:texts').prompt,'Updated saved rubric');
 const migrated=await library();assert.equal(migrated.length,3);
 const prototype=require('fake-indexeddb').IDBObjectStore.prototype,originalGet=prototype.get,reads=[];
 prototype.get=function(key){reads.push(key);return originalGet.call(this,key);};
 try{await library();}finally{prototype.get=originalGet;}
 assert.deepEqual(reads,['saved-prompt-library-v1'],'Opening the migrated library skips saved workspaces');
 const first=await savePrompt('Reusable rubric','Exactly my prompt',['Tone']);
 assert.equal(first.at(-1).prompt,'Exactly my prompt');
 assert.deepEqual(first.at(-1).answerFields,['Tone']);
 await assert.rejects(()=>savePrompt('reusable rubric','Other',[]),/already in use/);
 await Promise.all([savePrompt('Concurrent A','A',[]),savePrompt('Concurrent B','B',[])]);
 assert.equal((await library()).length,6,'Concurrent additions survive');
 await deletePrompt(migrated[0].id);
 assert.equal((await library()).length,5,'Deleted migrated prompt does not reappear');
 assert.equal((await listSavedPrompts()).length,3,'Deleting a library entry leaves study prompts intact');
 await records({'study:other:texts':{prompt:'Changed again',answerFields:[]}});
 assert.equal((await library()).find(p=>p.id==='study:other:texts').prompt,'Updated saved rubric','Saved library entries are independent of study changes');
 console.log('PASS: independent save/delete, duplicate names, concurrent saves, one-time migration, study preservation; legacy and all-study prompt discovery, both workspaces, answer fields, empty/deleted filtering, refresh, and read-only preservation.');
})().catch(error=>{console.error(error);process.exit(1);});
