// Research mode before a run: the effort a model change keeps, the texts probably too long for a Claude model,
// and the question with the estimated cost before a run of more than 50 requests. No requests are sent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
let calls=[],mock=async()=>Response.json({});
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;}

(async()=>{
 const est=load('lib/student-estimate.ts'),pricing=load('lib/cost-estimate/pricing.ts'),providers=load('lib/providers.ts');
 // One rule for the effort when the model changes: the current one where the model takes it, else medium, else the first.
 assert.equal(providers.pickEffort('high',['low','medium','high']),'high');assert.equal(providers.pickEffort('xhigh',['low','medium','high']),'medium');
 assert.equal(providers.pickEffort('medium',['off','1024','4096','8192']),'off');assert.equal(providers.pickEffort('low',[]),'');
 // Context windows: Claude only, directly or through OpenRouter.
 assert.equal(pricing.contextWindow('anthropic','claude-haiku-4-5-20251001'),200000);assert.equal(pricing.contextWindow('anthropic','claude-sonnet-5-5'),1000000);assert.equal(pricing.contextWindow('anthropic','claude-fable-5-2'),1000000);
 assert.equal(pricing.contextWindow('openrouter','anthropic/claude-haiku-5.5'),1000000);assert.equal(pricing.contextWindow('openai','gpt-6-luna'),undefined);assert.equal(pricing.contextWindow('openrouter','openai/gpt-6-luna'),undefined);
 // Too long: about 900,000 characters is more than Claude Haiku 4.5 takes, not Claude Sonnet 5.5.
 const big=new File(['word '.repeat(180000)],'big.txt'),small=new File(['A short text.'],'small.txt');
 const row=(file,i)=>({id:'r'+i,name:file.name,file,status:'pending'}),rows=[row(big,0),row(small,1)];
 assert.deepEqual(await est.tooLongTexts({provider:'anthropic',model:'claude-haiku-4-5-20251001',prompt:'Classify the tone.',rows}),{window:200000,names:['big.txt']});
 assert.deepEqual((await est.tooLongTexts({provider:'anthropic',model:'claude-sonnet-5-5',prompt:'Classify the tone.',rows})).names,[]);
 assert.deepEqual(await est.tooLongTexts({provider:'openai',model:'gpt-6-luna',prompt:'Classify the tone.',rows}),{names:[]});
 // The question before a run: none up to 50 requests; above that, the requests, the model, and the estimated cost.
 const many=n=>Array.from({length:n},(_,i)=>row(small,i)),base={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Classify the tone.',samples:[],times:1,unit:'text'};
 assert.equal(await est.runQuestion({...base,rows:many(50)}),undefined);
 assert.match(await est.runQuestion({...base,rows:many(51)}),/^Send 51 requests to gpt-6-luna\? Provider charges apply: about (<?\$[\d.]+(–\$[\d.]+)?|less than \$0\.001) \(a rough guide; see the cost estimate for how it is worked out\)\.$/);
 assert.match(await est.runQuestion({...base,rows:many(26),times:2,batch:true}),/^Submit a batch of 52 requests to gpt-6-luna \(26 texts × 2 annotations\)\? Provider charges apply: about .* at batch price \(½\)/);
 assert.match(await est.runQuestion({...base,provider:'openai',model:'unlisted-model',rows:many(60)}),/Provider charges apply: no price known for this model\./);
 const long=await est.runQuestion({...base,provider:'anthropic',model:'claude-haiku-4-5-20251001',rows});
 assert.match(long,/^Send 2 requests to claude-haiku-4-5-20251001\? Provider charges apply: .*\n\n1 text is probably too long for this model \(about 200k tokens including the answer\), e\.g\. big\.txt\. Those requests will most likely fail\.$/s);
 assert.match(await est.runQuestion({...base,rows:many(51).map(r=>({...r,fields:[{heading:'Film',value:'Jaws'}]})),knowledge:true,unit:'subject'}),/^Send 51 requests to gpt-6-luna\?/);
 console.log('run checks: ok');
})().catch(error=>{console.error(error);process.exit(1);});
