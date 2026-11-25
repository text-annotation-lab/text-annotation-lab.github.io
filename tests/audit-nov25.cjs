// Regressions for the ChatGPT (Astra 6.2) audit of November 25, 2026: categories that read as the same number, labels
// outside a codebook, many distinct values, full precision of combined numbers, the most frequent value, JSON names
// that collide, hidden and deleted RTF text, sample markers and their records, worksheets, Model knowledge subjects in
// a public package, and the note on split texts. Mocked only; no keys.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require(path.join(root,'node_modules/typescript')),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};
 new Function('exports','require',code)(exports,local);return exports;
}
const metrics=load('lib/research/metrics.ts'),agree=load('lib/research/agreement.ts'),comparable=load('lib/research/comparable.ts'),repeats=load('lib/research/repeats.ts'),replies=load('lib/json-reply.ts'),validation=load('lib/answer-validation.ts');
const {rtfText}=load('lib/rtf-text.ts'),columnsLib=load('lib/research/columns.ts'),tables=load('lib/research/parse-table.ts'),packages=load('lib/research/export-packages.ts'),data=load('lib/research/export-data.ts'),knowledgeLib=load('lib/research/knowledge.ts');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const close=(x,y,what)=>assert(Math.abs(x-y)<1e-9,`${what}: ${x} against ${y}`);

