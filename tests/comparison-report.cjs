// Research mode, the comparison report (Runs & agreement): two runs compared on every answer field both can be
// compared on, in one Excel workbook (Summary, Draft text, Review, a breakdown by a column, Runs, a table of the
// values per field, Notes), and “At a glance” above the statistics. The report is read here as its tables,
// without Excel; the panel is called with a small stand-in for React. No requests are sent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function instance(){const slots=[];let cursor=0;return {react:{useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useEffect(){cursor++;},useMemo(fn){cursor++;return fn();}},begin(){cursor=0;}};}
let current=instance();
const jsx=(type,props)=>({type,props});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>{
  if(id==='react')return new Proxy({},{get:(_,key)=>current.react[key]});
  if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
  if(id.endsWith('.css'))return {};
  if(id==='lucide-react'||id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});
  // The intervals are worked out in a browser worker; here they are not needed.
  if(id==='@/lib/research/intervals')return {computeIntervals:()=>()=>{},intervalsOf:async()=>({})};
  const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;
  if(target===null)return req(id);
  return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');
 };
 new Function('exports','require','confirm',code)(exports,local,(...args)=>global.confirm(...args));return exports;
}
function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
function mount(component,props){const mine=instance();return {tree(){current=mine;mine.begin();return component(props);}};}

const report=load('lib/research/comparison-report.ts'),agree=load('lib/research/agreement.ts'),panel=load('components/research/runs-panel.tsx');
const at='2026-11-16T10:00:00Z';
const sheetsBy=sheets=>Object.fromEntries(sheets.map(s=>[s.name,s.table]));
const records=table=>table.slice(1).map(row=>Object.fromEntries(table[0].map((h,i)=>[h,row[i]])));

// Two runs that give a score per text: run 1 (kept as an earlier result) and run 2, one point higher on every third.
const setup=model=>({provider:model==='gpt-6-luna'?'openai':'anthropic',model,effort:'medium',prompt:'Rate the tone from 1 to 5.',answerFields:[],promptVersion:1});
const scoreA=i=>String(i%5+1),scoreB=i=>i%3===0&&scoreA(i)!=='5'?String(Number(scoreA(i))+1):scoreA(i);
const scored=Array.from({length:12},(_,k)=>{const i=k+1;return {id:'t'+i,name:`speech-${i}.txt`,status:'done',...setup('claude-haiku-5-5'),runNo:2,score:scoreB(i),explanation:'Second: '+scoreB(i),time:at,startedAt:at,modelReported:'claude-sim',lab:'test',cells:[i<=6?'1960s':'1970s'],earlier:[{status:'done',...setup('gpt-6-luna'),runNo:1,score:scoreA(i),explanation:'First: '+scoreA(i),time:at,startedAt:at,modelReported:'gpt-sim',lab:'test'}]};});
const scoredSet={kind:'texts',rows:scored,runs:[{...setup('gpt-6-luna'),number:1,startedAt:at,label:'Pilot'},{...setup('claude-haiku-5-5'),number:2,startedAt:at}],columns:[{name:'decade',role:'meta'}],samples:[]};

