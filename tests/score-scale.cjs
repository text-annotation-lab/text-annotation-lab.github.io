// Research mode, the scale of the scores in plain-text replies that are JSON: set for the study, never sent, and
// used by the agreement figures (Runs & agreement, the exports, the comparison report) for every plain-text run,
// also earlier ones. The rules are in lib/research/score-scale.ts and lib/research/agreement.ts.
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
const scale=load('lib/research/score-scale.ts'),agreement=load('lib/research/agreement.ts'),metrics=load('lib/research/metrics.ts');
const backup=load('lib/study-backup.ts');

(async()=>{
 // A usable scale: two whole numbers, the lowest first, at most 100 apart.
 assert.deepEqual(scale.cleanScoreScale({min:-3,max:3}),{min:-3,max:3});
 for(const bad of [undefined,null,{min:3,max:-3},{min:1,max:1},{min:0.5,max:3},{min:'-3',max:'3'},{min:0,max:101}])assert.equal(scale.cleanScoreScale(bad),undefined,JSON.stringify(bad));
 assert.deepEqual(scale.scalePoints({min:-2,max:2}),['-2','-1','0','1','2']);
 // Which values are read on it: mostly on it, and not a yes / no in numbers.
 const {onScale}=scale,s={min:-3,max:3};
 assert.equal(onScale([-2,-1,0,1,2,3,7],s),true,'A stray 7 does not take the value off the scale');
 assert.equal(onScale([0,1,1,0,1],s),false,'Only 0 and 1: a yes / no keeps its own range');
 assert.equal(onScale([...Array(20).fill(0),...Array(9).fill(1),9],s),false,'A code such as 9 for “can’t tell” beside 0 and 1');
 assert.equal(onScale([0,1,1,2],s),true,'A 2 puts it on the scale');
 assert.equal(onScale([60,80,90,2],s),false,'A 0–100 confidence keeps the range seen');
 assert.equal(onScale([],s),false);

 // A plain-text run (JSON replies with a score and a confidence) against a coder's column.
 const reply=(race,confidence)=>JSON.stringify({race,confidence,explanation:'Because.'});
 const answers=[[-2,80],[-1,70],[0,90],[1,60],[2,75],[1,85],[0,95],[-1,50],[1,65],[2,70],[0,80],[1,90]];
 const coder=['-2','-1','0','1','2','2','0','-1','1','3','0','7'];
 const rows=answers.map(([race,confidence],i)=>({id:'t'+i,name:`t${i}.txt`,status:'done',runNo:1,answerFields:['response'],answerSettings:{plain:true},answers:{f0:reply(race,confidence)},cells:[coder[i]]}));
 const columns=[{name:'race_gold',role:'label'}],run={kind:'run',run:1},gold={kind:'column',name:'race_gold'};
 // Without a scale: the range seen, and the 7 is kept or left out by its distance from the answers.
 const seen=agreement.pairSources(rows,columns,run,'race',gold,'');
 assert.equal(seen.scaleSeen,true);assert.deepEqual(seen.range,[-2,2]);assert.equal(seen.studyScale,undefined);
 // With the scale: every point of −3 to 3; the coder's 7 is off it, so it is left out and reported.
 const set=agreement.pairSources(rows,columns,run,'race',gold,'',{min:-3,max:3});
 assert.equal(set.scaleSeen,false);assert.deepEqual(set.allowed,['-3','-2','-1','0','1','2','3']);assert.deepEqual(set.studyScale,{min:-3,max:3});
 assert.equal(set.basis,'Scale: the scale set for the scores, -3 to 3 (not sent to the model).');
 const stats=agreement.runJob(agreement.agreementJob(set,'auto',1),false);
 assert.equal(stats.n,11);assert.equal(stats.leftOut.n,1);assert.deepEqual(stats.leftOut.values,['7']);assert.deepEqual(stats.leftOut.range,[-3,3]);
 assert.match(agreement.leftOutNote(stats),/not a number on the scale -3 to 3: “7”/);
 // Gwet's AC1 counts all seven points with the scale, only those seen without it: the two differ.
 const without=agreement.runJob(agreement.agreementJob(seen,'auto',1),false);
 assert.notEqual(stats.gwetAC1,without.gwetAC1);
 assert.equal(stats.gwetAC1,metrics.agreement(set.a.filter((_,i)=>set.b[i]!=='7'),set.b.filter(v=>v!=='7'),'ordinal',set.allowed,1,{withIntervals:false}).gwetAC1,'The same as an ordinal field with these allowed values');
 // The confidence (0–100) keeps the range of the answers.
 const confidence=agreement.pairSources(rows.map(row=>({...row,cells:['80']})),columns,run,'confidence',gold,'',{min:-3,max:3});
 assert.equal(confidence.studyScale,undefined);assert.equal(confidence.scaleSeen,true);
 // A run with typed fields, or a run without plain text, is not read on it.
 const typed=rows.map(row=>({...row,answerFields:['race'],answerSettings:{fields:[{name:'race',type:'ordinal',values:['-2','-1','0','1','2'],description:''}]},answers:{f0:String(JSON.parse(row.answers.f0).race)}}));
 assert.deepEqual(agreement.pairSources(typed,columns,run,'race',gold,'',{min:-3,max:3}).allowed,['-2','-1','0','1','2']);
 const standard=rows.map(row=>({...row,answerFields:[],answerSettings:undefined,answers:undefined,score:String(JSON.parse(row.answers.f0).race)}));
 assert.equal(agreement.pairSources(standard,columns,run,'',gold,'',{min:-3,max:3}).studyScale,undefined);
 // Two plain-text runs: on the scale when both are; a run of 0 and 1 keeps them on the range seen.
 const two=rows.map(row=>({...row,earlier:[{...row,runNo:2}]}));
 // (The earlier result of each text is run 2's here; rowForRun reads it.)
 const both=agreement.pairSources(two,columns,run,'race',{kind:'run',run:2},'race',{min:-3,max:3});
 assert.deepEqual(both.studyScale,{min:-3,max:3});
 const flags=rows.map((row,i)=>({...row,earlier:[{...row,runNo:2,answers:{f0:reply(i%2,50)}}]}));
 assert.equal(agreement.pairSources(flags,columns,run,'race',{kind:'run',run:2},'race',{min:-3,max:3}).studyScale,undefined);

 // A study backup carries the scale; a malformed one is refused.
 const study=texts=>backup.encodeStudyBackup({name:'Scale',createdAt:'2026-11-16',texts,knowledge:{items:[],scoreScale:{min:0,max:4}}});
 const back=backup.decodeStudyBackup(await study({docs:[],scoreScale:{min:-3,max:3}}));
 assert.deepEqual([back.texts.scoreScale,back.knowledge.scoreScale],[{min:-3,max:3},{min:0,max:4}]);
 let refused=false;try{backup.decodeStudyBackup(await study({docs:[],scoreScale:{min:1.5,max:3}}));}catch{refused=true;}
 assert(refused,'A scale that is not two whole numbers is refused');
 console.log('Score scale checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
