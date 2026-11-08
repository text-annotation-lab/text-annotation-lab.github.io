const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
let calls=[],mock;
function load(file){const out={};new Function('exports','require','fetch',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText)(out,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id),async(url,options)=>{calls.push({url,options});return Response.json(mock);});return out;}
(async()=>{
 const {reviewStoredAnswer,explicitAnswerRules,annotationValidationError}=load('lib/answer-validation.ts'),{annotationSchema,answerInstructions,annotationFormatRecord,hasSeparateExplanation}=load('lib/answer-fields.ts');
 const prompt='Assess the supplied text.\n<output>\nexplanation: provide your assessment as described above\nscore: an integer from -3 to 3, without a plus sign\n</output>';
 assert.deepEqual(explicitAnswerRules(prompt)[0].values,['-3','-2','-1','0','1','2','3']);
 for(const p of ['Give a score from 1 to 7.', 'score: an integer from 0 to 2 or NA', 'score: an integer from 1 to 3\nscore: an integer from 1 to 5','Example:\n'+prompt,'score: an integer from 1 to 100000','Return UNKNOWN if uncertain.\n'+prompt])assert.equal(explicitAnswerRules(p).length,0,p);
 assert.deepEqual(explicitAnswerRules('Tone: an integer from −2 to +2',['Tone'])[0].values,['-2','-1','0','1','2']);
 assert.equal(explicitAnswerRules(prompt,[],true)[0].values.at(-1),'INSUFFICIENT_KNOWLEDGE');
 for(const value of ['Score','explanation prose proper JSON?',');','+2','4','','2.0'])assert(annotationValidationError({score:value,explanation:'Reason.'},[],prompt),value);
 for(const value of ['-3','0','3'])assert.equal(annotationValidationError({score:value,explanation:'Reason.'},[],prompt),undefined);
 assert.equal(annotationValidationError({score:'REALIST',explanation:'Reason.'}),undefined);
 assert.equal(annotationValidationError({score:'',explanation:'Reason.',answers:{f0:'Fear'}},['Fear']),undefined);
 assert.equal(annotationValidationError({score:'INSUFFICIENT_KNOWLEDGE',explanation:'Unknown.'},[],prompt,true),undefined);
 assert.deepEqual(Object.keys(annotationSchema().properties),['explanation','score']);
 assert.deepEqual(annotationSchema([],false,prompt).properties.score.enum,['-3','-2','-1','0','1','2','3']);
 assert.deepEqual(annotationSchema(['Score','Explanation'],true,prompt).properties.answers.propertyOrdering,['f1','f0']);
 assert.deepEqual(annotationSchema(['Score','Explanation']).properties.explanation.enum,['']);
 assert(!hasSeparateExplanation({explanation:'Same paragraph.',answers:{f0:'Same  paragraph.'}}));assert(hasSeparateExplanation({explanation:'A different explanation.',answers:{f0:'NEUTRAL'}}));
 const route=load('app/api/annotate/route.ts'),batch=load('lib/batch-provider.ts');
 const models={openai:['gpt-6-luna','medium'],anthropic:['claude-haiku-4-5-20251001','4096'],gemini:['gemini-3.8-flash','medium']};
 function output(provider,value,names=[]){const raw=JSON.stringify({explanation:names.includes('Explanation')?'':'A substantive explanation.',score:names.length?'':value,...(names.length?{answers:{f0:value,f1:'A substantive explanation.'}}:{})});const u={input_tokens:42,output_tokens:7,total_tokens:49};return provider==='openai'?{id:'resp_test',status:'completed',usage:u,output:[{content:[{type:'output_text',text:raw}]}]}:provider==='anthropic'?{id:'msg_test',stop_reason:'end_turn',usage:u,content:[{type:'text',text:raw}]}:{responseId:'gemini_test',usageMetadata:{totalTokenCount:49},candidates:[{finishReason:'STOP',content:{parts:[{text:raw}]}}]};}
 function request(provider,names=[]){const f=new FormData();for(const [k,v] of Object.entries({prompt,provider,model:models[provider][0],effort:models[provider][1],answerFields:JSON.stringify(names)}))f.set(k,v);f.set('file',new File(['Source text.'],'paper.txt'));return new Request('https://test.site/api/annotate',{method:'POST',headers:{origin:'https://test.site',Authorization:'Bearer sk-test'},body:f});}
 let bad;
 for(const provider of Object.keys(models))for(const names of [[],['Score','Explanation']]){
  calls=[];mock=output(provider,'Score',names);const response=await route.POST(request(provider,names));assert.equal(response.status,422);bad=await response.json();assert.match(bad.error,/Invalid answer/);assert(bad.rawResponse.includes('Score'));assert(bad.usage);assert(bad.responseId);assert(bad.responseFormat);assert.equal(calls.length,1,'No hidden retries');
  const body=JSON.parse(calls[0].options.body),schema=provider==='openai'?body.text.format.schema:provider==='anthropic'?body.output_config.format.schema:body.generationConfig.responseSchema;assert.deepEqual(names.length?schema.properties.answers.properties.f0.enum:schema.properties.score.enum,['-3','-2','-1','0','1','2','3']);
  mock=output(provider,'-1',names);const success=await route.POST(request(provider,names));assert.equal(success.status,200);assert.equal((await success.json()).rawResponse,undefined);
  const prepared=await batch.buildBatchBody(provider,new File(['Text'],'test.txt'),prompt,...models[provider],false,false,names);assert(JSON.stringify(prepared).includes('Complete the explanation before the final judgments'));
  const collected=batch.parseBatchAnnotation(provider,output(provider,');',names));assert.equal(collected.rawResponse,undefined,'Successful batch JSON is not duplicated in transit');assert(annotationValidationError(collected,names,prompt));
 }
 const {queueRetries}=load('lib/workflow-safety.ts'),{createResultsWorkbook}=load('lib/export-results.ts'),{encodeStudyBackup,decodeStudyBackup}=load('lib/study-backup.ts');
 const row={...bad,id:'bad',name:'bad.txt',status:'error',answerFields:['Score','Explanation'],file:new File(['Text'],'bad.txt'),prompt,model:'gpt-6-luna',provider:'openai',effort:'medium'};
 const reviewed=reviewStoredAnswer({...row,status:'done'});assert.equal(reviewed.status,'error');assert.equal(reviewed.answers,row.answers);assert.equal(reviewed.usage,row.usage);assert.equal(reviewStoredAnswer({...row,status:'pending'}).status,'pending');
 const queued=queueRetries([row])[0];assert.equal(queued.rawResponse,undefined);assert.equal(queued.history[0].rawResponse,row.rawResponse);assert.equal(queued.history[0].responseFormat,row.responseFormat);
 const restored=decodeStudyBackup(await encodeStudyBackup({name:'Review',createdAt:'2026-10-30',texts:{docs:[row,{...queued,id:"queued"}]}}));assert.equal(restored.texts.docs[0].rawResponse,row.rawResponse);
 const book=new (require('exceljs').Workbook)();await book.xlsx.load(await createResultsWorkbook([row],{prompt,model:'gpt-6-luna',effort:'medium'}));assert(book.getWorksheet('Responses needing review'));assert(JSON.stringify(book.getWorksheet('Study settings').getSheetValues()).includes('Lab response format'));
 console.log('PASS: screenshot failures rejected; bounded explicit scales, conflicts, examples and abstention; all-provider schema/instructions and response preservation; named explanations; batch checks; usage, provenance, backup, retries, and Excel. Mocked provider responses only.');
})().catch(e=>{console.error(e);process.exit(1);});
