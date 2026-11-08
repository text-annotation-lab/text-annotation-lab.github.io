const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),ExcelJS=require('exceljs'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
(async()=>{
 const ids={};new Function('exports','crypto',ts.transpileModule(fs.readFileSync('lib/identifier.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(ids,{getRandomValues:array=>require('node:crypto').webcrypto.getRandomValues(array)});
 const generated=Array.from({length:1000},()=>ids.newId());assert.equal(new Set(generated).size,1000);assert(generated.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
 const {differentSettingsCount}=load('lib/student-guidance.ts');
 const current={provider:'openrouter',model:'openai/gpt-6-luna',prompt:'Final rubric',effort:'medium',answerFields:[]};
 const row={...current,status:'done',name:'test.txt',id:'a',score:'1',explanation:'Evidence'};const saved=JSON.stringify(row);
 assert.equal(differentSettingsCount([row],current),0);assert.equal(differentSettingsCount([{...row,prompt:'Pilot rubric'}],current),1);
 for(const [key,value] of [['model','openai/gpt-6-sol'],['provider','openai'],['effort','high'],['answerFields',['Tone']],['webSearch',true]])assert.equal(differentSettingsCount([{...row,[key]:value}],current),1,key);
 assert.equal(differentSettingsCount([{...row,status:'pending',prompt:'Earlier'}],current),0);assert.equal(differentSettingsCount([{status:'done'}],current),0);assert.equal(JSON.stringify(row),saved);
 const {SettingsNotice,SaveHelp}=load('components/student-guidance.tsx');assert.equal(renderToStaticMarkup(React.createElement(SettingsNotice,{rows:[row],current})), '');
 const html=renderToStaticMarkup(React.createElement(SettingsNotice,{rows:[{...row,prompt:'Pilot'}],current}));assert.match(html,/1 completed annotation uses different settings/);assert.match(html,/Save a version/);assert(!html.includes('open=""'));
 assert.match(renderToStaticMarkup(React.createElement(SaveHelp)),/cannot reopen a study/);
 const {createResultsWorkbook}=load('lib/export-results.ts');const book=new ExcelJS.Workbook();await book.xlsx.load(await createResultsWorkbook([{...row,name:'scan.pdf',inputMode:'pdf-native'},{...row,id:'b',name:'old.pdf',inputMode:undefined},{...row,id:'c',name:'error.txt',status:'error',rawResponse:'Unreadable response',error:'Invalid format'}],current));
 assert.equal(book.worksheets[0].name,'Results');assert(book.getWorksheet('Responses needing review'));
 const settings=[];book.getWorksheet('Study settings').eachRow(r=>settings.push(r.values));assert(settings.some(r=>r[1]==='Provider'&&r[2]==='OpenRouter'));assert(!settings.some(r=>r[1]==='Provider'&&r[2]==='OpenAI (ChatGPT)'));
 const result=book.getWorksheet('Results'),column=result.getRow(1).values.indexOf('Input handling');assert.equal(result.getCell(2,column).value,'Whole PDF (native)');assert.equal(result.getCell(3,column).value,'Extracted PDF text (earlier run)');
 const {queueRetries}=load('lib/workflow-safety.ts');const retry=queueRetries([{...row,status:'error',inputMode:'pdf-native'}]);assert.equal(retry[0].inputMode,undefined);assert.equal(retry[0].history[0].inputMode,'pdf-native');
 const {encodeStudyBackup,decodeStudyBackup}=load('lib/study-backup.ts');const backup=await encodeStudyBackup({name:'Native PDF',createdAt:new Date().toISOString(),texts:{docs:[{...row,name:'scan.pdf',file:new File(['%PDF-fixture'],'scan.pdf'),inputMode:'pdf-native'}]},knowledge:{items:[]}});assert.equal(decodeStudyBackup(backup).texts.docs[0].inputMode,'pdf-native');
 const {RunCostSummary}=load('lib/cost-estimate/run-cost-summary.tsx');assert.match(renderToStaticMarkup(React.createElement(RunCostSummary,{rows:[{...row,runId:'r',runSize:1,runStartedAt:'2026-11-02T01:00:00Z',usage:{cost:0.01}}]})),/Latest run · 1 annotation/);
 console.log('PASS: conditional settings notices, unchanged prior records, save guidance, accurate OpenRouter exports, native/legacy PDF provenance, retry and backup preservation, and latest-run scope.');
})().catch(e=>{console.error(e);process.exit(1)});
