// Annotations per text (research mode): how a text's annotations are combined, kept, filled in, counted,
// compared, and exported. The run itself (now and as a batch) is checked in research-mode.cjs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const root=process.cwd(),cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):require(id));
 return exports;
}
const repeats=load('lib/research/repeats.ts'),runs=load('lib/research/runs.ts'),view=load('lib/research/view.ts'),agree=load('lib/research/agreement.ts'),cost=load('lib/cost-estimate/run-cost.ts');
const data=load('lib/research/export-data.ts'),tables=load('lib/research/export-tables.ts'),packages=load('lib/research/export-packages.ts'),lines=load('lib/research/export.ts'),records=load('lib/research/requests.ts'),backup=load('lib/study-backup.ts');
const near=(a,b)=>Math.abs(a-b)<1e-9;
const readCsv=text=>text.replace(/^﻿/,'').trim().split(/\r?\n/).map(line=>line.split(','));

// --- The number as stored ---------------------------------------------------------------------------------
assert.deepEqual([1,2,10,11,'3',2.5,undefined].map(repeats.cleanRepeats),[undefined,2,10,undefined,undefined,undefined,undefined]);
assert.equal(repeats.repeatsOf({}),1);assert.equal(repeats.repeatsOf({repeats:4}),4);assert.equal(repeats.MAX_REPEATS,10);

// --- Combining: majority, median, mean; the explanation of the annotation closest to the combined answers ----
const SETTINGS={fields:[{name:'stance',type:'category',values:['pro','con','neutral'],description:''},{name:'tone',type:'ordinal',values:['1','2','3','4','5'],description:''},{name:'count',type:'number',values:[],description:''},{name:'ironic',type:'boolean',values:[],description:''},{name:'note',type:'text',values:[],description:''},{name:'stance_explanation',type:'text',values:[],description:''}]};
const NAMES=SETTINGS.fields.map(field=>field.name);
const made=(n,answers,explanation,extra={})=>({n,status:'done',answers:Object.fromEntries(answers.map((value,i)=>['f'+i,value])),score:'',explanation,tokens:100+n,time:`2026-11-16T10:00:0${n}.000Z`,...extra});
const three=[made(1,['pro','4','10','true','first note','Because A.'],'Overall A.'),made(2,['con','2','11','true','second note','Because B.'],'Overall B.'),made(3,['Pro','3','12','true','third note','Because C.'],'Overall C.')];
let c=repeats.combine(three,NAMES,SETTINGS);
assert.deepEqual(c.answers,{f0:'pro',f1:'3',f2:'11',f3:'true',f4:'first note | second note | third note',f5:'Because A.'},'Most annotations for a category and a yes / no, the median of a scale, the mean of a number; an explanation field is the one of the closest annotation, never a mix');
assert.equal(c.explanation,'Overall C.','The explanation written with the answers closest to the combined ones');
assert.deepEqual(Object.keys(c.consistency),['f0','f1','f2','f3'],'A share for every answer but free text, keyed like the answers');
assert(near(c.consistency.f0,2/3)&&near(c.consistency.f1,1/3)&&near(c.consistency.f2,1/3)&&c.consistency.f3===1,'Spellings that differ only in case are the same answer');
// A tied vote keeps both values; a median between two points is a half point.
c=repeats.combine([made(1,['pro','2','1','true','',''],'A'),made(2,['con','3','2','false','',''],'B')],NAMES,SETTINGS);
assert.deepEqual([c.answers.f0,c.answers.f1,c.answers.f2,c.answers.f3],['con | pro','2.5','1.5','false | true']);assert.equal(c.consistency.f0,0);assert.equal(c.explanation,'A','The first of annotations that are as close');
// One annotation: its own answers, and no shares.
c=repeats.combine([three[1]],NAMES,SETTINGS);assert.equal(c.answers.f0,'con');assert.equal(c.explanation,'Overall B.');assert.equal(c.consistency,undefined);
// A prompt without named answer fields: the single score or category.
c=repeats.combine([{n:1,status:'done',score:'POSITIVE',explanation:'One'},{n:2,status:'done',score:'NEGATIVE',explanation:'Two'},{n:3,status:'done',score:'positive',explanation:'Three'}]);
assert.equal(c.score,'POSITIVE');assert.equal(c.explanation,'One');assert(near(c.consistency.score,2/3));assert.equal(c.answers,undefined);
// Plain text: replies that are JSON are combined value by value; a reply in prose has nothing to add.
const plain=reply=>({n:1,status:'done',answers:{f0:reply}});
c=repeats.combine([plain('{"race":3,"race_explanation":"x","gender":"f"}'),plain('{"race":5,"race_explanation":"y","gender":"m"}'),plain('I cannot say.'),plain('{"race":"NA","race_explanation":"z","gender":"f"}')],['response'],{plain:true});
assert.deepEqual(JSON.parse(c.answers.f0),{race:4,race_explanation:'x',gender:'f'},'A score: the median of its numbers ("NA" is left out); another value: the one most replies gave');
assert.deepEqual(Object.keys(JSON.parse(c.answers.f0)),['race','race_explanation','gender']);assert.equal(c.consistency,undefined);
assert.equal(repeats.combine([plain('yes'),plain('no'),plain('yes')],['response'],{plain:true}).answers.f0,'yes');
assert.equal(repeats.combine([plain('b'),plain('a')],['response'],{plain:true}).answers.f0,'a | b');

