// Offline regressions for the October 22 adversarial review. No provider traffic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
const cache=new Map(),calls=[];
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file);
 const out={};cache.set(file,out);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('exports','require','fetch',code)(out,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id),async(url,options)=>{
  calls.push({url,options});const text=JSON.stringify({score:'OK',explanation:'Test annotation'});
  return Response.json(url.includes('anthropic')?{stop_reason:'end_turn',content:[{type:'text',text}]}:url.includes('googleapis')?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]}:{status:'completed',output:[{content:[{type:'output_text',text}]}]});
 });return out;
}
const {extractText,TextEncodingError}=load('lib/extract-text.ts');
const {parseKnowledgeItems:parse}=load('lib/model-knowledge.ts');
const {defaultModel,defaultEffort}=load('lib/providers.ts');
const {POST}=load('app/api/annotate/route.ts');
function request(file,provider='openai',prompt='Classify'){
 const model=defaultModel(provider),form=new FormData();
 for(const [name,value] of Object.entries({provider,model,effort:defaultEffort(provider,model),prompt,file}))form.set(name,value);
 return new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:'Bearer sk-review-test'},body:form});
}
function unreadableBody(headers){
 const req=new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',...headers}});
 Object.defineProperty(req,'body',{get(){throw Error('Body must not be read');}});return req;
}
function oversizedStream(declaredLength){
 let pulls=0,cancelled=false;
 const chunk=new Uint8Array(1024*1024).fill(120);
 const stream=new ReadableStream({pull(controller){pulls++;if(pulls===1)controller.enqueue(new TextEncoder().encode('--review\r\nContent-Disposition: form-data; name="extra"\r\n\r\n'));else if(pulls<50)controller.enqueue(chunk);else {controller.enqueue(new TextEncoder().encode('\r\n--review--\r\n'));controller.close();}},cancel(){cancelled=true;}});
 const headers={origin:'http://localhost',authorization:'Bearer sk-review-test','content-type':'multipart/form-data; boundary=review'};
 if(declaredLength!==undefined)headers['content-length']=declaredLength;
 return {request:new Request('http://localhost/api/annotate',{method:'POST',headers,body:stream,duplex:'half'}),state:()=>({pulls,cancelled})};
}
(async()=>{
 const expected='Hello café. 漢字 and emoji 🧪. The proposal is not approved.';
 const le=Buffer.concat([Buffer.from([255,254]),Buffer.from(expected,'utf16le')]);
 const be=Buffer.from(le);be.swap16();
 for(const bytes of [Buffer.from(expected),Buffer.concat([Buffer.from([239,187,191]),Buffer.from(expected)]),le,be]){
  const file=new File([bytes],'unicode.txt');assert.equal(await extractText(file),expected);
  for(const provider of ['openai','anthropic','gemini']){
   const response=await POST(request(file,provider));assert.equal(response.status,200);
   assert(calls.at(-1).options.body.includes(expected),'The provider receives the intact original text');
  }
 }
 assert.equal(await extractText(new File([Buffer.concat([Buffer.from([255,254]),Buffer.from('<p>Café 🧪</p>','utf16le')])],'page.html')),'Café 🧪');
 for(const bytes of [Buffer.from([0x63,0x61,0x66,0xe9]),Buffer.from('hello','utf16le'),Buffer.from([0xff,0xfe,0x61]),Buffer.from([0xff,0xfe,0,0,0x61,0,0,0])]){
  const file=new File([bytes],'bad.txt');await assert.rejects(extractText(file),TextEncodingError);
  for(const provider of ['openai','anthropic','gemini']){const count=calls.length,response=await POST(request(file,provider));assert.equal(response.status,400);assert.match((await response.json()).error,/UTF-8/);assert.equal(calls.length,count);}
 }
 console.log('PASS: UTF-8 and BOM-marked UTF-16 preserve Unicode through all three provider routes; invalid encodings fail before provider calls.');
 assert.equal(parse('structured','Title,Author','"Title\twith tab",Writer').items[0][0].value,'Title\twith tab');
 assert.equal(parse('structured','Title,Author','"A ""quoted\tname""",Writer').items[0][0].value,'A "quoted\tname"');
 assert.equal(parse('structured','"Title\tlabel",Author','Book,Writer').headings[0],'Title\tlabel');
 assert.equal(parse('structured','Title,Author','Book\tWriter').items[0][1].value,'Writer');
 assert.equal(parse('structured','Title\tAuthor','"Book, subtitle"\tWriter').items[0][0].value,'Book, subtitle');
 assert.equal(parse('structured','Title,Author','"First\nSecond\tline",Writer').items.length,1);
 assert(parse('structured','Title,Author','"unfinished\t,Writer').error);
 console.log('PASS: quoted tabs, escaped quotes, multiline CSV, and spreadsheet TSV separators.');
 const before=calls.length;
 assert.equal((await POST(unreadableBody({}))).status,401);
 assert.equal((await POST(unreadableBody({authorization:'Bearer sk-review-test','content-length':'200000000'}))).status,413);
 for(const length of [undefined,'1']){
  const streamed=oversizedStream(length);assert.equal((await POST(streamed.request)).status,413);
  await new Promise(resolve=>setImmediate(resolve));assert(streamed.state().pulls<50);assert(streamed.state().cancelled);
 }
 const malformed=new Request('http://localhost/api/annotate',{method:'POST',headers:{origin:'http://localhost',authorization:'Bearer sk-review-test','content-type':'multipart/form-data; boundary=missing'},body:'bad multipart'});
 assert.equal((await POST(malformed)).status,400);assert.equal(calls.length,before);
 // A legal 20 MB upload plus maximum prompt must pass the request-body guard.
 const maxFile=new File([new Uint8Array(20*1024*1024).fill(97)],'large.txt');
 const large=await POST(request(maxFile,'openai','x'.repeat(100000)));
 assert.equal(large.status,400);assert.match((await large.json()).error,/extracted text is too large/);
 console.log('PASS: early credential rejection; bounded reads with absent or false Content-Length; stream cancellation; valid upload allowance; malformed multipart rejection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
