// Research mode, scores read from the answers (plain-text replies that are JSON, or a field without a type): how they
// are paired with a coder's column or another run for the agreement figures, "Disagree" and "Agree," and the
// exports. The rules are in lib/research/agreement.ts and lib/research/score-scale.ts.
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
const agree=load('lib/research/agreement.ts'),scales=load('lib/research/score-scale.ts'),repeats=load('lib/research/repeats.ts'),combine=load('lib/research/scale-combine.ts'),view=load('lib/research/view.ts'),exported=load('lib/research/export-agreement.ts');
const columns=[{name:'flag_gold',role:'label'},{name:'flag_coder2',role:'label'}],GOLD={kind:'column',name:'flag_gold'};
const reply=value=>JSON.stringify({flag:value,explanation:'Because.'});
const plain={provider:'openai',model:'gpt-6-luna',effort:'low',prompt:'Rate.',answerFields:['response'],answerSettings:{plain:true}};
// One text per answer: a plain-text run (run 1) and the coder's label.
const texts=(answers,labels,second=[])=>answers.map((value,i)=>({...plain,id:'t'+(i+1),name:'t'+(i+1)+'.txt',status:'done',runNo:1,answers:{f0:reply(value)},cells:[labels[i]??'',second[i]??'']}));
const figures=(rows,scale,b=GOLD,fieldB='')=>{const p=agree.pairSources(rows,columns,{kind:'run',run:1},'flag',b,fieldB,scale);return {p,stats:agree.runJob(agree.agreementJob(p,'auto',1),false)};};
const repeat=(list,times)=>Array.from({length:times},()=>list).flat();

// The rule for a yes / no in numbers.
assert.equal(scales.zeroOne([0,1,1,0]),true);
assert.equal(scales.zeroOne([0,0.5,1]),true,'Every number from 0 to 1');
assert.equal(scales.zeroOne([...repeat([0,1],10),9]),true,'A code far off, at most one answer in ten');
assert.equal(scales.zeroOne([0,1,1,9]),false,'Too many codes');
assert.equal(scales.zeroOne([...repeat([0,1],20),9,99,-9]),false,'More than two different codes');
assert.equal(scales.zeroOne([...repeat([0,1],10),2]),true,'One stray answer near 0 and 1');
assert.equal(scales.zeroOne([...repeat([0,1],10),2,-1]),false,'Two of them among twenty: a scale of its own');
assert.equal(scales.zeroOne([0,1,2,3,2,3]),false);
assert.equal(scales.zeroOne([]),false);

// 0 and 1 against a coder's yes and no: the same yes / no, not twelve disagreements.
let {p,stats}=figures(texts(repeat([0,1,1,0,1,0],2),repeat(['no','yes','yes','no','No','no'],2)));
assert.deepEqual([p.numeric,p.level,p.scaleSeen,p.range,p.allowed,p.zeroOne],[true,'ordinal',true,[0,1],['0','1'],true]);
assert.deepEqual(p.b.slice(0,6),['0','1','1','0','0','0'],'Yes and no are read as 1 and 0');
assert.deepEqual([stats.n,stats.percentAgreement,stats.leftOut.n],[12,10/12,0]);
assert(p.basis.includes('yes / no in numbers'));
// The model's 9 for “can’t tell” and a coder's 9 are left out and reported; the scale stays 0 and 1.
({p,stats}=figures(texts([...repeat([0,1],10),9],[...repeat(['0','1'],9),'9','0','1'])));
assert.deepEqual([p.range,stats.n,stats.leftOut.n,stats.leftOut.values,stats.percentAgreement],[[0,1],19,2,['9'],18/19]);
// Two runs of 0 and 1 are compared as numbers, on the range of both.
const twice=texts([0,1,1,0,9,1,0,1,0,0,1,1],[]).map((row,i)=>({...row,runNo:2,answers:{f0:reply([0,1,0,0,1,1,0,1,0,0,1,1][i])},earlier:[{...plain,status:'done',runNo:1,answers:row.answers}]}));
({p,stats}=figures(twice,undefined,{kind:'run',run:2},'flag'));
assert.deepEqual([p.scaleSeen,p.range,p.zeroOne,stats.n],[true,[0,9],undefined,12]);

