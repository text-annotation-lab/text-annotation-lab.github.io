const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('exports','require',code)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+(id.includes('summary')?'.tsx':'.ts')):require(id));return exports;}
const {recordedCost,latestRunCost}=load('lib/cost-estimate/run-cost.ts');
const row=(id,cost,extra={})=>({runId:id,runStartedAt:id==='old'?'2026-11-01T10:00:00Z':'2026-11-01T11:00:00Z',runSize:2,status:'done',provider:'openrouter',model:'openai/gpt-6-luna',usage:{cost,prompt_tokens:100,completion_tokens:20},...extra});
let s=latestRunCost([row('old',1),row('new',.03),row('new',.04)]);assert.equal(s.amount,.07);assert.equal(s.known,2);assert.equal(s.calculated,0);assert.equal(s.legacy,false);
s=latestRunCost([row('new',0),row('new',undefined,{status:'error',usage:undefined})]);assert.equal(s.known,1);assert.equal(s.missing,1);assert.equal(s.amount,0);
s=latestRunCost([row('new',.03,{runSize:8}),row('new',undefined,{status:'running',usage:undefined,runSize:8})]);assert.equal(s.planned,8);assert.equal(s.count,2);assert.equal(s.active,1);
s=latestRunCost([{status:'pending',history:[row('new',.05,{status:'error'})]},row('old',2)]);assert.equal(s.amount,.05,'Retry queuing retains the previous charge');
s=latestRunCost([{status:'done',provider:'openrouter',usage:{cost:.1}},{status:'error',usage:undefined}]);assert(s.legacy);assert.equal(s.missing,1);
assert.equal(latestRunCost([{status:'pending'}]),undefined);
assert.equal(recordedCost(row('new',-1,{usage:{cost:-1}})),undefined);assert.equal(recordedCost(row('new',Infinity,{usage:{cost:Infinity}})),undefined);
const oa={status:'done',provider:'openai',model:'gpt-6-luna',usage:{input_tokens:1000,output_tokens:100,output_tokens_details:{reasoning_tokens:80}}};
assert.equal(recordedCost(oa).amount,.00015);assert.equal(recordedCost({...oa,processing:'batch'}).amount,.000075);assert.equal(recordedCost({...oa,webSearch:true}),undefined);assert.equal(recordedCost({...oa,usage:{...oa.usage,input_tokens_details:{cached_tokens:500}}}),undefined);
const gemini={status:'done',provider:'gemini',model:'gemini-3.1-flash-lite',usage:{promptTokenCount:1000,candidatesTokenCount:100,thoughtsTokenCount:200}};assert.equal(recordedCost(gemini).amount,.0007);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{RunCostSummary}=load('lib/cost-estimate/run-cost-summary.tsx');
const html=rows=>renderToStaticMarkup(React.createElement(RunCostSummary,{rows}));
assert.match(html([row('new',.03),row('new',.04)]),/Actual cost reported by OpenRouter/);assert.match(html([row('new',0),row('new',undefined,{status:'error',usage:undefined})]),/Incomplete total/);assert.match(html([oa]),/Calculated cost \(estimate\)/);assert.match(html([{status:'done'}]),/Cost unavailable/);assert.match(html([row('new',.000001)]),/&lt; \$0.0001/);
console.log('PASS: latest-run grouping, saved legacy costs, retry history, zero vs unknown charges, partial and paused totals, no reasoning double-counting, batch rates, cache/search exclusions, and rendered billing labels.');
