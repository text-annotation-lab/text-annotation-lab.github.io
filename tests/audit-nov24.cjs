// Regressions for the full-site review of November 24, 2026. Providers, prices, and messages: no temperature for
// the Gemini models that ignore one, cache minimums, cache-read prices, announced price changes, a value at the
// end of a prompt sent whole, no empty part before a PDF, a prompt that opens like the earlier layout, billing
// advice for an empty Claude balance, reasoning that cannot be turned off, long texts in other scripts, and a
// cost estimate that never falls below zero. Workspace, Model knowledge, and charts: long placeholder values,
// earlier results of a subject, declared scales, rounding, short bars, thin slices, labels, and legends. Mocked only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require(path.join(root,'node_modules/typescript')),req=createRequire(path.join(root,'package.json'));
const cache=new Map();let calls=[],mock=()=>Response.json({});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const local=id=>{const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;if(target===null)return req(id);return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');};
 new Function('exports','require','fetch',code)(exports,local,async(url,options)=>{calls.push({url,options});return mock(url,options);});return exports;
}
(async()=>{
 const rs=load('lib/request-settings.ts'),frame=load('lib/request-frame.ts'),inserts=load('lib/prompt-inserts.ts'),pricing=load('lib/cost-estimate/pricing.ts'),engine=load('lib/cost-estimate/engine.ts'),providers=load('lib/providers.ts');

 // Temperature. Google ignores one from Gemini 3.6 Flash and 3.5 Flash-Lite on, so none is sent or recorded.
 for(const [model,takes] of [['gemini-2.5-flash-lite',true],['gemini-3.1-flash-lite',true],['gemini-3.1-pro-preview',true],['gemini-3.5-flash-lite',false],['gemini-3.6-flash',false],['gemini-3.8-flash',false],['gemini-4-hydrogen',false],['gemini-4-argon',false],['gemini-4-carbon',false],['gemini-4-neon',false],['gemini-5-pro',false],['gemini-3.10-flash',false]]){
  assert.equal(rs.takesTemperature('gemini',model,'low'),takes,model);
  assert.equal(rs.takesTemperature('openrouter','google/'+model,'low'),takes,'google/'+model);
  const body=frame.providerBody({provider:'gemini',model,effort:'low',prompt:'Rate the tone.',schemaPrompt:'Rate the tone.',answerFields:[],request:{temperature:0.3}},{filename:'a.txt',text:'A text.'});
  assert.equal(body.generationConfig.temperature,takes?0.3:undefined,model);
  assert.deepEqual(rs.sentRequestSettings('gemini',model,{temperature:0.3},'low'),takes?{temperature:0.3}:undefined,model);
 }
 // OpenRouter offers OpenAI's models from GPT-5.6 on without a temperature; the direct API still takes one before GPT-6.2.
 for(const model of ['gpt-5.6-luna','gpt-6-luna','gpt-6-sol','gpt-6.1-terra','gpt-6.2-sol']){assert.equal(rs.takesTemperature('openrouter','openai/'+model,'medium'),false,model);assert.equal(rs.takesTemperature('openai',model,'medium'),!model.startsWith('gpt-6.2'),model);}
 assert.equal(rs.takesTemperature('openrouter','mistralai/mistral-small','medium'),true);

 // The shortest prompt a model caches.
 const least=(provider,model)=>rs.cacheSupport(provider,model)?.minTokens;
 for(const [model,min] of [['claude-haiku-5-5',512],['claude-sonnet-5-5',512],['claude-opus-5-5',512],['claude-fable-5-2',512],['claude-haiku-4-5-20251001',4096],['claude-opus-4-6',4096],['claude-opus-4-5',4096],['claude-opus-4-7',2048],['claude-mythos-preview',2048],['claude-opus-4-8',1024],['claude-sonnet-5',1024],['claude-sonnet-4-6',1024],['claude-sonnet-4-5',1024]])assert.equal(least('anthropic',model),min,model);
 for(const model of ['gemini-4-carbon','gemini-4-hydrogen','gemini-4-neon','gemini-4-argon','gemini-3.8-flash','gemini-3.6-flash'])assert.equal(least('gemini',model),4096,model);

 // Prices. Every model on the Lab's lists has a cache-read rate, so a run that read from the cache gets a cost.
 for(const [provider,spec] of Object.entries(providers.PROVIDERS))for(const model of spec.models)assert(pricing.priceFor(provider,model)?.cacheRead!==undefined,provider+' '+model+' has a cache-read rate');
 assert.equal(pricing.priceFor('openai','gpt-6-sol').cacheRead,.1);assert.equal(pricing.priceFor('gemini','gemini-4-hydrogen').cacheRead,.05);
 // A dated snapshot and its alias share a price.
 assert.deepEqual(pricing.priceFor('anthropic','claude-haiku-4-5'),pricing.priceFor('anthropic','claude-haiku-4-5-20251001'));assert(pricing.priceFor('anthropic','claude-haiku-4-5'));
 // Announced changes: Gemini 4 Carbon doubles on December 1, also through OpenRouter; Gemini 2.5 Pro and Flash
 // are then served, and billed, as newer models.
 const at=(provider,model,date)=>{const p=pricing.priceFor(provider,model,date);return [p.input,p.output];};
 assert.deepEqual(at('openrouter','google/gemini-4-carbon','2026-11-30'),[2,10]);assert.deepEqual(at('openrouter','google/gemini-4-carbon','2026-12-01'),[4,20]);
 assert.deepEqual(at('gemini','gemini-4-carbon','2026-11-30'),[2,10]);assert.deepEqual(at('gemini','gemini-4-carbon','2026-12-01'),[4,20]);
 const pro=pricing.priceFor('gemini','gemini-2.5-pro','2026-11-30'),later=pricing.priceFor('gemini','gemini-2.5-pro','2026-12-01'),flash=pricing.priceFor('gemini','gemini-3.8-flash','2026-12-01');
 assert(pro.threshold,'Gemini 2.5 Pro has a long-request price until December 1');assert.equal(later.threshold,undefined);assert.equal(later.longInput,undefined);assert.deepEqual([later.input,later.output],[flash.input,flash.output]);
 assert(!('from' in later),'the date of a change is not part of a price');

 // A value at the end of a prompt is sent whole: an empty one, or one that ends with a space, leaves the cache
 // mark where it is and the request as the record has it.
 {const prompt=frame.formText('Rate the sentiment.\nSpeaker: {{meta.speaker}}\n'),head='Rate the sentiment.\r\nSpeaker: ',settings={named:true,fields:[{name:'Sentiment',type:'category',values:['pos','neg'],description:''}]};
  const sent=value=>frame.providerBody({provider:'anthropic',model:'claude-haiku-5-5',effort:'low',prompt:inserts.fillInserts(prompt,[value]),schemaPrompt:prompt,answerFields:['Sentiment'],settings,request:{cache:true},inserts:true},{filename:'a.txt',text:'World'});
  const record=frame.requestFrame({provider:'anthropic',model:'claude-haiku-5-5',effort:'low',prompt,answerFields:['Sentiment'],answerSettings:settings,requestSettings:{cache:true},inserts:true,layout:'message'},false);
  for(const value of ['Lincoln','','Lincoln ','  ']){
   const body=sent(value),content=body.messages[0].content;
   assert.equal(content[0].text,head,'the part every text shares ends before the placeholder ('+JSON.stringify(value)+')');assert(content[0].cache_control);
   assert.equal(content.map(part=>part.text).join(''),head+value+'\n\n<text>\nWorld\n</text>');
   assert.deepEqual(frame.fillRequest(record.body,{filename:'a.txt',text:'World',inserts:new Map([['meta.speaker',value]])}),JSON.parse(JSON.stringify(body)),'the record, filled in, is the request ('+JSON.stringify(value)+')');
  }
  assert.equal(inserts.promptEnd('Rate. \n','Rate. \n'),'Rate.');assert.equal(inserts.promptEnd('Year: \r\n','Year: {{meta.year}}\n'),'Year: ');assert.equal(inserts.promptEnd('Year: 1900 \n\n','Year: {{meta.year}}\n\n'),'Year: 1900 ');assert.equal(inserts.promptEnd('By X.\nAnswer in JSON.\n','By {{id}}.\nAnswer in JSON.\n'),'By X.\nAnswer in JSON.');
 }
 // A prompt that is only the place for the text, with the instructions in the system prompt: a PDF goes alone.
 for(const provider of ['anthropic','openai','gemini','openrouter']){
  const model=providers.PROVIDERS[provider].models[0],body=frame.providerBody({provider,model,effort:'low',prompt:'',schemaPrompt:'{{text}}',answerFields:['S'],settings:{named:true,fields:[{name:'S',type:'category',values:['a','b'],description:''}]},request:{system:'Rate the tone.'},spots:[0]},{filename:'a.pdf',pdf:'AAAA'});
  const content=provider==='openai'?body.input[body.input.length-1].content:provider==='gemini'?body.contents[body.contents.length-1].parts:body.messages[body.messages.length-1].content;
  assert.equal(content.length,1,provider+': the PDF alone');assert(!content.some(part=>part.text===''||part.type==='text'||part.type==='input_text'),provider+': no empty text part');
 }
 // A prompt of today's layout that opens with the words the earlier layout opened its document line with.
 assert.deepEqual(frame.framePrompt('',[{type:'text',text:'Document filename: check tone.\n\n<text>\n<<DOCUMENT_TEXT>>\n</text>'}]),{prompt:'Document filename: check tone.'});
 assert.deepEqual(frame.framePrompt('Rate the tone.',[{type:'text',text:frame.documentNote('anthropic',false,'<<DOCUMENT_FILENAME>>')},{type:'text',text:'<<DOCUMENT_TEXT>>'}]),{prompt:'Rate the tone.'});
 assert.deepEqual(frame.framePrompt('Rate the tone.',frame.documentNote('openrouter',false,'<<DOCUMENT_FILENAME>>')+'\n\n<<DOCUMENT_TEXT>>'),{prompt:'Rate the tone.'});

 // An empty Claude balance arrives as HTTP 400: the advice is about billing, not about the document.
 {const {providerError}=load('lib/provider-errors.ts'),text=providerError('anthropic',400,{type:'error',error:{type:'invalid_request_error',message:'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'}});
  assert.match(text,/billing or credit problem/);assert(!/document/.test(text),text);assert.match(text,/\(HTTP 400\.\)$/);
  assert.match(providerError('anthropic',400,{type:'error',error:{type:'invalid_request_error',message:'messages: text content blocks must be non-empty'}}),/rejected the request/);
 }

 // OpenRouter: a model that must reason and names no levels is not offered "none".
 {const models=load('app/api/models/route.ts'),entry=(id,reasoning)=>({id,architecture:{output_modalities:['text']},supported_parameters:['reasoning'],reasoning});
  mock=async()=>Response.json({data:[entry('x/must',{mandatory:true,supported_efforts:null}),entry('x/may',{mandatory:false,supported_efforts:null}),entry('x/named',{mandatory:true,supported_efforts:['high','low']})]});
  const response=await models.POST(new Request('https://lab.test/api/models',{method:'POST',headers:{origin:'https://lab.test','X-Lab-Provider':'openrouter',authorization:'Bearer sk-or-v1-0123456789abcdef'}}));
  assert.deepEqual((await response.json()).models,[{id:'x/must',efforts:['minimal','low','medium','high','xhigh','max']},{id:'x/may'},{id:'x/named',efforts:['low','high']}]);
  assert(!providers.effortChoices('openrouter','x/must',['minimal','low','medium','high','xhigh','max']).includes('none'));
 }

 // A long text in another script is read and flagged, not passed over for its size in bytes.
 {const est=load('lib/student-estimate.ts'),russian=new File(['слово '.repeat(38500)],'russian.txt'),english=new File(['word '.repeat(20000)],'english.txt');
  assert(russian.size<200000*3.2,'the earlier shortcut would have passed this file over');
  const rows=[russian,english].map((file,i)=>({id:'r'+i,name:file.name,file,status:'pending'}));
  assert.deepEqual((await est.tooLongTexts({provider:'anthropic',model:'claude-haiku-4-5-20251001',prompt:'Classify the tone.',rows})).names,['russian.txt']);
 }

 // Cost estimate: with web research and prompt caching near a long-request price, no part falls below zero, and
 // the output-limit warning looks at every text.
 {const inputs=Array.from({length:10},()=>({tokens:{low:5000,high:5000}}));
  for(const webSearch of [true,false])for(const size of [60000,85500,120000,200000]){const e=engine.estimate({provider:'anthropic',model:'claude-haiku-5-5',effort:'low',prompt:'x'.repeat(size),system:'y'.repeat(92000),cache:true,webSearch},inputs,[]);assert(e.inputCost.low>=0&&e.inputCost.low<=e.inputCost.high,`input cost ${e.inputCost.low} to ${e.inputCost.high} (${size}, ${webSearch})`);}
  const warning=/output limit constrains/,config={provider:'gemini',model:'gemini-2.5-flash-lite',effort:'dynamic',prompt:'Rate the tone.',maxTokens:2500},short={tokens:{low:50,high:50}},long={tokens:{low:400000,high:400000}};
  const first=engine.estimate(config,[long,short]).notes.some(note=>warning.test(note)),last=engine.estimate(config,[short,long]).notes.some(note=>warning.test(note));
  assert.equal(first,last,'the order of the texts does not decide the warning');
 }
 // --- Workspace, Model knowledge, and charts -----------------------------------------------------------

 // A value too long for a placeholder is refused before a run, and a backup that holds one is still read.
 {const research=load('lib/research/inserts.ts'),columns=[{name:'Notes',role:'meta'},{name:'Gold',role:'label'}],long='x'.repeat(20001);
  assert.equal(research.longInsert(['id','meta.Notes'],[{name:'a.txt',cells:['short','']},{name:'b.txt',cells:['x'.repeat(20000),'']}],columns),'');
  assert.match(research.longInsert(['meta.Notes'],[{name:'a.txt',cells:['short','']},{name:'b.txt',cells:[long,'']}],columns),/^\{\{meta\.Notes\}\} has more than 20,000 characters for “b\.txt”.*Nothing was sent\.$/);
  assert.equal(research.longInsert(['meta.Gold','meta.Missing'],[{name:'b.txt',cells:['',long]}],columns),'','Human labels and missing columns are filled in empty');
  const backup=load('lib/study-backup.ts'),doc={id:'d1',name:'a.txt',file:new File(['Text'],'a.txt'),status:'error',error:'Refused.',prompt:'Rate {{meta.Notes}}.',inserts:[long],answerSettings:{named:true,slugKeys:true,fields:[{name:'Tone',type:'ordinal',values:['1','2','3'],description:''}]}};
  const restored=backup.decodeStudyBackup(await backup.encodeStudyBackup({name:'Long value',createdAt:'2026-11-24',texts:{docs:[doc]},knowledge:{items:[]}}));
  assert.equal(restored.texts.docs[0].inserts[0].length,20001);assert.equal(restored.texts.docs[0].answerSettings.slugKeys,true);
 }
 // Model knowledge: the detail pane of a subject gets the results of its earlier runs.
 {const knowledge=load('lib/research/knowledge.ts'),item=(id,run,score)=>({id,subjectId:'s1',runNumber:run,name:'Subject',fields:[],status:'done',score});
  const [subject]=knowledge.knowledgeRows([item('a',1,'2'),item('b',2,'4'),item('c',3,'5')]);
  assert.deepEqual(subject.earlier.map(entry=>[entry.runNo,entry.score]),[[1,'2'],[2,'4']]);assert.equal(subject.itemId,'c');
 }
 // Charts. A field typed as a scale is drawn on its declared scale, also after a pilot run with two scores.
 {const model=load('lib/chart-model.ts'),figures=load('lib/chart-figures.ts'),field={key:'f0',label:'Hope',name:'Hope'};
  const typed=values=>({named:true,fields:[{name:'Hope',type:'ordinal',values,description:''}]}),row=(id,answer,settings)=>({id,name:id+'.txt',status:'done',prompt:'Rate hopefulness.',answerFields:['Hope'],answerSettings:settings,answers:{f0:answer}});
  const wide=typed(['-3','-2','-1','0','1','2','3']);
  assert.deepEqual(model.suggestedScale([row('a','1',wide),row('b','2',wide)],field,[1,2]),{min:-3,max:3,type:'diverging',lowLabel:'',highLabel:'',source:'declared'});
  assert.equal(model.suggestedScale([row('a','1',wide),row('b','2',typed(['1','2','3','4','5']))],field,[1,2]).source,'data','Two runs with different scales: the scores decide');
  assert.equal(model.suggestedScale([row('a','1',typed(['low','high']))],field,[1]).source,'data','Values that are words are no scale');
  assert.equal(model.suggestedScale([row('a','7',wide)],field,[7]).source,'data','A score outside the declared values');
  // Halves round away from zero everywhere, and zero has no sign.
  assert.deepEqual([-0.5,0.5,-0.4,0.4,-1.5,2.5,0].map(model.scalePoint),[-1,1,0,0,-2,3,0]);assert(Object.is(model.scalePoint(-0.2),0));
  assert.equal(model.formatMean(-0.001),'0.00');assert.equal(model.formatMean(-0.19),'−0.19');assert.equal(model.formatNumber(-0),'0');assert.equal(model.formatNumber(-0.004),'0');assert.equal(model.formatNumber(-0.5),'−0.5');
  const unit=(key,number,extra={})=>({key,name:key,ids:[key],values:[String(number)],numbers:[number],value:String(number),number,explanation:'',...extra}),scale={min:-3,max:3,type:'diverging',lowLabel:'',highLabel:'',source:'declared'},o={width:860,interactive:false,noun:'subjects'};
  // Compare groups: an average of −0.5 lies below the center in both places, so its bar ends at the center line.
  {const units=[unit('a',-0.5,{group:'A'}),unit('b',-0.5,{group:'A'}),unit('c',1,{group:'B'}),unit('d',1,{group:'B'})],chart=figures.groupsView(units,['A','B'],scale,undefined,o);
   const bars=[...chart.svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+" rx="2" fill="#/g)].map(match=>({x:Number(match[1]),y:Number(match[2]),end:Number(match[1])+Number(match[3])}));
   assert.equal(bars.length,2);const [low,high]=bars[0].y<bars[1].y?bars:[bars[1],bars[0]];assert(Math.abs(low.end-high.x)<=2.01,`group A's bar ends (${low.end}) where group B's begins (${high.x})`);
   assert.match(figures.groupsView([unit('a',1,{group:'A'}),unit('c',1,{group:'B'}),unit('d',2,{group:'B'})],['A','B'],scale,undefined,o).notes.join(' '),/at least 2 subjects/);}
  // A short bar and a narrow bar stay above the axis; a thin slice of a stacked chart is still drawn.
  {const short=figures.distributionScale([...Array.from({length:90},(_,i)=>unit('h'+i,3)),unit('one',-3)],scale,o),ys=[...short.svg.matchAll(/<path d="M[\d.]+,250 V([\d.]+) /g)].map(match=>Number(match[1]));
   assert.equal(ys.length,2);assert(ys.every(y=>y<=250),'no bar starts below the axis: '+ys);
   const narrow=figures.distributionScale([unit('a',0),unit('b',20)],{min:0,max:20,type:'sequential',lowLabel:'',highLabel:'',source:'data'},{...o,width:280});
   const tops=[...narrow.svg.matchAll(/<path d="M([\d.]+),250 V[\d.]+ Q[\d.]+,[\d.]+ ([\d.]+),[\d.]+ H([\d.]+) /g)];assert.equal(tops.length,2);
   for(const match of tops)assert(Number(match[2])<=Number(match[3])+.011,'the top of a narrow bar does not fold over');
   assert(!/x1="([\d.]+)"[^>]*x2="([\d.]+)"[^>]*stroke="#cfd8e3"/.test(narrow.svg)||[...narrow.svg.matchAll(/x1="([\d.]+)"[^>]*x2="([\d.]+)"[^>]*stroke="#cfd8e3"/g)].every(match=>Number(match[1])<=Number(match[2])),'the mark of an empty score runs left to right');
   const members=[...Array.from({length:299},(_,i)=>unit('m'+i,1,{group:'A',year:1900})),unit('rare',3,{group:'A',year:1900}),unit('x',1,{group:'B',year:1950}),unit('y',2,{group:'B',year:1950})];
   const stacked=figures.groupsView(members,['A','B'],scale,undefined,o),shares=figures.timeShares(members,scale,undefined,10,o);
   assert(stacked.picks.some(pick=>pick.ids.includes('rare'))&&shares.picks.some(pick=>pick.ids.includes('rare')));
   const drawn=svg=>(svg.match(/<rect [^>]*rx="2" fill="#/g)||[]).length;
   assert.equal(drawn(stacked.svg),4,'every slice of Compare groups is drawn, also 1 of 300');assert.equal(drawn(shares.svg),4,'every slice of the periods chart is drawn');}
  // One year is written once under the axis; a long legend wraps before the right edge of a downloaded figure.
  {const dots=figures.timeDots([unit('a',1,{year:1945}),unit('b',2,{year:1945})],scale,false,o);assert.equal((dots.svg.match(/>1945</g)||[]).length,1);
   const legend=Array.from({length:6},(_,i)=>({label:'A rather long category name number '+i,color:'#123456'})),file=figures.exportFigure({svg:'',width:860,height:100,picks:[],notes:[]},'Title','Caption',legend);
   const starts=[...file.svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="12" height="12"/g)].map(match=>Number(match[1]));
   assert.equal(starts.length,6);legend.forEach((item,i)=>assert(starts[i]+17+item.label.length*6.6<=860-24+.01,'legend item '+i+' ends inside the figure'));}
 }
 console.log('audit-nov24 ok');
})().catch(error=>{console.error(error);process.exit(1);});
