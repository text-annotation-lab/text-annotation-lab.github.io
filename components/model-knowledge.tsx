"use client";
import {newId} from '@/lib/identifier';

import type {OpenStudyDraft} from './study-manager';
import {SettingsNotice} from '@/components/student-guidance';
import {NamedAnswerDetail,collectedAnswers} from '@/components/named-answer-detail';
import {AnswerFields} from '@/components/answer-fields';
import {reviewStoredAnswer,annotationValidationError} from '@/lib/answer-validation';
import {annotationFormatRecord,answerInstructions,hasSeparateExplanation,validAnswerFields,resultColumns,resultAnswer,answerLabel,answerValues,sentAnswers,cleanAnswerSettings,type NamedAnswers,type AnswerSettings} from '@/lib/answer-fields';
import {setupErrors,queueRetries,retryMessage,queueSummary} from '@/lib/workflow-safety';
import {DEFAULT_ANNOTATION_CONCURRENCY,concurrencyChoices,annotationConcurrency,runAnnotationQueue,sendAnnotation} from '@/lib/annotation-queue';
import {missingAnnotationSetup,rateLimitNotice,isRateLimitNotice} from '@/lib/annotation-feedback';
import CostEstimate from '@/lib/cost-estimate/panel';
import {studentEstimate,countStudentInputs} from '@/lib/student-estimate';
import {ownPrice,useOwnPrices} from '@/lib/own-prices';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {MAX_BATCH_ITEMS,MAX_BATCH_SOURCE_BYTES,MAX_KNOWLEDGE_INPUT_CHARS,BATCH_CAPACITY} from '@/lib/batch-limits';
import {ResultPages} from '@/components/result-pages';
import {ResultsChart} from '@/components/results-chart';
import {Button} from '@/components/ui/button';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import type {BatchJob,BatchUpdate,BatchResult} from '@/lib/batch-types';
import {PROVIDERS,modelLabel} from '@/lib/providers';
import {Progress} from '@/components/ui/progress';
import {ArrowRight,Play,Pause,Download,Repeat2} from 'lucide-react';
import {createWorkspaceStorage} from '@/lib/workspace-storage';
import {studyWorkspaceKey} from '@/lib/studies';
import {cleanScoreScale,type ScoreScale} from '@/lib/research/score-scale';
import {knowledgeDuplicates,parseKnowledgeItems,KNOWLEDGE_SAMPLE,KNOWLEDGE_EXAMPLES,KNOWLEDGE_STUDY,knowledgeInstructions,knowledgeItemText,knowledgeAssessment,repeatKnowledgeItems,type KnowledgeMode,type KnowledgeItem,type KnowledgeResearch} from '@/lib/model-knowledge';
import type {Provider} from '@/lib/providers';
import {ResearchTools,ResearchDetail,ResearchRequestOptions,ResearchRequestPreview,DetailSteps,stepKey} from '@/components/research-mode';
import {cleanRequestSettings,sentRequestSettings,requestSummary,type RequestSettings} from '@/lib/request-settings';
import {requestFrame} from '@/lib/request-frame';
import {cleanRequests,recordRequest,usedRequests,replyNotes,NOT_RECORDED,type RecordedRequest,type Recorded} from '@/lib/research/requests';
import {carriedOnNotice,connectionFailure,earlyStopNotice,earlyStopper,takeShared} from '@/lib/research/early-stop';
import {promptInserts,fixedLength,insertMap} from '@/lib/prompt-inserts';
import {insertValues} from '@/lib/research/inserts';
import {LAB_VERSION} from '@/lib/version';
import {cleanColumns,type Column} from '@/lib/research/columns';
import {cleanSamples,type SampleRecord} from '@/lib/research/sample';
import {knowledgeRows,subjectRows,applySubjectCells} from '@/lib/research/knowledge';
import {runSummaries} from '@/lib/research/runs';
import {MAX_REPEATS,annotationCount,annotationFrom,claimRepeats,cleanRepeats,incomplete,missingRepeats,repeatsHint,repeatsOf,settle,unclaimed,withAnnotation,type Annotation} from '@/lib/research/repeats';

