const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
let reads=0,calls=0;const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',source)(out,id=>{if(id==='./extract-text')return {extractText:async file=>{reads++;return file.text();}};if(id==='unpdf')return {getDocumentProxy:async()=>({numPages:2,loadingTask:{destroy:async()=>{}}}),extractText:async()=>({text:'PDF extracted text. '.repeat(100)})};return id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id);},()=>{calls++;throw Error('No provider calls allowed');});return out;}
const {studentEstimate}=load('lib/student-estimate.ts'),{PROVIDERS}=load('lib/providers.ts');
(async()=>{
 const file=new File(['A real uploaded text. '.repeat(500)],'real.txt');
 const rows=[{id:'1',file,status:'pending'}],c={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Return sentiment and explain in two sentences.',rows};
 const first=await studentEstimate(c);assert.equal(first.count,1);assert(first.input.low>2000);await studentEstimate({...c,prompt:c.prompt+' Use JSON.'});assert.equal(reads,1,'Reopening or editing prompts reuses extracted file counts');
 const pdf=await studentEstimate({...c,rows:[{file:new File(['%PDF-fixture'],'paper.pdf'),status:'pending'}]});assert(pdf.notes.some(n=>n.includes('page-image')));assert(pdf.input.high>6000);
 const sample={status:'done',provider:c.provider,model:c.model,effort:c.effort,prompt:c.prompt,usage:{input_tokens:4000,output_tokens:200,output_tokens_details:{reasoning_tokens:100}}};
 assert.equal((await studentEstimate({...c,rows:[...rows,sample]})).samples,1);assert.equal((await studentEstimate({...c,rows:[...rows,{...sample,prompt:'Different rubric'}]})).samples,0);
 const subjects=[{fields:[{heading:'Title',value:'Pride and Prejudice'},{heading:'Author',value:'Jane Austen'}],status:'pending'}];
 const knowledge=await studentEstimate({...c,rows:subjects,knowledge:true});assert.equal(knowledge.count,1);assert(knowledge.input.low>0);const web=await studentEstimate({...c,rows:subjects,knowledge:true,webSearch:true});assert(web.total.low>knowledge.total.low);assert(!web.batch);
 for(const [provider,settings] of Object.entries(PROVIDERS))for(const model of settings.models){const out=await studentEstimate({...c,provider,model,rows:subjects,knowledge:true});assert(!out.unknown,model);if(provider==='openrouter')assert.equal(out.batch,undefined,model);else assert(out.batch,model);}
 const sharedPdf=new File(['%PDF-fixture'],'shared.pdf'),pdfRows=[{file:sharedPdf,status:'pending'}];
 const visual=await studentEstimate({...c,rows:pdfRows}),textOnly=await studentEstimate({...c,provider:'openrouter',model:'openai/gpt-6-luna',rows:pdfRows});
 assert.equal(textOnly.input.high,visual.input.high);assert(textOnly.notes.some(n=>n.includes('page-image')));
 const oldPdf={...sample,provider:'openrouter',model:'openai/gpt-6-luna',file:sharedPdf,usage:{prompt_tokens:100,completion_tokens:20}};
 assert.equal((await studentEstimate({...c,provider:'openrouter',model:'openai/gpt-6-luna',rows:[...pdfRows,oldPdf]})).samples,0,'Earlier text-only PDF calls must not calibrate native PDF costs');
 assert.equal((await studentEstimate({...c,provider:'openrouter',model:'openai/gpt-6-luna',rows:[...pdfRows,{...oldPdf,inputMode:'pdf-native'}]})).samples,1);
 const stopped=new AbortController();stopped.abort();await assert.rejects(()=>studentEstimate({...c,signal:stopped.signal}),/abort/i);
 assert.equal(calls,0);console.log('PASS: actual uploaded text, PDF page allowances, field-based subjects, prompt updates and extraction reuse, usage calibration/mismatch exclusion, every selectable model, web search, and cancellation. No provider calls.');
})().catch(e=>{console.error(e);process.exit(1)});
