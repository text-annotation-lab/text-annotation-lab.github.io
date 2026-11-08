const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const root=process.cwd(),ts=require(path.join(root,'node_modules/typescript'));
const projectRequire=createRequire(path.join(root,'package.json'));
let calls=[],mock;
function load(file){
 const exports={};const filename=path.join(root,file);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const localRequire=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):projectRequire(id);
 new Function('exports','require','fetch',code)(exports,localRequire,async(url,options)=>{calls.push({url,options});return mock();});return exports;
}
const models={openai:'gpt-5.6-luna',gemini:'gemini-3.1-flash-lite',anthropic:'claude-sonnet-5-5'};
function request(provider,changes={}){
 const form=new FormData();for(const [k,v] of Object.entries({provider,model:models[provider],effort:provider==='gemini'?'minimal':'high',prompt:'Classify tone',file:new File(['Sample text'],'sample.txt'),...changes}))form.set(k,v);
 return new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:'Bearer sk-ant-audit'},body:form});
}
(async()=>{
 const route=load('app/api/annotate/route.ts');
 for(const provider of Object.keys(models)){
  const req=()=>{const r=request(provider);if(provider==='openai')r.headers.set('authorization','Bearer sk-audit');return r;};
  for(const text of ['null','[]','{"score":2,"explanation":"x"}']){
   mock=()=>Response.json(provider==='openai'?{status:'completed',output:[{content:[{type:'output_text',text}]}]}:provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}:{stop_reason:'end_turn',content:[{type:'text',text}]});
   assert.equal((await route.POST(req())).status,422,provider+' malformed annotation');
   assert(calls.at(-1).options.signal instanceof AbortSignal,provider+' needs timeout');
  }
  const before=calls.length,r=req();r.headers.set('origin','https://other.example');assert.equal((await route.POST(r)).status,403);assert.equal(calls.length,before);
 }
 mock=()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({score:'1',explanation:'ok',file:'unexpected'})}]}]});
 const open=request('openai');open.headers.set('authorization','Bearer sk-audit');assert.equal((await (await route.POST(open)).json()).file,undefined);
 const {extractText}=load('lib/extract-text.ts');
 assert.equal(await extractText(new File(['Café — freedom'],'a.txt')),'Café — freedom');
 const html=await extractText(new File(['<html><head><title>Hidden</title></head><body><p>Hello <b>world</b>.</p><script>secret()</script></body></html>'],'a.html'));
 assert.match(html,/Hello world/);assert(!html.includes('secret'));assert(!html.includes('Hidden'));
 assert.equal(await extractText(new File(['{\\rtf1\\ansi Hello \\u8212? world\\par next}'],'a.rtf')),'Hello — world\n\nnext');
 await assert.rejects(()=>extractText(new File(['not RTF'],'a.rtf')));
 const ExcelJS=projectRequire('exceljs'),Zip=createRequire(projectRequire.resolve('exceljs'))('jszip');
 const z=new Zip();z.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');z.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');z.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX test content</w:t></w:r></w:p></w:body></w:document>');
 assert.match(await extractText(new File([await z.generateAsync({type:'nodebuffer'})],'a.docx')),/DOCX test content/);
 const {createResultsWorkbook}=load('lib/export-results.ts'),long='Evidence '.repeat(5000),prompt='Prompt '.repeat(10000);
 const bytes=await createResultsWorkbook([{name:'=SUM(1,2).txt',status:'done',score:'001',explanation:long,provider:'openai',model:models.openai,effort:'medium',prompt},{name:'b.txt',status:'done',score:'2',explanation:'other',provider:'anthropic',model:models.anthropic,effort:'high',prompt:'other'},{name:'pending.txt',status:'pending'}],{provider:'gemini',model:models.gemini,effort:'minimal',prompt:'current'});
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(bytes);const results=wb.getWorksheet('Results');
 assert.equal(results.getCell('A2').value,'=SUM(1,2).txt');assert.equal(results.getCell('A2').type,ExcelJS.ValueType.String);assert.equal(results.getCell('B2').value,'001');assert.equal(results.getCell('B3').value,2);
 assert.equal(results.getCell('C2').value+results.getCell('D2').value,long);
 const settings=wb.getWorksheet('Study settings'),chunks=[];let settingsGroup=0;settings.eachRow(row=>{const label=String(row.getCell(1).value);if(/^S[0-9]+$/.test(label))settingsGroup++;if(settingsGroup===1&&label.startsWith('Annotation prompt'))chunks.push(row.getCell(2).value);row.eachCell(c=>{if(typeof c.value==='string')assert(c.value.length<=32767);});});assert.equal(chunks.join(''),prompt);
 console.log('PASS: all-provider malformed outputs, timeouts, origin checks, safe response fields, TXT/HTML/RTF/DOCX extraction, mixed settings, numeric/category fidelity, formula-safe strings, long Excel text. No paid API calls.');
})().catch(e=>{console.error(e);process.exit(1);});
