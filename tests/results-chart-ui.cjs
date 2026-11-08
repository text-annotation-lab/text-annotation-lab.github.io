const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const cache=new Map();
function load(file){
 file=path.resolve(file);if(cache.has(file))return cache.get(file);
 const out={};cache.set(file,out);let source=fs.readFileSync(file,'utf8');
 if(file.endsWith('results-chart-dialog.tsx'))source+='\nexport {ChartBody,DistributionChart};';
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require',code)(out,id=>{
  if(id.endsWith('.css'))return {};
  if(id==='@/components/ui/button')return {Button:'button'};
  if(id==='@/components/ui/dialog')return {};
  if(!id.startsWith('.')&&!id.startsWith('@/'))return require(id);
  const base=id.startsWith('@/')?path.resolve(id.slice(2)):path.resolve(path.dirname(file),id);
  return load(base+(fs.existsSync(base+'.tsx')?'.tsx':'.ts'));
 });return out;
}
const {ChartBody,DistributionChart}=load('components/results-chart-dialog.tsx'),{ResultsFigure}=load('components/results-figure.tsx'),{chartData}=load('lib/results-chart.ts');
const rows=Array.from({length:500},(_,i)=>({id:String(i),name:'Text '+String(i+1).padStart(3,'0'),status:'done',score:String(i%7),explanation:'Explanation '+i}));
const data=chartData(rows,{key:'score',label:'Score'}),render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const overview=render(ChartBody,{rows,subjectLabel:'Document',onInspect:()=>{},chosen:'',onChoose:()=>{}});
assert.match(overview,/<option value="distribution" selected="">Score distribution/);assert(!overview.includes('Use Left and Right Arrow'));
const ranked={query:'',order:'highest',page:1};
const {ChartYearReview}=load('components/chart-year-review.tsx');
const datedRows=['Washington_1789.txt','letters_1861–1865.txt','reprint_1905.txt','Orwell_1984.txt'].map((name,i)=>({
 ...rows[i],name,...(i===2?{chartYear:1861}:i===3?{chartYear:null}:{}),
}));
const review=render(ChartYearReview,{rows:datedRows,onApply:()=>{},onCancel:()=>{}});
assert.match(review,/2 of 4 texts will be plotted/);
assert.match(review,/Year for Washington_1789.txt[^>]*value="1789"/);
assert.match(review,/Year for reprint_1905.txt[^>]*value="1861"/);
assert.match(review,/Year for Orwell_1984.txt[^>]*value=""/);
assert.match(review,/Year for letters_1861–1865.txt[^>]*value=""/);
assert.match(render(ChartBody,{rows:datedRows,subjectLabel:'Document',chosen:'',onSaveYears:()=>{}}),/<option value="year">Plot by year/);
const datedData=chartData([{...datedRows[0],chartYear:1789},datedRows[2]],{key:'score',label:'Score'});
const timeline=render(DistributionChart,{data:datedData,label:'Score',style:'year',ranked,onRankedChange:()=>{},onInspect:()=>{}});
assert.match(timeline,/data-figure-bin="0"/);assert.match(timeline,/>Year<\/text>/);
const datedExport=render(ResultsFigure,{data:datedData,label:'Score',style:'year',ranked,onBack:()=>{}});
const datedSvg=decodeURIComponent(datedExport.match(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/)[1]);
assert.match(datedSvg,/>1861<\/text>/);assert(!datedSvg.includes('1905'));assert.match(datedSvg,/>Year<\/text>/);
const rankedHtml=render(DistributionChart,{data,label:'Score',style:'ranked',ranked,onRankedChange:()=>{},onInspect:()=>{}});
assert.match(rankedHtml,/16–30 of 500 results/);assert.match(rankedHtml,/aria-label="Find a result by name"/);assert.match(rankedHtml,/<option value="highest" selected="">Highest first/);
assert.equal((rankedHtml.match(/data-figure-bin=/g)||[]).length,15);
const filtered=render(DistributionChart,{data,label:'Score',style:'ranked',ranked:{query:'Text 500',order:'highest',page:0},onRankedChange:()=>{},onInspect:()=>{}});
assert.match(filtered,/1–1 of 1 matches/);assert.match(filtered,/Text 500/);assert.equal((filtered.match(/data-figure-bin=/g)||[]).length,1);
const empty=render(DistributionChart,{data,label:'Score',style:'ranked',ranked:{query:'missing',order:'lowest',page:0},onRankedChange:()=>{},onInspect:()=>{}});
assert.match(empty,/No matching results/);assert.match(empty,/clear the search/);assert(!empty.includes('data-figure-bin'));
const exported=render(ResultsFigure,{data,label:'Score',style:'ranked',ranked,onBack:()=>{}});
assert.match(exported,/<option value="page" selected="">Current page/);assert.match(exported,/value="all" disabled=""/);
const src=exported.match(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/)[1],svg=decodeURIComponent(src);
assert.match(svg,/15 of 500 results/);assert.match(svg,/Results 16–30 of 500 in score order/);assert.equal((svg.match(/<circle /g)||[]).length,15);
console.log('PASS: large-study default, ranked search/order/page controls, no matches, and explicit page export scope.');