(async()=>{
 // --- #2: declared categories that read as the same number stay apart --------------------------------------------
 const base={provider:'openai',model:'m',effort:'low',prompt:'x',answerFields:['code'],status:'done',runNo:1},labelColumn=[{name:'gold',role:'label'}];
 const compare=(type,values,answers,labels)=>{
  const rows=answers.map((v,i)=>({...base,answerSettings:{named:true,fields:[{name:'code',type,values,description:''}]},id:'t'+i,name:'t'+i,answers:{f0:v},cells:[labels[i]]}));
  const p=agree.pairSources(rows,labelColumn,{kind:'run',run:1},'code',{kind:'column',name:'gold'},'',undefined);
  return {p,stats:agree.runJob(agree.agreementJob(p,'auto',1),false)};
 };
 {const {p,stats}=compare('category',['01','1'],['01','1','01','1'],['1','01','1','01']);
  assert.deepEqual([stats.n,stats.percentAgreement,stats.cohenKappa],[4,0,-1],'Reversed codes 01 and 1: no agreement, κ = −1');
  assert.deepEqual(stats.categories,['01','1']);assert.equal(stats.confusion['01']['01'],0);assert.equal(stats.confusion['01']['1'],2);
  assert.match(p.basis,/compared as written/);}
 {const {stats}=compare('category',['a','b'],['a','b','A '],['A','b','a']);assert.equal(stats.percentAgreement,1,'Categories that do not collide still ignore case and spaces');}
 {const {stats}=compare('number',[],['1.0','2','3'],['1','2.0','3']);assert.equal(stats.percentAgreement,1,'A number field still reads 1.0 and 1 alike');}
 {// Combining annotations: the vote and its share count 01 and 1 apart.
  const settings={named:true,fields:[{name:'code',type:'category',values:['01','1'],description:''}]},made=(n,v)=>({n,status:'done',answers:{f0:v},score:'',explanation:'e'+n,tokens:1});
  const combined=repeats.combine([made(1,'01'),made(2,'1'),made(3,'01')],['code'],settings);assert.equal(combined.answers.f0,'01');close(combined.consistency.f0,2/3,'share');
  const plain={named:true,fields:[{name:'code',type:'category',values:['yes','no'],description:''}]};
  assert.equal(repeats.combine([made(1,'Yes'),made(2,'yes'),made(3,'no')],['code'],plain).answers.f0.toLowerCase(),'yes','Other categories are read as before');}

 // --- #3 (Jens, Nov 25): with a codebook, a label that is none of its categories is left out and reported ---------
 {const {p,stats}=compare('category',['a','b'],['a','b','a'],['a','typo','typo']);
  assert.deepEqual([stats.n,stats.percentAgreement,stats.leftOut.n,stats.leftOut.values],[1,1,2,['typo']]);assert(!stats.categories.includes('typo'));
  assert.match(agree.leftOutNote(stats,'text',p.leftOut),/not one of the field’s allowed values/);
  const fits=comparable.comparableValues(p.a.map((x,i)=>[x,p.b[i]]),'nominal',p.allowed,{});assert.deepEqual(p.b.map(fits),[true,false,false],'The list of disagreements leaves out the same labels');}
 {// A codebook scale of numbers is unchanged: a coder between two points is compared.
  const {stats}=compare('ordinal',['1','3','5'],['1','3','5'],['2','2','4']);assert.equal(stats.n,3);}

 // --- #6: combined numbers keep their precision ---------------------------------------------------------------------
 assert.equal(metrics.aggregate(['0.0004','0.0004'],'mean'),'0.0004');assert.equal(metrics.aggregate(['0.0004','0.0006'],'median'),'0.0005');
 assert.equal(metrics.aggregate(['0.1','0.2'],'mean'),'0.15','No binary-fraction noise');assert.equal(metrics.aggregate(['1','2','2'],'mean'),String(Number((5/3).toPrecision(12))));
 {const settings={named:true,fields:[{name:'p',type:'number',values:[],description:''}]},made=n=>({n,status:'done',answers:{f0:'0.0004'},score:'',explanation:'',tokens:1});
  const combined=repeats.combine([made(1),made(2)],['p'],settings);assert.equal(combined.answers.f0,'0.0004');assert.equal(combined.consistency.f0,1);}

 // --- #14: many distinct values: the same figures without a table of every value against every other --------------
 {// Naive figures from full tables, for comparison.
  const kappa=(pairs,w,scale=[])=>{const cats=[...new Set([...scale,...pairs.flat()])],num=cats.every(c=>!Number.isNaN(Number(c)));cats.sort(num?(a,b)=>a-b:undefined);const at=num?cats.map(Number):cats.map((_,i)=>i),r=Math.max(...at)-Math.min(...at),n=pairs.length,k=cats.length,ix=new Map(cats.map((c,i)=>[c,i]));
   const o=Array.from({length:k},()=>new Array(k).fill(0)),ra=new Array(k).fill(0),rb=new Array(k).fill(0);for(const [a,b] of pairs){o[ix.get(a)][ix.get(b)]++;ra[ix.get(a)]++;rb[ix.get(b)]++;}
   let po=0,pe=0;for(let i=0;i<k;i++)for(let j=0;j<k;j++){const d=w==='none'?(i===j?0:1):Math.abs(at[i]-at[j])/r,x=w==='quadratic'?d*d:d;po+=x*o[i][j];pe+=x*ra[i]*rb[j]/n;}return 1-po/pe;};
  const alpha=(pairs,level)=>{const vals=[...new Set(pairs.flat())].sort((a,b)=>a-b),k=vals.length,ix=new Map(vals.map((v,i)=>[v,i])),o=Array.from({length:k},()=>new Array(k).fill(0));for(const [a,b] of pairs){o[ix.get(a)][ix.get(b)]++;o[ix.get(b)][ix.get(a)]++;}
   const nc=o.map(row=>row.reduce((s,x)=>s+x,0)),n=nc.reduce((s,x)=>s+x,0),d=(c,e)=>{if(c===e)return 0;if(level==='nominal')return 1;if(level==='interval')return (Number(vals[c])-Number(vals[e]))**2;const lo=Math.min(c,e),hi=Math.max(c,e);let s=0;for(let g=lo;g<=hi;g++)s+=nc[g];return (s-(nc[c]+nc[e])/2)**2;};
   let num=0,den=0;for(let c=0;c<k;c++)for(let e=0;e<k;e++){num+=o[c][e]*d(c,e);den+=nc[c]*nc[e]*d(c,e);}return 1-(n-1)*num/den;};
  let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const values=Array.from({length:160},(_,i)=>String(i/4)),pairs=Array.from({length:600},()=>{const a=values[Math.floor(rnd()*160)];return [a,rnd()<0.5?a:values[Math.floor(rnd()*160)]];});
  assert(new Set(pairs.flat()).size>metrics.DENSE_LIMIT,'More distinct values than the limit');
  for(const w of ['none','linear','quadratic'])close(metrics.cohenKappa(pairs,w),kappa(pairs,w),'κ '+w);
  for(const level of ['nominal','ordinal','interval'])close(metrics.krippendorffAlpha(pairs,level),alpha(pairs,level),'α '+level);
  // With counts (as the bootstrap passes them): the same as the list written out.
  const once=pairs.slice(0,300),times=once.map((_,i)=>1+i%3),spelled=once.flatMap((p,i)=>Array(times[i]).fill(p));
  for(const w of ['none','linear','quadratic'])close(metrics.cohenKappa(once,w,[],times),metrics.cohenKappa(spelled,w),'κ with counts '+w);
  for(const level of ['nominal','ordinal','interval'])close(metrics.krippendorffAlpha(once,level,times),metrics.krippendorffAlpha(spelled,level),'α with counts '+level);
  // The same figures from the full tables just under the limit and the totals just over it.
  const under=pairs.filter(([a,b])=>Number(a)<20&&Number(b)<20);assert(new Set(under.flat()).size<=metrics.DENSE_LIMIT);
  for(const w of ['none','linear','quadratic'])close(metrics.cohenKappa(under,w),kappa(under,w),'κ under the limit '+w);}
 {// 3,000 distinct decimals: quick, and the table holds only the cells that occur.
  const a=Array.from({length:3000},(_,i)=>String(i/10)),b=a.map((x,i)=>String(Number(x)+(i%3)/10)),start=Date.now(),stats=metrics.agreement(a,b,'interval',[],1,{withIntervals:false});
  assert(Date.now()-start<3000,'Under 3 seconds (was 26 seconds and 3 GB)');assert.equal(stats.n,3000);
  assert(Object.values(stats.confusion).reduce((n,row)=>n+Object.keys(row).length,0)<=3000,'Only the cells that occur');
  const table=agree.agreementTable({a:'A',b:'B',field:'p',dataset:'d'},stats,undefined);assert(table.some(row=>String(row[0]).startsWith('confusion_matrix: not included')),'No table of every value in the CSV');}
 {// Up to the limit, the full table with its zeros, as before.
  const stats=metrics.agreement(['a','b','a'],['a','a','b'],'nominal',[],0,{withIntervals:false});assert.deepEqual({...stats.confusion.b},{a:1,b:0});}

 // --- #16: the most frequent value ---------------------------------------------------------------------------------
 assert.equal(metrics.aggregate(['A','A','B','C','D'],'majority'),'A');
 assert(source('lib/research/setting-help.ts').includes('most frequent value')&&!/by majority vote/.test(source('lib/research/export-packages.ts').replace(/^\s*\/\/.*$/gm,'')),'Nothing says majority where the value is only the most frequent');

 // --- #5: JSON names that collide once joined ----------------------------------------------------------------------
 for(const reply of ['{"race":{"score":3},"race_score":-3}','{"race_score":-3,"race":{"score":3}}','{"response":"a","answer":{"response":"b"}}'])assert.equal(replies.flattenJsonReply(reply),null,reply);
 assert.deepEqual(replies.flattenJsonReply('{"race":{"score":3},"tone":-3}'),{race_score:'3',tone:'-3'});
 assert.equal(validation.annotationValidationError({score:'',explanation:'',answers:{f0:'{"race":{"score":3},"race_score":-3}'}},[],'',false,{plain:true}),validation.COLLIDING_JSON);
 assert.equal(validation.annotationValidationError({score:'',explanation:'',answers:{f0:'{"race":3}'}},[],'',false,{plain:true}),undefined);

 // --- #7: hidden and deleted RTF text --------------------------------------------------------------------------------
 assert.equal(rtfText('{\\rtf1\\ansi Visible. {\\v Hidden.} {\\deleted Deleted.}End.}'),'Visible.  End.');
 assert.equal(rtfText('{\\rtf1\\ansi A\\v  hidden\\v0  B {\\v x\\plain  y} \\deleted z\\deleted0  C}'),'A B  y  C');
 assert.equal(rtfText('{\\rtf1\\ansi {\\v \\u233?\\\'e9} ok}'),'ok','Escaped characters in hidden text stay hidden');

 // --- #8, #9: sample markers in any capitals, and the record of a replaced draw --------------------------------------
 {const docs=['Validation','Validation','validation','other'].map((v,i)=>({id:'d'+i,cells:[v]})),marked=columnsLib.markColumn(docs,[{name:'sample',role:'meta'}],new Set(['d1']),'sample','validation',true);
  assert.deepEqual(marked.docs.map(d=>d.cells[0]),['','validation','','other'],'Earlier markers in other capitals are cleared, another sample kept');}
 assert(source('components/research/tools.tsx').includes(".trim().toLowerCase()===markedAs.value.toLowerCase()"),'The count before a draw ignores capitals');

 // --- #12: the worksheet of a workbook --------------------------------------------------------------------------------
 {const ExcelJS=req('exceljs'),book=new ExcelJS.Workbook();
  const intro=book.addWorksheet('Instructions');intro.addRow(['Read the next tab']);intro.addRow(['Thanks']);
  const secret=book.addWorksheet('Hidden');secret.state='hidden';secret.addRow(['id','text']);secret.addRow(['h','hidden']);
  const corpus=book.addWorksheet('Corpus');corpus.addRow(['id','text']);corpus.addRow(['0007','A text.']);corpus.getCell('A2').value=7;corpus.getCell('A2').numFmt='0000';
  const file=new File([await book.xlsx.writeBuffer()],'book.xlsx');
  const first=await tables.parseSpreadsheet(file);assert.equal(first.sheetName,'Instructions');assert.deepEqual(first.sheets,['Instructions','Corpus'],'Visible worksheets with data are offered');
  const chosen=await tables.parseSpreadsheet(file,20,'Corpus');assert.deepEqual([chosen.sheetName,chosen.header,chosen.rows],['Corpus',['id','text'],[['0007','A text.']]],'The chosen worksheet, leading zeros kept');
  const single=new ExcelJS.Workbook();single.addWorksheet('Only').addRow(['id','text']);const one=await tables.parseSpreadsheet(new File([await single.xlsx.writeBuffer()],'one.xlsx'));assert.equal(one.sheets,undefined,'No menu for a single worksheet');
  for(const file of ['components/research/import-texts.tsx','components/research/tools.tsx'])assert(source(file).includes('>Worksheet</label>'),file+' offers the worksheets');}

 // --- #1: a public package without the subjects leaves out their other fields too ------------------------------------
 {const NOW=new Date('2026-11-16T12:00:00.000Z'),SUBJECT=name=>[{heading:'Film',value:name},{heading:'Year',value:name==='Jaws'?'1975':'1979'},{heading:'Note',value:'PRIVATE NOTE '+name}];
  const setup={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate the villain’s menace from 1 to 5.',answerFields:[]};
  const items=['Jaws','Alien'].map((name,i)=>({id:'i'+i,subjectId:'s'+i,name,status:'done',score:String(4+i),explanation:'Known.',runNumber:1,...setup,webSearch:false,fields:SUBJECT(name),cells:[String(5-i)],startedAt:'2026-11-16T10:00:00.000Z',time:'2026-11-16T10:00:03.000Z',processing:'instant'}));
  const set={kind:'knowledge',rows:knowledgeLib.knowledgeRows(items),runs:[],columns:[{name:'menace_human',role:'label'}],samples:[]},ctx={study:{name:'Villains',dataset:set,lab:'x'},read:data.documentReader(set,async()=>''),now:NOW};
  const text=async(pack,name)=>{const file=pack.files.find(f=>f.path===pack.name+'/'+name);const v=file.data;return typeof v==='string'?v:v instanceof Blob?await v.text():Buffer.from(v).toString('utf8');};
  const without=await packages.buildSupplementary(ctx,1,{texts:false,explanations:false,logs:false,columns:[]});
  for(const file of without.files){const v=file.data,t=typeof v==='string'?v:v instanceof Blob?await v.text():Buffer.from(v).toString('utf8');assert(!t.includes('PRIVATE NOTE')&&!/\b1975\b/.test(t),'No subject field in '+file.path);}
  assert.deepEqual((await text(without,'results/results.csv')).replace(/^﻿/,'').split('\r\n')[0].split(','),['doc_id','score','subject'],'The subject is named, nothing more');
  const withSubjects=await packages.buildSupplementary(ctx,1,{texts:true,explanations:false,logs:false,columns:[]});
  assert((await text(withSubjects,'results/results.csv')).includes('PRIVATE NOTE Jaws'),'Including the subjects includes their fields');}

 // --- Interval note for split texts, and the link to the disagreements --------------------------------------------------
 assert(source('lib/research/export-packages.ts').includes('the intervals treat the parts as independent')&&source('components/research/runs-panel.tsx').includes('the intervals treat each part as independent'));
 assert(source('components/research/runs-panel.tsx').includes("document.getElementById('research-disagreements')")&&source('components/research/runs-panel.tsx').includes('id="research-disagreements"'));

 console.log('PASS: Astra audit of Nov 25: 01 and 1 apart, labels outside a codebook left out, many distinct values without full tables, combined numbers in full, the most frequent value, colliding JSON names, hidden RTF text, sample markers, worksheets, Model knowledge subjects in a public package, and the notes on split texts.');
})().catch(error=>{console.error(error);process.exit(1);});
