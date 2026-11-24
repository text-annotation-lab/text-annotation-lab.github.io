// Regressions for the full-site review of November 24, 2026, research statistics, exports, and imports: numbers
// read strictly, labels spelled like built-in names, abstentions next to scores, the closest annotation, very
// long comparisons, fenced plain-text replies, tables that open with a blank line, repeated IDs, decimal period
// steps, sample markers, left-out values, and the checks of the replication script. Mocked only; no keys.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require(path.join(root,'node_modules/typescript')),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};
 new Function('exports','require',code)(exports,local);return exports;
}
const normalize=load('lib/research/normalize.ts'),metrics=load('lib/research/metrics.ts'),agree=load('lib/research/agreement.ts'),replies=load('lib/json-reply.ts'),types=load('lib/answer-types.ts'),tables=load('lib/research/parse-table.ts'),texts=load('lib/research/import-texts.ts'),summary=load('lib/research/summary.ts'),sampling=load('lib/research/sample.ts'),repeats=load('lib/research/repeats.ts'),fields=load('lib/research/summary-fields.ts'),python=load('lib/research/export-python.ts'),frames=load('lib/request-frame.ts');
const IK='INSUFFICIENT_KNOWLEDGE';

// --- Numbers: decimal notation only, and only a number that can be held -----------------------------------
assert.deepEqual(['0x10','0b11','1e309','Infinity','','  ','3',' 3 ','−2','–2','1e3','.5','5.','2.50'].map(text=>String(normalize.toNumber(text))),['NaN','NaN','NaN','NaN','NaN','NaN','3','3','-2','-2','1000','0.5','5','2.5']);
assert.deepEqual(['0x10','3','','1e309'].map(normalize.isPlainNumber),[false,true,false,false]);
assert.deepEqual(['0x10','1e309','2.5','−2'].map(text=>String(types.toNumber(text))),['NaN','NaN','2.5','-2'],'A typed field reads numbers the same way');
assert.equal(types.typedProblem({name:'N',type:'number',values:[],description:''},'0x10'),'a number');assert.equal(types.typedProblem({name:'N',type:'number',values:[],description:''},'2.5'),undefined);
// Yes / no has its two values also where a stored field lists none.
const yesNo={name:'B',type:'boolean',values:[],description:''};
assert.equal(types.typedProblem(yesNo,'maybe'),'yes or no');assert.equal(types.typedProblem(yesNo,'Yes'),undefined);assert.equal(types.typedProblem(yesNo,IK,true),undefined);assert.equal(types.typedProblem(yesNo,'maybe',true),'yes or no, or '+IK);
// Blank or unreadable values are no part of a mean or median, and a figure that cannot be computed shows a dash.
assert.equal(metrics.aggregate(['   '],'majority'),'');assert.equal(metrics.aggregate(['2','','4'],'mean'),'3');
assert.deepEqual([metrics.fmtStat(NaN),metrics.fmtStat(Infinity),metrics.fmtStat(0.5)],['—','—','0.500']);

// --- Labels spelled like built-in names -------------------------------------------------------------------
{const stats=metrics.agreement(['__proto__','constructor','a','a'],['__proto__','a','constructor','a'],'nominal',[],0,{withIntervals:false});
 assert.deepEqual([stats.n,stats.percentAgreement],[4,0.5]);assert.deepEqual(Object.keys(stats.confusion).sort(),['__proto__','a','constructor']);assert.equal(stats.confusion['__proto__']['__proto__'],1);assert.equal(stats.confusion.constructor.a,1);}
{// A plain-text reply with a key that another annotation lacks, named like a built-in.
 const made=(n,answers)=>({n,status:'done',answers,score:'',explanation:'',tokens:1,time:'2026-11-24T10:00:0'+n+'.000Z'});
 const combined=repeats.combinePlain([made(1,{f0:'{"constructor":"a","tone":"1"}'}),made(2,{f0:'{"tone":"1"}'}),made(3,{f0:'{"tone":"2","toString":"x"}'})]);
 const read=JSON.parse(combined);assert.equal(read.constructor,'a','A key named constructor is combined like any other');assert.equal(String(read.tone),'1');assert.equal(read.toString,'x');}

