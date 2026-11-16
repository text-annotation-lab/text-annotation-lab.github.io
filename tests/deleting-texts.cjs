// Research mode, deleting texts: a text a run used is kept for that run's results, comparisons, and exports, in
// its place among the study's texts; one no run used is deleted outright; added again, a deleted text gets its
// record back; it goes for good once no run uses it. The rules are in lib/research/removed.ts. The page's part
// (the More menu, adding a file again, deleting a run) is in tests/research-mode.cjs.
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
const removed=load('lib/research/removed.ts'),columns=load('lib/research/columns.ts'),imports=load('lib/research/import-texts.ts'),tables=load('lib/research/export-tables.ts');
const doc=(id,extra={})=>({id,name:`text-${id}.txt`,file:new File([`Text ${id}`],`text-${id}.txt`),status:'pending',...extra});
const done=(id,run=1,extra={})=>doc(id,{status:'done',runNo:run,score:'POSITIVE',explanation:'Evidence',...extra});
const names=list=>list.map(d=>d.id).join(' ');

(async()=>{
 // What counts as used by a run: a result (done or failed), an earlier run's result, or a failed attempt waiting.
 assert.equal(removed.usedByRuns(doc('a')),false);
 assert.equal(removed.usedByRuns(done('a')),true);
 assert.equal(removed.usedByRuns(doc('a',{status:'error',runNo:2})),true);
 assert.equal(removed.usedByRuns(doc('a',{earlier:[{runNo:1,status:'done'}]})),true);
 assert.equal(removed.usedByRuns(doc('a',{history:[{runNo:1,status:'error'}]})),true);

 // Delete b, c, d of a–e: b and d were used and are kept, each in its place; c goes.
 const study=[done('a'),done('b'),doc('c'),done('d',2),doc('e')];
 let state=removed.removeTexts(study,[],new Set(['b','c','d']),'2026-11-16T12:00:00.000Z');
 assert.deepEqual([state.kept,state.deleted],[2,1]);
 assert.equal(names(state.docs),'a e');
 assert.deepEqual(state.removed.map(d=>[d.id,d.removedPlace,d.removedAt]),[['b',1,'2026-11-16T12:00:00.000Z'],['d',2,'2026-11-16T12:00:00.000Z']]);
 assert.equal(names(removed.withRemoved(state.docs,state.removed)),'a b d e','The runs read the texts in the order they were added');
 assert.equal(removed.withRemoved(state.docs,[]),state.docs);
 // A text added later goes after them all; deleting a, which a run used, keeps every place right.
 state={...state,docs:[...state.docs,doc('f')]};
 assert.equal(names(removed.withRemoved(state.docs,state.removed)),'a b d e f');
 state=removed.removeTexts(state.docs,state.removed,new Set(['a']),'2026-11-16T13:00:00.000Z');
 assert.equal(names(state.docs),'e f');assert.equal(names(removed.withRemoved(state.docs,state.removed)),'a b d e f');
 assert.deepEqual(state.removed.map(d=>[d.id,d.removedPlace]),[['a',0],['b',1],['d',2]]);
 assert.equal(state.removed.find(d=>d.id==='b').removedAt,'2026-11-16T12:00:00.000Z','An earlier deletion keeps its date');
 // Ids of removed texts, or of texts not in the study, are left alone.
 const same=removed.removeTexts(state.docs,state.removed,new Set(['b','zzz']),'2026-11-16T14:00:00.000Z');
 assert.deepEqual([same.kept,same.deleted,names(same.docs),names(same.removed)],[0,0,'e f','a b d']);

 // After run 2 is deleted, d has no result left and goes for good; a and b stay.
 const afterRun=state.removed.map(d=>d.id==='d'?{...d,status:'pending',runNo:undefined}:d);
 const pruned=removed.pruneRemoved(state.docs,afterRun);
 assert.equal(names(pruned.removed),'a b');assert.equal(names(removed.withRemoved(pruned.docs,pruned.removed)),'a b e f');
 assert.equal(removed.pruneRemoved(state.docs,state.removed).removed,state.removed,'Nothing changes while every removed text is used');

 // Brought back: b returns at the end, with its result; the places of the others stay right.
 const back=removed.bringBack(state.docs,state.removed,new Map([['b',d=>d]]));
 assert.equal(names(back.restored),'b');assert.equal(back.restored[0].status,'done');
 assert(!('removedAt' in back.restored[0])&&!('removedPlace' in back.restored[0]));
 assert.equal(names(removed.withRemoved([...back.docs,...back.restored],back.removed)),'a d e f b');

 // Stored removed texts: only well-formed records that a run still uses.
 assert.deepEqual(removed.cleanRemoved(undefined),[]);
 assert.equal(names(removed.cleanRemoved([done('a',1,{removedAt:'2026-11-16'}),doc('b',{removedAt:'2026-11-16'}),done('c'),null,{id:'d'}])),'a');
 assert.equal(removed.removedOn({removedAt:'2026-11-16T12:00:00.000Z'}),'2026-11-16');assert.equal(removed.removedOn({}),'');

 // A file is a removed text again only with the same name (any letter case) and the same bytes.
 const kept=[done('a',1,{removedAt:'x'}),done('b',1,{removedAt:'x'})];
 const again=new File(['Text a'],'TEXT-a.txt'),changed=new File(['Text b, changed'],'text-b.txt'),other=new File(['Text a'],'other.txt');
 const found=await removed.matchReturning([again,changed,other],kept);
 assert.deepEqual([...found.entries()].map(([file,id])=>[file.name,id]),[['TEXT-a.txt','a']]);
 const twice=await removed.matchReturning([new File(['Text a'],'text-a.txt'),new File(['Text a'],'text-a.txt')],kept);
 assert.equal(twice.size,1,'A removed text comes back once');

 // Texts from a table or pasted text: the same name and text brings a removed one back; a different text under
 // its name gets a new name, so names stay unique with the removed texts too.
 const fitted=await imports.fitIntoStudy([{name:'text-a.txt',text:'Text a',values:['1960']},{name:'text-b.txt',text:'Other',values:[]},{name:'text-e.txt',text:'Text e',values:[]}],[doc('e')],kept);
 assert.deepEqual(fitted.texts.map(t=>[t.name,t.back]),[['text-a.txt','a'],['text-b_2.txt',undefined]]);
 assert.deepEqual([fitted.already,fitted.renamed,fitted.back],[1,1,1]);
 const none=await imports.fitIntoStudy([{name:'text-a.txt',text:'Text a',values:[]}],[]);
 assert.deepEqual([none.texts.length,none.back],[1,0],'Without removed texts nothing changes');
 // A text brought back keeps its values; the table's values are written over them.
 const appended=columns.appendTexts([],[{name:'year',role:'meta'},{name:'tone',role:'label'}],[{name:'text-a.txt',text:'Text a',values:['1961'],back:'a'}],['year'],()=>({...kept[0],cells:['1960','NEGATIVE']}));
 assert.deepEqual(appended.docs[0].cells,['1961','NEGATIVE']);
 assert.deepEqual(columns.appendTexts([],[],[{name:'n.txt',text:'n',values:['x']}],['year'],()=>doc('n')).docs[0].cells,['x'],'A new text is as before');

 // The corpus table marks removed texts, and only when the study has any.
 const dataset=(rows)=>({kind:'texts',rows,runs:[],columns:[{name:'year',role:'meta'}],samples:[]});
 const texts=new Map([['a','Text a'],['e','Text e']]);
 const marked=tables.corpusTable(dataset([{...kept[0],removedAt:'2026-11-16T12:00:00.000Z',cells:['1960']},doc('e',{cells:['1970']})]),[{...kept[0],removedAt:'2026-11-16T12:00:00.000Z',cells:['1960']},doc('e',{cells:['1970']})],texts,new Map());
 assert.deepEqual(marked[0].slice(-2),['removed_from_study','year']);
 assert.deepEqual(marked.slice(1).map(row=>row.slice(-2)),[['2026-11-16','1960'],['','1970']]);
 const plain=tables.corpusTable(dataset([doc('e')]),[doc('e')],texts,new Map());
 assert(!plain[0].includes('removed_from_study'));
 assert.deepEqual(tables.corpusRecords(dataset([{...kept[0],removedAt:'2026-11-16T12:00:00.000Z'}]),[{...kept[0],removedAt:'2026-11-16T12:00:00.000Z'}],texts,new Map())[0].removed_from_study,'2026-11-16');

 // A study backup carries the removed texts, with their files, and refuses one without its file or a repeated id.
 const backup=load('lib/study-backup.ts');
 const gone={...done('a'),removedAt:'2026-11-16T12:00:00.000Z',removedPlace:0};
 const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup({name:'Deleted',createdAt:'2026-11-16',texts:{docs:[doc('e')],removed:[gone]},knowledge:{items:[]}}));
 assert.deepEqual(restored.texts.removed.map(d=>[d.id,d.removedAt,d.removedPlace,d.status,d.file instanceof File]),[['a','2026-11-16T12:00:00.000Z',0,'done',true]]);
 assert.equal(await restored.texts.removed[0].file.text(),'Text a');
 const refuse=async(texts,why)=>assert.throws(()=>backup.decodeStudyBackup(texts),why);
 const encoded=async texts=>backup.encodeStudyBackup({name:'Deleted',createdAt:'2026-11-16',texts,knowledge:{items:[]}});
 await refuse(await encoded({docs:[doc('e')],removed:[{...gone,file:undefined}]}),/Missing source data/);
 await refuse(await encoded({docs:[doc('a')],removed:[gone]}),/Duplicate record IDs/);
 await refuse(await encoded({docs:[],removed:[{...gone,removedAt:undefined}]}),/removed/);

 console.log('Deleting texts checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
