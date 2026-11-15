// Research mode's own modules: agreement statistics against values worked out
// independently of this code, runs, labels and metadata, sampling, the result
// views, and the export tables.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache=new Map();
function load(file){
 const full=path.resolve(file);if(cache.has(full))return cache.get(full);
 const exports={};cache.set(full,exports);
 const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(full),id)+'.ts'):require(id));
 return exports;
}
const near=(actual,expected,message)=>assert(actual!==null&&Math.abs(actual-expected)<1e-6,`${message||'value'}: got ${actual}, expected ${expected}`);
const metrics=load('lib/research/metrics.ts'),runs=load('lib/research/runs.ts'),columns=load('lib/research/columns.ts'),sample=load('lib/research/sample.ts'),view=load('lib/research/view.ts'),agree=load('lib/research/agreement.ts'),knowledge=load('lib/research/knowledge.ts'),exporting=load('lib/research/export.ts'),table=load('lib/research/parse-table.ts');

// --- Agreement statistics ----------------------------------------------------
// Krippendorff's two-observer, two-category example: alpha = 0.095.
const A=['0','1','0','0','0','0','0','0','1','0'],B=['1','1','1','0','0','1','0','0','0','0'];
let stats=metrics.agreement(A,B,'nominal',[],1,{withIntervals:false});
assert.equal(stats.n,10);near(stats.percentAgreement,0.6);near(stats.cohenKappa,0.0909090909,'kappa');near(stats.krippendorffAlpha,0.0952380952,'alpha');near(stats.gwetAC1,0.3103448276,'AC1');
assert.deepEqual(stats.confusion['0'],{'0':5,'1':3});assert.deepEqual(stats.confusion['1'],{'0':1,'1':1});
// A five-point scale; reference values from the plain formulas, computed separately.
const X=[1,2,3,3,2,1,4,1,2,5,3,4,5,1,2].map(String),Y=[1,2,3,4,2,2,4,1,3,5,3,3,4,1,1].map(String);
stats=metrics.agreement(X,Y,'ordinal',[],1,{withIntervals:false});
assert.equal(stats.level,'ordinal');near(stats.percentAgreement,0.6);near(stats.cohenKappa,0.4915254237,'kappa');near(stats.weightedKappaLinear,0.7272727273,'linear kappa');near(stats.weightedKappa,0.8828125,'quadratic kappa');
near(stats.krippendorffAlpha,0.887165692,'ordinal alpha');near(stats.spearman,0.8893073813,'Spearman');near(stats.pearson,0.8855190258,'Pearson');near(stats.mae,0.4,'MAE');near(stats.meanDifference,0,'mean difference');near(stats.withinTolerance,1,'within 1');
near(metrics.agreement(X,Y,'nominal',[],1,{withIntervals:false}).krippendorffAlpha,0.5056818182,'nominal alpha');
near(metrics.agreement(X,Y,'interval',[],1,{withIntervals:false}).krippendorffAlpha,0.88671875,'interval alpha');
near(metrics.gwetAC1(X.map((x,i)=>[x,Y[i]])),0.5027624309,'AC1 on the scale');
// Labels that differ only in case or spacing are the same label; a blank is not compared.
assert.equal(metrics.normalizeLabel(' Positive '),metrics.normalizeLabel('positive'));
assert.equal(metrics.agreement(['a','b',''],['a','c','b'],'nominal',[],1,{withIntervals:false}).n,2);
// Intervals: Wilson for shares, bootstrap (fixed seed) for coefficients, none below ten texts.
const wilson=metrics.wilsonCI(0.5,100);near(wilson[0],0.4038315304);near(wilson[1],0.5961684696);
const wide=metrics.wilsonCI(0.9,20);near(wide[0],0.6989663548);near(wide[1],0.9721335188);
const withCi=metrics.agreement(X,Y,'ordinal',[],1,{withIntervals:true}),again=metrics.agreement(X,Y,'ordinal',[],1,{withIntervals:true});
for(const key of ['cohenKappa','krippendorffAlpha','weightedKappa','percentAgreement']){const range=withCi.ci[key];assert(Array.isArray(range)&&range[0]<=withCi[key]+1e-9&&range[1]>=withCi[key]-1e-9,key+' lies inside its interval');assert.deepEqual(again.ci[key],range,key+' interval is reproducible');}
assert(!metrics.agreement(X.slice(0,9),Y.slice(0,9),'ordinal',[],1,{withIntervals:true}).ci.cohenKappa,'No bootstrap interval below ten texts');
const streamA=metrics.seeded(42),streamB=sample.seeded(42);for(let i=0;i<5;i++)assert.equal(streamA(),streamB(),'One random stream for statistics and sampling');