// --- Very long comparisons ---------------------------------------------------------------------------------
{const many=Array.from({length:200000},(_,i)=>i);assert.deepEqual([normalize.lowest(many),normalize.highest(many)],[0,199999]);
 const scores=Array.from({length:150000},(_,i)=>String(i%7)),stats=metrics.agreement(scores,scores,'ordinal',[],0,{withIntervals:false});assert.deepEqual([stats.n,stats.percentAgreement],[150000,1]);}

// --- Abstentions next to scores ----------------------------------------------------------------------------
assert.deepEqual([normalize.abstains(IK),normalize.abstains(' '+IK+' '),normalize.abstains('3'),normalize.abstains('')],[true,true,false,false]);
{// The explanation of a combined result is never the one of an annotation that gave no number where the others did.
 const SETTINGS={fields:[{name:'score',type:'ordinal',values:['1','2','3','4','5'],description:''}]},made=(n,value,explanation)=>({n,status:'done',answers:{f0:value},score:'',explanation,tokens:1,time:'2026-11-24T10:00:0'+n+'.000Z'});
 const combined=repeats.combine([made(1,'1','Low.'),made(2,IK,'Cannot determine.'),made(3,'5','High.')],['score'],SETTINGS);
 assert.notEqual(combined.explanation,'Cannot determine.','An abstention is not the closest annotation to a score');}

{// A score that most subjects abstain on is still a score in the summary.
 const plain=Array.from({length:10},(_,i)=>({id:'k'+i,name:'k'+i,status:'done',runNo:1,answerFields:['response'],answerSettings:{plain:true},answers:{f0:JSON.stringify({rating:i<6?IK:String(1+i%5),topic:'x'})}}));
 assert.deepEqual(fields.summaryFields(plain,1).map(field=>field.key),['rating']);}

// --- Plain-text replies ------------------------------------------------------------------------------------
assert.deepEqual(['```JSON\n{"a":1}\n```','```json\n{"a":1}\n```','```Json\n{"a": 1}\n```','{"a":1}','words {"a":1}'].map(replies.unreadableJson),[false,false,false,false,true],'A fence is read whatever the capitals of its word');
assert.deepEqual(replies.jsonKeyOrder([{Tone:'1',Other:'2',Tone_Explanation:'x'}]),['Tone','Tone_Explanation','Other'],'An explanation follows its score whatever its capitals');

// --- Tables and IDs ----------------------------------------------------------------------------------------
assert.deepEqual(tables.parseDelimited('\nid;text\n1;a, b\n'),{header:['id','text'],rows:[['1','a, b']]},'A blank first line does not decide the delimiter');
assert.deepEqual(tables.parseDelimited('\r\n \r\nid\ttext\r\n1\ta, b\r\n'),{header:['id','text'],rows:[['1','a, b']]});
assert.deepEqual(tables.parseDelimited('id,text\n1,"a; b; c"'),{header:['id','text'],rows:[['1','a; b; c']]});
assert.deepEqual(texts.planTable({header:['id','text'],rows:[['doc1.txt','a'],['doc1.txt','b'],['x','c'],['x','d']]},1,0,'t.csv').texts.map(text=>text.name),['doc1.txt','doc1_2.txt','x.txt','x_2.txt'],'A repeated ID is numbered before its .txt');
assert.deepEqual(texts.pastedTexts(['a','b'],'notes.txt').map(text=>text.name),['notes_1.txt','notes_2.txt']);

// --- Periods in decimal steps ------------------------------------------------------------------------------
{const steps=summary.periodSteps({values:['0.1','0.2','0.3'],min:0.1,max:0.3,more:false,numeric:true,filled:3});assert(steps.steps.includes(0),'Each value on its own is offered');}

