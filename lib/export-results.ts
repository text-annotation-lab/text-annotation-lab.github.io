import {resultFieldNames,resultAnswer,answerInstructions,type NamedAnswers} from './answer-fields';
import {knowledgeInstructions,knowledgeAssessment,type KnowledgeResearch} from './model-knowledge';
import {validChartYear} from './results-chart';
import ExcelJS from 'exceljs';
import {reasoningLabel} from './providers';
import type {ChunkInfo} from './chunk-text';
type Entry=NamedAnswers&Partial<ChunkInfo>&{chartYear?:number|null;chartGroup?:string|null;inputMode?:string;history?:import('./workflow-safety').Attempt[];startedAt?:string;id?:string;subjectId?:string;runNumber?:number;time?:string;webSearch?:boolean;webUsed?:boolean;instructions?:string;research?:KnowledgeResearch;fields?:{heading:string;value:string}[];provider?:string;processing?:string;concurrency?:number;batchId?:string;name:string;status:string;score?:string;explanation?:string;error?:string;model?:string;prompt?:string;effort?:string};
type Settings={responseFormat?:string;answerFields?:string[];studyName?:string;workspace?:string;processing?:string;concurrency?:number;provider?:string;prompt:string;model:string;effort:string;webSearch?:boolean;instructions?:string};

