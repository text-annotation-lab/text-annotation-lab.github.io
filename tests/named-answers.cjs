// Research mode's named answer format: each field under its own name and type, as a schema, with nothing
// added to the prompt. What is sent to each provider, how replies are read (instant and batch), and that the
// standard Lab is unaffected. All provider traffic is mocked. No paid requests or real keys are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
let calls=[],mock=async()=>Response.json({});
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}

(async()=>{
 const types=load('lib/answer-types.ts'),fields=load('lib/answer-fields.ts'),validation=load('lib/answer-validation.ts'),route=load('app/api/annotate/route.ts'),batch=load('lib/batch-provider.ts'),providers=load('lib/providers.ts'),knowledgeLib=load('lib/model-knowledge.ts'),frames=load('lib/request-frame.ts'),python=load('lib/research/export-python.ts'),tables=load('lib/research/export-tables.ts');
 const tone={name:'Tone',type:'category',values:['positive','neutral','negative'],description:'Overall tone of the text.'},intensity={name:'Intensity',type:'ordinal',values:['-1','0','1','2'],description:''},sarcasm={name:'Sarcasm',type:'boolean',values:[],description:''},count={name:'Word count',type:'number',values:[],description:''},notes={name:'Notes',type:'text',values:[],description:'One sentence.'};
 const names=['Tone','Intensity','Sarcasm','Word count','Notes'],editor={fields:[tone,intensity,sarcasm,count,notes]};

 // --- What a request carries ----------------------------------------------------------
 const sent=types.sentAnswers(names,editor,true),standard=types.sentAnswers(names,editor);
 assert.equal(sent.settings.named,true);assert.equal(standard.settings.named,undefined,'The standard Lab sends the earlier format');
 assert.deepEqual(types.sentAnswers(['Tone'],undefined,true),{names:['Tone'],settings:{named:true}},'Named even without types');
 assert.deepEqual(types.sentAnswers(names,{...editor,plain:true},true),{names:['response'],settings:{plain:true}},'Plain text has no format to name');
 assert.deepEqual(types.readAnswerSettings(JSON.stringify(sent.settings),names),sent.settings,'The named setting is read back as sent');
 assert.deepEqual(types.cleanAnswerSettings({named:true}),{named:true});assert.deepEqual(types.cleanAnswerSettings({named:true,plain:true}),{plain:true});
 assert.deepEqual(types.sentAnswers(names,types.cleanAnswerSettings(sent.settings)),sent,'Settings kept with a result send the same requests again');

 // --- Keys -------------------------------------------------------------------------------
 assert.deepEqual(types.wireKeys(['Tone','Word count','tone_2','2nd','Rationale','Æble','tone'.toUpperCase()+'!'],{named:true}),['Tone','word_count','tone_2','f_2nd','Rationale_field','aeble','tone_3']);
 assert.deepEqual(types.wireKeys(['Tone','Notes']),['f0','f1'],'The earlier format keeps its short keys');
 assert.deepEqual(types.wireKeys(['Positive score','positive_score'],{named:true}),['positive_score','positive_score_2']);
 // From 2026-11-16 every key is made from its name, in lower case: Tone goes as tone. Runs before kept Tone.
 assert.deepEqual(types.wireKeys(['Tone','Word count','tone_2','2nd','Rationale','Æble','TONE!'],{named:true,slugKeys:true}),['tone','word_count','tone_2','f_2nd','rationale_field','aeble','tone_3']);
 const fieldsOf=names=>({fields:names.map(name=>({name,type:'text',values:[],description:'What it is.'}))});
 const slugged=types.sentAnswers(['Tone'],fieldsOf(['Tone']),true,false,true).settings,same=types.sentAnswers(['tone','Word count'],fieldsOf(['tone','Word count']),true,false,true).settings;
 assert.equal(slugged.slugKeys,true,'Marked where the key changes');assert.equal(same.slugKeys,undefined,'Not marked where the keys are the same either way, so the setup is the same as before');
 assert.deepEqual(types.wireKeys(['Tone'],slugged),['tone']);assert.deepEqual(types.wireKeys(['tone','Word count'],same),['tone','word_count']);
 assert.equal(types.sentAnswers(['Tone'],fieldsOf(['Tone']),true).settings.slugKeys,undefined,'The standard rule unless asked for');
 // A request's settings are read back as sent: a run from before keeps Tone, a new one sends tone.
 for(const settings of [slugged,types.sentAnswers(['Tone'],fieldsOf(['Tone']),true).settings])assert.deepEqual(types.readAnswerSettings(JSON.stringify(settings),['Tone']),settings);
 assert.deepEqual(types.cleanAnswerSettings({slugKeys:true,fields:[]}),undefined,'Only with the named format');
 assert.deepEqual(Object.keys(fields.annotationSchema(['Tone'],false,'',false,slugged).properties),['rationale','tone'],'The schema asks for tone');
 assert.deepEqual(fields.readReply({rationale:'Why.',tone:'Hopeful'},['Tone'],slugged),{answers:{f0:'Hopeful'},score:'',explanation:'Why.'},'A reply keyed tone is read for Tone');
 assert.deepEqual(fields.readReply({rationale:'Why.',Tone:'Hopeful'},['Tone'],types.sentAnswers(['Tone'],fieldsOf(['Tone']),true).settings).answers,{f0:'Hopeful'},'An earlier run’s reply keyed Tone is still read');

 // --- The schema -------------------------------------------------------------------------
 const schema=fields.annotationSchema(names,false,'',false,sent.settings);
 assert.deepEqual(Object.keys(schema.properties),['rationale','Tone','Intensity','Sarcasm','word_count','Notes'],'The explanation first, then the fields in their order');
 assert.deepEqual(schema.required,Object.keys(schema.properties));assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.properties.rationale,{type:'string',description:'Brief justification for the annotation, citing the text where relevant.'});
 assert.deepEqual(schema.properties.Tone,{description:'Overall tone of the text.',type:'string',enum:['positive','neutral','negative']});
 assert.deepEqual(schema.properties.Intensity,{type:'integer',enum:[-1,0,1,2]},'A scale is a whole number, with no description where none was given');
 assert.deepEqual(schema.properties.Sarcasm,{type:'boolean'});assert.deepEqual(schema.properties.word_count,{type:'number'});assert.deepEqual(schema.properties.Notes,{description:'One sentence.',type:'string'});
 const google=fields.annotationSchema(names,true,'',false,sent.settings);
 assert.equal(google.type,'OBJECT');assert.deepEqual(google.propertyOrdering,Object.keys(schema.properties));assert.deepEqual(google.properties.Intensity,{type:'INTEGER',minimum:-1,maximum:2},'Google takes a scale by its ends');assert.equal(google.properties.Sarcasm.type,'BOOLEAN');
 // No explanation, an Explanation field, no fields.
 assert.deepEqual(Object.keys(fields.annotationSchema(['Tone'],false,'',false,{rationale:false,named:true}).properties),['Tone']);
 assert.deepEqual(Object.keys(fields.annotationSchema(['Tone','Explanation'],false,'',false,{named:true}).properties),['Explanation','Tone'],'A field named Explanation stands in for the shared one and comes first');
 assert.deepEqual(fields.annotationSchema([],false,'Score: integer from 1 to 3.',false,{named:true}).properties,{rationale:{type:'string',description:'Brief justification for the annotation, citing the text where relevant.'},score:{type:'string',enum:['1','2','3']}});
 // Model knowledge: a field that can abstain goes as text.
 const known=fields.annotationSchema(names,false,'',true,sent.settings);
 assert.equal(known.properties.rationale.description,'Brief justification for the annotation.');
 assert.deepEqual(known.properties.Intensity.enum,['-1','0','1','2','INSUFFICIENT_KNOWLEDGE']);assert.equal(known.properties.Intensity.type,'string');assert.deepEqual(known.properties.Sarcasm.enum,['yes','no','INSUFFICIENT_KNOWLEDGE']);
 assert.deepEqual(known.properties.Tone.enum,['positive','neutral','negative','INSUFFICIENT_KNOWLEDGE']);assert.deepEqual(known.properties.Notes,{description:'One sentence.',type:'string'});
 // Nothing is added to the prompt; Model knowledge's own paragraph names no key.
 assert.equal(fields.answerInstructions(names,sent.settings),'');assert(fields.answerInstructions(names,standard.settings).includes('Lab response format'));
 assert(!knowledgeLib.knowledgeInstructions(false,true).includes('score'));assert(knowledgeLib.knowledgeInstructions(false,true).includes('answer "INSUFFICIENT_KNOWLEDGE" for each judgment that cannot be assessed reliably'));assert(!knowledgeLib.knowledgeInstructions(true,true).includes('score'));
 assert.equal(knowledgeLib.knowledgeInstructions(false),knowledgeLib.KNOWLEDGE_INSTRUCTIONS,'Unchanged without the named format');
 // inPrompt (Model knowledge in research mode): the prompt box holds the paragraph, and the Lab adds nothing.
 const ownSettings=types.sentAnswers(names,editor,true,true).settings;assert.equal(ownSettings.inPrompt,true);assert.equal(types.sentAnswers(names,ownSettings).settings.inPrompt,true,'A recorded run keeps it');
 assert.deepEqual(types.sentAnswers([],{plain:true},false,true).settings,{plain:true,inPrompt:true});assert.deepEqual(types.cleanAnswerSettings({plain:true,inPrompt:true}),{plain:true,inPrompt:true});assert.equal(types.cleanAnswerSettings({inPrompt:'yes'}),undefined);
 assert.equal(types.sentAnswers(names,editor,true).settings.inPrompt,undefined,'Texts never carry it');
 assert.equal(knowledgeLib.knowledgeAddition(false,ownSettings),'');assert.equal(knowledgeLib.knowledgeAddition(true,ownSettings),'');assert.equal(knowledgeLib.knowledgeAddition(false,sent.settings),'\n\n'+knowledgeLib.knowledgeInstructions(false,true));assert.equal(knowledgeLib.knowledgeAddition(true),'\n\n'+knowledgeLib.KNOWLEDGE_WEB_INSTRUCTIONS);
 assert.equal(knowledgeLib.recordedInstructions({}),knowledgeLib.KNOWLEDGE_INSTRUCTIONS);assert.equal(knowledgeLib.recordedInstructions({webSearch:true}),knowledgeLib.KNOWLEDGE_WEB_INSTRUCTIONS);assert.equal(knowledgeLib.recordedInstructions({instructions:''}),'');

 // --- Reading a reply ------------------------------------------------------------------------
 const reply={rationale:'Dry wording.',Tone:'neutral',Intensity:-1,Sarcasm:true,word_count:120.5,Notes:'Short.'},answers={f0:'neutral',f1:'-1',f2:'yes',f3:'120.5',f4:'Short.'};
 assert.deepEqual(fields.readReply(reply,names,sent.settings),{answers,score:'',explanation:'Dry wording.'});
 assert.deepEqual(fields.readReply({...reply,Sarcasm:false,Intensity:2.0},names,sent.settings).answers,{...answers,f1:'2',f2:'no'});
 assert.match(fields.readReply({...reply,Tone:undefined},names,sent.settings),/missing a named answer field/);assert.match(fields.readReply({...reply,Tone:null},names,sent.settings),/missing a named answer field/);
 assert.match(fields.readReply({...reply,rationale:undefined},names,sent.settings),/missing its explanation/);
 assert.equal(fields.readReply([reply],names,sent.settings),undefined);assert.equal(fields.readReply(null,names,sent.settings),undefined);
 assert.deepEqual(fields.readReply({Tone:'neutral'},['Tone'],{rationale:false,named:true}),{answers:{f0:'neutral'},score:'',explanation:''});
 assert.deepEqual(fields.readReply({rationale:'Why.',score:'2'},[],{named:true}),{score:'2',explanation:'Why.'});
 assert.deepEqual(fields.readReply({score:'',explanation:'E',answers:{f0:'a'}},['Tone']),{answers:{f0:'a'},score:'',explanation:'E'},'The earlier format reads as before');
 assert.equal(fields.readReply({Tone:'a'},['Tone']),undefined,'A named reply is not the earlier format');
 // Converted answers are checked against their fields as before.
 const read=fields.readReply(reply,names,sent.settings);
 assert.equal(validation.annotationValidationError(read,names,'',false,sent.settings),undefined);
 assert.match(validation.annotationValidationError(fields.readReply({...reply,Intensity:5},names,sent.settings),names,'',false,sent.settings),/Invalid answer for “Intensity”: "5"/);
 assert.match(validation.annotationValidationError(fields.readReply({...reply,rationale:' '},names,sent.settings),names,'',false,sent.settings),/missing its explanation/);

 // --- Each provider ------------------------------------------------------------------------
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-sonnet-5-5','medium'],gemini:['gemini-3.8-flash','medium'],openrouter:[providers.defaultModel('openrouter'),'medium']};
 const wrap=(provider,text)=>provider==='openai'?{status:'completed',id:'resp_test',usage:{total_tokens:12},output:[{content:[{type:'output_text',text}]}]}:provider==='anthropic'?{stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2},content:[{type:'text',text}]}:provider==='gemini'?{candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],usageMetadata:{totalTokenCount:12}}:{id:'test-response',choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}};
 const schemaOf=(provider,body)=>provider==='openai'?body.text?.format?.schema:provider==='anthropic'?body.output_config?.format?.schema:provider==='gemini'?body.generationConfig?.responseSchema:body.response_format?.json_schema?.schema;
 const words=(provider,body)=>{const content=provider==='gemini'?body.contents[0].parts:provider==='openai'?body.input.at(-1).content:body.messages.at(-1).content;return typeof content==='string'?content:content.map(part=>part.text||'').join('');};
 const PROMPT='Classify the tone of the text.';
 function request(provider,answerFields,answerSettings,knowledge=false){
  const form=new FormData();for(const [k,v]of Object.entries({provider,model:models[provider][0],effort:models[provider][1],prompt:PROMPT,answerFields:JSON.stringify(answerFields)}))form.set(k,v);
  if(answerSettings!==undefined)form.set('answerSettings',JSON.stringify(answerSettings));
  if(knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify([{heading:'Film',value:'Jaws'}]));}else form.set('file',new File(['A document.'],'text.txt'));
  return new Request('https://lab.test/api/annotate',{method:'POST',headers:{origin:'https://lab.test',authorization:'Bearer '+(provider==='openrouter'?'sk-or-v1-fake-test':provider==='openai'?'sk-test':'key-test')},body:form});
 }
 for(const provider of Object.keys(models)){
  calls=[];mock=async()=>Response.json(wrap(provider,JSON.stringify(reply)));
  let response=await route.POST(request(provider,names,sent.settings)),out=await response.json();
  assert.equal(response.status,200,provider+': '+out.error);assert.deepEqual(out.answers,answers);assert.equal(out.explanation,'Dry wording.');assert.equal(out.score,'');
  let body=JSON.parse(calls[0].options.body);
  assert.deepEqual(Object.keys(schemaOf(provider,body).properties),['rationale','Tone','Intensity','Sarcasm','word_count','Notes'],provider);
  assert.equal(words(provider,body),PROMPT+'\n\n<text>\nA document.\n</text>',provider+': nothing is added to the prompt');
  assert.equal(JSON.parse(out.responseFormat).instructions,'','The result records that no instructions were added');
  // A reply without a field is refused; one off the scale is kept for review.
  mock=async()=>Response.json(wrap(provider,JSON.stringify({...reply,Notes:undefined})));
  response=await route.POST(request(provider,names,sent.settings));out=await response.json();assert.equal(response.status,422);assert.match(out.error,/missing a named answer field/);
  mock=async()=>Response.json(wrap(provider,JSON.stringify({...reply,Intensity:7})));
  response=await route.POST(request(provider,names,sent.settings));out=await response.json();assert.equal(response.status,422);assert.match(out.error,/Invalid answer for “Intensity”: "7"/);assert(out.rawResponse);
  // Model knowledge: the paragraph names no key, and an abstention is accepted.
  calls=[];mock=async()=>Response.json(wrap(provider,JSON.stringify({...reply,Intensity:'INSUFFICIENT_KNOWLEDGE',Sarcasm:'INSUFFICIENT_KNOWLEDGE',word_count:'INSUFFICIENT_KNOWLEDGE'})));
  response=await route.POST(request(provider,names,sent.settings,true));out=await response.json();
  assert.equal(response.status,200,provider+' knowledge: '+out.error);assert.deepEqual(out.answers,{...answers,f1:'INSUFFICIENT_KNOWLEDGE',f2:'INSUFFICIENT_KNOWLEDGE',f3:'INSUFFICIENT_KNOWLEDGE'});
  body=JSON.parse(calls[0].options.body);assert(words(provider,body).includes(knowledgeLib.knowledgeInstructions(false,true)),provider);assert(!words(provider,body).includes('return score'));
  // With the paragraph in the prompt box, the request carries the prompt as written and nothing after it.
  calls=[];response=await route.POST(request(provider,names,ownSettings,true));out=await response.json();
  assert.equal(response.status,200,provider+' knowledge, in the prompt: '+out.error);body=JSON.parse(calls[0].options.body);assert(!words(provider,body).includes('Experimental latent-knowledge'),provider+': nothing added');assert(words(provider,body).includes(PROMPT),provider);
  // The standard Lab's requests are as they were.
  calls=[];mock=async()=>Response.json(wrap(provider,JSON.stringify({score:'',explanation:'E',answers:{f0:'neutral',f1:'0',f2:'no',f3:'3',f4:'Fine.'}})));
  response=await route.POST(request(provider,names,standard.settings));out=await response.json();
  assert.equal(response.status,200,provider+' standard: '+out.error);body=JSON.parse(calls[0].options.body);assert(schemaOf(provider,body).properties.answers);assert(words(provider,body).includes('Lab response format'));
 }

 // --- Batches ------------------------------------------------------------------------------
 for(const provider of ['openai','anthropic','gemini']){
  const out=wrap(provider,JSON.stringify(reply)),format={names,settings:sent.settings};
  assert.deepEqual(batch.parseBatchAnnotation(provider,out,false,false,false,format).answers,answers,provider);
  assert.match(batch.parseBatchAnnotation(provider,wrap(provider,JSON.stringify({...reply,Tone:undefined})),false,false,false,format).error,/missing a named answer field/);
  assert(batch.parseBatchAnnotation(provider,wrap(provider,'[]'),false,false,false,format).error);
  assert(batch.parseBatchAnnotation(provider,out).error,'Without the format, a named reply is not read as the earlier format');
  const body=await batch.buildBatchBody(provider,new File(['Text'],'text.txt'),'Prompt',...models[provider],false,false,names,sent.settings);
  assert(!JSON.stringify(body).includes('Lab response format'));
 }
 // The recorded request of a run matches what was sent.
 const frame=frames.requestFrame({provider:'anthropic',model:'claude-sonnet-5-5',effort:'medium',prompt:PROMPT,answerFields:names,answerSettings:sent.settings,layout:frames.LAYOUT},false);
 assert.equal(JSON.parse(frame.body).messages[0].content.map(part=>part.text).join(''),PROMPT+'\n\n<text>\n<<DOCUMENT_TEXT>>\n</text>');
 const knownFrame=frames.requestFrame({provider:'anthropic',model:'claude-sonnet-5-5',effort:'medium',prompt:PROMPT,answerFields:names,answerSettings:sent.settings,knowledge:true,layout:frames.LAYOUT},false);
 assert(JSON.parse(knownFrame.body).messages[0].content.map(part=>part.text).join('').includes(knowledgeLib.knowledgeInstructions(false,true)),'Model knowledge’s paragraph is in the recorded request');
 const ownFrame=frames.requestFrame({provider:'anthropic',model:'claude-sonnet-5-5',effort:'medium',prompt:PROMPT,answerFields:names,answerSettings:ownSettings,knowledge:true,layout:frames.LAYOUT},false);
 assert(JSON.parse(ownFrame.body).messages[0].content.map(part=>part.text).join('').startsWith(PROMPT+'\n\n<entry>'),'With the paragraph in the prompt, the recorded request has the prompt and then the subject');

 // --- Exports ------------------------------------------------------------------------------
 const codebook=tables.codebook(names,sent.settings,false);
 assert(codebook.includes('Each field was sent under its key in the schema and its type'));assert(codebook.includes('| Word count | word_count | number |  |  | word_count |'));assert(codebook.includes('| Rationale | rationale | free text | | Brief justification, generated before the labels | rationale |'));assert(codebook.includes('| Tone | tone | category | positive, neutral, negative | Overall tone of the text. | Tone |'),'The codebook’s columns, then the key the schema used');assert(!codebook.includes('answers.f'));
 assert(tables.codebook(names,standard.settings,false).includes('| Tone | tone | category | positive, neutral, negative | Overall tone of the text. | answers.f0 |'),'The earlier format names its short keys');
 const values=python.scriptValues({lab:'test',studyName:'S',runDescription:'#1',provider:'anthropic',text:frame,fields:names,plain:false,settings:sent.settings});
 assert.equal(values.KEYS,python.pyLiteral(['Tone','Intensity','Sarcasm','word_count','Notes']));assert.equal(values.RATIONALE,'"rationale"');
 assert.equal(values.ALLOWED,python.pyLiteral({Tone:['positive','neutral','negative'],Intensity:['-1','0','1','2'],Sarcasm:['yes','no']}),'A scale’s whole numbers are allowed as the Lab keeps them');assert.equal(values.TYPES,python.pyLiteral({Tone:'category',Intensity:'whole number',Sarcasm:'yes / no','Word count':'number'}),'Each typed field is checked by its own type');assert.equal(values.ABSTAIN,'None');
 const oldValues=python.scriptValues({lab:'test',studyName:'S',runDescription:'#1',provider:'anthropic',text:frames.requestFrame({provider:'anthropic',model:'claude-sonnet-5-5',effort:'medium',prompt:PROMPT,answerFields:names,answerSettings:standard.settings,layout:frames.LAYOUT},false),fields:names,plain:false,settings:standard.settings});
 assert.equal(oldValues.KEYS,'None');assert.equal(oldValues.RATIONALE,'None');
 // The script reads a named reply as the Lab does.
 const {spawnSync}=require('node:child_process'),os=require('node:os');
 const script=python.fillScript(python.SCRIPT_TEMPLATE,values),dir=fs.mkdtempSync(path.join(os.tmpdir(),'named-'));fs.writeFileSync(path.join(dir,'annotate.py'),script);
 const probe=`import sys,json\nsys.argv=['x']\nsys.path.insert(0,${JSON.stringify(dir)})\nimport annotate\nprint(json.dumps([annotate.parse_answer(${JSON.stringify(JSON.stringify(reply))}),annotate.parse_answer(${JSON.stringify(JSON.stringify({...reply,Intensity:5}))}),annotate.parse_answer(${JSON.stringify(JSON.stringify({...reply,Notes:1.0}))})]))`;
 const run=spawnSync('python3',['-I','-c',probe],{encoding:'utf8'});
 if(run.error)console.log('python3 not found; script check skipped');else{
  assert.equal(run.status,0,run.stderr);const [good,off,number]=JSON.parse(run.stdout);
  assert.deepEqual(good,[{Tone:'neutral',Intensity:'-1',Sarcasm:'yes','Word count':'120.5',Notes:'Short.',explanation:'Dry wording.'},'']);
  assert.match(off[1],/not one of the allowed values/);assert.equal(number[0].Notes,'1');
 }
 console.log('named answers: ok');
})().catch(error=>{console.error(error);process.exit(1);});