// A run that answers “NA” for some texts keeps its scale: the “NA” is left out and reported.
({p,stats}=figures(texts([1,2,'NA',3,2,1],['1','2','2','3','3','1'])));
assert.deepEqual([p.numeric,p.level,p.range,p.allowed,stats.n,stats.level,stats.leftOut.values],[true,'ordinal',[1,3],['1','2','3'],5,'ordinal',['na']]);
assert.equal(typeof stats.weightedKappa,'number');
// Mostly words: categories, as before.
({p}=figures(texts(['low','high','low','2'],['low','high','high','2'])));
assert.deepEqual([p.numeric,p.level],[false,'nominal']);
// A 2.5 makes the scores interval; whole numbers are an ordinal scale with every whole number a point.
({p}=figures(texts([1,2.5,3,2],['1','2','3','2'])));
assert.deepEqual([p.level,p.allowed,p.range],['interval',[],[1,3]]);
({p}=figures(texts([-1,2,2,0],['-1','2','1','0'])));
assert.deepEqual([p.level,p.allowed],['ordinal',['-1','0','1','2']]);
// With several annotations per text, the single answers decide, not the medians combined from them.
const annotated=[[1,2],[3,3],[5,4]].map((pair,i)=>{const doc={...plain,repeats:2,id:'r'+i,name:'r'+i+'.txt',status:'done',runNo:1,cells:[String(pair[0]),''],annotations:pair.map((value,n)=>({n:n+1,status:'done',answers:{f0:reply(value)},startedAt:'2026-11-16T10:00:00.000Z',time:'2026-11-16T10:00:05.000Z',processing:'instant',usage:{prompt_tokens:10,completion_tokens:5}}))};return Object.assign(doc,repeats.settle(doc));});
({p}=figures(annotated));
assert.deepEqual([p.a,p.level,p.range,p.allowed],[['1.5','3','4.5'],'ordinal',[1,5],['1','2','3','4','5']]);