// Keep wrapped settings readable within Excel's row-height limit. Continuation
// cells preserve the exact original string when joined without a separator.
function settingsTextParts(text:string):string[]{
 const parts:string[]=[];let start=0,column=0,lines=1;
 for(let i=0;i<text.length;){
  const character=text[i]==='\r'&&text[i+1]==='\n'?'\r\n':String.fromCodePoint(text.codePointAt(i)!);
  const newline=character==='\n'||character==='\r'||character==='\r\n';
  if(newline){lines++;column=0;}
  else if(++column>80){lines++;column=1;}
  if(lines>20){parts.push(text.slice(start,i));start=i;lines=1;column=newline?0:1;}
  i+=character.length;
 }
 parts.push(text.slice(start));return parts;
}
// Keep a prompt together up to Excel's cell limits, even when the wrapped text
// is taller than the worksheet row. Never split a surrogate pair or CRLF.
function promptCellParts(text:string):string[]{
 const parts:string[]=[];
 let start=0,offset=0,lineFeeds=0;
 for(const [unit] of text.matchAll(/\r\n|[\s\S]/gu)){
  const hasLineFeed=unit.endsWith('\n');
  if(offset-start+unit.length>32767||(hasLineFeed&&lineFeeds===253)){
   parts.push(text.slice(start,offset));
   start=offset;
   lineFeeds=0;
  }
  offset+=unit.length;
  if(hasLineFeed)lineFeeds++;
 }
 parts.push(text.slice(start));
 return parts;
}
function settingsTextHeight(text:string){return Math.max(30,Math.min(400,text.split(/\r\n|\r|\n/).reduce((n,line)=>n+Math.max(1,Math.ceil(line.length/80)),0)*17+12));}
function excelAnswer(value:string){return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&value.replace(/\D/g,'').length<=15?Number(value):value;}
export async function createResultsWorkbook(docs:Entry[],current:Settings){
 const workbook=new ExcelJS.Workbook();workbook.creator='Text Annotation Lab';
 const rejected=docs.flatMap(d=>[{name:d.name,attempt:'Current',rawResponse:d.rawResponse},...(d.history||[]).map((a,i)=>({name:d.name,attempt:String(i+1),rawResponse:typeof a.rawResponse==='string'?a.rawResponse:undefined}))]).filter(d=>d.rawResponse);

 const knowledge=current.workspace==='model-knowledge',groups:Settings[]=[];
 const groupFor=(d:Entry)=>{if(d.prompt===undefined||!d.model)return undefined;const s={responseFormat:d.responseFormat,answerFields:d.answerFields,processing:d.processing||'instant',provider:d.provider||(d.model.startsWith('gemini-')?'gemini':d.model.startsWith('claude-')?'anthropic':'openai'),prompt:d.prompt,model:d.model,effort:d.effort||'Not recorded',concurrency:d.processing==='batch'?undefined:d.concurrency,...(knowledge?{webSearch:d.webSearch===true,instructions:d.instructions||knowledgeInstructions(d.webSearch)}:{})};let i=groups.findIndex(g=>g.responseFormat===s.responseFormat&&g.processing===s.processing&&g.provider===s.provider&&g.prompt===s.prompt&&g.model===s.model&&g.effort===s.effort&&g.concurrency===s.concurrency&&g.webSearch===s.webSearch&&g.instructions===s.instructions&&JSON.stringify(g.answerFields||[])===JSON.stringify(s.answerFields||[]));if(i<0){groups.push(s);i=groups.length-1;}return i+1;};
 const ids=docs.map(groupFor);if(!groups.length)groups.push(current);
 const multiple=groups.length>1,unfinished=docs.some(d=>d.status!=='done'),chunked=docs.some(d=>d.sourceId);
 const openRouterInputs=docs.some(d=>d.provider==='openrouter');
 const hasReviewedYears=docs.some(d=>d.chartYear!==undefined),hasGroups=docs.some(d=>typeof d.chartGroup==='string'&&d.chartGroup.trim()!=='');
 const explanations=docs.map(d=>{
  const field=d.answerFields?.find(name=>name.toLowerCase()==='explanation');
  const named=field?resultAnswer(d,field):'';
  const texts=[...new Set([named,d.explanation||''].filter(text=>text.trim()))];
  return texts.join('\n\n').match(/[\s\S]{1,30000}/g)||[''];
 });
 const continuationCount=explanations.reduce((n,chunks)=>Math.max(n,chunks.length-1),0);
 const fieldHeadings=Array.from(new Set(docs.flatMap(d=>d.fields?.map(f=>f.heading)||[])));
 const answerNames=resultFieldNames(docs).filter(name=>name.toLowerCase()!=='explanation'),legacyScore=docs.some(d=>!d.answerFields?.length)||!docs.some(d=>d.answerFields?.length);
 const results=workbook.addWorksheet('Results');
 results.columns=[...(knowledge?fieldHeadings.map((heading,i)=>({header:heading,key:`field${i}`,width:36})):[{header:'Filename',key:'name',width:42}]),...(hasReviewedYears?[{header:[...answerNames,...fieldHeadings].some(name=>name.toLowerCase()==='year')?'Reviewed year':'Year',key:'chartYear',width:16}]:[]),...(hasGroups?[{header:[...answerNames,...fieldHeadings].some(name=>name.toLowerCase()==='group')?'Chart group':'Group',key:'chartGroup',width:18}]:[]),...(legacyScore?[{header:'Score / category',key:'score',width:22}]:[]),...answerNames.map((name,i)=>({header:name,key:'answer'+i,width:24})),{header:'Explanation',key:'explanation',width:85},...(openRouterInputs?[{header:'Input handling',key:'inputMode',width:35}]:[]),...Array.from({length:continuationCount},(_,i)=>({header:`Explanation (continued ${i+1})`,key:`explanation${i+1}`,width:85})),...(knowledge?[{header:'Annotation ID',key:'annotationId',width:38},{header:'Subject ID',key:'subjectId',width:38},{header:'Run',key:'runNumber',width:10},{header:'Annotated / collected at (UTC)',key:'time',width:28},{header:'Method',key:'method',width:24},{header:'Web search used',key:'webUsed',width:20}]:[{header:'Annotation ID',key:'annotationId',width:38},{header:'Annotated / collected at (UTC)',key:'time',width:28}]),...(chunked?[{header:'Source ID',key:'sourceId',width:38},{header:'Chunk ID',key:'chunkId',width:38},{header:'Chunk method',key:'chunkMethod',width:24},{header:'Sentence segmenter',key:'segmenter',width:60},{header:'Source document',key:'source',width:42},{header:'Chunk',key:'chunk',width:12},{header:'Total chunks',key:'chunkCount',width:14},{header:'First word',key:'wordStart',width:14},{header:'Last word',key:'wordEnd',width:14},{header:'Words per chunk',key:'wordsPerChunk',width:20}]:[]),...(multiple?[{header:'Settings ID',key:'settings',width:16}]:[]),...(unfinished||knowledge?[{header:'Status',key:'status',width:20},{header:'Error',key:'error',width:60}]:[])];
 docs.forEach((d,i)=>{const s=d.score;const score=s!==undefined&&/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)&&Number.isFinite(Number(s))&&s.replace(/\D/g,'').length<=15?Number(s):s;const row=results.addRow({...Object.fromEntries(fieldHeadings.map((heading,i)=>[`field${i}`,d.fields?.find(f=>f.heading===heading)?.value??''])),...Object.fromEntries(answerNames.map((name,i)=>['answer'+i,excelAnswer(resultAnswer(d,name))])),annotationId:d.id||String(i+1),subjectId:d.subjectId||d.id||String(i+1),runNumber:d.runNumber||1,time:d.time||'',method:d.prompt===undefined?'Not annotated':d.webSearch?'Web-assisted':'Model knowledge only',webUsed:d.prompt===undefined?'':d.webUsed?'Yes':d.webSearch&&d.webUsed===undefined?'Not confirmed':'No',name:d.name,chartYear:validChartYear(d.chartYear)?d.chartYear:undefined,chartGroup:typeof d.chartGroup==='string'?d.chartGroup:undefined,inputMode:d.provider==='openrouter'?(d.prompt===undefined?'Not annotated':d.inputMode==='pdf-native'?'Whole PDF (native)':d.inputMode==='text'?'Text':/\.pdf$/i.test(d.name)?'Extracted PDF text (earlier run)':'Text'):'',sourceId:d.sourceId,chunkId:d.sourceId?d.id:undefined,chunkMethod:d.sourceId?(d.chunkMethod||'exact-words'):undefined,segmenter:d.segmenter,source:d.sourceName||d.name,chunk:d.chunkIndex,chunkCount:d.chunkCount,wordStart:d.wordStart,wordEnd:d.wordEnd,wordsPerChunk:d.wordsPerChunk,score,explanation:explanations[i][0],...Object.fromEntries(explanations[i].slice(1).map((chunk,j)=>[`explanation${j+1}`,chunk])),settings:ids[i]?`S${ids[i]}`:'',status:d.status==='done'?(knowledge?knowledgeAssessment(d):'Complete'):d.status==='pending'?'Not annotated':d.status==='queued'?'In batch':d.status==='running'?'In progress':'Error',error:d.error});row.height=Math.min(150,Math.max(32,Math.ceil(explanations[i][0].length/90)*15));});
 results.views=[{state:'frozen',ySplit:1}];results.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,results.rowCount),column:results.columnCount}};
 if(rejected.length){const raw=workbook.addWorksheet('Responses needing review');raw.columns=[{header:'Document / subject',key:'name',width:35},{header:'Attempt',key:'attempt',width:12},{header:'Part',key:'part',width:10},{header:'Returned response',key:'raw',width:100}];for(const d of rejected){(d.rawResponse!.match(/[\s\S]{1,30000}/g)||[]).forEach((text,i)=>raw.addRow({name:d.name,attempt:d.attempt,part:i+1,raw:text}));}}
 const settings=workbook.addWorksheet('Study settings');settings.columns=[{width:26},{width:100}];settings.addRow(['Study settings','Text Annotation Lab']);settings.addRow(['Department','Department of English, Aarhus University']);if(current.studyName)settings.addRow(['Study name',current.studyName]);settings.addRow(['Exported at (UTC)',new Date().toISOString()]);settings.addRow(['Settings below',ids.some(Boolean)?'Settings recorded for the annotation attempts in Results.':'Current settings; no annotation attempts.']);

 if(chunked){settings.addRow(['Unit of annotation','Each chunk is annotated independently; whole documents in this workbook remain independent texts.']);settings.addRow(['Chunk boundaries','See each row’s chunk method and target. Exact-word chunks use non-whitespace word runs. Sentence chunks prefer native English sentence and paragraph boundaries near the target; overlong sentences use exact-word splits. No overlap. Retained chunk text and word ranges are authoritative across browser segmentation versions. Source IDs, chunk IDs, segmenter, and target are recorded in Results.']);settings.addRow(['PDF chunks','Extracted text only; no images or OCR. Whole PDFs retain the usual PDF input.']);}
 const addSettingsText=(label:string,text:string)=>{
  const parts=label==='Annotation prompt'?promptCellParts(text):settingsTextParts(text);
  parts.forEach((part,i)=>{
   const row=settings.addRow([i?`${label} (continued)`:label,part]);
   row.height=settingsTextHeight(part);
  });
 };
 // Compare displayed fields as well as their labels, so provider-specific
 // reasoning settings and missing historical values keep their exact meaning.
 const fieldsFor=(g:Settings):[string,string|number][]=>[
  ['Provider',g.provider==='openrouter'?'OpenRouter':g.provider==='gemini'?'Google (Gemini)':g.provider==='anthropic'?'Anthropic (Claude)':'OpenAI (ChatGPT)'],
  ['Model',g.model],['Processing',g.processing==='batch'?'Batch':'Instant'],
  ['Parallel annotations',g.processing==='batch'?'Not applicable (batch)':g.concurrency??'Not recorded'],
  ...(knowledge?([['Method',g.webSearch?'Web-assisted':'Model knowledge only'],['Additional model instructions',g.instructions||knowledgeInstructions(g.webSearch)]] as [string,string][]):[]),
  ...(!g.answerFields?.length&&g.responseFormat?([['Recorded response format',g.responseFormat]] as [string,string][]):[]),
  ...(g.answerFields?.length?([['Answer fields',g.answerFields.join(', ')],['Answer format instructions',g.responseFormat||'Earlier format: named answer keys f0, f1, etc., plus score and explanation. The complete format was not recorded.']] as [string,string][]):[]),
  [reasoningLabel(g.provider,g.model),g.effort],['Annotation prompt',g.prompt],
 ];
 const fieldSets=groups.map(fieldsFor);
 const addField=([label,value]:[string,string|number])=>typeof value==='number'?settings.addRow([label,value]):addSettingsText(label,value);
 const shared=multiple?fieldSets[0].filter(([label,value])=>fieldSets.every(fields=>fields.some(([l,v])=>l===label&&v===value))):[];
 const section=(label:string,description:string)=>{settings.addRow([]);const row=settings.addRow([label,description]);row.font={bold:true,color:{argb:'FF003D73'}};};
 if(shared.length){section('Shared settings','Apply to every settings ID below.');shared.forEach(addField);}
 groups.forEach((_,i)=>{
  section(`S${i+1}`,multiple?'Differences between annotation settings':'Annotation settings for this export');
  fieldSets[i].filter(([label])=>!shared.some(([l])=>l===label)).forEach(addField);
 });
 if(multiple)settings.addRow(['Reading settings IDs','Match S1, S2, etc. to Results. Each ID combines the shared settings with its listed differences. Earlier failed attempts, if any, remain in Attempt history.']);
 const researchSheets:ExcelJS.Worksheet[]=[];
 if(knowledge&&docs.some(d=>d.research)){
  const sources=workbook.addWorksheet('Web sources');sources.columns=[{header:'Annotation ID',key:'annotation',width:38},{header:'Subject',key:'subject',width:42},{header:'Run',key:'run',width:10},{header:'Source number',key:'number',width:16},{header:'Title',key:'title',width:60},{header:'URL',key:'url',width:80},{header:'Searched at (UTC)',key:'time',width:28}];
  const notes=workbook.addWorksheet('Web research');notes.columns=[{header:'Annotation ID',key:'annotation',width:38},{header:'Subject',key:'subject',width:42},{header:'Run',key:'run',width:10},{header:'Part',key:'part',width:10},{header:'Research notes',key:'text',width:100},{header:'Search queries',key:'queries',width:60},{header:'Search instructions',key:'instructions',width:80},{header:'Search model',key:'model',width:28},{header:'Search reasoning effort',key:'effort',width:32},{header:'Search response ID',key:'response',width:38},{header:'Searched at (UTC)',key:'time',width:28}];
  docs.forEach((d,i)=>{if(!d.research)return;const shared={annotation:d.id||String(i+1),subject:d.name,run:d.runNumber||1,time:d.research.searchedAt};d.research.sources.forEach((source,j)=>sources.addRow({...shared,number:j+1,title:source.title.slice(0,30000),url:source.url.slice(0,30000)}));(d.research.text.match(/[\s\S]{1,30000}/g)||['']).forEach((text,j)=>{const row=notes.addRow({...shared,part:j+1,text,queries:j?'':d.research!.queries.join('\n').slice(0,30000),instructions:j?'':d.research!.instructions,model:d.research!.model||d.model||'',effort:d.research!.effort||'Not recorded',response:d.research!.responseId||''});row.height=150;});});
  researchSheets.push(sources,notes);for(const sheet of researchSheets){sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:sheet.columnCount}};}
 }
 if(docs.some(d=>d.history?.length)){
  const history=workbook.addWorksheet('Attempt history');history.columns=[{header:'Record ID',key:'id',width:38},{header:'Subject / document',key:'name',width:42},{header:'Run',key:'run',width:10},{header:'Earlier attempt',key:'attempt',width:18},{header:'Status',key:'status',width:16},{header:'Error',key:'error',width:60},{header:'Provider',key:'provider',width:20},{header:'Model',key:'model',width:28},{header:'Part',key:'part',width:10},{header:'Full attempt record (JSON; join parts without separator)',key:'record',width:100}];
  docs.forEach(d=>d.history?.forEach((attempt,i)=>settingsTextParts(JSON.stringify(attempt)).forEach((record,j)=>{const row=history.addRow({id:d.id,name:d.name,run:d.runNumber||1,attempt:i+1,status:attempt.status,error:attempt.error?.slice(0,30000),provider:attempt.provider,model:attempt.model,part:j+1,record});row.height=settingsTextHeight(record);})));history.views=[{state:'frozen',ySplit:1}];researchSheets.push(history);
 }
 for(const sheet of [results,settings,...researchSheets]){sheet.eachRow(row=>{row.eachCell(cell=>{cell.alignment={vertical:'top',wrapText:true};if(!cell.font)cell.font={size:11};});if(sheet===settings&&!row.height)row.height=settingsTextHeight(String(row.getCell(2).value||''));});const h=sheet.getRow(1);h.height=30;h.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF003D73'}};cell.font={bold:true,color:{argb:'FFFFFFFF'},size:11};});}
 return workbook.xlsx.writeBuffer();
}
