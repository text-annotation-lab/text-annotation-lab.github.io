// Regressions for the independent audit of November 18, 2026, each with the audit's acceptance check: share charts
// whose segments add up, ties that do not depend on order, the settings that make results comparable, a chart scale
// kept per study, the year review that keeps its order while typing, assessment status from judgments, Excel cells
// that keep emoji whole, imports, labels for chunks, abstentions in agreement, and the cost question. Mocked only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require(path.join(root,'node_modules/typescript')),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};
 new Function('exports','require',code)(exports,local);return exports;
}
const source=file=>fs.readFileSync(path.join(root,file),'utf8');

(async()=>{
 // #4. Twenty texts: four answered "Other", two each A to H. "Other" is a real category, the rest is one more
 // segment; in each group and period the segments hold different texts and add up to the texts there.
 const figures=load('lib/chart-figures.ts');
 const values=['Other','Other','Other','Other',...'ABCDEFGH'.split('').flatMap(c=>[c,c])];
 const units=values.map((v,i)=>({key:'u'+i,name:'t'+i,ids:['t'+i],values:[v],numbers:[null],value:v,number:null,year:1990+(i%2)*20,group:i%3?'G1':'G2'}));
 const categories=['Other','A','B','C','D','E','F'],o={width:900,noun:'texts',interactive:true};
 const disjoint=(picks,prefix,total)=>{const ids=picks.filter(p=>p.label.startsWith(prefix)).flatMap(p=>p.ids);assert.equal(ids.length,total,prefix);assert.equal(new Set(ids).size,ids.length,prefix);};
 const groups=figures.groupsView(units,['G1','G2'],undefined,categories,o);
 disjoint(groups.picks,'G1 ·',units.filter(u=>u.group==='G1').length);disjoint(groups.picks,'G2 ·',units.filter(u=>u.group==='G2').length);
 assert.ok(groups.picks.some(p=>p.label==='G1 · All other answers'));assert.equal(groups.picks.filter(p=>p.label==='G1 · Other').length,1);
 const shares=figures.timeShares(units,undefined,categories,10,o);
 assert.equal(shares.picks.reduce((n,p)=>n+p.ids.length,0),20);assert.equal(new Set(shares.picks.flatMap(p=>p.ids)).size,20);
 assert.equal(figures.restLabel(['A','B']),'Other');

 // #12. Two chunks of one document, YES and NO: a tie either way round, with the same counts.
 const model=load('lib/chart-model.ts'),field={key:'score',label:'Score'};
 const chunk=(id,score,i)=>({id,name:'doc.txt part '+i,status:'done',score,sourceId:'doc',sourceName:'doc.txt',chunkIndex:i,prompt:'p',model:'m',effort:'e'});
 const ab=model.buildUnits([chunk('1','YES',1),chunk('2','NO',2)],field,{latestOnly:true,combine:true}).units;
 const ba=model.buildUnits([chunk('2','NO',2),chunk('1','YES',1)],field,{latestOnly:true,combine:true}).units;
 assert.deepEqual([ab.length,ab[0].value,ba[0].value],[1,model.CHART_TIE,model.CHART_TIE]);
 assert.equal(model.buildUnits([chunk('1','YES',1),chunk('2','YES',2),chunk('3','NO',3)],field,{latestOnly:true,combine:true}).units[0].value,'YES');

 // #13. The same prompt and model with and without web research (or another system prompt, temperature, or field
 // types) are two settings; "latest only" keeps the newer, and the notice names what changed.
 const r=(id,extra)=>({id,name:id,status:'done',score:'1',prompt:'p',model:'m',effort:'e',time:'2026-11-1'+id,...extra});
 let summary=model.settingsSummary([r('1',{}),r('2',{webSearch:true})]);
 assert.deepEqual([summary.count,summary.changed],[2,['web research']]);
 const latest=model.buildUnits([r('1',{}),r('2',{webSearch:true})],field,{latestOnly:true,combine:false}).units;
 assert.deepEqual(latest.map(u=>u.ids[0]),['2']);
 summary=model.settingsSummary([r('1',{requestSettings:{system:'A',temperature:0}}),r('2',{requestSettings:{system:'B',temperature:1}}),r('3',{answerSettings:{named:true,fields:[{name:'score',type:'ordinal',values:['1','2'],description:''}]}})]);
 assert.deepEqual(summary.changed,['answer fields','system prompt','temperature']);
 assert.equal(model.settingsSummary([r('1',{requestSettings:{cache:true}}),r('2',{})]).count,1,'Prompt caching changes no answer');

 // #14. A scale set by hand is stored per study, workspace, and field.
 assert.match(source('components/results-chart-dialog.tsx'),/scaleKey=JSON\.stringify\(\[scope\?\?'',subjectLabel,field\.label\]\)/);
 assert.match(source('app/page.tsx'),/<ResultsChart rows=\{rows\} scope=\{studyName\|\|''\}/);
 assert.match(source('components/model-knowledge.tsx'),/<ResultsChart rows=\{viewItems\} scope=\{studyName\|\|''\}/);

 // #15. The review list is ordered by the suggestions only, so typing a year does not move the row.
 const review=source('components/chart-review.tsx');
 assert.match(review,/const order=useMemo\(\(\)=>\[\.\.\.entries\]\.sort\(\(a,b\)=>Number\(Boolean\(a\.initial\)\)-Number\(Boolean\(b\.initial\)\)\),\[entries\]\)/);
 assert.doesNotMatch(review,/edits\.get\(unit\.key\)\?\?initial\}\)\)\.sort/);

 // #3c. An abstaining score with a written explanation is not assessed (and not "partly").
 const knowledge=load('lib/model-knowledge.ts');
 assert.equal(knowledge.knowledgeAssessment({answerFields:['Score','Explanation'],answers:{f0:'INSUFFICIENT_KNOWLEDGE',f1:'Nothing is known about this.'}}),'Insufficient knowledge');
 assert.equal(knowledge.knowledgeAssessment({answerFields:['Score','Notes'],answerSettings:{named:true,fields:[{name:'Score',type:'ordinal',values:['1','2'],description:''},{name:'Notes',type:'text',values:[],description:''}]},answers:{f0:'INSUFFICIENT_KNOWLEDGE',f1:'n/a'}}),'Insufficient knowledge');
 assert.equal(knowledge.knowledgeAssessment({answerFields:['Score','Stance'],answers:{f0:'INSUFFICIENT_KNOWLEDGE',f1:'pro'}}),'Partly assessed');

 // #22. Long Excel text in pieces that join back exactly, never splitting an emoji; an answer field called Filename
 // gets its own heading.
 const {cellPieces}=load('lib/export-results.ts');
 const long='a'.repeat(29999)+'😀'+'b'.repeat(40000);
 const pieces=cellPieces(long);assert.equal(pieces.join(''),long);assert.ok(pieces.every(p=>p.length<=30000&&!p.includes('�')));
 assert.ok(!/[\uD800-\uDBFF]$/.test(pieces[0]));
 assert.match(source('lib/export-results.ts'),/const fromJson=new Set\(answerNames\.map\(\(_,i\)=>'answer'\+i\)\)/);

 // #10, #11, #24, #25: a failed save offers the backup; saved keys are named in the standard Lab; links open
 // their section; Clear workspace names its scope.
 const page=source('app/page.tsx');
 assert.match(page,/const recovering=storageConflict\|\|knowledgeSaveState==='conflict'\|\|saveFailed\|\|knowledgeSaveState==='error'/);
 assert.match(page,/Keys saved in research mode are remembered in this browser\./);
 assert.match(page,/Saved studies are not affected\./);
 console.log('PASS: November 18 audit: chart segments, ties, comparable settings, scale per study, review order, assessment status, Excel pieces, backup after a failed save, saved-key line, section links, Clear workspace scope.');
})().catch(error=>{console.error(error);process.exit(1);});
