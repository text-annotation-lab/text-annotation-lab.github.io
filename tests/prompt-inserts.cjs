// Research mode's placeholders in the prompt: {{id}} (a text's name) and {{meta.<column>}} (its value in a
// metadata column). What counts as a placeholder, the values a text gives them, the requests they make (now
// and in a batch, with and without prompt caching), the record of those requests, and the exported files,
// including the Python script, which is run against a local stand-in. No provider is called.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFile,spawnSync}=require('node:child_process'),ts=require('../node_modules/typescript');
const root=process.cwd(),cache=new Map();let calls=[],mock=async()=>Response.json({});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):require(id);
 new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});
 return exports;
}
const inserts=load('lib/prompt-inserts.ts'),research=load('lib/research/inserts.ts'),route=load('app/api/annotate/route.ts'),batchRoute=load('app/api/batch/route.ts'),batch=load('lib/batch-provider.ts'),providers=load('lib/providers.ts'),frames=load('lib/request-frame.ts'),knowledgeLib=load('lib/model-knowledge.ts');
const {extractText}=load('lib/extract-text.ts'),records=load('lib/research/requests.ts'),runs=load('lib/research/runs.ts'),safety=load('lib/workflow-safety.ts'),backup=load('lib/study-backup.ts'),requestSettings=load('lib/request-settings.ts'),notes=load('lib/cache-note.ts'),view=load('lib/research/request-view.ts');
const columnsLib=load('lib/research/columns.ts'),data=load('lib/research/export-data.ts'),tables=load('lib/research/export-tables.ts'),packages=load('lib/research/export-packages.ts'),python=load('lib/research/export-python.ts'),formatsLib=load('lib/answer-fields.ts'),{toCsv}=load('lib/research/parse-table.ts');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');

