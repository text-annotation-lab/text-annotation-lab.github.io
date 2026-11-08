const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
function load(file){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;}
const m=load('lib/chart-model.ts'),f=load('lib/chart-figures.ts');
const score={key:'score',label:'Score'},opts={latestOnly:true,combine:true},o={width:760,interactive:true,noun:'texts'},plain={...o,interactive:false};
const row=(value,i=0,extra={})=>({id:String(i),name:'Text '+i,status:'done',score:String(value),explanation:'PRIVATE EXPLANATION MUST NOT APPEAR',...extra});
const units=(rows,options=opts)=>m.buildUnits(rows,score,options).units;
const scale=(min,max,type)=>({min,max,type:type||(min<0&&max>0?'diverging':'sequential'),lowLabel:'',highLabel:'',source:'declared'});
const clean=svg=>{assert(!svg.includes('NaN'));assert(!svg.includes('Infinity'));assert(!svg.includes('undefined'));assert(!svg.includes('PRIVATE EXPLANATION'));};

// Inaugural study: 60 speeches on a 1–7 scale, which only used 3–7.
const inauguralScores={1789:7,1793:5,1797:7,1801:7,1805:7,1825:7,1829:6,1833:6,1837:7,1841:7,1845:6,1849:6,1853:7,1869:5,1873:5,1933:5,1937:5,1941:5,1945:3,1949:5,1953:6,1957:6,1961:5,1965:5,1969:5,1973:4,1977:4,1981:4,1985:4,1989:5,1993:5,1997:4,2001:4,2005:5,2009:5,2013:5,2017:3,2021:4,2025:3};
const inaugural=Array.from({length:60},(_,i)=>1789+4*i).map((year,i)=>row(inauguralScores[year]??6,i,{name:`${year}_President.txt`,prompt:'Rate formality from 1 to 7.'}));
const iu=units(inaugural),is=m.suggestedScale(inaugural,score,iu.map(u=>u.number));
assert.deepEqual([is.min,is.max,is.source],[1,7,'prompt']);
const dist=f.distributionScale(iu,is,o);clean(dist.svg);
assert.equal(dist.picks.length,5);// Scores 3–7 have bars; 1 and 2 show 0.
assert.equal(dist.picks.reduce((s,p)=>s+p.ids.length,0),60);
for(const label of ['>1<','>2<','>7<'])assert(dist.svg.includes(label));
assert.equal((dist.svg.match(/>0<\/text>/g)||[]).length,3);// two empty scores plus the count axis
const dots=f.timeDots(iu,is,true,o);clean(dots.svg);assert.equal(dots.picks.length,60);assert.match(dots.notes[0],/smoothed average/);
// Dots sit on their exact score: one row per score, and no vertical jitter.
const cys=new Set(Array.from(dots.svg.matchAll(/<circle cx="[^"]+" cy="([^"]+)"/g),x=>x[1]));assert.equal(cys.size,5);
assert(!dots.notes.some(n=>/side by side/.test(n)));
const shares=f.timeShares(iu,is,undefined,40,o);clean(shares.svg);assert.match(shares.svg,/1760–1799/);assert.equal(shares.picks.reduce((s,p)=>s+p.ids.length,0),60);
// Same year and score: dots sit side by side.
const twins=f.timeDots(units([row(5,1,{name:'1900_a.txt'}),row(5,2,{name:'1900_b.txt'}),row(4,3,{name:'1901_c.txt'})]),scale(1,7),false,o);
assert(twins.notes.some(n=>/side by side/.test(n)));

// Groups: F/M obituaries on a 1–7 scale, plus a diverging scale centered on zero.
const obits=Array.from({length:20},(_,i)=>row(i%2?(i%7)+1:((i+3)%7)+1,i,{name:`19${String(i).padStart(2,'0')}-01${i%2?'M':'F'}.txt`}));
const ou=m.buildUnits(obits,score,{...opts,groupRule:'end'}).units;assert.deepEqual(Array.from(new Set(ou.map(u=>u.group))).sort(),['F','M']);
const groups=f.groupsView(ou,['F','M'],scale(1,7),undefined,o);clean(groups.svg);assert.match(groups.svg,/Average, with 95% range/);assert.equal(groups.picks.reduce((s,p)=>s+p.ids.length,0),20);
const narrow=f.groupsView(ou,['F','M'],scale(1,7),undefined,{...o,width:340});clean(narrow.svg);assert(narrow.height>groups.height);
const div=f.groupsView(m.buildUnits(obits.map((r,i)=>({...r,score:String((i%7)-3)})),score,{...opts,groupRule:'end'}).units,['F','M'],scale(-3,3),undefined,o);clean(div.svg);assert.match(div.svg,/← lower/);

// Categories: one hue for a single distribution; more than seven categories fold into “Other”.
const cats=units(['A','B','A','C','D','E','F','G','H','I'].map((v,i)=>row(v,i,{name:`${1900+i}_x.txt`})));
const cd=f.distributionCategories(cats,o);clean(cd.svg);assert.equal(cd.picks[0].label,'A');assert.equal(cd.picks[0].ids.length,2);assert.match(cd.svg,/2 \(20%\)/);
assert.equal(new Set(Array.from(cd.svg.matchAll(/<rect x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" rx="3" fill="([^"]+)"/g),x=>x[1])).size,1);
const top7=['A','B','C','D','E','F','G'],cs=f.timeShares(cats,undefined,top7,5,o);clean(cs.svg);
assert.equal(cs.picks.reduce((s,p)=>s+p.ids.length,0),10);assert(cs.picks.some(p=>/Other/.test(p.label)));

// Runs: disagreements first.
const runs=[['s1',[3,3]],['s2',[2,6]],['s3',[4,5]]].flatMap(([s,v])=>v.map((x,i)=>row(x,s+i,{name:'Subject '+s,subjectId:s,runNumber:i+1})));
const rv=f.runsView(units(runs),scale(1,7),o);clean(rv.svg);assert.deepEqual(rv.picks.map(p=>p.label),['Subject s2','Subject s3','Subject s1']);assert.match(rv.svg,/✓ agree/);assert.match(rv.svg,/▲ differ by 4/);
const rc=f.runsView(units(runs.map(r=>({...r,score:r.runNumber===1?'YES':r.subjectId==='s1'?'YES':'NO'}))),undefined,o);clean(rc.svg);
assert.equal((rc.svg.match(/<g/g)||[]).length,(rc.svg.match(/<\/g>/g)||[]).length);

// Free numbers, close and extreme values never produce NaN, Infinity, or lost results.
for(const values of [[0],[.1234,.1235,.12351],[-1e308,1e308],Array.from({length:101},(_,i)=>i/100)]){
 const u=units(values.map((v,i)=>row(v,i))),fig=f.distributionNumbers(u,o);clean(fig.svg);assert.equal(fig.picks.reduce((s,p)=>s+p.ids.length,0),values.length);
}

// Every view keeps its tags balanced and escapes text.
const evil=units([row('<script> & "x"',1,{name:'<img onerror="bad"> & 1900.txt'}),row('B',2,{name:'1901_b.txt'})]);
for(const fig of [f.distributionCategories(evil,o),f.timeShares(evil,undefined,['<script> & "x"','B'],5,o),f.groupsView(evil.map(u=>({...u,group:'G<1>'})),['G<1>'],undefined,['<script> & "x"','B'],o)]){
 clean(fig.svg);assert(!fig.svg.includes('<script>'));assert(!fig.svg.includes('<img'));assert.equal((fig.svg.match(/<g[ >]/g)||[]).length,(fig.svg.match(/<\/g>/g)||[]).length);
}

// Exported figures: title, caption, legend, notes, white background; no interactive marks when drawn for export.
const exported=f.exportFigure(f.distributionScale(iu,is,plain),'Inaugural addresses became plainer & shorter','Formality for 60 texts. Scale 1 to 7.',[{label:'Low',color:'#86b6ef'}]);
clean(exported.svg);assert.match(exported.svg,/<title>Inaugural addresses became plainer &amp; shorter<\/title>/);assert.match(exported.svg,/Formality for 60 texts/);assert.match(exported.svg,/fill="#ffffff"/);assert(!exported.svg.includes('data-pick'));assert(!exported.svg.includes('pick-hit'));
assert(exported.width>760&&exported.height>dist.height);
assert.equal(f.fileName('Tone: over time / 1789–2025','png'),'Tone-over-time-17892025.png');assert.equal(f.fileName('???','svg'),'results-figure.svg');

// Colors: a single blue ramp for low-to-high scales; gray at the neutral point of a diverging scale.
assert.equal(f.scaleColor(scale(1,7),1),'#86b6ef');assert.equal(f.scaleColor(scale(1,7),7),'#082650');assert.equal(f.scaleColor(scale(-3,3),0),'#c3c2b7');
assert.notEqual(f.scaleColor(scale(-3,3),-3),f.scaleColor(scale(-3,3),3));assert.equal(f.scaleLabel(scale(-3,3),2),'+2');assert.equal(f.scaleLabel(scale(-3,3),-2),'−2');

// A large corpus draws quickly with exact counts.
const large=units(Array.from({length:5000},(_,i)=>row(i%7+1,i,{name:`${1800+i%200}_t${i}.txt`})));
const started=Date.now(),ld=f.distributionScale(large,scale(1,7),o),lt=f.timeDots(large,scale(1,7),true,o);assert(Date.now()-started<4000);
assert.equal(ld.picks.reduce((s,p)=>s+p.ids.length,0),5000);clean(lt.svg);
console.log('PASS: whole-scale distributions, exact dot positions, trend and periods, groups, categories with Other, run agreement, extreme values, safe SVG text, figure export, colors, and large sets.');