// Categories with no codebook: a coder's "NA" is left out and reported, unless the run itself gives it as an answer.
{
 const rowsNA=['a','b','c','d','e','f'].map((id,i)=>({id,name:id,status:'done',runNo:1,score:['pos','neg','pos','neg','none','neg'][i],cells:[['pos','neg','pos','NA','n/a','neg'][i]]}));
 const cols=[{name:'human',role:'label'}],pairNA=agree.pairSources(rowsNA,cols,{kind:'run',run:1},'',{kind:'column',name:'human'},'');
 const s1=agree.runJob(agree.agreementJob(pairNA,'auto',1),false);
 assert.equal(s1.n,4);near(s1.cohenKappa,1,'kappa without NA');assert.equal(s1.leftOut.n,2);assert.deepEqual(s1.leftOut.values,['na','n/a']);
 assert.match(agree.leftOutNote(s1),/2 texts were left out because a value was a missing-value marker/);
 const rowsNone=rowsNA.map((row,i)=>({...row,cells:[['pos','neg','pos','neg','none','neg'][i]]}));
 const s2=agree.runJob(agree.agreementJob(agree.pairSources(rowsNone,cols,{kind:'run',run:1},'',{kind:'column',name:'human'},''),'auto',1),false);
 assert.equal(s2.n,6,'“none” is a category when the run gives it');assert.equal(s2.leftOut.n,0);
 const twoCoders=['a','b','c','d'].map((id,i)=>({id,name:id,status:'pending',cells:[['x','y','NA','x'][i],['x','y','x','NA'][i]]}));
 const s3=agree.runJob(agree.agreementJob(agree.pairSources(twoCoders,[{name:'c1',role:'label'},{name:'c2',role:'label'}],{kind:'column',name:'c1'},'',{kind:'column',name:'c2'},''),'auto',1),false);
 assert.equal(s3.n,2,'Two coders: NA in either column is left out');
 const coders2=['a','b','c'].map((id,i)=>({id,name:id,status:'pending',cells:[['x','none','none'][i],['x','none','x'][i]]}));
 assert.equal(agree.runJob(agree.agreementJob(agree.pairSources(coders2,[{name:'c1',role:'label'},{name:'c2',role:'label'}],{kind:'column',name:'c1'},'',{kind:'column',name:'c2'},''),'auto',1),false).n,3,'Two coders: a word both use, such as “none”, is a category');
 assert.equal(metrics.agreement(['x','na'],['x','y'],'nominal',[],1,{withIntervals:false}).n,2,'Without known categories the statistics are unchanged');
}

