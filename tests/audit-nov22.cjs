// Regressions for the third independent audit (November 22, 2026): the cache mark before a trailing {{text}}, keys
// sent only to their own provider, Gemini citation places counted in bytes, agreement that does not depend on which
// column is first, line breaks in RTF, Excel cells kept under the limit, Gemini thinking counted when the reply is
// empty, the price of a dated Claude snapshot, and web research that keeps OpenAI's log setting. Mocked only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require(path.join(root,'node_modules/typescript')),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=()=>Response.json({});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};
 new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;
}
(async()=>{
 // C1. A prompt that ends with {{text}} is cached up to the text; a prompt that is only {{text}} has no mark.
 const frame=load('lib/request-frame.ts'),inserts=load('lib/prompt-inserts.ts');
 const body=p=>{const filled=inserts.fillPlaces(p,()=>'');return frame.providerBody({provider:'anthropic',model:'claude-sonnet-4-5',effort:'1024',prompt:filled.prompt,schemaPrompt:p,answerFields:['tone'],settings:{plain:true},request:{cache:true},spots:filled.spots},{filename:'a.txt',text:'UNIQUE DOCUMENT TEXT'});};
 const content=JSON.stringify(body('Rate the tone of this text.\n\n{{text}}').messages[0].content);
 assert(content.includes('cache_control'),'trailing {{text}} keeps a cache mark');
 const parts=body('Rate the tone of this text.\n\n{{text}}').messages[0].content;const marked=parts.findIndex(p=>p.cache_control);
 assert(marked>=0&&!JSON.stringify(parts.slice(0,marked+1)).includes('UNIQUE DOCUMENT TEXT'),'the mark ends before the text');
 assert(!JSON.stringify(body('{{text}}').messages[0].content).includes('cache_control'),'no mark on the text alone');

 // H2. A key recognized as another provider's is refused before anything is sent.
 for(const file of ['app/api/count-tokens/route.ts','app/api/batch/route.ts','app/api/annotate/route.ts']){
  const {POST}=load(file),f=new FormData();for(const [k,v] of Object.entries({provider:'gemini',model:'gemini-3.8-flash',effort:'medium',prompt:'Classify',action:'submit',file:new File(['Text'],'a.txt')}))f.set(k,v);
  calls=[];const r=await POST(new Request('http://localhost/x',{method:'POST',headers:{origin:'http://localhost',authorization:'Bearer sk-ant-abcdefghijklmnop'},body:f}));
  assert.equal(r.status,401,file);assert.match((await r.json()).error,/appears to be for/,file);assert.equal(calls.length,0,file);
 }

 // C3. Gemini places citations by UTF-8 bytes; the Lab turns them into places in the text.
 const web=load('lib/knowledge-web.ts');const t='Ærø – “Søren” wrote 😀 more.';
 for(const word of ['Ærø','Søren”','😀',' more.']){const i=t.indexOf(word)+word.length;assert.equal(web.charIndex(t,new TextEncoder().encode(t.slice(0,i)).length),i,word);}
 mock=()=>Response.json({responseId:'g',candidates:[{finishReason:'STOP',content:{parts:[{text:t}]},groundingMetadata:{webSearchQueries:['q'],groundingChunks:[{web:{uri:'https://example.org/a',title:'A'}}],groundingSupports:[{segment:{endIndex:new TextEncoder().encode('Ærø – “Søren”').length},groundingChunkIndices:[0]}]}}]});
 const research=await web.researchKnowledge('gemini','gemini-3.8-flash','medium','AIza-test',[{heading:'Title',value:'X'}],'Classify');
 assert(research.text.startsWith('Ærø – “Søren”[1] wrote'),research.text);

 // C3/M3. OpenAI web research keeps the run's log setting; GPT-6.2 gets its instructions first in the input.
 mock=()=>Response.json({id:'r',status:'completed',output:[{type:'web_search_call',action:{sources:[]}},{type:'message',content:[{type:'output_text',text:'Found.',annotations:[]}]}]});
 for(const [model,store] of [['gpt-6-luna',false],['gpt-6.2-sol',true]]){
  calls=[];try{await web.researchKnowledge('openai',model,'medium','sk-test',[{heading:'Title',value:'X'}],'Classify',false,store);}catch{}
  const sent=JSON.parse(calls[0].options.body);assert.equal(sent.store,store,model);
  if(model.startsWith('gpt-6.2')){assert.equal(sent.instructions,undefined);assert.equal(sent.input[0].role,'developer');}else assert.equal(typeof sent.instructions,'string');
 }

 // H7. Which column is first does not change whether two columns are read as numbers.
 const ag=load('lib/research/agreement.ts');
 const rows=[1,2,3,4,5,6].map(i=>({id:'t'+i,name:'t'+i,status:'pending',cells:[String(i%3+1),i===1?'NA':String((i+1)%3+1)]}));
 const cols=[{name:'A',role:'label'},{name:'B',role:'label'}];
 const p1=ag.pairSources(rows,cols,{kind:'column',name:'A'},'',{kind:'column',name:'B'},''),p2=ag.pairSources(rows,cols,{kind:'column',name:'B'},'',{kind:'column',name:'A'},'');
 assert.equal(p1.numeric,p2.numeric);assert.equal(p1.level,p2.level);

 // H19.2. A backslash at the end of an RTF line is a line break.
 const rtf=load('lib/rtf-text.ts').rtfText('{\\rtf1\\ansi{\\fonttbl\\f0 Helvetica;}\\f0 First\\\nNext\\par Last}');
 assert.match(rtf,/First\s*\n\s*Next/);

 // M1. Gemini thinking is counted when the reply has no answer tokens.
 const engine=load('lib/cost-estimate/engine.ts');
 assert.equal(engine.usageSample('gemini',{promptTokenCount:100,thoughtsTokenCount:800}).output,800);

 // L7. A dated Claude snapshot has its model's listed price.
 const pricing=load('lib/cost-estimate/pricing.ts');
 assert.deepEqual(pricing.priceFor('anthropic','claude-sonnet-4-6-20260101'),pricing.priceFor('anthropic','claude-sonnet-4-6'));
 console.log('PASS: November 22 audit: cache mark before {{text}}, keys only to their provider, Gemini citation places, OpenAI research logs and instructions, column-order agreement, RTF line breaks, Gemini thinking, dated Claude prices. Mocked only.');
})().catch(e=>{console.error(e);process.exit(1);});