// A coder's “NA” is a blank cell: the text has no label, and is neither compared nor reported as left out.
({p,stats}=figures(texts([1,2,3,3,2,1],['1','2','NA','3','n/a','1'])));
assert.deepEqual([p.ids.length,p.onlyA,stats.n,stats.leftOut.n],[4,2,4,0]);
// So in the exports: with a label 4, not 6; and the two coders are compared alike.
const dataset={kind:'texts',runs:[{...plain,number:1,startedAt:'2026-11-16T10:00:00.000Z'}],samples:[],columns,rows:texts([1,2,3,3,2,1],['1','2','NA','3','n/a','1'],['1','2','3','NA','2','2'])};
(async()=>{
 const lines=(await exported.runAgreement(dataset,1)).lines.map(line=>[line.source,line.comparedWith,line.stats.n,line.withLabel,line.stats.leftOut.n]);
 assert.deepEqual(lines,[['model','flag_gold',4,4,0],['model','flag_coder2',5,5,0],['flag_gold','flag_coder2',3,5,0]]);
 // A marker that is one of the field's categories is a label.
 const typed=(type,values,answers,labels)=>answers.map((value,i)=>({provider:'openai',model:'gpt-6-luna',effort:'low',prompt:'Rate.',id:'c'+i,name:'c'+i+'.txt',status:'done',runNo:1,answerFields:['flag','Explanation'],answerSettings:{fields:[{name:'flag',type,values,description:''},{name:'Explanation',type:'text',values:[],description:''}]},answers:{f0:value,f1:'Because.'},score:'',cells:[labels[i],'']}));
 ({p,stats}=figures(typed('category',['low','high','unknown'],['low','high','unknown','low'],['low','high','unknown','NA'])));
 assert.deepEqual([p.ids.length,p.onlyA,stats.n],[3,1,3]);

 // Categories yes and no are a yes / no: a coder's 1 and 0 are read as yes and no.
 ({p,stats}=figures(typed('category',['yes','no'],['yes','no','no','yes'],['1','0','1','ja'])));
 assert.deepEqual([p.allowed,p.a,p.b,stats.n,stats.percentAgreement],[['false','true'],['true','false','false','true'],['true','false','true','true'],4,0.75]);
 // Allowed values of exactly 0 and 1: a coder's yes and no are read as 1 and 0.
 ({p,stats}=figures(typed('ordinal',['0','1'],['1','0','0','1'],['yes','no','yes','TRUE'])));
 assert.deepEqual([p.numeric,p.allowed,p.b,stats.n,stats.percentAgreement],[true,['0','1'],['1','0','1','1'],4,0.75]);
 ({p,stats}=figures(typed('category',['0','1'],['1','0','0','1'],['yes','no','yes','n'])));
 assert.deepEqual([p.allowed,p.b,stats.n,stats.percentAgreement],[['0','1'],['1','0','1','0'],4,0.5]);
 // A yes / no field in one run, 0 and 1 in another: compared as yes and no, and the 9 is left out and reported.
 const mixed=typed('boolean',[],['yes','no','no','yes','yes','no','no','yes','yes','no','no','yes'],[]).map((row,i)=>({...row,earlier:[{...plain,status:'done',runNo:2,answers:{f0:reply([1,0,1,1,1,0,0,1,1,0,0,9][i])}}]}));
 ({p,stats}=figures(mixed,undefined,{kind:'run',run:2},'flag'));
 assert.deepEqual([p.allowed,stats.n,stats.leftOut.n,stats.leftOut.values,stats.percentAgreement],[['false','true'],11,1,['9'],10/11]);

 // A yes / no field next to scores that are no yes / no in numbers (a 1 to 5 rating, or 0 and 1 with many 9s): not
 // read as yes and no.
 const rated=typed('boolean',[],['yes','no','no','yes','yes','no'],[]).map((row,i)=>({...row,earlier:[{...plain,status:'done',runNo:2,answers:{f0:reply([1,5,3,4,2,1][i])}}]}));
 ({p}=figures(rated,undefined,{kind:'run',run:2},'flag'));
 assert.notDeepEqual(p.allowed,['false','true']);
 const coded=typed('boolean',[],['yes','no','no','yes','yes','no'],[]).map((row,i)=>({...row,earlier:[{...plain,status:'done',runNo:2,answers:{f0:reply([1,0,9,9,1,0][i])}}]}));
 ({p}=figures(coded,undefined,{kind:'run',run:2},'flag'));
 assert.notDeepEqual(p.allowed,['false','true'],'Two 9s in six answers are no codes: its own scale');
 // Answers in words from a run without a type are read as yes and no next to a yes / no field.
 const worded=typed('boolean',[],['yes','no','no','yes'],[]).map((row,i)=>({...row,earlier:[{provider:'openai',model:'gpt-6-luna',effort:'low',prompt:'Rate.',status:'done',runNo:2,score:['Yes','no','yes','ja'][i]}]}));
 ({p,stats}=figures(worded,undefined,{kind:'run',run:2},''));
 assert.deepEqual([p.allowed,stats.n,stats.percentAgreement],[['false','true'],4,0.75]);

 // Two plain-text runs: every whole number of each run's range is a point, and those between the two ranges when
 // the range of both is at most 100 wide.
 const pairOf=(first,second,settings)=>first.map((value,i)=>({...plain,id:'w'+i,name:'w'+i+'.txt',status:'done',runNo:2,answers:{f0:reply(second[i])},cells:['',''],earlier:[settings?{provider:'openai',model:'gpt-6-luna',effort:'low',prompt:'Rate.',status:'done',runNo:1,answerFields:['flag'],answerSettings:settings,answers:{f0:String(value)},score:''}:{...plain,status:'done',runNo:1,answers:{f0:reply(value)}}]}));
 const two=(first,second,scale,settings)=>agree.pairSources(pairOf(first,second,settings),columns,{kind:'run',run:1},'flag',{kind:'run',run:2},'flag',scale);
 p=two([1,2,2,1],[4,5,4,5]);
 assert.deepEqual([p.scaleSeen,p.range,p.allowed],[true,[1,5],['1','2','3','4','5']]);
 p=two([1,2,5,1],[200,205,210,200]);
 assert.deepEqual([p.range,p.allowed.length,p.allowed.slice(0,6)],[[1,210],16,['1','2','3','4','5','200']],'Further apart: the points of each run');
 p=two([0,150,40,0],[1,2,2,1]);
 assert.deepEqual([p.range,p.allowed],[[0,150],[]],'A run whose own range is wider than 100 has no points');
 // The study's scale: one run's scores on it, the other's beyond it. The scale is widened by the other run's answers
 // so that none is left out, and keeps its own ends.
 p=two([-1,0,2,3,1,-2],[5,6,7,6,5,7],{min:-3,max:3});
 assert.deepEqual([p.scaleSeen,p.level,p.allowed,p.range,p.studyScale],[false,'ordinal',['-3','-2','-1','0','1','2','3','4','5','6','7'],[-3,3],{min:-3,max:3}]);
 assert.match(p.basis,/the scale set for the scores, -3 to 3 \(not sent to the model\), extended to -3 to 7 because the run without its scores on that scale answered beyond it/);
 assert.equal(agree.runJob(agree.agreementJob(p,'auto',1),false).n,6);
 // An ordinal field's allowed values in one run, plain-text scores in the other: a 2.5 makes the comparison interval.
 const ordinal={fields:[{name:'flag',type:'ordinal',values:['1','2','3'],description:''}]};
 p=two([1,2,3,2],[1,2.5,3,2],undefined,ordinal);
 assert.deepEqual([p.level,p.allowed,p.range],['interval',['1','2','3'],undefined]);
 p=two([1,2,3,2],[1,2,5,2],undefined,ordinal);
 assert.deepEqual([p.level,p.allowed,p.range],['ordinal',['1','2','3','4','5'],[1,3]]);
 // With the plain-text scores on the study's scale: the values of both.
 p=two([1,2,3,2],[-1,2,3,0],{min:-3,max:3},ordinal);
 assert.deepEqual([p.allowed,p.range],[['-3','-2','-1','0','1','2','3'],undefined]);assert.match(p.basis,/the field’s allowed values, 1 to 3, and the scale set for the scores, -3 to 3\./);
 // Categories that are numbers next to plain-text scores stay categories, widened by the scores.
 const codes={fields:[{name:'flag',type:'category',values:['0','1'],description:''}]};
 p=two([0,1,1,0,1,0],[0,1,9,0,1,'NA'],undefined,codes);
 assert.deepEqual([p.level,p.numeric,p.allowed.length,p.allowed.at(-1)],['nominal',false,10,'9']);
 const coding=agree.runJob(agree.agreementJob(p,'auto',1),false);
 assert.deepEqual([coding.n,coding.leftOut.values],[5,['na']],'The “NA” is left out and reported');

 // The study's scale: 0 to 1 reads a coder's yes and no as 1 and 0; another scale leaves a yes / no in numbers as it is.
 ({p,stats}=figures(texts([0,1,1,0,1,1],['no','yes','yes','no','no','yes']),{min:0,max:1}));
 assert.deepEqual([p.zeroOne,p.b,stats.n,stats.percentAgreement],[true,['0','1','1','0','0','1'],6,5/6]);
 ({p}=figures(texts(repeat([0,1,1,0],3),repeat(['no','yes','yes','no'],3)),{min:-3,max:3}));
 assert.deepEqual([p.studyScale,p.zeroOne,p.range],[undefined,true,[0,1]]);
 ({p}=figures(texts([0,1,2,-1,1,0],['0','1','2','-1','1','1']),{min:-3,max:3}));
 assert.deepEqual([p.studyScale,p.zeroOne,p.allowed.length],[{min:-3,max:3},undefined,7]);

 // “Disagree” and “Agree” read the values the same way.
 const flags=texts([...repeat([0,1],5),9,1],[...repeat(['no','yes'],5),'yes','no']);
 const pick=show=>view.researchRows(flags,columns,{...view.DEFAULT_VIEW,compare:'col:flag_gold',field:'flag',show}).rows.map(row=>row.id).join(' ');
 assert.equal(pick('disagree'),'t12','A 1 next to “no”');
 assert.equal(pick('agree'),'t1 t2 t3 t4 t5 t6 t7 t8 t9 t10','The 9 is neither');

 // Combining several annotations: a code far from 0 and 1 is left out of a text's median, as on a scale that is set.
 const annotation=(n,value)=>({n,status:'done',answers:{f0:reply(value)},startedAt:`2026-11-16T10:0${n}:00.000Z`,time:`2026-11-16T10:0${n}:05.000Z`,processing:'instant',usage:{prompt_tokens:10,completion_tokens:5}});
 const several=[[1,9,1],[0,0,1],[1,1,0],[0,0,0],[1,1,1],[0,1,0],[1,0,1],[0,0,0],[1,1,1],[0,1,1]].map((values,i)=>{const doc={...plain,repeats:3,id:'s'+i,name:'s'+i+'.txt',status:'done',runNo:1,cells:['',''],annotations:values.map((value,n)=>annotation(n+1,value))};return Object.assign(doc,repeats.settle(doc));});
 const flagOf=row=>JSON.parse(row.answers.f0).flag;
 assert.equal(flagOf(several[0]),1,'As stored: the median of 1, 9, and 1');
 const again=[[1,9],[0,0],[1,1],[0,0],[1,1],[0,1],[1,0],[0,0],[1,1],[0,1],[1,1],[0,0]].map((values,i)=>{const doc={...plain,repeats:2,id:'p'+i,name:'p'+i+'.txt',status:'done',runNo:1,cells:['',''],annotations:values.map((value,n)=>annotation(n+1,value))};return Object.assign(doc,repeats.settle(doc));});
 assert.equal(flagOf(again[0]),5,'As stored: the median of 1 and 9');
 const scaled=combine.onScaleRows(again,undefined);
 assert.equal(flagOf(scaled.rows[0]),1,'Read as a yes / no in numbers: the 9 is left out');
 assert.deepEqual([...scaled.leftOut],[[1,1]]);
 assert.equal(scaled.rows[1],again[1],'A text with nothing left out is the same object');
 const moved=combine.onScaleRows(several,undefined);
 assert.deepEqual([flagOf(moved.rows[0]),[...moved.leftOut]],[1,[[1,1]]],'A code that does not move the median is still counted as left out');
 assert.deepEqual([...combine.scaleKeysByRun(several,undefined).get(1)],[['flag','flag']]);
 // The study's scale comes first: scores read on it are combined on it, and a yes / no in numbers stays one.
 assert.deepEqual([...combine.scaleKeysByRun(several,{min:-3,max:3}).get(1)],[['flag','flag']]);
 assert.equal(combine.offScaleLeftOut(again,1,{min:-3,max:3}),1);
 // Scores that are no yes / no are combined as before without a scale.
 const rating=[[2,9],[1,1],[3,2],[2,2],[1,3],[2,1],[3,3],[2,2],[1,1],[2,3],[3,1],[2,2]].map((values,i)=>{const doc={...plain,repeats:2,id:'q'+i,name:'q'+i+'.txt',status:'done',runNo:1,cells:['',''],annotations:values.map((value,n)=>annotation(n+1,value))};return Object.assign(doc,repeats.settle(doc));});
 assert.equal(combine.onScaleRows(rating,undefined).rows,rating);
 console.log('Score pairing checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
