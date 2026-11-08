"use client";
import {newId} from '@/lib/identifier';

import {SettingsNotice} from '@/components/student-guidance';
import {ProviderKeyStatus,useProviderKeyCheck} from '@/components/provider-key-status';

import {SourceTextPreview} from '@/components/source-text-preview';
import {NamedAnswerDetail,collectedAnswers} from '@/components/named-answer-detail';
import {SavedPrompts} from '@/components/saved-prompts';
import {AnswerFields} from '@/components/answer-fields';
import {reviewStoredAnswer,annotationValidationError} from '@/lib/answer-validation';
import {annotationFormatRecord,hasSeparateExplanation,validAnswerFields,resultColumns,resultAnswer,answerValues,type NamedAnswers} from '@/lib/answer-fields';
import {DEFAULT_ANNOTATION_CONCURRENCY,ANNOTATION_CONCURRENCY,annotationConcurrency,runAnnotationQueue} from '@/lib/annotation-queue';
import {missingAnnotationSetup} from '@/lib/annotation-feedback';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {StudyManager,type OpenStudyDraft} from '@/components/study-manager';
import {NAMED_STUDIES_ENABLED,studyWorkspaceKey} from '@/lib/studies';
import type {BatchJob,BatchUpdate,BatchResult} from '@/lib/batch-types';
import {createWorkspaceStorage} from '@/lib/workspace-storage';
import {prepareDocumentUploads} from '@/lib/document-uploads';
import {setupErrors,queueRetries,retryMessage,queueSummary,type Attempt} from '@/lib/workflow-safety';
import {DEFAULT_CHUNK_WORDS,validChunkWords,restoreWholeDocuments,restorableSourceIds,type ChunkInfo} from '@/lib/chunk-text';
import {MAX_BATCH_ITEMS,MAX_BATCH_SOURCE_BYTES,BATCH_CAPACITY} from '@/lib/batch-limits';
import {ResultPages} from '@/components/result-pages';
import {ResultsChart} from '@/components/results-chart';
import {Button} from '@/components/ui/button';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem,SelectGroup,SelectLabel} from '@/components/ui/select';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from '@/components/ui/table';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {ReadingPanels,prepareReadingPanel} from '@/components/reading-panels';
import {focusSectionWhenReady} from '@/lib/section-navigation';
import {ModelKnowledge,type KnowledgeSetup,type WorkspaceSaveState} from '@/components/model-knowledge';
import {KNOWLEDGE_SAMPLE} from '@/lib/model-knowledge';
import {Progress} from '@/components/ui/progress';
import {Upload,Play,Download,BookOpen,ArrowRight,ArrowLeft,Pause,Check,FlaskConical} from 'lucide-react';
const START_HINT_KEY='text-annotation-lab:get-started-hint';
import {GEMINI_ENABLED,PROVIDERS,OPENROUTER_STARTER_MODELS,availableProvider,reasoningOptions,defaultEffort,reasoningLabel,reasoningOptionLabel,modelLabel,modelHint,modelAccessLabel,defaultModel,selectedModel,type Provider} from '@/lib/providers';
import CostEstimate from '@/lib/cost-estimate/panel';
import {studentEstimate,countStudentInputs} from '@/lib/student-estimate';
type Doc={chartYear?:number|null}&NamedAnswers&Partial<ChunkInfo>&{inputMode?:string;runId?:string;runStartedAt?:string;runSize?:number;history?:Attempt[];startedAt?:string;concurrency?:number;processing?:string;batchId?:string;provider?:Provider;id:string;name:string;file:File;status:string;score?:string;explanation?:string;error?:string;model?:string;prompt?:string;effort?:string;tokens?:number;usage?:any;time?:string;responseId?:string};
const SAMPLE='Classify the document’s overall tone as POSITIVE (mainly favorable or hopeful), NEGATIVE (mainly critical or pessimistic), MIXED (substantial positive and negative tone), or NEUTRAL (primarily factual, with no clear positive or negative tone). Choose one label. If the tone cannot be judged from the document, return UNCLEAR instead. Use only the document as evidence. Give a brief explanation with a supporting phrase, and note any uncertainty.';