// --- A text's own fields ----------------------------------------------------------------------------------
const failed={n:3,status:'error',error:'Boom',tokens:7,time:'2026-11-16T10:00:09.000Z',runId:'click-1'};
const base={id:'t1',name:'t1.txt',status:'done',runNo:1,runId:'click-1',provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',prompt:'Rate.',answerFields:NAMES,answerSettings:SETTINGS,repeats:3};
let row={...base,annotations:[three[0],three[1],failed]};
let settled=repeats.settle(row);
assert.equal(settled.status,'done');assert.equal(settled.tokens,101+102+7,'Tokens are the total of the annotations');assert.equal(settled.time,'2026-11-16T10:00:09.000Z');assert.equal(settled.answers.f1,'3');
for(const key of ['usage','responseId','rawResponse','modelReported','stopReason','output'])assert.equal(settled[key],undefined,key+' belongs to each annotation');
row={...row,...settled};
assert.deepEqual(repeats.missingRepeats(row),[3]);assert.equal(repeats.incomplete(row),true);assert.deepEqual(repeats.annotationCount(row),{ok:2,of:3});
assert.equal(repeats.annotationCount({status:'done'}),undefined);assert.equal(repeats.incomplete({status:'done'}),false);
assert.equal(repeats.consistencyOf(row,'stance'),0,'A tied vote: no annotation gave both values');assert.equal(repeats.consistencyOf(row,'ironic'),1);assert.equal(repeats.consistencyOf(row,'note'),undefined);assert.equal(repeats.consistencyOf(row,'missing'),undefined);assert.equal(repeats.consistencyOf({consistency:{score:1}},''),1);
assert.equal(repeats.tiedVote(row,'stance'),true,'pro and con, one each');assert.equal(repeats.tiedVote(row,'tone'),false);
assert.equal(repeats.tiedVote({answerFields:['pair'],answers:{f0:'a | b'},annotations:[{n:1,status:'done',answers:{f0:'a | b'}}]},'pair'),false,'A value an annotation gave as it is is no tie');
const none=repeats.settle({...base,annotations:[failed,{...failed,n:1,error:'Earlier'}]});
assert.equal(none.status,'error');assert.equal(none.error,'All 2 annotations failed. The first: Earlier');assert.equal(none.answers,undefined);
assert.equal(repeats.settle({...base,annotations:[failed]}).error,'Boom');assert.equal(repeats.settle({...base,annotations:[]}).error,'No annotation was made.');
// Annotations as read: only numbered ones with an outcome, in order.
assert.deepEqual(repeats.annotationsOf({annotations:[{n:2,status:'done'},null,{n:0,status:'done'},{n:1,status:'running'},{n:1,status:'error'},{n:11,status:'done'}]}).map(a=>a.n),[1,2]);
// What an annotation keeps: its own reply and the click it was sent with, not its text's settings.
assert.deepEqual(repeats.annotationFrom(2,true,{answers:{f0:'x'},model:'m',prompt:'p',usage:{a:1},runId:'click-9',annotations:[1]}),{n:2,status:'done',runId:'click-9',answers:{f0:'x'},usage:{a:1}});
// An annotation that comes back takes the place of a failed one with its number, which becomes a failed attempt.
let next=repeats.withAnnotation({...row,runId:'click-2',history:[{status:'error',error:'Old'}]},{...three[2],runId:'click-2'});
assert.deepEqual(next.annotations.map(a=>[a.n,a.status]),[[1,'done'],[2,'done'],[3,'done']]);
assert.equal(next.history.length,2);assert.deepEqual([next.history[1].status,next.history[1].replicate,next.history[1].error,next.history[1].runId,next.history[1].model,next.history[1].repeats,next.history[1].runNo],['error',3,'Boom','click-1','openai/gpt-6-luna',3,1],'The attempt keeps the click it was sent with and its text’s settings');
assert.equal(repeats.withAnnotation(row,{...three[0],explanation:'Again'}).history,undefined,'A usable annotation that is replaced leaves no failed attempt');
assert.equal(repeats.withAnnotation({...base,annotations:[]},three[0]).annotations.length,1);
// A text whose requests were not sent after all.
assert.equal(repeats.unclaimed({...base,status:'queued',annotations:[]}).status,'pending');assert.equal(repeats.unclaimed({...row,status:'queued'}).status,'done');
// Every request behind a result, read as a result of its own.
const requests=repeats.requestsOf({...row,usage:{total:1},history:[{status:'error'}],earlier:[{}]});
assert.deepEqual(requests.map(request=>[request.replicate,request.result.status,request.result.model,request.result.answers?.f0]),[[1,'done','openai/gpt-6-luna','pro'],[2,'done','openai/gpt-6-luna','con'],[3,'error','openai/gpt-6-luna',undefined]]);
assert(requests.every(request=>!('annotations' in request.result)&&!('consistency' in request.result)&&!('history' in request.result)&&!('earlier' in request.result)&&request.result.usage===undefined));
assert.equal(requests[0].result.runId,'click-1','An annotation without a click of its own has its text’s');assert.equal(requests[2].result.error,'Boom');
const single={status:'done',score:'A'};assert.deepEqual(repeats.requestsOf(single),[{result:single,replicate:1}]);assert.equal(repeats.requestsOf({status:'error',replicate:2})[0].replicate,2);

// --- Runs: the number is part of a run's settings; missing annotations are filled in by Remaining --------------
const setup={provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',prompt:'Rate.',answerFields:NAMES,answerSettings:SETTINGS,repeats:3};
assert.equal(runs.sameSetup(setup,{...setup}),true);assert.equal(runs.sameSetup(setup,{...setup,repeats:2}),false);assert.equal(runs.sameSetup({...setup,repeats:undefined},{...setup,repeats:1}),true);
assert.equal(runs.setupOf(row).repeats,3);assert.equal('repeats' in runs.setupOf({model:'m'}),false);
assert.equal(runs.cleanRuns([{number:1,model:'m',prompt:'p',repeats:3},{number:2,model:'m',prompt:'p',repeats:99}])[0].repeats,3);assert.equal('repeats' in runs.cleanRuns([{number:2,model:'m',prompt:'p',repeats:99}])[0],false);
const whole={...base,id:'t2',name:'t2.txt',annotations:three};Object.assign(whole,repeats.settle(whole));
const docs=[row,whole,{id:'t3',name:'t3.txt',status:'pending'}],runList=[{...setup,number:1,startedAt:'2026-11-16T10:00:00.000Z'}];
assert.deepEqual([...runs.resumable(docs,runList,setup)],['t1']);
assert.deepEqual([...runs.resumable(docs,runList,{...setup,repeats:2})],[],'Other settings: a new run, nothing to fill in');assert.deepEqual([...runs.resumable(docs,runList,{...setup,repeats:undefined})],[]);
assert.deepEqual([...runs.resumable(docs,[...runList,{...setup,number:2,startedAt:'x'}],setup)],[],'Only the latest run is filled in');
assert.deepEqual(runs.remainingFor(docs,setup).map(doc=>doc.id),['t3']);assert.deepEqual(runs.remainingFor(docs,setup,runs.resumable(docs,runList,setup)).map(doc=>doc.id),['t1','t3']);
const summary=runs.runSummaries(docs,runList)[0];assert.deepEqual([summary.done,summary.failed,summary.fewer,summary.repeats],[2,0,1,3]);
// Annotating again keeps the annotations with the earlier result.
const again=runs.requeue(docs,runList,new Set(['t2'])).docs[1];assert.equal(again.status,'pending');assert.equal(again.annotations,undefined);assert.equal(again.earlier[0].annotations.length,3);assert.equal(again.earlier[0].repeats,3);
assert.equal(runs.rowForRun(again,1).annotations.length,3);

// --- Comparing one annotation with another (a retest) -----------------------------------------------------------
assert.equal(view.sourceKey({kind:'run',run:3,rep:2}),'run:3#2');assert.deepEqual(view.parseSource('run:3#2'),{kind:'run',run:3,rep:2});assert.deepEqual(view.parseSource('run:3'),{kind:'run',run:3});
for(const key of ['run:3#0','run:3#x','run:3#','run:0#1','run:#2'])assert.equal(view.parseSource(key),undefined,key);
assert.equal(agree.sourceLabel({kind:'run',run:3,rep:2}),'Run #3 · annotation 2');assert.equal(agree.sourceLabel({kind:'run',run:3}),'Run #3');
assert.deepEqual(agree.sourceValues(docs,[],{kind:'run',run:1},'stance'),['con | pro','pro','']);
assert.deepEqual(agree.sourceValues(docs,[],{kind:'run',run:1,rep:1},'stance'),['pro','pro','']);assert.deepEqual(agree.sourceValues(docs,[],{kind:'run',run:1,rep:2},'tone'),['2','2','']);
assert.deepEqual(agree.sourceValues(docs,[],{kind:'run',run:1,rep:3},'stance'),['','Pro',''],'A failed annotation has no value');assert.deepEqual(agree.sourceValues(docs,[],{kind:'run',run:1,rep:4},'stance'),['','','']);
assert.deepEqual(agree.sourceFields(docs,{kind:'run',run:1,rep:2}),NAMES);
const pairing=agree.pairSources(docs,[],{kind:'run',run:1,rep:1},'tone',{kind:'run',run:1,rep:2},'tone');assert.deepEqual([pairing.a,pairing.b,pairing.level],[['4','4'],['2','2'],'ordinal']);
assert.equal(view.sourceResult(again,{run:1,rep:2}).answers.f0,'con');assert.equal(view.sourceResult(docs[2],{run:1,rep:2}).status,'absent');

// --- Cost: a result made of several annotations counts request by request ----------------------------------------
const paid=(n,amount,extra={})=>({n,status:'done',usage:{cost:amount},...extra}),click={runId:'click-2',runStartedAt:'2026-11-16T11:00:00Z',runSize:2},old={runId:'click-1',runStartedAt:'2026-11-16T10:00:00Z',runSize:3};
let summed=cost.latestRunCost([{...base,...old,status:'done',annotations:[paid(1,.01,old),paid(2,.02,old),paid(3,.04,old)]}]);
assert(near(summed.amount,.07));assert.deepEqual([summed.count,summed.known,summed.planned,summed.active],[3,3,3,0]);
// Missing annotations filled in later: the latest click counts only its own requests, with the failed attempt it replaced left to the earlier click.
summed=cost.latestRunCost([{...base,...click,status:'done',history:[{status:'error',replicate:3,...old,provider:'openrouter',usage:{cost:.5}}],annotations:[paid(1,.01,old),paid(2,.02,click),paid(3,.04,click)]}]);
assert(near(summed.amount,.06));assert.deepEqual([summed.count,summed.planned],[2,2]);
// While a text is being annotated: one request in progress for each annotation still to come.
summed=cost.latestRunCost([{...base,...click,runSize:3,status:'running',annotations:[paid(1,.01,{...click,runSize:3})]},{...base,...click,runSize:3,id:'t9',status:'running',annotations:[]}]);
assert.deepEqual([summed.count,summed.known,summed.active],[6,1,5]);
assert.equal(cost.latestRunCost([{status:'running',runId:'r',runStartedAt:'x'}]).active,1,'One annotation per text: as before');
const runLine=lines.runLines({kind:'texts',rows:[{...base,status:'done',annotations:[paid(1,.01),paid(2,.02),{n:3,status:'error'}]}],runs:runList,columns:[],samples:[]})[0];
assert(near(runLine.cost,.03));assert.deepEqual([runLine.costKnown,runLine.costCount],[2,3]);

// --- The requests a study still names include those of its annotations ----------------------------------------------
const kept=[{id:'q1',url:'u',body:'a'},{id:'q2',url:'u',body:'b'},{id:'q3',url:'u',body:'c'}];
assert.deepEqual(records.usedRequests(kept,[{requestId:'q2',annotations:[{n:1,status:'done',requestId:'q1'}]}]).map(request=>request.id),['q1','q2']);
assert.deepEqual(records.usedRequests(kept,[{earlier:[{annotations:[{requestId:'q3'}]}]}]).map(request=>request.id),['q3']);

// --- Exports: a row per request with its replicate, the share behind each combined answer, and the number in every record ---
const stamp=(annotation,at)=>({...annotation,startedAt:`2026-11-16T10:0${at}:00.000Z`,time:`2026-11-16T10:0${at}:05.000Z`,processing:'instant',usage:{cost:.01,prompt_tokens:100,completion_tokens:20}});
const exportRows=[
 {...base,id:'t1',name:'t1.txt',file:new File(['First text.'],'t1.txt'),cells:['pro'],annotations:[stamp(three[0],1),stamp(three[1],2),stamp(three[2],3)]},
 // Annotation 2 failed for good; annotation 3 failed once and was sent again.
 {...base,id:'t2',name:'t2.txt',file:new File(['Second text.'],'t2.txt'),cells:['con'],annotations:[stamp(made(1,['con','2','11','true','n','Because B.'],'Overall B.'),4),stamp({n:2,status:'error',error:'The model stopped before finishing.'},5),stamp(made(3,['pro','4','12','true','n','Because A.'],'Overall A.'),7)],
  history:[{status:'error',replicate:3,runNo:1,provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',prompt:'Rate.',answerFields:NAMES,answerSettings:SETTINGS,repeats:3,error:'Timed out.',startedAt:'2026-11-16T10:06:00.000Z',time:'2026-11-16T10:06:05.000Z',processing:'instant'}]}];
for(const doc of exportRows)Object.assign(doc,repeats.settle(doc));
const dataset={kind:'texts',rows:exportRows,runs:runList,columns:[{name:'stance_human',role:'label'}],samples:[]},study={name:'Stance study',dataset,lab:'test'};
const requestLines=data.requestLines(dataset);
assert.deepEqual(requestLines.map(line=>[line.row.id,line.run,line.replicate,line.attempt,line.replaced,line.result.status]),[['t1',1,1,1,false,'done'],['t1',1,2,1,false,'done'],['t1',1,3,1,false,'done'],['t2',1,1,1,false,'done'],['t2',1,2,1,false,'error'],['t2',1,3,1,true,'error'],['t2',1,3,2,false,'done']],'In the order of the texts, then the replicate, then the attempt');
const facts=tables.runFacts(dataset,lines.runLines(dataset)[0]);
assert.deepEqual([facts.texts,facts.usable,facts.requests.total,facts.requests.ok,facts.requests.failed,facts.requests.replaced],[2,2,6,5,1,1]);
const results=tables.resultsTable(study,1);
assert.deepEqual(results[0],['doc_id','stance','stance_replicate_agreement','stance_explanation','tone','tone_replicate_agreement','count','count_replicate_agreement','ironic','ironic_replicate_agreement','note','rationale','stance_human','n_ok','n_error'],'Each field with its share, its explanation right after it');
const cells=(row,names)=>names.map(name=>row[results[0].indexOf(name)]);
assert.deepEqual(cells(results[1],['stance','stance_replicate_agreement','tone','tone_replicate_agreement','count','count_replicate_agreement','ironic','ironic_replicate_agreement']),['pro',0.667,'3',0.333,'11',0.333,'true',1]);assert.deepEqual(cells(results[2],['stance','stance_replicate_agreement','tone','tone_replicate_agreement']),['con | pro',0,'3',0]);assert.deepEqual(results[2].slice(-2),[2,2],'Usable and failed requests of the text, a replaced attempt included');
assert(!tables.resultsTable({...study,dataset:{...dataset,rows:[{...single,id:'s',name:'s.txt',runNo:1}],runs:[]}},1)[0].some(name=>name.includes('replicate_agreement')),'No share for one annotation per text');
const byRequest=tables.requestsTable(study,[1],new Map());
const at=name=>byRequest[0].indexOf(name);assert.deepEqual(byRequest[0].slice(8,11),['doc_id','replicate','status']);
assert.deepEqual(byRequest.slice(1).map(line=>[line[at('doc_id')],line[at('replicate')],line[at('status')]]),[['t1',1,'ok'],['t1',2,'ok'],['t1',3,'ok'],['t2',1,'ok'],['t2',2,'error'],['t2',3,'ok']],'One row per annotation; a replaced attempt is kept in the logs');
assert(!byRequest[0].includes('attempt')&&!byRequest[0].includes('sent_again'));
assert.deepEqual(byRequest.slice(1).map(line=>line[byRequest[0].indexOf('stance')]),['pro','con','Pro','con','','pro'],'Each annotation’s own answer');
assert.equal(byRequest[5][byRequest[0].indexOf('error')],'The model stopped before finishing.');
const overview=tables.runsOverview(study,new Map());assert.equal(overview[1][overview[0].indexOf('replicates')],3);assert.equal(overview[0].indexOf('replicates'),overview[0].indexOf('n_texts')+1,'Right after the number of texts');

(async()=>{
 const pack=await packages.buildSupplementary({study,read:data.documentReader(dataset,file=>file.text()),now:new Date('2026-11-16T12:00:00.000Z')},1,{texts:true,explanations:true,logs:true});
 const read=async name=>{const file=pack.files.find(entry=>entry.path===pack.name+'/'+name);assert(file,name+' is in the package');return typeof file.data==='string'?file.data:file.data instanceof Blob?await file.data.text():Buffer.from(file.data).toString('utf8');};
 assert(pack.files.some(file=>file.path.endsWith('results/results_by_replicate.csv'))&&!pack.files.some(file=>file.path.includes('by_request')));
 const metadata=JSON.parse(await read('metadata.json'));
 assert.equal(metadata.options.annotations_per_text,3);assert.deepEqual(metadata.corpus,{n_texts_in_run:2,n_texts_with_usable_annotation:2,n_texts_with_fewer_usable_annotations:1,n_texts_with_tied_votes:{stance:1}},'Counters that are 0 are left out; tied votes by field');
 assert.deepEqual([metadata.requests.total,metadata.requests.ok,metadata.requests.failed,metadata.requests.replaced_by_retries,metadata.requests.sent_in_all],[6,5,1,1,7]);
 const readme=await read('README.md');
 for(const part of ['| Annotations per text | 3 |','| Requests (ok / failed) | 5 / 1 |','Each text’s 3 annotations were combined: categorical labels by majority vote, ordinal labels by the median, numbers by the mean, and free text by majority vote of the exact wording; a tied vote is kept as both values (for example, “a | b”) and is left out of the agreement figures.','`n_ok` is the number of usable annotations, where a text has fewer than 3','`<field>_replicate_agreement` is the share of them that gave the combined value','(text × annotation; `replicate` numbers a text’s annotations)','same doc_id and replicate; attempt 1, 2, …'])assert(readme.includes(part),'README: '+part);
 assert.equal(readCsv(await read('results/results_by_replicate.csv')).length,7,'One row per annotation');
 const sent=(await read('logs/requests.jsonl')).trim().split('\n').map(line=>JSON.parse(line)),replies=(await read('logs/responses.jsonl')).trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(sent.map(line=>[line.doc_id,line.replicate,line.attempt,line.sent_again]),[['t1',1,1,undefined],['t1',2,1,undefined],['t1',3,1,undefined],['t2',1,1,undefined],['t2',2,1,undefined],['t2',3,1,true],['t2',3,2,undefined]]);
 assert.deepEqual(replies.map(line=>line.status),['ok','ok','ok','ok','error','error','ok']);assert.deepEqual(Object.keys(sent[0]).slice(0,4),['doc_id','replicate','attempt','request']);
 assert((await read('scripts/annotate.py')).includes('\nREPLICATES = 3\n'));assert(load('lib/research/export-python.ts').SCRIPT_TEMPLATE.includes('REPLICATES = {{REPLICATES}}'),'The template (in the research repository) marks the value');
 // A complete run without ties, and one annotation per text: the README’s note on combining says only what applies.
 const tidy={...study,dataset:{...dataset,rows:[exportRows[0]]}},tidyReadme=await (async()=>{const p=await packages.buildSupplementary({study:tidy,read:data.documentReader(tidy.dataset,file=>file.text()),now:new Date('2026-11-16T12:00:00.000Z')},1,{texts:false,explanations:true,logs:false});const f=p.files.find(entry=>entry.path.endsWith('README.md'));return f.data;})();
 assert(tidyReadme.includes('Each text’s 3 annotations were combined: categorical labels by majority vote, ordinal labels by the median, numbers by the mean, and free text by majority vote of the exact wording; a tied vote is kept as both values')&&!tidyReadme.includes('n_ok'),'One factual line on combining; no n_ok when every text has all its annotations');
 const once={...study,dataset:{...dataset,runs:[{...setup,repeats:undefined,number:1,startedAt:'x'}],rows:[{...base,repeats:undefined,id:'o',name:'o.txt',file:new File(['x'],'o.txt'),answers:three[0].answers,score:'',explanation:'E',startedAt:'2026-11-16T10:00:00.000Z',time:'2026-11-16T10:00:05.000Z'}]}};
 const oncePack=await packages.buildSupplementary({study:once,read:data.documentReader(once.dataset,file=>file.text()),now:new Date('2026-11-16T12:00:00.000Z')},1,{texts:false,explanations:true,logs:false}),onceReadme=oncePack.files.find(entry=>entry.path.endsWith('README.md')).data;
 assert(onceReadme.includes('| Annotations per text | 1 |')&&!onceReadme.includes('times')&&!onceReadme.includes('replicate_agreement')&&!onceReadme.includes('tied vote'));
 assert(oncePack.files.find(entry=>entry.path.endsWith('scripts/annotate.py')).data.includes('\nREPLICATES = 1\n'));
 // The workbook names the number and has the sheet of requests.
 const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load((await packages.buildRunWorkbook({study,read:data.documentReader(dataset,file=>file.text()),now:new Date('2026-11-16T12:00:00.000Z')},1)).data);
 assert.deepEqual(book.worksheets.map(sheet=>sheet.name),['Results','By replicate','Agreement','Settings','All runs']);
 const settings=[];book.getWorksheet('Settings').eachRow(line=>settings.push([line.getCell(1).value,line.getCell(2).value]));
 assert.equal(settings.find(line=>line[0]==='Annotations per text')[1],'3 (the Results sheet has the combined answers; By replicate has each annotation)');

 // --- A study backup keeps the annotations and the setting ------------------------------------------------------------
 const stored={name:'Stance study',createdAt:'2026-11-16T12:00:00Z',knowledge:{},texts:{prompt:'Rate.',provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',repeats:3,runs:runList,docs:exportRows.map(doc=>({...doc,answerSettings:undefined})),
  batchJob:{runId:'lab_1',provider:'openai',model:'m',prompt:'p',effort:'low',docIds:['t2'],repeats:3,ns:[[2]],createdAt:'2026-11-16T12:00:00Z',state:'processing'}}};
 const json=await backup.encodeStudyBackup(stored),restored=backup.decodeStudyBackup(json);
 assert.equal(restored.texts.repeats,3);assert.deepEqual(restored.texts.batchJob.ns,[[2]]);assert.equal(restored.texts.runs[0].repeats,3);
 assert.deepEqual(restored.texts.docs[1].annotations.map(a=>[a.n,a.status,a.answers?.f0,a.usage?.cost]),[[1,'done','con',.01],[2,'error',undefined,.01],[3,'done','pro',.01]]);
 assert.deepEqual(restored.texts.docs[1].consistency,exportRows[1].consistency);assert.equal(restored.texts.docs[1].history[0].replicate,3);assert.equal(restored.texts.docs[0].repeats,3);
 const mutate=change=>{const copy=JSON.parse(json);change(copy.workspaces.texts);return JSON.stringify(copy);};
 for(const [what,broken] of [['an annotation numbered 11',mutate(w=>{w.docs[0].annotations[0].n=11;})],['an annotation without an outcome',mutate(w=>{w.docs[0].annotations[0].status='running';})],['eleven annotations',mutate(w=>{w.docs[0].annotations=Array.from({length:11},(_,i)=>({n:1,status:'done'}));})],['a number over ten',mutate(w=>{w.repeats=11;})],['a share that is no number',mutate(w=>{w.docs[0].consistency.f0='all';})],['an annotation whose answers are not text',mutate(w=>{w.docs[0].annotations[0].answers={f0:{}};})]])assert.throws(()=>backup.decodeStudyBackup(broken),undefined,what);
 console.log('PASS: annotations per text are combined, kept, filled in, counted, compared, and exported.');
})().catch(error=>{console.error(error);process.exit(1);});
