// Research mode, the study's scale for the scores beyond the agreement figures: with several annotations per text,
// a number off the scale is left out of a text's combined score when another annotation is on it, the exports count
// how many were, and "Disagree" and "Agree" leave a value off the scale out. The rules are in
// lib/research/scale-combine.ts and lib/research/view.ts. (A yes / no in numbers: tests/score-pairing.cjs.)
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
const repeats=load('lib/research/repeats.ts'),combine=load('lib/research/scale-combine.ts'),view=load('lib/research/view.ts');
const data=load('lib/research/export-data.ts'),tables=load('lib/research/export-tables.ts'),packages=load('lib/research/export-packages.ts');
const SCALE={min:-3,max:3};
const reply=(race,explanation,extra={})=>JSON.stringify({race,...extra,explanation});
const annotation=(n,f0)=>({n,status:'done',answers:{f0},startedAt:`2026-11-16T10:0${n}:00.000Z`,time:`2026-11-16T10:0${n}:05.000Z`,processing:'instant',usage:{prompt_tokens:100,completion_tokens:20}});
const setup={provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',prompt:'Rate.',answerFields:['response'],answerSettings:{plain:true},repeats:3};
const text=(id,races,label,extra=[])=>{
 const doc={...setup,id,name:id+'.txt',file:new File(['Text '+id+'.'],id+'.txt'),status:'done',runNo:2,cells:[label],annotations:races.map((race,i)=>annotation(i+1,reply(race,'Because '+'ABC'[i]+'.',extra[i])))};
 return Object.assign(doc,repeats.settle(doc));
};
const race=row=>JSON.parse(row.answers.f0).race;

(async()=>{
 // Combining: the numbers on the scale count when a text has any; otherwise all of them, as before.
 const keep=key=>key==='race'?x=>x>=-3&&x<=3:undefined,counted={n:0};
 const f0=repeats.combinePlain([annotation(1,reply(-2,'A')),annotation(2,reply(9,'B')),annotation(3,reply(-1,'C'))],keep,counted);
 assert.deepEqual(JSON.parse(f0),{race:-1.5,explanation:'A'},'The 9 is left out of the median, and the explanation is that of an annotation closest to it');
 assert.equal(counted.n,1);
 assert.equal(JSON.parse(repeats.combinePlain([annotation(1,reply(9,'A')),annotation(2,reply(9,'B'))],keep,counted)).race,9,'Every number off the scale: combined as before');
 assert.equal(counted.n,1);
 assert.equal(JSON.parse(repeats.combinePlain([annotation(1,reply(-2,'A')),annotation(2,reply(9,'B')),annotation(3,reply(-1,'C'))])).race,-1,'Without the scale: as before');

 // Run 2 annotates each text three times; run 1, before it, once.
 const rows=[
  text('t1',[-2,9,-1],'-2'),
  text('t2',[9,9,9],'9'),
  text('t3',[1,2,2],'2'),
  text('t4',[3,99,2],'NA',[{confidence:80},{confidence:90},{confidence:70}]),
  text('t5',[0,0,0],'0'),
  text('t6',[-3,-3,-2],'7'),
 ];
 const once=race=>[{...setup,repeats:undefined,status:'done',runNo:1,answers:{f0:reply(race,'Once.')},annotations:undefined}];
 rows[0].earlier=once(-2);rows[1].earlier=once(9);rows[2].earlier=once(2);rows[4].earlier=once(0);
 assert.deepEqual(rows.map(race),[-1,9,2,3,0,-3],'As stored: the median of every number');
 // Which scores run 2 reads on the scale: race (mostly on it), not a 0–100 confidence.
 assert.deepEqual([...combine.scaleKeysByRun(rows,SCALE).get(2)],[['race','scale']]);
 assert.equal(combine.scaleKeysByRun(rows,undefined).size,0,'Without the scale, no score of these runs has a fixed one');
 assert.equal(combine.scaleKeysByRun(rows,SCALE,true).has(1),false,'Run 1 has nothing to combine');

 const scaled=combine.onScaleRows(rows,SCALE);
 assert.deepEqual(scaled.rows.map(race),[-1.5,9,2,2.5,0,-3]);
 assert.equal(JSON.parse(scaled.rows[3].answers.f0).confidence,80,'The confidence is combined as before');
 assert.deepEqual([...scaled.leftOut],[[2,2]],'Two numbers left out in run 2');
 assert.equal(scaled.rows[2],rows[2],'A text with nothing left out is the same object');
 assert.equal(race(rows[0]),-1,'The stored result does not change');
 assert.equal(combine.onScaleRows(rows,undefined).rows,rows,'No scale: the texts as they are');
 assert.equal(combine.offScaleLeftOut(scaled.rows,2,SCALE),2,'Counted again from the annotations of texts already combined');
 // An earlier result of a text is combined on its own run's scale; a text waiting to be annotated again keeps its earlier results.
 const waiting=[{...rows[0],status:'pending',runNo:undefined,answers:undefined,annotations:undefined,earlier:[{...rows[0],earlier:undefined}]},...rows.slice(1)];
 assert.equal(race(combine.onScaleRows(waiting,SCALE).rows[0].earlier[0]),-1.5);

 // Model knowledge's records (one per subject and run) alike.
 const items=rows.map(row=>({...row,runNumber:1,runNo:undefined,earlier:undefined}));
 assert.deepEqual(combine.onScaleItems(items,SCALE).map(race),[-1.5,9,2,2.5,0,-3]);
 assert.equal(combine.onScaleItems(items,undefined),items);

 // "Disagree" and "Agree" with a column of labels: as the agreement figures compare them.
 const columns=[{name:'race_gold',role:'label'}],pick=(docs,show,scale,compare='col:race_gold')=>view.researchRows(docs,columns,{...view.DEFAULT_VIEW,compare,field:'race',show},scale).rows.map(row=>row.id).join(' ');
 assert.equal(pick(rows,'disagree'),'t1 t6','Without the scale: the values as they are, but for the “NA”, a blank cell in the agreement figures');
 assert.equal(pick(rows,'agree'),'t2 t3 t5');
 assert.equal(pick(scaled.rows,'disagree',SCALE),'t1','On the scale: a 9 and a 7 are left out, and the “NA” is a blank cell');
 assert.equal(pick(scaled.rows,'agree',SCALE),'t3 t5');
 const t2=view.researchRows(scaled.rows,columns,{...view.DEFAULT_VIEW,compare:'col:race_gold',field:'race'},SCALE).rows[1].compared;
 assert.deepEqual(t2,{own:'9',other:'9',match:null});
 // Mostly words in the column: compared as they are.
 const words=scaled.rows.map((row,i)=>({...row,cells:[i<4?'high':'2']}));
 assert.equal(pick(words,'disagree',SCALE),'t1 t2 t3 t4 t5 t6');
 // Another run: the scale applies when both runs read the value on it.
 assert.equal(pick(scaled.rows,'agree',SCALE,'run:1'),'t3 t5','Run 1’s 9 is off the scale');
 assert.equal(pick(scaled.rows,'agree',undefined,'run:1'),'t2 t3 t5');
 assert.equal(pick(scaled.rows.map((row,i)=>i===1?{...row,earlier:once(9)}:{...row,earlier:i===0?once(9):undefined}),'agree',SCALE,'run:1'),'t2','A run that reads the value off the scale: compared as it is');

 // The rule "Disagree" and "Agree" use keeps the same pairs as the agreement figures, for every kind of field.
 const metrics=load('lib/research/metrics.ts'),{comparableValues}=load('lib/research/comparable.ts');
 let seed=7;const random=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
 const cases=[
  {level:'ordinal',allowed:['1','2','3','4','5'],pool:['1','2','3','4','5','2.5','9','NA','high','2 (moderate)']},
  {level:'ordinal',allowed:[],pool:['1','2','3','99','n/a','-']},
  {level:'nominal',allowed:['a','b','c'],pool:['a','b','c','a | b','x','NA','none']},
  {level:'nominal',allowed:['0','1','2'],pool:['0','1','2','1.5','0 | 1','7','NA','?']},
  {level:'ordinal',allowed:[],opts:{scaleSeen:true,range:[-3,3]},pool:['-3','-1','0','2','3','4','9','99','NA','unknown']},
  {level:'ordinal',allowed:[],opts:{scaleSeen:true,range:[0,100]},pool:['0','40','85','100','250','NA']},
  {level:'ordinal',allowed:['1','2','3','4'],opts:{scaleSeen:true},pool:['1','2','3','4','5','6','12','NA']},
  {level:'nominal',allowed:[],opts:{known:['yes','no','none']},pool:['yes','no','none','NA','-','maybe']},
  {level:'nominal',allowed:[],pool:['yes','no','NA']},
 ];
 for(const [c,spec] of cases.entries())for(let round=0;round<300;round++){
  const pick=()=>spec.pool[Math.floor(random()*spec.pool.length)],pairs=Array.from({length:2+Math.floor(random()*8)},()=>[pick(),pick()]);
  const figures=metrics.agreement(pairs.map(p=>p[0]),pairs.map(p=>p[1]),spec.level,spec.allowed,1,{withIntervals:false,...spec.opts});
  const counts=comparableValues(pairs,spec.level,spec.allowed,spec.opts),kept=pairs.filter(([x,y])=>counts(x)&&counts(y)).length;
  assert.equal(kept,figures.n,`Case ${c+1}: ${JSON.stringify(pairs)}`);
 }

 // Exports: the run's record counts the numbers left out, and the methods text says so.
 const runList=[{...setup,number:1,startedAt:'2026-11-16T09:00:00.000Z',repeats:undefined},{...setup,number:2,startedAt:'2026-11-16T10:00:00.000Z'}];
 const dataset={kind:'texts',rows:scaled.rows,runs:runList,columns,samples:[],scoreScale:SCALE},study={name:'Scale study',dataset,lab:'test'};
 const results=tables.resultsTable(study,2);
 assert.deepEqual(results.slice(1).map(line=>line[results[0].indexOf('race')]),['-1.5','9','2','2.5','0','-3'],'The results have the combined scores');
 const build=async study=>packages.buildSupplementary({study,read:data.documentReader(study.dataset,file=>file.text()),now:new Date('2026-11-16T12:00:00.000Z')},2,{texts:false,explanations:true,logs:false});
 const file=async(pack,name)=>{const entry=pack.files.find(item=>item.path===pack.name+'/'+name);assert(entry,name);return typeof entry.data==='string'?entry.data:Buffer.from(entry.data).toString('utf8');};
 const pack=await build(study),metadata=JSON.parse(await file(pack,'metadata.json'));
 assert.equal(metadata.requests.scores_off_scale_left_out_when_combined,2);
 assert((await file(pack,'README.md')).includes('Each text was annotated 3 times; numbers in the answers were combined by the median, other values by majority vote. 2 scores off the scale (for example, a code such as 9 for “can’t tell”) were left out when the answers were combined, like a missing value, where another answer for the same text was on the scale.'));
 // Without the scale, or with nothing left out: neither.
 const plainPack=await build({...study,dataset:{...dataset,rows,scoreScale:undefined}}),plainMeta=JSON.parse(await file(plainPack,'metadata.json'));
 assert(!('scores_off_scale_left_out_when_combined' in plainMeta.requests));
 assert(!(await file(plainPack,'README.md')).includes('scores off the scale'));
 console.log('Scale when combining checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