export default function Home(){
 useEffect(()=>{
  if(window.parent===window)return;
  const origin='https://asca.au.dk';
  const announce=()=>window.parent.postMessage({type:'text-annotation-lab:ready'},origin);
  const receive=(event:MessageEvent)=>{if(event.source===window.parent&&event.origin===origin&&event.data?.type==='text-annotation-lab:ping')announce();};
  window.addEventListener('message',receive);announce();
  return()=>window.removeEventListener('message',receive);
 },[]);
 return NAMED_STUDIES_ENABLED?<StudyManager>{(study,controls,onReady,version,draftRef,onRecoveryChange)=><StudyWorkspace key={version} studyId={study.id} studyName={study.name} studyControls={controls} onStudyReady={onReady} draftRef={draftRef} onRecoveryChange={onRecoveryChange}/>}</StudyManager>:<StudyWorkspace/>;
}
function StudyWorkspace({studyId='current',studyName,studyControls,onStudyReady,draftRef,onRecoveryChange}:{draftRef?:OpenStudyDraft;onRecoveryChange?:(available:boolean)=>void;studyId?:string;studyName?:string;studyControls?:ReactNode;onStudyReady?:(ready:boolean)=>void}){
 const [docs,setDocs]=useState<Doc[]>([]),[prompt,setPrompt]=useState(''),[model,setModel]=useState(defaultModel('openai')),[effort,setEffort]=useState('medium'),[key,setKey]=useState(''),[annotating,setBusy]=useState(false),[ready,setReady]=useState(false),[notice,setNotice]=useState(''),[selected,setSelected]=useState(''),[saved,setSaved]=useState(false);
 const [answerFields,setAnswerFields]=useState<string[]>([]);
 const [storageIssue,setStorageIssue]=useState(''),[storageConflict,setStorageConflict]=useState(false);

 const [showChunking,setShowChunking]=useState(false),[chunkWords,setChunkWords]=useState(String(DEFAULT_CHUNK_WORDS)),[splitting,setSplitting]=useState(false);
 const {names:resultNames,showLegacy:showLegacyScore}=resultColumns(docs,answerFields);
 const [resultPage,setResultPage]=useState(0);
 const [provenance,setProvenance]=useState<any>();
 const [processing,setProcessing]=useState('instant'),[batchJob,setBatchJob]=useState<BatchJob|null>(null),[batchBusy,setBatchBusy]=useState(false),[recoverId,setRecoverId]=useState('');
 const [concurrency,setConcurrency]=useState(DEFAULT_ANNOTATION_CONCURRENCY);
 const [showProcessing,setShowProcessing]=useState(false);
 const [knowledgeBusy,setKnowledgeBusy]=useState(false);
 const [adding,setAdding]=useState(false);
 const [setupChecked,setSetupChecked]=useState(false),[pendingImport,setPendingImport]=useState<{accepted:File[];validFiles:File[];duplicates:number;summary:string}|null>(null);
 const [chunkMethod,setChunkMethod]=useState<'exact-words'|'sentences'>('sentences');
 const busy=annotating||splitting||batchBusy||knowledgeBusy||adding||Boolean(pendingImport);
 const workspaceLocked=busy||Boolean(batchJob);
 const storage=useRef(createWorkspaceStorage(studyWorkspaceKey(studyId))),canSave=useRef(false),firstSave=useRef(true);
 const [provider,setProvider]=useState<Provider>('openai');
 const keyCheck=useProviderKeyCheck(provider,key,annotating||knowledgeBusy);
 useEffect(()=>{if(ready&&provider==='openrouter'&&!batchJob)setProcessing('instant');},[ready,provider,batchJob]);
 const keyRejected=keyCheck.check.status==='rejected';
 const config=PROVIDERS[provider];
 function chooseProvider(value:string){const p=availableProvider(value);setProvider(p);if(p==='openrouter')setProcessing('instant');setKey('');setModel(defaultModel(p));setEffort(defaultEffort(p,defaultModel(p)));setNotice('');}
 const [activeTab,setActiveTab]=useState('workspace');
 const [tabLoading,setTabLoading]=useState(false),tabRequest=useRef(0);
 // First-visit pointer to Get started. It goes away for good once the visitor opens that tab.
 const [startHint,setStartHint]=useState(()=>{try{return window.localStorage.getItem(START_HINT_KEY)!=='seen';}catch{return false;}});
 useEffect(()=>{if(activeTab!=='get-started'||!startHint)return;setStartHint(false);try{window.localStorage.setItem(START_HINT_KEY,'seen');}catch{}},[activeTab,startHint]);
 // On narrow screens the tabs scroll sideways; keep the active one in view.
 useEffect(()=>{if(typeof document.querySelector!=='function')return;const list=document.querySelector<HTMLElement>('.study-tabs'),tab=list?.querySelector<HTMLElement>('[data-state=active]');if(!list||!tab||list.scrollWidth<=list.clientWidth)return;const a=list.getBoundingClientRect(),b=tab.getBoundingClientRect();if(b.left<a.left||b.right>a.right-32)list.scrollBy({left:b.left-a.left-16,behavior:'smooth'});},[activeTab]);
 useEffect(()=>()=>{tabRequest.current++;},[]);
 function revealSection(value:string,commit:()=>void){
  const request=++tabRequest.current;
  const finish=()=>{if(request===tabRequest.current){setTabLoading(false);commit();}};
  const pending=prepareReadingPanel(value);
  if(pending){setTabLoading(true);void pending.then(finish,finish);}else finish();
 }
 const skipSectionScroll=useRef(true);
 const sections:Record<string,string>={'workspace':'workspace','get-started':'get-started','data-handling':'get-started','prompting-tips':'tips','corpus-example':'corpus','example-corpus':'corpus','corpus-inaugural':'corpus','corpus-debates':'corpus','corpus-obituaries':'corpus','corpus-scouts':'corpus','corpus-wpa':'corpus','corpus-campaign':'corpus','corpus-westerns':'corpus','corpus-billboard':'corpus','study-example':'study-example','further-resources':'resources','about':'about','model-knowledge':'model-knowledge'};
 useEffect(()=>{
  // Reopening the Lab starts a fresh view, while the study itself stays saved.
  const previousRestoration=window.history.scrollRestoration;
  window.history.scrollRestoration='manual';
  let frame=0;
  const top=()=>window.scrollTo({top:0,left:0,behavior:'instant'});
  const reset=()=>{
   tabRequest.current++;setTabLoading(false);skipSectionScroll.current=true;setActiveTab('workspace');
   window.history.replaceState(null,'',window.location.pathname+window.location.search+'#workspace');
   top();cancelAnimationFrame(frame);frame=requestAnimationFrame(top);
  };
  const sync=()=>{const section=sections[window.location.hash.slice(1)];if(section){revealSection(section,()=>{skipSectionScroll.current=false;setActiveTab(section);});}};
  const show=(event:PageTransitionEvent)=>{if(event.persisted)reset();};
  reset();
  window.addEventListener('hashchange',sync);
  window.addEventListener('pageshow',show);
  return()=>{cancelAnimationFrame(frame);window.history.scrollRestoration=previousRestoration;window.removeEventListener('hashchange',sync);window.removeEventListener('pageshow',show);};
 },[]);
 useEffect(()=>{if(skipSectionScroll.current){skipSectionScroll.current=false;return;}const hash=window.location.hash.slice(1);if(sections[hash]===activeTab){return focusSectionWhenReady(hash==='example-corpus'?'corpus-example':hash);}},[activeTab]);
 function changeTab(value:string){if(value===activeTab){tabRequest.current++;setTabLoading(false);return;}revealSection(value,()=>{skipSectionScroll.current=true;setActiveTab(value);const anchors:Record<string,string>={tips:'prompting-tips',corpus:'corpus-example',resources:'further-resources'};window.history.pushState(null,'',window.location.pathname+window.location.search+'#'+(anchors[value]||value));});}
 const [exporting,setExporting]=useState(false);
 const [knowledgeSaved,setKnowledgeSaved]=useState(false);
 const [knowledgeSaveState,setKnowledgeSaveState]=useState<WorkspaceSaveState>('loading');
 const workingCopySaved=saved&&!storageIssue&&knowledgeSaveState==='saved';
 const workingCopyStatus=storageIssue||knowledgeSaveState==='error'||knowledgeSaveState==='conflict'?'Working copy not saved':!ready||knowledgeSaveState==='loading'?'Preparing workspace…':'Autosaving…';
 useEffect(()=>{onStudyReady?.(ready&&saved&&!storageIssue&&!annotating&&!splitting&&!adding&&!pendingImport&&!batchBusy&&!exporting&&knowledgeSaved);},[ready,saved,storageIssue,annotating,splitting,adding,batchBusy,exporting,pendingImport,knowledgeSaved,onStudyReady]);
 const recovering=storageConflict||knowledgeSaveState==='conflict';
 const canRecover=recovering&&ready&&(canSave.current||storageConflict)&&!busy&&!exporting&&
  (knowledgeSaveState==='conflict'||knowledgeSaved);
 useEffect(()=>{onRecoveryChange?.(canRecover);return ()=>onRecoveryChange?.(false);},[canRecover,onRecoveryChange]);
 const stop=useRef(false),lock=useRef(false),latest=useRef<Doc[]>([]);latest.current=docs;
 useEffect(()=>{storage.current.restore().then(v=>{canSave.current=true;if(v){setProvenance(v.provenance);if((v.docs||[]).some((d:Doc)=>reviewStoredAnswer(d,false)!==d)){firstSave.current=false;setNotice('Some earlier answers need review under their recorded output instructions. Their returned values are preserved; no new requests were sent.');}setDocs((v.docs||[]).map((d:Doc)=>reviewStoredAnswer(d,false)).map((d:Doc)=>d.status==='running'?{...d,status:'error',error:'Interrupted. Check your provider’s usage before retrying; the request may have completed.'}:d));setPrompt(v.prompt||'');setAnswerFields(validAnswerFields(v.answerFields)?v.answerFields:[]);setProcessing(v.processing==='batch'?'batch':'instant');setConcurrency(v.concurrency===undefined?DEFAULT_ANNOTATION_CONCURRENCY:annotationConcurrency(v.concurrency));if(v.batchJob&&Array.isArray(v.batchJob.docIds)){setBatchJob({...v.batchJob,state:v.batchJob.state==='submitting'?'unknown':v.batchJob.state});}setChunkMethod(v.chunkMethod==='sentences'?'sentences':'exact-words');setChunkWords(String(validChunkWords(Number(v.chunkWords))?Number(v.chunkWords):DEFAULT_CHUNK_WORDS));const p=availableProvider(v.provider);setProvider(p);const restoredModel=selectedModel(p,v.model),restoredEffort=reasoningOptions(p,restoredModel).includes(v.effort)?v.effort:defaultEffort(p,restoredModel);if((v.docs||[]).some((d:Doc)=>d.status==='running')||p!==v.provider||restoredModel!==v.model||restoredEffort!==v.effort)firstSave.current=false;setModel(restoredModel);setEffort(restoredEffort); }}).catch(()=>{canSave.current=false;setStorageIssue('Browser storage could not be read. Existing saved data has not been overwritten. Download any new results before leaving.');}).finally(()=>setReady(true));},[]);
 useEffect(()=>{
  if(draftRef)draftRef.current.texts=ready&&(canSave.current||storageConflict)?{provenance,docs,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob}:undefined;
 },[draftRef,ready,storageConflict,provenance,docs,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob]);
 useEffect(()=>{if(!ready||!canSave.current)return;if(firstSave.current){firstSave.current=false;setSaved(true);return;}let current=true;setSaved(false);storage.current.save({provenance,docs,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob}).then(()=>{if(current){setSaved(true);setStorageIssue('');}}).catch(error=>{stop.current=true;const conflict=error instanceof Error&&error.message.startsWith('Another tab');if(conflict){canSave.current=false;setStorageConflict(true);}if(current||conflict){setSaved(false);setStorageIssue(conflict?error.message:'Could not save locally. Download your results before leaving.');}});return()=>{current=false;};},[docs,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob,provenance,ready]);
 useEffect(()=>{const h=(e:BeforeUnloadEvent)=>{if(lock.current||(ready&&!saved)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[ready,saved]);
 function update(id:string,changes:Partial<Doc>){latest.current=latest.current.map(d=>d.id===id?{...d,...changes}:d);setDocs(latest.current);}
 async function add(files:FileList|null){
  if(!files||lock.current||workspaceLocked||!ready||storageConflict)return;
  const chosen=Array.from(files);lock.current=true;setAdding(true);setNotice('Checking selected documents…');
  try{
   const {accepted,validFiles,rejected,duplicates,unreadable,matchingNames}=await prepareDocumentUploads(chosen,latest.current);
   const summary=[matchingNames?'Different files with matching names are retained.':'',rejected?`${rejected} invalid file(s): use nonempty PDF, DOCX, TXT, MD, HTML, or RTF up to 20 MB each.`:'',unreadable?`${unreadable} file(s) could not be checked; reselect them to try again.`:''].filter(Boolean).join(' ');
   if(duplicates){setPendingImport({accepted,validFiles,duplicates,summary});setNotice('Review duplicate documents before adding this selection.');}
   else commitDocuments(accepted,summary);
  }catch{setNotice('Could not check the selected files. Your existing documents are unchanged. Re-select the files and try again.');}
  finally{lock.current=false;setAdding(false);}
 }
 function commitDocuments(files:File[],summary=''){
  const added:Doc[]=files.map(file=>({id:newId(),name:file.name,file,status:'pending'}));
  latest.current=[...latest.current,...added];setDocs(latest.current);setPendingImport(null);setNotice(`${added.length} documents added. ${summary}`);
 }
 function retry(id?:string){if(workspaceLocked||!ready||storageConflict)return;const count=latest.current.filter(d=>d.status==='error'&&(!id||d.id===id)).length;if(count&&confirm(retryMessage(count))){latest.current=queueRetries(latest.current,id);setDocs(latest.current);setNotice('Retries queued. Review the current prompt and settings, then choose Annotate next or '+(processing==='batch'?'Submit batch':'Run all')+'.');}}
 const detailRequest=useRef(false);
 function viewDocument(id:string){detailRequest.current=true;setSelected(id);if(id===selected){const detail=document.getElementById('annotation-detail');detail?.focus();detail?.scrollIntoView({block:'nearest'});detailRequest.current=false;}}
 useEffect(()=>{if(!detailRequest.current)return;detailRequest.current=false;const detail=document.getElementById('annotation-detail');detail?.focus();detail?.scrollIntoView({block:'nearest'});},[selected]);

 function clearResults(){if(lock.current||batchJob||exporting||!ready||storageConflict)return;if(!confirm('Clear all annotation results and keep the uploaded documents? Save a version in Studies or download a study backup first if you want to keep these results.'))return;latest.current=latest.current.map(({inputMode,runId,runStartedAt,runSize,responseFormat,rawResponse,answerFields,answers,history,startedAt,concurrency,provider,score,explanation,error,model,prompt,effort,tokens,usage,time,responseId,processing,batchId,...document})=>({...document,status:'pending'}));setDocs(latest.current);setSelected('');setNotice('Results cleared. Your documents are ready to annotate again with the current settings.');}
 async function splitDocuments(){
  if(lock.current||batchJob||exporting||!ready||storageConflict)return;
  const words=Number(chunkWords);if(!validChunkWords(words)){setNotice('Enter a whole number from 1 to 1,000,000 for words per chunk.');return;}
  lock.current=true;stop.current=false;setSplitting(true);setNotice('');
  try{
   const {chunkDocuments}=await import('@/lib/chunk-documents');
   const result=await chunkDocuments(latest.current,words,chunkMethod);
   if(stop.current){setNotice('Splitting stopped because browser storage could not be saved. Your documents have not been changed.');return;}
   latest.current=result.docs;setDocs(result.docs);setSelected('');
   setNotice(result.split?`${result.split} document(s) split into ${result.created} separate texts. Each chunk will receive its own annotation.`:'These documents are already within the chosen word count. They remain whole.');
  }catch(error){setNotice(error instanceof Error?error.message:'Could not split these documents. No documents were changed.');}
  finally{lock.current=false;setSplitting(false);}
 }
 function restoreDocuments(){
  if(lock.current||batchJob||exporting||!ready||storageConflict)return;
  latest.current=restoreWholeDocuments(latest.current);setDocs(latest.current);setSelected('');setNotice('Unannotated chunk groups restored to their whole documents.');
 }
 async function run(all:boolean){
  if(lock.current||batchJob||!ready||storageConflict||keyRejected)return;
  setSetupChecked(true);const errors=setupErrors(provider,key,prompt,model,effort);const missingSetup=missingAnnotationSetup(key,prompt)||Object.values(errors).find(Boolean);if(missingSetup){setNotice(missingSetup);document.getElementById(errors.key?'key':errors.prompt?'prompt':'workspace')?.focus();return;}
  lock.current=true;stop.current=false;setBusy(true);setNotice('');
  const runId=newId(),runStartedAt=new Date().toISOString(),runSize=all?latest.current.filter(r=>r.status==='pending').length:1;
  let claimed=0,failed=false;
  try{
   await runAnnotationQueue({
    concurrency:all?concurrency:1,
    shouldStop:()=>stop.current,
    take:()=>{
     if(!all&&claimed)return;
     const d=latest.current.find(x=>x.status==='pending');if(!d)return;
     claimed++;
     update(d.id,{inputMode:provider==='openrouter'?(/\.pdf$/i.test(d.file.name)?'pdf-native':'text'):undefined,status:'running',runId,runStartedAt,runSize,usage:undefined,startedAt:new Date().toISOString(),error:undefined,answerFields,answers:undefined,provider,model,prompt,effort,concurrency:all?concurrency:1,processing:'instant',batchId:undefined});
     if(claimed===1)setSelected(d.id);
     return d;
    },
    perform:async d=>{
     try{
      const form=new FormData();form.set('provider',provider);form.set('file',d.file);form.set('prompt',prompt);form.set('answerFields',JSON.stringify(answerFields));form.set('model',model);form.set('effort',effort);
      const r=await fetch('/api/annotate',{method:'POST',headers:{Authorization:`Bearer ${key.trim()}`},body:form});
      const out=await r.json().catch(()=>null) as {responseFormat?:string;rawResponse?:string;answers?:Record<string,string>;error?:string;score:string;explanation:string;tokens?:number;usage?:any;responseId?:string}|null;
      if(!out)throw new Error('The server returned an unreadable response. Check provider usage before retrying.');
      if(out.usage)update(d.id,{usage:out.usage,tokens:out.tokens,responseId:out.responseId});
      if(!r.ok){if(out.rawResponse)update(d.id,{...out,time:new Date().toISOString()});throw new Error(out.error||'Request failed.');}
      const invalid=annotationValidationError(out,answerFields,prompt,false);
      if(invalid){update(d.id,{...out,rawResponse:JSON.stringify(out),time:new Date().toISOString()});throw new Error(invalid);}
      update(d.id,{status:'done',...out,answers:answerValues(out,answerFields),provider,model,prompt,effort,time:new Date().toISOString()});
     }catch(e){
      stop.current=true;failed=true;
      update(d.id,{status:'error',error:e instanceof Error?e.message:'Request failed'});
      setSelected(d.id);setNotice('Stopped starting new annotations after an error. Active requests will finish, and completed results are kept. Review the error before retrying.');
     }
    }
   });
  }finally{
   if(stop.current&&!failed)setNotice('Paused. Active annotations have finished; completed results are kept.');
   lock.current=false;setBusy(false);
  }
 }

 async function batchRequest(action:string,job:BatchJob,extra?:FormData){
  const form=extra||new FormData();form.set('action',action);form.set('provider',job.provider);if(job.id)form.set('id',job.id);
  const r=await fetch('/api/batch',{method:'POST',headers:{Authorization:`Bearer ${key.trim()}`},body:form});
  const out:any=await r.json().catch(()=>null);
  if(!out||!r.ok){const error=new Error(out?.error||'The connection was interrupted. Check your provider before submitting again.') as Error&{uncertain:boolean};error.uncertain=out?.uncertain??true;throw error;}return out;
 }
 async function submitBatch(){
  if(lock.current||batchJob||!ready||storageConflict||keyRejected)return;
  setSetupChecked(true);const errors=setupErrors(provider,key,prompt,model,effort);const missingSetup=missingAnnotationSetup(key,prompt)||Object.values(errors).find(Boolean);if(missingSetup){setNotice(missingSetup);document.getElementById(errors.key?'key':errors.prompt?'prompt':'workspace')?.focus();return;}
  const pending=latest.current.filter(d=>d.status==='pending');if(!pending.length)return;
  if(pending.length>MAX_BATCH_ITEMS||pending.reduce((n,d)=>n+d.file.size,0)>MAX_BATCH_SOURCE_BYTES){setNotice('Submit up to 10,000 texts and 50 MB of files together. Submit fewer or smaller files when this limit is exceeded.');return;}
  lock.current=true;setBatchBusy(true);setNotice('');
  const job:BatchJob={responseFormat:annotationFormatRecord(answerFields,prompt,false),answerFields,runId:'lab_'+newId(),provider,model,prompt,effort,docIds:pending.map(d=>d.id),createdAt:new Date().toISOString(),state:'submitting'};
  const queuedIds=new Set(job.docIds);
  const queued=latest.current.map(d=>queuedIds.has(d.id)?{...d,status:'queued',runId:job.runId,runStartedAt:job.createdAt,runSize:job.docIds.length,usage:undefined,startedAt:new Date().toISOString(),error:undefined,answerFields,answers:undefined,provider,model,prompt,effort,concurrency:undefined,processing:'batch'}:d);
  let submitted=false;
  try{
   // Save the recovery reference before anything can create a paid provider job.
   await storage.current.save({provenance,docs:queued,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob:job});
   latest.current=queued;setDocs(queued);setBatchJob(job);
   const form=new FormData();form.set('model',model);form.set('effort',effort);form.set('prompt',prompt);form.set('answerFields',JSON.stringify(answerFields));form.set('runId',job.runId);form.set('ids',JSON.stringify(pending.map((_,i)=>job.runId+'_'+i)));pending.forEach(d=>form.append('files',d.file));
   submitted=true;
   const out=await batchRequest('submit',job,form);if(typeof out.id!=='string'||!out.id)throw new Error('Submission was not confirmed. Check the provider’s console.');const accepted={...job,id:out.id,state:'processing' as const};setBatchJob(accepted);
   await storage.current.save({provenance,docs:queued,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob:accepted});
   setNotice('Batch submitted. Once this workspace is saved, you can close the page and return in this browser.');
  }catch(error){
   const uncertain=submitted&&((error as Error&{uncertain?:boolean}).uncertain!==false);
   if(uncertain){setBatchJob(j=>({...j||job,state:'unknown'}));setNotice('Submission or saving was not confirmed. Do not submit again yet. Check your provider’s console and use the batch reference below to recover it.');}
   else{const queuedIds=new Set(job.docIds);latest.current=latest.current.map(d=>queuedIds.has(d.id)?{...d,status:'pending'}:d);setDocs(latest.current);setBatchJob(null);setNotice(error instanceof Error?error.message:'Could not submit this batch.');}
  }finally{lock.current=false;setBatchBusy(false);}
 }
 async function manageBatch(action:'check'|'collect'|'cancel',idOverride?:string){
  if(lock.current||!batchJob||storageConflict)return;
  if(!key.trim()){setNotice(`Re-enter the API key for the ${PROVIDERS[batchJob.provider].label} account that submitted this batch.`);return;}
  const job=idOverride?{...batchJob,id:idOverride.trim()}:batchJob;if(!job.id)return;
  if(action==='cancel'&&!confirm('Request cancellation? Work already processed may still be charged. Completed results can be collected after the batch ends.'))return;
  lock.current=true;setBatchBusy(true);setNotice('');
  try{
   const out=await batchRequest(action,job) as BatchUpdate&{cancelRequested?:boolean};
   if(action==='cancel'){setNotice('Cancellation requested. Check status later, then collect any completed results.');return;}
   if(typeof out.terminal!=='boolean'||action==='collect'&&out.terminal&&!Array.isArray(out.results))throw new Error('The provider response could not be read. Your batch is still saved; check again.');
   if(action==='collect'&&out.terminal){
    const results=new Map<string,BatchResult>((out.results||[]).map(r=>[r.id,r]));
    const indices=new Map(job.docIds.map((id,i)=>[id,i])),expected=new Set(job.docIds.map((_,i)=>job.runId+'_'+i));
    if([...results.keys()].some(id=>!expected.has(id)))throw new Error('These results belong to a different batch. Check the batch ID; your workspace has not been changed.');
    const collected=latest.current.map(d=>{const index=indices.get(d.id);if(index===undefined)return d;const r=results.get(job.runId+'_'+index);if(r&&!r.error){r.error=annotationValidationError(r,job.answerFields,job.prompt,false);if(r.error)r.rawResponse=JSON.stringify({score:r.score,explanation:r.explanation,answers:r.answers});else delete r.rawResponse;}return {...d,...(r?{...collectedAnswers(r,job.answerFields),responseFormat:job.responseFormat,rawResponse:r.rawResponse,score:r.score,explanation:r.explanation,tokens:r.tokens,usage:r.usage,responseId:r.responseId}:{}),status:r&&!r.error?'done':'error',error:r?.error||(!r?'No result was returned for this document. Check the provider’s batch report before retrying.':undefined),provider:job.provider,model:job.model,prompt:job.prompt,effort:job.effort,processing:'batch',batchId:job.id,time:new Date().toISOString()};});
    // Retain the job until the complete result set is safely stored.
    await storage.current.save({provenance,docs:collected,answerFields,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,batchJob:null});
    latest.current=collected;setDocs(collected);setBatchJob(null);setSelected(job.docIds[0]||'');setRecoverId('');setNotice('Batch results collected. Any failed texts are marked for review; completed results are kept.');
   }else{setBatchJob({...job,state:out.terminal?'ready':'processing',completed:out.completed,total:out.total,providerState:out.state});setNotice(out.terminal?'The batch has ended. Collect results to see completed annotations and any errors.':'The batch is still processing. You can close this page once the workspace is saved.');}
  }catch(error){setNotice(error instanceof Error?error.message:'Could not check this batch. Your saved job is unchanged.');}
  finally{lock.current=false;setBatchBusy(false);}
 }
 function releaseUnconfirmedBatch(){
  if(!batchJob||batchBusy||storageConflict)return;
  if(!confirm('Only continue after checking your provider’s console and confirming that this batch was never submitted, or has ended and you no longer need its results. This forgets the local batch reference; it does not cancel a provider job.'))return;
  const queuedIds=new Set(batchJob.docIds);latest.current=latest.current.map(d=>queuedIds.has(d.id)?{...d,status:'pending'}:d);setDocs(latest.current);setBatchJob(null);setNotice('Local batch reference cleared. Check provider usage before submitting these texts again.');
 }
 async function download(){try{setExporting(true);const {createResultsWorkbook}=await import('@/lib/export-results');const buffer=await createResultsWorkbook(docs,{answerFields,prompt,model,effort,provider,studyName});const blob=new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='annotations.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setNotice('The Excel download failed. Your saved results are still here; please try again.');}finally{setExporting(false);}}

 const done=docs.filter(d=>d.status==='done').length,waiting=docs.filter(d=>d.status==='pending').length,current=docs.find(d=>d.id===selected);
 const canSplit=docs.some(d=>d.status==='pending'&&!d.sourceId&&!d.history?.length),canRestore=restorableSourceIds(docs).size>0;
 const resultStart=Math.min(resultPage,Math.max(0,Math.ceil(docs.length/100)-1))*100;
 useEffect(()=>{const index=docs.findIndex(item=>item.id===selected);if(index>=0)setResultPage(Math.floor(index/100));},[selected]);
 const setupDefaults={prompt,setPrompt,ready,workspaceLocked,busy};
 function renderProcessingOptions(){
  return <section className="processing-options" aria-label="Processing options">
   <button type="button" className="processing-options-toggle" aria-expanded={showProcessing} aria-controls="processing-options-settings" onClick={()=>setShowProcessing(v=>!v)}>
    <span className="processing-options-title">Processing options <span aria-hidden="true">{showProcessing?'▴':'▾'}</span></span>
    <span className="processing-options-summary">{processing==='batch'?'Batch':`Instant · ${concurrency===1?'one at a time':`${concurrency} at a time`}`} · {docs.some(d=>d.sourceId)?'Chunked texts':'No chunking'}</span>
   </button>
   {showProcessing&&<div id="processing-options-settings" className="processing-options-settings"><button type="button" className="textbutton chunking-toggle" aria-expanded={showChunking} aria-controls="chunking-settings" disabled={workspaceLocked||!ready} onClick={()=>setShowChunking(v=>!v)}>Split into chunks{showChunking?' ▴':' ▾'}</button>{showChunking&&<div id="chunking-settings" className="chunking-panel"><p>Choose a word-count target and boundary method. Each chunk gets its own annotation and result.</p><label htmlFor="chunk-method">Chunk boundaries</label><select id="chunk-method" value={chunkMethod} disabled={workspaceLocked||!ready} onChange={e=>setChunkMethod(e.target.value as typeof chunkMethod)}><option value="sentences">Prefer whole sentences</option><option value="exact-words">Exact word counts</option></select><label htmlFor="chunk-words">Target words per chunk</label><input id="chunk-words" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={chunkWords} disabled={workspaceLocked||!ready||storageConflict} onChange={e=>setChunkWords(e.target.value)} aria-describedby="chunking-help"/><p id="chunking-help" className="hint">{chunkMethod==='sentences'?'Keep sentences together where possible; chunk lengths are approximate.':'Split at exact word counts; boundaries may fall within a sentence.'}</p><details className="hint"><summary>How splitting works</summary><p>{chunkMethod==='sentences'?'Uses native English sentence segmentation and paragraph boundaries. A sentence longer than the target is split at exact word counts; text without sentence punctuation uses the same fallback. Abbreviations can be ambiguous, so review the chunks.':'The final chunk may be shorter than the target.'} Words are whitespace-separated runs. Text order and every character of the extracted text are preserved, with no overlap. Shorter documents stay whole. Documents with results or previous attempts are kept unchanged. PDF chunks use extracted text, without images or OCR.</p></details><div className="chunking-actions"><Button variant="outline" disabled={workspaceLocked||exporting||!ready||storageConflict||!canSplit||!validChunkWords(Number(chunkWords))} onClick={splitDocuments}>{splitting?'Preparing chunks…':'Split ready documents'}</Button>{canRestore&&<button type="button" className="textbutton" disabled={workspaceLocked||exporting||!ready||storageConflict} onClick={restoreDocuments}>Restore whole documents</button>}</div><p className="hint">Review chunks by clicking their names. Each chunk is a separate annotation; provider charges apply.</p></div>}<div className="processing-choice"><label htmlFor="processing-mode">Processing</label><select id="processing-mode" value={processing} disabled={workspaceLocked||!ready} onChange={e=>setProcessing(e.target.value)}><option value="instant">Instant</option><option value="batch" disabled={provider==='openrouter'}>Batch · 50% lower token costs</option></select></div>{processing==='instant'&&<><div className="processing-choice"><label htmlFor="annotation-concurrency">Parallel annotations</label><select id="annotation-concurrency" value={concurrency} disabled={workspaceLocked||!ready||storageConflict} aria-describedby="parallel-help" onChange={e=>setConcurrency(annotationConcurrency(Number(e.target.value)))}>{ANNOTATION_CONCURRENCY.map(n=><option key={n} value={n}>{n===1?'Off · one at a time':`${n} at a time`}</option>)}</select></div><p id="parallel-help" className="hint batch-explainer">Run all can annotate several texts at once. Each text gets a separate request; token prices are unchanged. Speed depends on your provider’s rate limits. Annotate next always runs one text.</p></>}{processing==='batch'&&!batchJob&&<p className="hint batch-explainer">Results arrive later, usually within 24 hours. After submission is saved, you can close this page and return in the same browser to collect them. {BATCH_CAPACITY} {provider==='gemini'?'Gemini inline requests also have an 18 MB prepared-request limit.':''}</p>}</div>}
  </section>;
 }
 function saveChartYears(years:Map<string,number|null>){
  setDocs(current=>current.map(doc=>years.has(doc.id)?{...doc,chartYear:years.get(doc.id)}:doc));
 }
 function renderSetup(options?:KnowledgeSetup){
  const prompt=options?.prompt??setupDefaults.prompt,setPrompt=options?.setPrompt??setupDefaults.setPrompt,ready=options?options.ready&&setupDefaults.ready:setupDefaults.ready,workspaceLocked=options?options.locked:setupDefaults.workspaceLocked,busy=options?options.locked:setupDefaults.busy;
  const names=options?.answerFields??answerFields,changeNames=options?.setAnswerFields??setAnswerFields;
  const errors=setupErrors(provider,key,prompt,model,effort),showErrors=options?.validationRequested||setupChecked;
  return <aside className="panel setup"><h2 id={options?"knowledge-setup":"workspace"} tabIndex={-1}><span className="step">01</span> Set up your study</h2>{<><label>Provider</label><Select value={provider} onValueChange={chooseProvider} disabled={workspaceLocked||!ready}><SelectTrigger aria-label="Provider"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>{GEMINI_ENABLED&&<SelectItem value="gemini">Google (Gemini)</SelectItem>}<SelectItem value="anthropic">Anthropic (Claude)</SelectItem><SelectItem value="openrouter">OpenRouter</SelectItem></SelectContent></Select></>}<label htmlFor={options?"knowledge-key":"key"}>{config.label} API key</label><input id={options?"knowledge-key":"key"} type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="Paste your API key" autoComplete="off" disabled={(options?.keyLocked??busy)||!ready}/>{errors.key&&(showErrors||key.trim())&&<p className="message" role="alert">{errors.key}</p>}{!errors.key&&<ProviderKeyStatus value={keyCheck}/>}<p className="hint">Sent directly from your browser to {config.label}; never saved. Re-enter after reloading or reopening. <a href={config.keyUrl} target="_blank" rel="noreferrer">Create a key ↗</a></p><div className="pair model-settings"><div><label>Model</label><Select value={model} onValueChange={m=>{setModel(m);setEffort(reasoningOptions(provider,m).includes(effort)?effort:defaultEffort(provider,m));}} disabled={workspaceLocked||!ready}><SelectTrigger aria-label="Model" title={modelLabel(model)}><SelectValue>{modelLabel(model)}</SelectValue></SelectTrigger><SelectContent>{provider==='openrouter'?['Economical starting points','More capable comparison models'].map((label,index)=><SelectGroup key={label}><SelectLabel>{label}</SelectLabel>{config.models.filter(m=>OPENROUTER_STARTER_MODELS.includes(m)===(index===0)).map(m=><SelectItem value={m} key={m} textValue={modelLabel(m)}>{modelLabel(m)}</SelectItem>)}</SelectGroup>):config.models.map(m=><SelectItem value={m} key={m} textValue={modelLabel(m)}><span>{modelLabel(m)}</span><span className={'model-access-badge '+(modelAccessLabel(provider,m).startsWith('Free')?'free':'paid')}>{modelAccessLabel(provider,m)}</span></SelectItem>)}</SelectContent></Select></div><div><label>{reasoningLabel(provider,model)}</label><Select value={effort} onValueChange={setEffort} disabled={workspaceLocked||!ready}><SelectTrigger aria-label={reasoningLabel(provider,model)}><SelectValue/></SelectTrigger><SelectContent>{reasoningOptions(provider,model).map(m=><SelectItem value={m} key={m} title={/^\d+$/.test(m)?`${m} thinking tokens`:undefined}>{reasoningOptionLabel(m)}</SelectItem>)}</SelectContent></Select></div></div>{showErrors&&errors.model&&<p className="message" role="alert">{errors.model}</p>}<p className="hint" aria-live="polite">{modelHint(provider,model)}</p><label htmlFor={options?"knowledge-prompt":"prompt"}>Annotation prompt</label><textarea id={options?"knowledge-prompt":"prompt"} maxLength={100000} value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={workspaceLocked||!ready} placeholder="Paste your course prompt or your own annotation instructions here. Define the score or category and how it should be assigned."/>{showErrors&&errors.prompt&&<p className="message" role="alert">{errors.prompt}</p>}<div className="under"><button className="textbutton" disabled={workspaceLocked||!ready} onClick={()=>{if(!prompt||confirm('Replace your prompt with the example?'))setPrompt(options?KNOWLEDGE_SAMPLE:SAMPLE);}}>Use a simple example</button></div><SavedPrompts disabled={workspaceLocked||!ready} prompt={prompt} answerFields={names} onUse={(value,fields)=>{setPrompt(value);changeNames(fields);}}/>{options&&<p className="hint">The model is instructed to report INSUFFICIENT_KNOWLEDGE when it cannot assess a subject.</p>}<AnswerFields names={names} onChange={changeNames} disabled={workspaceLocked||!ready}/>{options?options.extraSetup:renderProcessingOptions()}</aside>;
 }
 return <main><header><div className="brand"><img className="brand-icon" src="/favicon.svg?v=58" width="40" height="40" alt=""/><div className="brandtext"><span>Text Annotation Lab</span><small>Department of English &amp; American Studies Center Aarhus · Aarhus University</small></div></div><div className="header-study-actions">{studyControls}<span className="saved" role="status">{workingCopySaved?<><Check size={15}/>Autosaved in this browser</>:workingCopyStatus}</span></div></header><Tabs value={activeTab} onValueChange={changeTab} aria-busy={tabLoading||undefined}><TabsList className="study-tabs" aria-label="Text Annotation Lab sections"><TabsTrigger value="workspace">Workspace</TabsTrigger><TabsTrigger value="get-started">Get started{startHint&&!docs.length&&<span className="start-hint"><ArrowLeft size={13} aria-hidden="true"/>New? Start here</span>}</TabsTrigger><TabsTrigger value="tips">Prompting tips</TabsTrigger><TabsTrigger value="corpus">Corpus examples</TabsTrigger><TabsTrigger value="study-example">Study example</TabsTrigger><TabsTrigger value="resources">Further resources</TabsTrigger><TabsTrigger value="about">About</TabsTrigger><TabsTrigger value="model-knowledge" className="experimental-tab"><FlaskConical size={16} aria-hidden="true"/>Model knowledge <span className="experimental-nav-label">Experimental</span></TabsTrigger></TabsList><TabsContent value="workspace" forceMount className="workspace-tab"><div className="workspace">{renderSetup()}<section className="panel queue"><div className="sectionhead"><h2><span className="step">02</span> Add your documents</h2><span className="count">{docs.length} texts</span></div><label className={'upload '+(workspaceLocked?'disabled':'')}><Upload size={24}/><strong>Choose documents</strong><span>Upload one file per text you want to annotate. PDF, DOCX, TXT, MD, HTML, RTF · up to 20 MB each</span><input type="file" aria-label="Choose documents" multiple accept=".txt,.md,.pdf,.docx,.html,.htm,.rtf" disabled={workspaceLocked||!ready||storageConflict} onChange={e=>{const operation=add(e.target.files);e.target.value='';return operation;}}/></label>{pendingImport&&<div className="message" role="group" aria-label="Duplicate documents"><p>{pendingImport.duplicates} duplicate {pendingImport.duplicates===1?'file':'files'} found in this selection or the queue.</p><details><summary>More information</summary><p>Matches have the same name and identical bytes. Keep all for separate annotations of the same document, or exclude the matches. Existing documents stay unchanged.</p></details><div className="actions"><Button onClick={()=>commitDocuments(pendingImport.validFiles,pendingImport.summary)}>Keep all selected files</Button><Button variant="outline" onClick={()=>commitDocuments(pendingImport.accepted,pendingImport.summary)}>Exclude duplicate files</Button><Button variant="outline" onClick={()=>{setPendingImport(null);setNotice('Import canceled; no selected files added.');}}>Cancel import</Button></div></div>}<div className="actions"><Button disabled={workspaceLocked||!waiting||!ready||storageConflict||keyRejected} onClick={()=>run(false)} title="Annotate one text instantly to test your prompt">Annotate next <ArrowRight size={16}/></Button><Button variant="outline" disabled={workspaceLocked||!waiting||!ready||storageConflict||keyRejected} onClick={()=>processing==='batch'?submitBatch():run(true)}><Play size={15}/>{processing==='batch'?`Submit batch (${waiting})`:`Run all (${waiting})`}</Button>{annotating&&<Button variant="outline" onClick={()=>{stop.current=true;setNotice('Pausing after active annotations finish. No new texts will start.');}}><Pause size={15}/>Pause</Button>}{docs.some(d=>d.status==='error')&&<Button variant="outline" disabled={workspaceLocked||!ready||storageConflict} onClick={()=>retry()}>Queue failed items for retry</Button>}{docs.length>0&&<div className="clear-actions">{docs.some(row=>row.status==='done'||row.status==='error'||Boolean(row.history?.length))&&<Button variant="outline" disabled={workspaceLocked||exporting||!ready||storageConflict} onClick={clearResults}>Clear results</Button>}<Button type="button" variant="outline" className="clear-workspace" disabled={workspaceLocked||exporting||!ready||storageConflict||!docs.length} onClick={()=>{if(lock.current||batchJob)return;if(confirm('Clear all documents and results from this browser? Download the Excel workbook first.')){latest.current=[];setDocs([]);setSelected('');}}}>Clear workspace</Button></div>}<ResultsChart rows={docs} onInspect={viewDocument} onSaveYears={saveChartYears}/><Button className="export" variant="outline" disabled={!docs.length||exporting||splitting||adding} onClick={download}><Download size={16}/>{exporting?'Preparing Excel…':'Download Excel'}</Button></div>{annotating&&<p className="hint run-guidance" role="status">Keep this page open while running.</p>}<SettingsNotice rows={docs} current={{provider,model,effort,prompt,answerFields}}/><CostEstimate rows={docs} disabled={!ready} batch={processing==='batch'} revision={JSON.stringify([provider,model,effort,prompt,answerFields,processing,docs.map(d=>[d.id,d.status,d.usage])])} load={signal=>studentEstimate({provider,model,effort,prompt,answerFields,rows:docs,signal})} canCountInputs={!keyRejected&&provider!=='openrouter'&&Boolean(key.trim())&&!workspaceLocked} countInputs={provider==='openrouter'?undefined:(signal,onProgress)=>countStudentInputs({provider,model,effort,prompt,answerFields,rows:docs,apiKey:key,signal,onProgress})}/>{batchJob&&<div className="batch-status" role="status"><div><strong>{batchBusy?(batchJob.state==='submitting'?'Submitting batch…':'Contacting provider…'):batchJob.state==='ready'?'Batch ready to collect':batchJob.state==='unknown'?'Batch needs checking':'Batch processing'}</strong><span>{batchJob.docIds.length} texts · {modelLabel(batchJob.model)}{batchJob.completed!==undefined?` · ${batchJob.completed} processed`:''}</span></div>{batchJob.id&&<Button variant="outline" disabled={busy||storageConflict} onClick={()=>manageBatch(batchJob.state==='ready'?'collect':'check')}>{batchJob.state==='ready'?'Collect results':'Check status'}</Button>}<details className="batch-details"><summary>Batch details</summary><p>Submitted: {new Date(batchJob.createdAt).toLocaleString()}. Re-enter your {PROVIDERS[batchJob.provider].label} API key if you return later. Keys are never saved.</p><p className="batch-reference">{batchJob.id||batchJob.runId}</p>{!batchJob.id&&<><label htmlFor="recover-batch">Batch ID from your provider’s console</label><input id="recover-batch" value={recoverId} onChange={e=>setRecoverId(e.target.value)} placeholder={batchJob.provider==='openai'?'batch_…':batchJob.provider==='anthropic'?'msgbatch_…':'batches/…'}/><Button variant="outline" disabled={busy||!recoverId.trim()||storageConflict} onClick={()=>manageBatch('check',recoverId)}>Recover batch</Button><button className="textbutton" disabled={busy||storageConflict} onClick={releaseUnconfirmedBatch}>No batch to recover</button></>}{batchJob.id&&batchJob.state!=='ready'&&<button className="textbutton" disabled={busy||storageConflict} onClick={()=>manageBatch('cancel')}>Cancel batch</button>}</details></div>}{(docs.length>0||splitting||adding||batchBusy)&&<><div className="progressline" aria-live="polite"><span>{[splitting?'Preparing chunks…':adding?'Checking documents…':batchBusy?'Contacting provider…':'',queueSummary(docs)].filter(Boolean).join(' · ')}</span></div><Progress aria-label="Annotation progress" value={docs.length?done/docs.length*100:0}/></>}{storageIssue&&<div className="message" role="alert">{storageIssue}</div>}{notice&&<div className="message" role="status">{notice}</div>}{docs.some(d=>d.status==='done')&&<p className="hint result-hint">Select a row to compare the model’s explanation with the source text.</p>}<ResultPages total={docs.length} page={resultPage} onPageChange={page=>{setResultPage(page);setSelected('');}}/><div className="results"><Table><TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Status</TableHead>{showLegacyScore?<TableHead>Score / category</TableHead>:null}{resultNames.map(name=><TableHead key={name}>{name}</TableHead>)}</TableRow></TableHeader><TableBody>{docs.slice(resultStart,resultStart+100).map(d=><TableRow key={d.id} id={'document-row-'+d.id} className={'annotation-row '+(selected===d.id?'active':'')} tabIndex={0} aria-label={'View '+(d.status==='done'?'annotation and explanation':'document details')+' for '+d.name} aria-selected={selected===d.id} aria-controls="annotation-detail" title="Click to view details below" onClick={()=>viewDocument(d.id)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();viewDocument(d.id);}}}><TableCell><button className="docbutton" onClick={()=>viewDocument(d.id)}>{d.name}</button></TableCell><TableCell><span className={'status '+d.status}>{d.status==='done'?'Complete':d.status==='pending'?'Ready':d.status==='error'?'Needs attention':d.status==='queued'?'In batch':'Working…'}</span></TableCell>{showLegacyScore?<TableCell>{d.score||'—'}</TableCell>:null}{resultNames.map(name=><TableCell key={name}><span className="answer-cell">{resultAnswer(d,name)||'—'}</span></TableCell>)}</TableRow>)}</TableBody></Table></div>{!docs.length&&<div className="empty"><BookOpen size={34}/><p>Add a few documents, then annotate your first text.</p></div>}{current&&<div id="annotation-detail" className="detail" tabIndex={-1} role="region" aria-label="Selected document details"><button type="button" className="textbutton" onClick={()=>{const row=document.getElementById('document-row-'+current.id);row?.focus();row?.scrollIntoView({block:'nearest'});}}>Back to selected row</button><h3>{current.name}</h3>{current.sourceId&&<><p className="hint">Source: {current.sourceName} · Chunk {current.chunkIndex} of {current.chunkCount} · Words {current.wordStart}–{current.wordEnd}</p></>}{current.error&&<p className="message" role="alert">{current.error}</p>}{current.rawResponse&&<details><summary>View returned response</summary><pre>{current.rawResponse}</pre></details>}{(current.explanation||current.answers)?<><NamedAnswerDetail row={current}/><span className="resultscore">{current.score}</span>{hasSeparateExplanation(current)&&<p>{current.explanation}</p>}<small>{current.model} · {current.tokens?.toLocaleString()} tokens</small></>:!current.error?<p>The explanation will appear here after annotation.</p>:null}<SourceTextPreview key={current.id} file={current.file} chunk={Boolean(current.sourceId)}/>{current.history?.length&&<details><summary>Previous failed attempts ({current.history.length})</summary>{current.history.map((attempt,i)=><div key={i}><p>Attempt {i+1}: {attempt.error} · {attempt.model}</p><pre>{attempt.prompt}</pre></div>)}</details>}{current.status==='error'&&!workspaceLocked&&<Button variant="outline" onClick={()=>retry(current.id)}>Queue for retry</Button>}{current.status==='pending'&&!workspaceLocked&&<button className="textbutton" onClick={()=>setDocs(d=>d.filter(x=>x.id!==current.id))}>Remove document</button>}</div>}</section></div></TabsContent><TabsContent value="model-knowledge" forceMount className="workspace-tab"><ModelKnowledge draftRef={draftRef} keyRejected={keyRejected} studyId={studyId} studyName={studyName} onStudyReady={setKnowledgeSaved} onSaveStateChange={setKnowledgeSaveState} provider={provider} model={model} effort={effort} apiKey={key} parentLocked={annotating||splitting||adding||Boolean(pendingImport)||batchBusy||Boolean(batchJob)||!ready||storageConflict} renderSetup={renderSetup} onBusyChange={setKnowledgeBusy}/></TabsContent><ReadingPanels section={activeTab}/></Tabs><footer><div><strong>Text Annotation Lab</strong><span>Developed for students in the <a href="https://cc.au.dk/en/english" target="_blank" rel="noreferrer">Department of English</a> at Aarhus University. Open to anyone who finds it useful.</span></div><div className="attribution"><span>Developed for teaching by</span><strong>Jens Kjeldgaard-Christiansen</strong><span>Methodological advisor: <a href="https://edgardubourg.fr/" target="_blank" rel="noreferrer">Edgar Dubourg</a></span></div></footer></main>;
}
