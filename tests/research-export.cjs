// The Export tab's files: the tables, agreement with human labels, the Excel workbook, both repositories,
// and the Python script, which is run against a local stand-in for each provider. No provider is called.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFile,spawnSync}=require('node:child_process'),ts=require('../node_modules/typescript');
const root=process.cwd(),cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);
 const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(exports,id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):require(id));
 return exports;
}
const frames=load('lib/request-frame.ts'),records=load('lib/research/requests.ts'),data=load('lib/research/export-data.ts'),tables=load('lib/research/export-tables.ts'),agreement=load('lib/research/export-agreement.ts'),packages=load('lib/research/export-packages.ts'),python=load('lib/research/export-python.ts'),workbook=load('lib/research/export-workbook.ts');
const agree=load('lib/research/agreement.ts'),formats=load('lib/answer-fields.ts'),knowledgeLib=load('lib/research/knowledge.ts'),knowledgeText=load('lib/model-knowledge.ts'),{toCsv}=load('lib/research/parse-table.ts');
const ExcelJS=require('exceljs'),JSZip=require('jszip');

// A CSV file read back: rows of cells, without the byte-order mark.
function readCsv(text){
 const rows=[];let row=[],cell='',quoted=false;text=text.replace(/^﻿/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(cell||row.length){row.push(cell);rows.push(row);}
 return rows;
}
const textOf=async value=>typeof value==='string'?value:value instanceof Blob?await value.text():Buffer.from(value).toString('utf8');
const fileOf=(pack,name)=>pack.files.find(file=>file.path===pack.name+'/'+name);
const read=async(pack,name)=>{const file=fileOf(pack,name);assert(file,`${name} is in the package`);return textOf(file.data);};
const names=pack=>pack.files.map(file=>file.path.slice(pack.name.length+1)).sort();
const jsonLines=text=>text.trim().split('\n').map(line=>JSON.parse(line));
const column=(table,name)=>{const at=table[0].indexOf(name);assert(at>=0,`column ${name}`);return table.slice(1).map(row=>row[at]);};

// --- A study: an earlier run made before requests were kept, and a full run with a record of each request ----
const PROMPT='Rate the tone of the text.\nUse the scale from 1 (bleak) to 5 (hopeful).';
const SETTINGS={fields:[{name:'Tone',type:'ordinal',values:['1','2','3','4','5'],description:'Overall tone.'}]},FIELDS=['Tone'];
const setup={provider:'anthropic',model:'claude-haiku-5-5',effort:'medium',prompt:PROMPT,answerFields:FIELDS,answerSettings:SETTINGS};
const before={provider:'openai',model:'gpt-6-luna',effort:'low',prompt:'Rate the tone from 1 to 5.',answerFields:FIELDS,answerSettings:SETTINGS};
const LAB='2026-11-16 92310b4',NOW=new Date('2026-11-16T12:00:00.000Z');
const HUMAN=['5','1','3','3','5','1','4','2','2','4','5','NA'],CODER=['4','1','3','2','5','2','4','2','3','4','5','1'],MODEL=['5','1','3','4','5','','4','2','2','4','4','3'];
const TEXTS=HUMAN.map((_,i)=>`Text number ${i+1}: “quoted”, with a comma\nand a second line.`);
const PDF=new File([new Uint8Array([37,80,68,70,45,49,46,52,10,1,2,3,250,251,252])],'report.pdf',{type:'application/pdf'});
function makeStudy(){
 let list;const record=pdf=>{const kept=records.recordRequest(list,frames.requestFrame(setup,pdf));list=kept.list;return kept.id;};
 const format=formats.annotationFormatRecord(FIELDS,PROMPT,false,SETTINGS);
 const rows=TEXTS.map((text,i)=>{
  const name=i===3?'2024':`text-${i+1}.txt`,reply=JSON.stringify({explanation:`Because of text ${i+1}.`,score:'',answers:{f0:MODEL[i]}});
  return {id:'doc-'+(i+1),name,file:new File([text],name,{type:'text/plain'}),status:'done',runNo:2,...setup,answers:{f0:MODEL[i]},score:'',explanation:`Because of text ${i+1}.`,rawResponse:reply,output:reply,
   usage:{input_tokens:120+i,output_tokens:40,cache_read_input_tokens:0,cache_creation_input_tokens:0},tokens:160+i,startedAt:`2026-11-16T10:00:${String(i).padStart(2,'0')}.000Z`,time:`2026-11-16T10:01:${String(i).padStart(2,'0')}.000Z`,processing:'instant',
   requestId:record(false),modelReported:'claude-haiku-5-5-20260901',stopReason:'end_turn',lab:LAB,responseId:'msg_'+i,responseFormat:format,cells:[HUMAN[i],CODER[i],i%2?'0045':'south','note '+i,i%2?'good':'bad']};
 });
 // One failed attempt that was sent again, one text that failed for good, one PDF, and an earlier run of three texts.
 rows[1].history=[{status:'error',runNo:2,...setup,error:'Claude did not return a valid annotation. Check your usage before retrying.',startedAt:'2026-11-16T09:59:00.000Z',time:'2026-11-16T09:59:05.000Z',processing:'instant',requestId:rows[1].requestId,stopReason:'max_tokens',lab:LAB,usage:{input_tokens:121,output_tokens:12000}}];
 Object.assign(rows[5],{status:'error',answers:undefined,explanation:undefined,rawResponse:undefined,output:undefined,error:'The model stopped before finishing.',stopReason:'max_tokens'});
 rows.push({id:'doc-13',name:'report.pdf',file:PDF,status:'done',runNo:2,...setup,answers:{f0:'4'},score:'',explanation:'A PDF.',output:'{"explanation":"A PDF.","score":"","answers":{"f0":"4"}}',usage:{input_tokens:900,output_tokens:50},startedAt:'2026-11-16T10:02:00.000Z',time:'2026-11-16T10:02:09.000Z',processing:'instant',requestId:record(true),modelReported:'claude-haiku-5-5-20260901',stopReason:'end_turn',lab:LAB,cells:['4','4','north','','good']});
 for(const row of rows.slice(0,3))row.earlier=[{status:'done',runNo:1,...before,answers:{f0:'4'},score:'',explanation:'An earlier answer.',startedAt:'2026-11-10T09:00:00.000Z',time:'2026-11-10T09:00:04.000Z',processing:'instant',responseFormat:formats.annotationFormatRecord(FIELDS,before.prompt,false,SETTINGS),usage:{input_tokens:100,output_tokens:30}}];
 const dataset={kind:'texts',rows,runs:[{...before,number:1,startedAt:'2026-11-10T09:00:00.000Z'},{...setup,number:2,startedAt:'2026-11-16T10:00:00.000Z'}],columns:[{name:'tone_human',role:'label'},{name:'Tone coder2',role:'label'},{name:'region',role:'meta'},{name:'tone_note',role:'label'},{name:'quality',role:'label'}],samples:[]};
 return {name:'Tone study',dataset,requests:list,lab:'2026-11-16 abcdef0'};
}
const study=makeStudy(),{dataset}=study,steps=[];
const context=(extra={})=>({study,read:data.documentReader(dataset,file=>file.text()),onProgress:step=>{steps.push(step);},backup:async()=>'{"format":"backup"}',now:NOW,...extra});

(async()=>{
 // --- Requests and counts -------------------------------------------------------------------------
 const lines=data.requestLines(dataset);
 assert.equal(lines.length,17,'Three requests in run 1; in run 2 one for each of 13 texts and one failed attempt that was sent again');
 assert.deepEqual(lines.filter(line=>line.row.id==='doc-2').map(line=>[line.run,line.attempt,line.replaced,line.result.status]),[[1,1,false,'done'],[2,1,true,'error'],[2,2,false,'done']]);
 assert.deepEqual(data.reportableRuns(dataset).map(run=>run.number),[2,1],'Newest first');assert.equal(data.fullestRun(dataset).number,2);assert.equal(data.runFolder(2),'run-02');
 const facts=tables.runFacts(dataset,data.reportableRuns(dataset)[0]);
 assert.deepEqual([facts.texts,facts.usable,facts.allFailed,facts.active],[13,12,1,0]);assert.deepEqual([facts.requests.total,facts.requests.ok,facts.requests.failed,facts.requests.replaced],[13,12,1,1]);
 assert.equal(facts.recorded,14);assert.deepEqual(facts.models,['claude-haiku-5-5-20260901']);assert.equal(facts.processing,'instant');assert.equal(facts.requests.first,'2026-11-16T09:59:00.000Z');assert.equal(facts.finished,'2026-11-16T10:02:09.000Z');
 const sent=data.runRequests(study,2);
 assert.deepEqual([sent.text.count,sent.pdf.count,sent.forms,sent.rebuilt,sent.unknown,sent.total],[13,1,2,0,0,14]);assert.equal(sent.text.recorded,true);
 const rebuilt=data.runRequests(study,1);
 assert.deepEqual([rebuilt.text.count,rebuilt.rebuilt,rebuilt.total,rebuilt.text.recorded,rebuilt.text.formatUnchanged],[3,3,3,false,true],'A run made before requests were kept has its request built again');
 for(const provider of ['openai','anthropic','gemini','openrouter']){
  const model={openai:'gpt-6-luna',anthropic:'claude-haiku-5-5',gemini:'gemini-4-hydrogen',openrouter:'openai/gpt-6-luna'}[provider],parts=data.requestParts(frames.requestFrame({...setup,provider,model},false));
  assert.equal(parts.model,model,provider);assert(parts.prompt.startsWith('Rate the tone of the text.\r\nUse the scale'),provider+': the prompt as sent has CR LF line breaks');assert.equal(parts.system,undefined,provider+': no system prompt of one’s own');assert(parts.limit>=12000);assert.equal(parts.schema.type,provider==='gemini'?'OBJECT':'object',provider);
 }

 // --- Tables --------------------------------------------------------------------------------------
 const hashes=await tables.promptHashes(dataset);
 assert.match(hashes.get(PROMPT),/^[0-9a-f]{12}$/);assert.notEqual(hashes.get(PROMPT),hashes.get(before.prompt));
 const texts=new Map(TEXTS.map((text,i)=>['doc-'+(i+1),text])),results=tables.resultsTable(study,2,{texts});
 assert.deepEqual(results[0],['doc_id','tone','rationale','tone_human','Tone coder2','region','tone_note','quality','n_ok','n_error','text'],'doc_id, the fields, the rationale, the labels and metadata, the counts, and the text last');
 assert.deepEqual(results[1],['text-1','5','Because of text 1.','5','4','south','note 0','bad',1,0,TEXTS[0]],'doc_id is the file’s name without its extension');
 assert.deepEqual(results[2].slice(-3,-1),[1,1],'The attempt that was sent again counts as an error of its text');assert.deepEqual(results[6].slice(1,3),['',''],'A text whose requests all failed has no answers');
 assert.equal(results.length,14);assert.equal(tables.resultsTable(study,1).length,4,'Only the texts a run sent a request for');
 assert(!tables.resultsTable(study,2,{explanation:false})[0].includes('rationale'));
 const requests=tables.requestsTable(study,[2],hashes);
 assert.deepEqual(requests[0],['study','run','run_label','prompt_version','prompt_hash','provider','model_requested','model_reported','doc_id','replicate','status','tone','rationale','reasoning_summary','parse_error','error','stop_reason','input_tokens','output_tokens','reasoning_tokens','cache_read_tokens','cache_write_tokens','latency_ms','requested_at','completed_at','response_id'],'The shared columns and no others');assert(column(requests,'replicate').every(n=>n===1),'One annotation per text: every request is replicate 1');
 assert.equal(requests.length,14,'One row per text and replicate: the failed attempt that was sent again is not a row');assert.deepEqual(column(requests,'status').filter(status=>status==='error').length,1);assert.equal(column(requests,'doc_id').filter(id=>id==='text-2').length,1);
 const failed=requests.find(line=>line[8]==='text-6');
 assert.equal(failed[requests[0].indexOf('tone')],'');assert.equal(failed[requests[0].indexOf('error')],'The model stopped before finishing.');assert.equal(failed[requests[0].indexOf('stop_reason')],'max_tokens');
 assert.deepEqual([requests[1][requests[0].indexOf('input_tokens')],requests[1][requests[0].indexOf('output_tokens')],requests[1][requests[0].indexOf('latency_ms')]],[120,40,60000]);
 assert.equal(requests[1][requests[0].indexOf('prompt_version')],2);
 assert.equal(tables.requestsTable(study,undefined,hashes).length,17,'All runs: one row per text and replicate');
 const overview=tables.runsOverview(study,hashes);
 assert.deepEqual(overview.slice(1).map(line=>[line[0],line[overview[0].indexOf('n_texts')],line[overview[0].indexOf('requests_failed')],line[overview[0].indexOf('requests_replaced_by_retries')],line[overview[0].indexOf('model_requested')]]),[[1,3,0,0,'gpt-6-luna'],[2,13,1,1,'claude-haiku-5-5']]);
 assert.equal(overview[0].at(-1),'cache_write_tokens','runs.csv: the shared columns and no others');assert(!overview[0].includes('app_version')&&!overview[0].includes('error')&&!overview[0].includes('label'),'No build, and no column that no run has a value in');
 // A name that is already a column of the table gets a prefix, so neither hides the other.
 const clash={name:'Clash',lab:'x',dataset:{kind:'texts',rows:[{id:'a',name:'a.txt',status:'done',runNo:1,...setup,answerFields:['status','document'],answerSettings:undefined,answers:{f0:'open',f1:'letter'},score:'',explanation:'Why.',cells:['x','y']}],runs:[],columns:[{name:'explanation',role:'label'},{name:'Document',role:'meta'}],samples:[]}};
 assert.deepEqual(tables.resultsTable(clash,1)[0],['doc_id','answer_status','document','rationale','explanation','meta_Document','n_ok','n_error']);
 const clashed=tables.requestsTable(clash,undefined,new Map())[0];assert(clashed.includes('answer_status')&&clashed.includes('status')&&clashed.includes('document'));
 assert.deepEqual(tables.fieldKeys(['','Tone','tone','Rationale','status'],new Set(['Tone','tone','Rationale','status'])),['score','tone','tone_2','rationale_field','answer_status']);
 const corpus=tables.corpusTable(dataset,dataset.rows,texts,new Map([['doc-13','files/report.pdf']]));
 assert.deepEqual(corpus[0],['doc_id','text','n_characters','source','tone_human','Tone coder2','region','tone_note','quality','file']);
 assert.deepEqual(corpus[1].slice(0,4),['text-1',TEXTS[0],TEXTS[0].length,'text-1.txt']);assert.deepEqual([corpus[13].slice(0,4),corpus[13].at(-1)],[['report','','','report.pdf'],'files/report.pdf']);
 assert.match(tables.codebook(FIELDS,SETTINGS,false),/\| Rationale \| rationale \| free text \|[^\n]*\n\| Tone \| tone \| ordinal \| 1, 2, 3, 4, 5 \| Overall tone\. \| answers\.f0 \|/);
 assert.match(tables.codebook(['response'],{plain:true},false),/free-text response \(no structured fields\)/);assert.match(tables.codebook([],undefined,true),/Score \/ category[\s\S]*INSUFFICIENT_KNOWLEDGE/);

 // --- Which label columns are compared with which answer field ------------------------------------------
 const paired=agreement.labelPairs(dataset,2);
 assert.deepEqual(paired.fields,['Tone']);assert.deepEqual(paired.pairs,[{field:'Tone',column:'tone_human'},{field:'Tone',column:'Tone coder2'}]);
 assert.deepEqual(paired.skipped,[{column:'tone_note',reason:'a note or rating'},{column:'quality',reason:'mostly not values of Tone'}],'A metadata column is never a candidate');
 const two={kind:'texts',runs:[],samples:[],columns:['gender','author_gender','mood','tone_confidence','human_tone','Tone-Gold','empty_tone'].map(name=>({name,role:'label'})),
  rows:['a','b','c'].map((id,i)=>({id,name:id+'.txt',status:'done',runNo:1,...setup,answerFields:['Tone','Gender','Explanation'],answerSettings:{fields:[{name:'Tone',type:'ordinal',values:['1','2','3'],description:''},{name:'Gender',type:'category',values:['female','male'],description:''},{name:'Explanation',type:'text',values:[],description:''}]},answers:{f0:String(i+1),f1:i?'male':'female',f2:'Because.'},score:'',cells:[i?'male':'female','female','calm','3',String(i+1),String(3-i),'']}))};
 const second=agreement.labelPairs(two,1);
 assert.deepEqual(second.fields,['Tone','Gender'],'An explanation is not compared with labels');
 assert.deepEqual(second.pairs,[{field:'Gender',column:'gender'},{field:'Tone',column:'human_tone'},{field:'Tone',column:'Tone-Gold'}]);
 assert.deepEqual(second.skipped,[{column:'author_gender',reason:'about the author'},{column:'mood',reason:'not named after an answer field'},{column:'tone_confidence',reason:'a note or rating'},{column:'empty_tone',reason:'no labels among this run’s texts'}]);
 assert.deepEqual(agreement.comparableFields({kind:'texts',runs:[],samples:[],columns:[],rows:[{id:'a',name:'a',status:'done',runNo:1,...setup,answerFields:['response'],answerSettings:{plain:true},answers:{f0:'positive'}}]},1),['response'],'A short plain-text reply is a label');
 assert.deepEqual(agreement.comparableFields({kind:'texts',runs:[],samples:[],columns:[],rows:[{id:'a',name:'a',status:'done',runNo:1,...setup,answerFields:['response'],answerSettings:{plain:true},answers:{f0:'x'.repeat(101)}}]},1),[],'Prose is not');

 // --- Agreement: the figures of Runs & agreement, found without anyone choosing the pairs -----------------
 const computed=await agreement.runAgreement(dataset,2);
 assert.deepEqual(computed.lines.map(line=>[line.field,line.source,line.comparedWith,line.stats.n,line.withLabel,line.stats.leftOut.n,line.stats.level]),[['Tone','model','tone_human',11,12,0,'ordinal'],['Tone','model','Tone coder2',12,13,0,'ordinal'],['Tone','tone_human','Tone coder2',12,13,0,'ordinal']],'A coder’s NA is a blank cell: the text has no label, and is not counted as left out');
 assert.equal(computed.lines[0].stats.percentAgreement,9/11);
 const direct=agree.runJob(agree.agreementJob(agree.pairSources(agreement.textsOfRun(dataset,2),dataset.columns,{kind:'run',run:2},'Tone',{kind:'column',name:'tone_human'},''),'auto',1),true);
 for(const key of ['cohenKappa','weightedKappa','krippendorffAlpha','gwetAC1','spearman'])assert.equal(computed.lines[0].stats[key],direct[key],key);
 assert.deepEqual(computed.lines[0].stats.ci,direct.ci,'The same intervals as on Runs & agreement (fixed seed)');
 for(const line of computed.lines){const [low,high]=line.stats.ci.cohenKappa;assert(low<=line.stats.cohenKappa&&line.stats.cohenKappa<=high);}
 // Human–human: both columns on the run's texts, on the field's scale (NA is a blank cell, not a category).
 assert.equal(computed.lines[2].stats.percentAgreement,8/12);
 const figures=agreement.agreementTable(computed.lines);
 assert.deepEqual(figures[0].slice(0,11),['run','field','annotations','compared_with','level_of_measurement','n','n_with_label','n_left_out_not_on_scale','percent_agreement','percent_agreement_ci_low','percent_agreement_ci_high']);
 assert.deepEqual(figures[1].slice(0,9),[2,'Tone','model (run 2)','tone_human','ordinal',11,12,0,0.8182]);assert.equal(figures[3][2],'tone_human');assert.equal(figures[0].at(-1),'mean_absolute_error','The shared columns and no others');
 assert(figures.slice(1).every(line=>typeof line[9]==='number'&&typeof line[10]==='number'));
 // Fewer than ten compared texts: no intervals, and none are asked for.
 let asked=0;const few=await agreement.runAgreement({...dataset,rows:dataset.rows.slice(0,5)},2,async()=>{asked++;return {};});
 assert.equal(asked,0);assert.deepEqual(few.lines[0].stats.ci,{});assert.equal(agreement.agreementTable(few.lines)[1][9],'');

 // --- The Excel workbook ---------------------------------------------------------------------------
 const book=await packages.buildRunWorkbook(context(),2);
 assert.equal(book.name,'tone-study_run2_20261116.xlsx');
 const excel=new ExcelJS.Workbook();await excel.xlsx.load(book.data);
 assert.deepEqual(excel.worksheets.map(sheet=>sheet.name),['Results','By replicate','Agreement','Settings','All runs']);
 const sheetRows=name=>{const out=[];excel.getWorksheet(name).eachRow({includeEmpty:false},row=>out.push(row.values.slice(1)));return out;},resultSheet=sheetRows('Results');
 assert.deepEqual(resultSheet[0],['doc_id','tone','rationale','tone_human','Tone coder2','region','tone_note','quality','n_ok','n_error'],'The Results sheet has no text column');
 assert.deepEqual(resultSheet[1].slice(0,4),['text-1',5,'Because of text 1.',5],'Answers and labels are numbers where they look like numbers');
 assert.strictEqual(resultSheet[4][0],'2024','A name made of digits stays text');assert.strictEqual(resultSheet[2][5],'0045','So does an identifier with leading zeros');assert.strictEqual(resultSheet[12][3],'NA');
 assert.equal(sheetRows('By replicate').length,14);assert.equal(sheetRows('Agreement').length,4);assert.equal(sheetRows('All runs').length,3);
 const settings=new Map(sheetRows('Settings').map(([key,value])=>[key,value]));
 assert.deepEqual([...settings.keys()].slice(1,18),['Study','Run','Started','Finished','Provider','Model','Effort / reasoning','Thinking','Temperature','Max output tokens','Annotations per text','Prompt caching','Mode','Prompt version','Prompt (sent with each text)','System prompt','Output'],'The shared settings in their order, and no build');
 assert.equal(settings.get('Model'),'claude-haiku-5-5');assert.equal(settings.get('Max output tokens'),16000);assert.equal(settings.get('Requests'),undefined);assert(String(settings.get('Prompt as sent')).includes('Lab response format'),'A run whose requests carried the Lab’s paragraph on the answer format shows the prompt as sent');
 assert.deepEqual([...settings.keys()].slice(18),['Prompt as sent'],'Nothing else after the shared settings');
 assert.equal(excel.getWorksheet('Results').views[0].state,'frozen');assert(excel.getWorksheet('Results').autoFilter);
 // A cell holds at most 32,767 characters; a carriage return would show as _x000D_.
 const long=new ExcelJS.Workbook();await long.xlsx.load(await workbook.buildWorkbook([{name:'A/B: [1]*?',table:[['text','n'],['x'.repeat(40000)+'\r\nend','12']],numbers:name=>name==='n'},{name:'a/b: [1]*?',table:[['only header']]}]));
 assert.deepEqual(long.worksheets.map(sheet=>sheet.name),['A_B_ _1___','a_b_ _1____2']);assert(String(long.worksheets[0].getRow(2).getCell(1).value).endsWith(' …[truncated]'));assert.strictEqual(long.worksheets[0].getRow(2).getCell(2).value,12);assert.equal(long.worksheets[1].getRow(2).getCell(1).value,'No data');

 // --- The supplementary repository -------------------------------------------------------------------
 const full=await packages.buildSupplementary(context(),2,{texts:true,explanations:true,logs:true});
 assert.equal(full.name,'tone-study_supplementary_20261116');
 assert.deepEqual(names(full),['README.md','data/corpus.csv','data/files/report.pdf','logs/requests.jsonl','logs/responses.jsonl','metadata.json','prompt/output_schema.json','prompt/prompt.txt','prompt/prompt_as_sent.txt','results/agreement.csv','results/results.csv','results/results_by_replicate.csv','scripts/annotate.py'],'No codebook (the schema gives the fields), and of the script only the script: no template and no requirements file');
 const metadata=JSON.parse(await read(full,'metadata.json')),kept=study.requests;
 assert.deepEqual([metadata.study,metadata.run.number,metadata.run.status_when_exported,metadata.model.provider,metadata.model.requested,metadata.model.max_output_tokens,metadata.prompt.version,metadata.options.prompt_caching],['Tone study',2,undefined,'anthropic','claude-haiku-5-5',16000,2,'off'],'A finished run says nothing about its status');
 assert.deepEqual(Object.keys(metadata.run),['number','started_at','finished_at','processing'],'No label, scope, or batch IDs');assert.deepEqual(Object.keys(metadata.prompt),['version','sha256_prefix','answer_format','explanation_requested','answer_fields'],'The fields only because the schema has them under short keys; no system prompt or answer settings (prompt/ has them)');
 assert(!('data' in metadata)&&!('cost_usd' in metadata)&&!('samples' in metadata),'Nothing of the Lab’s own: no data source, cost, or list of samples');assert(!('study_notes' in metadata)&&!('software' in metadata),'No study notes and nothing that names the Lab or its build');
 assert.deepEqual(metadata.requests,{total:13,ok:12,failed:1,replaced_by_retries:1,sent_in_all:14,first_requested_at:'2026-11-16T09:59:00.000Z',last_completed_at:'2026-11-16T10:02:09.000Z'});
 assert.deepEqual(metadata.requests_as_sent.bodies.map(body=>[body.kind,body.requests,'recorded' in body,'note' in body,body.url]),[['text',13,false,false,'https://api.anthropic.com/v1/messages'],['pdf',1,false,false,'https://api.anthropic.com/v1/messages']],'Every different body with the number of its requests; a body kept when it was sent says nothing about that');
 const named=JSON.parse(kept[0].body);named.output_config.format.schema='see prompt/output_schema.json';assert.deepEqual(metadata.requests_as_sent.bodies[0].body,named,'The request as sent, with the schema named, not repeated');assert(!('record' in metadata.requests_as_sent));
 assert.deepEqual(metadata.corpus,{n_texts_in_run:13,n_texts_with_usable_annotation:12,n_texts_all_requests_failed:1},'Counters that are 0 are left out, the totals kept');assert.equal(metadata.tokens.known_for_requests,14);
 assert.equal(await read(full,'prompt/prompt.txt'),PROMPT);assert((await read(full,'prompt/prompt_as_sent.txt')).startsWith(frames.formText(PROMPT)+'\n\nLab response format'));
 assert.deepEqual(JSON.parse(await read(full,'prompt/output_schema.json')),JSON.parse(kept[0].body).output_config.format.schema);
 const resultsCsv=readCsv(await read(full,'results/results.csv'));
 assert((await read(full,'results/results.csv')).startsWith('﻿'),'With a byte-order mark, so Excel reads every letter');assert.deepEqual(resultsCsv[0],results[0].filter(name=>!['n_ok','n_error'].includes(name)),'No n_ok or n_error with one annotation per text');assert.equal(resultsCsv[1].at(-1),TEXTS[0]);assert.equal(resultsCsv.length,14);
 const byReplicate=readCsv(await read(full,'results/results_by_replicate.csv'));assert.equal(byReplicate.length,14);assert.deepEqual(byReplicate[0],['doc_id','status','error','stop_reason','input_tokens','output_tokens','requested_at','completed_at'],'One annotation per text: no replicate and no answers (results.csv has them), no column with one value for the run (model_reported among them), none empty throughout, and no response ID (it points into the researcher’s own account)');
 assert.deepEqual(readCsv(await read(full,'results/agreement.csv')).map(line=>line[3]),['compared_with','tone_human','Tone coder2','Tone coder2']);
 assert.deepEqual(readCsv(await read(full,'data/corpus.csv'))[13],['report','','','report.pdf','4','4','north','','good','files/report.pdf']);assert.equal(fileOf(full,'data/files/report.pdf').data,PDF);
 // The logs: every request as it was sent, and what was kept of every reply.
 const sentLines=jsonLines(await read(full,'logs/requests.jsonl')),replies=jsonLines(await read(full,'logs/responses.jsonl'));
 assert.equal(sentLines.length,14);assert.equal(replies.length,14);
 assert.deepEqual(sentLines[0],{doc_id:'text-1',replicate:1,attempt:1,request:frames.fillRequest(kept[0].body,{filename:'text-1.txt',text:TEXTS[0]}),run:2,url:'https://api.anthropic.com/v1/messages'},'A request kept when it was sent says nothing about that in the public logs');
 assert.deepEqual(Object.keys(sentLines[0]).slice(0,4),['doc_id','replicate','attempt','request'],'doc_id, replicate, attempt, and the request first');
 assert.deepEqual(sentLines.slice(1,3).map(line=>[line.doc_id,line.attempt,line.sent_again]),[['text-2',1,true],['text-2',2,undefined]]);
 const pdfLine=sentLines[13],pdfData=pdfLine.request.messages[0].content[1].source.data;
 assert.match(pdfData,/^\[PDF file: report\.pdf, 15 bytes, SHA-256 [0-9a-f]{64}; in this package at data\/files\/report\.pdf\]$/);assert.equal(pdfLine.request.messages[0].content[0].text.split('\n')[0],'Document filename: report.pdf');
 assert.deepEqual(replies[0],{doc_id:'text-1',replicate:1,attempt:1,response:{response_text:dataset.rows[0].output,model_reported:'claude-haiku-5-5-20260901',stop_reason:'end_turn',usage:dataset.rows[0].usage,requested_at:'2026-11-16T10:00:00.000Z',completed_at:'2026-11-16T10:01:00.000Z'},run:2,status:'ok'},'No response ID in the public logs');
 assert.deepEqual(Object.keys(replies[1]).slice(0,7),['doc_id','replicate','attempt','status','error','parse_error','response'],'A replaced attempt gives its status, error, and parse_error before the response');
 assert.deepEqual([replies[1].status,replies[1].sent_again,replies[1].error,replies[1].parse_error,replies[1].response.response_text],['error',true,'Claude did not return a valid annotation. Check your usage before retrying.',null,null]);
 const readme=await read(full,'README.md');
 for(const part of ['# Tone study: LLM annotation materials','| Provider / model | anthropic / `claude-haiku-5-5` |','| Texts with a usable annotation | 12 of 13 |','| Requests (ok / failed) | 12 / 1 |','| Failed attempts sent again | 1 (','## Agreement with human labels','| Tone | model | tone_human | 11 (of 12) | 81.8% [','| Tone | tone_human | Tone coder2 | 12 (of 13) |','Brackets: 95% intervals','human–human baseline','Label columns not used for agreement: tone_note (a note or rating), quality (mostly not values of Tone).','## Files','`data/files/`','## Reproducing','export ANTHROPIC_API_KEY=...','python annotate.py ../data/corpus.csv'])assert(readme.includes(part),'README: '+part);
 assert(!readme.includes('Methods text')&&!readme.split('\n').some(line=>line.startsWith('> ')),'No draft methods text in the README');
 const script=await read(full,'scripts/annotate.py');
 assert(!/\{\{[A-Z_]+\}\}/.test(script),'Every placeholder is filled');assert(!script.includes('annotate_template'),'The script does not name a template the package does not have');assert(script.includes('PROVIDER = "anthropic"')&&script.includes('API_KEY_ENV = "ANTHROPIC_API_KEY"')&&script.includes('FIELDS = ["Tone"]')&&script.includes('PLAIN_TEXT = False')&&script.includes('TIMEOUT = 180'));
 // Without the texts, the explanations, and the logs.
 const lean=await packages.buildSupplementary(context(),2,{texts:false,explanations:false,logs:false});
 assert.deepEqual(names(lean),['README.md','metadata.json','prompt/output_schema.json','prompt/prompt.txt','prompt/prompt_as_sent.txt','results/agreement.csv','results/results.csv','results/results_by_replicate.csv','scripts/annotate.py']);
 const leanResults=readCsv(await read(lean,'results/results.csv'))[0];assert(!leanResults.includes('text')&&!leanResults.includes('rationale'));assert(!readCsv(await read(lean,'results/results_by_replicate.csv'))[0].includes('rationale'));
 const leanReadme=await read(lean,'README.md');assert(leanReadme.includes('The annotated texts are not included in this package')&&leanReadme.includes('python annotate.py your_corpus.csv')&&!leanReadme.includes('logs/'));
 for(const text of TEXTS)for(const file of lean.files)assert(!(await textOf(file.data)).includes(text.split('\n')[0]),'No text of the corpus is in a package made without the texts: '+file.path);

 // --- The research repository ---------------------------------------------------------------------
 const repository=await packages.buildResearchRepository(context(),{logs:true});
 assert.equal(repository.name,'tone-study_research_20261116');
 assert.deepEqual(names(repository),['README.md','corpus/corpus.csv','corpus/corpus.jsonl','corpus/files/report.pdf','prompts/v1/prompt.txt','prompts/v2/prompt.txt','results/agreement.csv','results/results_all_runs_long.csv','results/results_run-02.xlsx','results/runs.csv',
  ...['run-01','run-02'].flatMap(run=>['codebook.json','codebook.md','output_schema.json','prompt_as_sent.txt','requests.jsonl','responses.jsonl','results_long.csv','results_wide.csv','run.json'].map(name=>`runs/${run}/${name}`)),'scripts/annotate.py','scripts/annotate_template.py','software_versions.json','study-backup.json','study.json'].sort(),'A prompt version is its prompt: the codebook and the schema are each run’s own (runs of one version can ask for different answer fields). No requirements file');
 assert.equal(await read(repository,'study-backup.json'),'{"format":"backup"}');assert.equal(await read(repository,'prompts/v1/prompt.txt'),before.prompt);
 assert.deepEqual(JSON.parse(await read(repository,'study.json')).runs,[1,2]);assert.equal(readCsv(await read(repository,'results/results_all_runs_long.csv')).length,17);assert.equal(readCsv(await read(repository,'results/runs.csv')).length,3);
 assert.deepEqual(jsonLines(await read(repository,'corpus/corpus.jsonl'))[12],{doc_id:'report',text:null,source:'report.pdf',meta:{tone_human:'4','Tone coder2':'4',region:'north',tone_note:'',quality:'good'},file:'files/report.pdf'});
 assert(!names(repository).includes('results/results_all_runs_wide.csv')&&!names(repository).includes('results/samples.csv'),'No table of the Lab’s own');
 // Run 1 was made before the Lab kept requests: its requests are built again, and say so.
 const earlier=jsonLines(await read(repository,'runs/run-01/requests.jsonl'));
 assert.equal(earlier.length,3);assert.equal(earlier[0].recorded,false);assert.equal(earlier[0].answer_format_unchanged,true);
 assert.deepEqual(earlier[0].request,frames.fillRequest(frames.requestFrame({...before,at:'2026-11-10T09:00:00.000Z'},false).body,{filename:'text-1.txt',text:TEXTS[0]}),'Built again with the output limit of its day');
 const firstRun=JSON.parse(await read(repository,'runs/run-01/run.json'));assert.equal(firstRun.requests_as_sent.bodies[0].recorded,false);assert.equal(firstRun.model.requested,'gpt-6-luna');
 assert.match(jsonLines(await read(repository,'runs/run-02/requests.jsonl'))[13].request.messages[0].content[1].source.data,/in this package at corpus\/files\/report\.pdf/);
 const repositoryReadme=await read(repository,'README.md');
 for(const part of ['# Tone study: research repository','- 13 texts, 2 runs, 17 requests with an outcome.','- API keys are never stored or exported.','`study-backup.json` | A backup of the whole study','`results/results_run-02.xlsx` | Excel workbook for run #2','sends the requests of run #2 again'])assert(repositoryReadme.includes(part),'README: '+part);
 assert(steps.includes('Computing agreement for run 2')&&steps.includes('Writing corpus/corpus.csv')&&steps.some(step=>step.startsWith('Reading the texts')),'Each step is named before it starts');
 // The README names the data set, lists only what the repository holds, says what the backup holds, and gives the
 // command that sends the main run's texts again (the corpus holds every text of the study).
 for(const part of ['Complete record of this study’s uploaded texts and the runs on them','both data sets (the uploaded texts with their files, and the Model knowledge subjects)','`prompts/vN/prompt.txt` | Each version of the annotation prompt','`runs/run-NN/codebook.md`, `codebook.json`, `output_schema.json`, and `prompt_as_sent.txt` | The run’s own answer format',
  'python annotate.py ../corpus/corpus.csv --only ../runs/run-02/results_wide.csv','The prompt hash is the first 12 hexadecimal digits of the SHA-256 of `prompts/vN/prompt.txt`','`recorded` is false for a request that was not kept when it was sent'])assert(repositoryReadme.includes(part),'README: '+part);
 assert(!repositoryReadme.includes('requirements.txt')&&!repositoryReadme.includes('prompts/vN/codebook')&&!repositoryReadme.includes('also holds'),'Nothing about files that are not there, or about another data set that holds nothing');
 assert.equal(JSON.parse(await read(repository,'study.json')).data_set,'uploaded texts');
 // Max output tokens is what each run's requests say: run 1 (November 10) had the limit of its day, 12,000, and the
 // kept requests of run 2 say 16,000. The overview, the run's record, and its logs agree.
 const runsCsv=readCsv(await read(repository,'results/runs.csv'));
 assert.deepEqual(column(runsCsv,'max_output_tokens'),['12000','16000']);assert.equal(firstRun.model.max_output_tokens,12000);assert.equal(earlier[0].request.max_output_tokens,12000);assert.equal(JSON.parse(await read(repository,'runs/run-02/run.json')).model.max_output_tokens,16000);
 assert.deepEqual(sheetRows('All runs').map(row=>row[sheetRows('All runs')[0].indexOf('max_output_tokens')]).slice(1),[12000,16000],'The workbook’s All runs sheet too');
 // One wording for each thing, in every file: how the requests were sent, a setting left to the model, a run's status.
 assert.deepEqual(column(runsCsv,'mode'),['one by one','one by one']);assert.deepEqual(column(runsCsv,'temperature'),['model default','model default']);assert.deepEqual(column(runsCsv,'status'),['completed','completed']);
 assert.deepEqual([firstRun.run.processing,firstRun.run.status_when_exported,firstRun.model.temperature],['one by one','completed','model default']);assert.equal(settings.get('Mode'),'one by one');assert.equal(metadata.run.processing,'one by one');
 assert(runsCsv[0].includes('finished_at')&&!runsCsv[0].includes('results_collected_at'),'No batch: no time of collection');
 // No reasoning count from the provider is not a count of zero.
 assert.equal(firstRun.tokens.reasoning,null);assert(!runsCsv[0].includes('reasoning_tokens'));
 // By replicate starts with what a row is.
 assert.deepEqual(sheetRows('By replicate')[0].slice(0,3),['doc_id','replicate','model_reported']);
 // The prompt hash is the SHA-256 of prompt.txt.
 assert.equal(require('node:crypto').createHash('sha256').update(await read(full,'prompt/prompt.txt'),'utf8').digest('hex').slice(0,12),metadata.prompt.sha256_prefix);assert(readme.includes('The prompt hash is the first 12 hexadecimal digits of the SHA-256 of `prompt/prompt.txt`')&&readme.includes('CR LF'));
 assert(readme.includes('| Requests sent | one by one |')&&readme.includes('| Annotation period | 2026-11-16T09:59:00.000Z to 2026-11-16T10:02:09.000Z |')&&!readme.includes('annotate_template')&&!readme.includes('requirements.txt'));
 // Without the backup: it holds more than the repository's tables (both data sets, deleted texts), so it can be left out.
 const noBackup=await packages.buildResearchRepository(context(),{logs:false,backup:false}),noBackupReadme=await read(noBackup,'README.md');
 assert(!names(noBackup).includes('study-backup.json'));assert.equal(noBackup.warning,undefined);assert(noBackupReadme.includes('- The study backup was left out of this export.')&&!noBackupReadme.includes('`study-backup.json` |'));
 // A study without runs: only what is there is listed, the tables keep their column names, and the other data set is named.
 const fresh={name:'Fresh',lab:'x',other:{kind:'knowledge',rows:7,runs:1},dataset:{kind:'texts',columns:[],samples:[],runs:[],rows:['One.','Two.'].map((text,i)=>({id:'n'+i,name:`n${i}.txt`,file:new File([text],`n${i}.txt`),status:'pending'}))}};
 const empty=await packages.buildResearchRepository({study:fresh,read:data.documentReader(fresh.dataset,file=>file.text()),backup:async()=>'{}',now:NOW},{logs:true}),emptyReadme=await read(empty,'README.md');
 assert.deepEqual(names(empty),['README.md','corpus/corpus.csv','corpus/corpus.jsonl','results/results_all_runs_long.csv','results/runs.csv','software_versions.json','study-backup.json','study.json']);
 const emptyRuns=readCsv(await read(empty,'results/runs.csv'));assert.equal(emptyRuns.length,1);assert(emptyRuns[0].includes('run')&&emptyRuns[0].includes('max_output_tokens'),'A table without runs keeps its column names');
 for(const part of ['- 2 texts, 0 runs, 0 requests with an outcome.','- No run has been made on these texts yet','- The study also holds Model knowledge subjects: 7 subjects and 1 run. They are not in the tables here, only in `study-backup.json`; export them from the Export tab, with “Model knowledge” chosen there.','(none yet: the column names only)'])assert(emptyReadme.includes(part),'README without runs: '+part);
 for(const absent of ['prompts/','runs/run-NN','agreement.csv','.xlsx','scripts/','requests.jsonl','prompt hash'])assert(!emptyReadme.includes(absent),'README without runs says nothing of '+absent);

 // --- A run on part of the study, before requests were kept (run 1) -----------------------------------------
 const sampled=makeStudy();sampled.dataset.runs[0].scope='Checked texts (3)';sampled.dataset.samples=[{column:'sample',value:'pilot',date:'2026-11-10',size:3,eligible:13,seed:42,strata:[],allocation:[],exclude:null,taken:[],method:'sampling method 2'}];
 const sampledContext={study:sampled,read:data.documentReader(sampled.dataset,file=>file.text()),now:NOW};
 const partPack=await packages.buildSupplementary(sampledContext,1,{texts:false,explanations:true,logs:true}),partRecord=JSON.parse(await read(partPack,'metadata.json')),partReadme=await read(partPack,'README.md');
 assert.equal(partRecord.run.scope,'Checked texts (3)');assert.match(partRecord.study_notes,/3 of 13 texts drawn at random; seed 42/);
 assert(partReadme.includes('| Texts the run covered | Checked texts (3) |')&&partReadme.includes('How the study’s samples were drawn: Sample sample = pilot'),'A run on part of the study says which part, and how the samples were drawn');
 const whole=JSON.parse(await read(await packages.buildSupplementary(sampledContext,2,{texts:false,explanations:true,logs:false}),'metadata.json'));
 assert(!('scope' in whole.run)&&!('study_notes' in whole),'A run on every text of the study says neither');
 // Its requests were not kept, so the package does not call them the requests as sent.
 assert.deepEqual(partRecord.requests_as_sent.bodies.map(body=>[body.recorded,body.note,body.requests]),[[false,'Not kept when it was sent: built again from the run’s settings.',3]]);assert.equal(partRecord.model.max_output_tokens,12000);
 assert(partReadme.includes('with the body of the requests, built again from the run’s settings (the requests were not kept when the run was made)')&&partReadme.includes('`recorded` is false for a request that was not kept when it was sent')&&partReadme.includes('`answer_format_unchanged`'));
 assert((await read(partPack,'scripts/annotate.py')).includes('The request body below was not kept when the run was made: it was built again'));
 assert.deepEqual(jsonLines(await read(partPack,'logs/requests.jsonl')).map(line=>line.recorded),[false,false,false]);
 // OpenAI's cache option with caching off is explained where a body has it.
 assert.equal(partReadme.includes('"prompt_cache_options": {"mode": "explicit"}'),JSON.stringify(partRecord.requests_as_sent.bodies[0].body).includes('prompt_cache_options'));

 // --- A batch: when it was submitted, when the provider ended it, and when its results were collected --------------
 const batchSetup={...setup,provider:'openai',model:'gpt-6-luna'},SUBMITTED='2026-11-18T21:02:48.000Z',COLLECTED='2026-11-19T08:12:44.000Z',ENDED='2026-11-18T21:40:00.000Z';
 const batchStudy=ended=>({name:'Batch',lab:'x',dataset:{kind:'texts',columns:[],samples:[],runs:[{...batchSetup,number:1,startedAt:SUBMITTED}],
  rows:['One.','Two.'].map((text,i)=>({id:'b'+i,name:`b${i}.txt`,file:new File([text],`b${i}.txt`),status:'done',runNo:1,...batchSetup,answers:{f0:'3'},score:'',explanation:'x',startedAt:SUBMITTED,time:COLLECTED,processing:'batch',batchId:'batch_1',responseId:'resp_'+i,...(ended?{batchEndedAt:ended}:{}),usage:{input_tokens:10,output_tokens:5}}))}});
 for(const ended of [ENDED,'']){
  const batchContext={study:batchStudy(ended),now:NOW};batchContext.read=data.documentReader(batchContext.study.dataset,file=>file.text());
  const archive=await packages.buildResearchRepository(batchContext,{logs:true}),batchRecord=JSON.parse(await read(archive,'runs/run-01/run.json')),batchRuns=readCsv(await read(archive,'results/runs.csv'));
  assert.deepEqual([batchRecord.run.finished_at,batchRecord.run.results_collected_at,batchRecord.run.processing],[ended||null,COLLECTED,'batch'],'Finished is the provider’s time for the end of the batch, or nothing: never the time of collection');
  assert.deepEqual([batchRecord.requests.first_requested_at,batchRecord.requests.last_completed_at,batchRecord.requests.last_results_collected_at],[SUBMITTED,ended||null,COLLECTED]);
  assert.deepEqual(column(batchRuns,'results_collected_at'),[COLLECTED]);assert.deepEqual(batchRuns[0].includes('finished_at')?column(batchRuns,'finished_at'):[],ended?[ended]:[]);assert.deepEqual(column(batchRuns,'mode'),['batch']);
  assert.equal(batchRecord.model.max_output_tokens,12000,'Sent before the limit became 16,000');assert.deepEqual(column(batchRuns,'max_output_tokens'),['12000']);
  const batchReply=jsonLines(await read(archive,'runs/run-01/responses.jsonl'))[0].response;assert.deepEqual([batchReply.batch_id,batchReply.batch_ended_at,batchReply.response_id],['batch_1',ended||undefined,'resp_0']);
  assert((await read(archive,'README.md')).includes('For a request sent through the provider’s batch interface, `requested_at` is when its batch was submitted and `completed_at` when its results were collected'));
  const paper=await packages.buildSupplementary(batchContext,1,{texts:false,explanations:true,logs:true}),paperRecord=JSON.parse(await read(paper,'metadata.json')),paperReadme=await read(paper,'README.md');
  assert.deepEqual(Object.keys(paperRecord.run),['number','started_at',...(ended?['finished_at']:[]),'results_collected_at','processing']);assert.equal('last_completed_at' in paperRecord.requests,Boolean(ended));assert.equal(paperRecord.requests.last_results_collected_at,COLLECTED);
  assert(paperReadme.includes(`| Batch submitted | ${SUBMITTED} |`)&&paperReadme.includes(`| Batch results collected | ${COLLECTED} |`)&&paperReadme.includes('| Requests sent | batch |')&&!paperReadme.includes('Annotation period'),'A batch has no annotation period that ends when its results were collected');
  assert.equal(paperReadme.includes(`| Batch ended (the provider’s time) | ${ENDED} |`),Boolean(ended));
  // The public package has none of the provider's IDs: not of the batch, not of a reply.
  const paperReply=jsonLines(await read(paper,'logs/responses.jsonl'))[0].response;assert(!('batch_id' in paperReply)&&!('response_id' in paperReply));assert(!readCsv(await read(paper,'results/results_by_replicate.csv'))[0].includes('response_id'));
  for(const file of paper.files)assert(!/batch_1|resp_0/.test(await textOf(file.data)),'No ID of the provider’s in '+file.path);
  const batchBook=new ExcelJS.Workbook();await batchBook.xlsx.load((await packages.buildRunWorkbook(batchContext,1)).data);const batchSettings=new Map();batchBook.getWorksheet('Settings').eachRow(row=>batchSettings.set(row.values[1],row.values[2]));
  assert.deepEqual([batchSettings.get('Finished'),batchSettings.get('Batch results collected'),batchSettings.get('Mode')],[ended||undefined,COLLECTED,'batch']);
 }

 // --- Claude's thinking tokens are its reasoning tokens ------------------------------------------------------
 const thought=makeStudy();thought.dataset.rows[0].usage={...thought.dataset.rows[0].usage,output_tokens_details:{thinking_tokens:25}};thought.dataset.rows[2].usage={...thought.dataset.rows[2].usage,output_tokens_details:{thinking_tokens:0}};
 assert.equal(data.tokensOf(thought.dataset.rows[0]).reasoning,25);assert.equal(data.tokensOf(thought.dataset.rows[1]).reasoning,'','No count is not a count of zero');
 const thoughtFacts=tables.runFacts(thought.dataset,data.reportableRuns(thought.dataset)[0]);assert.deepEqual([thoughtFacts.tokens.reasoning,thoughtFacts.tokens.reasoningKnownFor],[25,2]);
 const thoughtRuns=tables.runsOverview(thought,await tables.promptHashes(thought.dataset));assert.deepEqual(column(thoughtRuns,'reasoning_tokens'),['',25],'Blank for the run whose provider reported none');
 assert.deepEqual(column(tables.requestsTable(thought,[2],await tables.promptHashes(thought.dataset)),'reasoning_tokens').slice(0,3),[25,'',0]);

 // --- Texts that were split: how, in the corpus and in the run's record ------------------------------------------
 const splitStudy=makeStudy();splitStudy.dataset.rows.slice(0,2).forEach((row,i)=>Object.assign(row,{sourceId:'long-1',sourceName:'long.txt',chunkIndex:i+1,chunkCount:2,wordsPerChunk:200,chunkMethod:'sentences',segmenter:'Intl.Segmenter/en/sentence',wordStart:1+i*198,wordEnd:198+i*190}));
 const splitContext={study:splitStudy,read:data.documentReader(splitStudy.dataset,file=>file.text()),now:NOW},splitPack=await packages.buildSupplementary(splitContext,2,{texts:true,explanations:true,logs:false});
 assert.deepEqual(JSON.parse(await read(splitPack,'metadata.json')).corpus.split,{n_chunks:2,n_source_documents:1,chunk_words:200,chunk_method:'sentences',sentence_segmenter:'Intl.Segmenter/en/sentence'});
 const splitCorpus=readCsv(await read(splitPack,'data/corpus.csv')),from=splitCorpus[0].indexOf('source_document');
 assert.deepEqual(splitCorpus[0].slice(from,from+6),['source_document','chunk','chunk_words','chunk_method','word_start','word_end']);assert.deepEqual(splitCorpus[2].slice(from,from+6),['long.txt','2 of 2','200','sentences','199','388']);assert.deepEqual(splitCorpus[3].slice(from,from+6),['','','','','',''],'A text that was not split has none of them');
 assert((await read(splitPack,'README.md')).includes('2 of the run’s texts are parts of 1 longer text that was split before annotation, into parts of about 200 words (ending at sentence boundaries where possible)'));
 assert(!readCsv(await read(splitPack,'results/results.csv'))[0].includes('chunk_words'),'The results keep to which part a row is');
 assert.deepEqual(Object.keys(jsonLines(await read(await packages.buildResearchRepository(splitContext,{logs:false}),'corpus/corpus.jsonl'))[1]).filter(key=>/chunk|word/.test(key)),['chunk','chunk_words','chunk_method','word_start','word_end']);
 const bare=await packages.buildResearchRepository(context({backup:async()=>{throw new Error('Wait for both workspaces to finish opening');}}),{logs:false});
 assert(!names(bare).includes('study-backup.json')&&!names(bare).some(name=>name.endsWith('.jsonl')&&name.startsWith('runs/')));assert((await read(bare,'README.md')).includes('Not included: Wait for both workspaces to finish opening'));
 assert.match(bare.warning,/^study-backup\.json is missing: .*Wait for both workspaces to finish opening/,'The page says so too');assert.equal(full.warning,undefined);
 // As one .zip file.
 const zipped=await JSZip.loadAsync(await packages.zipPackage(full));
 assert.deepEqual(Object.keys(zipped.files).filter(name=>!zipped.files[name].dir).sort(),full.files.map(file=>file.path).sort());
 assert.equal(await zipped.file(full.name+'/README.md').async('string'),readme);assert.deepEqual([...await zipped.file(full.name+'/data/files/report.pdf').async('uint8array')],[...new Uint8Array(await PDF.arrayBuffer())]);

 // --- A run that is still going --------------------------------------------------------------------
 const going=makeStudy();Object.assign(going.dataset.rows[4],{status:'running',answers:undefined,explanation:undefined,output:undefined,rawResponse:undefined});
 const goingPack=await packages.buildSupplementary({...context(),study:going,read:data.documentReader(going.dataset,file=>file.text())},2,{texts:false,explanations:true,logs:false}),goingRecord=JSON.parse(await read(goingPack,'metadata.json'));
 assert.equal(goingRecord.run.status_when_exported,'running','The words of the runs table');assert(!('finished_at' in goingRecord.run),'No time where there is none');assert.equal(goingRecord.corpus.n_texts_without_result_yet,1);
 assert((await read(goingPack,'README.md')).includes('**This run was not finished when these materials were exported**'));

 // --- Plain text ------------------------------------------------------------------------------------
 const plainSetup={...setup,answerFields:['response'],answerSettings:{plain:true}},plainStudy={name:'Plain',lab:'x',dataset:{kind:'texts',columns:[],samples:[],runs:[{...plainSetup,number:1,startedAt:'2026-11-16T10:00:00.000Z'}],
  rows:['One.','Two.'].map((text,i)=>({id:'p'+i,name:`p${i}.txt`,file:new File([text],`p${i}.txt`),status:'done',runNo:1,...plainSetup,answers:{f0:'A free reply about text '+i+', long enough to be prose and not a label, which is why nothing is compared with it here at all.'},startedAt:'2026-11-16T10:00:00.000Z',time:'2026-11-16T10:00:03.000Z',processing:'instant'}))}};
 const plainPack=await packages.buildSupplementary({study:plainStudy,read:data.documentReader(plainStudy.dataset,file=>file.text()),now:NOW},1,{texts:true,explanations:true,logs:true});
 assert(!names(plainPack).includes('prompt/output_schema.json')&&!names(plainPack).includes('results/agreement.csv'));assert(!names(plainPack).some(name=>name.includes('codebook')),'No codebook');
 assert((await read(plainPack,'scripts/annotate.py')).includes('PLAIN_TEXT = True'));
 assert.deepEqual(readCsv(await read(plainPack,'results/results.csv'))[0],['doc_id','response','text'],'A reply that is not JSON stays in the place of the fields');
 assert.equal(jsonLines(await read(plainPack,'logs/responses.jsonl'))[0].response.response_text,plainStudy.dataset.rows[0].answers.f0,'The reply of a plain-text run is its answer');

 // --- Model knowledge: no texts were supplied, and every file says so ----------------------------------------
 const SUBJECT=name=>[{heading:'Film',value:name},{heading:'Year',value:name==='Jaws'?'1975':'1979'}],knowledgeSetup={provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'Rate the villain’s menace from 1 to 5.',answerFields:[]};
 const items=['Jaws','Alien'].flatMap((name,i)=>[
  {id:'i'+i,subjectId:'s'+i,name,status:'done',score:String(4+i),explanation:'Known.',runNumber:1,...knowledgeSetup,webSearch:false,fields:SUBJECT(name),cells:[String(5-i)],startedAt:'2026-11-16T10:00:00.000Z',time:'2026-11-16T10:00:03.000Z',processing:'instant'},
  {id:'j'+i,subjectId:'s'+i,name,status:'done',score:'5',explanation:'Searched.',runNumber:2,...knowledgeSetup,webSearch:true,research:{text:'Found on the web.'},fields:SUBJECT(name),startedAt:'2026-11-16T11:00:00.000Z',time:'2026-11-16T11:00:03.000Z',processing:'instant'}]);
 const knowledgeSet={kind:'knowledge',rows:knowledgeLib.knowledgeRows(items),runs:[],columns:[{name:'menace_human',role:'label'}],samples:[]},knowledgeStudy={name:'Villains',dataset:knowledgeSet,lab:'x'};
 const knowledgeContext={study:knowledgeStudy,read:data.documentReader(knowledgeSet,async()=>''),now:NOW};
 const learned=await packages.buildSupplementary(knowledgeContext,1,{texts:true,explanations:true,logs:true});
 assert.equal(learned.name,'villains-model-knowledge_supplementary_20261116');assert(names(learned).includes('scripts/annotate.py'));
 const learnedReadme=await read(learned,'README.md');assert(learnedReadme.includes('Model knowledge: no texts were supplied.'));
 assert(!('data' in JSON.parse(await read(learned,'metadata.json'))),'The README says no texts were supplied; metadata.json has no field of the Lab’s own for it');
 // Research mode's Model knowledge runs from November 16 hold the paragraph in the prompt; the Lab added nothing.
 assert(learnedReadme.includes('and on judging from learned knowledge'),'A run that had the paragraph added says so');
 const ownItems=items.filter(item=>!item.webSearch).map(item=>({...item,answerSettings:{inPrompt:true},instructions:''})),ownSet={...knowledgeSet,rows:knowledgeLib.knowledgeRows(ownItems)};
 const ownReadme=await read(await packages.buildSupplementary({study:{...knowledgeStudy,dataset:ownSet},read:data.documentReader(ownSet,async()=>''),now:NOW},1,{texts:true,explanations:true,logs:true}),'README.md');
 assert(ownReadme.includes('Model knowledge: no texts were supplied.')&&!ownReadme.includes('on judging from learned knowledge'),'A run whose prompt held the paragraph says nothing was added');
 const learnedResults=readCsv(await read(learned,'results/results.csv'));
 assert.deepEqual(learnedResults[0],['doc_id','score','rationale','menace_human','text','subject','Year'],'The shared layout, then the subject and its fields; a heading that only repeats the subject’s name has no column of its own');assert.deepEqual(learnedResults[1],['Jaws','4','Known.','5',knowledgeText.knowledgeDocumentText(SUBJECT('Jaws'),undefined,true),'Jaws','1975'],'The subject as its run’s requests carried it (here the earlier layout)');
 assert.equal(jsonLines(await read(learned,'logs/requests.jsonl'))[0].doc_id,'Jaws');assert.deepEqual(jsonLines(await read(learned,'logs/requests.jsonl'))[0].request,frames.fillRequest(frames.requestFrame({...knowledgeSetup,knowledge:true,at:'2026-11-16T10:00:00.000Z'},false).body,{filename:'subject.txt',text:knowledgeText.knowledgeDocumentText(SUBJECT('Jaws'),undefined,true)}),'A result without a layout was sent in the earlier layout, with the subject as a labeled JSON block');
 // A run whose requests carried web search results has no script: the search was a step of its own.
 const searched=await packages.buildSupplementary(knowledgeContext,2,{texts:false,explanations:true,logs:true});
 assert(!names(searched).some(name=>name.startsWith('scripts/')));assert((await read(searched,'README.md')).includes('No script is included: each request of this run carried web search results'));
 assert(jsonLines(await read(searched,'logs/requests.jsonl'))[0].request.input.some(part=>JSON.stringify(part).includes('Found on the web.')),'The log holds the request with the search results it carried');
 assert(!readCsv(await read(searched,'results/results_by_replicate.csv'))[0].includes('web_search')&&JSON.parse(await read(searched,'metadata.json')).options.web_search===true,'Web search, the same for every request of the run, is given once, in metadata.json');

 // A run without a record of its own can hold results made with different settings: the README says so first, and
 // the record holds every different body with the number of its requests.
 const mixedItems=[...items.filter(item=>!item.webSearch),{id:'m2',subjectId:'s2',name:'Psycho',status:'done',score:'6',explanation:'Known.',runNumber:1,...knowledgeSetup,model:'gpt-6.2-sol',prompt:'Rate the villain’s menace from 1 to 7.',webSearch:false,fields:SUBJECT('Psycho'),startedAt:'2026-11-16T10:05:00.000Z',time:'2026-11-16T10:05:03.000Z',processing:'instant'}];
 const mixedSet={...knowledgeSet,rows:knowledgeLib.knowledgeRows(mixedItems)},mixedPack=await packages.buildSupplementary({study:{...knowledgeStudy,dataset:mixedSet},read:data.documentReader(mixedSet,async()=>''),now:NOW},1,{texts:false,explanations:true,logs:false});
 const mixedReadme=await read(mixedPack,'README.md'),mixedRecord=JSON.parse(await read(mixedPack,'metadata.json'));
 assert(mixedReadme.indexOf('**The results of this run were not all made with the same settings.**')>0&&mixedReadme.indexOf('**The results of this run')<mixedReadme.indexOf('## Summary'),'The warning stands before the summary');
 for(const part of ['Its 3 requests had 2 different request bodies: 2 models, `gpt-6-luna` (2 requests) and `gpt-6.2-sol` (1 request), and 2 different prompts.','with the different bodies of the requests, built again from the run’s settings (the requests were not kept when the run was made), each with the number of its requests (marks stand for the document)'])assert(mixedReadme.includes(part),'README of a mixed run: '+part);
 const mixedArchive=await read(await packages.buildResearchRepository({study:{...knowledgeStudy,dataset:mixedSet},read:data.documentReader(mixedSet,async()=>''),now:NOW},{logs:false}),'README.md');
 assert(mixedArchive.includes('- The results of run #1 were not all made with the same settings')&&mixedArchive.includes('Complete record of this study’s Model knowledge subjects and the runs on them')&&!repositoryReadme.includes('not all made with the same settings'),'The research repository names its mixed runs too');
 assert.equal(mixedRecord.requests_as_sent.different_bodies,2);assert.deepEqual(mixedRecord.requests_as_sent.bodies.map(body=>[body.requests,body.body.model]),[[2,'gpt-6-luna'],[1,'gpt-6.2-sol']]);
 assert(!learnedReadme.includes('not all made with the same settings'),'A run made with one setup has no such warning');

 // --- Nothing names the Lab or its build, except the research repository's software_versions.json ---------
 const TRACE=/text annotation lab|\bthe lab\b|lab’s|abcdef0|92310b4|2026-11-16 abcdef0/i;
 for(const pack of [full,lean,learned,searched,plainPack,partPack,splitPack,mixedPack,noBackup,empty])for(const file of pack.files)if(!(file.data instanceof File)&&!file.path.endsWith('software_versions.json')&&!file.path.endsWith('.xlsx'))assert(!TRACE.test(await textOf(file.data)),'No trace of the Lab in '+file.path);
 for(const file of repository.files)if(!(file.data instanceof File)&&!file.path.endsWith('software_versions.json')&&!file.path.endsWith('.xlsx')&&!/prompt_as_sent\.txt$|requests\.jsonl$|run\.json$/.test(file.path))assert(!TRACE.test(await textOf(file.data)),'No trace of the Lab in '+file.path);
 const versions=JSON.parse(await read(repository,'software_versions.json'));
 assert.deepEqual([versions.software,versions.exported_with,versions.runs],['Text Annotation Lab','2026-11-16 abcdef0',[{run:1,made_with:'not recorded'},{run:2,made_with:LAB}]]);assert.match(versions.note,/Keep it private/);
 assert((await read(repository,'README.md')).includes('`software_versions.json` | Which build of the app made each run'));
 const bookText=[];for(const sheet of excel.worksheets)sheet.eachRow(row=>row.eachCell(cell=>bookText.push(String(cell.value))));
 assert(!/text annotation lab|abcdef0|92310b4/i.test(bookText.filter(text=>!text.includes('Lab response format')).join('\n')),'Nor the workbook (the prompt as sent by an earlier run is what the model received)');
 // --- No API key can be part of an export: the files are built from texts, runs, columns, samples, and the kept requests ---
 for(const pack of [full,lean,repository,learned])for(const file of pack.files){const text=await textOf(file.data);assert(!/sk-[A-Za-z0-9]{8}|Bearer [A-Za-z0-9]{8}/.test(text),'No credential in '+file.path);}

 // --- The Python script ------------------------------------------------------------------------------
 assert.equal(python.pyString('plain "quoted" \\ text'),'"plain \\"quoted\\" \\\\ text"');assert.equal(python.fillScript('A = {{A}}; B = {{B}}; {{...}}',{A:'{{B}}'}),'A = {{B}}; B = {{B}}; {{...}}','Inserted text is never read again');
 assert.equal(python.keyVariable('gemini'),'GEMINI_API_KEY');assert.equal(python.scriptValues({lab:'x',studyName:'s',runDescription:'r',provider:'gemini',text:frames.requestFrame({...setup,provider:'gemini',model:'gemini-4-hydrogen'},false),fields:FIELDS,plain:false}).TIMEOUT,'900');
 assert.deepEqual(JSON.parse(python.scriptValues({lab:'x',studyName:'s',runDescription:'r',provider:'anthropic',text:frames.requestFrame(setup,false),fields:FIELDS,plain:false}).ALLOWED.replace(/,\n\}/,'\n}')),{Tone:['1','2','3','4','5']});
 if(spawnSync('python3',['--version']).status!==0){console.log('research-export: python3 is not installed; the script itself was not run.');return;}
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lab-export-')),run=(args,env={})=>new Promise(resolve=>execFile('python3',args,{cwd:folder,env:{...process.env,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',...env},encoding:'utf8'},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,stdout,stderr})));
 try{
  // Literals: what Python reads is what the Lab wrote, character for character.
  const awkward=['plain','two\nlines','CR LF\r\nline','quote " and \'','ends with a quote"\n"','three """ quotes\n""" again','back\\slash\n\\n not a line break','tab\tand\u0001control\nline','æøå “curly” 日本\n🙂','\n',''];
  const value={strings:awkward,nested:{yes:true,no:false,none:null,number:12000,list:[1,'a',{b:[]}],empty:{}}};
  fs.writeFileSync(path.join(folder,'literal.py'),'import json, sys\nVALUE = '+python.pyLiteral(value)+'\nsys.stdout.reconfigure(encoding="utf-8", newline="")\nsys.stdout.write(json.dumps(VALUE, separators=(",", ":"), ensure_ascii=False))\n');
  const literal=await run(['literal.py']);assert.equal(literal.code,0,literal.stderr);assert.equal(literal.stdout,JSON.stringify(value));

  // A stand-in for the providers: it keeps what it receives and answers as each provider does.
  const ANSWER=JSON.stringify({explanation:'Because “it” says so.',score:'',answers:{f0:'4'}}),received=[];let respond;
  const reply={openai:{id:'resp_1',status:'completed',model:'gpt-6-luna-2026-10-01',output:[{type:'reasoning',content:[]},{type:'message',content:[{type:'output_text',text:ANSWER}]}],usage:{input_tokens:10,output_tokens:5}},
   anthropic:{id:'msg_1',model:'claude-haiku-5-5-20260901',stop_reason:'end_turn',content:[{type:'thinking',thinking:'…'},{type:'text',text:ANSWER}],usage:{input_tokens:10,cache_read_input_tokens:2,output_tokens:5}},
   gemini:{responseId:'r1',modelVersion:'gemini-4-hydrogen-001',candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'thinking'},{text:ANSWER}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:3,thoughtsTokenCount:2}},
   openrouter:{id:'gen-1',model:'openai/gpt-6-luna',provider:'OpenAI',choices:[{finish_reason:'stop',message:{content:ANSWER}}],usage:{prompt_tokens:10,completion_tokens:5}}};
  const server=http.createServer((request,response)=>{const chunks=[];request.on('data',chunk=>chunks.push(chunk));request.on('end',()=>{const entry={url:request.url,headers:request.headers,body:Buffer.concat(chunks).toString('utf8')};received.push(entry);const [status,body,headers]=respond(entry);response.writeHead(status,{'content-type':'application/json',...headers});response.end(JSON.stringify(body));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port,KEY='sk-test-0123456789abcdef';
  const TEXT='A text with “quotes”, a "double quote", a back\\slash,\r\nline breaks,\n\ttabs, æøå 日本 🙂, and the mark <<DOCUMENT_TEXT>> itself.';
  fs.writeFileSync(path.join(folder,'report.pdf'),Buffer.from(await PDF.arrayBuffer()));
  fs.writeFileSync(path.join(folder,'corpus.csv'),toCsv([['doc_id','text','n_characters','source','file'],['d1',TEXT,'','näme “1”.txt',''],['d2','','','report.pdf','report.pdf'],['d3','','','empty.txt','']]));
  const models={openai:'gpt-6-luna',anthropic:'claude-haiku-5-5',gemini:'gemini-4-hydrogen',openrouter:'openai/gpt-6-luna'},keyHeader={openai:['authorization','Bearer '+KEY],anthropic:['x-api-key',KEY],gemini:['x-goog-api-key',KEY],openrouter:['authorization','Bearer '+KEY]};
  const scriptFor=(provider,extra={},repeats)=>{const settings={...setup,provider,model:models[provider],...extra},text=frames.requestFrame(settings,false),pdf=frames.requestFrame(settings,true);
   fs.writeFileSync(path.join(folder,provider+'.py'),python.fillScript(python.SCRIPT_TEMPLATE,python.scriptValues({lab:'test',studyName:'Tone “study”',runDescription:'#2',provider,text,pdf,fields:settings.answerFields,columns:tables.fieldKeys(settings.answerFields,new Set(settings.answerFields)),plain:Boolean(settings.answerSettings?.plain),repeats})));return {text,pdf};};
  for(const provider of ['openai','anthropic','gemini','openrouter']){
   const {text,pdf}=scriptFor(provider);received.length=0;respond=()=>[200,reply[provider],{}];
   const done=await run([provider+'.py','corpus.csv','--base-url',base,'--out',provider+'.csv','--log',provider+'.jsonl'],{[python.keyVariable(provider)]:KEY});
   assert.equal(done.code,0,provider+': '+done.stderr);assert.equal(received.length,2,provider+': one request per document with something to send');
   // Byte for byte what the Lab sends: the kept body with the document put back, written as JSON.stringify writes it.
   assert.equal(received[0].body,JSON.stringify(frames.fillRequest(text.body,{filename:'näme “1”.txt',text:TEXT})),provider+': a text');
   assert.equal(received[1].body,JSON.stringify(frames.fillRequest(pdf.body,{filename:'report.pdf',file:Buffer.from(await PDF.arrayBuffer()).toString('base64')})),provider+': a PDF');
   assert.equal(received[0].url,new URL(text.url).pathname,provider+': the same path');assert.equal(received[0].headers[keyHeader[provider][0]],keyHeader[provider][1],provider+': the key travels in the provider’s header');
   if(provider==='anthropic')assert.equal(received[0].headers['anthropic-version'],'2023-06-01');
   const out=readCsv(fs.readFileSync(path.join(folder,provider+'.csv'),'utf8'));
   assert.deepEqual(out[0],['doc_id','replicate','status','tone','rationale','error','model_reported','stop_reason','input_tokens','output_tokens','latency_s','completed_at','response_id'],provider+': the answers under the column names of the run’s own tables (tone, not Tone; a separate explanation under rationale)');
   assert.deepEqual(out.slice(1).map(line=>line.slice(0,6)),[['d1','1','ok','4','Because “it” says so.',''],['d2','1','ok','4','Because “it” says so.',''],['d3','1','error','','','No document to send (an empty text, or a kind of document the run did not send)']],provider);
   assert.deepEqual(out[1].slice(8,10),[provider==='anthropic'?'12':'10','5'],provider+': tokens as the provider counts them');
   const log=fs.readFileSync(path.join(folder,provider+'.jsonl'),'utf8');
   assert(!log.includes(KEY)&&!fs.readFileSync(path.join(folder,provider+'.csv'),'utf8').includes(KEY),provider+': the key is never written');assert(log.includes('[PDF data, 20 base64 characters]')&&!log.includes(Buffer.from(await PDF.arrayBuffer()).toString('base64')),provider+': the log names a PDF’s data, not the data');
  }
  // An error: only the provider's short code is written to the results, never its message.
  scriptFor('anthropic');received.length=0;respond=()=>[400,{type:'error',error:{type:'invalid_request_error',message:'Echo of a document: SECRET-TEXT'}},{}];
  let failedRun=await run(['anthropic.py','corpus.csv','--base-url',base,'--out','failed.csv','--log','failed.jsonl','--limit','1'],{ANTHROPIC_API_KEY:KEY});
  assert.equal(failedRun.code,0);assert.equal(received.length,1,'A request the provider refuses is not sent again');
  assert.deepEqual(readCsv(fs.readFileSync(path.join(folder,'failed.csv'),'utf8'))[1].slice(0,6),['d1','1','error','','','The provider answered with an error (HTTP 400: invalid_request_error)']);assert(!fs.readFileSync(path.join(folder,'failed.csv'),'utf8').includes('SECRET-TEXT'));
  // Too many requests: the script waits as the provider asks and sends the request again.
  received.length=0;respond=()=>received.length===1?[429,{type:'error',error:{type:'rate_limit_error'}},{'retry-after':'0'}]:[200,reply.anthropic,{}];
  failedRun=await run(['anthropic.py','corpus.csv','--base-url',base,'--out','again.csv','--log','again.jsonl','--limit','1'],{ANTHROPIC_API_KEY:KEY});
  assert.equal(received.length,2);assert.equal(received[0].body,received[1].body);assert.equal(readCsv(fs.readFileSync(path.join(folder,'again.csv'),'utf8'))[1][2],'ok');
  // A cut-off answer and an answer outside the allowed values count as failed, as in the Lab.
  received.length=0;respond=()=>[200,{...reply.anthropic,stop_reason:'max_tokens'},{}];
  await run(['anthropic.py','corpus.csv','--base-url',base,'--out','cut.csv','--log','cut.jsonl','--limit','1'],{ANTHROPIC_API_KEY:KEY});
  assert.deepEqual(readCsv(fs.readFileSync(path.join(folder,'cut.csv'),'utf8'))[1].slice(2,6),['error','','','Incomplete answer (stop reason: max_tokens)']);
  respond=()=>[200,{...reply.anthropic,content:[{type:'text',text:JSON.stringify({explanation:'x',score:'',answers:{f0:'9'}})}]},{}];
  await run(['anthropic.py','corpus.csv','--base-url',base,'--out','off.csv','--log','off.jsonl','--limit','1'],{ANTHROPIC_API_KEY:KEY});
  assert.deepEqual(readCsv(fs.readFileSync(path.join(folder,'off.csv'),'utf8'))[1].slice(2,6),['error','','','The answer for Tone is not one of the allowed values']);
  // Plain text: the whole reply is the answer.
  scriptFor('openai',{answerFields:['response'],answerSettings:{plain:true}});received.length=0;respond=()=>[200,{...reply.openai,output:[{type:'message',content:[{type:'output_text',text:' Mostly hopeful. '}]}]},{}];
  await run(['openai.py','corpus.csv','--base-url',base,'--out','plain.csv','--log','plain.jsonl','--limit','1'],{OPENAI_API_KEY:KEY});
  const plainOut=readCsv(fs.readFileSync(path.join(folder,'plain.csv'),'utf8'));assert.deepEqual(plainOut[0].slice(0,5),['doc_id','replicate','status','response','error']);assert.deepEqual(plainOut[1].slice(0,5),['d1','1','ok','Mostly hopeful.','']);
  // Several annotations per text: each document is sent that many times, with a row and a log line for each.
  scriptFor('anthropic',{},3);received.length=0;respond=()=>[200,reply.anthropic,{}];
  const thrice=await run(['anthropic.py','corpus.csv','--base-url',base,'--out','three.csv','--log','three.jsonl','--limit','1'],{ANTHROPIC_API_KEY:KEY});
  assert.equal(thrice.code,0,thrice.stderr);assert.equal(received.length,3);assert(received.every(request=>request.body===received[0].body),'The same request each time');
  assert.deepEqual(readCsv(fs.readFileSync(path.join(folder,'three.csv'),'utf8')).slice(1).map(line=>line.slice(0,4)),[['d1','1','ok','4'],['d1','2','ok','4'],['d1','3','ok','4']]);
  assert.deepEqual(jsonLines(fs.readFileSync(path.join(folder,'three.jsonl'),'utf8')).map(line=>line.replicate),[1,2,3]);assert.match(thrice.stderr,/\[1\/1\] d1 \(annotation 3 of 3\)/);
  // --only: the documents a CSV file lists by doc_id (a results table of the run, say), in the order of the corpus.
  fs.writeFileSync(path.join(folder,'only.csv'),toCsv([['doc_id','tone'],['d2','4'],['d9','1']]));scriptFor('anthropic');received.length=0;respond=()=>[200,reply.anthropic,{}];
  const some=await run(['anthropic.py','corpus.csv','--only','only.csv','--base-url',base,'--out','some.csv','--log','some.jsonl'],{ANTHROPIC_API_KEY:KEY});
  assert.equal(some.code,0,some.stderr);assert.equal(received.length,1,'Only the listed document is sent');assert.deepEqual(readCsv(fs.readFileSync(path.join(folder,'some.csv'),'utf8')).slice(1).map(line=>line[0]),['d2']);
  fs.writeFileSync(path.join(folder,'none.csv'),toCsv([['doc_id'],['d9']]));fs.writeFileSync(path.join(folder,'no-ids.csv'),toCsv([['id'],['d1']]));received.length=0;
  const none=await run(['anthropic.py','corpus.csv','--only','none.csv','--base-url',base],{ANTHROPIC_API_KEY:KEY}),noIds=await run(['anthropic.py','corpus.csv','--only','no-ids.csv','--base-url',base],{ANTHROPIC_API_KEY:KEY});
  assert.notEqual(none.code,0);assert.match(none.stderr,/None of the documents that none\.csv lists are in corpus\.csv/);assert.notEqual(noIds.code,0);assert.match(noIds.stderr,/No doc_id values were found in no-ids\.csv/);assert.equal(received.length,0,'Nothing is sent when the list matches nothing');
  // A script made without the tables' column names keeps the fields' names.
  assert.equal(python.scriptValues({studyName:'s',runDescription:'r',provider:'anthropic',text:frames.requestFrame(setup,false),fields:FIELDS,plain:false}).COLUMNS,'["Tone"]');
  // A dry run prints the first request and sends nothing; without a key nothing is sent either.
  received.length=0;const {text:dryFrame}=scriptFor('anthropic'),dry=await run(['anthropic.py','corpus.csv','--dry-run'],{ANTHROPIC_API_KEY:'',PYTHONIOENCODING:'utf-8'});
  assert.equal(dry.code,0,dry.stderr);assert(dry.stdout.startsWith('POST https://api.anthropic.com/v1/messages\n'));assert.deepEqual(JSON.parse(dry.stdout.slice(dry.stdout.indexOf('\n')+1)),frames.fillRequest(dryFrame.body,{filename:'näme “1”.txt',text:TEXT}));
  const keyless=await run(['anthropic.py','corpus.csv','--base-url',base],{ANTHROPIC_API_KEY:''});assert.notEqual(keyless.code,0);assert.match(keyless.stderr,/Set the environment variable ANTHROPIC_API_KEY/);assert.equal(received.length,0);
  await new Promise(resolve=>server.close(resolve));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
 console.log('PASS: the Export tab’s tables, agreement, workbook, repositories, and Python script.');
})().catch(error=>{console.error(error);process.exit(1);});
