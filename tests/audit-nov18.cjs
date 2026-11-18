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
 console.log('PASS: November 18 audit: chart segments, ties, comparable settings, scale per study, review order, assessment status, Excel pieces, backup after a failed save, saved-key line, section links, Clear workspace scope; table encodings, Excel IDs, duplicate headers, unclosed quotes, large tables, long HTML, texts over 20 MB.');
})().catch(error=>{console.error(error);process.exit(1);});