// A CSV file read back: rows of cells, without the byte-order mark.
function readCsv(text){
 const rows=[];let row=[],cell='',quoted=false;text=text.replace(/^﻿/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(cell||row.length){row.push(cell);rows.push(row);}
 return rows;
}
const textOf=async value=>typeof value==='string'?value:value instanceof Blob?await value.text():Buffer.from(value).toString('utf8');
const read=async(pack,name)=>{const file=pack.files.find(item=>item.path===pack.name+'/'+name);assert(file,`${name} is in the package`);return textOf(file.data);};
const jsonLines=text=>text.trim().split('\n').map(line=>JSON.parse(line));

// --- What is a placeholder -----------------------------------------------------------------------------
const LONG='x'.repeat(61);
const WRITTEN=`Text {{id}} was published in {{meta.year}} by {{ meta.Outlet name }} ({{meta.Year (first ed.)}}, {{META.køn}}, {{ ID }}).
Rate the tone of {{id}}. {{text}}, {{meta.}}, {{unknown}}, {{meta.${LONG}}}, {{meta.a<b}}, {{}}, {single}, and {{text}} again stay as written.`;
const NAMES=['id','meta.year','meta.Outlet name','meta.Year (first ed.)','meta.køn'];
assert.deepEqual(inserts.promptInserts(WRITTEN),NAMES,'Each placeholder once, in the order of first appearance; {{ID}} is {{id}}');
assert.deepEqual(inserts.strayPlaceholders(WRITTEN),['{{meta.}}','{{unknown}}',`{{meta.${LONG}}}`,'{{meta.a<b}}','{{}}'],'Anything else in double braces, each once; {{text}} places the text');
assert(inserts.placesText(WRITTEN)&&inserts.placesText('Rate {{ TEXT }}.')&&!inserts.placesText('Rate {text} and {{texts}}.'));
assert.deepEqual(inserts.promptInserts('No placeholder: {{text}} and { {id} } and {{meta.two\nlines}}.'),[]);
assert.deepEqual(inserts.promptInserts('{{meta.'+'x'.repeat(60)+'}}'),['meta.'+'x'.repeat(60)],'A column’s name has at most 60 characters');
assert.equal(inserts.fixedLength(WRITTEN),5);assert.equal(inserts.fixedLength('{{id}} first'),0);assert.equal(inserts.fixedLength('None, {{text}}.'),15);
assert.equal(inserts.fixedLength('{{text}} is no placeholder, {{meta.a}} is.'),28,'The part every text shares ends at the first placeholder that is filled in');
assert.equal(inserts.fixedLength('None, {{text}}.',true),6);assert.equal(inserts.fixedLength('{{text}} first, {{meta.a}}.',true),0,'Where the text is placed, {{text}} ends the shared part too');
assert.deepEqual(inserts.fillPlaces('A {{text}}, {{ Text }}, {{id}}, {{texts}}.',name=>name==='id'?'{{text}} <<DOCUMENT_TEXT>>':'?'),{prompt:'A , , {{text}} <<DOCUMENT_TEXT>>, {{texts}}.',spots:[2,4]},'Each {{text}} taken out; a value is never read again');
// Filling in: each name's value wherever it stands; a value is never read again.
const VALUES=['text “1”.txt','1975','The\n"Post" \\ <<DOCUMENT_TEXT>>','{{id}} $& $1 <<INSERT:id>>','æøå 日本 🙂'];
const FILLED=inserts.fillInserts(WRITTEN,VALUES);
assert.equal(FILLED,`Text text “1”.txt was published in 1975 by The\n"Post" \\ <<DOCUMENT_TEXT>> ({{id}} $& $1 <<INSERT:id>>, æøå 日本 🙂, text “1”.txt).
Rate the tone of text “1”.txt. {{text}}, {{meta.}}, {{unknown}}, {{meta.${LONG}}}, {{meta.a<b}}, {{}}, {single}, and {{text}} again stay as written.`);
assert.equal(inserts.fillInserts('{{meta.a}}|{{meta.b}}',['only one']),'only one|','A missing value is empty');
assert.equal(inserts.fillInserts('Nothing here, {{text}}.',[]),'Nothing here, {{text}}.');
// Marks: what a recorded request holds in place of each placeholder.
const MARKED=inserts.markInserts(WRITTEN);
assert(MARKED.startsWith('Text <<INSERT:id>> was published in <<INSERT:meta.year>> by <<INSERT:meta.Outlet name>> (<<INSERT:meta.Year (first ed.)>>, <<INSERT:meta.køn>>, <<INSERT:id>>).'));
assert(MARKED.endsWith('{{text}}, {{meta.}}, {{unknown}}, {{meta.'+LONG+'}}, {{meta.a<b}}, {{}}, {single}, and {{text}} again stay as written.'));
assert.deepEqual(inserts.markedInserts(MARKED),NAMES);assert.deepEqual(inserts.markedInserts('<<INSERT:other>> <<DOCUMENT_TEXT>>'),[],'Only a placeholder’s mark is one');
assert.equal(inserts.showInserts(MARKED),WRITTEN.replace('{{ meta.Outlet name }}','{{meta.Outlet name}}').replace('{{META.køn}}','{{meta.køn}}').replace('{{ ID }}','{{id}}'));
assert.deepEqual([...inserts.insertMap(WRITTEN,VALUES)],NAMES.map((name,i)=>[name,VALUES[i]]));assert.deepEqual([...inserts.insertMap('{{id}} {{meta.a}}',undefined)],[['id',''],['meta.a','']]);
// The values a request may carry: one string for each placeholder, or nothing at all.
assert.equal(inserts.readInserts(null,WRITTEN),undefined);assert.equal(inserts.readInserts(undefined,WRITTEN),undefined);
assert.deepEqual(inserts.readInserts(VALUES,WRITTEN),VALUES);
for(const bad of [VALUES.slice(1),[...VALUES,'one more'],[...VALUES.slice(1),5],[...VALUES.slice(1),null],[...VALUES.slice(1),'x'.repeat(inserts.MAX_INSERT_LENGTH+1)],'text',{0:'a'},[]])assert.throws(()=>inserts.readInserts(bad,WRITTEN),/Could not read the values for the placeholders of the prompt\./);
assert.throws(()=>inserts.readInserts([],'A prompt without placeholders.'),/Could not read/,'Values for a prompt that has no placeholders are refused');
assert(!/^\s*import\s/m.test(source('lib/prompt-inserts.ts')),'lib/prompt-inserts.ts imports nothing');

// --- The values of a text, and the lines under the prompt box ---------------------------------------------
const COLUMNS=[{name:'Year',role:'meta'},{name:'Outlet name',role:'meta'},{name:'tone_human',role:'label'},{name:'text',role:'meta'},{name:'Year (first ed.)',role:'meta'}];
const ROW={name:'text “1”.txt',cells:['1975','The Post','5','body','1974']};
assert.deepEqual(research.insertValues(['id','meta.year','meta.OUTLET NAME','meta.tone_human','meta.none','meta.text','meta.Year (first ed.)'],ROW,COLUMNS,'text “1”'),['text “1”','1975','The Post','','','body','1974'],'A column by its name in any case; a label column and a missing column give nothing');
assert.deepEqual(research.insertValues(['id','meta.year'],{name:'bare'},COLUMNS,'bare'),['bare',''],'A text without values');assert.deepEqual(research.insertValues(['id'],{},[],''),['']);
assert.deepEqual(research.insertNotes('Rate the tone.',COLUMNS,'text'),['{{text}} in the prompt places each text there instead of after the prompt; {{meta.Year}} inserts its value of that column, and {{id}} its name without the file extension.']);
assert.deepEqual(research.insertNotes('Rate the tone.',[{name:'tone_human',role:'label'}],'text'),['{{text}} in the prompt places each text there instead of after the prompt.'],'No metadata: only {{text}}');assert.deepEqual(research.insertNotes('Rate the tone.',[],'subject'),['{{text}} in the prompt places each subject there instead of after the prompt.']);
assert.deepEqual(research.insertNotes('Rate {{text}} now.',COLUMNS,'text'),['The text goes where the prompt has {{text}}, instead of after the prompt.']);
assert.deepEqual(research.insertNotes('{{id}} from {{meta.year}}.',COLUMNS,'text'),['Filled in for each text: {{id}}, {{meta.year}}.']);
assert.deepEqual(research.insertNotes('{{id}} from {{meta.year}}, {{meta.decade}}, {{meta.tone_human}}, {{text}}, {{name}}.',COLUMNS,'subject').sort(),['Filled in for each subject: {{id}}, {{meta.year}}.','No such metadata column: decade (filled in empty).','Human labels are not sent to the model: tone_human (filled in empty).','The subject’s fields go where the prompt has {{text}}, instead of after the prompt.','Sent as written: {{name}}.'].sort());
assert.deepEqual(research.insertNotes('About {{name}}.',COLUMNS,'text'),['Sent as written: {{name}}.']);
assert.deepEqual(research.insertNotes('From {{meta.decade}}.',[],'text'),['No such metadata column: decade (filled in empty).']);

// --- Requests -------------------------------------------------------------------------------------------
const PROMPT='Classify the tone of {{id}}, published in {{meta.year}} by {{meta.Outlet name}}.\nRate hope from 1 to 5; the text is from {{meta.year}}. {{text}} stays.';
// The prompt as the request handlers hold it: a form field's line breaks are CR LF.
const SENT_PROMPT=PROMPT.replace('\n','\r\n');
const P_NAMES=['id','meta.year','meta.Outlet name'],P_VALUES=['text “1”.txt','1975\nor 1976','The "Post" \\ <<DOCUMENT_TEXT>> {{id}} $& <<INSERT:meta.year>>'];
const pdf=new File([new Uint8Array([37,80,68,70,45,49,46,52,10,1,2,3,250,251,252])],'Report “A”.pdf',{type:'application/pdf'});
const txt=new File(['A document with “quotes” and\nlines. It names <<DOCUMENT_TEXT>>, <<INSERT:id>>, and {{id}} itself.'],'text one.txt');
const SUBJECT=[{heading:'Film',value:'Jaws'},{heading:'Year',value:'1975'}];
const formats={
 standard:{fields:[],settings:undefined},
 named:{fields:['Tone','Explanation'],settings:undefined},
 plain:{fields:['response'],settings:{plain:true}},
 typed:{fields:['hope','kind','note'],settings:{fields:[{name:'hope',type:'ordinal',values:['1','2','3','4','5'],description:'Hope.'},{name:'kind',type:'category',values:['a','b'],description:''},{name:'note',type:'text',values:[],description:'A note.'}]}},
};
const answerText=JSON.stringify({explanation:'Because.',score:'A',answers:{f0:'1',f1:'a',f2:'y'}});
function providerReply(provider,text=answerText){
 if(provider==='openai')return {status:'completed',model:'gpt-6-luna-2026-10-01',id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text}]}]};
 if(provider==='anthropic')return {stop_reason:'end_turn',model:'claude-sonnet-5-5-20260901',id:'msg_test',usage:{input_tokens:10,output_tokens:2},content:[{type:'text',text}]};
 if(provider==='gemini')return {modelVersion:'gemini-3.8-flash-002',responseId:'gem_test',candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{totalTokenCount:12}};
 return {id:'gen_test',model:'openai/gpt-6-luna',provider:'OpenAI',choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}};
}
const keyOf=provider=>provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test';
function annotate(provider,model,effort,format,{cacheOn=false,kind='txt',prompt=PROMPT,values=P_VALUES,raw}={}){
 const form=new FormData(),knowledge=kind==='knowledge';
 for(const [k,v]of Object.entries({provider,model,effort,prompt,answerFields:JSON.stringify(format.fields),record:'true'}))form.set(k,v);
 if(format.settings)form.set('answerSettings',JSON.stringify(format.settings));
 if(cacheOn)form.set('requestSettings','{"cache":true}');
 if(raw!==undefined)form.set('inserts',raw);else if(values)form.set('inserts',JSON.stringify(values));
 if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify(SUBJECT));form.set('webSearch','false');}else form.set('file',kind==='pdf'?pdf:txt);
 return route.POST(new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(provider)},body:form}));
}
const base64=async file=>Buffer.from(await file.arrayBuffer()).toString('base64');
const firstModel=provider=>providers.PROVIDERS[provider].models[0],firstEffort=provider=>providers.reasoningOptions(provider,firstModel(provider))[0];
// A model of each kind of prompt cache: marked (Anthropic, OpenAI from GPT-5.6, both also through OpenRouter) and the provider's own.
const marked=provider=>providers.PROVIDERS[provider].models.find(model=>requestSettings.cacheSupport(provider,model)?.kind==='marked');

