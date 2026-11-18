// Research mode's Costs box: the estimate for the next run (current settings) comes first and names the model it
// prices; the cost of the last run follows below it, quieter, naming the model that run used. Jens saw a last run's
// $7.07 above a Luna estimate of $0.06–$0.16 and read them as two answers to one question (2026-11-18).
// No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let hookValues=[];
// A stand-in for React's hooks: the box is open and holds a finished estimate.
const hooks={useState(initial){return [hookValues.length?hookValues.shift():initial,()=>{}];},useRef(value){return {current:value};},useEffect(){},useId(){return 'cost';}};
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id==='react'?hooks:/\.css$/.test(id)?{}:id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+(fs.existsSync(path.resolve(path.dirname(filename),id+'.tsx'))?'.tsx':'.ts')))):req(id);new Function('exports','require',code)(exports,local);return exports;}

const React=req('react'),{renderToStaticMarkup}=req('react-dom/server');
const engine=load('lib/cost-estimate/engine.ts'),{default:CostEstimate}=load('lib/cost-estimate/panel.tsx'),cost=load('lib/cost-estimate/run-cost.ts');
const text=t=>t.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

// The last run: 130 texts annotated with GPT-6 Astra as a batch. The next run: the same 130 with GPT-6 Luna.
const usage={input_tokens:9000,output_tokens:1500,input_tokens_details:{cached_tokens:900},output_tokens_details:{reasoning_tokens:1300}};
const rows=Array.from({length:130},(_,i)=>({status:'done',runId:'r1',runStartedAt:'2026-11-18T19:00:00Z',runSize:130,provider:'openai',model:'gpt-6-astra',processing:'batch',usage,time:'2026-11-18T19:05:00Z'}));
const run=cost.latestRunCost(rows);
assert.deepEqual(run.models,['gpt-6-astra']);assert.equal(run.batch,true);
const inputs=Array.from({length:130},()=>({tokens:engine.textTokens('A journal article. '.repeat(1600))}));
const estimate=engine.estimate({provider:'openai',model:'gpt-6-luna',prompt:'Classify the article and explain briefly.',effort:'medium',maxTokens:12000,batch:true},inputs);
const box=research=>{hookValues=[true,{revision:'r',estimate},0,undefined];return text(renderToStaticMarkup(React.createElement(CostEstimate,{rows,research,model:'gpt-6-luna',batch:true,revision:'r',load:async()=>estimate})));};

const research=box(true);
assert.match(research,/Next run · estimate/);assert(!research.includes('Remaining · estimate'));
assert.match(research,/130 remaining annotations · GPT-6 Luna · Batch/,'The estimate names the model it prices');
assert.match(research,/Last run · cost 130 annotations · GPT-6 Astra · Batch/,'The last run names the model it used');
assert(research.indexOf('Next run · estimate')<research.indexOf('Last run · cost'),'The estimate comes first');
assert(!research.includes('Latest run'),'One name for the last run');

// The standard Lab keeps its box as it was: the latest run on top, then the queued annotations, no model names.
const standard=box(false);
assert(standard.indexOf('Latest run · 130 annotations')<standard.indexOf('Queued annotations · estimate'));
assert(!standard.includes('GPT-6'),'No model names in the standard Lab’s box');
console.log('PASS: research mode’s Costs box puts the next run’s estimate first and names each model; the standard Lab’s box is unchanged.');
