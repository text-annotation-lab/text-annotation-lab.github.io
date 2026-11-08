const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
function load(file){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
const {chartFields,chartData,chartNumber,numericChartLayout}=load('lib/results-chart.ts');
const row=(id,score,status='done')=>({id,name:'Document '+id,status,score,explanation:'Existing explanation'});
const numeric=[row('zero','0'),row('negative','-3'),row('decimal','1.5'),row('pending','9','pending'),row('error','6','error'),row('unknown','INSUFFICIENT_KNOWLEDGE'),row('blank','  ')];
const original=JSON.stringify(numeric),score=chartFields(numeric)[0],data=chartData(numeric,score);
assert(data.numeric);assert.deepEqual(data.points.map(p=>p.number),[0,-3,1.5]);assert.equal(data.excluded,4);assert.equal(JSON.stringify(numeric),original);
assert.equal(data.mean,-.5);assert.equal(chartData([row('a','0')],score).mean,0);
assert.equal(chartData([row('a','YES')],score).mean,undefined);
assert.equal(chartData([row('a','1','pending')],score).mean,undefined);
assert.equal(chartData([row('a','1e308'),row('b','1e308')],score).mean,1e308);
assert.equal(chartData([row('a','1e308'),row('b','-1e308')],score).mean,0);
assert.deepEqual(chartFields([row('bad','5','error')]),[]);
for(const value of ['1–7','3 points','1,000','2026-11-05','50%','Infinity','NaN',''])assert.equal(chartNumber(value),null);
assert.equal(chartNumber('1e2'),100);assert.equal(chartNumber('-.5'),-.5);assert.equal(chartNumber('1e999'),null);
const mixed=[row('a','POSITIVE'),row('b','NEGATIVE'),row('c','POSITIVE'),row('d','positive'),row('e','1')];
const categories=chartData(mixed,score);assert(!categories.numeric);assert.equal(categories.categories[0].value,'POSITIVE');assert.deepEqual(categories.categories[0].points.map(p=>p.id),['a','c']);assert.equal(categories.categories.length,4);
const named=[{...row('old',''),answerFields:['Tone','Complexity','Explanation'],answers:{f0:'NEUTRAL',f1:'2',f2:'Named explanation'},explanation:''},{...row('reordered',''),answerFields:['Complexity','Tone'],answers:{f0:'3',f1:'POSITIVE'}},row('legacy','7')];
const fields=chartFields(named);assert.deepEqual(fields.map(f=>f.label),['Score / category','Tone','Complexity']);
const complexity=chartData(named,fields[2]);assert(complexity.numeric);assert.deepEqual(complexity.points.map(p=>p.value),['2','3']);assert.equal(complexity.points[0].explanation,'Named explanation');assert.equal(complexity.excluded,1);
assert.deepEqual(chartData(named,fields[0]).points.map(p=>p.id),['legacy']);
const repeated=chartData([{...row('run1','1'),name:'Same subject',runNumber:1},{...row('run2','2'),name:'Same subject',runNumber:2}],score);assert.equal(repeated.points.length,2);assert.match(repeated.points[1].name,/Run 2/);
const signed=[{...row('a','-3'),prompt:'Score: integer from -3 to 3.'},{...row('b','-2'),prompt:'Score: integer from -3 to 3.'}];
const signedData=chartData(signed,score);assert.deepEqual(signedData.scale,{min:-3,max:3});
const signedLayout=numericChartLayout(signedData.points,25,800,signedData.scale);assert.deepEqual(signedLayout.ticks.map(t=>t.value),[-3,-2,-1,0,1,2,3]);assert.deepEqual(signedLayout.xTicks,[1,5,10,15,20,25]);
assert(signedLayout.x(1)>signedLayout.left);assert(signedLayout.x(25)<signedLayout.right);
assert.equal(chartData([signed[0],{...signed[1],prompt:'Score: integer from -3 to 5.'}],score).scale,undefined);
assert.equal(chartData([signed[0],{...signed[1],prompt:undefined}],score).scale,undefined);
assert.equal(chartData([signed[0],{...signed[1],score:'4'}],score).scale,undefined);
assert.equal(chartData([{...signed[0],prompt:'Here are examples: Score: integer from -3 to 3.'}],score).scale,undefined);
const undeclared=numericChartLayout(chartData([row('a','-3'),row('b','-2')],score).points,2,800);assert(undeclared.ticks.every(t=>Number.isInteger(t.value)));
const namedScale=chartData([{...named[0],prompt:'Complexity: integer from 1 to 7.'},{...named[1],prompt:'Complexity: integer from 1 to 7.'}],fields[2]);assert.deepEqual(namedScale.scale,{min:1,max:7});
for(const values of [['0'],['-2','-2'],['1e308','-1e308'],['3.5','4.5']]){
 const points=chartData(values.map((value,i)=>row(String(i),value)),score).points,layout=numericChartLayout(points,points.length,320);
 for(const point of points){assert(Number.isFinite(layout.x(point.order)));assert(Number.isFinite(layout.y(point.number)));assert(layout.y(point.number)>=layout.top-1e-8&&layout.y(point.number)<=layout.bottom+1e-8);}
 for(const tick of layout.ticks){assert(Number.isFinite(tick.value));assert(Number.isFinite(tick.y));}
}
const many=Array.from({length:3100},(_,i)=>row(String(i),String(i%7))),all=chartData(many,score);assert.equal(all.points.length,3100);assert.equal(all.points[3099].order,3100);assert.equal(all.excluded,0);
console.log('PASS: numeric/category detection, exact category counts, completed-only filtering, missing and insufficient answers, recorded field mapping, explanations, repeated subjects, stable order, large sets, and finite chart coordinates.');