(async()=>{
 const txtText=await extractText(txt),pdfData=await base64(pdf),MAP=inserts.insertMap(PROMPT,P_VALUES);
 assert.deepEqual(inserts.promptInserts(PROMPT),P_NAMES);
 // The recorded request (marks for the document and for each placeholder), filled with a text's document and
 // values, is the request that was sent, byte for byte: every provider and model, now and in a batch.
 let compared=0;
 for(const [provider,spec] of Object.entries(providers.PROVIDERS)){
  for(const model of spec.models){
   const efforts=providers.reasoningOptions(provider,model);
   for(const effort of new Set([efforts[0],efforts[efforts.length-1]])){
    for(const [formatName,format] of Object.entries(formats)){
     for(const cacheOn of [false,true]){
      for(const kind of ['txt','pdf','knowledge']){
       const knowledge=kind==='knowledge',label=[provider,model,effort,formatName,cacheOn?'cache':'no cache',kind].join(' | ');
       const settings={provider,model,effort,prompt:PROMPT,answerFields:format.fields,answerSettings:format.settings,requestSettings:cacheOn?{cache:true}:undefined,knowledge,inserts:true,layout:'message'};
       const doc=knowledge?{filename:'subject.txt',text:knowledgeLib.knowledgeDocumentText(SUBJECT)}:kind==='pdf'?{filename:pdf.name,file:pdfData}:{filename:txt.name,text:txtText};
       calls=[];mock=async()=>Response.json(providerReply(provider,formatName==='plain'?'Mostly hopeful.':answerText));
       const response=await annotate(provider,model,effort,format,{cacheOn,kind});
       assert.equal(calls.length,1,label+': '+JSON.stringify(await response.clone().json()));
       const frame=frames.requestFrame(settings,kind==='pdf');
       assert.equal(calls[0].options.body,JSON.stringify(frames.fillRequest(frame.body,{...doc,inserts:MAP})),'Sent now: '+label);
       assert(frame.body.includes('<<INSERT:meta.year>>')&&!frame.body.includes('1975'),'The record holds marks, not a text’s values');
       compared++;
       if(provider!=='openrouter'){
        const file=knowledge?new File([knowledgeLib.knowledgeDocumentText(SUBJECT)],'subject.txt',{type:'text/plain'}):kind==='pdf'?pdf:txt,added=knowledge?'\n\n'+knowledgeLib.knowledgeInstructions(false):'';
        const sent=JSON.stringify(await batch.buildBatchBody(provider,file,inserts.fillInserts(SENT_PROMPT,P_VALUES)+added,model,effort,knowledge,false,format.fields,format.settings,cacheOn?{cache:true}:undefined,SENT_PROMPT+added));
        assert.equal(sent,JSON.stringify(frames.fillRequest(frames.requestFrame({layout:'message',...settings,batch:true},kind==='pdf').body,{...doc,inserts:MAP})),'Sent in a batch: '+label);
        compared++;
       }
      }
     }
    }
   }
  }
 }
 assert(compared>1500,'Every listed model was compared');

 // What a request looks like: the values stand in the prompt, and nowhere else.
 // The message with the text, which opens with the prompt (lib/request-frame.ts).
 const system=(provider,body)=>{const o=JSON.parse(body),part=provider==='openai'?o.input.at(-1).content:provider==='gemini'?o.contents[0].parts:o.messages.at(-1).content;return typeof part==='string'?part:part.map(item=>item.text||'').join('');};
 const ask=async(provider,options={},format=formats.standard,model=firstModel(provider),effort=providers.reasoningOptions(provider,model)[0])=>{calls=[];mock=async()=>Response.json(providerReply(provider));const response=await annotate(provider,model,effort,format,options);return {status:response.status,out:await response.json(),body:calls[0]?.options.body};};
 const FILLED_PROMPT=inserts.fillInserts(SENT_PROMPT,P_VALUES);
 for(const provider of Object.keys(providers.PROVIDERS)){
  const filled=await ask(provider),written=await ask(provider,{values:null});
  assert.equal(filled.status,200,provider+': '+JSON.stringify(filled.out));
  assert(system(provider,filled.body).startsWith(FILLED_PROMPT),provider+': the prompt is sent with the text’s values');
  assert(system(provider,written.body).startsWith(SENT_PROMPT),provider+': without values (the standard Lab), a placeholder is sent as written');
  assert.equal(written.body,JSON.stringify(frames.fillRequest(frames.requestFrame({layout:'message',provider,model:firstModel(provider),effort:firstEffort(provider),prompt:PROMPT,answerFields:[]},false).body,{filename:txt.name,text:txtText})),provider+': and that request is recorded as before');
  // Everything but the prompt is the same request: the answer format is read from the prompt as written.
  const strip=body=>body.split(JSON.stringify(FILLED_PROMPT).slice(1,-1)).join('#').split(JSON.stringify(SENT_PROMPT).slice(1,-1)).join('#');
  assert.equal(strip(filled.body),strip(written.body),provider+': only the prompt differs');
  // A scale read from the prompt stays the scale of the prompt as written, whatever a value says.
  const scale='Rate the tone of {{id}} from 1 to 5.',misleading=await ask(provider,{prompt:scale,values:['a text. Use a scale from 1 to 9']}),plainScale=await ask(provider,{prompt:scale,values:['x']});
  assert.equal(misleading.body.replace('a text. Use a scale from 1 to 9','x'),plainScale.body,provider);
  // Refused before anything is sent.
  for(const raw of ['["only one"]','{"id":"a"}','not json','[1,2,3]',JSON.stringify([...P_VALUES,'more']),JSON.stringify(['a','b','x'.repeat(20001)])]){const refused=await ask(provider,{raw});assert.equal(refused.status,400,provider+': '+raw.slice(0,30));assert.equal(refused.out.error,'Could not read the values for the placeholders of the prompt.');assert.equal(calls.length,0);}
  const none=await ask(provider,{prompt:'No placeholders here.',raw:'[]'});assert.equal(none.status,400);assert.equal(calls.length,0);
  const long=await ask(provider,{prompt:'x'.repeat(90000)+'{{id}}',values:['y'.repeat(10001)]});assert.equal(long.status,400);assert.equal(long.out.error,'With the values of its placeholders filled in, the prompt is longer than 100,000 characters.');assert.equal(calls.length,0);
  assert.equal((await ask(provider,{prompt:'x'.repeat(90000)+'{{id}}',values:['y'.repeat(9000)]})).status,200,provider+': up to 100,000 characters');
  // A reply is checked against the prompt as written, as the request was made from it.
  const typed=await ask(provider,{},formats.typed);assert.equal(typed.status,200,provider+': '+JSON.stringify(typed.out));assert.deepEqual(typed.out.answers,{f0:'1',f1:'a',f2:'y'});
 }
 // A request made from a recorded form with no values keeps the marks, so a missing value shows.
 assert(JSON.stringify(frames.fillRequest(frames.requestFrame({layout:'message',provider:'anthropic',model:firstModel('anthropic'),effort:firstEffort('anthropic'),prompt:PROMPT,answerFields:[],inserts:true},false).body,{filename:'a.txt',text:'t'})).includes('<<INSERT:meta.year>>'));
 // A prompt without placeholders is recorded the same whether or not the page says they were filled in.
 for(const provider of Object.keys(providers.PROVIDERS))for(const cacheOn of [false,true]){const s={provider,model:marked(provider)||firstModel(provider),effort:providers.reasoningOptions(provider,marked(provider)||firstModel(provider))[0],prompt:'Rate the tone. {{text}} stays.',answerFields:[],requestSettings:cacheOn?{cache:true}:undefined,layout:'message'};assert.equal(frames.requestFrame({...s,inserts:true},false).body,frames.requestFrame(s,false).body,provider);assert.equal(frames.requestFrame({...s,layout:undefined,inserts:true},false).body,frames.requestFrame({...s,layout:undefined},false).body,provider+' (earlier layout)');}

 // --- Prompt caching: the mark stands before the first placeholder, where the texts' prompts part ----------
 const SHARED=SENT_PROMPT.slice(0,inserts.fixedLength(SENT_PROMPT));assert.equal(SHARED,'Classify the tone of ');
 {
  const model=marked('anthropic'),effort=providers.reasoningOptions('anthropic',model)[0],cached=JSON.parse((await ask('anthropic',{cacheOn:true},formats.standard,model,effort)).body),plain=JSON.parse((await ask('anthropic',{},formats.standard,model,effort)).body);
  const parts=cached.messages[0].content,whole=plain.messages[0].content;assert.equal(cached.system,undefined);assert.equal(plain.system,undefined);
  assert.deepEqual(parts.map(part=>Object.keys(part)),[['type','text','cache_control'],['type','text']]);assert.deepEqual(parts[0],{type:'text',text:SHARED,cache_control:{type:'ephemeral'}});
  assert.equal(whole.length,1);assert.equal(parts[0].text+parts[1].text,whole[0].text,'The two parts are the message, whole');
  const inBatch=await batch.buildBatchBody('anthropic',txt,FILLED_PROMPT,model,effort,false,false,[],undefined,{cache:true},SENT_PROMPT);
  assert.deepEqual(inBatch.messages[0].content[0],{type:'text',text:SHARED,cache_control:{type:'ephemeral',ttl:'1h'}});assert.equal(inBatch.messages[0].content.length,2);
 }
 {
  const model=marked('openai'),effort=providers.reasoningOptions('openai',model)[0],cached=JSON.parse((await ask('openai',{cacheOn:true},formats.standard,model,effort)).body),plain=JSON.parse((await ask('openai',{},formats.standard,model,effort)).body);
  assert.equal(cached.instructions,undefined);assert.equal(cached.input.length,1);assert.equal(cached.input[0].role,'user');
  assert.deepEqual(cached.input[0].content[0],{type:'input_text',text:SHARED,prompt_cache_breakpoint:{mode:'explicit'}});assert.deepEqual(Object.keys(cached.input[0].content[1]),['type','text']);
  assert.equal(cached.input[0].content[0].text+cached.input[0].content[1].text,plain.input[0].content[0].text);
 }
 for(const model of providers.PROVIDERS.openrouter.models.filter(id=>requestSettings.cacheSupport('openrouter',id)?.kind==='marked').filter((id,i,all)=>all.findIndex(other=>other.split('/')[0]===id.split('/')[0])===i)){
  const effort=providers.reasoningOptions('openrouter',model)[0],cached=JSON.parse((await ask('openrouter',{cacheOn:true},formats.standard,model,effort)).body),plain=JSON.parse((await ask('openrouter',{},formats.standard,model,effort)).body);
  assert.deepEqual(cached.messages[0].content[0],{type:'text',text:SHARED,...(model.startsWith('anthropic/')?{cache_control:{type:'ephemeral'}}:{prompt_cache_breakpoint:{mode:'explicit'}})},model);
  assert.equal(cached.messages[0].content[0].text+cached.messages[0].content[1].text,plain.messages[0].content,model);
 }
 // A provider that caches by itself gets the prompt as without the option.
 assert.equal((await ask('gemini',{cacheOn:true})).body,(await ask('gemini')).body);
 // A prompt that begins with a placeholder has no part that every text shares: it is sent as without the option.
 for(const provider of ['anthropic','openai','openrouter'])for(const start of ['{{id}} is the text. Rate its tone.','  \n{{meta.year}}: rate the tone of {{id}}.']){
  const model=marked(provider),effort=providers.reasoningOptions(provider,model)[0],values=inserts.promptInserts(start).map(()=>'v');
  const on=await ask(provider,{cacheOn:true,prompt:start,values},formats.standard,model,effort),off=await ask(provider,{prompt:start,values},formats.standard,model,effort);
  assert.equal(on.status,200);assert.equal(on.body,off.body,provider+': '+JSON.stringify(start));
  assert.equal(frames.requestFrame({layout:'message',provider,model,effort,prompt:start,answerFields:[],requestSettings:{cache:true},inserts:true},false).body,frames.requestFrame({layout:'message',provider,model,effort,prompt:start,answerFields:[],inserts:true},false).body);
 }
 // The page then records the request without the option, and says why it cannot be switched on.
 for(const page of ['app/page.tsx','components/model-knowledge.tsx']){
  const text=source(page);
  assert(text.includes('const insertNames=research?promptInserts(prompt):[],placed=research&&placesText(prompt),promptFixed=insertNames.length||placed?fixedLength(prompt,placed):undefined;'),page+': the standard Lab fills in nothing, and places no text');
  assert.equal(text.split("if(placed)form.set('placeText','true');").length-1,2,page+': the place of the text travels with its request, now and in a batch');
  assert(text.includes('promptFixed!==undefined&&!prompt.slice(0,promptFixed).trim()&&!requestSettings?.system?.trim()?{...requestSettings,cache:undefined}:requestSettings'),page+': nothing to cache, unless a system prompt of one’s own');
  assert.equal(text.split("if(insertNames.length)form.set('inserts',").length-1,2,page+': a text’s values travel with its request, now and in a batch');
  assert(text.includes('inserts:insertNames.length>0'),page+': the record says whether placeholders were filled in');
 }
 assert(source('app/page.tsx').includes("research&&insertNotes(prompt,options?options.columns||[]:columns,options?'subject':'text')"),'The lines under the prompt box are research mode’s');
 const anthropicModel=marked('anthropic');
 assert.deepEqual(notes.cacheNote('anthropic',anthropicModel,'{{id}} first.',0),{available:false,text:'The prompt begins with a placeholder, so no part of it is the same for every text. There is nothing to cache.'});
 const partNote=notes.cacheNote('anthropic',anthropicModel,PROMPT,inserts.fixedLength(PROMPT)),wholeNote=notes.cacheNote('anthropic',anthropicModel,PROMPT);
 assert(partNote.available&&/ Only the part before the first placeholder is stored: about [\d,–]+ tokens\./.test(partNote.text),partNote.text);assert(wholeNote.available&&/ This prompt: about [\d,–]+ tokens\./.test(wholeNote.text)&&!wholeNote.text.includes('placeholder'));
 assert.equal(notes.cacheNote('gemini',firstModel('gemini'),'{{id}} first.',0).available,false);

 // --- A batch as the batch handler submits it --------------------------------------------------------------
 const SECOND=['Report “A”.pdf','','Another outlet'];
 for(const provider of ['openai','anthropic','gemini']){
  const model=marked(provider)||firstModel(provider),effort=providers.reasoningOptions(provider,model)[0];
  const submit=async(extra={},files=[txt,pdf])=>{const form=new FormData();
   for(const [k,v]of Object.entries({action:'submit',provider,model,effort,prompt:PROMPT,answerFields:'[]',requestSettings:'{"cache":true}',runId:'lab_test',ids:JSON.stringify(files.map((_,i)=>'lab_test_'+i)),inserts:JSON.stringify([P_VALUES,SECOND]),...extra}))if(v!==null)form.set(k,v);
   for(const file of files)form.append('files',file);
   calls=[];mock=async url=>Response.json(provider==='openai'?(String(url).endsWith('/files')?{id:'file-abc'}:{id:'batch_abc'}):provider==='anthropic'?{id:'msgbatch_abc'}:{name:'batches/abc'});
   const response=await batchRoute.POST(new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+keyOf(provider)},body:form}));
   const payload=calls[0]?.options.body;
   return {status:response.status,out:await response.json(),rows:!payload?[]:provider==='openai'?(await payload.get('file').text()).split('\n').map(line=>JSON.parse(line).body):provider==='anthropic'?JSON.parse(await payload.text()).requests.map(row=>row.params):JSON.parse(await payload.text()).batch.input_config.requests.requests.map(row=>row.request)};};
  const done=await submit();assert.equal(done.status,200,provider+': '+JSON.stringify(done.out));
  const settings={provider,model,effort,prompt:PROMPT,answerFields:[],requestSettings:{cache:true},batch:true,inserts:true,layout:'message'};
  assert.deepEqual(done.rows.map(row=>JSON.stringify(row)),[JSON.stringify(frames.fillRequest(frames.requestFrame(settings,false).body,{filename:txt.name,text:txtText,inserts:MAP})),JSON.stringify(frames.fillRequest(frames.requestFrame(settings,true).body,{filename:pdf.name,file:pdfData,inserts:inserts.insertMap(PROMPT,SECOND)}))],provider+': each request of a batch carries its own text’s values');
  // Without values the batch is the one sent before placeholders existed.
  const bare=await submit({inserts:null});assert.equal(bare.status,200);
  assert.equal(JSON.stringify(bare.rows[0]),JSON.stringify(frames.fillRequest(frames.requestFrame({layout:'message',...settings,inserts:false},false).body,{filename:txt.name,text:txtText})),provider);
  // Several annotations per text: each copy carries the text's values.
  const copies=await submit({copies:'[2,1]',ids:JSON.stringify(['lab_test_0','lab_test_1','lab_test_2'])});assert.equal(copies.status,200,JSON.stringify(copies.out));
  assert.deepEqual(copies.rows.map(row=>JSON.stringify(row)),[done.rows[0],done.rows[0],done.rows[1]].map(row=>JSON.stringify(row)),provider);
  // Refused before a batch is made: values for the wrong number of texts or placeholders.
  for(const raw of [JSON.stringify([P_VALUES]),JSON.stringify([P_VALUES,['one']]),JSON.stringify([P_VALUES,null]),'{}','nothing']){const refused=await submit({inserts:raw});assert.equal(refused.status,400,provider+': '+raw.slice(0,30));assert.equal(refused.out.error,'Could not read the values for the placeholders of the prompt.');assert.equal(calls.length,0);}
  const long=await submit({prompt:'x'.repeat(90000)+'{{id}}',inserts:JSON.stringify([['a'],['y'.repeat(10001)]])});assert.equal(long.status,400);assert.equal(long.out.error,'Report “A”.pdf: with the values of its placeholders filled in, the prompt is longer than 100,000 characters.');assert.equal(calls.length,0);
 }

 // --- The request as the setup panel shows it ----------------------------------------------------------------
 for(const provider of Object.keys(providers.PROVIDERS)){
  const model=marked(provider)||firstModel(provider),effort=providers.reasoningOptions(provider,model)[0],settings={provider,model,effort,prompt:PROMPT,answerFields:[],requestSettings:{cache:true},inserts:true,layout:'message'};
  const shown=view.previewRequest(settings,{filename:txt.name,text:txtText,inserts:MAP});
  assert(shown.message.startsWith(FILLED_PROMPT)&&shown.message.endsWith('\n\n<text>\n'+txtText+'\n</text>'),provider+': the message is shown as one text, with the first text’s values');
  assert.equal(shown.cached,requestSettings.cacheSupport(provider,model)?.kind==='marked',provider);
  assert(view.previewRequest({...settings,inserts:false},{filename:'a.txt',text:'(your text appears here)'}).message.startsWith(SENT_PROMPT),provider+': with no text yet, the placeholders are shown as written');
 }

 // --- The record: a result keeps the values its request was sent with ------------------------------------------
 assert.deepEqual(records.RECORDED_KEYS.filter(key=>key==='inserts'),['inserts']);assert('inserts' in records.NOT_RECORDED&&records.NOT_RECORDED.inserts===undefined);
 const done={id:'d',name:'d.txt',status:'done',runNo:1,provider:'openai',model:'m',effort:'low',prompt:PROMPT,score:'A',explanation:'e',requestId:'q1',inserts:P_VALUES,lab:'2026-11-16 abc1234'};
 const moved=runs.requeue([done],[],new Set(['d'])).docs[0];
 assert.deepEqual(moved.earlier[0].inserts,P_VALUES,'An earlier run’s result keeps its values');assert(!('inserts' in moved));assert(!('inserts' in runs.clearRuns(done)));
 const retried=safety.queueRetries([{id:'t',status:'error',error:'Cut short.',runNo:2,requestId:'q1',inserts:P_VALUES,name:'t.txt'}])[0];
 assert.deepEqual(retried.history[0].inserts,P_VALUES,'A failed attempt keeps the values it was sent with');assert(!('inserts' in retried));
 // Backups: the values travel with each result; a value may be any text.
 const AWKWARD=['password','api_key: sk-none','','{"key":"value"}'],frame=frames.requestFrame({layout:'message',provider:'anthropic',model:anthropicModel,effort:providers.reasoningOptions('anthropic',anthropicModel)[0],prompt:PROMPT,answerFields:[],inserts:true},false);
 const workspace={prompt:PROMPT,requests:[{id:'q1',...frame}],columns:COLUMNS,docs:[{id:'d',name:'d.txt',file:new File(['Text'],'d.txt'),status:'done',score:'A',explanation:'e',runNo:1,requestId:'q1',inserts:AWKWARD.slice(0,3),cells:['1975','The Post','5','body','1974'],history:[{status:'error',error:'Cut short.',requestId:'q1',inserts:AWKWARD.slice(1),runNo:1}]}]};
 const encoded=await backup.encodeStudyBackup({name:'Study',createdAt:new Date().toISOString(),texts:workspace,knowledge:{items:[]}}),restored=backup.decodeStudyBackup(encoded).texts;
 assert.deepEqual(restored.docs[0].inserts,AWKWARD.slice(0,3));assert.deepEqual(restored.docs[0].history[0].inserts,AWKWARD.slice(1));assert.deepEqual(restored.requests,workspace.requests);
 for(const bad of [['a',5],'text',{a:'b'},[null]]){const tampered=JSON.parse(encoded);tampered.workspaces.texts.docs[0].inserts=bad;assert.throws(()=>backup.decodeStudyBackup(JSON.stringify(tampered)),/Invalid texts workspace at docs/);}

 // --- Exports ----------------------------------------------------------------------------------------------
 // A run of three texts and a PDF. After the run, one value was corrected and a column was removed: the logs
 // hold the requests as they were sent; the script takes its values from the corpus as it is now.
 const E_PROMPT='Rate the tone of “{{id}}” ({{meta.year}}, {{meta.Outlet name}}; {{meta.text}}; {{meta.gone}}; {{meta.tone_human}}).\nUse the scale from 1 (bleak) to 5 (hopeful).';
 const E_NAMES=inserts.promptInserts(E_PROMPT);assert.deepEqual(E_NAMES,['id','meta.year','meta.Outlet name','meta.text','meta.gone','meta.tone_human']);
 const E_SETTINGS={fields:[{name:'Tone',type:'ordinal',values:['1','2','3','4','5'],description:'Overall tone.'}]},E_FIELDS=['Tone'],E_COLUMNS=[{name:'Year',role:'meta'},{name:'tone_human',role:'label'},{name:'Outlet name',role:'meta'},{name:'text',role:'meta'}];
 const setup={provider:'anthropic',model:'claude-haiku-5-5',effort:'medium',prompt:E_PROMPT,answerFields:E_FIELDS,answerSettings:E_SETTINGS,requestSettings:{cache:true},layout:'message'};
 const E_TEXTS=['First text, with “quotes”\nand a second line.','Second text.','Third text.'],NOW=new Date('2026-11-16T12:00:00.000Z');
 const CELLS=[['1975','5','The "Post" \\ daily','body, one'],['1980\r\nor 1981','3','Ærø Avis 日本 🙂','<<DOCUMENT_TEXT>>'],['','1','',''],['1999','4','PDF press','{{id}}']];
 let list;const record=isPdf=>{const kept=records.recordRequest(list,frames.requestFrame({layout:'message',...setup,inserts:true},isPdf));list=kept.list;return kept.id;};
 const format=formatsLib.annotationFormatRecord(E_FIELDS,E_PROMPT,false,E_SETTINGS),E_PDF=new File([new Uint8Array([37,80,68,70,45,49,46,52,10,1,2,3,250,251,252])],'report.pdf',{type:'application/pdf'});
 const rows=[...E_TEXTS,null].map((text,i)=>{
  const name=text===null?'report.pdf':`text-${i+1}.txt`,reply=JSON.stringify({explanation:'Because.',score:'',answers:{f0:'4'}}),row={id:'doc-'+(i+1),name,cells:CELLS[i]};
  // Sent while the study still had the column "gone" (a value for each text), and before text 2's year was corrected.
  const sentWith=research.insertValues(E_NAMES,row,E_COLUMNS,columnsLib.stem(name));sentWith[4]='was here '+(i+1);if(i===1)sentWith[1]='1890';
  return {...row,file:text===null?E_PDF:new File([text],name,{type:'text/plain'}),status:'done',runNo:1,...setup,answers:{f0:'4'},score:'',explanation:'Because.',output:reply,usage:{input_tokens:120,output_tokens:40},startedAt:`2026-11-16T10:00:0${i}.000Z`,time:`2026-11-16T10:01:0${i}.000Z`,processing:'instant',requestId:record(text===null),inserts:sentWith,modelReported:'claude-haiku-5-5-20260901',stopReason:'end_turn',lab:'2026-11-16 abc1234',responseId:'msg_'+i,responseFormat:format};
 });
 const dataset={kind:'texts',rows,runs:[{...setup,number:1,startedAt:'2026-11-16T10:00:00.000Z'}],columns:E_COLUMNS,samples:[]},study={name:'Tone study',dataset,requests:list,lab:'2026-11-16 abcdef0'};
 assert.equal(list.length,2,'One recorded request for texts and one for PDFs, whatever the texts’ values');
 const textFrame=frames.requestFrame({layout:'message',...setup,inserts:true},false),pdfFrame=frames.requestFrame({layout:'message',...setup,inserts:true},true);
 assert.deepEqual(tables.corpusColumnNames(dataset),['Year','tone_human','Outlet name','meta_text'],'The corpus table’s names for the study’s columns');assert.deepEqual(tables.corpusColumnNames({...dataset,columns:[]}),[]);
 assert(data.requestParts(textFrame).prompt.startsWith(E_PROMPT.replace('\n','\r\n')),'The prompt of a request is shown with its placeholders, not with marks');
 const pack=await packages.buildSupplementary({study,read:data.documentReader(dataset,file=>file.text()),now:NOW},1,{texts:true,explanations:true,logs:true});
 const corpus=readCsv(await read(pack,'data/corpus.csv'));
 assert.deepEqual(corpus[0],['doc_id','text','n_characters','Year','tone_human','Outlet name','meta_text','file'],'No source: no request named the file, and it only repeats the doc_id');
 // Every label and metadata column unchecked: corpus.csv leaves them all out, even those the placeholders read, and
 // the README names the ones the script needs. Year alone checked: it comes with the values the run sent.
 const unchecked=await packages.buildSupplementary({study,read:data.documentReader(dataset,file=>file.text()),now:NOW},1,{texts:true,explanations:true,logs:false,columns:[]});
 const bare=readCsv(await read(unchecked,'data/corpus.csv'));
 assert.deepEqual(bare[0],['doc_id','text','n_characters','file'],'A left-out column stays out of corpus.csv');
 assert.match(await read(unchecked,'README.md'),/leaves out the columns `Year`, `Outlet name`, and `meta_text`, which the prompt’s placeholders take their values from; add them to the file to run the script/);
 const yearOnly=readCsv(await read(await packages.buildSupplementary({study,read:data.documentReader(dataset,file=>file.text()),now:NOW},1,{texts:true,explanations:true,logs:false,columns:['Year']}),'data/corpus.csv'));
 assert.deepEqual(yearOnly[0],['doc_id','text','n_characters','Year','file']);assert.equal(yearOnly[2][3],'1890','Text 2: the year the run sent');
 assert(!(await read(unchecked,'results/results.csv')).includes('tone_human'),'Nor in results.csv');
 // The logs: each request as it was sent, with the values kept with its result.
 const logged=jsonLines(await read(pack,'logs/requests.jsonl'));assert.equal(logged.length,4);
 for(const [i,text] of E_TEXTS.entries())assert.equal(JSON.stringify(logged[i].request),JSON.stringify(frames.fillRequest(textFrame.body,{filename:rows[i].name,text,inserts:inserts.insertMap(E_PROMPT,rows[i].inserts)})),'Logged as sent: text '+(i+1));
 assert(JSON.stringify(logged[1].request).includes('1890')&&JSON.stringify(logged[0].request).includes('was here 1'),'A value changed or removed after the run is still in the log');
 assert(JSON.stringify(logged[3].request).includes('PDF press')&&!JSON.stringify(logged).includes('<<INSERT:'),'No mark is left in a logged request');
 assert.equal(logged[0].request.system,undefined);assert.deepEqual(logged[0].request.messages[0].content.map(part=>Object.keys(part)),[['type','text','cache_control'],['type','text']]);assert.equal(logged[0].request.messages[0].content[0].text,'Rate the tone of “');
 // The prompt files and the record of the run.
 assert.equal(await read(pack,'prompt/prompt.txt'),E_PROMPT);
 const asSent=await read(pack,'prompt/prompt_as_sent.txt');assert(asSent.startsWith(E_PROMPT.replace('\n','\r\n'))&&!asSent.includes('<<INSERT:')&&!asSent.includes('<text>')&&!asSent.includes('DOCUMENT'),'The prompt as sent shows the placeholders where each request had the values');
 assert((await read(pack,'metadata.json')).includes('<<INSERT:meta.year>>'),'The recorded request bodies keep their marks');
 const readme=await read(pack,'README.md');
 for(const part of ['| `prompt/prompt.txt` | The annotation prompt as written. Its placeholders were filled in for each text: `{{id}}` with the text’s doc_id; `{{meta.year}}`, `{{meta.Outlet name}}`, `{{meta.text}}`, and `{{meta.gone}}` with its values in those metadata columns; `{{meta.tone_human}}` was filled in empty for every text (it names no metadata column, or an empty one) |','(marks stand for the document and for the values of the prompt’s placeholders)','; the placeholders stand where each request had the values','The script fills in the prompt’s placeholders from the corpus file, which holds the values this run sent, so a value changed there gives another request than the run sent (the logs hold the requests as they were sent).'])assert(readme.includes(part),'README: '+part);
 assert(!readme.includes('the prompt was completed with'),'No draft methods text in the README');
 // Without the texts, the README names the columns a corpus of one's own needs.
 const lean=await packages.buildSupplementary({study,read:data.documentReader(dataset,file=>file.text()),now:NOW},1,{texts:false,explanations:false,logs:false});
 assert((await read(lean,'README.md')).includes('and the columns the prompt’s placeholders take their values from (doc_id, Year, Outlet name, meta_text). The script fills in the prompt’s placeholders from the corpus file, which holds the values this run sent, so a value changed there gives another request than the run sent. '));
 // A study without placeholders says nothing of them.
 const bareSetup={...setup,prompt:'Rate the tone from 1 to 5.'},bareFrame=records.recordRequest(undefined,frames.requestFrame(bareSetup,false));
 const bareStudy={name:'Plain',lab:study.lab,requests:bareFrame.list,dataset:{...dataset,rows:rows.slice(0,3).map(row=>{const {inserts:_,...rest}=row;return {...rest,...bareSetup,requestId:bareFrame.id,responseFormat:formatsLib.annotationFormatRecord(E_FIELDS,bareSetup.prompt,false,E_SETTINGS)};}),runs:[{...bareSetup,number:1,startedAt:'2026-11-16T10:00:00.000Z'}]}};
 const barePack=await packages.buildSupplementary({study:bareStudy,read:data.documentReader(bareStudy.dataset,file=>file.text()),now:NOW},1,{texts:true,explanations:true,logs:true}),bareReadme=await read(barePack,'README.md');
 assert(!/placeholder|completed with/.test(bareReadme),'README of a study without placeholders');assert((await read(barePack,'scripts/annotate.py')).includes('\nINSERTS = {}\n'));
 const repository=await packages.buildResearchRepository({study,read:data.documentReader(dataset,file=>file.text()),now:NOW,backup:async()=>'{}'},{logs:true}),repositoryReadme=await read(repository,'README.md');
 assert(repositoryReadme.includes('(marks stand for the document and for the values of a prompt’s placeholders)')&&repositoryReadme.includes('placeholders that were filled in for each text stand as written'));
 assert.deepEqual(jsonLines(await read(repository,'runs/run-01/requests.jsonl')).slice(0,3).map(line=>JSON.stringify(line.request)),logged.slice(0,3).map(line=>JSON.stringify(line.request)),'Both repositories log the same requests');
 // No value is a credential, and none is written anywhere it does not belong.
 for(const file of [...pack.files,...repository.files])assert(!/sk-[A-Za-z0-9]{8}|Bearer [A-Za-z0-9]{8}/.test(await textOf(file.data)),'No credential in '+file.path);

 // The script: where the corpus holds each placeholder's values.
 const script=await read(pack,'scripts/annotate.py');
 // A run made before {{id}} was the doc_id filled in the name as it was: the script reads it from source.
 const byName={...study,dataset:{...dataset,rows:rows.map(row=>({...row,inserts:[row.name,...row.inserts.slice(1)]}))}};
 const oldPack=await packages.buildSupplementary({study:byName,read:data.documentReader(byName.dataset,file=>file.text()),now:NOW},1,{texts:true,explanations:true,logs:true});
 assert((await read(oldPack,'scripts/annotate.py')).includes('\n    "id": "source",\n')&&(await read(oldPack,'README.md')).includes('`{{id}}` with the text’s name;'),'An earlier run’s {{id}} is read from source');
 assert.deepEqual(JSON.parse(python.scriptValues({lab:'x',studyName:'s',runDescription:'r',provider:'anthropic',text:textFrame,fields:E_FIELDS,plain:false,inserts:[['id','document'],['meta.gone',null]]}).INSERTS.replace(/,\n\}/,'\n}').replace('None','null')),{id:'document','meta.gone':null});
 assert.equal(python.scriptValues({lab:'x',studyName:'s',runDescription:'r',provider:'anthropic',text:textFrame,fields:E_FIELDS,plain:false}).INSERTS,'{}');
 for(const line of ['"id": "doc_id",','"meta.year": "Year",','"meta.Outlet name": "Outlet name",','"meta.text": "meta_text",','"meta.gone": None,','"meta.tone_human": None,'])assert(script.includes('\n    '+line+'\n'),'annotate.py: '+line);
 if(spawnSync('python3',['--version']).status!==0){console.log('prompt-inserts: python3 is not installed; the script itself was not run.');}
 else{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lab-inserts-')),run=(args,env={})=>new Promise(resolve=>execFile('python3',args,{cwd:folder,env:{...process.env,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',...env},encoding:'utf8'},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,stdout,stderr})));
  const received=[],reply={openai:{id:'resp_1',status:'completed',model:'gpt-6-luna-2026-10-01',output:[{type:'message',content:[{type:'output_text',text:'{"explanation":"x","score":"","answers":{"f0":"4"}}'}]}],usage:{input_tokens:10,output_tokens:5}},
   anthropic:{id:'msg_1',model:'claude-haiku-5-5-20260901',stop_reason:'end_turn',content:[{type:'text',text:'{"explanation":"x","score":"","answers":{"f0":"4"}}'}],usage:{input_tokens:10,output_tokens:5}},
   gemini:{responseId:'r1',modelVersion:'gemini-4-hydrogen-001',candidates:[{finishReason:'STOP',content:{parts:[{text:'{"explanation":"x","score":"","answers":{"f0":"4"}}'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:3}},
   openrouter:{id:'gen-1',model:'openai/gpt-6-luna',provider:'OpenAI',choices:[{finish_reason:'stop',message:{content:'{"explanation":"x","score":"","answers":{"f0":"4"}}'}}],usage:{prompt_tokens:10,completion_tokens:5}}};
  let current='anthropic';
  const server=http.createServer((request,response)=>{const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{received.push(Buffer.concat(chunks).toString('utf8'));response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(reply[current]));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const base='http://127.0.0.1:'+server.address().port,KEY='sk-test-0123456789abcdef';
   // The package as exported: the script fills in each request from the corpus beside it.
   for(const file of pack.files){const target=path.join(folder,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.data instanceof Blob?Buffer.from(await file.data.arrayBuffer()):file.data);}
   const home=path.join(pack.name,'scripts'),sent=await run([path.join(home,'annotate.py'),path.join(pack.name,'data','corpus.csv'),'--base-url',base,'--out','out.csv','--log','out.jsonl'],{ANTHROPIC_API_KEY:KEY});
   assert.equal(sent.code,0,sent.stderr);assert.equal(received.length,4);
   // Byte for byte the request the run sent: the corpus holds the values the run sent (text 2's year as it was
   // then), and a column the study no longer has is filled in empty.
   const now=i=>{const values=[...rows[i].inserts];values[4]='';return inserts.insertMap(E_PROMPT,values);};
   for(const [i,text] of E_TEXTS.entries())assert.equal(received[i],JSON.stringify(frames.fillRequest(textFrame.body,{filename:rows[i].name,text,inserts:now(i)})),'The script’s request for text '+(i+1));
   assert.equal(received[3],JSON.stringify(frames.fillRequest(pdfFrame.body,{filename:'report.pdf',file:Buffer.from(await E_PDF.arrayBuffer()).toString('base64'),inserts:now(3)})),'The script’s request for the PDF');
   // Where nothing changed since the run, that is the request the run sent; a column the study no longer has is filled in empty.
   assert.equal(received[2].split('was here 3').length,1);assert.equal(received[2],JSON.stringify(logged[2].request).replace('was here 3',''),'Text 3: the logged request, but for the removed column');
   // The script reads a reply as the Lab does: a blank explanation fails.
   const parsed=await run(['-c','import importlib.util,json,sys;s=importlib.util.spec_from_file_location("a",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps([m.parse_answer(t)[1] for t in sys.argv[2:]]))',path.join(folder,home,'annotate.py'),'{"explanation":"","score":"","answers":{"f0":"4"}}','{"explanation":"  ","score":"","answers":{"f0":"4"}}','{"explanation":"Because.","score":"","answers":{"f0":"4"}}']);
   assert.equal(parsed.code,0,parsed.stderr);assert.deepEqual(JSON.parse(parsed.stdout),['The reply is missing its explanation','The reply is missing its explanation','']);
   assert(received[1].includes('1890')&&!received[1].includes('1980\\r\\nor 1981'),'Text 2: the value the run sent, not the corrected one');
   // Every provider's request, with and without the cache mark, from a corpus with awkward values.
   const TEXT='A text with “quotes”, a "double quote", a back\\slash,\r\nline breaks, and the marks <<DOCUMENT_TEXT>> and <<INSERT:id>> themselves.';
   fs.writeFileSync(path.join(folder,'report.pdf'),Buffer.from(await E_PDF.arrayBuffer()));
   const awkward=[['näme “1”.txt','1975\r\nor "1976"','The \\ Post, <<DOCUMENT_TEXT>> {{id}} <<INSERT:meta.year>>'],['report.pdf','','æøå 日本 🙂']];
   fs.writeFileSync(path.join(folder,'corpus.csv'),toCsv([['doc_id','text','source','file','Year','Outlet'],['d1',TEXT,awkward[0][0],'',awkward[0][1],awkward[0][2]],['d2','',awkward[1][0],'report.pdf',awkward[1][1],awkward[1][2]]]));
   const models={openai:marked('openai'),anthropic:marked('anthropic'),gemini:firstModel('gemini'),openrouter:marked('openrouter')};
   for(const provider of Object.keys(models))for(const cacheOn of [false,true]){
    const settings={provider,model:models[provider],effort:providers.reasoningOptions(provider,models[provider])[0],prompt:PROMPT,answerFields:E_FIELDS,answerSettings:E_SETTINGS,requestSettings:cacheOn?{cache:true}:undefined,inserts:true,layout:'message'},text=frames.requestFrame(settings,false),pdfBody=frames.requestFrame(settings,true);
    fs.writeFileSync(path.join(folder,provider+'.py'),python.fillScript(python.SCRIPT_TEMPLATE,python.scriptValues({lab:'test',studyName:'Tone',runDescription:'#1',provider,text,pdf:pdfBody,fields:E_FIELDS,plain:false,inserts:[['id','source'],['meta.year','Year'],['meta.Outlet name','Outlet']]})));
    received.length=0;current=provider;
    const done=await run([provider+'.py','corpus.csv','--base-url',base,'--out',provider+'.csv','--log',provider+'.jsonl'],{[python.keyVariable(provider)]:KEY});
    assert.equal(done.code,0,provider+': '+done.stderr);assert.equal(received.length,2,provider);
    assert.equal(received[0],JSON.stringify(frames.fillRequest(text.body,{filename:awkward[0][0],text:TEXT,inserts:inserts.insertMap(PROMPT,awkward[0])})),provider+(cacheOn?' (cache)':'')+': a text');
    assert.equal(received[1],JSON.stringify(frames.fillRequest(pdfBody.body,{filename:'report.pdf',file:Buffer.from(await E_PDF.arrayBuffer()).toString('base64'),inserts:inserts.insertMap(PROMPT,awkward[1])})),provider+(cacheOn?' (cache)':'')+': a PDF');
   }
   // A corpus without a column the prompt takes values from is refused before anything is sent.
   fs.writeFileSync(path.join(folder,'short.csv'),toCsv([['doc_id','text','source','Year'],['d1','Text.','a','1975']]));received.length=0;
   const refused=await run(['anthropic.py','short.csv','--base-url',base],{ANTHROPIC_API_KEY:KEY});
   assert.notEqual(refused.code,0);assert.match(refused.stderr,/The prompt inserts values from columns that were not found: Outlet\./);assert.equal(received.length,0);
  }finally{server.close();fs.rmSync(folder,{recursive:true,force:true});}
 }
 console.log(`PASS: research mode’s prompt placeholders: what counts as one, a text’s values, ${compared} requests equal their recorded form filled with the document and the values (every provider and model, now and in a batch), the cache mark before the first placeholder, the record, backups, and the exports with the Python script. No provider was called.`);
})().catch(error=>{console.error(error);process.exit(1);});
