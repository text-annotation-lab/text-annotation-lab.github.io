// Saving keeps in step with a fast run: every save holds the whole workspace, so an autosave that
// is still waiting gives way to a newer save. A save made on purpose is always written.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
const {indexedDB,IDBObjectStore}=require('fake-indexeddb');
global.indexedDB=indexedDB;
function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
(async()=>{
 const {createWorkspaceStorage,workspaceRevision}=load('lib/workspace-storage.ts');
 const storage=createWorkspaceStorage('saving-test');await storage.restore();
 const put=IDBObjectStore.prototype.put,written=[];
 IDBObjectStore.prototype.put=function(value,key){if(key==='saving-test')written.push(value.n);return put.call(this,value,key);};
 const auto={replaceable:true},started=()=>new Promise(resolve=>setImmediate(resolve));

 // Three hundred results in one burst: one write, of the newest, and every caller hears of it.
 let calls=Array.from({length:300},(_,i)=>storage.save({n:i+1},auto));
 assert.equal(new Set(calls).size,1);await Promise.all(calls);
 assert.deepEqual(written,[300]);assert.equal((await storage.restore()).n,300);assert.equal(workspaceRevision('saving-test'),1);

 // While one write is under way, the autosaves behind it collapse into the newest.
 written.length=0;
 const under=storage.save({n:'a'},auto);await Promise.resolve();
 calls=['b','c','d'].map(n=>storage.save({n},auto));
 assert.notEqual(calls[0],under);assert.equal(calls[0],calls[2]);await Promise.all([under,...calls]);
 assert.deepEqual(written,['a','d']);assert.equal((await storage.restore()).n,'d');

 // A save made on purpose (the reference of a batch about to be submitted) is written, whatever follows it.
 written.length=0;
 const first=storage.save({n:'running'},auto);await Promise.resolve();
 const job=storage.save({n:'job'}),after=storage.save({n:'later'},auto),last=storage.save({n:'latest'},auto);
 assert.notEqual(job,after);assert.equal(after,last);await Promise.all([first,job,after,last]);
 assert.deepEqual(written,['running','job','latest']);
 // It takes the place of an autosave still waiting, and is not replaced in turn.
 written.length=0;
 const busy=storage.save({n:'running'},auto);await Promise.resolve();
 const stale=storage.save({n:'stale'},auto),purpose=storage.save({n:'job'}),next=storage.save({n:'next'},auto);
 assert.equal(stale,purpose);assert.notEqual(purpose,next);await Promise.all([busy,stale,purpose,next]);
 assert.deepEqual(written,['running','job','next']);
 // Without the option nothing is skipped, as before.
 written.length=0;await Promise.all([1,2,3].map(n=>storage.save({n})));assert.deepEqual(written,[1,2,3]);

 // A write that fails is reported to everyone who was waiting on it, and later saves still run.
 written.length=0;
 const other=createWorkspaceStorage('saving-test');await other.restore();await other.save({n:'another tab'});
 const failed=await Promise.allSettled([storage.save({n:'x'},auto),storage.save({n:'y'},auto)]);
 assert.deepEqual(failed.map(result=>result.status),['rejected','rejected']);assert.match(failed[0].reason.message,/^Another tab saved changes\./);
 assert.deepEqual(written,['another tab']);assert.equal((await other.restore()).n,'another tab');
 await assert.rejects(storage.save({n:'z'},auto),/Another tab/);
 IDBObjectStore.prototype.put=put;await started();
 console.log('PASS: a waiting autosave gives way to a newer save; saves made on purpose, failures, and revisions are kept.');
})().catch(error=>{console.error(error);process.exitCode=1;});
