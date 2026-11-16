// Research mode, Runs & agreement → Results: which fields of a run are summarized (typed fields that are not free
// text; plain-text scores that are mostly numbers), each text counted once with its combined value, and the figures
// (mean with a t interval, median, SD, below / at / above 0, shares of yes with Wilson intervals, categories in the
// order the run allowed them). The rules are in lib/research/summary-fields.ts and lib/research/summary.ts.
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
const {runItems,summaryFields}=load('lib/research/summary-fields.ts');
const {summarizeField,summarizeByGroup,runCounts,columnInfo,splitColumns,filterItems}=load('lib/research/summary.ts');
const {summaryCsvRows,csvColumns}=load('lib/research/figure.ts');

// A structured run: an ordinal scale, categories, a yes / no field, a number, and an explanation.
const settings={fields:[
 {name:'tone',type:'ordinal',values:['-3','-2','-1','0','1','2','3'],description:''},
 {name:'topic',type:'category',values:['Economy','War','Rights'],description:''},
 {name:'populist',type:'boolean',values:[],description:''},
 {name:'length',type:'number',values:[],description:''},
 {name:'explanation',type:'text',values:[],description:''},
]};
const tones=[-3,-2,-2,-1,-1,0,0,1,2,-2];
const rows=Array.from({length:12},(_,i)=>({id:'d'+i,name:`speech-${i}.txt`,cells:[String(1950+i*5),i%2?'D':'R'],
 ...(i===11?{status:'error',runNo:1,error:'failed'}:{status:'done',runNo:1,answerFields:settings.fields.map(f=>f.name),answerSettings:settings,
  answers:{f0:String(tones[i%10]),f1:['economy','War','War'][i%3],f2:i%4===0?'yes':'no',f3:String(100+i*10),f4:'Because.'}})}));
const columns=[{name:'year',role:'meta'},{name:'party',role:'meta'}];
const fields=summaryFields(rows,1);
assert.deepEqual(fields.map(f=>[f.key,f.level,f.yesNo]),[['tone','ordinal',false],['topic','nominal',false],['populist','nominal',true],['length','interval',false]],'free text is left out');
const items=runItems(rows,columns,1);
assert.deepEqual(runCounts(items),{total:12,annotated:11,fewer:0,failed:1,waiting:0});
assert.equal(items[0].meta.party,'R');
const [tone,topic,populist,length]=fields.map(f=>summarizeField(f,items));
// tone over the 11 answered texts: −3, −2, −2, −1, −1, 0, 0, 1, 2, −2, −3.
assert.equal(tone.kind,'scale');assert.equal(tone.n,11);assert.deepEqual(tone.range,[-3,3]);
assert.equal(tone.bins.length,7,'every point of the scale, also those no text got');
assert.ok(Math.abs(tone.mean-(-11/11))<1e-9);assert.equal(tone.median,-1);
assert.deepEqual(tone.sides,{below:7,middle:2,above:2});
assert.ok(tone.ci&&tone.ci[0]<tone.mean&&tone.ci[1]>tone.mean,'a t interval from 10 texts');
assert.equal(topic.kind,'categories');
assert.deepEqual(topic.bins.map(b=>[b.label,b.n]),[['Economy',4],['War',7],['Rights',0]],'in the allowed order, as the run wrote them');
assert.equal(populist.yes.n,11);assert.equal(populist.yes.share,3/11);assert.ok(populist.yes.ci);
assert.equal(length.kind,'number');assert.equal(length.min,100);assert.equal(length.max,200);
// Split by party and by year; a subset.
const split=splitColumns(columnInfo(items)).map(c=>c.name);
assert.deepEqual(split,['year','party']);
const byParty=summarizeByGroup(fields[0],items,'party');
assert.deepEqual(byParty.map(g=>[g.group,g.summary.n]),[['D',5],['R',6]]);
const byDecade=summarizeByGroup(fields[0],items,'year',10,true,true);
assert.deepEqual(byDecade.map(g=>g.group),['1950–1959','1960–1969','1970–1979','1980–1989','1990–1999','2000–2009']);
assert.equal(filterItems(items,{column:'year',from:1960,to:1975}).length,4);
// The numbers behind a figure: no app name, the run, and the counts.
const [table,cols]=csvColumns(summaryCsvRows([{name:'tone',s:tone}],{study:'S',run:'#1',model:'m',promptVersion:1}));
assert.equal(Number(table[0].mean),-1);assert.equal(table[0].n,11);
assert.ok(!cols.some(c=>/version|app/i.test(c)&&c!=='prompt_version'));

// A plain-text run whose replies are JSON: numeric keys are fields, words are not; scores read on the study's scale.
const plain=Array.from({length:10},(_,i)=>({id:'p'+i,name:`p-${i}`,status:'done',runNo:2,answerFields:['response'],answerSettings:{plain:true},
 answers:{f0:JSON.stringify({race:[-2,-1,0,1,2][i%5],flag:i%2,topic:'x'})}}));
const plainFields=summaryFields(plain,2);
assert.deepEqual(plainFields.map(f=>[f.key,f.scaleSeen,f.zeroOne]),[['race',true,false],['flag',true,true]]);
const flag=summarizeField(plainFields[1],runItems(plain,[],2));
assert.equal(flag.yes.word,'1');assert.equal(flag.yes.share,0.5);
const onScale=summaryFields(plain,2,{min:-3,max:3});
assert.deepEqual(onScale[0].range,[-3,3],'the study’s scale for the scores');
assert.equal(summarizeField(onScale[0],runItems(plain,[],2)).bins.length,7);
console.log('results panel: ok');
