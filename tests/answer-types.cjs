// Research mode's typed answer fields: what is stored, what is sent to each
// provider, what is refused, and that a study without them is unaffected.
// All provider traffic is mocked. No paid requests or real keys are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
let calls=[],mock=async()=>Response.json({});
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}

(async()=>{
 const types=load('lib/answer-types.ts'),fields=load('lib/answer-fields.ts'),validation=load('lib/answer-validation.ts'),route=load('app/api/annotate/route.ts'),batchRoute=load('app/api/batch/route.ts'),batch=load('lib/batch-provider.ts'),providers=load('lib/providers.ts'),runs=load('lib/research/runs.ts');

 // --- What a field allows ---------------------------------------------------------------
 assert.deepEqual(types.allowedValues({type:'ordinal',values:['−3','-2',' 0 ','1.5','x','0','3']}),['-3','-2','0','3'],'A scale keeps its whole numbers, once each; a typed minus sign is read as a minus');
 assert.deepEqual(types.allowedValues({type:'category',values:[' Positive ','positive','Neutral','']}),['Positive','Neutral']);
 assert.deepEqual(types.allowedValues({type:'boolean',values:['maybe']}),['yes','no']);assert.deepEqual(types.allowedValues({type:'number',values:['1']}),[]);assert.deepEqual(types.allowedValues({type:'text',values:['1']}),[]);
 assert.equal(types.MAX_ANSWER_FIELDS,40);assert(fields.validAnswerFields(Array.from({length:40},(_,i)=>'f'+i)));assert(!fields.validAnswerFields(Array.from({length:41},(_,i)=>'f'+i)));

 // --- What is stored and what is sent ---------------------------------------------------
 const tone={name:'Tone',type:'category',values:['positive','neutral','negative'],description:'Overall tone of the text.'},intensity={name:'Intensity',type:'ordinal',values:['0','1','2','3'],description:''},sarcasm={name:'Sarcasm',type:'boolean',values:[],description:''},count={name:'Count',type:'number',values:[],description:''},notes={name:'Notes',type:'text',values:[],description:'One sentence.'};
 const names=['Tone','Intensity','Sarcasm','Count','Notes'],editor={rationale:false,fields:[tone,intensity,sarcasm,count,notes]};
 // No settings: nothing is added, so the standard Lab's requests and records stay as they were.
 assert.deepEqual(types.sentAnswers(['Tone'],undefined),{names:['Tone'],settings:undefined});assert.deepEqual(types.sentAnswers([],undefined),{names:[],settings:undefined});
 assert.equal(types.sentAnswers(['Tone'],{fields:[{name:'Tone',type:'text',values:[],description:'  '}]}).settings,undefined,'Free text without a description is the standard field');
 assert.equal(types.sentAnswers(['Tone'],{fields:[{name:'Gone',type:'category',values:['a','b'],description:''}]}).settings,undefined,'Settings of a field that no longer exists are not sent');
 const sent=types.sentAnswers(names,{rationale:false,fields:[{...tone,name:'tone',values:[' positive','neutral','negative','Neutral'],description:' Overall tone of the text. '},{...intensity,values:['0','1','2','3','2.5']},{...sarcasm,values:['ignored']},count,notes]});
 assert.deepEqual(sent,{names,settings:{rationale:false,fields:[tone,intensity,{...sarcasm,values:['yes','no']},count,notes]}},'Values are trimmed and listed once; a field takes the spelling of its name');
 assert.deepEqual(types.sentAnswers(names,{plain:true,rationale:false,fields:[tone]}),{names:['response'],settings:{plain:true}},'Plain text keeps the whole reply as one field');
 assert.deepEqual(types.sentAnswers(names,{rationale:false}).settings,{rationale:false});
 // Settings as read from storage: unreadable parts are dropped, never guessed.
 assert.deepEqual(types.cleanAnswerSettings({plain:'yes',rationale:false,fields:[tone,{name:'x',type:'scale',values:[],description:''},{name:'',type:'text',values:[],description:''},null]}),{rationale:false,fields:[tone]});
 assert.equal(types.cleanAnswerSettings({}),undefined);assert.equal(types.cleanAnswerSettings([tone]),undefined);assert.equal(types.cleanAnswerSettings('plain'),undefined);
 // A request's settings must already be in the sent form; anything else is refused.
 assert.equal(types.readAnswerSettings(null,names),undefined);assert.deepEqual(types.readAnswerSettings(JSON.stringify(sent.settings),names),sent.settings);
 for(const bad of ['{',JSON.stringify({fields:[{name:'Tone',type:'text',values:[],description:''}]}),JSON.stringify({fields:[{...intensity,values:['0','0','x']}]}),JSON.stringify({fields:[{...tone,name:'Other'}]}),JSON.stringify({plain:true}),JSON.stringify({rationale:true}),JSON.stringify({})])assert.throws(()=>types.readAnswerSettings(bad,names),/answer format/,bad);
 assert.deepEqual(types.readAnswerSettings(JSON.stringify({plain:true}),['response']),{plain:true});
 // The format in words, for the list of runs and for the exported record.
 assert.equal(types.answersLabel([],undefined),'Score / category');assert.equal(types.answersLabel(['Tone','Notes'],undefined),'Tone, Notes');assert.equal(types.answersLabel(['response'],{plain:true}),'Plain text');
 assert.equal(types.answersLabel(names,sent.settings),'Tone (category: positive, neutral, negative), Intensity (ordinal scale: 0, 1, 2, 3), Sarcasm (yes / no), Count (number), Notes (free text) · no explanation');
 assert.equal(types.answersLabel(['Tone'],{fields:[{...tone,values:Array.from({length:12},(_,i)=>'c'+i)}]}),'Tone (category: c0, c1, c2, c3, c4, c5, c6, c7, …)');
 assert.equal(types.answersLabel(['Tone','Free'],{rationale:false,fields:[tone]},true),'Tone (category: positive, neutral, negative; description: Overall tone of the text.) | Free | no explanation requested');

 // --- Checking an answer against its field ----------------------------------------------
 const fits=(spec,value,knowledge)=>types.typedProblem(spec,value,knowledge)===undefined;
 assert(fits(tone,'Neutral'));assert(!fits(tone,'mixed'));assert(fits(intensity,'3'));assert(!fits(intensity,'4'));assert(!fits(intensity,'2.5'));assert(!fits(intensity,'high'));
 assert(fits({...sarcasm,values:['yes','no']},'no'));assert(!fits({...sarcasm,values:['yes','no']},'true'));assert(fits(count,'2.5'));assert(fits(count,'−4'));assert(!fits(count,'about 3'));assert(fits(notes,'Anything at all.'));
 assert(fits({...intensity,values:[]},'17'),'A scale without listed values takes any whole number');assert(!fits({...intensity,values:[]},'1.5'));assert(fits({...tone,values:[]},'anything'));
 assert(!fits(intensity,'INSUFFICIENT_KNOWLEDGE'));assert(fits(intensity,'INSUFFICIENT_KNOWLEDGE',true),'Model knowledge may always abstain');assert.match(types.typedProblem(intensity,'9',true),/one of 0, 1, 2, 3, or INSUFFICIENT_KNOWLEDGE/);
 const result=(answers,explanation='')=>({score:'',explanation,answers});
 const good={f0:'positive',f1:'2',f2:'yes',f3:'2.5',f4:'Dry in tone.'};
 assert.equal(validation.annotationValidationError(result(good),names,'Prompt',false,sent.settings),undefined,'No explanation is required when none was asked for');
 assert.match(validation.annotationValidationError(result(good),names,'Prompt',false,{fields:sent.settings.fields}),/missing its explanation/);
 assert.match(validation.annotationValidationError(result({...good,f1:'5'}),names,'Prompt',false,sent.settings),/Invalid answer for “Intensity”: "5"\. Expected one of 0, 1, 2, 3\. The response is kept for review; no retry was sent\./);
 assert.match(validation.annotationValidationError(result({...good,f3:'several'}),names,'Prompt',false,sent.settings),/“Count”.*Expected a number/);
 assert.match(validation.annotationValidationError(result({...good,f0:''}),names,'Prompt',false,sent.settings),/“Tone” is missing/);
 // A typed field is judged by its type, never by a scale read from the prompt's wording.
 assert.equal(validation.annotationValidationError(result({f0:'9'},'Why.'),['Intensity'],'Intensity: integer from 0 to 3.',false,{fields:[{...intensity,values:['7','8','9']}]}),undefined);
 assert.equal(validation.annotationValidationError({score:'',explanation:'',answers:{f0:'Free prose.'}},['response'],'Prompt',false,{plain:true}),undefined);assert.match(validation.annotationValidationError({score:'',explanation:'',answers:{f0:'  '}},['response'],'Prompt',false,{plain:true}),/reply is empty/);
 const stored={status:'done',prompt:'Prompt',score:'',explanation:'',answerFields:names,answerSettings:sent.settings,answers:good};
 assert.equal(validation.reviewStoredAnswer(stored),stored);assert.equal(validation.reviewStoredAnswer({...stored,answers:{...good,f2:'maybe'}}).status,'error','A stored answer is rechecked against the fields it was made with');

 // --- What each provider receives -------------------------------------------------------
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:[providers.defaultModel('openrouter'),'medium']};
 const reply=(provider,text)=>provider==='openai'?{status:'completed',id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text}]}]}:provider==='anthropic'?{stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2},content:[{type:'text',text}]}:provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{totalTokenCount:12}}:{id:'test-response',choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}};
 const schemaOf=(provider,body)=>provider==='openai'?body.text?.format?.schema:provider==='anthropic'?body.output_config?.format?.schema:provider==='gemini'?body.generationConfig?.responseSchema:body.response_format?.json_schema?.schema;
 const instructionsOf=(provider,body)=>provider==='openai'?body.instructions:provider==='anthropic'?body.system:provider==='gemini'?body.systemInstruction.parts[0].text:body.messages[0].content;
 const PROMPT='Classify the tone of the text.';
 function request(provider,answerFields,answerSettings,knowledge=false){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model:models[provider][0],effort:models[provider][1],prompt:PROMPT,answerFields:JSON.stringify(answerFields)}))form.set(k,v);
  if(answerSettings!==undefined)form.set('answerSettings',typeof answerSettings==='string'?answerSettings:JSON.stringify(answerSettings));
  if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify([{heading:'Film',value:'Jaws'}]));}else form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 for(const provider of Object.keys(models)){
  // Typed fields: every provider gets the allowed values as the schema's own, and the description.
  calls=[];mock=async()=>Response.json(reply(provider,JSON.stringify(result(good))));
  let response=await route.POST(request(provider,sent.names,sent.settings)),out=await response.json();
  assert.equal(response.status,200,provider+': '+out.error);assert.deepEqual(out.answers,good);assert.equal(calls.length,1);
  let body=JSON.parse(calls[0].options.body),schema=schemaOf(provider,body),props=schema.properties.answers.properties;
  assert.deepEqual(props.f0.enum,['positive','neutral','negative'],provider);assert.deepEqual(props.f1.enum,['0','1','2','3']);assert.deepEqual(props.f2.enum,['yes','no']);assert.equal(props.f3.enum,undefined);assert.equal(props.f4.enum,undefined);
  assert.match(props.f0.description,/^Answer for Tone: one of the allowed categories\. Overall tone of the text\.$/);assert.match(props.f3.description,/a number written in digits/);assert.match(props.f4.description,/free text\. One sentence\.$/);
  assert.deepEqual(schema.properties.explanation.enum,[''],'No explanation asked for: the schema leaves no room for one');assert.match(instructionsOf(provider,body),/No explanation is requested/);
  assert.deepEqual(Object.keys(props),['f0','f1','f2','f3','f4'],'The model writes the fields in the order they are listed');
  assert.deepEqual(JSON.parse(out.responseFormat).schema.properties.answers.properties.f1.enum,['0','1','2','3'],'The result records the format it was made with');
  // A value the field does not allow is refused and kept for review.
  mock=async()=>Response.json(reply(provider,JSON.stringify(result({...good,f1:'5'}))));
  response=await route.POST(request(provider,sent.names,sent.settings));out=await response.json();
  assert.equal(response.status,422);assert.match(out.error,/Invalid answer for “Intensity”: "5"\. Expected one of 0, 1, 2, 3/);assert(out.rawResponse,'The refused response is kept');
  // Model knowledge: the allowed values gain the abstention, and it is accepted.
  calls=[];mock=async()=>Response.json(reply(provider,JSON.stringify(result({...good,f1:'INSUFFICIENT_KNOWLEDGE'}))));
  response=await route.POST(request(provider,sent.names,sent.settings,true));out=await response.json();
  assert.equal(response.status,200,provider+' knowledge: '+out.error);body=JSON.parse(calls[0].options.body);
  assert.deepEqual(schemaOf(provider,body).properties.answers.properties.f1.enum,['0','1','2','3','INSUFFICIENT_KNOWLEDGE']);assert.equal(schemaOf(provider,body).properties.answers.properties.f3.enum,undefined);
  // With an explanation (the default), the standard explanation is asked for.
  calls=[];mock=async()=>Response.json(reply(provider,JSON.stringify(result({f0:'neutral'},'Balanced wording.'))));
  response=await route.POST(request(provider,['Tone'],{fields:[tone]}));out=await response.json();
  assert.equal(response.status,200,provider+': '+out.error);assert.equal(out.explanation,'Balanced wording.');assert.equal(schemaOf(provider,JSON.parse(calls[0].options.body)).properties.explanation.enum,undefined);
  // Plain text: no format is sent, nothing is added to the prompt, and the whole reply is the answer.
  calls=[];mock=async()=>Response.json(reply(provider,'  The tone is hopeful.\nSecond line.  '));
  response=await route.POST(request(provider,['response'],{plain:true}));out=await response.json();
  assert.equal(response.status,200,provider+' plain: '+out.error);assert.deepEqual(out.answers,{f0:'The tone is hopeful.\nSecond line.'});assert.equal(out.score,'');assert.equal(out.explanation,'');
  assert.deepEqual(JSON.parse(out.responseFormat),{instructions:'',schema:null},'A plain-text result records that no format was sent');
  body=JSON.parse(calls[0].options.body);assert.equal(schemaOf(provider,body),undefined,provider+': no schema in plain text');assert.equal(instructionsOf(provider,body),PROMPT,provider+': the prompt is sent as written');
  assert(!/json_schema|responseSchema|responseMimeType|response_format/.test(calls[0].options.body),provider+': no answer format of any kind');
  mock=async()=>Response.json(reply(provider,'   '));response=await route.POST(request(provider,['response'],{plain:true}));assert.equal(response.status,422,'An empty reply is a failed result');
  // A reply that is one JSON object is stored whole, as written. JSON among other words is a failed result that keeps the reply.
  const whole='```json\n{"tone":{"score":2,"explanation":"Hopeful."}}\n```';
  mock=async()=>Response.json(reply(provider,whole));response=await route.POST(request(provider,['response'],{plain:true}));out=await response.json();
  assert.equal(response.status,200,provider+' JSON reply: '+out.error);assert.deepEqual(out.answers,{f0:whole});assert.equal(out.rawResponse,undefined);
  mock=async()=>Response.json(reply(provider,'Here is my answer: {"tone": 2}'));response=await route.POST(request(provider,['response'],{plain:true}));out=await response.json();
  assert.equal(response.status,422,provider+': JSON among other words is a failed result');assert.equal(out.error,validation.UNREADABLE_JSON);assert.equal(out.rawResponse,'Here is my answer: {"tone": 2}','The reply is kept for review');
  // With answer fields, a free-text answer that quotes JSON is an answer like any other.
  mock=async()=>Response.json(reply(provider,JSON.stringify(result({f0:'neutral'},'It says {"tone": 2} in passing.'))));response=await route.POST(request(provider,['Tone'],{fields:[tone]}));assert.equal(response.status,200);
  // Settings that are not in the sent form never reach a provider.
  calls=[];for(const bad of [{plain:true,fields:[tone]},{fields:[{...tone,values:['a','a']}]},'{'])assert.equal((await route.POST(request(provider,['Tone'],bad))).status,400);
  assert.equal((await route.POST(request(provider,['Tone'],{plain:true}))).status,400,'Plain text names its one field “response”');assert.equal(calls.length,0);
  // Batches build the same requests and read plain replies the same way.
  if(provider!=='openrouter'){
   const typed=JSON.stringify(await batch.buildBatchBody(provider,new File(['Text'],'text.txt'),PROMPT,...models[provider],false,false,sent.names,sent.settings));
   assert(typed.includes('"enum":["0","1","2","3"]'),provider+' batch');assert(typed.includes('Overall tone of the text.'));
   const plainBody=JSON.stringify(await batch.buildBatchBody(provider,new File(['Text'],'text.txt'),PROMPT,...models[provider],false,false,['response'],{plain:true}));
   assert(!/json_schema|responseSchema|responseMimeType|Lab response format/.test(plainBody),provider+' batch: plain text sends no format');
   assert.deepEqual(batch.parseBatchAnnotation(provider,reply(provider,' Prose reply. '),true).answers,{f0:'Prose reply.'});assert(batch.parseBatchAnnotation(provider,reply(provider,' '),true).error);
   assert(batch.parseBatchAnnotation(provider,reply(provider,'Prose reply.')).error,'Without the plain setting, prose is not an annotation');
   assert.deepEqual(batch.parseBatchAnnotation(provider,reply(provider,JSON.stringify(result(good)))).answers,good);
  }
 }
 // A whole batch in plain text, through the same route the page uses.
 const batchRequest=(provider,action,extra={})=>{const f=new FormData();for(const [k,v]of Object.entries({provider,action,model:models[provider][0],effort:models[provider][1],prompt:PROMPT,runId:'lab_test',ids:JSON.stringify(['lab_test_0']),...extra}))f.set(k,v);if(action==='submit')f.append('files',new File(['one'],'one.txt'));return new Request('https://lab.test/api/batch',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openai'?'sk-test':'provider-test')},body:f});};
 for(const provider of ['openai','anthropic','gemini']){
  calls=[];mock=async url=>Response.json(url.endsWith('/files')?{id:'file-test'}:provider==='openai'?{id:'batch_test'}:provider==='anthropic'?{id:'msgbatch_test'}:{name:'batches/test'});
  const submitted=await batchRoute.POST(batchRequest(provider,'submit',{answerFields:JSON.stringify(['response']),answerSettings:JSON.stringify({plain:true})}));assert.equal(submitted.status,200,provider);const id=(await submitted.json()).id;
  const uploaded=provider==='openai'?await calls[0].options.body.get('file').text():calls.at(-1).options.body instanceof Blob?await calls.at(-1).options.body.text():calls.at(-1).options.body;
  assert(!/json_schema|responseSchema|responseMimeType|Lab response format/.test(uploaded),provider+': a plain-text batch carries no format');
  assert.equal((await batchRoute.POST(batchRequest(provider,'submit',{answerFields:JSON.stringify(['Tone']),answerSettings:JSON.stringify({plain:true})}))).status,400);
  mock=async url=>{
   if(url.endsWith('/content'))return new Response(JSON.stringify({custom_id:'lab_test_0',response:{status_code:200,body:reply(provider,'Prose from a batch.')}}));
   if(url.endsWith('/results'))return new Response(JSON.stringify({custom_id:'lab_test_0',result:{type:'succeeded',message:reply(provider,'Prose from a batch.')}}));
   return Response.json(provider==='openai'?{status:'completed',output_file_id:'file-results',request_counts:{completed:1,failed:0,total:1}}:provider==='anthropic'?{processing_status:'ended',request_counts:{succeeded:1}}:{done:true,metadata:{state:'BATCH_STATE_SUCCEEDED'},response:{inlinedResponses:{inlinedResponses:[{metadata:{key:'lab_test_0'},response:reply(provider,'Prose from a batch.')}]}}});
  };
  const collected=await (await batchRoute.POST(batchRequest(provider,'collect',{id,plain:'true'}))).json();assert.deepEqual(collected.results[0].answers,{f0:'Prose from a batch.'},provider);assert.equal(collected.results[0].error,undefined);
  const asJson=await (await batchRoute.POST(batchRequest(provider,'collect',{id}))).json();assert(asJson.results[0].error,provider+': the same reply is no annotation when fields were asked for');
 }

 // --- Runs: a changed answer format is a changed setup ----------------------------------
 const setup={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'P',answerFields:['Tone']},typedSetup={...setup,answerSettings:{fields:[tone]}};
 assert(runs.sameSetup(setup,{...setup}));assert(runs.sameSetup(typedSetup,{...typedSetup,answerSettings:{fields:[{...tone}]}}));assert(!runs.sameSetup(setup,typedSetup));assert(!runs.sameSetup(typedSetup,{...typedSetup,answerSettings:{fields:[{...tone,values:['positive','negative']}]}}));assert(!runs.sameSetup(typedSetup,{...typedSetup,answerSettings:{rationale:false,fields:[tone]}}));
 const doc={id:'a',name:'a.txt',status:'done',provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'P',answerFields:['Tone'],answers:{f0:'positive'},score:'',explanation:'Hopeful wording.',runNo:1};
 assert.deepEqual(runs.remainingFor([doc],setup),[]);assert.deepEqual(runs.remainingFor([doc],typedSetup).map(d=>d.id),['a'],'A text annotated without the type still needs the typed setup');
 assert.deepEqual(runs.remainingFor([{...doc,answerSettings:typedSetup.answerSettings}],typedSetup),[]);
 const begun=runs.beginRun([doc],[{...setup,number:1,startedAt:'2026-11-15T10:00:00Z'}],typedSetup,false,'2026-11-15T11:00:00Z');
 assert.equal(begun.number,2,'Typing a field starts a new run');assert.deepEqual(begun.runs[1].answerSettings,typedSetup.answerSettings);
 assert.equal(runs.beginRun([doc],begun.runs,typedSetup,false,'2026-11-15T12:00:00Z').number,2,'The same typed setup continues its run');
 assert.deepEqual(runs.cleanRuns([{...typedSetup,number:1,startedAt:''},{...setup,number:2,startedAt:'',answerSettings:{fields:'x'}}]).map(r=>r.answerSettings),[typedSetup.answerSettings,undefined]);
 assert.deepEqual(runs.setupOf({...doc,answerSettings:typedSetup.answerSettings}).answerSettings,typedSetup.answerSettings);assert(!('answerSettings' in runs.setupOf(doc)));
 const requeued=runs.requeue([{...doc,answerSettings:typedSetup.answerSettings}],[],new Set(['a'])).docs[0];
 assert.equal(requeued.answerSettings,undefined);assert.deepEqual(requeued.earlier[0].answerSettings,typedSetup.answerSettings,'An earlier result keeps the fields it was made with');

 // --- A study backup keeps the settings -------------------------------------------------
 const backup=load('lib/study-backup.ts');
 const study={name:'Typed study',createdAt:'2026-11-15',texts:{answerFields:names,answerSettings:editor,runs:[{...typedSetup,number:1,startedAt:'2026-11-15T10:00:00Z'}],docs:[{...doc,answerSettings:typedSetup.answerSettings,file:new File(['Text'],'a.txt'),earlier:[{runNo:1,status:'done',prompt:'P',model:'gpt-6-luna',answerFields:['response'],answerSettings:{plain:true},answers:{f0:'Prose.'},score:'',explanation:''}]}]},knowledge:{answerFields:['response'],answerSettings:{plain:true},items:[]}};
 const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup(study));
 assert.deepEqual(restored.texts.answerSettings,editor);assert.deepEqual(restored.texts.docs[0].answerSettings,typedSetup.answerSettings);assert.deepEqual(restored.texts.docs[0].earlier[0].answerSettings,{plain:true});assert.deepEqual(restored.texts.runs[0].answerSettings,typedSetup.answerSettings);assert.deepEqual(restored.knowledge.answerSettings,{plain:true});
 const plainBackup=backup.decodeStudyBackup(await backup.encodeStudyBackup({name:'Standard',createdAt:'2026-11-15',texts:{answerFields:['Tone'],docs:[{...doc,file:new File(['Text'],'a.txt')}]},knowledge:{answerFields:[],items:[]}}));
 assert(!('answerSettings' in plainBackup.texts)&&!('answerSettings' in plainBackup.texts.docs[0]),'A study without settings gains none');

 console.log('PASS: typed answer fields (allowed values, sent form, strict reading), validation by type, schemas and plain text for all four providers and batches, runs keyed by answer format, and backups. Mocked traffic only.');
})().catch(error=>{console.error(error);process.exit(1);});
