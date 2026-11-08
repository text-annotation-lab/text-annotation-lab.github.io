const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
function load(file){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
const m=load('lib/chart-model.ts'),{chartNumber,suggestedYear}=load('lib/results-chart.ts');
const opts={latestOnly:true,combine:true};
const row=(id,score,status='done',extra={})=>({id,name:'Document '+id,status,score,explanation:'Explanation '+id,...extra});
const score={key:'score',label:'Score / category'};

// Completed results only; blanks and INSUFFICIENT_KNOWLEDGE are left out; rows are not mutated.
const numeric=[row('zero','0'),row('negative','-3'),row('decimal','1.5'),row('pending','9','pending'),row('error','6','error'),row('unknown','INSUFFICIENT_KNOWLEDGE'),row('blank','  ')];
const original=JSON.stringify(numeric),built=m.buildUnits(numeric,score,opts);
assert.deepEqual(built.units.map(u=>u.number),[0,-3,1.5]);assert.equal(built.excluded,4);assert.equal(built.abstained,1);assert.equal(built.kind,'scale');assert.equal(JSON.stringify(numeric),original);
for(const value of ['1–7','3 points','1,000','2026-11-05','50%','Infinity','NaN',''])assert.equal(chartNumber(value),null);
assert.equal(chartNumber('1e2'),100);assert.equal(chartNumber('-.5'),-.5);assert.equal(chartNumber('1e999'),null);
assert.deepEqual(m.chartFieldList([row('bad','5','error')]),[]);

// Field kinds: scores, categories, and free text.
assert.equal(m.fieldKind(['1','2','3']),'scale');
assert.equal(m.fieldKind(['POSITIVE','NEGATIVE','POSITIVE']),'category');
assert.equal(m.fieldKind(Array.from({length:40},(_,i)=>'A different free answer number '+i)),'text');
const mixed=[row('a','POSITIVE'),row('b','NEGATIVE'),row('c','POSITIVE'),row('d','positive'),row('e','1')];
const categories=m.buildUnits(mixed,score,opts);assert.equal(categories.kind,'category');assert.equal(categories.units.length,5);

// Named fields, in any order, with explanations from an Explanation field.
const named=[{...row('old',''),answerFields:['Tone','Complexity','Explanation'],answers:{f0:'NEUTRAL',f1:'2',f2:'Named explanation'},explanation:''},{...row('reordered',''),answerFields:['Complexity','Tone'],answers:{f0:'3',f1:'POSITIVE'}},row('legacy','7')];
const fields=m.chartFieldList(named);assert.deepEqual(fields.map(f=>f.label),['Score / category','Tone','Complexity']);
const complexity=m.buildUnits(named,fields[2],{...opts,latestOnly:false});assert.deepEqual(complexity.units.map(u=>u.value),['2','3']);assert.equal(complexity.units[0].explanation,'Named explanation');
assert.deepEqual(m.buildUnits(named,fields[0],{...opts,latestOnly:false}).units.map(u=>u.ids[0]),['legacy']);

// Scales: the strict output syntax, a loose “1–7” in the prompt, or the data range. Never clip results.
const nums=v=>v.map(Number);
assert.deepEqual(pick(m.suggestedScale([{...row('a','4'),prompt:'Score: integer from 1 to 7.'}],score,[4])),[1,7,'declared','sequential']);
assert.deepEqual(pick(m.suggestedScale([{...row('a','4'),prompt:'Rate formality on a 1–7 scale.'}],score,nums(['4','6']))),[1,7,'prompt','sequential']);
assert.deepEqual(pick(m.suggestedScale([{...row('a','-2'),prompt:'Rate tone from −3 to +3.'}],score,[-2,1])),[-3,3,'prompt','diverging']);
assert.deepEqual(pick(m.suggestedScale([row('a','3')],score,[3,6])),[3,6,'data','sequential']);
assert.deepEqual(pick(m.suggestedScale([{...row('a','9'),prompt:'Rate it 1–7.'}],score,[9])),[9,9,'data','sequential']);
assert.equal(m.suggestedScale([row('a','.5')],score,[.5,.25]),undefined);
assert.deepEqual(m.promptScales('Written 1861–65, on pages 12-200, in 2020-2024'),[]);
function pick(s){return s&&[s.min,s.max,s.source,s.type];}

// Mixed settings: default to the latest, and say how many there are.
const settings=[{...row('a','3'),prompt:'P1',model:'m'},{...row('b','4'),prompt:'P1',model:'m'},{...row('c','6'),prompt:'P2',model:'m'}];
assert.equal(m.settingsSummary(settings).count,2);assert.equal(m.settingsSummary(settings).latestCount,1);
assert.deepEqual(m.buildUnits(settings,score,opts).units.map(u=>u.ids[0]),['c']);
assert.equal(m.buildUnits(settings,score,{...opts,latestOnly:false}).units.length,3);

// Chunks combine per document and runs per subject; each can also count separately.
const chunks=[1,2,3].map(i=>({...row('c'+i,String(i+2)),sourceId:'doc1',sourceName:'Long.txt',chunkIndex:i}));
const combined=m.buildUnits(chunks,score,opts);assert.equal(combined.units.length,1);assert.equal(combined.units[0].number,4);assert.equal(combined.units[0].name,'Long.txt');assert(combined.combinable&&combined.hasChunks);
assert.equal(m.buildUnits(chunks,score,{...opts,combine:false}).units.length,3);
const runs=[{...row('r1','1'),name:'Same subject',subjectId:'s',runNumber:1},{...row('r2','2'),name:'Same subject',subjectId:'s',runNumber:2}];
const runUnits=m.buildUnits(runs,score,opts);assert.equal(runUnits.units.length,1);assert.deepEqual(runUnits.units[0].values,['1','2']);assert.equal(runUnits.units[0].number,1.5);
assert.match(m.buildUnits(runs,score,{...opts,combine:false}).units[1].name,/Run 2/);
const runCategories=m.buildUnits(runs.map((r,i)=>({...r,score:['YES','YES','NO'][i]})).concat([{...runs[0],id:'r3',runNumber:3,score:'YES'}]),score,opts);assert.equal(runCategories.units[0].value,'YES');

// Years from filenames, unless typed or left out.
for(const name of ['1789-04-30_Washington.txt','1789_Washington.txt','Washington_1789_address.txt','Washington (1789).pdf'])assert.equal(suggestedYear(name),'1789');
for(const name of ['letters_1861–65.txt','letters_1998-02.txt','letters_1861–1865.txt','Lincoln_1861_reprinted_1905.txt','undated.txt','idA1945x.txt','id_1234567.txt'])assert.equal(suggestedYear(name),'');
assert.equal(m.effectiveYear({...row('a','1'),name:'1789_Washington.txt'}),1789);
assert.equal(m.effectiveYear({...row('a','1'),name:'1789_Washington.txt',chartYear:1790}),1790);
assert.equal(m.effectiveYear({...row('a','1'),name:'1789_Washington.txt',chartYear:null}),undefined);
assert.equal(m.effectiveYear({...row('a','1'),name:'Hamlet',fields:[{heading:'Year',value:'c. 1600'}]}),1600);

// Groups from the end or start of filenames, or a subject field.
const obits=['1900-07F.txt','1900-08M.txt','1901-01F.txt','1902-03M.txt','1903-02F.txt'];
assert.equal(m.suggestedGroupRule(obits),'end');assert.equal(m.groupFromName('1900-07F.txt','end'),'F');
const scouts=['B-01.txt','B-02.txt','G-01.txt','G-02.txt'];assert.equal(m.suggestedGroupRule(scouts),'start');assert.equal(m.groupFromName('G-02.txt','start'),'G');
assert.equal(m.suggestedGroupRule(Array.from({length:60},(_,i)=>`${1789+4*i}_President${i}.txt`)),undefined);
const subjects=['Woman','Man','Woman','Man'].map((g,i)=>({...row('s'+i,'3'),fields:[{heading:'Name',value:'Person '+i},{heading:'Gender',value:g}]}));
assert.equal(m.suggestedGroupRule([],subjects),'field:Gender');assert.equal(m.effectiveGroup(subjects[0],'field:Gender'),'Woman');
assert.equal(m.effectiveGroup({...subjects[0],chartGroup:'Typed'},'field:Gender'),'Typed');assert.equal(m.effectiveGroup({...subjects[0],chartGroup:null},'field:Gender'),undefined);

// Statistics.
assert.equal(m.median([1,3,2]),2);assert.equal(m.median([1,2,3,4]),2.5);assert.equal(m.mean([1e308,1e308]),1e308);
assert.equal(m.mostCommon(['a','b','a']),'a');assert.equal(m.mostCommon(['a','b']),'Tie');
const ci=m.meanInterval([4,5,6]);assert.equal(ci.mean,5);assert(Math.abs(ci.high-ci.mean-4.30/Math.sqrt(3))<1e-9);assert(Number.isNaN(m.meanInterval([4]).low));
assert.deepEqual(m.smoothTrend([{year:1,value:1},{year:2,value:2}],1),[]);
const trend=m.smoothTrend(Array.from({length:20},(_,i)=>({year:1900+i*5,value:i<10?6:3})),5);assert(trend[0].value>trend.at(-1).value);assert(trend.every(p=>p.value>=3-1e-9&&p.value<=6+1e-9));

// Periods: inaugural addresses (60 texts, 1789–2025) get 40-year periods.
const inaugural=Array.from({length:60},(_,i)=>1789+4*i).filter(y=>y<=2025);
assert.equal(m.suggestedPeriodLength(inaugural),40);
assert.equal(m.periodsFor([1789,2025],40)[0].start,1760);

// Large studies stay fast and exact.
const many=Array.from({length:5000},(_,i)=>row(String(i),String(i%7+1)));const big=m.buildUnits(many,score,opts);assert.equal(big.units.length,5000);assert.equal(big.excluded,0);
console.log('PASS: completed-only filtering, field kinds, named fields, scales from prompts, mixed settings, chunks and runs combined, years, groups, statistics, periods, and large sets.');
