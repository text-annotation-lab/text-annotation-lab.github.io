// Research mode: {{text}} in the prompt places the text there, without tags, instead of after the prompt. What
// each provider receives, now and in a batch, matches the request research mode records; a value of another
// placeholder is never read again; caching ends at the first placeholder; a PDF still follows the prompt. The
// standard Lab sends {{text}} as written. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=async()=>Response.json({});
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+(fs.existsSync(path.join(root,id.slice(2)+'.tsx'))?'.tsx':'.ts')):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+(fs.existsSync(path.resolve(path.dirname(filename),id+'.tsx'))?'.tsx':'.ts')))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}
const source=file=>fs.readFileSync(path.join(root,file),'utf8');

(async()=>{
 const frames=load('lib/request-frame.ts'),route=load('app/api/annotate/route.ts'),batchRoute=load('app/api/batch/route.ts'),inserts=load('lib/prompt-inserts.ts'),view=load('lib/research/request-view.ts'),data=load('lib/research/export-data.ts');
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:['anthropic/claude-haiku-5.5','medium']};
 const keyOf=provider=>provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test';
 const answer=JSON.stringify({explanation:'Because.',score:'A'});
 const reply=provider=>provider==='openai'?{status:'completed',id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text:answer}]}]}:provider==='anthropic'?{stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2},content:[{type:'text',text:answer}]}:provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text:answer}]}}],usageMetadata:{totalTokenCount:12}}:{choices:[{finish_reason:'stop',message:{content:answer}}],usage:{total_tokens:12}};
 const PROMPT='Read the speech below.\n\n{{text}}\n\nNow rate {{id}} ({{meta.year}}) from 1 to 5. Quote {{ TEXT }} only if needed.\n';
 const TEXT='Speech 1. We observe today <<DOCUMENT_TEXT>> and {{text}} as written.',VALUES=['speech “1”.txt','{{text}} <<DOCUMENT_TEXT>> $&'],MAP=inserts.insertMap(PROMPT,VALUES);
 const words=parts=>typeof parts==='string'?parts:parts.map(part=>part.text??part.content?.[0]?.text??'').join('');
 const messageOf=(provider,body)=>provider==='openai'?body.input[0].content:provider==='anthropic'?body.messages[0].content:provider==='gemini'?body.contents[0].parts:body.messages.at(-1).content;
 function form(provider,extra={},file=new File([TEXT],'speech-1.txt')){
  const f=new FormData();for(const [k,v]of Object.entries({provider,model:models[provider][0],effort:models[provider][1],prompt:PROMPT,answerFields:'[]',record:'true',inserts:JSON.stringify(VALUES),placeText:'true',...extra}))if(v!==null)f.set(k,v);
  f.set('file',file);return f;
 }
 async function send(provider,extra,file){calls=[];mock=async()=>Response.json(reply(provider));const response=await route.POST(new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(provider)},body:form(provider,extra,file)}));return {status:response.status,out:await response.json(),body:calls[0]&&JSON.parse(calls[0].options.body)};}
 // A form sends the prompt's line breaks as CR LF (formText in lib/request-frame.ts); the text and the values keep theirs.
 const expected=`Read the speech below.\r\n\r\n${TEXT}\r\n\r\nNow rate ${VALUES[0]} (${VALUES[1]}) from 1 to 5. Quote ${TEXT} only if needed.\r\n`;

 // --- The places and the shared part --------------------------------------------------------------------------
 assert(inserts.placesText(PROMPT));assert.equal(inserts.fixedLength(PROMPT,true),'Read the speech below.\n\n'.length);
 const placed=inserts.fillPlaces(PROMPT,(name,whole)=>MAP.get(name)??whole);assert.equal(placed.spots.length,2);
 assert.equal(placed.prompt.slice(0,placed.spots[0]),'Read the speech below.\n\n');

 for(const provider of Object.keys(models)){
  const [model,effort]=models[provider];
  for(const cacheOn of [false,true]){
   const settings={provider,model,effort,prompt:PROMPT,answerFields:[],requestSettings:cacheOn?{cache:true}:undefined,inserts:true,placed:true,layout:'message'},label=provider+(cacheOn?' with caching':'');
   const sent=await send(provider,cacheOn?{requestSettings:'{"cache":true}'}:{});assert.equal(sent.status,200,label+': '+JSON.stringify(sent.out));
   const message=words(messageOf(provider,sent.body));
   // The text stands where the prompt had {{text}}, each time, without tags; the Lab's instructions follow.
   assert(message.startsWith(expected),label+': '+message.slice(0,200));assert(!message.includes('<text>'),label+': no tags');assert(message.slice(expected.length).startsWith('\nLab response format:')||message.slice(expected.length).startsWith('\n\nLab response format:'),label+': '+message.slice(expected.length,expected.length+40));
   // The request research mode records is the request sent.
   assert.equal(JSON.stringify(sent.body),JSON.stringify(frames.fillRequest(frames.requestFrame(settings,false).body,{filename:'speech-1.txt',text:TEXT,inserts:MAP})),label+': the record is the request');
   // With caching, the mark ends the part before the first placeholder: here, before the text.
   if(cacheOn&&provider!=='gemini'){const parts=messageOf(provider,sent.body);assert(Array.isArray(parts),label);assert.equal(parts[0].text,'Read the speech below.\r\n\r\n',label+': the shared part');assert(parts[0].cache_control||parts[0].prompt_cache_breakpoint,label+': marked');}
  }
  // A PDF still follows the prompt as a file; its places are left empty.
  const pdfSent=await send(provider,{},new File(['%PDF-1.4 test'],'report.pdf'));assert.equal(pdfSent.status,200,provider+' pdf: '+JSON.stringify(pdfSent.out));
  const pdfParts=messageOf(provider,pdfSent.body),pdfWords=words(pdfParts.slice(0,-1));
  assert(pdfWords.startsWith(`Read the speech below.\r\n\r\n\r\n\r\nNow rate ${VALUES[0]} (${VALUES[1]}) from 1 to 5. Quote  only if needed.\r\n`),provider+' pdf: '+pdfWords.slice(0,160));assert(!JSON.stringify(pdfParts.at(-1)).includes('Read the speech'),provider+': the file comes last');
  assert.equal(JSON.stringify(pdfSent.body),JSON.stringify(frames.fillRequest(frames.requestFrame({provider,model,effort,prompt:PROMPT,answerFields:[],inserts:true,placed:true,layout:'message'},true).body,{filename:'report.pdf',file:btoa('%PDF-1.4 test'),inserts:MAP})),provider+' pdf: the record is the request');
  // Without the setting (the standard Lab), {{text}} is sent as written and the text follows between tags.
  const plain=await send(provider,{placeText:null,inserts:null,record:null});assert.equal(plain.status,200);
  const plainWords=words(messageOf(provider,plain.body));assert(plainWords.startsWith('Read the speech below.\r\n\r\n{{text}}\r\n\r\nNow rate {{id}}'),provider);assert(plainWords.endsWith('\n\n<text>\n'+TEXT+'\n</text>'),provider+': '+plainWords.slice(-80));
  // Refused: the setting without {{text}} in the prompt, with another value, or for a run made before the layout.
  for(const extra of [{prompt:'Rate {{id}} ({{meta.year}}).'},{placeText:'yes'},{layout:'earlier'}]){const refused=await send(provider,extra);assert.equal(refused.status,400,provider+': '+JSON.stringify(extra));assert.equal(refused.out.error,'Invalid setting for the place of the text.');assert.equal(calls.length,0);}
 }

 // --- A prompt that begins with {{text}}: nothing is shared, so nothing is marked ----------------------------------
 {const sent=await send('anthropic',{prompt:'{{text}}\nRate it.',inserts:null,requestSettings:'{"cache":true}'});assert.equal(sent.status,200,JSON.stringify(sent.out));
  const parts=messageOf('anthropic',sent.body);assert(!JSON.stringify(parts).includes('cache_control'),'No mark');assert(words(parts).startsWith(TEXT+'\r\nRate it.'));}

 // --- Model knowledge: the subject's fields stand in the place ------------------------------------------------------
 {const sent=await send('openai',{mode:'model-knowledge',fields:JSON.stringify([{heading:'Film',value:'Jaws'}]),prompt:'Consider this film:\n{{text}}\nWho directed it?',inserts:null});assert.equal(sent.status,200,JSON.stringify(sent.out));
  const message=words(messageOf('openai',sent.body));assert(message.startsWith('Consider this film:\r\n')&&message.includes('Jaws')&&!message.includes('<entry>'),message.slice(0,200));
  assert(message.indexOf('Jaws')<message.indexOf('Who directed it?'),'The fields stand where the prompt has {{text}}');}

 // --- A batch: each request as recorded ------------------------------------------------------------------------------
 for(const provider of ['openai','anthropic','gemini']){
  const [model,effort]=models[provider],txt=new File([TEXT],'speech-1.txt'),second=new File(['Speech 2.'],'speech-2.txt');
  const submit=async(extra={})=>{const f=new FormData();
   for(const [k,v]of Object.entries({action:'submit',provider,model,effort,prompt:PROMPT,answerFields:'[]',requestSettings:'{"cache":true}',runId:'lab_test',ids:JSON.stringify(['lab_test_0','lab_test_1']),inserts:JSON.stringify([VALUES,['speech-2.txt','1961']]),placeText:'true',...extra}))if(v!==null)f.set(k,v);
   f.append('files',txt);f.append('files',second);
   calls=[];mock=async url=>Response.json(provider==='openai'?(String(url).endsWith('/files')?{id:'file-abc'}:{id:'batch_abc'}):provider==='anthropic'?{id:'msgbatch_abc'}:{name:'batches/abc'});
   const response=await batchRoute.POST(new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(provider)},body:f}));
   const payload=calls[0]?.options.body;
   return {status:response.status,out:await response.json(),rows:!payload?[]:provider==='openai'?(await payload.get('file').text()).split('\n').map(line=>JSON.parse(line).body):provider==='anthropic'?JSON.parse(await payload.text()).requests.map(row=>row.params):JSON.parse(await payload.text()).batch.input_config.requests.requests.map(row=>row.request)};};
  const done=await submit();assert.equal(done.status,200,provider+': '+JSON.stringify(done.out));
  const settings={provider,model,effort,prompt:PROMPT,answerFields:[],requestSettings:{cache:true},batch:true,inserts:true,placed:true,layout:'message'};
  assert.deepEqual(done.rows.map(row=>JSON.stringify(row)),[JSON.stringify(frames.fillRequest(frames.requestFrame(settings,false).body,{filename:'speech-1.txt',text:TEXT,inserts:MAP})),JSON.stringify(frames.fillRequest(frames.requestFrame(settings,false).body,{filename:'speech-2.txt',text:'Speech 2.',inserts:inserts.insertMap(PROMPT,['speech-2.txt','1961'])}))],provider+': each request as recorded');
  assert(words(messageOf(provider,done.rows[1])).startsWith('Read the speech below.\r\n\r\nSpeech 2.\r\n\r\nNow rate speech-2.txt (1961)'),provider);
  const refused=await submit({prompt:'Rate {{id}} ({{meta.year}}).'});assert.equal(refused.status,400);assert.equal(refused.out.error,'Invalid setting for the place of the text.');
 }

 // --- Preview request, and the prompt as an export writes it ----------------------------------------------------------
 const settings={provider:'anthropic',model:'claude-sonnet-5-5',effort:'medium',prompt:PROMPT,answerFields:[],requestSettings:{cache:true},inserts:true,placed:true};
 const preview=view.previewRequest(settings,{filename:'speech-1.txt',text:TEXT,inserts:MAP});
 assert(preview.message.startsWith(expected),preview.message.slice(0,160));assert(preview.cached);
 const parts=data.requestParts(frames.requestFrame({...settings,layout:'message'},false));
 assert(parts.prompt.startsWith('Read the speech below.\r\n\r\n{{text}}\r\n\r\nNow rate {{id}} ({{meta.year}}) from 1 to 5. Quote {{text}} only if needed.\r\n'),parts.prompt.slice(0,200));
 // An earlier result (no layout) never places the text, even where its prompt has {{text}}.
 assert(!frames.requestFrame({...settings,inserts:false,requestSettings:undefined},false).body.includes('Read the speech below.\\r\\n\\r\\n<<DOCUMENT_TEXT>>'));assert(frames.requestFrame({...settings,inserts:false,requestSettings:undefined,layout:'message'},false).body.includes('Read the speech below.\\r\\n\\r\\n<<DOCUMENT_TEXT>>'),'The same with the current layout places it');

 // --- The page ----------------------------------------------------------------------------------------------------
 const page=source('app/page.tsx'),knowledge=source('components/model-knowledge.tsx'),options=source('components/research/request-options.tsx');
 assert(page.includes("placed:record.layout===LAYOUT&&placesText(record.prompt)"),'Retry failed places the text only for runs made with the current layout');
 assert(page.includes("if(layout!==LAYOUT)form.set('layout','earlier');else if(placed)form.set('placeText','true');"));
 for(const text of [page,knowledge])assert(text.includes('inserts:insertNames.length>0,placed'),'Preview and the record know the place of the text');
 assert(options.includes('where it has {{text}}, then the instructions the Lab adds for the answer format.'));
 console.log('PASS: {{text}} places the text in the prompt for every provider, now and in a batch, as recorded; values are never read again; caching ends at the first placeholder; PDFs follow the prompt; the standard Lab sends it as written. No provider was called.');
})().catch(error=>{console.error(error);process.exit(1);});
