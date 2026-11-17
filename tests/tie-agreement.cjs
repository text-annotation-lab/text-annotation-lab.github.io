const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>{
  const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;
  if(target===null)return req(id);
  return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');
 };
 new Function('exports','require',code)(exports,local);return exports;
}
// Research mode, several annotations per text: a tied majority vote ("a | b") is no answer the model gave, so the
// agreement figures leave the text out and say so, and "Disagree" / "Agree" leave it out too (Jens, 2026-11-17).
const metrics=load('lib/research/metrics.ts'),agreement=load('lib/research/agreement.ts'),comparable=load('lib/research/comparable.ts');
const cats=['positive','negative','mixed'];
const a=['positive','mixed | negative','negative','mixed','positive','negative | positive'];
const b=['positive','negative','negative','positive','positive','positive'];
const s=metrics.agreement(a,b,'nominal',cats);
assert.equal(s.n,4);
assert.equal(s.leftOut.n,2);
assert.equal(s.leftOut.ties,2);
assert.deepEqual(s.leftOut.tiedValues,['mixed | negative','negative | positive']);
assert.equal(s.percentAgreement,0.75);
assert.ok(!s.categories.some(c=>c.includes(' | ')));
assert.equal(agreement.leftOutNote(s,'text','value'),'2 texts were left out because the annotations tied, with no majority: “mixed | negative”, “negative | positive”.');
// A tie is left out also when most answers are ties (no fallback to comparing them as words).
const most=metrics.agreement(['a | b','a | b','b | c','a'],['a','b','c','a'],'nominal',['a','b','c']);
assert.equal(most.n,1);assert.equal(most.leftOut.ties,3);
// Without declared categories, too.
assert.equal(metrics.agreement(['x | y','x'],['x','x'],'nominal').n,1);
// Mixed with other values left out: both are reported.
const both=metrics.agreement(['1','2 | 3','9','4','5'],['1','2','3','4','5'],'ordinal',['1','2','3','4','5']);
assert.equal(both.leftOut.ties,1);assert.equal(both.leftOut.n,2);
assert.match(agreement.leftOutNote(both,'text','value'),/^1 text was left out because the annotations tied.*1 text was left out because a value was not a number on the scale 1 to 5: “9”\.$/);
// "Disagree" and "Agree" in the Workspace keep the same pairs.
const fits=comparable.comparableValues(a.map((x,i)=>[x,b[i]]),'nominal',cats);
assert.equal(fits('mixed | negative'),false);assert.equal(fits('mixed'),true);
console.log('tie agreement ok');
