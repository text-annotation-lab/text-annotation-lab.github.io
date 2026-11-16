// Research mode, Model knowledge: the results table reads one row per subject (its latest run, or the run chosen)
// with the Workspace's search, filters, and comparisons; deleting a subject keeps its rows that a run sent a
// request for, marked as removed, and deletes the rest. The rules are in lib/research/removed.ts and
// lib/research/knowledge.ts; the page's part (the table, selection, run buttons, and More menu) is checked in a
// browser with a stand-in provider.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>{
  const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;
  if(target===null)return req(id);
  return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');
 };
 new Function('exports','require',code)(exports,local);return exports;
}
const removed=load('lib/research/removed.ts'),knowledge=load('lib/research/knowledge.ts'),view=load('lib/research/view.ts');
const fields=name=>[{heading:'Subject',value:name}];
const item=(id,subject,run,extra={})=>({id,subjectId:subject,runNumber:run,name:subject,fields:fields(subject),status:'pending',...extra});
const done=(id,subject,run,score,extra={})=>item(id,subject,run,{status:'done',score,explanation:'Because.',...extra});
const ids=list=>list.map(row=>row.id).join(' ');

(async()=>{
 // Rows sent to the model: a result, done or failed, a request under way, or failed attempts waiting.
 assert.equal(removed.sentForSubject(item('a','A',1)),false);
 assert.equal(removed.sentForSubject(done('a','A',1,'3')),true);
 assert.equal(removed.sentForSubject(item('a','A',1,{status:'error'})),true);
 assert.equal(removed.sentForSubject(item('a','A',1,{status:'queued'})),true);
 assert.equal(removed.sentForSubject(item('a','A',1,{history:[{error:'Timed out'}]})),true);

 // Three subjects: A annotated in runs 1 and 2, B annotated in run 1 and waiting for run 2, C never annotated.
 const items=[done('a1','A',1,'2'),done('b1','B',1,'3'),item('c1','C',1),done('a2','A',2,'4'),item('b2','B',2)];
 const out=removed.removeSubjects(items,[],new Set(['B','C']),'2026-11-16T12:00:00.000Z');
 assert.equal(ids(out.items),'a1 a2');
 assert.equal(ids(out.removed),'b1');
 assert.equal(out.removed[0].removedAt,'2026-11-16T12:00:00.000Z');
 assert.equal(out.removed[0].removedPlace,1,'kept in its place among the rows');
 assert.deepEqual([out.kept,out.deleted],[1,1]);
 // Back in their places for the runs and the exports; deleting again leaves a removed row as it is.
 assert.equal(ids(removed.withRemoved(out.items,out.removed)),'a1 b1 a2');
 const again=removed.removeSubjects(out.items,out.removed,new Set(['A']),'2026-11-17T12:00:00.000Z');
 assert.equal(ids(again.items),'');
 assert.deepEqual(again.removed.map(row=>[row.id,row.removedAt.slice(0,10)]),[['a1','2026-11-17'],['b1','2026-11-16'],['a2','2026-11-17']]);
 // As stored with the study: only well-formed rows that a run used.
 assert.equal(ids(removed.cleanRemovedSubjects([...out.removed,{...item('x','X',1),removedAt:'2026-11-16'},{id:'y'},null])),'b1');
 assert.deepEqual(removed.cleanRemovedSubjects('nothing'),[]);

 // The table: one row per subject, the latest run or the run chosen, narrowed by the filters.
 const rows=knowledge.knowledgeRows(items);
 assert.deepEqual(rows.map(row=>[row.id,row.status,row.runNo,row.itemId]),[['A','done',2,'a2'],['B','pending',2,'b2'],['C','pending',1,'c1']]);
 assert.deepEqual(view.runTag(rows[1]),{run:1,earlier:true},'B waits for run 2; its latest result is from run 1');
 const pick=changes=>view.researchRows(rows,[],{...view.DEFAULT_VIEW,...changes}).rows;
 assert.equal(ids(pick({run:1})),'A B');
 assert.equal(ids(pick({show:'pending'})),'B C');
 assert.equal(ids(pick({query:'c'})),'C');
 const compared=pick({compare:'run:1',show:'disagree'});
 assert.equal(ids(compared),'A');
 assert.deepEqual(compared[0].compared,{own:'4',other:'2',match:false});

 // A study backup carries the removed subjects and checks them as it checks the others.
 const backup=load('lib/study-backup.ts');
 const kept={...done('b1','B',1,'3'),removedAt:'2026-11-16T12:00:00.000Z',removedPlace:1};
 const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup({name:'Deleted subjects',createdAt:'2026-11-16',texts:{docs:[]},knowledge:{items:[done('a1','A',1,'2')],removed:[kept]}}));
 assert.deepEqual(restored.knowledge.removed.map(row=>[row.id,row.removedAt,row.removedPlace]),[['b1','2026-11-16T12:00:00.000Z',1]]);
 const encoded=knowledgeData=>backup.encodeStudyBackup({name:'Deleted subjects',createdAt:'2026-11-16',texts:{docs:[]},knowledge:knowledgeData});
 const refuse=async(knowledgeData,why)=>{const json=await encoded(knowledgeData);assert.throws(()=>backup.decodeStudyBackup(json),why);};
 await refuse({items:[done('b1','B',2,'3')],removed:[kept]},/Duplicate record IDs/);
 await refuse({items:[],removed:[{...kept,fields:[{heading:'Subject',value:' '}]}]},/Missing source data/);

 console.log('Model knowledge controls checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