// --- Runs ----------------------------------------------------------------------
const setup={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Classify tone',answerFields:[]};
const fresh=()=>[{id:'a',name:'a.txt',status:'pending'},{id:'b',name:'b.txt',status:'pending'}];
const finish=(docs,number,score,settings=setup)=>docs.map(doc=>doc.status==='pending'?{...doc,...settings,status:'done',score,explanation:'Because.',runNo:number,time:'2026-11-15T10:00:00Z'}:doc);
let state=runs.beginRun(fresh(),[],setup,false,'2026-11-15T10:00:00Z');
assert.equal(state.number,1);assert.equal(state.runs.length,1);assert.equal(state.runs[0].prompt,'Classify tone');
let docs=finish(state.docs,1,'POSITIVE');
// More texts with the same settings join the run; a changed prompt starts another.
assert.equal(runs.beginRun([...docs,{id:'c',name:'c.txt',status:'pending'}],state.runs,setup,false,'later').number,1);
assert.equal(runs.beginRun(docs,state.runs,{...setup,prompt:'Classify stance'},false,'later').number,2);
assert.equal(runs.beginRun(docs,state.runs,setup,true,'later').number,2,'Run again always starts a new run');
// Annotating again keeps the first result and never puts two results for a text in one run.
let queued=runs.requeue(docs,state.runs,new Set(['a','b']));
assert.equal(queued.archived,2);assert.deepEqual(queued.docs.map(doc=>doc.status),['pending','pending']);
assert.equal(queued.docs[0].score,undefined);assert.equal(queued.docs[0].earlier[0].score,'POSITIVE');assert.equal(queued.docs[0].earlier[0].runNo,1);
state=runs.beginRun(queued.docs,queued.runs,setup,false,'2026-11-15T11:00:00Z',new Set(['a']));
assert.equal(state.number,2,'A text already annotated in the latest run starts a new one');
docs=finish(state.docs,2,'NEGATIVE');
assert.equal(runs.rowForRun(docs[0],1).score,'POSITIVE');assert.equal(runs.rowForRun(docs[0],2).score,'NEGATIVE');assert.equal(runs.rowForRun(docs[0],3).status,'absent');
assert.deepEqual(runs.completedResults(docs[0]).map(result=>[result.runNo,result.score]),[[1,'POSITIVE'],[2,'NEGATIVE']]);
// "Remaining": waiting and failed texts, and completed texts with no result from the current settings in any run.
{
 const other={...setup,prompt:'Classify stance'},ids=(rows,settings)=>runs.remainingFor(rows,settings).map(doc=>doc.id);
 assert.deepEqual(ids(docs,setup),[],'Every text has a result from these settings');
 assert.deepEqual(ids(docs,other),['a','b'],'A changed prompt leaves every text');
 assert.deepEqual(ids(docs,{...setup,answerFields:['Tone']}),['a','b'],'So do changed answer fields');
 const mixed=[docs[0],{id:'c',name:'c.txt',status:'pending'},{id:'d',name:'d.txt',status:'error'},{id:'e',name:'e.txt',status:'running'},{id:'f',name:'f.txt',status:'queued'}];
 assert.deepEqual(ids(mixed,setup),['c','d'],'Waiting and failed texts remain; texts being annotated or in a batch are left out');
 // A text annotated again with other settings still has its earlier result from the first settings.
 const again=finish(runs.requeue(docs,state.runs,new Set(['a'])).docs,3,'MIXED',other);
 assert.deepEqual(ids(again,setup),[]);assert.deepEqual(ids(again,other),['b']);
 // A run that was stopped midway: its waiting texts remain, even when an earlier run with the same settings annotated them.
 const stopped=runs.requeue(docs,state.runs,new Set(['a','b'])).docs;
 assert.deepEqual(ids(stopped,setup),['a','b']);
}
let summary=runs.runSummaries(docs,state.runs);
assert.deepEqual(summary.map(run=>[run.number,run.done,run.failed,run.promptVersion]),[[1,2,0,1],[2,2,0,1]]);assert.equal(runs.earlierCount(docs),2);
// Deleting the latest run brings back each text's earlier result; its number is not reused.
let removed=runs.deleteRun(docs,state.runs,2);
assert.deepEqual(removed.docs.map(doc=>[doc.status,doc.score,doc.runNo,doc.earlier]),[['done','POSITIVE',1,undefined],['done','POSITIVE',1,undefined]]);
assert.equal(removed.runs[1].deleted,true);assert.equal(runs.beginRun(runs.requeue(removed.docs,removed.runs,new Set(['a'])).docs,removed.runs,setup,false,'later',new Set(['a'])).number,3);
// Deleting an earlier run leaves the current results alone.
removed=runs.deleteRun(docs,state.runs,1);assert.deepEqual(removed.docs.map(doc=>[doc.score,doc.runNo,doc.earlier]),[['NEGATIVE',2,undefined],['NEGATIVE',2,undefined]]);
assert.deepEqual(runs.runSummaries(removed.docs,removed.runs).map(run=>run.number),[2]);
// Results from before runs were numbered (student mode, older studies) become run 1, grouped by their settings.
const old=[{id:'a',name:'a.txt',status:'done',score:'1',prompt:'P',model:'gpt-6-luna',effort:'medium',time:'2026-11-01T10:00:00Z'},{id:'b',name:'b.txt',status:'done',score:'2',prompt:'P',model:'gpt-6-luna',effort:'medium',time:'2026-11-01T10:01:00Z'},{id:'c',name:'c.txt',status:'done',score:'3',prompt:'Q',model:'claude-opus-5-5',effort:'high',time:'2026-11-02T10:00:00Z'},{id:'d',name:'d.txt',status:'pending'}];
const adopted=runs.adoptUnnumbered(old,[]);
assert.deepEqual(adopted.docs.map(doc=>doc.runNo),[1,1,2,undefined]);assert.deepEqual(adopted.runs.map(run=>[run.number,run.provider,run.prompt]),[[1,'openai','P'],[2,'anthropic','Q']]);
assert.equal(runs.adoptUnnumbered(adopted.docs,adopted.runs).docs,adopted.docs,'Nothing to adopt the second time');
assert.deepEqual(runs.cleanRuns([{number:1,model:'m',prompt:'p'},{number:1,model:'m',prompt:'again'},{number:0,model:'m',prompt:'p'},{number:2,model:5,prompt:'p'},'x',null]).map(run=>run.number),[1]);
assert.deepEqual(runs.cleanRuns('not runs'),[]);
const cleared=runs.clearRuns(docs[0]);assert.equal(cleared.status,'pending');assert.equal(cleared.earlier,undefined);assert.equal(cleared.score,undefined);assert.equal(cleared.name,'a.txt');

// --- Labels and metadata from a spreadsheet --------------------------------------
assert.deepEqual(table.parseDelimited('file,label,note\n1961-Kennedy,POSITIVE,"said ""freedom"", twice"\n1981-Reagan,MIXED,\n'),{header:['file','label','note'],rows:[['1961-Kennedy','POSITIVE','said "freedom", twice'],['1981-Reagan','MIXED','']]});
assert.deepEqual(table.parseDelimited('﻿fil;etiket\r\na.txt;1,5\r\n').rows,[['a.txt','1,5']],'Semicolons (Danish Excel) and a byte-order mark');
assert.deepEqual(table.parseDelimited('file\tlabel\na.txt\tx').header,['file','label']);
const csv=table.toCsv([['a','b'],['He said "no"','1,5'],['=SUM(A1)',2],['line\nbreak',null]]);
assert.equal(csv,'﻿a,b\r\n"He said ""no""","1,5"\r\n=SUM(A1),2\r\n"line\nbreak",\r\n','Values are written exactly; quotes, commas, and line breaks are quoted');
assert.deepEqual(table.parseDelimited(csv).rows[0],['He said "no"','1,5'],'A file the Lab writes reads back unchanged');
const texts=[{id:'1',name:'1961-Kennedy.txt'},{id:'2',name:'1981-Reagan.txt'},{id:'3',name:'Report.pdf · chunk 1',sourceName:'Report.pdf'},{id:'4',name:'Report.pdf · chunk 2',sourceName:'Report.pdf'},{id:'5',name:'notes.txt'},{id:'6',name:'notes.md'}];
let match=columns.matchRows(texts,['1961-kennedy','texts/1981-Reagan.TXT','Report.pdf','nobody','notes','1961-Kennedy.txt']);
assert.deepEqual([...match.rowOf],[['1',0],['2',1],['3',2],['4',2]]);assert.deepEqual(match.unmatched,[3]);assert.deepEqual(match.ambiguous,[4],'“notes” fits two files');assert.deepEqual(match.repeated,[5]);
const sheet={header:['year','file','tone_human','comment'],rows:[['1961','1961-Kennedy','POSITIVE','x'],['1981','1981-Reagan','','y'],['1900','missing','NEGATIVE','z']]};
assert.equal(columns.guessKeyColumn(texts,sheet),1);assert.equal(columns.guessRole('tone_human'),'label');assert.equal(columns.guessRole('year'),'meta');
let applied=columns.applySheet(texts,[],sheet,1,['meta','','label','']);
assert.deepEqual(applied.columns,[{name:'year',role:'meta'},{name:'tone_human',role:'label'}]);assert.equal(applied.matched,2);assert.deepEqual(applied.unmatched,['missing']);
assert.deepEqual(applied.docs.slice(0,3).map(doc=>doc.cells),[['1961','POSITIVE'],['1981',''],undefined]);
// A second import adds to what is there; a blank cell does not erase a value.
applied=columns.applySheet(applied.docs,applied.columns,{header:['file','tone_human','party'],rows:[['1961-Kennedy','','Democratic'],['1981-Reagan','MIXED','Republican']]},0,['','label','meta']);
assert.deepEqual(applied.docs.slice(0,2).map(doc=>doc.cells),[['1961','POSITIVE','Democratic'],['1981','MIXED','Republican']]);assert.deepEqual(applied.added,['party']);assert.equal(applied.changed,0);
// Column names from a spreadsheet are data: they never become property names on a text.
const hostile=columns.applySheet(texts,[],{header:['file','__proto__','key'],rows:[['notes.txt','a','b']]},0,['','meta','meta']);
assert.deepEqual(hostile.docs[4].cells,['a','b']);assert.deepEqual(Object.keys(hostile.docs[4]).sort(),['cells','id','name']);
let marked=columns.markColumn(applied.docs,applied.columns,new Set(['1','5']),'sample','validation');
assert.deepEqual(marked.docs.map(doc=>columns.cellOf(doc,3)),['validation','','','','validation','']);
marked=columns.markColumn(marked.docs,marked.columns,new Set(['2']),'sample','validation',true);
assert.deepEqual(marked.docs.map(doc=>columns.cellOf(doc,3)),['','validation','','','',''],'A redraw replaces the earlier marks');
const fewer=columns.removeColumn(marked.docs,marked.columns,'YEAR');
assert.deepEqual(fewer.columns.map(column=>column.name),['tone_human','party','sample']);assert.deepEqual(fewer.docs[0].cells,['POSITIVE','Democratic','']);
assert.deepEqual(columns.cleanColumns([{name:'a',role:'label'},{name:'A'},null,{name:'b',role:'other'}]),[{name:'a',role:'label'},{name:'Column 2',role:'meta'},{name:'Column 3',role:'meta'},{name:'b',role:'meta'}],'Unreadable columns keep their place so cells stay aligned');
assert.deepEqual(columns.setRole(applied.columns,'party','label')[2],{name:'party',role:'label'});

// --- Sampling ----------------------------------------------------------------------
const sampleColumns=[{name:'party',role:'meta'},{name:'sample',role:'meta'}];
const pool=Array.from({length:40},(_,i)=>({id:'t'+i,name:`text-${String(i).padStart(2,'0')}.txt`,cells:[i<30?'D':'R','']}));
const options={size:8,strata:['party'],exclude:null,markedAs:{column:'sample',value:'validation'},seed:7};
const drawn=sample.drawStratifiedSample(pool,sampleColumns,options);
assert.equal(drawn.ids.length,8);assert.equal(new Set(drawn.ids).size,8);assert.equal(drawn.eligible,40);
assert.deepEqual(drawn.strata,[{stratum:'D',available:30,drawn:6},{stratum:'R',available:10,drawn:2}],'Proportional to each group');
assert.deepEqual(sample.drawStratifiedSample([...pool].reverse(),sampleColumns,options).ids,drawn.ids,'The same seed draws the same texts, whatever their order');
assert.notDeepEqual(sample.drawStratifiedSample(pool,sampleColumns,{...options,seed:8}).ids,drawn.ids);
// A second sample in the same column leaves out the texts of the first.
const after=columns.markColumn(pool,sampleColumns,new Set(drawn.ids),'sample','validation').docs;
const second=sample.drawStratifiedSample(after,sampleColumns,{...options,markedAs:{column:'sample',value:'test'},size:10});
assert.equal(second.eligible,32);assert(second.ids.every(id=>!drawn.ids.includes(id)));assert.deepEqual(second.taken,[{value:'validation',n:8}]);
assert.equal(sample.drawStratifiedSample(pool,sampleColumns,{...options,exclude:{column:'party',value:'r'},strata:[]}).eligible,30);
assert.equal(sample.drawStratifiedSample(pool,sampleColumns,{...options,size:500,strata:[]}).ids.length,40,'Never more than there are');
const record=sample.sampleRecord(options,drawn,'2026-11-15');
assert.equal(sample.sampleNote(record),'Sample sample = validation (2026-11-15): 8 of 40 texts drawn at random within party strata (proportional allocation, at least one per stratum); seed 7 (Text Annotation Lab sampling method 1).');
assert.equal(sample.recordSample([record],{...record,seed:9}).length,1);assert.equal(sample.recordSample([record],{...record,value:'test'}).length,2);
assert.deepEqual(sample.cleanSamples([record,{column:'',value:'x'},null,'x']),[record]);

// --- Views of the results, and comparisons ---------------------------------------------
const viewColumns=[{name:'tone_human',role:'label'},{name:'year',role:'meta'}];
const viewDocs=[
 {id:'a',name:'a.txt',status:'done',score:'POSITIVE',runNo:2,cells:['positive','1961'],earlier:[{runNo:1,status:'done',score:'MIXED'}]},
 {id:'b',name:'b.txt',status:'done',score:'NEGATIVE',runNo:2,cells:['POSITIVE','1981'],earlier:[{runNo:1,status:'done',score:'NEGATIVE'}]},
 {id:'c',name:'c.txt',status:'done',score:'MIXED',runNo:1,cells:['','2009']},
 {id:'d',name:'d.txt',status:'pending',cells:['NEGATIVE','2017']}];
const rowsOf=changes=>view.researchRows(viewDocs,viewColumns,{...view.DEFAULT_VIEW,...changes}).rows;
assert.equal(rowsOf({}).length,4);assert.deepEqual(rowsOf({show:'done'}).map(row=>row.id),['a','b','c']);assert.deepEqual(rowsOf({query:'1981'}).map(row=>row.id),['b']);
assert.deepEqual(rowsOf({column:'year',value:'2009'}).map(row=>row.id),['c']);
assert.deepEqual(rowsOf({run:1}).map(row=>[row.id,row.score]),[['a','MIXED'],['b','NEGATIVE'],['c','MIXED']],'One run shows that run’s results only');
assert.deepEqual(rowsOf({compare:'col:tone_human'}).map(row=>row.compared.match),[true,false,null,null],'Case does not make a disagreement; a missing value is not compared');
assert.deepEqual(rowsOf({compare:'col:tone_human',show:'disagree'}).map(row=>row.id),['b']);
assert.deepEqual(rowsOf({compare:'run:1'}).map(row=>row.compared.other),['MIXED','NEGATIVE','MIXED','']);
assert.deepEqual(view.runTag(viewDocs[0]),{run:2,earlier:false});assert.deepEqual(view.runTag({id:'x',name:'x',status:'pending',earlier:[{runNo:3,status:'done'}]}),{run:3,earlier:true});assert.equal(view.runTag(viewDocs[3]),undefined);
assert.equal(view.viewNarrowed(view.DEFAULT_VIEW),false);assert.equal(view.viewNarrowed({...view.DEFAULT_VIEW,compare:'run:1'}),false,'Comparing does not hide texts');assert.equal(view.viewNarrowed({...view.DEFAULT_VIEW,run:1}),true);
assert.deepEqual(view.parseSource('run:3'),{kind:'run',run:3});assert.deepEqual(view.parseSource('col:tone: human'),{kind:'column',name:'tone: human'});assert.equal(view.parseSource(''),undefined);
let picks=0;assert.deepEqual(view.pickRandom(['a','b','c','d'],2,()=>[0.9,0.1,0.5][picks++%3]).length,2);assert.equal(view.pickRandom(['a'],5).length,1);
// Pairing two sources for agreement: only texts with a value in both are compared.
const pairing=agree.pairSources(viewDocs,viewColumns,{kind:'run',run:2},'',{kind:'column',name:'tone_human'},'');
assert.deepEqual(pairing.names,['a.txt','b.txt']);assert.equal(pairing.onlyA,0);assert.equal(pairing.onlyB,1,'d.txt has a label but no result in run 2');assert.equal(agree.autoLevel(pairing),'nominal');
const paired=agree.runJob(agree.agreementJob(pairing,'auto',1),false);assert.equal(paired.n,2);near(paired.percentAgreement,0.5);
assert.deepEqual(agree.disagreements(pairing).map(d=>[d.name,d.a,d.b]),[['b.txt','NEGATIVE','POSITIVE']]);
assert.equal(agree.statLines(paired,undefined)[0].label,'Texts compared');assert.equal(agree.statLines(paired,undefined,'subject')[0].label,'Subjects compared');
const comparison=agree.agreementTable({a:'Run #2',b:'tone_human',field:'',dataset:'uploaded texts'},paired,undefined);
assert.deepEqual(comparison[1],['data','uploaded texts','','']);assert(comparison.some(row=>row[0]==='texts_compared'&&row[1]===2));assert(comparison.some(row=>row[0]==='cohen_kappa'));
const runToRun=agree.pairSources(viewDocs,viewColumns,{kind:'run',run:2},'',{kind:'run',run:1},'');assert.deepEqual(runToRun.names,['a.txt','b.txt'],'Run 2 against run 1 compares the texts in both');
const numbers=agree.pairSources([{id:'1',name:'1',status:'done',score:'4',runNo:1,cells:['5']},{id:'2',name:'2',status:'done',score:'2',runNo:1,cells:['2']},{id:'3',name:'3',status:'done',score:'1',runNo:1,cells:['3']}],[{name:'rating',role:'label'}],{kind:'run',run:1},'',{kind:'column',name:'rating'},'');
assert.equal(agree.autoLevel(numbers),'ordinal');assert.deepEqual(agree.disagreements(numbers).map(d=>d.gap),[2,1],'Largest differences first on a scale');

// --- Export tables -----------------------------------------------------------------------
const runRecords=[{...setup,number:1,startedAt:'2026-11-15T10:00:00Z'},{...setup,model:'gpt-6.1-terra',number:2,startedAt:'2026-11-15T11:00:00Z'}];
const exportDocs=[
 {id:'a',name:'a.txt',status:'done',score:'POSITIVE',explanation:'Hopeful.',provider:'openai',model:'gpt-6.1-terra',effort:'medium',prompt:'Classify tone',runNo:2,time:'2026-11-15T11:00:05Z',tokens:1200,cells:['positive','1961'],earlier:[{runNo:1,status:'done',score:'MIXED',explanation:'Both.',provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Classify tone',time:'2026-11-15T10:00:05Z',tokens:1100}]},
 {id:'b',name:'b.txt',status:'pending',cells:['NEGATIVE','1981'],earlier:[{runNo:1,status:'done',score:'NEGATIVE',explanation:'Grim.',provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Classify tone',time:'2026-11-15T10:00:06Z',tokens:900}]}];
const dataset={kind:'texts',rows:exportDocs,runs:runRecords,columns:viewColumns,samples:[record]};
const wideRows=exporting.wideTable(dataset);
assert.deepEqual(wideRows[0],['document','tone_human','year','run1_score','run1_explanation','run2_score','run2_explanation']);
assert.deepEqual(wideRows[1],['a.txt','positive','1961','MIXED','Both.','POSITIVE','Hopeful.']);assert.deepEqual(wideRows[2],['b.txt','NEGATIVE','1981','NEGATIVE','Grim.','','']);
const longRows=exporting.longTable(dataset);
assert.deepEqual(longRows[0].slice(0,7),['document','tone_human','year','run','field','value','explanation']);assert.equal(longRows.length,4,'One row per completed result');
assert.deepEqual(longRows.slice(1).map(row=>[row[0],row[3],row[5],row[longRows[0].indexOf('model')]]),[['a.txt',1,'MIXED','gpt-6-luna'],['a.txt',2,'POSITIVE','gpt-6.1-terra'],['b.txt',1,'NEGATIVE','gpt-6-luna']]);
const runRows=exporting.runsTable(dataset);
assert.deepEqual(runRows.slice(1).map(row=>[row[0],row[1],row[runRows[0].indexOf('model')],row[runRows[0].indexOf('texts_completed')],row[runRows[0].indexOf('prompt')]]),[[1,'uploaded texts','gpt-6-luna',2,'Classify tone'],[2,'uploaded texts','gpt-6.1-terra',1,'Classify tone']]);
assert.equal(exporting.samplesTable([record]).length,2);
assert.deepEqual(exporting.uniqueNames(['document','Year','year','run','year']),['document','Year','year_2','run','year_3']);
assert.equal(exporting.wideTable({...dataset,columns:[{name:'Document',role:'meta'},{name:'year',role:'meta'}]})[0][1],'Document_2','An imported column never repeats a column name of the Lab’s own');
assert.equal(exporting.fileStem('Inaugural tone / 2026',dataset),'Inaugural-tone-2026');assert.equal(exporting.fileStem('',{kind:'knowledge'}),'annotations-model-knowledge');
// No API key can be part of an export: the tables are built from texts, runs, columns, and samples alone.
assert(!JSON.stringify([wideRows,longRows,runRows]).includes('sk-'));

// --- Model knowledge read as runs ---------------------------------------------------------
const items=[
 {id:'i1',subjectId:'s1',name:'The Lion King (1994)',status:'done',score:'5',runNumber:1,provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate villainy',webSearch:false,fields:[{heading:'Subject',value:'The Lion King (1994)'}],cells:['4']},
 {id:'i2',subjectId:'s2',name:'Frozen (2013)',status:'done',score:'2',runNumber:1,provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate villainy',webSearch:false,fields:[{heading:'Subject',value:'Frozen (2013)'}]},
 {id:'i3',subjectId:'s1',name:'The Lion King (1994)',status:'done',score:'4',runNumber:2,provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate villainy',webSearch:true,fields:[{heading:'Subject',value:'The Lion King (1994)'}]},
 {id:'i4',subjectId:'s2',name:'Frozen (2013)',status:'pending',runNumber:2,fields:[{heading:'Subject',value:'Frozen (2013)'}]}];
const subjects=knowledge.knowledgeRows(items);
assert.deepEqual(subjects.map(row=>[row.id,row.status,row.score,row.runNo,row.earlier?.map(e=>[e.runNo,e.score])]),[['s1','done','4',2,[[1,'5']]],['s2','pending',undefined,2,[[1,'2']]]]);
assert.deepEqual(subjects[0].cells,['4'],'A subject’s labels are found whichever run holds them');
assert.deepEqual(knowledge.subjectRows(items).map(row=>row.id),['s1','s2']);
const bySubject=knowledge.subjectRows(items);bySubject[1]={...bySubject[1],cells:['1']};
const labeled=knowledge.applySubjectCells(items,bySubject);
assert.deepEqual(labeled.map(item=>item.cells),[['4'],['1'],['4'],['1']],'Labels reach every run of a subject');assert.equal(labeled[0],items[0],'Unchanged items are left as they are');
const knowledgeSet={kind:'knowledge',rows:subjects,runs:[],columns:[{name:'villainy_human',role:'label'}],samples:[]};
const knowledgeWide=exporting.wideTable(knowledgeSet);
assert.deepEqual(knowledgeWide[0],['subject','villainy_human','run1_score','run2_score'],'A simple list’s only field is the subject itself');assert.deepEqual(knowledgeWide[1],['The Lion King (1994)','4','5','4']);
const knowledgeRuns=exporting.runsTable(knowledgeSet);
assert.deepEqual(knowledgeRuns.slice(1).map(row=>[row[0],row[1],row[knowledgeRuns[0].indexOf('web_search')],row[knowledgeRuns[0].indexOf('subjects_completed')]]),[[1,'model knowledge (no texts supplied)','no',2],[2,'model knowledge (no texts supplied)','yes',1]],'Exports say that no texts were supplied');
assert.equal(exporting.sourceOf(knowledgeSet),'model knowledge (no texts supplied)');assert.equal(exporting.unitOf(knowledgeSet),'subject');

// --- A study backup keeps everything research mode adds, and never a key --------------------
(async()=>{
 const backup=load('lib/study-backup.ts');
 const file=new File(['We observe today not a victory of party.'],'a.txt',{type:'text/plain'});
 const study={name:'Round trip',createdAt:'2026-11-15T12:00:00Z',
  texts:{docs:[{...exportDocs[0],file,cells:['positive','b']},{...exportDocs[1],file}],prompt:'Classify tone',provider:'openai',model:'gpt-6-luna',effort:'medium',runs:runRecords,columns:[{name:'tone_human',role:'label'},{name:'key',role:'meta'}],samples:[record],apiKey:'sk-must-not-export',keyring:{openai:'sk-must-not-export'}},
  knowledge:{items:items.map(item=>({...item,...(item.status==='done'?{explanation:'From general knowledge.'}:{}),cells:['4']})),columns:[{name:'villainy_human',role:'label'}],samples:[],prompt:'Rate villainy'}};
 const json=await backup.encodeStudyBackup(study);
 assert(!json.includes('sk-must-not-export'),'A backup never holds an API key');
 const restored=backup.decodeStudyBackup(json);
 assert.deepEqual(restored.texts.runs,runRecords);assert.deepEqual(restored.texts.columns,study.texts.columns,'A column may be named “key”: names are values, not property names');assert.deepEqual(restored.texts.samples,[record]);
 assert.deepEqual(restored.texts.docs.map(doc=>[doc.runNo,doc.cells,doc.earlier]),study.texts.docs.map(doc=>[doc.runNo,doc.cells,doc.earlier]));
 assert.deepEqual(restored.knowledge.columns,study.knowledge.columns);assert.deepEqual(restored.knowledge.items.map(item=>item.cells),study.knowledge.items.map(item=>item.cells));
 assert.deepEqual(exporting.wideTable({kind:'texts',rows:restored.texts.docs,runs:runs.cleanRuns(restored.texts.runs),columns:columns.cleanColumns(restored.texts.columns),samples:[]}).slice(1).map(row=>row.slice(3)),[['MIXED','Both.','POSITIVE','Hopeful.'],['NEGATIVE','Grim.','','']],'The restored study exports the same results');
 // --- Texts from a table or pasted text -----------------------------------------
 const texts=load('lib/research/import-texts.ts');
 const corpus={header:['id','text','year','tone_human','note'],rows:[['a','First speech.','1961','POSITIVE',''],['b','Second speech.','1965','NEGATIVE',''],['b','Another second speech.','1969','',''],['c','','1973','',''],['a','First speech.','1961','POSITIVE',''],['','No ID here.','1977','','']]};
 assert.equal(texts.guessTextColumn(corpus),1);assert.equal(texts.guessIdColumn(corpus),0);
 assert.equal(texts.guessTextColumn({header:['title','abstract'],rows:[['Short','A much longer piece of writing than the title.']]}),1,'Without a telling name, the longest column holds the texts');
 assert.equal(texts.guessIdColumn({header:['title','abstract'],rows:[]}),-1);
 assert.equal(texts.guessIdColumn({header:['content','post_id'],rows:[['A','p1'],['B','p2']]}),1,'A column named like an ID, with a different value in every row');assert.equal(texts.guessIdColumn({header:['content','author_id'],rows:[['A','u1'],['B','u1']]}),-1,'Not when its values repeat');
 let plan=texts.planTable(corpus,1,0,'speeches.csv');
 assert.deepEqual(plan.texts.map(text=>text.name),['a.txt','b.txt','b_2.txt','speeches_6.txt'],'A repeated ID gets _2; a row without an ID is named after the table and its row');
 assert.deepEqual([plan.empty,plan.twice,plan.repeated],[1,1,['b']],'An empty text and a row repeated in every column are left out');
 assert.deepEqual(plan.names,['year','tone_human'],'A column with no values is not kept');assert.deepEqual(plan.texts[0],{name:'a.txt',text:'First speech.',values:['1961','POSITIVE']});
 plan=texts.planTable(corpus,1,-1,'C:\\data\\speeches.xlsx');
 assert.deepEqual(plan.texts.map(text=>text.name),['speeches_1.txt','speeches_2.txt','speeches_3.txt','speeches_6.txt']);assert.deepEqual(plan.names,['id','year','tone_human']);
 assert.deepEqual(texts.planTable({header:['file','text','x'.repeat(61)],rows:[['one.txt','Body','v']]},1,0,'t.csv'),{texts:[{name:'one.txt',text:'Body',values:[]}],names:[],empty:0,twice:0,repeated:[],tooLong:['x'.repeat(61)]},'An ID that is a .txt file name is kept as it is');
 // Tables as files: CSV, JSON, and JSON Lines give the same sheet.
 const asFile=(content,name)=>new File([content],name);
 const expected={header:['id','text','year'],rows:[['a','Hello, world.','1961'],['b','Line one\nLine two','1965']]};
 assert.deepEqual(await texts.parseCorpusTable(asFile('id,text,year\na,"Hello, world.",1961\nb,"Line one\nLine two",1965\n','corpus.csv')),expected);
 assert.deepEqual(await texts.parseCorpusTable(asFile('id\ttext\tyear\na\tHello, world.\t1961\nb\t"Line one\nLine two"\t1965\n','corpus.tsv')),expected);
 assert.deepEqual(await texts.parseCorpusTable(asFile(JSON.stringify([{id:'a',text:'Hello, world.',year:1961},{id:'b',text:'Line one\nLine two',year:1965}]),'corpus.json')),expected);
 assert.deepEqual(await texts.parseCorpusTable(asFile(JSON.stringify({data:[{id:'a',text:'Hello, world.',year:1961},{id:'b',text:'Line one\nLine two',year:1965}]}),'corpus.json')),expected,'An array under "data" is read too');
 assert.deepEqual(await texts.parseCorpusTable(asFile('{"id":"a","text":"Hello, world.","year":1961}\n\n{"id":"b","text":"Line one\\nLine two","year":1965}\n','corpus.jsonl')),expected);
 assert.deepEqual(await texts.parseCorpusTable(asFile('[{"id":"a","text":"T","tags":["x","y"],"extra":null},{"id":"b","text":"U","Text":"V"}]','c.json')),{header:['id','text','tags','extra','Text (2)'],rows:[['a','T','["x","y"]','',''],['b','U','','','V']]},'Lists are kept as JSON; keys that differ only in case are numbered');
 await assert.rejects(texts.parseCorpusTable(asFile('{"id":"a"}\nnot json\n','c.jsonl')),/Line 2 is not valid JSON/);
 await assert.rejects(texts.parseCorpusTable(asFile('{"id":"a"}','c.json')),/Expected a JSON array/);
 await assert.rejects(texts.parseCorpusTable(asFile('x','old.xls')),/\.xlsx or \.csv/);
 // Pasted text.
 assert.deepEqual(texts.splitPasted('  \n\nOne\nstill one\n\n \nTwo\n\n','blank'),['One\nstill one','Two']);
 assert.deepEqual(texts.splitPasted('One\n\nTwo\nThree','line'),['One','Two','Three']);
 assert.deepEqual(texts.splitPasted(' One\n\nTwo ','none'),[' One\n\nTwo '],'One text is kept exactly as pasted');assert.deepEqual(texts.splitPasted(' \n ','blank'),[]);
 assert.deepEqual(texts.pastedTexts(['A','B'],'my notes').map(text=>text.name),['my_notes_1.txt','my_notes_2.txt']);assert.deepEqual(texts.pastedTexts(['A'],''),[{name:'pasted.txt',text:'A',values:[]}]);
 assert.equal(texts.countWords('One two\n three'),3);
 // Fitting into the study: the same name and text is left out; a name taken by another text gets a number.
 const held=[{name:'a.txt',file:asFile('First speech.','a.txt')},{name:'B.TXT',file:asFile('Something else.','B.TXT')},{name:'report.pdf',file:asFile('%PDF','report.pdf')}];
 const fitted=await texts.fitIntoStudy(texts.planTable(corpus,1,0,'speeches.csv').texts,held);
 assert.deepEqual([fitted.already,fitted.renamed,fitted.texts.map(text=>text.name)],[1,1,['b_3.txt','b_2.txt','speeches_6.txt']],'Names are compared without regard to case');
 assert.equal(fitted.texts[0].text,'Second speech.');
 // Joining the study: other columns become labels or metadata, a column with the same name is reused, and earlier texts are untouched.
 const before=[{id:'old',name:'old.txt',status:'done',cells:['2001']}];
 const joined=columns.appendTexts(before,[{name:'Year',role:'meta'}],fitted.texts,['year','tone_human'],text=>({id:text.name,name:text.name,status:'pending'}));
 assert.deepEqual(joined.columns,[{name:'Year',role:'meta'},{name:'tone_human',role:'label'}],'A column named for human labels is taken as labels');
 assert.equal(joined.docs[0],before[0]);assert.deepEqual(joined.docs.slice(1).map(doc=>[doc.name,doc.cells]),[['b_3.txt',['1965','NEGATIVE']],['b_2.txt',['1969','']],['speeches_6.txt',['1977','']]]);
 assert.deepEqual(columns.appendTexts([],[],[{name:'p.txt',text:'P',values:[]}],[],text=>({id:'p',name:text.name,status:'pending'})),{docs:[{id:'p',name:'p.txt',status:'pending'}],columns:[]});
 assert(columns.CORPUS_TABLE.test('Corpus.XLSX')&&columns.CORPUS_TABLE.test('a.jsonl')&&!columns.CORPUS_TABLE.test('speech.txt')&&!columns.CORPUS_TABLE.test('speech.pdf'));

 console.log('Research library checks passed.');
})().catch(error=>{console.error(error);process.exit(1);});
