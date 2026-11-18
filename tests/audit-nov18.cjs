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

 // #17. Table text: UTF-16 with its byte-order mark is read; Windows-1252 is refused with a way out; an Excel ID shown
 // as 0001 stays 0001.
 const parse=load('lib/research/parse-table.ts'),imports=load('lib/research/import-texts.ts');
 const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('id\ttext\r\n1\tcafé\r\n','utf16le')]);
 let sheet=await parse.parseSpreadsheet(new File([utf16],'excel.txt'));
 assert.deepEqual(sheet,{header:['id','text'],rows:[['1','café']]});
 await assert.rejects(parse.parseSpreadsheet(new File([Buffer.from([0x69,0x64,0x2c,0x74,0x65,0x78,0x74,0x0a,0x31,0x2c,0x63,0x61,0x66,0xe9,0x0a])],'danish.csv')),/not saved as UTF-8.*CSV UTF-8/);
 await assert.rejects(imports.parseCorpusTable(new File([Buffer.from([0x5b,0x7b,0x22,0x74,0x22,0x3a,0x22,0xe9,0x22,0x7d,0x5d])],'x.json')),/not saved as UTF-8/);
 const ExcelJS=req('exceljs'),book=new ExcelJS.Workbook(),ws=book.addWorksheet('S');ws.addRow(['id','text']);const row=ws.addRow([1,'hello']);row.getCell(1).numFmt='0000';
 sheet=await parse.parseSpreadsheet(new File([await book.xlsx.writeBuffer()],'ids.xlsx'));
 assert.deepEqual(sheet.rows,[['0001','hello']]);
 // #18. Three coders survive, whatever the headers; JSON keys that differ only in case too.
 sheet=parse.parseDelimited('id,text,Coder,Coder,Coder (2)\n1,hi,a,b,c\n');
 assert.deepEqual(sheet.header,['id','text','Coder','Coder (3)','Coder (2)']);assert.deepEqual(sheet.rows[0],['1','hi','a','b','c']);
 sheet=await imports.parseCorpusTable(new File([JSON.stringify([{id:'1',text:'t',a:'x',A:'y','A (2)':'z'}])],'k.json'));
 assert.equal(new Set(sheet.header.map(h=>h.toLowerCase())).size,5);assert.deepEqual(sheet.rows[0],['1','t','x','y','z']);
 // #19. An unclosed quotation mark is refused with its line; a closed multiline value still works.
 assert.throws(()=>parse.parseDelimited('id,text\n1,"open quote\n2,next row\n3,third\n'),/line 2 is never closed/);
 assert.deepEqual(parse.parseDelimited('id,text\n1,"two\nlines"\n2,next\n').rows,[['1','two\nlines'],['2','next']]);
 // #20. 150,000 short rows are read; the key column of a sheet is guessed once, not once per row.
 const big='id,text\n'+Array.from({length:150000},(_,i)=>i+',x').join('\n');
 assert.equal(parse.parseDelimited(big).rows.length,150000);
 assert.match(source('components/research/import-texts.tsx'),/const key=guessKeyColumn\(rows,sheet\);return matchRows\(rows,sheet\.rows\.map\(row=>row\[key\]\|\|''\)\)/);
 // #21. An HTML page larger than the converter's default limit keeps its last paragraph.
 const {extractText}=load('lib/extract-text.ts');
 const html='<p>FIRST</p><!--'+'x'.repeat(16777216)+'--><p>LAST</p>';
 const converted=await extractText(new File([html],'long.html'));
 assert.match(converted,/FIRST/);assert.match(converted,/LAST/);
 // #8. A pasted or table text over 20 MB is refused before it is added, and a backup names an oversized file.
 await assert.rejects(imports.fitIntoStudy([{name:'huge.txt',text:'é'.repeat(10*1024*1024+1),values:[]}],[]),err=>err instanceof imports.TooLong&&/huge\.txt.*20 MB/.test(err.message));
 assert.equal((await imports.fitIntoStudy([{name:'fine.txt',text:'a'.repeat(1000),values:[]}],[])).texts.length,1);
 const backup=load('lib/study-backup.ts');
 await assert.rejects(backup.encodeStudyBackup({name:'S',createdAt:new Date().toISOString(),texts:{docs:[{id:'1',name:'big.txt',file:new File([new Uint8Array(20*1024*1024+1)],'big.txt')}]},knowledge:{}}),/big\.txt.*larger than 20 MB/);

 // #5. Six subjects with 1 of 10 annotations: 54 requests to send, so the run asks first; the question counts what
 // the run sends (48 asks nothing). Model knowledge asks about subjects that get their missing annotations too.
 const estimate=load('lib/student-estimate.ts');
 const subjects=Array.from({length:6},(_,i)=>({id:'s'+i,name:'Subject '+i,status:'done',fields:[{heading:'Name',value:'Subject '+i}]}));
 const ask=count=>estimate.runQuestion({provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate the subject.',rows:subjects,samples:[],knowledge:true,times:10,count:()=>count,unit:'subject'});
 const asked=await ask(9);assert.match(asked,/^Send 54 requests to gpt-6-luna \(6 subjects; those that have some of their 10 annotations get only the missing ones\)\?/);
 assert.equal(await ask(8),undefined);
 const mk=source('components/model-knowledge.tsx');
 assert.match(mk,/const resume=resumable\(latest\.current\),rows=latest\.current\.filter\(item=>inScope\(item\)&&\(item\.status==='pending'\|\|resume\.has\(item\.id\)&&incomplete\(item\)\)\)/);
 assert.match(mk,/item\.status==='pending'\?Math\.max\(1,times\):missingRepeats\(item\)\.length/);
 assert.match(page,/resume\?\.has\(d\.id\)&&d\.status==='done'\?missingRepeats\(d\)\.length:Math\.max\(1,times\)/);
 assert.match(page,/runConfirmed\(scopeRemaining\.map\(d=>d\.id\),processing==='batch',undefined,resume\)/);

 // #6. The provider's count measures the request the run sends: a long metadata value and {{text}} twice. The count
 // input and the annotation input are the same, byte for byte (OpenAI); a changed value is counted again.
 let sentBodies=[];
 globalThis.fetch=async(url,options)=>{sentBodies.push({url,body:JSON.parse(options.body)});return /input_tokens$/.test(url)?Response.json({input_tokens:777}):Response.json({id:'resp_1',status:'completed',model:'gpt-6-luna',output:[{content:[{type:'output_text',text:'{"score":"1","explanation":"ok"}'}]}],usage:{total_tokens:10}});};
 const placed='Context: {{meta.note}}\nFirst copy: {{text}}\nSecond copy: {{text}}\nRate it.',note='Ünïcode note '+'x'.repeat(5000);
 const form=(kind)=>{const f=new FormData();for(const [k,v] of Object.entries({provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:placed,inserts:JSON.stringify([note]),placeText:'true',file:new File(['The source text.'],'doc.txt')}))f.set(k,v);if(kind==='annotate')f.set('record','true');return new Request('https://lab.test/api/'+kind,{method:'POST',headers:{origin:'https://lab.test',Authorization:'Bearer sk-test'},body:f});};
 const counted=await load('app/api/count-tokens/route.ts').POST(form('count-tokens'));assert.equal(counted.status,200,await counted.clone().text());
 const annotated=await load('app/api/annotate/route.ts').POST(form('annotate'));assert.equal(annotated.status,200,await annotated.clone().text());
 const [countBody,runBody]=sentBodies;
 assert.equal(JSON.stringify(countBody.body.input),JSON.stringify(runBody.body.input));assert.equal(countBody.body.instructions,runBody.body.instructions);
 const countText=JSON.stringify(countBody.body);assert.ok(countText.includes(note.slice(0,40)));assert.equal(countText.split('The source text.').length-1,2);
 const rowsFor=[{id:'d1',status:'pending',name:'doc.txt',file:new File(['The source text.'],'doc.txt')}];let value=note,clientCounts=0;
 globalThis.fetch=async(url,options)=>{clientCounts++;assert.equal(options.body.get('inserts'),JSON.stringify([value]));assert.equal(options.body.get('placeText'),'true');return Response.json({inputTokens:900});};
 const counting={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:placed,rows:rowsFor,apiKey:'sk-test',signal:new AbortController().signal,inserts:()=>[value],placeText:true};
 await estimate.countStudentInputs(counting);await estimate.countStudentInputs(counting);assert.equal(clientCounts,1);
 value='another note';await estimate.countStudentInputs(counting);assert.equal(clientCounts,2,'A changed value is counted again');
 // The rough estimate counts the text as often as the prompt places it, and the values.
 const plain=await estimate.studentEstimate({provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate it. {{text}}',rows:[{id:'x',status:'pending',file:new File(['word '.repeat(2000)],'x.txt')}],placeText:true});
 const twice=await estimate.studentEstimate({provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate it. {{text}} {{text}}',rows:[{id:'x',status:'pending',file:new File(['word '.repeat(2000)],'x.txt')}],placeText:true,inserts:()=>['long value '.repeat(500)]});
 assert.ok(twice.input.low>plain.input.low*1.9,`${twice.input.low} vs ${plain.input.low}`);

 // #7. A batch ID of another job is refused: another number of requests, or results of another run.
 const recover=load('lib/batch-recover.ts');
 const job={runId:'lab_A',docIds:['a','b','c'],provider:'openai',model:'m',prompt:'p',effort:'e',createdAt:'',state:'unknown'};
 assert.match(recover.recoveredBatchProblem(job,{id:'batch_x',terminal:false,state:'in_progress',completed:0,total:7}),/holds 7 requests, but this run sent 3/);
 assert.match(recover.recoveredBatchProblem(job,{id:'batch_x',terminal:true,state:'completed',completed:3,total:0,results:[{id:'lab_B_0'}]}),/belong to another run/);
 assert.equal(recover.recoveredBatchProblem(job,{id:'batch_x',terminal:true,state:'completed',completed:3,total:3,results:[{id:'lab_A_0'}]}),undefined);
 assert.equal(recover.recoveredBatchProblem(job,{id:'batch_x',terminal:true,state:'completed',completed:0,total:3,results:[]}),undefined,'A matching batch with no results is still this run’s');
 assert.equal(recover.batchRequestCount({...job,repeats:3,ns:[[1,2,3],[2],[1,3]]}),6);
 assert.equal(recover.batchRequestCount(job,{items:[0,2],requests:[0,2]}),2);
 for(const file of ['app/page.tsx','components/model-knowledge.tsx']){const code=source(file);
  assert.match(code,/const job:BatchJob=idOverride\?\{\.\.\.batchJob,id:idOverride\.trim\(\),recovered:true\}:batchJob;/,file);
  assert.match(code,/if\(job\.recovered\)\{const wrong=recoveredBatchProblem\(job,out\);if\(wrong\)\{if\(!idOverride\)setBatchJob\(\{\.\.\.job,id:undefined,state:'unknown',recovered:undefined\}\);throw new Error\(wrong\);\}\}/,file);
  assert.match(code,/if\(part\.recovered\)\{const wrong=recoveredBatchProblem\(job,out,part\);/,file);}

 // #16. An unreadable reply keeps the tokens, usage, and response ID the provider reported (OpenAI, Gemini, Claude).
 globalThis.fetch=async()=>Response.json({id:'resp_9',status:'completed',model:'gpt-6-luna',output:[{content:[{type:'output_text',text:'not json'}]}],usage:{total_tokens:150}});
 const plainForm=()=>{const f=new FormData();for(const [k,v] of Object.entries({provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate.',file:new File(['t'],'t.txt')}))f.set(k,v);return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',Authorization:'Bearer sk-test'},body:f});};
 let failed=await load('app/api/annotate/route.ts').POST(plainForm());let out=await failed.json();
 assert.equal(failed.status,422);assert.deepEqual([out.tokens,out.responseId,Boolean(out.error)],[150,'resp_9',true]);
 globalThis.fetch=async()=>Response.json({responseId:'g_9',modelVersion:'gemini',candidates:[{finishReason:'STOP',content:{parts:[{text:'{"nope":1}'}]}}],usageMetadata:{totalTokenCount:150}});
 out=await (await load('lib/gemini.ts').annotateGemini(new File(['t'],'t.txt'),'Rate.','gemini-3.1-flash-lite','minimal','key')).json();
 assert.deepEqual([out.tokens,out.responseId,Boolean(out.error)],[150,'g_9',true]);
 globalThis.fetch=async()=>Response.json({id:'msg_9',model:'claude',stop_reason:'end_turn',content:[{type:'text',text:'not json'}],usage:{input_tokens:100,output_tokens:50}});
 out=await (await load('lib/anthropic.ts').annotateAnthropic(new File(['t'],'t.txt'),'Rate.','claude-haiku-5-5','medium','sk-ant-key')).json();
 assert.deepEqual([out.tokens,out.responseId,Boolean(out.error)],[150,'msg_9',true]);

 // #2. Two different source documents called speech.txt: a row for speech.txt labels neither (ambiguous). A row for a
 // chunk wins over its source's row in either order, and the source's row labels the other chunk.
 const {matchRows}=load('lib/research/columns.ts');
 const parts=[{id:'a1',name:'speech.txt (part 1)',sourceName:'speech.txt',sourceId:'A'},{id:'a2',name:'speech.txt (part 2)',sourceName:'speech.txt',sourceId:'A'},{id:'b1',name:'speech.txt (part 1) ',sourceName:'speech.txt',sourceId:'B'},{id:'b2',name:'speech.txt (part 2) ',sourceName:'speech.txt',sourceId:'B'}];
 let matched=matchRows(parts,['speech.txt']);assert.deepEqual([matched.rowOf.size,matched.ambiguous],[0,[0]]);
 const oneSource=parts.slice(0,2);
 const chunkFirst=matchRows(oneSource,['speech.txt (part 1)','speech.txt']),wholeFirst=matchRows(oneSource,['speech.txt','speech.txt (part 1)']);
 assert.deepEqual([...chunkFirst.rowOf].sort(),[['a1',0],['a2',1]]);assert.deepEqual([...wholeFirst.rowOf].sort(),[['a1',1],['a2',0]]);
 assert.deepEqual([chunkFirst.repeated,wholeFirst.repeated],[[],[]]);

 // #3a/b. INSUFFICIENT_KNOWLEDGE is an abstention, not a category: left out of agreement and counted, with or
 // without declared values; and counted as such (not as a category) in the Results summary.
 const metrics=load('lib/research/metrics.ts'),IK='INSUFFICIENT_KNOWLEDGE';
 for(const allowed of [[],['A','B']]){
  const r=metrics.agreement(['A','B',IK,IK],['B','B',IK,IK],'nominal',allowed,0,{withIntervals:false,known:['A','B',IK]});
  assert.deepEqual([r.n,r.percentAgreement,r.leftOut.abstained],[2,0.5,{both:2,one:0}],JSON.stringify(allowed));
 }
 const oneSided=metrics.agreement(['A','B',IK,'A'],['A','B','B',IK],'nominal',[],0,{withIntervals:false,known:['A','B',IK]});
 assert.deepEqual([oneSided.n,oneSided.percentAgreement,oneSided.leftOut.abstained],[2,1,{both:0,one:2}]);
 const summaries=load('lib/research/summary.ts'),answers=['A','B',IK,IK,'A'];
 const summed=summaries.summarizeField({key:'f',label:'F',level:'nominal',allowed:[],yesNo:false},answers.map((v,i)=>({id:'s'+i,status:'ok',fewer:false,meta:{},value:()=>v})));
 assert.deepEqual([summed.missing,summed.abstained],[2,2]);assert(!JSON.stringify(summed.bins??[]).includes(IK),'Not a category');

 // #23. Strata whose joined names coincide ("A · B / C" and "A / B · C"; a blank and "(none)") stay apart in the new
 // method, and a sample recorded with method 1 is drawn again exactly as before.
 const sampling=load('lib/research/sample.ts');
 const strataColumns=[{name:'x',role:'meta'},{name:'y',role:'meta'}];
 const strataRows=[['A · B','C'],['A','B · C'],['','z'],['(none)','z']].flatMap((cells,g)=>[0,1,2].map(i=>({id:`g${g}-${i}`,name:`g${g}-${i}.txt`,cells})));
 const options={size:8,strata:['x','y'],exclude:null,seed:7};
 const drawn=sampling.drawStratifiedSample(strataRows,strataColumns,options);
 assert.deepEqual(drawn.strata.map(s=>[s.stratum,s.available,s.drawn]),[['(none) · z',3,2],['(none) · z',3,2],['A · B · C',3,2],['A · B · C',3,2]]);
 const old=sampling.drawStratifiedSample(strataRows,strataColumns,{...options,method:1});
 assert.deepEqual(old.strata.map(s=>[s.stratum,s.available]),[['(none) · z',6],['A · B · C',6]],'Method 1 as it was');
 assert.equal(sampling.sampleRecord({...options,markedAs:{column:'sample',value:'v'}},drawn,'2026-11-18').method,'sampling method 2');
 assert.equal(sampling.sampleRecord({...options,method:1,markedAs:{column:'sample',value:'v'}},old,'2026-11-18').method,'sampling method 1');
 assert.deepEqual([sampling.methodNumber('sampling method 1'),sampling.methodNumber('sampling method 2')],[1,2]);
 assert.equal(sampling.cleanSamples([{column:'sample',value:'v'}])[0].method,'sampling method 1','An older record without a method names method 1');
 // Where no names coincide, the new method draws exactly as method 1.
 const unmixed=Array.from({length:30},(_,i)=>({id:'p'+i,name:`p${String(i).padStart(2,'0')}.txt`,cells:[['1950s','1960s','1970s'][i%3],i%4?'AQ':'BR']}));
 for(const seed of [1,7,99])assert.deepEqual(sampling.drawStratifiedSample(unmixed,strataColumns,{size:11,strata:['y','x'],exclude:null,seed}),sampling.drawStratifiedSample(unmixed,strataColumns,{size:11,strata:['y','x'],exclude:null,seed,method:1}));

 // #1b, #9, #27. The export panel: where the subjects' other fields are chosen, a repository without its backup said
 // on the page, and the two .zip buttons named for screen readers.
 const panel=source('components/research/export-panel.tsx');
 assert(panel.includes('The subjects’ other fields are chosen under “Label and metadata columns” below.')||panel.includes("The subjects' other fields are chosen under “Label and metadata columns” below."));
 assert(panel.includes('was downloaded, but not in full.'));
 assert(panel.includes('aria-label="Download research repository (.zip)"')&&panel.includes('aria-label="Download supplementary repository (.zip)"'));
 console.log('PASS: November 18 audit: chart segments, ties, comparable settings, scale per study, review order, assessment status, Excel pieces, backup after a failed save, saved-key line, section links, Clear workspace scope; table encodings, Excel IDs, duplicate headers, unclosed quotes, large tables, long HTML, texts over 20 MB; the cost question for resumed runs, counts of the request as sent, recovered batch IDs, billed fields on unreadable replies; source names shared by two documents, chunk rows in either order, abstentions in agreement and summaries, strata that join alike, the export panel’s notes and button names.');
})().catch(error=>{console.error(error);process.exit(1);});