export type KnowledgeSetup={answerFields:string[];setAnswerFields:(names:string[])=>void;answerSettings?:AnswerSettings;setAnswerSettings:(settings:AnswerSettings|undefined)=>void;scoreScale?:ScoreScale;setScoreScale?:(scale:ScoreScale|undefined)=>void;validationRequested?:boolean;prompt:string;setPrompt:(value:string)=>void;locked:boolean;ready:boolean;extraSetup?:ReactNode;keyLocked?:boolean;preview?:ReactNode;columns?:Column[]};
type Item=KnowledgeItem;
export type WorkspaceSaveState='loading'|'saving'|'saved'|'error'|'conflict';
// What research mode reads from this workspace: its results, labels and metadata, samples, and current settings.
export type KnowledgeResearchData={items:Item[];columns:Column[];samples:SampleRecord[];requests?:RecordedRequest[];scoreScale?:ScoreScale;settings:{answerFields:string[];prompt:string;webSearch:boolean;processing:string;concurrency:number}};
type Props={research?:boolean;onResearchData?:(data:KnowledgeResearchData)=>void;draftRef?:OpenStudyDraft;keyRejected:boolean;onSaveStateChange?:(state:WorkspaceSaveState)=>void;studyId?:string;studyName?:string;onStudyReady?:(ready:boolean)=>void;provider:Provider;model:string;effort:string;apiKey:string;parentLocked:boolean;renderSetup:(options:KnowledgeSetup)=>ReactNode;onBusyChange:(busy:boolean)=>void};
function ReferenceText({text,research}:{text:string;research?:KnowledgeResearch}){return <>{text.split(/(\[\d+\])/g).map((part,i)=>{const match=part.match(/^\[(\d+)\]$/),source=match?research?.sources[Number(match[1])-1]:undefined;return source&&/^https?:\/\//i.test(source.url)?<a key={i} href={source.url} target="_blank" rel="noreferrer" title={source.title}>{part}</a>:part;})}</>;}
export function ModelKnowledge({research=false,onResearchData,draftRef,studyId='current',studyName,onStudyReady,onSaveStateChange,provider,model,effort,apiKey,keyRejected,parentLocked,renderSetup,onBusyChange}:Props){
 const [mode,setMode]=useState<KnowledgeMode>('list'),[headings,setHeadings]=useState(''),[input,setInput]=useState(''),[prompt,setPrompt]=useState(''),[items,setItems]=useState<Item[]>([]),[selected,setSelected]=useState(''),[webSearch,setWebSearch]=useState(false);
 const [answerFields,setAnswerFields]=useState<string[]>([]);
 // Research mode: field types, plain text, or no explanation; `sent` is what a request uses.
 const [answerSettings,setAnswerSettings]=useState<AnswerSettings|undefined>();
 const sent=sentAnswers(answerFields,answerSettings),sentFields=sent.names,sentSettings=sent.settings;
 // Research mode: human labels and metadata for the subjects, and the samples drawn from them.
 const [columns,setColumns]=useState<Column[]>([]),[samples,setSamples]=useState<SampleRecord[]>([]);
 // Research mode: the scale of the scores in plain-text replies, for the statistics only (never sent).
 const [scoreScale,setScoreScale]=useState<ScoreScale>();
 const {names:resultNames,showLegacy:showLegacyScore}=resultColumns(items,sentFields);
 const [resultPage,setResultPage]=useState(0);
 const [provenance,setProvenance]=useState<any>();
 const [setupChecked,setSetupChecked]=useState(false);
 const [concurrency,setConcurrency]=useState(DEFAULT_ANNOTATION_CONCURRENCY),[showProcessing,setShowProcessing]=useState(false);
 // Research mode offers more annotations at once; a study set to more than the standard mode offers runs one at a time there.
 const parallel=annotationConcurrency(concurrency,research);
 // Research mode: annotations per subject, 1 to 10 (lib/research/repeats.ts), stored with the study when more than
 // one. times: how many a run makes; always one in the standard Lab and with web search.
 const [repeats,setRepeats]=useState(1),storedRepeats=repeats>1?repeats:undefined,times=research&&!webSearch?repeats:1;
 // Research mode: prompt caching. Stored with the study; a request carries it only in research mode and where the model's provider caches at a mark.
 const [requestSettings,setRequestSettings]=useState<RequestSettings|undefined>();
 // Research mode: the placeholders of the prompt that are filled in for each subject (lib/prompt-inserts.ts). A
 // prompt that begins with one has no part that every subject shares, so nothing of it can be cached.
 const insertNames=research?promptInserts(prompt):[],promptFixed=insertNames.length?fixedLength(prompt):undefined;
 // Research mode: your own price for the model, for the cost estimate before a run.
 const ownPrices=useOwnPrices(),typedPrice=research?ownPrice(provider,model,ownPrices):undefined;
 const sentRequest=research?sentRequestSettings(provider,model,promptFixed!==undefined&&!prompt.slice(0,promptFixed).trim()?{...requestSettings,cache:undefined}:requestSettings,effort):undefined;
 // The values a subject gives those placeholders, kept with its result.
 const insertsOf=(item:Item):{inserts?:string[]}=>insertNames.length?{inserts:insertValues(insertNames,item,columns)}:{};
 // Research mode: the requests the runs sent, each kept once (lib/research/requests.ts).
 const [requests,setRequests]=useState<RecordedRequest[]|undefined>(),requestsNow=useRef<RecordedRequest[]|undefined>(undefined);requestsNow.current=requests;
 const [processing,setProcessing]=useState('instant'),[batchJob,setBatchJob]=useState<BatchJob|null>(null),[batchBusy,setBatchBusy]=useState(false),[recoverId,setRecoverId]=useState('');
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[notice,setNotice]=useState(''),[storageIssue,setStorageIssue]=useState(''),[conflict,setConflict]=useState(false),[saved,setSaved]=useState(true);
 useEffect(()=>{if(ready&&provider==='openrouter'&&!batchJob){setProcessing('instant');setWebSearch(false);}},[ready,provider,batchJob]);
 useEffect(()=>{onResearchData?.({items,columns,samples,requests,scoreScale,settings:{answerFields:sentFields,prompt,webSearch,processing,concurrency:parallel}});},[onResearchData,items,columns,samples,requests,scoreScale,answerFields,answerSettings,prompt,webSearch,processing,parallel]);
 const storage=useRef(createWorkspaceStorage(studyWorkspaceKey(studyId,true))),canSave=useRef(false),firstSave=useRef(true),stop=useRef(false),lock=useRef(false),latest=useRef<Item[]>([]);latest.current=items;
 useEffect(()=>{onStudyReady?.(ready&&saved&&!storageIssue&&!busy&&!batchBusy&&!exporting);},[ready,saved,storageIssue,busy,batchBusy,exporting,onStudyReady]);
 useEffect(()=>{onSaveStateChange?.(conflict?'conflict':storageIssue?'error':!ready?'loading':saved?'saved':'saving');},[ready,saved,storageIssue,conflict,onSaveStateChange]);
 const parsed=parseKnowledgeItems(mode,headings,input),locked=busy||batchBusy||Boolean(batchJob)||exporting||parentLocked||!ready||conflict;
 const duplicates=knowledgeDuplicates(parsed.items,items);
 useEffect(()=>{storage.current.restore().then(value=>{canSave.current=true;if(value){setProvenance(value.provenance);if((value.items||[]).some((item:Item)=>reviewStoredAnswer(item,true)!==item)){firstSave.current=false;setNotice('Some earlier answers need review under their recorded output instructions. Their returned values are preserved; no new requests were sent.');}setMode(value.mode==='structured'?'structured':'list');setHeadings(value.headings||'');setInput(value.input||'');setPrompt(value.prompt||'');setAnswerFields(validAnswerFields(value.answerFields)?value.answerFields:[]);setAnswerSettings(cleanAnswerSettings(value.answerSettings));setColumns(cleanColumns(value.columns));setSamples(cleanSamples(value.samples));setScoreScale(cleanScoreScale(value.scoreScale));setWebSearch(value.webSearch===true);setProcessing(value.processing==='batch'&&!value.webSearch?'batch':'instant');setConcurrency(value.concurrency===undefined?DEFAULT_ANNOTATION_CONCURRENCY:annotationConcurrency(value.concurrency,true));setRepeats(cleanRepeats(value.repeats)??1);setRequestSettings(cleanRequestSettings(value.requestSettings));setRequests(usedRequests(cleanRequests(value.requests),value.items||[]));if(value.batchJob&&Array.isArray(value.batchJob.docIds))setBatchJob({...value.batchJob,state:value.batchJob.state==='submitting'?'unknown':value.batchJob.state});setItems((value.items||[]).map((item:Item)=>reviewStoredAnswer(item,true)).map((item:Item)=>item.status==='running'?{...item,status:'error',error:'Interrupted. Check provider usage before retrying; the request may have completed.'}:item));if(value.items?.some((item:Item)=>item.status==='running'))firstSave.current=false;}}).catch(()=>setStorageIssue('Could not read this experimental workspace. Existing saved data has not been overwritten. Download new results before leaving.')).finally(()=>setReady(true));},[]);
 useEffect(()=>{
  if(draftRef)draftRef.current.knowledge=ready&&(canSave.current||conflict)?{provenance,mode,headings,input,answerFields,answerSettings,prompt,webSearch,items,processing,concurrency,repeats:storedRepeats,requestSettings,requests,batchJob,columns,samples,...(scoreScale?{scoreScale}:{})}:undefined;
 },[draftRef,ready,conflict,provenance,mode,headings,input,answerFields,answerSettings,prompt,webSearch,items,processing,concurrency,repeats,requestSettings,requests,batchJob,columns,samples,scoreScale]);
 useEffect(()=>{if(!ready||!canSave.current)return;if(firstSave.current){firstSave.current=false;return;}let active=true;setSaved(false);storage.current.save({provenance,mode,headings,input,answerFields,answerSettings,prompt,webSearch,items,processing,concurrency,repeats:storedRepeats,requestSettings,requests,batchJob,columns,samples,...(scoreScale?{scoreScale}:{})},{replaceable:true}).then(()=>{if(active){setSaved(true);setStorageIssue('');}}).catch(error=>{stop.current=true;const isConflict=error instanceof Error&&error.message.startsWith('Another tab');if(isConflict){canSave.current=false;setConflict(true);}setStorageIssue(isConflict?error.message:'Could not save the experimental workspace. Download your results before leaving.');});return()=>{active=false;};},[mode,headings,input,answerFields,answerSettings,prompt,webSearch,items,processing,concurrency,repeats,requestSettings,requests,batchJob,provenance,ready,columns,samples,scoreScale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(lock.current||!saved){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[saved]);
 function update(id:string,changes:Partial<Item>){latest.current=latest.current.map(item=>item.id===id?{...item,...changes}:item);setItems(latest.current);}
 const detailRequest=useRef(false);
 function viewItem(id:string){detailRequest.current=true;setSelected(id);if(id===selected){const detail=document.getElementById('knowledge-detail');detail?.focus();detail?.scrollIntoView({block:'nearest'});detailRequest.current=false;}}
 useEffect(()=>{if(!detailRequest.current)return;detailRequest.current=false;const detail=document.getElementById('knowledge-detail');detail?.focus();detail?.scrollIntoView({block:'nearest'});},[selected]);
 function add(keepDuplicates=false){if(locked||parsed.error||!parsed.items.length)return;if(duplicates.duplicateIndices.size&&!keepDuplicates)return;commitSubjects(parsed.items);}
 function commitSubjects(fieldsList:typeof parsed.items){const added=fieldsList.map(fields=>{const id=newId();return {id,subjectId:id,runNumber:1,name:fields.map(f=>f.value).filter(v=>v.trim()).join(' · '),fields,status:'pending'};});setItems(current=>[...current,...added]);setInput('');setNotice(`${added.length} subjects added as separate observations. Each will be annotated separately.`);}
 function retry(id?:string){if(locked)return;const count=latest.current.filter(item=>item.status==='error'&&(!id||item.id===id)).length;if(count&&confirm(retryMessage(count))){latest.current=queueRetries(latest.current,id);setItems(latest.current);setNotice('Retries queued. Review the current prompt and settings, then choose Annotate next or '+(processing==='batch'?'Submit batch':'Run all')+'.');}}

 const notifiedBusy=useRef(false);
 function reportBusy(next:boolean){if(next!==notifiedBusy.current){notifiedBusy.current=next;onBusyChange(next);}}
 useEffect(()=>{reportBusy(busy||batchBusy||Boolean(batchJob));},[busy,batchBusy,batchJob,onBusyChange]);
 function saveKnowledge(items:Item[],batchJob:BatchJob|null){return storage.current.save({provenance,mode,headings,input,answerFields,answerSettings,prompt,webSearch,items,processing,concurrency,repeats:storedRepeats,requestSettings,requests:requestsNow.current,batchJob,columns,samples,...(scoreScale?{scoreScale}:{})});}
 // A new run of a subject carries the subject's labels and metadata along.
 function keepCells(next:Item[]){return columns.length?applySubjectCells(next,subjectRows(latest.current)):next;}
 function repeat(id?:string){if(locked)return;const added=keepCells(repeatKnowledgeItems(latest.current,id));if(!added.length)return;setItems(current=>[...current,...added]);setSelected(added[0].id);setNotice(`Run ${added[0].runNumber}: ${times>1?`${added.length} ${added.length===1?'subject':'subjects'} queued, ${times} annotations each`:`${added.length} fresh annotation${added.length===1?'':'s'} queued`}. Earlier results are kept. Check the current settings, then choose Annotate next or ${processing==='batch'?'Submit batch':'Run all'}.`);}
 function loadExamples(){if(locked||input&&!confirm('Replace the unqueued input with example subjects? Queued subjects and results are kept.'))return;setMode('list');setInput(KNOWLEDGE_EXAMPLES);if(!prompt.trim())setPrompt(KNOWLEDGE_SAMPLE);setNotice('Example subjects loaded for preview. Review the prompt, then add them to the queue.');}
 // Research mode: what a result about to be made records of its request: the request itself (kept once in the
 // list) and the build of the Lab. The standard Lab records nothing.
 function recorded(batch:boolean):Recorded{
  if(!research)return {};
  const kept=recordRequest(requestsNow.current,requestFrame({provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,knowledge:true,webSearch,batch,inserts:insertNames.length>0},false));
  if(kept.list!==requestsNow.current){requestsNow.current=kept.list;setRequests(kept.list);}
  return {...NOT_RECORDED,requestId:kept.id,lab:LAB_VERSION};
 }
 // Research mode, several annotations per subject: the latest result of a subject that has fewer annotations than
 // its run made gets the missing ones, with an unchanged setup (as "Remaining" does for texts).
 function resumable(list:Item[]):Set<string>{
  if(times<2)return new Set();
  const last=new Map<string,Item>();
  for(const item of list){const key=item.subjectId||item.id,seen=last.get(key);if(!seen||(item.runNumber||1)>=(seen.runNumber||1))last.set(key,item);}
  const same=(item:Item)=>item.provider===provider&&item.model===model&&item.effort===effort&&item.prompt===prompt&&!item.webSearch&&JSON.stringify(item.answerFields||[])===JSON.stringify(sentFields)&&JSON.stringify(item.answerSettings??null)===JSON.stringify(sentSettings??null)&&JSON.stringify(item.requestSettings??null)===JSON.stringify(sentRequest??null);
  return new Set([...last.values()].filter(item=>item.status==='done'&&incomplete(item)&&repeatsOf(item)===times&&same(item)).map(item=>item.id));
 }
 async function run(all:boolean){
  if(lock.current||locked||keyRejected)return;
  setSetupChecked(true);const errors=setupErrors(provider,apiKey,prompt,model,effort);const missingSetup=missingAnnotationSetup(apiKey,prompt)||Object.values(errors).find(Boolean);if(missingSetup){setNotice(errors.key||errors.prompt?'':missingSetup);document.getElementById(errors.key?'knowledge-key':errors.prompt?'knowledge-prompt':'knowledge-setup')?.focus();return;}
  lock.current=true;stop.current=false;setBusy(true);reportBusy(true);setNotice('');
  // What waits: a subject without a result, or one that gets its missing annotations. Each is taken once per run,
  // so one whose missing annotations fail again is not sent over and over.
  const resume=resumable(latest.current),waits=(item:Item)=>item.status==='pending'||resume.has(item.id)&&incomplete(item),taken=new Set<string>();
  // runSize counts requests: one per subject, or one per annotation still to be made.
  const requestCount=(item:Item)=>item.status==='pending'?times:missingRepeats(item).length,eligible=latest.current.filter(waits);
  const runId=newId(),runStartedAt=new Date().toISOString(),runSize=all?eligible.reduce((n,item)=>n+requestCount(item),0):eligible[0]?requestCount(eligible[0]):times;
  let claimed=0,failed=false;const noted=recorded(false);
  // Research mode: a failed subject is marked and the run carries on; it stops only when its first requests all
  // failed in a way every request would meet. answered, failures: the requests that came back, and those that failed.
  const early=research?earlyStopper():undefined;let answered=0,failures=0;
  // Several annotations per subject. waitingTasks: annotations of the subjects begun that are still to be sent.
  // open: per subject begun, how it was before, how many of its annotations are outstanding, and how many came back.
  type Task={item:Item;n:number};
  const waitingTasks:Task[]=[],open=new Map<string,{before:Item;left:number;came:number}>();
  // None of the subject's annotations is outstanding: its own fields are worked out from its annotations. One for
  // which none came back (the run stopped first) is as it was.
  const settleItem=(id:string)=>{
   const state=open.get(id);if(!state)return;open.delete(id);
   const row=latest.current.find(x=>x.id===id);if(!row)return;
   if(state.came)update(id,settle(row));else{latest.current=latest.current.map(x=>x.id===id?state.before:x);setItems(latest.current);}
  };
  // One annotation came back, or (without `annotation`) was not sent because the run stopped.
  const close=(id:string,annotation?:Annotation,format?:string)=>{
   const state=open.get(id);if(!state)return;
   const row=latest.current.find(x=>x.id===id);
   if(annotation&&row){state.came++;update(id,{...withAnnotation(row,annotation),...(format?{responseFormat:format}:{})});}
   if(--state.left<=0)settleItem(id);
  };
  try{await runAnnotationQueue<Task>({
   concurrency:all?parallel:1,
   shouldStop:()=>stop.current,
   // Research mode: when the provider reports a rate limit, wait and go on with fewer at a time.
   pace:research?{onLimited:limited=>setNotice(rateLimitNotice(limited,'subject'))}:undefined,
   take:()=>{
    // The annotations of a subject already begun come before a new subject.
    const next=waitingTasks.shift();if(next)return next;
    if(!all&&claimed)return;
    const item=latest.current.find(item=>!taken.has(item.id)&&waits(item));if(!item)return;
    taken.add(item.id);claimed++;
    // n: the number of the annotation; 0 for a subject's single annotation, which is written on the subject itself.
    const ns=times===1?[0]:item.status==='pending'?Array.from({length:times},(_,i)=>i+1):missingRepeats(item);
    update(item.id,{status:'running',runId,runStartedAt,runSize,usage:undefined,startedAt:new Date().toISOString(),error:undefined,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,answers:undefined,provider,model,effort,prompt,webSearch,processing:'instant',concurrency:all?parallel:1,batchId:undefined,instructions:knowledgeInstructions(webSearch),research:undefined,webUsed:undefined,time:undefined,score:undefined,explanation:undefined,...noted,...insertsOf(item),...claimRepeats(item,times)});
    if(times>1){open.set(item.id,{before:item,left:ns.length,came:0});waitingTasks.push(...ns.slice(1).map(n=>({item,n})));}
    if(claimed===1)setSelected(item.id);
    return {item,n:ns[0]};
   },
   perform:async({item,n},place)=>{
   // A subject's single annotation is written on the subject. With several, each one is gathered in `got` and
   // kept as an annotation of its own.
   const got:Record<string,any>=n?{runId,runStartedAt,runSize,startedAt:new Date().toISOString(),processing:'instant',concurrency:all?parallel:1,...noted,...insertsOf(item)}:{};
   const write=n?(changes:Partial<Item>)=>{Object.assign(got,changes);}:(changes:Partial<Item>)=>update(item.id,changes);
   // The mark of a failure every request of the run would meet. It is read off the reply and never kept.
   // back: a reply came back (a request that did not get as far as a reply may have had no connection).
   let shared:string|undefined,back=false;
   try{const form=new FormData();form.set('mode','model-knowledge');form.set('fields',JSON.stringify(item.fields));form.set('provider',provider);form.set('model',model);form.set('effort',effort);form.set('prompt',prompt);form.set('answerFields',JSON.stringify(sentFields));if(sentSettings)form.set('answerSettings',JSON.stringify(sentSettings));if(sentRequest)form.set('requestSettings',JSON.stringify(sentRequest));form.set('webSearch',String(webSearch));if(research)form.set('record','true');if(insertNames.length)form.set('inserts',JSON.stringify(insertValues(insertNames,item,columns)));
    const sent=await sendAnnotation(()=>fetch('/api/annotate',{method:'POST',headers:{Authorization:`Bearer ${apiKey.trim()}`},body:form}),place);
    // The run stopped while this subject waited out a rate limit: it was not annotated and waits again as before.
    if(!sent){if(n)close(item.id);else{latest.current=latest.current.map(x=>x.id===item.id?item:x);setItems(latest.current);}return;}
    back=true;shared=takeShared(sent.out);
    const response=sent.response,out=sent.out as {responseFormat?:string;rawResponse?:string;answers?:Record<string,string>;score?:string;explanation?:string;error?:string;tokens?:number;usage?:any;responseId?:string;webUsed?:boolean;research?:KnowledgeResearch}|null;if(out?.usage)write({usage:out.usage,tokens:out.tokens,responseId:out.responseId});if(research&&out)write(replyNotes(out));if(out?.rawResponse&&!response.ok)write({...out,time:new Date().toISOString()});if(out?.research)write({research:out.research,webUsed:out.webUsed});if(!out||!response.ok||typeof out.score!=='string'||typeof out.explanation!=='string')throw Error(out?.error||'The response could not be read. Check provider usage before retrying.');
    write({status:'done',responseFormat:out.responseFormat,answers:answerValues(out,sentFields),score:out.score,explanation:out.explanation,tokens:out.tokens,usage:out.usage,responseId:out.responseId,webUsed:out.webUsed===true,time:new Date().toISOString()});
    answered++;early?.(item.id);
   }catch(error){
    if(early){
     write({status:'error',error:error instanceof Error?error.message:'Request failed.'});
     answered++;failures++;
     const stopped=early(item.id,back?shared:connectionFailure(error).shared);
     if(stopped&&!failed){stop.current=true;failed=true;setNotice(earlyStopNotice(stopped,'subject'));}
    }else{stop.current=true;failed=true;write({status:'error',error:error instanceof Error?error.message:'Request failed.'});setSelected(item.id);setNotice('Stopped starting new annotations after an error. Active requests will finish, and completed results are kept. Review the error before retrying.');}
   }
   if(n)close(item.id,annotationFrom(n,got.status==='done',{...got,time:got.time||new Date().toISOString()}),typeof got.responseFormat==='string'?got.responseFormat:undefined);
   }
  });}finally{
   // Several annotations per subject: what was not sent stays unsent, and every subject begun is settled.
   for(const task of waitingTasks.splice(0))close(task.item.id);
   for(const id of [...open.keys()])settleItem(id);
   // What the failures left: subjects with fewer annotations than planned, subjects without any, or both.
   const left=latest.current.filter(item=>taken.has(item.id)),missing=times>1&&left.some(item=>incomplete(item)),kind=missing?left.some(item=>item.status==='error')?'knowledge-mixed':'knowledge-missing':'knowledge';
   if(stop.current&&!failed)setNotice('Paused. Active annotations have finished; completed results are kept.'+(failures?' '+carriedOnNotice(failures,answered,kind,true):''));else if(failures&&!failed)setNotice(carriedOnNotice(failures,answered,kind));lock.current=false;setBusy(false);reportBusy(false);
  }
 }
 async function batchRequest(action:string,job:BatchJob,extra?:FormData){
  const form=extra||new FormData();form.set('action',action);form.set('provider',job.provider);if(job.id)form.set('id',job.id);if(job.answerSettings?.plain)form.set('plain','true');if(research&&action==='collect'){form.set('record','true');if(job.requestSettings?.summary)form.set('summary','true');}
  const r=await fetch('/api/batch',{method:'POST',headers:{Authorization:`Bearer ${apiKey.trim()}`},body:form});
  const out:any=await r.json().catch(()=>null);
  if(!out||!r.ok){const error=new Error(out?.error||'The connection was interrupted. Check your provider before submitting again.') as Error&{uncertain:boolean};error.uncertain=out?.uncertain??true;throw error;}return out;
 }
 async function submitBatch(){
  if(lock.current||locked||webSearch||keyRejected)return;
  setSetupChecked(true);const errors=setupErrors(provider,apiKey,prompt,model,effort);const missingSetup=missingAnnotationSetup(apiKey,prompt)||Object.values(errors).find(Boolean);if(missingSetup){setNotice(errors.key||errors.prompt?'':missingSetup);document.getElementById(errors.key?'knowledge-key':errors.prompt?'knowledge-prompt':'knowledge-setup')?.focus();return;}
  // What waits: a subject without a result, or one that gets its missing annotations.
  const resume=resumable(latest.current),pending=latest.current.filter(d=>d.status==='pending'||resume.has(d.id));if(!pending.length)return;
  // Which annotations each subject gets: 0 for a subject's single annotation; else all of them, or the missing ones.
  const ns=pending.map(d=>times===1?[0]:d.status==='pending'?Array.from({length:times},(_,i)=>i+1):missingRepeats(d)),count=ns.reduce((n,list)=>n+list.length,0);
  if(count>MAX_BATCH_ITEMS||new TextEncoder().encode(JSON.stringify(pending.map(d=>d.fields))).length>MAX_BATCH_SOURCE_BYTES){setNotice(times>1?'Submit up to 10,000 requests (subjects × annotations per subject) and 50 MB of fields together. Submit fewer subjects when this limit is exceeded.':'Submit up to 10,000 subjects and 50 MB of fields together. Submit fewer subjects when this limit is exceeded.');return;}
  lock.current=true;setBatchBusy(true);setNotice('');
  const job:BatchJob={responseFormat:annotationFormatRecord(sentFields,prompt,true,sentSettings),answerFields:sentFields,...(sentSettings?{answerSettings:sentSettings}:{}),...(sentRequest?{requestSettings:sentRequest}:{}),runId:'lab_'+newId(),provider,model,prompt,effort,docIds:pending.map(d=>d.id),createdAt:new Date().toISOString(),state:'submitting',...(times>1?{repeats:times,...(ns.some(list=>list.length!==times)?{ns}:{})}:{})};
  const queuedIds=new Set(job.docIds),noted=recorded(true);
  const queued=latest.current.map(d=>queuedIds.has(d.id)?{...d,status:'queued',runId:job.runId,runStartedAt:job.createdAt,runSize:count,usage:undefined,startedAt:new Date().toISOString(),error:undefined,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,answers:undefined,provider,model,prompt,effort,processing:'batch',concurrency:undefined,webSearch:false,webUsed:false,instructions:knowledgeInstructions(false),research:undefined,score:undefined,explanation:undefined,time:undefined,tokens:undefined,responseId:undefined,...noted,...insertsOf(d),...claimRepeats(d,times)}:d);
  let submitted=false;
  try{
   // Save the recovery reference before anything can create a paid provider job.
   await saveKnowledge(queued,job);
   latest.current=queued;setItems(queued);setBatchJob(job);
   const form=new FormData();form.set('model',model);form.set('effort',effort);form.set('prompt',prompt);form.set('answerFields',JSON.stringify(sentFields));if(sentSettings)form.set('answerSettings',JSON.stringify(sentSettings));if(sentRequest)form.set('requestSettings',JSON.stringify(sentRequest));form.set('runId',job.runId);form.set('ids',JSON.stringify(Array.from({length:count},(_,i)=>job.runId+'_'+i)));if(times>1)form.set('copies',JSON.stringify(ns.map(list=>list.length)));form.set('mode','model-knowledge');form.set('webSearch','false');form.set('subjects',JSON.stringify(pending.map(d=>d.fields)));if(insertNames.length)form.set('inserts',JSON.stringify(pending.map(d=>insertValues(insertNames,d,columns))));
   submitted=true;
   const out=await batchRequest('submit',job,form);if(typeof out.id!=='string'||!out.id)throw new Error('Submission was not confirmed. Check the provider’s console.');const accepted={...job,id:out.id,state:'processing' as const};setBatchJob(accepted);
   await saveKnowledge(queued,accepted);
   setNotice('Batch submitted. Once this workspace is saved, you can close the page and return in this browser.');
  }catch(error){
   const uncertain=submitted&&((error as Error&{uncertain?:boolean}).uncertain!==false);
   if(uncertain){setBatchJob(j=>({...j||job,state:'unknown'}));setNotice('Submission or saving was not confirmed. Do not submit again yet. Check your provider’s console and use the batch reference below to recover it.');}
   else{const queuedIds=new Set(job.docIds);latest.current=latest.current.map(d=>queuedIds.has(d.id)?unclaimed(d):d);setItems(latest.current);setBatchJob(null);setNotice(error instanceof Error?error.message:'Could not submit this batch.');}
  }finally{lock.current=false;setBatchBusy(false);}
 }
 async function manageBatch(action:'check'|'collect'|'cancel',idOverride?:string){
  if(lock.current||!batchJob||conflict)return;
  if(!apiKey.trim()){setNotice(`Re-enter the API key for the ${PROVIDERS[batchJob.provider].label} account that submitted this batch.`);return;}
  const job=idOverride?{...batchJob,id:idOverride.trim()}:batchJob;if(!job.id)return;
  if(action==='cancel'&&!confirm('Request cancellation? Work already processed may still be charged. Completed results can be collected after the batch ends.'))return;
  lock.current=true;setBatchBusy(true);setNotice('');
  try{
   const out=await batchRequest(action,job) as BatchUpdate&{cancelRequested?:boolean};
   if(action==='cancel'){setNotice('Cancellation requested. Check status later, then collect any completed results.');return;}
   if(typeof out.terminal!=='boolean'||action==='collect'&&out.terminal&&!Array.isArray(out.results))throw new Error('The provider response could not be read. Your batch is still saved; check again.');
   if(action==='collect'&&out.terminal){
    if(out.results!.some(r=>!r||typeof r.id!=='string'||(!r.error&&(typeof r.score!=='string'||typeof r.explanation!=='string')))||new Set(out.results!.map(r=>r.id)).size!==out.results!.length)throw new Error('The batch results could not be matched reliably. Your saved job is unchanged.');
    const results=new Map<string,BatchResult>((out.results||[]).map(r=>[r.id,r]));
    // Requests are numbered subject by subject: one per subject, or, with several annotations per subject, one per annotation asked for.
    const several=(job.repeats||1)>1,slots=new Map<string,{at:number;ns:number[]}>();let requestCount=0;
    job.docIds.forEach((id,i)=>{const ns=several?job.ns?.[i]||Array.from({length:job.repeats!},(_,k)=>k+1):[0];slots.set(id,{at:requestCount,ns});requestCount+=ns.length;});
    const expected=new Set(Array.from({length:requestCount},(_,i)=>job.runId+'_'+i));
    if([...results.keys()].some(id=>!expected.has(id)))throw new Error('These results belong to a different batch. Check the batch ID; your workspace has not been changed.');
    const checked=(r:BatchResult|undefined)=>{if(r&&!r.error){r.error=annotationValidationError(r,job.answerFields,job.prompt,true,job.answerSettings);if(r.error)r.rawResponse=JSON.stringify({score:r.score,explanation:r.explanation,answers:r.answers});else delete r.rawResponse;}return r;};
    const collectedAt=new Date().toISOString(),notReturned='No result was returned for this subject. Check the provider’s batch report before retrying.';
    const settings={provider:job.provider,model:job.model,prompt:job.prompt,effort:job.effort,processing:'batch',concurrency:undefined,batchId:job.id,webSearch:false,webUsed:false,instructions:knowledgeInstructions(false)};
    // Several annotations per subject: each result is kept as an annotation, and the subject's own fields are worked out from them.
    const gathered=(d:Item,slot:{at:number;ns:number[]}):Item=>{
     let row:Item={...d,...settings,answerFields:job.answerFields,answerSettings:job.answerSettings,responseFormat:job.responseFormat};
     slot.ns.forEach((n,k)=>{
      const r=checked(results.get(job.runId+'_'+(slot.at+k)));
      const got={...(r?{answers:collectedAnswers(r,job.answerFields).answers,rawResponse:r.rawResponse,score:r.score,explanation:r.explanation,tokens:r.tokens,usage:r.usage,responseId:r.responseId,...(research?replyNotes(r):{})}:{}),error:r?.error||(!r?notReturned:undefined),runId:job.runId,runStartedAt:job.createdAt,runSize:d.runSize,processing:'batch',batchId:job.id,requestId:d.requestId,lab:d.lab,inserts:d.inserts,startedAt:d.startedAt,time:collectedAt};
      row={...row,...withAnnotation(row,annotationFrom(n,Boolean(r&&!r.error),got))};
     });
     return {...row,...settle(row)};
    };
    const collected=latest.current.map(d=>{const slot=slots.get(d.id);if(!slot)return d;if(several)return gathered(d,slot);const r=checked(results.get(job.runId+'_'+slot.at));return {...d,...(r?{...collectedAnswers(r,job.answerFields),answerSettings:job.answerSettings,responseFormat:job.responseFormat,rawResponse:r.rawResponse,score:r.score,explanation:r.explanation,tokens:r.tokens,usage:r.usage,responseId:r.responseId,...(research?replyNotes(r):{})}:{}),status:r&&!r.error?'done':'error',error:r?.error||(!r?notReturned:undefined),...settings,time:collectedAt};});
    // Retain the job until the complete result set is safely stored.
    await saveKnowledge(collected,null);
    latest.current=collected;setItems(collected);setBatchJob(null);setSelected(job.docIds[0]||'');setRecoverId('');setNotice('Batch results collected. Any failed subjects are marked for review; completed results are kept.');
   }else{setBatchJob({...job,state:out.terminal?'ready':'processing',completed:out.completed,total:out.total,providerState:out.state});setNotice(out.terminal?'The batch has ended. Collect results to see completed annotations and any errors.':'The batch is still processing. You can close this page once the workspace is saved.');}
  }catch(error){setNotice(error instanceof Error?error.message:'Could not check this batch. Your saved job is unchanged.');}
  finally{lock.current=false;setBatchBusy(false);}
 }
 function releaseUnconfirmedBatch(){
  if(!batchJob||batchBusy||conflict)return;
  if(!confirm('Only continue after checking your provider’s console and confirming that this batch was never submitted, or has ended and you no longer need its results. This forgets the local batch reference; it does not cancel a provider job.'))return;
  const queuedIds=new Set(batchJob.docIds);latest.current=latest.current.map(d=>queuedIds.has(d.id)?unclaimed(d):d);setItems(latest.current);setBatchJob(null);setNotice('Local batch reference cleared. Check provider usage before submitting these subjects again.');
 }
 async function download(){if(exporting)return;setExporting(true);try{const {createResultsWorkbook}=await import('@/lib/export-results');const buffer=await createResultsWorkbook(items,{answerFields:sentFields,prompt,model,effort,provider,webSearch,processing,concurrency:parallel,workspace:'model-knowledge',studyName});const url=URL.createObjectURL(new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download='model-knowledge-annotations.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setNotice('The Excel download failed. Your results are still here; try again.');}finally{setExporting(false);}}
 // waiting: what Annotate next and Run all would annotate (research mode: also subjects that get their missing annotations).
 const resumeNow=resumable(items),queuedCount=items.filter(item=>item.status==='pending').length,waiting=queuedCount+resumeNow.size,done=items.filter(item=>item.status==='done').length,insufficient=items.filter(item=>item.status==='done'&&knowledgeAssessment(item)!=='Assessed').length,current=items.find(item=>item.id===selected),subjectCount=new Set(items.map(item=>item.subjectId||item.id)).size;
 // Research mode: the share of a subject's annotations that gave its combined value, where not all did.
 const shareTag=(item:Item,key:string)=>{const share=research&&item.status==='done'?item.consistency?.[key]:undefined;return typeof share==='number'&&share<1?<span className="research-tag warn" title={`${Math.round(share*100)}% of this subject’s annotations gave this value`}>{Math.round(share*100)}%</span>:null;};
 const resultStart=Math.min(resultPage,Math.max(0,Math.ceil(items.length/100)-1))*100;
 // Research mode: the details step through the subjects (Previous and Next); the page of results follows the
 // selection. promptVersions: the prompt version of each run, for a result's technical details.
 const currentAt=research&&current?items.indexOf(current):-1,stepTo=(to:number)=>{const next=items[to];if(next)setSelected(next.id);};
 const promptVersions=research&&current?new Map(runSummaries(knowledgeRows(items as any)).map(summary=>[summary.number,summary.promptVersion])):undefined;
 useEffect(()=>{const index=items.findIndex(item=>item.id===selected);if(index>=0)setResultPage(Math.floor(index/100));},[selected]);
 const repeatPending=current&&items.some(item=>item.status==='pending'&&(item.subjectId||item.id)===(current.subjectId||current.id));
 // The estimate covers what Run all would annotate: with several annotations per subject, one request per annotation,
 // or only the missing ones of a subject already begun.
 const estimateRows=resumeNow.size?items.map(item=>resumeNow.has(item.id)?{...item,status:'pending'}:item):items;
 const requestsFor=times>1?(row:Item)=>resumeNow.has(row.id)?missingRepeats(row).length:times:undefined;
 const costEstimate=<CostEstimate rows={items} disabled={!ready} batch={processing==='batch'} revision={JSON.stringify([provider,model,effort,prompt,sentFields,sentSettings,processing,webSearch,items.map(d=>[d.id,d.status,d.usage,...(d.annotations?[d.annotations.length]:[])]),...(sentRequest?[sentRequest]:[]),...(research?[typedPrice||1]:[]),...(times>1?[times,[...resumeNow]]:[])])} load={signal=>studentEstimate({provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,rows:estimateRows,times:requestsFor,knowledge:true,webSearch,cache:Boolean(sentRequest?.cache),maxOutput:sentRequest?.maxOutput,batch:processing==='batch',ownPrice:typedPrice,research,signal})} canCountInputs={!keyRejected&&provider!=='openrouter'&&Boolean(apiKey.trim())&&!locked} countInputs={provider==='openrouter'?undefined:(signal,onProgress)=>countStudentInputs({provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,rows:estimateRows,times:requestsFor,knowledge:true,webSearch,cache:Boolean(sentRequest?.cache),maxOutput:sentRequest?.maxOutput,batch:processing==='batch',ownPrice:typedPrice,research,apiKey:apiKey,signal,onProgress})}/>;
 return <div className="knowledge-workspace">
  <div className="knowledge-intro"><h2 id="model-knowledge" tabIndex={-1}>Model knowledge <span className="experimental-badge">Experimental</span></h2><p>Assess named subjects, such as books or films, using what the model has learned. You do not upload the original works here. Web search is optional; each subject is assessed independently.</p>
   <details className="knowledge-method">
    <summary>About this research method</summary>
    <p>Model-knowledge annotation turns a model’s knowledge about a set of subjects into structured data. You supply identifying details, such as a film’s title, director, and release year, and a prompt defining the feature to assess and the scoring rules. The model draws on information learned during training to assign each subject a category or score, with a short explanation. Each subject is assessed independently.</p>
    <p>For example, a study could classify film endings as happy, tragic, or ambiguous. Applying the same question across a collection produces a dataset for comparing genres, periods, or directors. A related published application is <a href={KNOWLEDGE_STUDY.url} target="_blank" rel="noreferrer"><em>{KNOWLEDGE_STUDY.title}</em></a>, in which {KNOWLEDGE_STUDY.citation} used GPT to assess fictiveness across a large collection of works.</p>
    <p>This makes it possible to study features of many subjects without supplying the original material. The judgments depend on the model’s knowledge, which can be incomplete or mistaken and may reflect summaries or criticism. Optional web search adds online evidence to the assessment. In either case, the annotations need validation against primary sources or other reliable evidence before they can support research conclusions.</p>
   </details>
  </div>
  <div className="workspace">{renderSetup({answerFields,setAnswerFields,answerSettings,setAnswerSettings,scoreScale,setScoreScale,validationRequested:setupChecked,prompt,setPrompt,locked,ready,columns,keyLocked:busy||batchBusy||parentLocked||!ready||conflict,preview:research?<ResearchRequestPreview unit="subject" disabled={!ready} source={()=>({settings:{provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,knowledge:true,webSearch,batch:processing==='batch',inserts:insertNames.length>0},document:async()=>items[0]?{filename:'subject.txt',text:knowledgeItemText(items[0].fields),inserts:insertMap(prompt,insertValues(insertNames,items[0],columns))}:undefined,...(webSearch&&processing!=='batch'?{note:'With web search on, the Lab first sends a separate search request for each subject and adds what it finds to the subject’s fields.'}:{})})}/>:undefined,extraSetup:<><section className="processing-options" aria-label="Model knowledge processing options">
   <button type="button" className="processing-options-toggle" aria-expanded={showProcessing} aria-controls="knowledge-processing-options" onClick={()=>setShowProcessing(v=>!v)}><span className="processing-options-title">Processing options <span aria-hidden="true">{showProcessing?'▴':'▾'}</span></span><span className="processing-options-summary">{processing==='batch'?'Batch':`Instant · ${parallel===1?'one at a time':`${parallel} at a time`}`}{requestSummary(sentRequest).map(part=>' · '+part).join('')}{times>1?` · ${times} annotations per subject`:''}</span></button>
   {showProcessing&&<div id="knowledge-processing-options" className="processing-options-settings">
    <div className="processing-choice"><label htmlFor="knowledge-processing">Processing</label><select id="knowledge-processing" value={processing} disabled={locked} onChange={event=>setProcessing(event.target.value)} aria-describedby="knowledge-processing-help"><option value="instant">Instant</option><option value="batch" disabled={webSearch||provider==='openrouter'}>Batch · 50% lower token costs</option></select></div>
    {processing==='instant'&&<><div className="processing-choice"><label htmlFor="knowledge-concurrency">Parallel annotations</label><select id="knowledge-concurrency" value={parallel} disabled={locked} aria-describedby="knowledge-parallel-help" onChange={event=>setConcurrency(annotationConcurrency(Number(event.target.value),research))}>{concurrencyChoices(research).map(n=><option key={n} value={n}>{n===1?'Off · one at a time':`${n} at a time`}</option>)}</select></div><p id="knowledge-parallel-help" className="hint batch-explainer">{research?'Run all can annotate up to 128 subjects at once. Each subject gets a separate request; token prices are unchanged. When the provider reports a rate limit, the run waits and goes on with fewer at a time. Annotate next always runs one subject.':'Run all can annotate several subjects at once. Each subject gets a separate request; token prices are unchanged. Speed depends on your provider’s rate limits. Annotate next always runs one subject.'}</p></>}
    {research&&<><div className="processing-choice"><label htmlFor="knowledge-repeats">Annotations per subject</label><select id="knowledge-repeats" value={times} disabled={locked||webSearch} aria-describedby="knowledge-repeats-help" onChange={event=>setRepeats(cleanRepeats(Number(event.target.value))??1)}>{Array.from({length:MAX_REPEATS},(_,i)=>i+1).map(n=><option key={n} value={n}>{n===1?'1 · each subject once':n}</option>)}</select></div><p id="knowledge-repeats-help" className="hint batch-explainer">{webSearch?'Web search makes one annotation per subject. Turn it off to annotate each subject several times.':repeatsHint(repeats,sentSettings,'subject')}</p></>}
    {research&&<ResearchRequestOptions provider={provider} model={model} effort={effort} prompt={prompt.trim()?prompt+'\n\n'+knowledgeInstructions(webSearch)+answerInstructions(sentFields,sentSettings):''} fixed={promptFixed} value={requestSettings} disabled={locked} onChange={setRequestSettings}/>}
    <p id="knowledge-processing-help" className="hint batch-explainer">{provider==='openrouter'?'OpenRouter uses Instant processing in this Lab.':processing==='batch'?'Results arrive later, usually within 24 hours. Once submission is saved, you can close this page and return in the same browser to collect them. ':webSearch?'Web search requires Instant processing. Turn it off to use Batch.':'Instant processes subjects with this page open. Choose Batch for background processing at your provider’s batch rates.'} {processing==='batch'&&<>{BATCH_CAPACITY} {provider==='gemini'?'Gemini inline requests have an 18 MB prepared-request limit.':''}</>}</p>
   </div>}
  </section><div className="knowledge-search-setting"><label><input type="checkbox" checked={webSearch} disabled={locked||processing==='batch'||provider==='openrouter'||research&&repeats>1&&!webSearch} onChange={event=>setWebSearch(event.target.checked)} aria-describedby="knowledge-search-help"/>Use web search</label><p id="knowledge-search-help" className="hint">{provider==='openrouter'&&'Web search is unavailable through OpenRouter in this Lab. '}{research&&repeats>1&&!webSearch&&processing!=='batch'&&'Web search makes one annotation per subject; set Annotations per subject to 1 to use it. '}{processing==='batch'?'Batch uses model knowledge only. Choose Instant processing to enable web search.':webSearch?'Searches online before each annotation, then uses the evidence and model knowledge. Sources and research notes are saved. This takes longer and adds provider usage and possible search charges.':'Off: uses model knowledge only. It does not browse the web or read the primary work during this run.'}</p><p className="hint">Changes apply to queued annotations. Earlier results keep their original settings.</p></div></>})}
   <section className="panel queue"><div className="sectionhead"><h2><span className="step">02</span> Add your subjects</h2><span className="count">{subjectCount} {subjectCount===1?'subject':'subjects'}</span></div>
    <fieldset className="knowledge-mode" disabled={locked}><legend>Input format</legend><label><input type="radio" name="knowledge-mode" value="list" checked={mode==='list'} onChange={()=>setMode('list')}/>Simple list</label><label><input type="radio" name="knowledge-mode" value="structured" checked={mode==='structured'} onChange={()=>setMode('structured')}/>Structured fields</label></fieldset>
    {mode==='structured'&&<><label htmlFor="knowledge-headings">Column headings</label><input id="knowledge-headings" value={headings} onChange={event=>setHeadings(event.target.value)} disabled={locked} placeholder="Title, Author, Year" aria-describedby="knowledge-structured-help"/><p id="knowledge-structured-help" className="hint">Separate headings with commas or tabs. Paste data below in the same order, without a header row. Use straight double quotes around fields containing commas, such as <code>"title, subtitle"</code>.</p></>}
    <label htmlFor="knowledge-input">{mode==='list'?'Subjects · one per line':'Comma- or tab-separated items'}</label><textarea id="knowledge-input" className="knowledge-input" value={input} onChange={event=>setInput(event.target.value)} disabled={locked} maxLength={MAX_KNOWLEDGE_INPUT_CHARS} placeholder={mode==='list'?'Pride and Prejudice — Jane Austen (1813)\nFrankenstein — Mary Shelley (1818)\nBeloved — Toni Morrison (1987)':'Pride and Prejudice,Jane Austen,1813\nFrankenstein,Mary Shelley,1818'} aria-describedby="knowledge-input-help"/><p id="knowledge-input-help" className="hint">{mode==='list'?'Paste a list from Word or another source. Blank lines are ignored. Include an author, date, or other identifier when a name could be ambiguous.':'Each row becomes one subject. Blank fields are preserved; mismatched rows must be corrected before adding items.'} Every supplied field is sent to the model and may inform its judgment. Omit variables you do not want it to use.</p>{!research&&<button type="button" className="textbutton" disabled={locked} onClick={loadExamples}>Load example subjects</button>}
    <div className="knowledge-preview" aria-live="polite"><h3>Preview <span className="count">{parsed.items.length} parsed items</span></h3>{parsed.error?<p className="message" role="alert">{parsed.error}</p>:parsed.items.length?<div className="knowledge-preview-table"><Table><TableHeader><TableRow><TableHead>#</TableHead>{parsed.headings.map(heading=><TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader><TableBody>{parsed.items.slice(0,100).map((fields,i)=><TableRow key={i}><TableCell>{i+1}</TableCell>{fields.map(field=><TableCell key={field.heading}>{field.value||'—'}</TableCell>)}</TableRow>)}</TableBody></Table></div>:<p className="hint">Your parsed items will appear here before annotation.</p>}</div>
    {parsed.items.length>100&&<p className="hint">Preview shows the first 100 of {parsed.items.length.toLocaleString()} subjects. All parsed subjects will be added to the queue.</p>}
    {duplicates.duplicateIndices.size>0&&<div className="message" role="group" aria-label="Duplicate subjects"><p>{duplicates.duplicateIndices.size} duplicate {duplicates.duplicateIndices.size===1?'entry':'entries'} found in this submission or the queue.</p><details><summary>More information</summary><p>{duplicates.within} {duplicates.within===1?'repeats':'repeat'} earlier entries in this submission; {duplicates.against} {duplicates.against===1?'matches':'match'} the queue. These counts can overlap. Matching uses the same ordered fields, ignoring outer whitespace and Unicode encoding differences.</p><p>Keep all to create separate observations, or exclude matching entries. For intentional repeats with linked run numbers, use Repeat study or Annotate subject again.</p></details><div className="actions"><Button disabled={locked} onClick={()=>add(true)}>Keep all subjects</Button><Button variant="outline" disabled={locked} onClick={()=>commitSubjects(parsed.items.filter((_,i)=>!duplicates.duplicateIndices.has(i)))}>Exclude duplicate subjects</Button></div></div>}
    <Button variant="outline" disabled={locked||!!parsed.error||!parsed.items.length||duplicates.duplicateIndices.size>0} onClick={()=>add()}>Add {parsed.items.length||''} {parsed.items.length===1?'item':'items'} to queue</Button>
    {research&&<ResearchTools rows={subjectRows(items)} columns={columns} samples={samples} unit="subject" disabled={locked} onApply={(subjects,nextColumns,nextSamples,message)=>{if(lock.current||locked)return;latest.current=applySubjectCells(latest.current,subjects);setItems(latest.current);setColumns(nextColumns);setSamples(nextSamples);if(message)setNotice(message);}} lead={costEstimate}/>}
    <div className="actions"><Button disabled={locked||!waiting||keyRejected} onClick={()=>run(false)}>Annotate next <ArrowRight size={16}/></Button><Button variant="outline" disabled={locked||!waiting||keyRejected} onClick={()=>processing==='batch'?submitBatch():run(true)}><Play size={15}/>{processing==='batch'?`Submit batch (${waiting})`:`Run all (${waiting})`}</Button>{busy&&<Button variant="outline" onClick={()=>{stop.current=true;setNotice('Pausing after active annotations finish. No new subjects will start.');}}><Pause size={15}/>Pause</Button>}
     {items.some(item=>item.status==='error')&&<Button variant="outline" disabled={locked} onClick={()=>retry()}>Queue failed items for retry</Button>}<Button variant="outline" disabled={locked||!!queuedCount||!done} onClick={()=>repeat()}><Repeat2 size={15}/>Repeat study</Button>
     {items.length>0&&<div className="clear-actions">{items.some(row=>row.status==='done'||row.status==='error'||Boolean(row.history?.length))&&<Button variant="outline" disabled={locked} onClick={()=>{if(confirm('Clear all annotation runs and results, keeping one copy of each subject? Save a version in Studies or download a study backup first to keep your results.')){setItems(keepCells(repeatKnowledgeItems(items).map(item=>({...item,runNumber:1}))));setRequests(undefined);setSelected('');}}}>Clear results</Button>}<Button variant="outline" className="clear-workspace" disabled={locked||!items.length} onClick={()=>{if(confirm('Clear all subjects and results from the experimental workspace? Save a version in Studies or download a study backup first to keep them.')){setItems([]);setSelected('');setColumns([]);setSamples([]);}}}>Clear workspace</Button></div>}
     <ResultsChart rows={items} onInspect={viewItem} subjectLabel="Subject" onSaveYears={years=>{latest.current=latest.current.map(item=>years.has(item.id)?{...item,chartYear:years.get(item.id)}:item);setItems(latest.current);}} onSaveGroups={groups=>{latest.current=latest.current.map(item=>groups.has(item.id)?{...item,chartGroup:groups.get(item.id)}:item);setItems(latest.current);}}/><Button className="export" variant="outline" disabled={!items.length||exporting} onClick={download}><Download size={16}/>{exporting?'Preparing Excel…':'Download Excel'}</Button></div>
    {busy&&<p className="hint run-guidance" role="status">Keep this page open while running.</p>}<SettingsNotice rows={items} current={{provider,model,effort,prompt,answerFields,webSearch}} knowledge/>{!research&&costEstimate}
    {batchJob&&<div className="batch-status" role="status"><div><strong>{batchBusy?(batchJob.state==='submitting'?'Submitting batch…':'Contacting provider…'):batchJob.state==='ready'?'Batch ready to collect':batchJob.state==='unknown'?'Batch needs checking':'Batch processing'}</strong><span>{batchJob.docIds.length} subjects · {modelLabel(batchJob.model)}{batchJob.completed!==undefined?` · ${batchJob.completed} processed`:''}</span></div>{batchJob.id&&<Button variant="outline" disabled={batchBusy||conflict} onClick={()=>manageBatch(batchJob.state==='ready'?'collect':'check')}>{batchJob.state==='ready'?'Collect results':'Check status'}</Button>}<details className="batch-details"><summary>Batch details</summary><p>Submitted: {new Date(batchJob.createdAt).toLocaleString()}. {research?`Collecting the results needs the ${PROVIDERS[batchJob.provider].label} API key of the account that submitted this batch.`:`Re-enter your ${PROVIDERS[batchJob.provider].label} API key if you return later. Keys are never saved.`}</p><p className="batch-reference">{batchJob.id||batchJob.runId}</p>{!batchJob.id&&<><label htmlFor="knowledge-recover-batch">Batch ID from your provider’s console</label><input id="knowledge-recover-batch" value={recoverId} onChange={e=>setRecoverId(e.target.value)} placeholder={batchJob.provider==='openai'?'batch_…':batchJob.provider==='anthropic'?'msgbatch_…':'batches/…'}/><Button variant="outline" disabled={batchBusy||!recoverId.trim()||conflict} onClick={()=>manageBatch('check',recoverId)}>Recover batch</Button><button className="textbutton" disabled={batchBusy||conflict} onClick={releaseUnconfirmedBatch}>No batch to recover</button></>}{batchJob.id&&batchJob.state!=='ready'&&<button className="textbutton" disabled={batchBusy||conflict} onClick={()=>manageBatch('cancel')}>Cancel batch</button>}</details></div>}
    <p className="hint">{`${times>1?`Repeat study queues each subject again as a new run, with ${times} annotations per subject, using the current settings.`:'Repeat study queues one fresh annotation per subject using the current settings.'} Earlier runs are kept, and earlier answers are never sent to the model. Finish queued annotations first.`}</p>
    {items.length>0&&<><div className="progressline" aria-live="polite"><span>{[batchBusy?'Contacting provider…':'',queueSummary(items,items.length===subjectCount?'subject':'annotation',insufficient)].filter(Boolean).join(' · ')}</span></div><Progress aria-label="Model knowledge annotation progress" value={done/items.length*100}/></>}
    {storageIssue&&<p className="message" role="alert">{storageIssue}</p>}{notice&&<p className={isRateLimitNotice(notice)?'message info':'message'} role="status">{notice}</p>}
    {items.length>0&&<p className="hint result-hint">Select a row to check the explanation and subject details. “Assessed” does not mean the judgment has been independently verified.</p>}<ResultPages total={items.length} page={resultPage} onPageChange={page=>{setResultPage(page);setSelected('');}}/><div className="results"><Table><TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Run</TableHead><TableHead>Status</TableHead>{showLegacyScore?<TableHead>Score / category</TableHead>:null}{resultNames.map(name=><TableHead key={name}>{name}</TableHead>)}</TableRow></TableHeader><TableBody>{items.slice(resultStart,resultStart+100).map(item=><TableRow key={item.id} id={'knowledge-row-'+item.id} className={'annotation-row '+(selected===item.id?'active':'')} tabIndex={0} aria-label={'View annotation and explanation for '+item.name+', run '+(item.runNumber||1)} aria-selected={selected===item.id} aria-controls="knowledge-detail" onClick={()=>viewItem(item.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();viewItem(item.id);}}}><TableCell><button className="docbutton" onClick={()=>viewItem(item.id)}>{item.name}</button></TableCell><TableCell>{item.runNumber||1}</TableCell><TableCell><span className={'status '+(research&&incomplete(item)?'done partial':item.status==='done'&&knowledgeAssessment(item)!=='Assessed'?'uncertain':item.status)}>{item.status==='done'?(research&&incomplete(item)?(count=>`${count?.ok} of ${count?.of} annotations`)(annotationCount(item)):knowledgeAssessment(item)):item.status==='pending'?'Ready':item.status==='error'?'Needs attention':item.status==='queued'?'In batch':'Working…'}</span></TableCell>{showLegacyScore?<TableCell className="knowledge-score">{item.score||'—'}{shareTag(item,'score')}</TableCell>:null}{resultNames.map(name=><TableCell key={name}><span className="answer-cell">{answerLabel(resultAnswer(item,name))||'—'}</span>{shareTag(item,'f'+(item.answerFields?.indexOf(name)??-1))}</TableCell>)}</TableRow>)}</TableBody></Table></div>
    {!items.length&&<div className="empty"><h3>Your subject queue starts here</h3><p>Preview your items above, then add them to the queue.</p></div>}
    {current&&<div id="knowledge-detail" className="detail" tabIndex={-1} role="region" aria-label="Selected subject details" onKeyDown={research?event=>stepKey(event,currentAt,items.length,stepTo):undefined}><button type="button" className="textbutton" onClick={()=>{const row=document.getElementById('knowledge-row-'+current.id);row?.focus();row?.scrollIntoView({block:'nearest'});}}>Back to selected row</button>{research&&<DetailSteps index={currentAt} total={items.length} onStep={stepTo}/>}<h3>{current.name}</h3><p className="hint">Run {current.runNumber||1}</p><dl className="knowledge-fields">{current.fields.map(field=><div key={field.heading}><dt>{field.heading}</dt><dd>{field.value||'—'}</dd></div>)}</dl>{research&&<ResearchDetail row={current} columns={columns} study={{kind:'knowledge',requests,versions:promptVersions}}/>}{current.error&&<p className="message" role="alert">{current.error}</p>}{current.rawResponse&&<details><summary>View returned response</summary><pre>{current.rawResponse}</pre></details>}{(current.explanation||current.answers)?<><NamedAnswerDetail row={current}/><span className="resultscore knowledge-score">{current.score}</span>{hasSeparateExplanation(current)&&<p className="knowledge-research-text"><ReferenceText text={current.explanation!} research={current.research}/></p>}<small>{current.model}{current.tokens!==undefined?` · ${current.tokens.toLocaleString()} tokens`:''}</small></>:!current.error?<p>The explanation will appear here after annotation.</p>:null}
     {current.prompt!==undefined&&<details className="knowledge-record"><summary>View recorded prompt and settings</summary><dl className="knowledge-fields"><div><dt>Provider</dt><dd>{current.provider||'Not recorded'}</dd></div><div><dt>Model</dt><dd>{current.model||'Not recorded'}</dd></div><div><dt>Reasoning effort</dt><dd>{current.effort||'Not recorded'}</dd></div><div><dt>Processing</dt><dd>{current.processing==='batch'?'Batch':'Instant'}</dd></div><div><dt>Method</dt><dd>{current.webSearch?'Web-assisted':'Model knowledge only'}</dd></div><div><dt>Web search used</dt><dd>{current.webUsed?'Yes':current.webSearch&&current.webUsed===undefined?'Not confirmed':'No'}</dd></div><div><dt>{current.processing==='batch'?'Collected at (UTC)':'Annotated at (UTC)'}</dt><dd>{current.time||'Not recorded for this earlier annotation'}</dd></div></dl><h4>Annotation prompt</h4><pre>{current.prompt}</pre><h4>Additional model instructions</h4><pre>{current.instructions||knowledgeInstructions(current.webSearch)}</pre></details>}
     {current.research&&<section className="knowledge-research"><h4>Web research</h4><p className="hint">Searched at {current.research.searchedAt}. Sources returned by the provider; this does not establish that the full work was read.</p><p className="knowledge-research-text"><ReferenceText text={current.research.text} research={current.research}/></p>{current.research.sources.length?<ol>{current.research.sources.map((source,i)=><li key={source.url}>{/^https?:\/\//i.test(source.url)?<a href={source.url} target="_blank" rel="noreferrer">[{i+1}] {source.title}</a>:source.title}</li>)}</ol>:<p className="hint">No source links were returned.</p>}{current.research.queries.length>0&&<details><summary>Search queries</summary><ul>{current.research.queries.map(query=><li key={query}>{query}</li>)}</ul></details>}{current.research.searchSuggestionsHtml&&<iframe title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={current.research.searchSuggestionsHtml} className="knowledge-search-suggestions"/>}</section>}
     <div className="knowledge-item-actions">{current.history?.length&&<details><summary>Previous failed attempts ({current.history.length})</summary>{current.history.map((attempt,i)=><div key={i}><p>Attempt {i+1}: {attempt.error} · {attempt.model}</p><pre>{attempt.prompt}</pre></div>)}</details>}{current.status==='done'&&<Button variant="outline" disabled={locked||!!repeatPending} onClick={()=>repeat(current.id)}><Repeat2 size={15}/>Annotate subject again</Button>}{current.status==='error'&&!locked&&<Button variant="outline" onClick={()=>retry(current.id)}>Queue for retry</Button>}{current.status==='pending'&&!locked&&<button className="textbutton" onClick={()=>setItems(items.filter(item=>item.id!==current.id))}>Remove item</button>}</div>
    </div>}
    {(!ready||storageIssue||!saved)&&<p className="hint foot" role="status">{storageIssue?'Experimental workspace is not saved.':!ready?'Preparing experimental workspace…':'Saving experimental workspace…'}</p>}{webSearch&&<p className="hint foot">With web search enabled, the provider also uses search services. Provider data policies apply.</p>}
   </section>
  </div>
 </div>;
}
