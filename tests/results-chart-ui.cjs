const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const cache=new Map();
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file);
 const out={};cache.set(file,out);const source=fs.readFileSync(file,'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require',code)(out,id=>{
  if(id.endsWith('.css'))return {};
  if(id==='@/components/ui/button')return {Button:({variant,...props})=>React.createElement('button',props)};
  if(id==='@/components/ui/dialog')return {};
  if(!id.startsWith('.')&&!id.startsWith('@/'))return require(id);
  const base=id.startsWith('@/')?path.resolve(id.slice(2)):path.resolve(path.dirname(file),id);
  return load(base+(fs.existsSync(base+'.tsx')?'.tsx':'.ts'));
 });return out;
}
const {ChartBody}=load('components/results-chart-dialog.tsx'),{ChartReview}=load('components/chart-review.tsx');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const base={subjectLabel:'Document',onInspect:()=>{},onSaveYears:()=>{},onSaveGroups:()=>{}};
const row=(i,score,extra={})=>({id:String(i),name:`${1789+4*i}_President.txt`,status:'done',score:String(score),explanation:'Explanation '+i,prompt:'Rate formality from 1 to 7.',model:'model-a',...extra});

// The inaugural study opens on the whole 1–7 distribution with plain statistics.
const inaugural=Array.from({length:60},(_,i)=>row(i,[7,6,5,4,3][i%5]));
const html=render(ChartBody,{...base,rows:inaugural});
assert.match(html,/<b>60<\/b> texts plotted/);assert.match(html,/Scale 1 to 7/);assert.match(html,/Edit scale/);
for(const tab of ['Distribution','Over time','Compare groups','Ranked list'])assert.match(html,new RegExp(`role="tab"[^>]*>${tab}<`));
assert(!html.includes('Run agreement'));assert(!html.includes('different settings'));
assert.match(html,/Middle score \(median\)/);assert.match(html,/Most common/);assert.match(html,/How to read this:/);assert.match(html,/Download figure/);
assert.match(html,/data-pick="0"/);assert(!html.includes('NaN'));

// Mixed settings are flagged and default to the latest ones.
const mixed=render(ChartBody,{...base,rows:[...inaugural.slice(0,40),...inaugural.slice(40).map(r=>({...r,model:'model-b'}))]});
assert.match(mixed,/These results come from 2 different settings/);assert.match(mixed,/Chart only the latest settings \(20 texts\)/);assert.match(mixed,/<b>20<\/b> texts plotted/);

// Chunks are counted once per document by default.
const chunks=[1,2,3].flatMap(d=>[1,2].map(c=>({...row(d*10+c,3+c),name:`doc${d} chunk ${c}`,sourceId:'doc'+d,sourceName:`doc${d}.txt`,chunkIndex:c})));
const chunked=render(ChartBody,{...base,rows:chunks});assert.match(chunked,/<b>3<\/b> texts plotted/);assert.match(chunked,/One value per document/);

// Model knowledge: runs are combined per subject and get their own tab.
const runs=['a','b'].flatMap(s=>[1,2].map(n=>({...row(s+n,n===1?3:5),name:'Subject '+s,subjectId:s,runNumber:n})));
const knowledge=render(ChartBody,{...base,subjectLabel:'Subject',rows:runs});assert.match(knowledge,/<b>2<\/b> subjects plotted/);assert.match(knowledge,/Run agreement/);assert.match(knowledge,/One value per subject/);

// Written answers are listed, not charted.
const prose=Array.from({length:30},(_,i)=>row(i,`A long and different written answer about speech number ${i}, with its own wording.`));
const listed=render(ChartBody,{...base,rows:prose});assert.match(listed,/holds written answers rather than scores or categories/);assert(!listed.includes('role="tab"'));assert.match(listed,/Find a text/);

// Year review: suggestions from filenames, typed years win, blanks are left out.
const datedRows=['Washington_1789.txt','letters_1861–1865.txt','reprint_1905.txt','Orwell_1984.txt'].map((name,i)=>({...row(i,4),name,...(i===2?{chartYear:1861}:i===3?{chartYear:null}:{})}));
const {buildUnits,suggestedRowYear}=load('lib/chart-model.ts');
const units=buildUnits(datedRows,{key:'score',label:'Score'},{latestOnly:true,combine:true}).units;
const entries=units.map(unit=>{const r=datedRows.find(x=>x.id===unit.ids[0]);return {unit,initial:r.chartYear===null?'':typeof r.chartYear==='number'?String(r.chartYear):String(suggestedRowYear(r)??'')};});
const review=render(ChartReview,{kind:'year',entries,noun:'texts',onApply:()=>{},onCancel:()=>{}});
assert.match(review,/2 of 4 texts will be plotted/);
assert.match(review,/Year for Washington_1789.txt[^>]*value="1789"/);assert.match(review,/Year for reprint_1905.txt[^>]*value="1861"/);
assert.match(review,/Year for Orwell_1984.txt[^>]*value=""/);assert.match(review,/Year for letters_1861–1865.txt[^>]*value=""/);
assert(review.indexOf('Orwell_1984.txt')<review.indexOf('Washington_1789.txt'));// Gaps first.

// Group setup: rule choice, renaming, and counts.
const groupEntries=units.map((unit,i)=>({unit,initial:['F','M','F',''][i]}));
const groupReview=render(ChartReview,{kind:'group',entries:groupEntries,noun:'texts',onApply:()=>{},onCancel:()=>{},rules:[{value:'end',label:'The end of each filename'},{value:'',label:'Nothing (type them in)'}],rule:'end',onRuleChange:()=>{}});
assert.match(groupReview,/Suggest groups from/);assert.match(groupReview,/Rename group F/);assert.match(groupReview,/3 of 4 texts will be plotted in 2 groups/);

// Large corpora page their tables.
const many=Array.from({length:3000},(_,i)=>({...row(i,(i%7)+1),name:`text_${i}.txt`}));
assert.match(render(ChartBody,{...base,rows:many}),/<b>3000<\/b> texts plotted/);
assert.match(render(ChartReview,{kind:'year',entries:buildUnits(many,{key:'score',label:'Score'},{latestOnly:true,combine:true}).units.map(unit=>({unit,initial:''})),noun:'texts',onApply:()=>{},onCancel:()=>{}}),/1–20 of 3000/);
console.log('PASS: inaugural defaults, mixed settings, chunks and runs, written answers, year review, group setup, and large corpora.');
