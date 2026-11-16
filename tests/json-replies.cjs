// Plain-text replies that are JSON (research mode): a reply that is one JSON object gets a column per value
// beside the reply itself, in the tables, the workbook, the comparisons, and the charts; a reply with JSON
// among other words is a failed result that keeps what was returned. Prose is untouched, and so is every
// result made with answer fields. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require',code)(exports,local);return exports;}

(async()=>{
 const json=load('lib/json-reply.ts'),validation=load('lib/answer-validation.ts'),view=load('lib/research/view.ts'),exporting=load('lib/research/export.ts'),agree=load('lib/research/agreement.ts'),charts=load('lib/chart-model.ts'),types=load('lib/answer-types.ts');
 assert(!/\bimport\b/.test(fs.readFileSync(path.join(root,'lib/json-reply.ts'),'utf8').replace(/\/\/.*$/gm,'')),'The reading rules import nothing, so any module may use them');

 // --- Reading a reply -------------------------------------------------------------------
 const flat=json.flattenJsonReply;
 assert.deepEqual(flat('```json\n{"race":{"reasoning":"x","negative":2,"positive":0},"note":"hi"}\n```'),{race_reasoning:'x',race_negative:'2',race_positive:'0',note:'hi'},'Nested keys are joined with an underscore');
 assert.deepEqual(flat(' {"a":1.50,"b":true,"c":null,"d":[1,"two",{"e":3}],"f":{"g":{"h":"deep"}},"i":""} '),{a:'1.5',b:'true',c:'',d:'[1,"two",{"e":3}]',f_g_h:'deep',i:''},'Numbers and yes/no as written by JSON, an empty value as an empty cell, a list kept as it is');
 assert.deepEqual(flat('```\n{"a":1}\n```'),{a:'1'},'A fence without the word json');assert.deepEqual(flat('{}'),{},'An empty object is JSON without columns');
 for(const none of ['Positive','[1,2]','','   ','3','"text"','null','true',undefined,null,7,{a:1}])assert.equal(flat(none),null,'Not a JSON object: '+JSON.stringify(none));
 // The reply's own column keeps its name; a key of that name is told apart.
 assert.deepEqual(flat('{"response":"x","Response":"y","score":1}'),{answer_response:'x',answer_Response:'y',score:'1'});
 // Keys are the reply's own values, whatever they are called.
 const odd=flat('{"__proto__":"a","constructor":"b","toString":"c","":"dropped","x":{"":"kept under x_"}}');
 assert.deepEqual(Object.keys(odd),['__proto__','constructor','toString','x_']);assert.equal(json.jsonValue(odd,'__proto__'),'a');assert.equal(json.jsonValue(odd,'constructor'),'b');
 assert.equal(json.jsonValue(flat('{"a":1}'),'constructor'),'','A key the reply does not have is empty, never a built-in');assert.equal(json.jsonValue(null,'a'),'');
 assert.equal(flat('['.repeat(200000)+']'.repeat(200000)),null,'A reply too deep to read is not JSON');
 // The same fourteen replies, with the same verdicts, as the rule this one follows.
 const replies=['{"a": 1}','Here it is:\n```json\n{"a": 1}\n```','Answer: {"a": 1} done','{"a": 1','Plain prose with {braces}','No JSON at all','```json\n{"a": 1}\n```','```json\n{"a": 1}','{"a": NaN}','{"a": -Infinity}','﻿{"a": 1}','﻿```json\n{"a": 1}\n```','```json\n﻿{"a": 1}\n```','```json\n{"a": 1}﻿\n```'];
 assert.deepEqual(replies.map(json.unreadableJson),[false,true,true,true,false,false,false,true,true,true,false,false,false,false]);
 assert.deepEqual(replies.map(reply=>Boolean(flat(reply))),[true,false,false,false,false,false,true,false,false,false,true,true,true,true]);
 assert(json.looksLikeJson('He said { "quote" }'));assert(!json.looksLikeJson('A set {1, 2} and a dict {a: 1}'));
 // One reading per result: asking again returns the same object, and a replaced result is read anew.
 const answers={f0:'{"a":1}'};assert.equal(json.jsonAnswers(answers),json.jsonAnswers(answers));assert.deepEqual(json.jsonAnswers({f0:'{"a":2}'}),{a:'2'});assert.equal(json.jsonAnswers({f0:'prose'}),null);assert.equal(json.jsonAnswers(undefined),null);

 // --- The order of the columns ----------------------------------------------------------
 for(const key of ['explanation','race_explanation','reasoning','race_reasoning'])assert(json.isExplanationKey(key));
 for(const key of ['race_negative','score','explanations_count','unexplanation'])assert(!json.isExplanationKey(key),key);
 const order=(...texts)=>json.jsonKeyOrder(texts.map(flat));
 assert.deepEqual(order('{"explanation":"first","score":2,"label":"a"}'),['score','label','explanation'],'The model writes its reasoning first; the reader gets the scores first');
 assert.deepEqual(order('{"race_explanation":"x","race":1,"class_explanation":"y","class":2}'),['race','race_explanation','class','class_explanation'],'Each explanation follows its own score');
 assert.deepEqual(order('{"race":{"reasoning":"x","negative":2,"positive":0},"gender":{"reasoning":"y","negative":1,"positive":1},"note":"n"}'),['race_negative','race_positive','race_reasoning','gender_negative','gender_positive','gender_reasoning','note'],'Within each nested group the reasoning comes last');
 assert.deepEqual(order('{"a":1}',null,'prose','{"b":2,"a":3}','{"c":4}'),['a','b','c'],'Every key of every reply, as first seen; replies that are not JSON add nothing');
 assert.deepEqual(json.jsonKeyOrder([]),[]);

 // --- A failed result, not silently empty columns ---------------------------------------
 const plain={plain:true},result=text=>({score:'',explanation:'',answers:{f0:text}}),check=text=>validation.annotationValidationError(result(text),['response'],'Prompt',false,plain);
 assert.equal(check('{"score": 2, "explanation": "Hopeful."}'),undefined);assert.equal(check('```json\n{"score": 2}\n```'),undefined);
 assert.equal(check('The tone is hopeful {see the second paragraph}.'),undefined,'Prose is never judged, even with braces');
 for(const mixed of ['Here is my answer: {"score": 2}','{"score": 2} I hope this helps.','{"score": 2','```json\n{"score": 2}','{"score": 2}\n{"score": 3}'])assert.equal(check(mixed),validation.UNREADABLE_JSON,mixed);
 assert.match(validation.UNREADABLE_JSON,/^The reply contains JSON that could not be read\. .*only when the whole reply is one JSON object\. The response is kept for review; no retry was sent\.$/);
 assert.match(check('  '),/^The reply is empty/);
 // Fields with a format are judged as before: a free-text answer may quote JSON.
 assert.equal(validation.annotationValidationError({score:'',explanation:'Because.',answers:{f0:'It says {"a": 1} in passing'}},['Notes'],'Prompt',false,undefined),undefined);
 assert.equal(validation.annotationValidationError({score:'It says {"a": 1}',explanation:'Because.'},[],'Prompt',false,undefined),undefined);
 // A stored result is judged by the same rule when a study opens, and keeps what was returned.
 const stored={id:'d',name:'d.txt',status:'done',prompt:'Prompt',score:'',explanation:'',answerFields:['response'],answerSettings:plain,answers:{f0:'Sure: {"score": 2}'},time:'2026-11-16T00:00:00.000Z',tokens:50};
 const reviewed=validation.reviewStoredAnswer(stored,false);
 assert.equal(reviewed.status,'error');assert.equal(reviewed.error,validation.UNREADABLE_JSON);assert.equal(reviewed.answers.f0,'Sure: {"score": 2}');assert.equal(reviewed.tokens,50);assert(reviewed.rawResponse.includes('Sure: {\\"score\\": 2}'));
 const fine={...stored,answers:{f0:'{"score": 2}'}};assert.equal(validation.reviewStoredAnswer(fine,false),fine);

 // --- Research tables and comparisons ---------------------------------------------------
 const reply=(score,label,why)=>JSON.stringify({tone:{score,label},length:score*10,explanation:why}),done=(id,text,extra={})=>({id,name:id+'.txt',status:'done',runNo:1,provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate the tone.',answerFields:['response'],answerSettings:plain,answers:{f0:text},score:'',explanation:'',time:'2026-11-16T00:00:00.000Z',tokens:100,cells:[],...extra});
 const rows=[done('a',reply(1,'calm','One.'),{cells:['1']}),done('b','```json\n'+reply(2,'warm','Two.')+'\n```',{cells:['2']}),done('c','The tone is warm; I would say 2.',{cells:['2']}),done('d',reply(3,'hot','Three.'),{cells:['1']}),{id:'e',name:'e.txt',status:'pending',cells:['3']},{...done('f','Answer: '+reply(3,'hot','x')),status:'error',error:validation.UNREADABLE_JSON,cells:['3']}];
 const run={number:1,startedAt:'2026-11-16T00:00:00.000Z',provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate the tone.',answerFields:['response'],answerSettings:plain};
 assert.deepEqual(view.fieldsOf(rows),['tone_score','tone_label','length','explanation','response'],'The values of the JSON replies, then the reply itself');
 assert.equal(view.valueOf(rows[0],'tone_score'),'1');assert.equal(view.valueOf(rows[1],'tone_label'),'warm','A fenced reply is read the same way');assert.equal(view.valueOf(rows[2],'tone_score'),'','Prose has no values of its own');assert.equal(view.valueOf(rows[2],'response'),'The tone is warm; I would say 2.');assert.equal(view.valueOf(rows[0],'response'),rows[0].answers.f0,'The reply itself is unchanged');assert.equal(view.valueOf(rows[0],'constructor'),'');
 assert.equal(view.pickField(view.fieldsOf(rows),''),'tone_score','A comparison starts from the first value, not from the whole reply');assert.equal(view.pickField(view.fieldsOf(rows),'','length'),'length');
 assert.deepEqual(view.fieldsOf([rows[2]]),['response'],'Prose alone: one column, as before');assert.deepEqual(view.fieldsOf([rows[5]]),[],'A failed result adds no columns');
 // Results made with answer fields are read exactly as before, also next to plain-text ones.
 const fielded={id:'g',name:'g.txt',status:'done',runNo:2,answerFields:['Tone','tone_score'],answers:{f0:'{"x":1}',f1:'5'},score:'',explanation:'Because.',cells:[]};
 assert.deepEqual(view.fieldsOf([fielded]),['Tone','tone_score']);assert.equal(view.valueOf(fielded,'Tone'),'{"x":1}');assert.equal(view.valueOf(fielded,'x'),'','An answer field that holds JSON is not split');
 assert.deepEqual(view.fieldsOf([fielded,rows[0]]),['Tone','tone_score','tone_label','length','explanation','response'],'A value named like a field shares its column');assert.equal(view.valueOf(fielded,'tone_score'),'5');
 assert.deepEqual(view.fieldsOf([{id:'h',name:'h',status:'done',score:'4',explanation:'x'},rows[0]]),['','tone_score','tone_label','length','explanation','response']);
 // Comparing with another column or run reads the value, and the scale comes from the answers.
 const shown=view.researchRows(rows,[{name:'coder',role:'label'}],{...view.DEFAULT_VIEW,compare:'col:coder'});
 assert.equal(shown.field,'tone_score');assert.deepEqual(shown.rows.map(row=>row.compared.match),[true,true,null,false,null,null]);
 assert.deepEqual(agree.sourceFields(rows,{kind:'run',run:1}),['tone_score','tone_label','length','explanation','response']);
 assert.deepEqual(agree.sourceValues(rows,[{name:'coder',role:'label'}],{kind:'run',run:1},'tone_score'),['1','2','','3','','']);
 const pairing=agree.pairSources(rows,[{name:'coder',role:'label'}],{kind:'run',run:1},'tone_score',{kind:'column',name:'coder'},'');
 assert.deepEqual([pairing.a,pairing.b],[['1','2','3'],['1','2','1']]);assert.equal(pairing.numeric,true);assert.equal(pairing.scaleSeen,true,'No scale was declared, so it is read from the answers');
 // The export tables: one column per value, the reply itself last.
 const tables=load('lib/research/export-tables.ts'),dataset={kind:'texts',rows,runs:[run],columns:[{name:'coder',role:'label'}],samples:[]},wide=tables.wideTable(dataset);
 assert.deepEqual(wide[0],['doc_id','coder','run1_tone_score','run1_tone_label','run1_length','run1_explanation','run1_response']);
 assert.deepEqual(wide[1],['a','1','1','calm','10','One.',rows[0].answers.f0]);assert.deepEqual(wide[3],['c','2','','','','','The tone is warm; I would say 2.']);assert.deepEqual(wide[6],['f','3','','','','',''],'A failed result has no values');
 const exported={name:'JSON replies',dataset,lab:'test'},long=tables.requestsTable(exported,undefined,new Map()),head=long[0],at=name=>head.indexOf(name),values=name=>['tone_score','tone_label','length','explanation','response'].map(field=>long.find(line=>line[at('doc_id')]===name)[at(field)]);
 assert.deepEqual(values('b'),['2','warm','20','Two.',rows[1].answers.f0]);assert.deepEqual(values('c'),['','','','','The tone is warm; I would say 2.'],'Prose has only the reply itself');
 assert.deepEqual([long.find(line=>line[at('doc_id')]==='f')[at('status')],...values('f')],['error','','','','',rows[5].answers.f0],'A failed request has no values, but the reply that could not be read is kept');
 const byText=tables.resultsTable(exported,1);assert.deepEqual(byText[0],['doc_id','tone_score','tone_label','length','explanation','coder','n_ok','n_error','response'],'The values of a JSON reply, then the labels, and the reply itself last');
 const overview=tables.runsOverview(exported,new Map());
 assert.match(overview[1][overview[0].indexOf('answer_format')],/^plain text: the whole reply is stored as “response” \(a reply that is one JSON object also has a column for each of its values\); no answer format was sent$/);
 assert.equal(types.answersLabel(['response'],plain),'Plain text');

 // --- The Excel workbook ----------------------------------------------------------------
 const ExcelJS=req('exceljs'),workbookOf=async(docs,settings={prompt:'Rate the tone.',model:'gpt-6-luna',effort:'medium'})=>{const book=new ExcelJS.Workbook();await book.xlsx.load(await load('lib/export-results.ts').createResultsWorkbook(docs,settings));return book.getWorksheet('Results');};
 const cells=(sheet,n)=>{const values=sheet.getRow(n).values.slice(1);return Array.from({length:sheet.columnCount},(_,i)=>values[i]??'');};
 let sheet=await workbookOf(rows.slice(0,4));
 assert.deepEqual(cells(sheet,1),['Filename','tone_score','tone_label','length','response','Explanation','Annotation ID','Annotated / collected at (UTC)']);
 assert.deepEqual(cells(sheet,2).slice(0,6),['a.txt',1,'calm',10,rows[0].answers.f0,'One.'],'Numbers are numbers; a key named explanation fills the Explanation column');
 assert.deepEqual(cells(sheet,4).slice(0,6),['c.txt','','','','The tone is warm; I would say 2.','']);
 // A key named like one of the sheet's own columns is told apart; a failed reply keeps its text and its error.
 sheet=await workbookOf([done('a','{"Filename":"x","status":"draft","Status":"final","error":"none","tone":2}'),rows[5]]);
 assert.deepEqual(cells(sheet,1),['Filename','answer_Filename','answer_status','answer_answer_Status','answer_error','tone','response','Explanation','Annotation ID','Annotated / collected at (UTC)','Status','Error']);
 assert.deepEqual(cells(sheet,2).slice(1,6),['x','draft','final','none',2]);assert.deepEqual(cells(sheet,3).slice(1,7),['','','','','',rows[5].answers.f0]);assert.equal(cells(sheet,3)[11],validation.UNREADABLE_JSON);
 // Without plain-text results the sheet is what it was.
 sheet=await workbookOf([fielded,{id:'h',name:'h.txt',status:'done',score:'{"a":1}',explanation:'Because.',prompt:'P',model:'gpt-6-luna'}]);
 assert.deepEqual(cells(sheet,1),['Filename','Score / category','Tone','tone_score','Explanation','Annotation ID','Annotated / collected at (UTC)']);assert.deepEqual(cells(sheet,3).slice(0,2),['h.txt','{"a":1}']);

 // --- Charts ----------------------------------------------------------------------------
 const chartRows=rows.map(row=>({...row}));
 assert.deepEqual(charts.chartFieldList(chartRows).map(field=>field.label),['tone_score','tone_label','length','response']);
 const scoreField=charts.chartFieldList(chartRows)[0];assert.deepEqual(chartRows.map(row=>charts.fieldValue(row,scoreField)),['1','2','','3','','']);
 assert.deepEqual(charts.chartFieldList([fielded]).map(field=>field.label),['Tone','tone_score'],'Charts of results with answer fields are unchanged');assert.equal(charts.fieldValue(fielded,{key:'field:Tone',label:'Tone',name:'Tone'}),'{"x":1}');
 assert.deepEqual(charts.chartFieldList([rows[2]].map(row=>({...row}))).map(field=>field.label),['response']);
 console.log('PASS: plain-text replies that are JSON are split by value in tables, the workbook, comparisons, and charts; JSON among other words is a failed result; prose and answer fields are untouched.');
})().catch(error=>{console.error(error);process.exitCode=1;});