// --- Sample markers ----------------------------------------------------------------------------------------
{const columns=[{name:'sample',role:'meta'}],docs=['validation','Validation',' validation ','','other'].map((value,i)=>({id:'d'+i,name:'d'+i,cells:[value]}));
 const drawn=sampling.drawStratifiedSample(docs,columns,{size:4,strata:[],exclude:null,seed:1,markedAs:{column:'sample',value:'validation'}});
 assert.deepEqual([drawn.eligible,drawn.taken],[4,[{value:'other',n:1}]],'Only a text marked with another value belongs to another sample');}

// --- Left-out values ---------------------------------------------------------------------------------------
assert.equal(agree.leftOutNote({leftOut:{n:5,values:['a','b','c','d','e']}},'text','marker'),'5 texts were left out because a value was a missing-value marker: “a”, “b”, “c”, “d”, “e”.','Five values are all of them');
assert.match(agree.leftOutNote({leftOut:{n:6,values:['a','b','c','d','e','f']}},'text','marker'),/“e”, …\.$/);
{const marked=['na','n/a','none','missing','unknown','-'],stats=metrics.agreement(['1','2',...marked],['1','2',...marked],'nominal',[],0,{withIntervals:false});assert(stats.leftOut.values.length<=6);}

// --- The replication script checks answers as the run did --------------------------------------------------
const PROMPT='Rate the text.',names=['Tone','Strength','Sarcasm','Word count','Notes'];
const settings={named:true,fields:[{name:'Tone',type:'category',values:['positive','negative'],description:''},{name:'Strength',type:'ordinal',values:['1','3','5'],description:''},{name:'Sarcasm',type:'boolean',values:[],description:''},{name:'Word count',type:'number',values:[],description:''}]};
const sent=types.sentAnswers(names,settings,true);
const frame=frames.requestFrame({provider:'gemini',model:'gemini-3.1-pro-preview',effort:'low',prompt:PROMPT+' Text {{id}}.',answerFields:names,answerSettings:sent.settings,layout:frames.LAYOUT,inserts:{id:'<<INSERT:id>>'}},false);
const input={studyName:'S',runDescription:'#1',provider:'gemini',text:frame,fields:names,plain:false,settings:sent.settings,inserts:[['id','doc_id']]};
const values=python.scriptValues(input);
assert.equal(values.ALLOWED,python.pyLiteral({Tone:['positive','negative'],Strength:['1','3','5'],Sarcasm:['yes','no']}),'A scale sent to Google by its ends still allows only its own values');
assert.equal(values.TYPES,python.pyLiteral({Tone:'category',Strength:'whole number',Sarcasm:'yes / no','Word count':'number'}));assert.equal(values.ABSTAIN,'None');
assert.equal(python.scriptValues({...input,knowledge:true}).ABSTAIN,'"'+IK+'"');
assert.equal(python.scriptValues({...input,settings:{named:true},fields:names}).ABSTAIN,'None');
const script=python.fillScript(python.SCRIPT_TEMPLATE,values),dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-nov24-'));fs.writeFileSync(path.join(dir,'annotate.py'),script);
fs.writeFileSync(path.join(dir,'known.py'),python.fillScript(python.SCRIPT_TEMPLATE,python.scriptValues({...input,knowledge:true})));
assert.deepEqual(types.wireKeys(names,sent.settings),['Tone','Strength','Sarcasm','word_count','Notes']);
const good={rationale:'Dry.',Tone:'positive',Strength:3,Sarcasm:true,word_count:120.5,Notes:'Short.'};
const cases=[good,{...good,Strength:2},{...good,Strength:4},{...good,Strength:5},{...good,word_count:'many'},{...good,word_count:'0x10'},{...good,Sarcasm:'maybe'},{...good,Tone:'mixed'},{...good,Strength:IK}];
const probe=`import sys,json\nsys.argv=['x']\nsys.path.insert(0,${JSON.stringify(dir)})\nimport annotate,known\ncases=json.loads(${JSON.stringify(JSON.stringify(cases))})\nprint(json.dumps({"run":[annotate.parse_answer(json.dumps(c))[1] for c in cases],"known":[known.parse_answer(json.dumps(c))[1] for c in cases],"numbers":[annotate.as_number(t) for t in ["3"," 2.5 ","\\u22122","0x10","1e309","","١٢"]],"fence":[bool(annotate.FENCE.match(t)) for t in ["\`\`\`JSON\\n{}\\n\`\`\`","\`\`\`json\\n{}\\n\`\`\`"]]}))`;
const run=spawnSync('python3',['-I','-c',probe],{encoding:'utf8'});
if(run.error)console.log('python3 not found; script checks skipped');else{
 assert.equal(run.status,0,run.stderr);const out=JSON.parse(run.stdout);
 assert.deepEqual(out.run.map(problem=>problem.replace(/^The answer for /,'')),['','Strength is not one of the allowed values','Strength is not one of the allowed values','','Word count is not a number','Word count is not a number','Sarcasm is not one of the allowed values','Tone is not one of the allowed values','Strength is not a number'],JSON.stringify(out.run));
 assert.equal(out.known[8],'','In Model knowledge a typed field also accepts the abstention');assert.equal(out.known[1],'The answer for Strength is not one of the allowed values');
 assert.deepEqual(out.numbers,[3,2.5,-2,null,null,null,null]);assert.deepEqual(out.fence,[true,true]);
 // --limit 0 is refused, and {{id}} follows --id-column.
 fs.writeFileSync(path.join(dir,'corpus.csv'),'key,text\nA1,Hello.\n');
 const cli=(...args)=>spawnSync('python3',['-I',path.join(dir,'annotate.py'),path.join(dir,'corpus.csv'),...args],{encoding:'utf8',env:{...process.env,GEMINI_API_KEY:''}});
 const none=cli('--limit','0','--dry-run','--id-column','key');assert.notEqual(none.status,0);assert.match(none.stderr,/--limit takes a whole number of 1 or more/);
 const dry=cli('--dry-run','--id-column','key');assert.equal(dry.status,0,dry.stderr);assert.match(dry.stdout,/Text A1\./,'The prompt’s {{id}} is the value of the chosen ID column');
 const missing=cli('--dry-run');assert.notEqual(missing.status,0);assert.match(missing.stderr,/columns that were not found: doc_id/);
}
fs.rmSync(dir,{recursive:true,force:true});
console.log('audit-nov24-research ok');
// (Appended checks that read the source: the figure's file names and its labels.)
{const source=fs.readFileSync(path.join(root,'components/research/results-panel.tsx'),'utf8'),slugSource=/const slug = \(text: string\) => (.*);/.exec(source)[1],body=/export function fileSlug\(text: string\): string \{([\s\S]*?)\n\}/.exec(source)[1];
 const fileSlug=new Function('text','const slug=text=>'+slugSource+';'+body.replace(/const t = text/,'const t = text'));
 assert.deepEqual(['1990-1999','1990–1999','score −3 to −1','score -3 to -1','wave-2','Kønsroller'].map(fileSlug),['1990-1999','1990-1999','score-minus3-to-minus1','score-minus3-to-minus1','wave-2','konsroller']);
 const figure=fs.readFileSync(path.join(root,'lib/research/figure.ts'),'utf8'),esc=new Function('s','return ('+/const esc = (\(s: string\) => .*);/.exec(figure)[1].replace('(s: string)','(s)')+')(s)');
 assert.equal(esc('A\u0001B\u000b<&>"\n'),'AB&lt;&amp;&gt;&quot;\n','A control character never reaches the figure');}
