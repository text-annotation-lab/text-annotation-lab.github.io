// Synthetic fixtures only. Network calls are mocked, including route-level tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),ExcelJS=require('exceljs');
let mock,calls=0;const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);new Function('exports','require','fetch',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.posix.join(path.posix.dirname(file),id)+'.ts'):require(id),async(...args)=>{calls++;return mock(...args);});return exports;}
const {providerError,incompleteAnnotation}=load('lib/provider-errors.ts');
const {createResultsWorkbook}=load('lib/export-results.ts');
async function book(docs,current={provider:'gemini',model:'gemini-3.6-flash',effort:'medium',prompt:'CURRENT MUST NOT REPLACE RECORDED'}){const w=new ExcelJS.Workbook();await w.xlsx.load(await createResultsWorkbook(docs,current));return w;}
function settings(w){const rows=[];w.getWorksheet('Study settings').eachRow(r=>rows.push([r.getCell(1).value,r.getCell(2).value]));return rows;}
function section(rows,name){const start=rows.findIndex(r=>r[0]===name);assert(start>=0,name);const tail=rows.slice(start+1);const end=tail.findIndex(r=>/^S\d+$/.test(r[0])||r[0]==='Reading settings IDs');return end<0?tail:tail.slice(0,end);}
function prompt(rows){return rows.filter(r=>String(r[0]).startsWith('Annotation prompt')).map(r=>r[1]).join('');}
function req(provider){const f=new FormData();Object.entries({provider,model:provider==='gemini'?'gemini-3.6-flash':provider==='anthropic'?'claude-sonnet-5-5':'gpt-6-luna',effort:'medium',prompt:'Classify this synthetic text.',file:new File(['Synthetic source.'],'test.txt')}).forEach(([k,v])=>f.set(k,v));return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'mock-key')},body:f});}
(async()=>{
 // Check actual cell boundaries after writing and reopening the workbook.
 for(const [input,expected] of [
  ['a'.repeat(32767),1],
  ['a'.repeat(32766)+'😀',2],
  ['line\n'.repeat(253)+'last',1],
  ['line\n'.repeat(254)+'last',2],
  ['a'.repeat(100000),4],
 ]){
  const workbook=await book([],{provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:input});
  const cells=settings(workbook).filter(([label])=>String(label).startsWith('Annotation prompt'));
  assert.equal(cells.length,expected);
  assert.equal(cells.map(([,value])=>value).join(''),input);
  for(const [,value] of cells){
   assert(value.length<=32767&&value.split('\n').length<=254);
   assert(value.isWellFormed());
  }
 }
 // ExcelJS itself can split surrogate pairs when reading XML in 16K blocks.
 // Put the repeated emoji boundary case in the dedicated cell test above.
 const p='Classify Café.\n'.repeat(2500)+'😀',base={status:'done',score:'YES',explanation:'Synthetic evidence.',provider:'gemini',model:'gemini-3.6-flash',effort:'medium',processing:'instant',prompt:p,concurrency:4};
 const mixed=await book([
  {...base,name:'old.txt',chartYear:1863,answerFields:['Tone','Explanation'],answers:{f0:'Neutral',f1:'Older rationale.'},explanation:''},
  {...base,name:'new.txt',chartYear:null,explanation:'Current rationale.'},
  {...base,name:'both.txt',answerFields:['Explanation'],answers:{f0:'Named rationale.'},explanation:'Separate rationale.'},
 ]);
 const sheet=mixed.getWorksheet('Results'),columns=sheet.getRow(1).values;
 assert.equal(columns.filter(name=>name==='Explanation').length,1);
 const explanationColumn=columns.indexOf('Explanation'),yearColumn=columns.indexOf('Year');
 assert.equal(sheet.getCell(2,yearColumn).value,1863);assert.equal(sheet.getCell(3,yearColumn).value,null);
 assert.equal(sheet.getCell(2,explanationColumn).value,'Older rationale.');
 assert.equal(sheet.getCell(3,explanationColumn).value,'Current rationale.');
 assert.equal(sheet.getCell(4,explanationColumn).value,'Named rationale.\n\nSeparate rationale.');
 const previous={status:'error',error:'Earlier synthetic error',...base,status:'error'};
 const w=await book([{...base,id:'a',name:'a.txt'},{...base,id:'b',name:'b.txt',concurrency:1,history:[previous]}]);
 const rows=settings(w);assert.equal(prompt(rows),p,'Shared full prompt occurs once without lost characters');assert.equal(prompt(section(rows,'S1')),'');assert.deepEqual(section(rows,'S1'),[['Parallel annotations',4]]);assert.deepEqual(section(rows,'S2'),[['Parallel annotations',1]]);assert(!JSON.stringify(rows).includes('CURRENT MUST'));
 const result=w.getWorksheet('Results'),heads=result.getRow(1).values;assert.equal(result.getCell(2,heads.indexOf('Settings ID')).value,'S1');assert.equal(result.getCell(3,heads.indexOf('Settings ID')).value,'S2');const hist=[];w.getWorksheet('Attempt history').eachRow((r,i)=>{if(i>1)hist.push(r.getCell(10).value);});assert.deepEqual(JSON.parse(hist.join('')),previous);
 for(const r of w.getWorksheet('Study settings').getRows(1,w.getWorksheet('Study settings').rowCount)){assert(r.height===undefined||r.height<=400);r.eachCell(c=>{if(typeof c.value==='string')assert(c.value.length<=32767);});}
 const distinct=await book([{...base,name:'a'},{...base,name:'b',prompt:'Different rubric'}]);const dr=settings(distinct);assert.equal(prompt(section(dr,'S1')),p);assert.equal(prompt(section(dr,'S2')),'Different rubric');
 const missing=settings(await book([{...base,name:'a',concurrency:undefined},{...base,name:'b',concurrency:1}]));assert.deepEqual(section(missing,'S1'),[['Parallel annotations','Not recorded']]);
 const batch=settings(await book([{...base,name:'a'},{...base,name:'b',processing:'batch',concurrency:4}]));assert(section(batch,'S2').some(r=>r[0]==='Parallel annotations'&&r[1]==='Not applicable (batch)'));
 const single=await book([{...base,name:'a'}]);assert.equal(prompt(settings(single)),p);assert(!single.getWorksheet('Results').getRow(1).values.includes('Settings ID'));
 const empty=await book([{name:'waiting',status:'pending'}],{provider:'openai',model:'gpt-6-luna',effort:'low',prompt:'Current unrun rubric'});assert.equal(prompt(settings(empty)),'Current unrun rubric');assert(JSON.stringify(settings(empty)).includes('no annotation attempts'));
 const knowledge=await book([{...base,name:'same',subjectId:'subject',fields:[{heading:'Title',value:'Same'}],instructions:'Same instructions',webSearch:false},{...base,name:'same',subjectId:'subject',runNumber:2,fields:[{heading:'Title',value:'Same'}],instructions:'Same instructions',webSearch:false,concurrency:1}],{workspace:'model-knowledge',model:base.model,prompt:'CURRENT',effort:'medium'});assert.equal(settings(knowledge).filter(r=>r[0]==='Additional model instructions').length,1);assert.equal(knowledge.getWorksheet('Results').rowCount,3);
 for(const provider of ['openai','anthropic','gemini']){
  assert.match(providerError(provider,503,null),/temporarily unavailable or overloaded/);assert.match(providerError(provider,401,{}),/API key/);assert.match(providerError(provider,403,{}),/permissions/);assert.match(providerError(provider,429,{}),/rate or quota/);assert.match(providerError(provider,429,{error:{code:'credit_balance_exhausted'}}),/billing or credit/);assert.match(providerError(provider,413,{}),/too large/);assert.match(providerError(provider,504,{}),/may have completed/);
  for(const status of [400,401,403,429,503]){const msg=providerError(provider,status,{error:{message:'SECRET sk-userkey document contents',code:'SECRET',details:[{retryDelay:'SECRET'}]}},new Headers({'retry-after':'SECRET'}));assert(!msg.includes('SECRET'));}
 }
 assert.match(providerError('gemini',429,{error:{details:[{retryDelay:'30s'}]}}),/30s/);assert.match(providerError('openai',503,{},new Headers({'retry-after':'12'})),/at least 12 seconds/);assert.match(providerError('anthropic',529,{}),/overloaded/);assert.match(incompleteAnnotation('gemini','MAX_TOKENS'),/output limit/);assert.match(incompleteAnnotation('gemini','SAFETY'),/content rules/);
 const route=load('app/api/annotate/route.ts');
 for(const provider of ['openai','anthropic','gemini'])for(const status of [400,401,403,413,429,503]){
  calls=0;mock=async()=>new Response('<html>SECRET error page</html>',{status});const r=await route.POST(req(provider));assert.equal(r.status,status);const data=await r.json();assert(data.error.includes(`HTTP ${status}`));assert(!data.error.includes('SECRET'));assert.equal(calls,1,'No automatic retries');
 }
 const {createBatch}=load('lib/batch-provider.ts');calls=0;mock=async()=>new Response('unavailable',{status:503});await assert.rejects(()=>createBatch('anthropic','key','claude-sonnet-5-5','lab_test',new Blob(['{}'])),e=>e.uncertain===true&&/batch list/.test(e.message));assert.equal(calls,1);
 if(process.env.TAL_QA_EXPORT){const visual=await book([{...base,name:'a.txt',prompt:'Classify the overall tone as POSITIVE, NEGATIVE, MIXED, or NEUTRAL. Give a brief explanation grounded in the document.'},{...base,name:'b.txt',prompt:'Classify the overall tone as POSITIVE, NEGATIVE, MIXED, or NEUTRAL. Give a brief explanation grounded in the document.',concurrency:1}]);await visual.xlsx.writeFile(process.env.TAL_QA_EXPORT);}
 console.log('PASS: shared and differing settings, exact long Unicode prompts, historical attempts, missing/batch settings, model-knowledge repeats, all-provider HTTP diagnosis, safe messages, non-JSON errors, retry delays, and no automatic resubmission.');
})().catch(e=>{console.error(e.message?.slice(0,1500));process.exit(1);});