(async()=>{
 // The sheets, their figures, and the order of the Review sheet.
 {
  const progress=[];
  const sheets=await report.comparisonSheets(scoredSet,1,2,{tolerance:1,groupBy:'decade',onProgress:note=>progress.push(note),now:new Date(at)});
  assert.deepEqual(sheets.map(s=>s.name),['Summary','Draft text','Review','By decade','Runs','Table Score / category','Notes']);
  assert.deepEqual(progress,['field 1 of 1','by decade, field 1 of 1']);
  const s=sheetsBy(sheets),[summary]=records(s.Summary);
  assert.equal(records(s.Summary).length,1,'No zeros on the scale: no “at least one non-zero” row');
  assert.deepEqual([summary.field,summary.texts,summary.level,summary.n_compared,summary.n_texts_in_both_runs,summary.exact_agreement,summary.within_1_point,summary.differ_2_or_more_points,summary.mean_difference_second_minus_first],['Score / category','all','ordinal',12,12,0.75,1,0,0.25]);
  assert(typeof summary.exact_agreement_ci_low==='number'&&typeof summary.krippendorff_alpha_ci_high==='number','The figures have 95% intervals');
  const [draft]=records(s['Draft text']);
  assert(draft.draft_text.startsWith('For Score / category, gpt-6-luna (run #1) and claude-haiku-5-5 (run #2) gave identical scores for 75.0% of texts (95% CI'),draft.draft_text);
  const review=records(s.Review);
  assert.deepEqual(s.Review[0],['document','field','decade','first','second','difference','category','first_explanation','second_explanation','random','judgment','note']);
  assert.equal(review.length,12);
  assert.deepEqual(review.slice(0,3).map(r=>[r.category,r.difference]),[['1 point',1],['1 point',1],['1 point',1]],'The differences come first');
  assert.deepEqual([review[0].first_explanation.slice(0,6),review[0].second_explanation.slice(0,7)],['First:','Second:']);
  assert(review.slice(3).every(r=>r.category==='agree (non-zero)'));
  assert.equal(review[0].random,report.stableRandom(`${review[0].document}|`),'The random column is fixed by the text and the field');
  const groups=records(s['By decade']);
  assert.deepEqual(groups.map(r=>[r.decade,r.n_compared,r.n_texts_in_both_runs]),[['1960s',6,6],['1970s',6,6]]);
  assert(!('texts' in groups[0]));
  const runs=Object.fromEntries(records(s.Runs).map(r=>[r.setting,[r.first,r.second]]));
  assert.deepEqual([runs.run,runs.provider,runs.model_reported_by_api,runs.texts_sent,runs.status],[['#1 (Pilot)','#2'],['openai','anthropic'],['gpt-sim','claude-sim'],['12','12'],['completed','completed']]);
  const table=s['Table Score / category'];
  assert.deepEqual(table[0],['first \\ second','1','2','3','4','5']);assert.deepEqual(table[2],['2',0,2,1,0,0]);
  const notes=records(s.Notes).map(r=>r.note).join(' ');
  assert(notes.includes('First: gpt-6-luna (run #1). Second: claude-haiku-5-5 (run #2).')&&notes.includes('“By decade” sheet')&&notes.includes('10,000 resamples'),notes);
  // The workbook itself.
  const bytes=await report.comparisonReport(scoredSet,1,2,{tolerance:1});
  assert(bytes.byteLength>3000,'An Excel file is made');
 }
 // An ordinal −3 to 3 field with its own explanation: shared zeros, opposite directions, and the breakdown column
 // named like one of the report's own columns.
 {
  const fields={fields:[{name:'tone',type:'ordinal',values:['-3','-2','-1','0','1','2','3'],description:''},{name:'tone_explanation',type:'text',values:[],description:''}]};
  const pairs=[['0','0'],['0','0'],['0','0'],['0','0'],['-2','2'],['3','1'],['1','1'],['2','1'],['-1','-1'],['1','2'],['0','1'],['-3','-3']];
  const typed=(run,value,i)=>({status:'done',runNo:run,...setup('gpt-6-luna'),answerFields:['tone','tone_explanation'],answerSettings:fields,answers:{f0:value,f1:`Run ${run} on text ${i}`},score:'',explanation:'',time:at,startedAt:at,lab:'test'});
  const rows=pairs.map(([x,y],i)=>({id:'r'+i,name:`r${i}.txt`,...typed(2,y,i),cells:[i%2?'odd':'even'],earlier:[typed(1,x,i)]}));
  const sheets=sheetsBy(await report.comparisonSheets({kind:'texts',rows,runs:[],columns:[{name:'category',role:'meta'}],samples:[]},1,2,{tolerance:1,groupBy:'category'}));
  const summary=records(sheets.Summary);
  assert.deepEqual(summary.map(r=>[r.field,r.texts,r.n_compared]),[['tone','all',12],['tone','at least one non-zero',8]],'The explanation is not compared, and the shared zeros get a row of their own');
  assert.equal(summary[0].opposite_direction,0.0833);
  const review=records(sheets.Review);
  assert.deepEqual(sheets.Review[0].slice(0,4),['document','field','group_category','first'],'A breakdown column named like a column of the report gets a prefix');
  assert.deepEqual(review.slice(0,2).map(r=>[r.document,r.category]),[['r4.txt','opposite direction'],['r5.txt','2+ points']]);
  assert.deepEqual(review.slice(-4).map(r=>r.category),['agree (zero)','agree (zero)','agree (zero)','agree (zero)']);
  assert.equal(review[0].first_explanation,'Run 1 on text 4','The field’s own explanation');
  assert(records(sheets['Draft text'])[0].draft_text.includes('On the 8 texts where at least one run gave a non-zero score'));
  assert(sheets['By category']&&records(sheets['By category']).map(r=>r.group_category).join()==='even,odd');
 }
 // Two runs with no field in common: a report that says so.
 {
  const rows=[{id:'x',name:'x.txt',status:'done',runNo:2,...setup('gpt-6-luna'),answerFields:['a'],answers:{f0:'1'},score:'',earlier:[{status:'done',runNo:1,...setup('gpt-6-luna'),answerFields:['b'],answers:{f0:'1'},score:''}]}];
  const sheets=sheetsBy(await report.comparisonSheets({kind:'texts',rows,runs:[],columns:[],samples:[]},1,2,{tolerance:1}));
  assert(records(sheets.Notes).some(r=>r.note.startsWith('The two runs have no answer field in common')));
  await assert.rejects(()=>report.comparisonSheets({kind:'texts',rows,runs:[],columns:[],samples:[]},1,7,{tolerance:1}),/Both runs must have results/);
 }
 // Scores with no declared scale: the scale is read from both runs' answers, whichever comes first.
 {
  const rows=['1','2','3'].map((x,i)=>({id:'p'+i,name:'p'+i,status:'done',runNo:2,score:['1','4','5'][i],earlier:[{status:'done',runNo:1,score:x}]}));
  const forward=agree.pairSources(rows,[],{kind:'run',run:1},'',{kind:'run',run:2},''),back=agree.pairSources(rows,[],{kind:'run',run:2},'',{kind:'run',run:1},'');
  assert.deepEqual([forward.range,back.range],[[1,5],[1,5]]);
  assert(forward.basis.startsWith('Scale: read from the two runs’ answers, 1 to 5'));
 }
 // The draft sentence: a clear shift, and small numbers that are not shown as 0.00.
 {
  const s={n:40,level:'ordinal',percentAgreement:0.5,withinTolerance:0.9,tolerance:1,largeDifference:0.05,oppositeDirection:0.025,weightedKappaLinear:0.6,gwetAC2Linear:0.7,krippendorffAlpha:0.65,cohenKappa:0.4,meanDifference:0.004,ci:{meanDifference:[0.001,0.009],percentAgreement:[0.35,0.65]}};
  const sentence=report.comparisonSentence('tone','A','B',s,50);
  assert(sentence.includes('(N = 40 of 50 texts sent in both runs)')&&sentence.includes('B scored on average 0.004 points higher than A (95% CI 0.001 to 0.01).'),sentence);
  assert(report.comparisonSentence('tone','A','B',{...s,meanDifference:-0.3,ci:{meanDifference:[-0.5,0.1]}},40).includes('no clear systematic difference between the two (mean difference −0.30, 95% CI −0.50 to 0.10)'));
 }
 // Columns offered for a breakdown: 2 to 30 different values.
 {
  const rows=Array.from({length:40},(_,i)=>({id:String(i),cells:[i%2?'a':'b',String(i),'same']}));
  assert.deepEqual(report.groupColumns({kind:'texts',rows,runs:[],columns:[{name:'era',role:'meta'},{name:'id',role:'meta'},{name:'one',role:'label'}],samples:[]}),['era']);
 }
 // The panel: “At a glance”, and the report button only when two runs are compared.
 {
  const props={datasets:[scoredSet],studyName:'S',locked:false,onShowRun(){},onDeleteRun(){},onOpenText(){},onRenameRun(){},onRetryRun(){}};
  const view=mount(panel.RunsPanel,props);let tree=view.tree();
  const selects=()=>nodes(tree).filter(n=>n.type==='select');
  selects().find(n=>n.props.id==='agreement-a').props.onChange({target:{value:'run:1'}});tree=view.tree();
  selects().find(n=>n.props.id==='agreement-b').props.onChange({target:{value:'run:2'}});tree=view.tree();
  const glance=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='Glance');assert(glance,'At a glance is shown');
  current=instance();const words=text(glance.type(glance.props));
  assert(words.includes('9 texts (75%) got the same answer from both sides; 3 texts (25%) got different answers.')&&words.includes('Off by 1: 3 (25%)'),words);
  const buttons=nodes(tree).filter(n=>n.type==='Button').map(text);
  assert(buttons.includes('Download comparison report (Excel)'),buttons.join(' | '));
  assert.deepEqual(nodes(selects().find(n=>String(n.props.className).includes('research-report-groups'))).filter(n=>n.type==='option').map(text),['No breakdown','Break down by decade']);
  selects().find(n=>n.props.id==='agreement-b').props.onChange({target:{value:'col:decade'}});tree=view.tree();
  assert(!nodes(tree).filter(n=>n.type==='Button').map(text).some(t=>t.includes('comparison report')),'A run against a column has no report');
 }
 console.log('Comparison report: Summary, Draft text, Review, breakdown, Runs, tables, and Notes; At a glance.');
})().catch(error=>{console.error(error);process.exit(1);});
