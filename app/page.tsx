"use client";
import {newId} from '@/lib/identifier';

import {SettingsNotice} from '@/components/student-guidance';
import {ProviderKeyStatus,useProviderKeyCheck} from '@/components/provider-key-status';

import {SourceTextPreview} from '@/components/source-text-preview';
import {NamedAnswerDetail,collectedAnswers} from '@/components/named-answer-detail';
import {SavedPrompts} from '@/components/saved-prompts';
import {AnswerFields} from '@/components/answer-fields';
import {reviewStoredAnswer,annotationValidationError} from '@/lib/answer-validation';
import {annotationFormatRecord,answerInstructions,hasSeparateExplanation,validAnswerFields,resultColumns,resultAnswer,answerValues,sentAnswers,cleanAnswerSettings,type NamedAnswers,type AnswerSettings} from '@/lib/answer-fields';
import {DEFAULT_ANNOTATION_CONCURRENCY,concurrencyChoices,annotationConcurrency,runAnnotationQueue,sendAnnotation} from '@/lib/annotation-queue';
import {missingAnnotationSetup,isPlainConfirmation,rateLimitNotice} from '@/lib/annotation-feedback';
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
import {ModelKnowledge,type KnowledgeSetup,type WorkspaceSaveState,type KnowledgeResearchData} from '@/components/model-knowledge';
import {KNOWLEDGE_SAMPLE} from '@/lib/model-knowledge';
import {Progress} from '@/components/ui/progress';
import {Upload,Play,Download,BookOpen,ArrowRight,ArrowLeft,Pause,Check,FlaskConical} from 'lucide-react';
const START_HINT_KEY='text-annotation-lab:get-started-hint';
const SLOW_SAVE_MS=1500;
import {GEMINI_ENABLED,PROVIDERS,OPENROUTER_STARTER_MODELS,availableProvider,reasoningOptions,effortChoices,isListedModel,defaultEffort,reasoningLabel,reasoningOptionLabel,modelLabel,modelHint,modelFacts,modelAccessLabel,defaultModel,selectedModel,type AccountModel,type Provider} from '@/lib/providers';
import CostEstimate from '@/lib/cost-estimate/panel';
import {studentEstimate,countStudentInputs} from '@/lib/student-estimate';
import {priceFor} from '@/lib/cost-estimate/pricing';
import {ownPrice,useOwnPrices} from '@/lib/own-prices';
import {ModeSwitch,ResearchKeys,ResearchTools,ResearchAnswerFields,ResearchRequestOptions,ResearchRequestPreview,ResearchModel,ResearchFilters,ResearchDetail,ResearchRuns,ResearchExport,DetailSteps,stepKey} from '@/components/research-mode';
import {cleanRequestSettings,sentRequestSettings,requestSummary,type RequestSettings} from '@/lib/request-settings';
import {requestFrame} from '@/lib/request-frame';
import {cleanRequests,recordRequest,usedRequests,replyNotes,NOT_RECORDED,type RecordedRequest,type Recorded} from '@/lib/research/requests';
import {promptInserts,fixedLength,insertMap} from '@/lib/prompt-inserts';
import {insertValues,insertNotes} from '@/lib/research/inserts';
import {LAB_VERSION} from '@/lib/version';
import {readResearchMode,writeResearchMode,readSavedKeys,writeSavedKeys,forgetSavedKeys,sessionKeys,keepSessionKeys,type Keyring} from '@/lib/research/mode';
import {addRetry,addScope,adoptUnnumbered,beginRun,cleanRuns,clearRuns,deleteRun,earlierCount,labelRun,lowerRun,raiseRun,remainingFor,requeue,resumable,retryable,runRequestSettings,runSummaries,type RunRecord,type Earlier} from '@/lib/research/runs';
import {carriedOnNotice,connectionFailure,earlyStopNotice,earlyStopper,retriedNotice,takeShared} from '@/lib/research/early-stop';
import {MAX_REPEATS,annotationCount,annotationFrom,claimRepeats,cleanRepeats,incomplete,repeatsHint,missingRepeats,repeatsOf,settle,unclaimed,withAnnotation,type Annotation} from '@/lib/research/repeats';
import {CORPUS_TABLE,appendTexts,cleanColumns,columnIndex,removeColumn,type Column,type NewText} from '@/lib/research/columns';
import {bringBack,cleanRemoved,matchReturning,pruneRemoved,removeTexts,usedByRuns,withRemoved} from '@/lib/research/removed';
import {cleanScoreScale,type ScoreScale} from '@/lib/research/score-scale';
import {cleanSamples,type SampleRecord} from '@/lib/research/sample';
import {DEFAULT_VIEW,researchRows,viewNarrowed,runTag,pickRandom,parseSource,type View,type Compared} from '@/lib/research/view';
import {knowledgeRows} from '@/lib/research/knowledge';
// runNo, earlier, and cells belong to research mode: the run a result was made in, the results of earlier runs, and labels or metadata.
// So does the record of a result's request (Recorded).
type Doc={runNo?:number;earlier?:Earlier[];removedAt?:string;removedPlace?:number;cells?:string[];requestSettings?:RequestSettings;repeats?:number;annotations?:Annotation[];consistency?:Record<string,number>}&Recorded&{chartYear?:number|null;chartGroup?:string|null}&NamedAnswers&Partial<ChunkInfo>&{inputMode?:string;runId?:string;runStartedAt?:string;runSize?:number;history?:Attempt[];startedAt?:string;concurrency?:number;processing?:string;batchId?:string;provider?:Provider;id:string;name:string;file:File;status:string;score?:string;explanation?:string;error?:string;model?:string;prompt?:string;effort?:string;tokens?:number;usage?:any;time?:string;responseId?:string};
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
 // Research mode: field types, plain text, or no explanation. What a request sends is `sent`
 // (the names and only the settings that differ from the standard format).
 const [answerSettings,setAnswerSettings]=useState<AnswerSettings|undefined>();
 const sent=sentAnswers(answerFields,answerSettings),sentFields=sent.names,sentSettings=sent.settings;
 const [storageIssue,setStorageIssue]=useState(''),[storageConflict,setStorageConflict]=useState(false);

 const [showChunking,setShowChunking]=useState(false),[chunkWords,setChunkWords]=useState(String(DEFAULT_CHUNK_WORDS)),[splitting,setSplitting]=useState(false);
 const {names:resultNames,showLegacy:showLegacyScore}=resultColumns(docs,sentFields);
 const [resultPage,setResultPage]=useState(0);
 const [provenance,setProvenance]=useState<any>();
 const [processing,setProcessing]=useState('instant'),[batchJob,setBatchJob]=useState<BatchJob|null>(null),[batchBusy,setBatchBusy]=useState(false),[recoverId,setRecoverId]=useState('');
 const [concurrency,setConcurrency]=useState(DEFAULT_ANNOTATION_CONCURRENCY);
 // Research mode: annotations per text, 1 to 10 (lib/research/repeats.ts). Stored with the study when more than one.
 const [repeats,setRepeats]=useState(1),storedRepeats=repeats>1?repeats:undefined;
 // Research mode: prompt caching. Stored with the study; the standard Lab never sends it.
 const [requestSettings,setRequestSettings]=useState<RequestSettings|undefined>();
 // Research mode: the models on the account behind the selected provider's key, once its list has been read.
 const [accountModels,setAccountModels]=useState<{provider:Provider;models:AccountModel[]}>();
 const [showProcessing,setShowProcessing]=useState(false);
 const [knowledgeBusy,setKnowledgeBusy]=useState(false);
 const [adding,setAdding]=useState(false);
 const [setupChecked,setSetupChecked]=useState(false),[pendingImport,setPendingImport]=useState<{accepted:File[];validFiles:File[];duplicates:number;summary:string}|null>(null);
 // Research mode: tables chosen in the drop zone, waiting to be imported as texts one after another.
 const [tableFiles,setTableFiles]=useState<File[]>([]);
 const [chunkMethod,setChunkMethod]=useState<'exact-words'|'sentences'>('sentences');
 const busy=annotating||splitting||batchBusy||knowledgeBusy||adding||Boolean(pendingImport);
 const workspaceLocked=busy||Boolean(batchJob);
 const storage=useRef(createWorkspaceStorage(studyWorkspaceKey(studyId))),canSave=useRef(false),firstSave=useRef(true);
 const [provider,setProvider]=useState<Provider>('openai');
 const keyCheck=useProviderKeyCheck(provider,key,annotating||knowledgeBusy);
 // Research mode is a view of the same study: one switch, remembered in this browser. Texts, prompts, and results are shared by both modes.
 const [research,setResearch]=useState(readResearchMode),researchNow=useRef(research);researchNow.current=research;
 const [keyring,setKeyring]=useState<Keyring>(()=>readResearchMode()?{...readSavedKeys(),...sessionKeys()}:{}),[rememberKeys,setRememberKeys]=useState(()=>readResearchMode()&&readSavedKeys()!==undefined),[keysOpen,setKeysOpen]=useState(false);
 const [runs,setRuns]=useState<RunRecord[]>([]),runsNow=useRef<RunRecord[]>([]);runsNow.current=runs;
 // Research mode: the requests the runs sent, each kept once (lib/research/requests.ts).
 const [requests,setRequests]=useState<RecordedRequest[]|undefined>(),requestsNow=useRef<RecordedRequest[]|undefined>(undefined);requestsNow.current=requests;
 const [columns,setColumns]=useState<Column[]>([]),[samples,setSamples]=useState<SampleRecord[]>([]);
 // Research mode: texts deleted from the study that a run used, kept for that run's results (lib/research/removed.ts).
 const [removed,setRemoved]=useState<Doc[]>([]),removedNow=useRef<Doc[]>([]);removedNow.current=removed;
 // Research mode: the scale of the scores in plain-text replies, for the statistics only (never sent).
 const [scoreScale,setScoreScale]=useState<ScoreScale>();
 const [view,setView]=useState<View>(DEFAULT_VIEW),[checked,setChecked]=useState<string[]>([]),[tryCount,setTryCount]=useState('10');
 const [knowledgeData,setKnowledgeData]=useState<KnowledgeResearchData>();
 const plainNotice=useRef('');
 function inform(text:string){plainNotice.current=text;setNotice(text);}
 // Research mode offers more annotations at once; a study set to more than the standard mode offers runs one at a time there.
 const parallel=annotationConcurrency(concurrency,research);
 // What a request carries and a result records: research mode's request settings, each where it changes a
 // request to the selected model (lib/request-settings.ts).
 // Research mode: the placeholders of the prompt that are filled in for each text (lib/prompt-inserts.ts). A
 // prompt that begins with one has no part that every text shares, so nothing of it can be cached.
 const insertNames=research?promptInserts(prompt):[],promptFixed=insertNames.length?fixedLength(prompt):undefined;
 // Research mode: your own price for the model, for the cost estimate before a run.
 const ownPrices=useOwnPrices(),typedPrice=research?ownPrice(provider,model,ownPrices):undefined;
 const sentRequest=research?sentRequestSettings(provider,model,promptFixed!==undefined&&!prompt.slice(0,promptFixed).trim()?{...requestSettings,cache:undefined}:requestSettings,effort):undefined;
 // How many annotations a run makes of each text: always one in the standard Lab.
 const times=research?repeats:1;
 // The setup a run is made with (lib/research/runs.ts).
 const setupNow={provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,...(times>1?{repeats:times}:{}),...(sentRequest?.temperature!==undefined?{temperature:sentRequest.temperature}:{}),...(sentRequest?.maxOutput!==undefined?{maxOutput:sentRequest.maxOutput}:{})};
 // What a run reads of the settings. "Retry failed" (research mode) sends a run's failed requests again with
 // that run's own. scopeNote: which texts the next start covers, in words, for the run's record.
 const useNow={provider,model,effort,prompt,sentFields,sentSettings,sentRequest,times,insertNames,key};
 // The study's answer fields (the prompt's and its runs'): a column named after one is a guess for human labels.
 const studyFields=research?[...new Set([...sentFields,...(sentSettings?.fields||[]).map(field=>field.name),...runs.flatMap(run=>[...(run.answerFields||[]),...(run.answerSettings?.fields||[]).map(field=>field.name)])])]:[];
 const scopeNote=useRef('');
 // In research mode the key for each provider comes from the keys dialog in the header.
 useEffect(()=>{if(research)setKey(keyring[provider]||'');},[research,provider,keyring]);
 function saveKeys(next:Keyring,remember:boolean){
  setKeyring(next);keepSessionKeys(next);setRememberKeys(remember);
  if(!remember)forgetSavedKeys();else if(!writeSavedKeys(next))setNotice('The keys could not be stored in this browser. They are kept until you close or reload this tab.');
 }
 useEffect(()=>{if(ready&&provider==='openrouter'&&!batchJob)setProcessing('instant');},[ready,provider,batchJob]);
 const keyRejected=keyCheck.check.status==='rejected';
 const config=PROVIDERS[provider];
 // A model outside the Lab's lists is chosen in research mode. The study notes that, so that the model is kept
 // when the study is opened again, in either mode.
 const customModel=!isListedModel(provider,model)||undefined;
 // The reasoning settings the provider's list names for a model outside the Lab's lists (research mode).
 const knownEfforts=(id:string)=>research&&accountModels?.provider===provider&&!isListedModel(provider,id)?accountModels.models.find(entry=>entry.id===id)?.efforts:undefined;
 const efforts=effortChoices(provider,model,knownEfforts(model),effort);
 function chooseModel(next:string){const options=effortChoices(provider,next,knownEfforts(next)),usual=defaultEffort(provider,next);setModel(next);setEffort(options.includes(effort)?effort:options.includes(usual)?usual:options[0]);}
 function chooseProvider(value:string){const p=availableProvider(value);setProvider(p);if(p==='openrouter')setProcessing('instant');setKey(research?keyring[p]||'':'');setModel(defaultModel(p));setEffort(defaultEffort(p,defaultModel(p)));setNotice('');}
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
 const sections:Record<string,string>={'workspace':'workspace','get-started':'get-started','data-handling':'get-started','prompting-tips':'tips','corpus-example':'corpus','example-corpus':'corpus','corpus-inaugural':'corpus','corpus-debates':'corpus','corpus-obituaries':'corpus','corpus-scouts':'corpus','corpus-wpa':'corpus','corpus-campaign':'corpus','corpus-westerns':'corpus','corpus-billboard':'corpus','study-example':'study-example','further-resources':'resources','about':'about','model-knowledge':'model-knowledge','runs':'runs','export':'export'};
 const RESEARCH_TABS=['workspace','runs','export','about','model-knowledge'];
 const tabAllowed=(section:string)=>researchNow.current?RESEARCH_TABS.includes(section):section!=='runs'&&section!=='export';
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
  const sync=()=>{const section=sections[window.location.hash.slice(1)];if(section&&tabAllowed(section)){revealSection(section,()=>{skipSectionScroll.current=false;setActiveTab(section);});}};
  const show=(event:PageTransitionEvent)=>{if(event.persisted)reset();};
  reset();
  window.addEventListener('hashchange',sync);
  window.addEventListener('pageshow',show);
  return()=>{cancelAnimationFrame(frame);window.history.scrollRestoration=previousRestoration;window.removeEventListener('hashchange',sync);window.removeEventListener('pageshow',show);};
 },[]);
 useEffect(()=>{if(skipSectionScroll.current){skipSectionScroll.current=false;return;}const hash=window.location.hash.slice(1);if(sections[hash]===activeTab){return focusSectionWhenReady(hash==='example-corpus'?'corpus-example':hash);}},[activeTab]);
 function changeTab(value:string){if(value===activeTab){tabRequest.current++;setTabLoading(false);return;}revealSection(value,()=>{skipSectionScroll.current=true;setActiveTab(value);const anchors:Record<string,string>={tips:'prompting-tips',corpus:'corpus-example',resources:'further-resources'};window.history.pushState(null,'',window.location.pathname+window.location.search+'#'+(anchors[value]||value));});}
 // Switching modes never changes the study. A tab the other mode does not have gives way to the Workspace.
 function toggleResearch(on:boolean){
  writeResearchMode(on);researchNow.current=on;setResearch(on);
  if(on){
   const saved=readSavedKeys(),next:Keyring={...saved,...sessionKeys(),...(key.trim()?{[provider]:key.trim()}:{})};
   setRememberKeys(saved!==undefined);setKeyring(next);keepSessionKeys(next);
  }else setKeysOpen(false);
  if(!tabAllowed(activeTab)){tabRequest.current++;setTabLoading(false);skipSectionScroll.current=true;setActiveTab('workspace');window.history.replaceState(null,'',window.location.pathname+window.location.search+'#workspace');}
 }
 const [exporting,setExporting]=useState(false);
 const [knowledgeSaved,setKnowledgeSaved]=useState(false);
 const [knowledgeSaveState,setKnowledgeSaveState]=useState<WorkspaceSaveState>('loading');
 const workingCopySaved=saved&&!storageIssue&&knowledgeSaveState==='saved';
 const workingCopyFailed=Boolean(storageIssue)||knowledgeSaveState==='error'||knowledgeSaveState==='conflict',workingCopyPreparing=!ready||knowledgeSaveState==='loading';
 const workingCopyStatus=workingCopyFailed?'Working copy not saved':workingCopyPreparing?'Preparing workspace…':'Autosaving…';
 // Saves during a run finish in milliseconds; only report "Autosaving…" when one is slow, so the header does not flicker on every annotated text.
 const [slowSave,setSlowSave]=useState(false);
 useEffect(()=>{if(workingCopySaved||workingCopyFailed||workingCopyPreparing){setSlowSave(false);return;}const timer=setTimeout(()=>setSlowSave(true),SLOW_SAVE_MS);return()=>clearTimeout(timer);},[workingCopySaved,workingCopyFailed,workingCopyPreparing]);
 const showSaved=workingCopySaved||(!workingCopyFailed&&!workingCopyPreparing&&!slowSave);
 useEffect(()=>{onStudyReady?.(ready&&saved&&!storageIssue&&!annotating&&!splitting&&!adding&&!pendingImport&&!batchBusy&&!exporting&&knowledgeSaved);},[ready,saved,storageIssue,annotating,splitting,adding,batchBusy,exporting,pendingImport,knowledgeSaved,onStudyReady]);
 const recovering=storageConflict||knowledgeSaveState==='conflict';
 const canRecover=recovering&&ready&&(canSave.current||storageConflict)&&!busy&&!exporting&&
  (knowledgeSaveState==='conflict'||knowledgeSaved);
 useEffect(()=>{onRecoveryChange?.(canRecover);return ()=>onRecoveryChange?.(false);},[canRecover,onRecoveryChange]);
 const stop=useRef(false),lock=useRef(false),latest=useRef<Doc[]>([]);latest.current=docs;
 // Files being added that bring deleted texts back: each file with the id of its text (research mode).
 const returning=useRef(new Map<File,string>());
 useEffect(()=>{storage.current.restore().then(v=>{canSave.current=true;if(v){setProvenance(v.provenance);if((v.docs||[]).some((d:Doc)=>reviewStoredAnswer(d,false)!==d)){firstSave.current=false;setNotice('Some earlier answers need review under their recorded output instructions. Their returned values are preserved; no new requests were sent.');}const numbered=adoptUnnumbered<Doc>((v.docs||[]).map((d:Doc)=>reviewStoredAnswer(d,false)).map((d:Doc)=>d.status==='running'?(d.annotations?.length?{...d,...settle(d)}:{...d,status:'error',error:'Interrupted. Check your provider’s usage before retrying; the request may have completed.'}):d),cleanRuns(v.runs));setDocs(numbered.docs);setRuns(numbered.runs);const keptRemoved=cleanRemoved<Doc>(v.removed);removedNow.current=keptRemoved;setRemoved(keptRemoved);setRequests(usedRequests(cleanRequests(v.requests),[...numbered.docs,...keptRemoved]));setColumns(cleanColumns(v.columns));setSamples(cleanSamples(v.samples));setScoreScale(cleanScoreScale(v.scoreScale));setPrompt(v.prompt||'');setAnswerFields(validAnswerFields(v.answerFields)?v.answerFields:[]);setAnswerSettings(cleanAnswerSettings(v.answerSettings));setProcessing(v.processing==='batch'?'batch':'instant');setConcurrency(v.concurrency===undefined?DEFAULT_ANNOTATION_CONCURRENCY:annotationConcurrency(v.concurrency,true));setRepeats(cleanRepeats(v.repeats)??1);setRequestSettings(cleanRequestSettings(v.requestSettings));if(v.batchJob&&Array.isArray(v.batchJob.docIds)){setBatchJob({...v.batchJob,state:v.batchJob.state==='submitting'?'unknown':v.batchJob.state});}setChunkMethod(v.chunkMethod==='sentences'?'sentences':'exact-words');setChunkWords(String(validChunkWords(Number(v.chunkWords))?Number(v.chunkWords):DEFAULT_CHUNK_WORDS));const p=availableProvider(v.provider);setProvider(p);const restoredModel=selectedModel(p,v.model,v.customModel===true),restoredEffort=reasoningOptions(p,restoredModel).includes(v.effort)?v.effort:defaultEffort(p,restoredModel);if((v.docs||[]).some((d:Doc)=>d.status==='running')||p!==v.provider||restoredModel!==v.model||restoredEffort!==v.effort)firstSave.current=false;setModel(restoredModel);setEffort(restoredEffort); }}).catch(()=>{canSave.current=false;setStorageIssue('Browser storage could not be read. Existing saved data has not been overwritten. Download any new results before leaving.');}).finally(()=>setReady(true));},[]);
 useEffect(()=>{
  if(draftRef)draftRef.current.texts=ready&&(canSave.current||storageConflict)?{provenance,docs,answerFields,answerSettings,prompt,model,effort,provider,customModel,chunkWords,chunkMethod,processing,concurrency,repeats:storedRepeats,requestSettings,requests,batchJob,runs,columns,samples,...(removed.length?{removed}:{}),...(scoreScale?{scoreScale}:{})}:undefined;
 },[draftRef,ready,storageConflict,provenance,docs,answerFields,answerSettings,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,repeats,requestSettings,requests,batchJob,runs,columns,samples,removed,scoreScale]);
 useEffect(()=>{if(!ready||!canSave.current)return;if(firstSave.current){firstSave.current=false;setSaved(true);return;}let current=true;setSaved(false);storage.current.save({provenance,docs,answerFields,answerSettings,prompt,model,effort,provider,customModel,chunkWords,chunkMethod,processing,concurrency,repeats:storedRepeats,requestSettings,requests,batchJob,runs,columns,samples,...(removed.length?{removed}:{}),...(scoreScale?{scoreScale}:{})},{replaceable:true}).then(()=>{if(current){setSaved(true);setStorageIssue('');}}).catch(error=>{stop.current=true;const conflict=error instanceof Error&&error.message.startsWith('Another tab');if(conflict){canSave.current=false;setStorageConflict(true);}if(current||conflict){setSaved(false);setStorageIssue(conflict?error.message:'Could not save locally. Download your results before leaving.');}});return()=>{current=false;};},[docs,answerFields,answerSettings,prompt,model,effort,provider,chunkWords,chunkMethod,processing,concurrency,repeats,requestSettings,requests,batchJob,provenance,ready,runs,columns,samples,removed,scoreScale]);
 useEffect(()=>{const h=(e:BeforeUnloadEvent)=>{if(lock.current||(ready&&!saved)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[ready,saved]);
 function update(id:string,changes:Partial<Doc>){latest.current=latest.current.map(d=>d.id===id?{...d,...changes}:d);setDocs(latest.current);}
 // Research mode: a table (CSV, TSV, Excel, JSON) holds a whole corpus, one text per row; every other file is one text.
 function addChosen(files:File[]){
  const tables=files.filter(file=>CORPUS_TABLE.test(file.name)),rest=files.filter(file=>!CORPUS_TABLE.test(file.name));
  if(tables.length&&!(lock.current||workspaceLocked||!ready||storageConflict))setTableFiles(queue=>[...queue,...tables]);
  return rest.length||!tables.length?add(rest):undefined;
 }
 // Texts from a table or pasted text become plain-text documents; a table's other columns become labels or metadata.
 function addTexts(texts:NewText[],names:string[],message:string){
  if(lock.current||workspaceLocked||!ready||storageConflict||!texts.length)return false;
  // A deleted text added again (the same name and the same text) gets its record back, with its results.
  const back=texts.some(text=>text.back)?bringBack(latest.current,removedNow.current,new Map(texts.filter(text=>text.back).map(text=>[text.back!,(doc:Doc)=>doc]))):undefined,returning=new Map((back?.restored||[]).map(doc=>[doc.id,doc]));
  const next=appendTexts(back?back.docs:latest.current,columns,texts,names,text=>returning.get(text.back||'')||({id:newId(),name:text.name,file:new File([text.text],text.name,{type:'text/plain'}),status:'pending'} as Doc),studyFields);
  latest.current=next.docs;setDocs(next.docs);setColumns(next.columns);if(back){removedNow.current=back.removed;setRemoved(back.removed);}inform(message);
  return true;
 }
 async function add(files:FileList|File[]|null){
  if(!files||lock.current||workspaceLocked||!ready||storageConflict)return;
  const chosen=Array.from(files);lock.current=true;setAdding(true);setNotice('Checking selected documents…');
  try{
   const {accepted,validFiles,rejected,duplicates,unreadable,matchingNames}=await prepareDocumentUploads(chosen,latest.current);
   // Research mode: a file that is a deleted text again (the same name and the same bytes) brings that text back.
   returning.current=removedNow.current.length?await matchReturning(accepted,removedNow.current):new Map();
   const summary=[matchingNames?'Different files with matching names are retained.':'',rejected?`${rejected} invalid file(s): use nonempty PDF, DOCX, TXT, MD, HTML, or RTF up to 20 MB each.`:'',unreadable?`${unreadable} file(s) could not be checked; reselect them to try again.`:''].filter(Boolean).join(' ');
   if(duplicates){setPendingImport({accepted,validFiles,duplicates,summary});setNotice('Review duplicate documents before adding this selection.');}
   else commitDocuments(accepted,summary);
  }catch{setNotice('Could not check the selected files. Your existing documents are unchanged. Re-select the files and try again.');}
  finally{lock.current=false;setAdding(false);}
 }
 function commitDocuments(files:File[],summary=''){
  const ids=new Map(files.flatMap(file=>{const id=returning.current.get(file);return id?[[id,file] as const]:[];}));returning.current=new Map();
  const back=ids.size?bringBack(latest.current,removedNow.current,new Map([...ids.keys()].map(id=>[id,(doc:Doc)=>doc]))):undefined,restored=new Map((back?.restored||[]).map(doc=>[ids.get(doc.id)!,doc]));
  const added:Doc[]=files.map(file=>restored.get(file)||{id:newId(),name:file.name,file,status:'pending'});
  if(back){removedNow.current=back.removed;setRemoved(back.removed);}
  const again=restored.size?` ${restored.size===added.length?(restored.size===1?'It had':'They had'):`${restored.size.toLocaleString('en-US')} of them had`} been deleted before: the results earlier runs made for ${restored.size===1?'it are its':'them are theirs'} again.`:'';
  latest.current=[...(back?back.docs:latest.current),...added];setDocs(latest.current);setPendingImport(null);setNotice(`${added.length} ${added.length===1?'document':'documents'} added.${again} ${summary}`.trim());
 }
 function retry(id?:string){if(workspaceLocked||!ready||storageConflict)return;const count=latest.current.filter(d=>d.status==='error'&&(!id||d.id===id)).length;if(count&&confirm(retryMessage(count))){latest.current=queueRetries(latest.current,id,research?['runNo']:[]);setDocs(latest.current);setNotice('Retries queued. Review the current prompt and settings, then choose Annotate next or '+(processing==='batch'?'Submit batch':'Run all')+'.');}}
 const detailRequest=useRef(false);
 function viewDocument(id:string){detailRequest.current=true;setSelected(id);if(id===selected){const detail=document.getElementById('annotation-detail');detail?.focus();detail?.scrollIntoView({block:'nearest'});detailRequest.current=false;}}
 useEffect(()=>{if(!detailRequest.current)return;detailRequest.current=false;const detail=document.getElementById('annotation-detail');detail?.focus();detail?.scrollIntoView({block:'nearest'});},[selected]);

 function clearWorkspace(){if(lock.current||batchJob)return;if(confirm('Clear all documents and results from this browser? Download the Excel workbook first.')){latest.current=[];setDocs([]);setSelected('');runsNow.current=[];setRuns([]);setRequests(undefined);setColumns([]);setSamples([]);setChecked([]);setView(DEFAULT_VIEW);removedNow.current=[];setRemoved([]);}}
 function clearResults(){if(lock.current||batchJob||exporting||!ready||storageConflict)return;if(!confirm('Clear all annotation results'+(earlierCount(latest.current)?', including the results of earlier runs,':'')+' and keep the uploaded documents? Save a version in Studies or download a study backup first if you want to keep these results.'))return;latest.current=latest.current.map(clearRuns);setDocs(latest.current);runsNow.current=[];setRuns([]);setRequests(undefined);removedNow.current=[];setRemoved([]);setSelected('');setNotice('Results cleared. Your documents are ready to annotate again with the current settings.');}
 // Research mode: delete texts. A text a run used stays with that run's results, comparisons, and exports, but
 // leaves the Workspace and is never annotated again; one no run used is deleted outright.
 function deleteTexts(ids:string[],how:'selected'|'all'|'one'){
  if(lock.current||batchJob||exporting||!ready||storageConflict)return;
  const chosen=new Set(ids.filter(id=>latest.current.some(d=>d.id===id))),n=chosen.size,one=n===1;if(!n)return;
  const used=latest.current.some(d=>chosen.has(d.id)&&usedByRuns(d));
  const kept=used?` Results already made for ${one?'this text':'these texts'} stay with their runs (Runs & agreement and Export), and adding the same ${one?'text':'texts'} again connects ${one?'it':'them'} to those results again.`:'';
  if(how!=='one'&&!confirm(how==='all'?`Delete ${one?'the only text':`all ${n.toLocaleString('en-US')} texts`} from this study?${kept}`:`Delete ${n.toLocaleString('en-US')} selected ${one?'text':'texts'}?${kept}`))return;
  const next=removeTexts(latest.current,removedNow.current,chosen,new Date().toISOString());
  latest.current=next.docs;removedNow.current=next.removed;setDocs(next.docs);setRemoved(next.removed);
  setChecked(current=>current.filter(id=>!chosen.has(id)));if(chosen.has(selected))setSelected('');
  inform(`${n.toLocaleString('en-US')} ${one?'text':'texts'} deleted.${next.kept?` ${next.kept===n?(one?'Its results stay':'Their results stay'):`The results of ${next.kept.toLocaleString('en-US')} of them stay`} with the runs that made them.`:''}`);
 }
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
 // Check the provider key, prompt, and model before anything starts; point to what is missing.
 function setupReady(){
  setSetupChecked(true);const errors=setupErrors(provider,key,prompt,model,effort);const missingSetup=missingAnnotationSetup(key,prompt)||Object.values(errors).find(Boolean);
  if(!missingSetup)return true;
  setNotice(errors.key||errors.prompt?'':missingSetup);
  if(research&&errors.key)setKeysOpen(true);else document.getElementById(errors.key?'key':errors.prompt?'prompt':'workspace')?.focus();
  return false;
 }
 // Research mode: what a result about to be made records of its request: the request itself (kept once in the
 // list) and the build of the Lab. The standard Lab records nothing.
 function recorder(batch:boolean,use=useNow){
  const made=new Map<boolean,Recorded>();
  return (d:Doc):Recorded=>{
   if(!research)return {};
   const pdf=/\.pdf$/i.test(d.file.name);let noted=made.get(pdf);
   if(!noted){
    const kept=recordRequest(requestsNow.current,requestFrame({provider:use.provider,model:use.model,effort:use.effort,prompt:use.prompt,answerFields:use.sentFields,answerSettings:use.sentSettings,requestSettings:use.sentRequest,batch,inserts:use.insertNames.length>0},pdf));
    if(kept.list!==requestsNow.current){requestsNow.current=kept.list;setRequests(kept.list);}
    noted={...NOT_RECORDED,requestId:kept.id,lab:LAB_VERSION};made.set(pdf,noted);
   }
   // The values this text gives the prompt's placeholders are kept with its result.
   return use.insertNames.length?{...noted,inserts:insertValues(use.insertNames,d,columns)}:noted;
  };
 }
 // `only` limits the run to some texts (research mode); without it every ready text is annotated.
 // `resume` (research mode, several annotations per text): texts of the latest run that get their missing annotations.
 // `retryOf` (research mode, "Retry failed"): the run whose requests without a usable answer are sent again, with
 // the settings of that run. Inside this function the names of the settings stand for whichever settings apply.
 async function run(all:boolean,only?:Set<string>,newRun=false,resume?:Set<string>,retryOf?:{number:number;use:typeof useNow}){
  const {provider,model,effort,prompt,sentFields,sentSettings,sentRequest,times,insertNames,key}=retryOf?.use||useNow;
  const scope=scopeNote.current;scopeNote.current='';
  if(lock.current||batchJob||!ready||storageConflict||(keyRejected&&!retryOf))return;
  if(!retryOf&&!setupReady())return;
  lock.current=true;stop.current=false;setBusy(true);setNotice('');
  const resumes=(r:Doc)=>Boolean(resume?.has(r.id))&&incomplete(r)&&repeatsOf(r)===times;
  // What waits to be annotated: a text without a result, or one that gets its missing annotations. In a retry:
  // the texts of that run whose result failed or has fewer annotations than the run makes.
  const waits=(r:Doc)=>retryOf?(r.status==='error'||resumes(r))&&r.runNo===retryOf.number:r.status==='pending'||resumes(r);
  // A failed text of a retry as it was before it was sent again, in case it is not sent after all.
  const failedBefore=new Map<string,Doc>();
  // Each text is taken once per run: one whose missing annotations fail again, or whose retry fails again, is not
  // sent over and over.
  const taken=new Set<string>();
  const eligible=latest.current.filter(r=>waits(r)&&(!only||only.has(r.id)));
  // runSize counts requests: one per text, or one per annotation still to be made.
  const runId=newId(),runStartedAt=new Date().toISOString(),runSize=all?eligible.reduce((n,r)=>n+(r.status==='pending'?times:missingRepeats(r).length),0):times;
  // Texts annotated with an unchanged setup join the latest run; a changed setup starts the next one.
  let runNo:number|undefined;
  if(retryOf)runNo=retryOf.number;
  else if(eligible.length){const begun=beginRun(latest.current,runsNow.current,setupNow,newRun,runStartedAt,new Set((all?eligible:eligible.slice(0,1)).map(r=>r.id))),begunRuns=research?addScope(begun.runs,begun.number,scope||(all?'':`One text: ${eligible[0].name}`)):begun.runs;latest.current=begun.docs;runsNow.current=begunRuns;setDocs(begun.docs);setRuns(begunRuns);runNo=begun.number;}
  let claimed=0,failed=false;const recorded=recorder(false,retryOf?.use);
  // Research mode: a failed text is marked and the run carries on; it stops only when its first requests all
  // failed in a way every request would meet. answered, failures: the requests that came back, and those that failed.
  const early=research?earlyStopper():undefined;let answered=0,failures=0;
  // Several annotations per text. waitingTasks: annotations of the texts begun that are still to be sent.
  // open: per text begun, how it was before, how many of its annotations are outstanding, and how many came back.
  type Task={d:Doc;n:number};
  const waitingTasks:Task[]=[],open=new Map<string,{before:Doc;left:number;came:number}>();
  // None of the text's annotations is outstanding: its own fields are worked out from its annotations. A text
  // for which none came back (the run stopped first) is as it was.
  const settleText=(id:string)=>{
   const state=open.get(id);if(!state)return;open.delete(id);
   const row=latest.current.find(x=>x.id===id);if(!row)return;
   if(state.came)update(id,settle(row));else{latest.current=latest.current.map(x=>x.id===id?state.before:x);setDocs(latest.current);}
  };
  // One annotation came back, or (without `annotation`) was not sent because the run stopped.
  const close=(id:string,annotation?:Annotation,format?:string)=>{
   const state=open.get(id);if(!state)return;
   const row=latest.current.find(x=>x.id===id);
   if(annotation&&row){state.came++;update(id,{...withAnnotation(row,annotation),...(format?{responseFormat:format}:{})});}
   if(--state.left<=0)settleText(id);
  };
  try{
   await runAnnotationQueue<Task>({
    concurrency:all?parallel:1,
    shouldStop:()=>stop.current,
    // Research mode: when the provider reports a rate limit, wait and go on with fewer at a time.
    pace:research?{onLimited:limited=>inform(rateLimitNotice(limited,'text'))}:undefined,
    take:()=>{
     // The annotations of a text already begun come before a new text.
     const next=waitingTasks.shift();if(next)return next;
     if(!all&&claimed)return;
     const found=latest.current.find(x=>!taken.has(x.id)&&(retryOf?waits(x):x.status==='pending'||resumes(x)&&x.runNo===runNo)&&(!only||only.has(x.id)));if(!found)return;
     taken.add(found.id);
     // A failed text that is sent again: its failed result becomes an attempt in its history.
     const d=found.status==='error'?queueRetries([found],undefined,['runNo'])[0]:found;
     if(d!==found){failedBefore.set(d.id,found);latest.current=latest.current.map(x=>x.id===d.id?d:x);}
     claimed++;
     // n: the number of the annotation; 0 for a text's single annotation, which is written on the text itself.
     const ns=times===1?[0]:d.status==='pending'?Array.from({length:times},(_,i)=>i+1):missingRepeats(d);
     update(d.id,{inputMode:provider==='openrouter'?(/\.pdf$/i.test(d.file.name)?'pdf-native':'text'):undefined,status:'running',runNo,runId,runStartedAt,runSize,usage:undefined,startedAt:new Date().toISOString(),error:undefined,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,answers:undefined,provider,model,prompt,effort,concurrency:all?parallel:1,processing:'instant',batchId:undefined,...recorded(d),...claimRepeats(d,times)});
     if(times>1){open.set(d.id,{before:failedBefore.get(d.id)||d,left:ns.length,came:0});waitingTasks.push(...ns.slice(1).map(n=>({d,n})));}
     if(claimed===1)setSelected(d.id);
     return {d,n:ns[0]};
    },
    perform:async({d,n},place)=>{
     // A text's single annotation is written on the text. With several, each one is gathered in `got` and kept
     // as an annotation of its own.
     const got:Record<string,any>=n?{runId,runStartedAt,runSize,startedAt:new Date().toISOString(),processing:'instant',concurrency:all?parallel:1,...recorded(d)}:{};
     const write=n?(changes:Partial<Doc>)=>{Object.assign(got,changes);}:(changes:Partial<Doc>)=>update(d.id,changes);
     // The mark of a failure every request of the run would meet. It is read off the reply and never kept.
     // back: a reply came back (a request that did not get as far as a reply may have had no connection).
     let shared:string|undefined,back=false;
     try{
      const form=new FormData();form.set('provider',provider);form.set('file',d.file);form.set('prompt',prompt);form.set('answerFields',JSON.stringify(sentFields));if(sentSettings)form.set('answerSettings',JSON.stringify(sentSettings));if(sentRequest)form.set('requestSettings',JSON.stringify(sentRequest));form.set('model',model);form.set('effort',effort);if(research)form.set('record','true');if(insertNames.length)form.set('inserts',JSON.stringify(insertValues(insertNames,d,columns)));
      const sent=await sendAnnotation(()=>fetch('/api/annotate',{method:'POST',headers:{Authorization:`Bearer ${key.trim()}`},body:form}),place);
      // The run stopped while this text waited out a rate limit: it was not annotated and waits again as before.
      if(!sent){if(n)close(d.id);else{latest.current=latest.current.map(x=>x.id===d.id?failedBefore.get(d.id)||d:x);setDocs(latest.current);}return;}
      back=true;shared=takeShared(sent.out);
      const r=sent.response,out=sent.out as {responseFormat?:string;rawResponse?:string;answers?:Record<string,string>;error?:string;score:string;explanation:string;tokens?:number;usage?:any;responseId?:string}|null;
      if(!out)throw new Error('The server returned an unreadable response. Check provider usage before retrying.');
      if(out.usage)write({usage:out.usage,tokens:out.tokens,responseId:out.responseId});
      if(!r.ok){if(out.rawResponse)write({...out,time:new Date().toISOString()});else if(research)write(replyNotes(out));throw new Error(out.error||'Request failed.');}
      const invalid=annotationValidationError(out,sentFields,prompt,false,sentSettings);
      if(invalid){write({...out,rawResponse:JSON.stringify(out),time:new Date().toISOString()});throw new Error(invalid);}
      write({status:'done',...out,answers:answerValues(out,sentFields),provider,model,prompt,effort,time:new Date().toISOString()});
      answered++;early?.(d.id);
     }catch(e){
      if(early){
       write({status:'error',error:e instanceof Error?e.message:'Request failed'});
       answered++;failures++;
       const stopped=early(d.id,back?shared:connectionFailure(e).shared);
       if(stopped&&!failed){stop.current=true;failed=true;setNotice(earlyStopNotice(stopped,'text'));}
      }else{
       stop.current=true;failed=true;
       write({status:'error',error:e instanceof Error?e.message:'Request failed'});
       setSelected(d.id);setNotice('Stopped starting new annotations after an error. Active requests will finish, and completed results are kept. Review the error before retrying.');
      }
     }
     if(n)close(d.id,annotationFrom(n,got.status==='done',{...got,time:got.time||new Date().toISOString()}),typeof got.responseFormat==='string'?got.responseFormat:undefined);
    }
   });
  }finally{
   // Several annotations per text: what was not sent stays unsent, and every text begun is settled.
   for(const task of waitingTasks.splice(0))close(task.d.id);
   for(const id of [...open.keys()])settleText(id);
   if(stop.current&&!failed)setNotice('Paused. Active annotations have finished; completed results are kept.'+(failures?' '+carriedOnNotice(failures,answered,retryOf?'retry':'workspace',true):''));
   else if(failures&&!failed)setNotice(carriedOnNotice(failures,answered,retryOf?'retry':'workspace'));
   else if(retryOf&&answered&&!failed)setNotice(retriedNotice(retryOf.number,answered));
   // The run's record notes that its failed requests were sent again, and how many came back.
   if(retryOf&&answered){runsNow.current=addRetry(runsNow.current,retryOf.number,{at:runStartedAt,requests:answered});setRuns(runsNow.current);}
   // Each text that has a later result than this run's gets that result back as its current one.
   if(retryOf&&only){latest.current=lowerRun(latest.current,retryOf.number,only);setDocs(latest.current);}
   lock.current=false;setBusy(false);
  }
 }

 async function batchRequest(action:string,job:BatchJob,extra?:FormData){
  const form=extra||new FormData();form.set('action',action);form.set('provider',job.provider);if(job.id)form.set('id',job.id);if(job.answerSettings?.plain)form.set('plain','true');if(research&&action==='collect'){form.set('record','true');if(job.requestSettings?.summary)form.set('summary','true');}
  const r=await fetch('/api/batch',{method:'POST',headers:{Authorization:`Bearer ${key.trim()}`},body:form});
  const out:any=await r.json().catch(()=>null);
  if(!out||!r.ok){const error=new Error(out?.error||'The connection was interrupted. Check your provider before submitting again.') as Error&{uncertain:boolean};error.uncertain=out?.uncertain??true;throw error;}return out;
 }
 async function submitBatch(only?:Set<string>,newRun=false,resume?:Set<string>){
  const scope=scopeNote.current;scopeNote.current='';
  if(lock.current||batchJob||!ready||storageConflict||keyRejected)return;
  if(!setupReady())return;
  const createdAt=new Date().toISOString();
  const resumes=(d:Doc)=>Boolean(resume?.has(d.id))&&incomplete(d)&&repeatsOf(d)===times;
  const candidates=latest.current.filter(d=>(d.status==='pending'||resumes(d))&&(!only||only.has(d.id)));if(!candidates.length)return;
  const began=beginRun(latest.current,runsNow.current,setupNow,newRun,createdAt,new Set(candidates.map(d=>d.id))),begun=research?{...began,runs:addScope(began.runs,began.number,scope)}:began;
  // A text of the latest run gets its missing annotations only when the batch joins that run.
  const pending=candidates.filter(d=>d.status==='pending'||d.runNo===begun.number);if(!pending.length)return;
  // Which annotations each text gets: 0 for a text's single annotation; else all of them, or the missing ones.
  const ns=pending.map(d=>times===1?[0]:d.status==='pending'?Array.from({length:times},(_,i)=>i+1):missingRepeats(d)),count=ns.reduce((n,list)=>n+list.length,0);
  if(count>MAX_BATCH_ITEMS||pending.reduce((n,d)=>n+d.file.size,0)>MAX_BATCH_SOURCE_BYTES){setNotice(times>1?'Submit up to 10,000 requests (texts × annotations per text) and 50 MB of files together. Submit fewer texts when this limit is exceeded.':'Submit up to 10,000 texts and 50 MB of files together. Submit fewer or smaller files when this limit is exceeded.');return;}
  lock.current=true;setBatchBusy(true);setNotice('');
  const job:BatchJob={responseFormat:annotationFormatRecord(sentFields,prompt,false,sentSettings),answerFields:sentFields,...(sentSettings?{answerSettings:sentSettings}:{}),...(sentRequest?{requestSettings:sentRequest}:{}),runId:'lab_'+newId(),provider,model,prompt,effort,docIds:pending.map(d=>d.id),createdAt,state:'submitting',...(times>1?{repeats:times,...(ns.some(list=>list.length!==times)?{ns}:{})}:{})};
  const queuedIds=new Set(job.docIds),recorded=recorder(true);
  const queued=begun.docs.map(d=>queuedIds.has(d.id)?{...d,status:'queued',runNo:begun.number,runId:job.runId,runStartedAt:job.createdAt,runSize:count,usage:undefined,startedAt:new Date().toISOString(),error:undefined,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,answers:undefined,provider,model,prompt,effort,concurrency:undefined,processing:'batch',...recorded(d),...claimRepeats(d,times)}:d);
  let submitted=false;
  try{
   // Save the recovery reference before anything can create a paid provider job.
   await storage.current.save({provenance,docs:queued,answerFields,answerSettings,prompt,model,effort,provider,customModel,chunkWords,chunkMethod,processing,concurrency,repeats:storedRepeats,requestSettings,requests:requestsNow.current,batchJob:job,runs:begun.runs,columns,samples,...(removed.length?{removed}:{}),...(scoreScale?{scoreScale}:{})});
   latest.current=queued;setDocs(queued);runsNow.current=begun.runs;setRuns(begun.runs);setBatchJob(job);
   const form=new FormData();form.set('model',model);form.set('effort',effort);form.set('prompt',prompt);form.set('answerFields',JSON.stringify(sentFields));if(sentSettings)form.set('answerSettings',JSON.stringify(sentSettings));if(sentRequest)form.set('requestSettings',JSON.stringify(sentRequest));form.set('runId',job.runId);form.set('ids',JSON.stringify(Array.from({length:count},(_,i)=>job.runId+'_'+i)));if(times>1)form.set('copies',JSON.stringify(ns.map(list=>list.length)));if(insertNames.length)form.set('inserts',JSON.stringify(pending.map(d=>insertValues(insertNames,d,columns))));pending.forEach(d=>form.append('files',d.file));
   submitted=true;
   const out=await batchRequest('submit',job,form);if(typeof out.id!=='string'||!out.id)throw new Error('Submission was not confirmed. Check the provider’s console.');const accepted={...job,id:out.id,state:'processing' as const};setBatchJob(accepted);
   await storage.current.save({provenance,docs:queued,answerFields,answerSettings,prompt,model,effort,provider,customModel,chunkWords,chunkMethod,processing,concurrency,repeats:storedRepeats,requestSettings,requests:requestsNow.current,batchJob:accepted,runs:begun.runs,columns,samples,...(removed.length?{removed}:{}),...(scoreScale?{scoreScale}:{})});
   setNotice('Batch submitted. Once this workspace is saved, you can close the page and return in this browser.');
  }catch(error){
   const uncertain=submitted&&((error as Error&{uncertain?:boolean}).uncertain!==false);
   if(uncertain){setBatchJob(j=>({...j||job,state:'unknown'}));setNotice('Submission or saving was not confirmed. Do not submit again yet. Check your provider’s console and use the batch reference below to recover it.');}
   else{const queuedIds=new Set(job.docIds);latest.current=latest.current.map(d=>queuedIds.has(d.id)?unclaimed(d):d);setDocs(latest.current);setBatchJob(null);setNotice(error instanceof Error?error.message:'Could not submit this batch.');}
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
    // Requests are numbered text by text: one per text, or, with several annotations per text, one per annotation asked for.
    const several=(job.repeats||1)>1,slots=new Map<string,{at:number;ns:number[]}>();let requestCount=0;
    job.docIds.forEach((id,i)=>{const ns=several?job.ns?.[i]||Array.from({length:job.repeats!},(_,k)=>k+1):[0];slots.set(id,{at:requestCount,ns});requestCount+=ns.length;});
    const expected=new Set(Array.from({length:requestCount},(_,i)=>job.runId+'_'+i));
    if([...results.keys()].some(id=>!expected.has(id)))throw new Error('These results belong to a different batch. Check the batch ID; your workspace has not been changed.');
    const checked=(r:BatchResult|undefined)=>{if(r&&!r.error){r.error=annotationValidationError(r,job.answerFields,job.prompt,false,job.answerSettings);if(r.error)r.rawResponse=JSON.stringify({score:r.score,explanation:r.explanation,answers:r.answers});else delete r.rawResponse;}return r;};
    const collectedAt=new Date().toISOString(),notReturned='No result was returned for this document. Check the provider’s batch report before retrying.';
    // Several annotations per text: each result is kept as an annotation, and the text's own fields are worked out from them.
    const gathered=(d:Doc,slot:{at:number;ns:number[]}):Doc=>{
     let row:Doc={...d,answerFields:job.answerFields,answerSettings:job.answerSettings,responseFormat:job.responseFormat,provider:job.provider,model:job.model,prompt:job.prompt,effort:job.effort,processing:'batch',batchId:job.id};
     slot.ns.forEach((n,k)=>{
      const r=checked(results.get(job.runId+'_'+(slot.at+k)));
      const got={...(r?{answers:collectedAnswers(r,job.answerFields).answers,rawResponse:r.rawResponse,score:r.score,explanation:r.explanation,tokens:r.tokens,usage:r.usage,responseId:r.responseId,...(research?replyNotes(r):{})}:{}),error:r?.error||(!r?notReturned:undefined),runId:job.runId,runStartedAt:job.createdAt,runSize:d.runSize,processing:'batch',batchId:job.id,requestId:d.requestId,lab:d.lab,inserts:d.inserts,startedAt:d.startedAt,time:collectedAt};
      row={...row,...withAnnotation(row,annotationFrom(n,Boolean(r&&!r.error),got))};
     });
     return {...row,...settle(row)};
    };
    const collected=latest.current.map(d=>{const slot=slots.get(d.id);if(!slot)return d;if(several)return gathered(d,slot);const r=checked(results.get(job.runId+'_'+slot.at));return {...d,...(r?{...collectedAnswers(r,job.answerFields),answerSettings:job.answerSettings,responseFormat:job.responseFormat,rawResponse:r.rawResponse,score:r.score,explanation:r.explanation,tokens:r.tokens,usage:r.usage,responseId:r.responseId,...(research?replyNotes(r):{})}:{}),status:r&&!r.error?'done':'error',error:r?.error||(!r?notReturned:undefined),provider:job.provider,model:job.model,prompt:job.prompt,effort:job.effort,processing:'batch',batchId:job.id,time:new Date().toISOString()};});
    // Retain the job until the complete result set is safely stored.
    await storage.current.save({provenance,docs:collected,answerFields,answerSettings,prompt,model,effort,provider,customModel,chunkWords,chunkMethod,processing,concurrency,repeats:storedRepeats,requestSettings,requests:requestsNow.current,batchJob:null,runs:runsNow.current,columns,samples,...(removed.length?{removed}:{}),...(scoreScale?{scoreScale}:{})});
    latest.current=collected;setDocs(collected);setBatchJob(null);setSelected(job.docIds[0]||'');setRecoverId('');setNotice('Batch results collected. Any failed texts are marked for review; completed results are kept.');
   }else{setBatchJob({...job,state:out.terminal?'ready':'processing',completed:out.completed,total:out.total,providerState:out.state});setNotice(out.terminal?'The batch has ended. Collect results to see completed annotations and any errors.':'The batch is still processing. You can close this page once the workspace is saved.');}
  }catch(error){setNotice(error instanceof Error?error.message:'Could not check this batch. Your saved job is unchanged.');}
  finally{lock.current=false;setBatchBusy(false);}
 }
 function releaseUnconfirmedBatch(){
  if(!batchJob||batchBusy||storageConflict)return;
  if(!confirm('Only continue after checking your provider’s console and confirming that this batch was never submitted, or has ended and you no longer need its results. This forgets the local batch reference; it does not cancel a provider job.'))return;
  const queuedIds=new Set(batchJob.docIds);latest.current=latest.current.map(d=>queuedIds.has(d.id)?unclaimed(d):d);setDocs(latest.current);setBatchJob(null);setNotice('Local batch reference cleared. Check provider usage before submitting these texts again.');
 }
 // Research mode: annotate completed texts again. Their results move to earlier runs, so nothing is overwritten.
 // `resume`: texts that keep their result and get their missing annotations (see `resumable`).
 function again(ids:string[],start:(only:Set<string>,newRun:boolean)=>void,resume?:Set<string>){
  if(lock.current||batchJob||!ready||storageConflict||keyRejected||!ids.length||!setupReady())return;
  const only=new Set(ids);
  const retried=latest.current.map(d=>only.has(d.id)&&d.status==='error'?queueRetries([d],undefined,['runNo'])[0]:d);
  const moved=requeue(retried,runsNow.current,resume?.size?new Set(ids.filter(id=>!resume.has(id))):only);
  latest.current=moved.docs;runsNow.current=moved.runs;setDocs(moved.docs);setRuns(moved.runs);
  start(only,moved.archived>0);
 }
 // "All": every text in scope, as a new run when any of them already has a result.
 function runEvery(){
  const ids=scopeEvery.map(d=>d.id),repeats=scopeEvery.filter(d=>d.status==='done').length;
  if(repeats&&!confirm(`${repeats===ids.length?`Annotate ${ids.length} ${ids.length===1?'text':'texts'} again`:`Annotate ${ids.length} texts, ${repeats} of them again,`} with the current settings? This starts a new run. The existing results are kept as earlier runs.`))return;
  again(ids,(only,newRun)=>{scopeNote.current=`${scopeWords.every} texts (${ids.length.toLocaleString('en-US')})`;void(processing==='batch'?submitBatch(only,newRun):run(true,only,newRun));});
 }
 // "Remaining": the texts with no result from the current settings. They join the latest run when its settings are the same.
 function runRemaining(){
  again(scopeRemaining.map(d=>d.id),only=>{scopeNote.current=`Remaining ${scopeWords.of||'texts'} (${scopeRemaining.length.toLocaleString('en-US')})`;void(processing==='batch'?submitBatch(only,false,resume):run(true,only,false,resume));},resume);
 }
 // A quick check of the prompt on a few texts picked at random from the texts in scope.
 function trySample(){
  const pool=scope.filter(d=>d.status==='pending'||d.status==='done'||d.status==='error'),count=Math.round(Number(tryCount));
  if(!pool.length||!Number.isFinite(count)||count<1){setNotice('Enter how many texts to annotate, from 1 upward.');return;}
  const picked=pickRandom(pool,count),repeats=picked.filter(d=>d.status==='done').length;
  if(repeats&&!confirm(`${repeats} of the ${picked.length} randomly chosen texts already ${repeats===1?'has a result':'have results'}. Annotate them again? This starts a new run; the existing results are kept as earlier runs.`))return;
  again(picked.map(d=>d.id),(only,newRun)=>{scopeNote.current=`Random sample of ${picked.length.toLocaleString('en-US')}${scopeWords.of&&' '+scopeWords.of}`;void run(true,only,newRun);});
 }
 function applyResearch(next:any[],nextColumns:Column[],nextSamples:SampleRecord[],message:string,filter?:{column:string;value:string},nextRemoved?:any[]){
  if(lock.current||batchJob||!ready||storageConflict)return;
  // A label sheet also reaches the deleted texts kept for their runs.
  if(nextRemoved){removedNow.current=nextRemoved as Doc[];setRemoved(removedNow.current);}
  // A column removed goes from the deleted texts too, so their values stay in line with the columns.
  if(removedNow.current.length){let kept=removedNow.current,from=columns;for(const column of columns)if(columnIndex(nextColumns,column.name)<0){const out=removeColumn(kept,from,column.name);kept=out.docs;from=out.columns;}if(kept!==removedNow.current){removedNow.current=kept;setRemoved(kept);}}
  latest.current=next as Doc[];setDocs(latest.current);setColumns(nextColumns);setSamples(nextSamples);
  if(message)inform(message);
  if(filter)setView(current=>({...current,column:filter.column,value:filter.value,show:'all',query:''}));
 }
 function showRun(number:number){setView({...DEFAULT_VIEW,run:number});setChecked([]);changeTab('workspace');}
 function renameRun(number:number,label:string){runsNow.current=labelRun(runsNow.current,number,label);setRuns(runsNow.current);}
 // Research mode, "Retry failed" (Runs & agreement): the requests of a run without a usable answer are sent again
 // now, with the settings of that run, and the answers join that run. The Workspace opens on the run, where the
 // progress, Pause, and the notices are.
 function retryRun(number:number){
  if(lock.current||batchJob||!ready||storageConflict)return;
  const record=runSummaries(latest.current,runsNow.current).find(r=>r.number===number),targets=retryable(latest.current,number);
  if(!record||!targets.ids.length)return;
  showRun(number);
  if(!(record.provider in PROVIDERS)){setNotice(`Run #${number} does not name a provider the Lab knows, so its requests cannot be sent again.`);return;}
  const runProvider=record.provider as Provider,runKey=keyring[runProvider]||'',errors=setupErrors(runProvider,runKey,record.prompt,record.model,record.effort);
  if(errors.key||(runProvider===provider&&keyRejected)){setNotice(`Add a working ${PROVIDERS[runProvider].label} API key to send the requests of run #${number} again.`);setKeysOpen(true);return;}
  if(errors.prompt||errors.model){setNotice(`The requests of run #${number} cannot be sent again: ${errors.model?'its model or reasoning setting is not one this version of the Lab offers':'it has no prompt'}.`);return;}
  // The request settings the run's results recorded, with the temperature and output limit of the run's record.
  const recorded=cleanRequestSettings(runRequestSettings(latest.current,number)),tuned={...recorded,...(record.temperature!==undefined?{temperature:record.temperature}:{}),...(record.maxOutput!==undefined?{maxOutput:record.maxOutput}:{})};
  const runTimes=record.repeats||1,use={provider:runProvider,model:record.model,effort:record.effort,prompt:record.prompt,sentFields:record.answerFields,sentSettings:record.answerSettings,sentRequest:sentRequestSettings(runProvider,record.model,Object.keys(tuned).length?tuned:undefined,record.effort),times:runTimes,insertNames:promptInserts(record.prompt),key:runKey};
  // Each text concerned gets its result of this run back as its current one; a later result moves to its earlier ones.
  const ids=new Set(targets.ids);latest.current=raiseRun(latest.current,number,ids);setDocs(latest.current);
  void run(true,ids,false,runTimes>1?new Set(latest.current.filter(d=>ids.has(d.id)&&incomplete(d)).map(d=>d.id)):undefined,{number,use});
 }
 function removeRun(number:number){
  if(lock.current||batchJob||!ready||storageConflict)return;
  // Texts deleted from the study are read with the run too; one that no run uses any more goes for good.
  const merged=deleteRun(withRemoved(latest.current,removedNow.current),runsNow.current,number),next=pruneRemoved(merged.docs.filter(d=>!d.removedAt),merged.docs.filter(d=>d.removedAt));
  latest.current=next.docs;removedNow.current=next.removed;runsNow.current=merged.runs;setDocs(next.docs);setRemoved(next.removed);setRuns(merged.runs);setRequests(usedRequests(requestsNow.current,[...next.docs,...next.removed]));
  if(view.run===number||view.compare==='run:'+number)setView(current=>({...current,run:current.run===number?'latest':current.run,compare:current.compare==='run:'+number?'':current.compare}));
 }
 function openText(id:string){setView(current=>({...DEFAULT_VIEW,compare:current.compare,field:current.field}));changeTab('workspace');viewDocument(id);}
 async function download(){try{setExporting(true);const {createResultsWorkbook}=await import('@/lib/export-results');const buffer=await createResultsWorkbook(docs,{answerFields:sentFields,prompt,model,effort,provider,studyName});const blob=new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='annotations.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setNotice('The Excel download failed. Your saved results are still here; please try again.');}finally{setExporting(false);}}

 // Student mode lists every text. Research mode lists the texts the filters leave, as of the chosen run.
 const shown=research?researchRows(docs,columns,view):undefined;
 const rows:(Doc&{compared?:Compared})[]=shown?shown.rows:docs;
 const summaries=research?runSummaries(docs,runs):[];
 // The run buttons act on the ticked texts, else on the texts the filters leave, else on all texts.
 const narrowed=research&&viewNarrowed(view),checkedIds=new Set(checked),shownIds=narrowed?new Set(rows.map(row=>row.id)):undefined;
 const scope=!research?docs:checked.length?docs.filter(d=>checkedIds.has(d.id)):shownIds?docs.filter(d=>shownIds.has(d.id)):docs;
 const scopeOnly=scope.length===docs.length?undefined:new Set(scope.map(d=>d.id));
 // How a run's record names what a start covered.
 const scopeWords=checked.length?{every:'Selected',of:'of the selected texts'}:narrowed?{every:'Shown',of:'of the shown texts'}:{every:'All',of:''};
 const scopeWaiting=scope.filter(d=>d.status==='pending').length;
 // Research mode's run buttons: every text in scope, and those without a result from the current settings.
 const scopeEvery=research?scope.filter(d=>d.status==='pending'||d.status==='error'||d.status==='done'):[];
 // Several annotations per text: the texts of the latest run with fewer than that, which "Remaining" fills in while the settings are unchanged.
 const resume=research&&times>1?resumable(scope,runs,setupNow):new Set<string>();
 const scopeRemaining=research?remainingFor(scope,setupNow,resume):[];
 const compareSource=research?parseSource(view.compare):undefined;
 // Research mode, several annotations per text: the share of them that gave the combined value, shown when not all did.
 const shareTag=(d:Doc,key:string)=>{const share=research&&d.status==='done'?d.consistency?.[key]:undefined;return typeof share==='number'&&share<1?<span className="research-tag warn" title={`${Math.round(share*100)}% of this text’s annotations gave this value`}>{Math.round(share*100)}%</span>:null;};
 const tableFields=research&&view.run!=='latest'?resultColumns(rows,[]):{names:resultNames,showLegacy:showLegacyScore};
 const done=docs.filter(d=>d.status==='done').length,waiting=docs.filter(d=>d.status==='pending').length,current=rows.find(d=>d.id===selected)||docs.find(d=>d.id===selected);
 const canSplit=docs.some(d=>d.status==='pending'&&!d.sourceId&&!d.history?.length&&!d.earlier?.length),canRestore=restorableSourceIds(docs).size>0;
 const resultStart=Math.min(resultPage,Math.max(0,Math.ceil(rows.length/100)-1))*100;
 // Research mode: the details step through the texts shown (Previous and Next), turning the page of results with them.
 const currentAt=research&&current?rows.findIndex(d=>d.id===current.id):-1,stepTo=(to:number)=>{const next=rows[to];if(next){setSelected(next.id);setResultPage(Math.floor(to/100));}};
 // The prompt version of each run, for a result's technical details.
 const promptVersions=new Map(summaries.map(summary=>[summary.number,summary.promptVersion]));
 useEffect(()=>{const index=rows.findIndex(item=>item.id===selected);if(index>=0)setResultPage(Math.floor(index/100));},[selected]);
 const researchData=research&&(activeTab==='runs'||activeTab==='export');
 const datasets=researchData?[{kind:'texts' as const,rows:withRemoved(docs,removed),runs,columns,samples,requests,scoreScale},{kind:'knowledge' as const,rows:knowledgeRows(knowledgeData?.items||[]),runs:[],columns:knowledgeData?.columns||[],samples:knowledgeData?.samples||[],requests:knowledgeData?.requests,scoreScale:knowledgeData?.scoreScale}]:[];
 // The whole study as a backup file (Export tab): both workspaces as they are now, never an API key.
 const studyBackup=draftRef?async()=>{const {texts,knowledge}=draftRef.current;if(!texts||!knowledge)throw new Error('Wait for both workspaces to finish opening');const {encodeStudyBackup}=await import('@/lib/study-backup');return encodeStudyBackup({name:studyName||'Study',texts,knowledge,createdAt:new Date().toISOString()});}:undefined;
 const setupDefaults={prompt,setPrompt,ready,workspaceLocked,busy};
 // "Preview request" (research mode): the request a run would send for the first text.
 const previewSource=()=>({settings:{provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,requestSettings:sentRequest,batch:processing==='batch',inserts:insertNames.length>0},document:async()=>{
  const first=docs[0];if(!first)return undefined;
  const inserts=insertMap(prompt,insertValues(insertNames,first,columns));
  if(/\.pdf$/i.test(first.file.name))return {filename:first.file.name,pdf:true as const,inserts};
  const {extractText}=await import('@/lib/extract-text');return {filename:first.file.name,text:await extractText(first.file),inserts};
 }});
 function renderProcessingOptions(){
  return <section className="processing-options" aria-label="Processing options">
   <button type="button" className="processing-options-toggle" aria-expanded={showProcessing} aria-controls="processing-options-settings" onClick={()=>setShowProcessing(v=>!v)}>
    <span className="processing-options-title">Processing options <span aria-hidden="true">{showProcessing?'▴':'▾'}</span></span>
    <span className="processing-options-summary">{processing==='batch'?'Batch':`Instant · ${parallel===1?'one at a time':`${parallel} at a time`}`} · {docs.some(d=>d.sourceId)?'Chunked texts':'No chunking'}{requestSummary(sentRequest).map(part=>' · '+part).join('')}{times>1?` · ${times} annotations per text`:''}</span>
   </button>
   {showProcessing&&<div id="processing-options-settings" className="processing-options-settings"><button type="button" className="textbutton chunking-toggle" aria-expanded={showChunking} aria-controls="chunking-settings" disabled={workspaceLocked||!ready} onClick={()=>setShowChunking(v=>!v)}>Split into chunks{showChunking?' ▴':' ▾'}</button>{showChunking&&<div id="chunking-settings" className="chunking-panel"><p>Choose a word-count target and boundary method. Each chunk gets its own annotation and result.</p><label htmlFor="chunk-method">Chunk boundaries</label><select id="chunk-method" value={chunkMethod} disabled={workspaceLocked||!ready} onChange={e=>setChunkMethod(e.target.value as typeof chunkMethod)}><option value="sentences">Prefer whole sentences</option><option value="exact-words">Exact word counts</option></select><label htmlFor="chunk-words">Target words per chunk</label><input id="chunk-words" type="number" inputMode="numeric" min="1" max="1000000" step="1" value={chunkWords} disabled={workspaceLocked||!ready||storageConflict} onChange={e=>setChunkWords(e.target.value)} aria-describedby="chunking-help"/><p id="chunking-help" className="hint">{chunkMethod==='sentences'?'Keep sentences together where possible; chunk lengths are approximate.':'Split at exact word counts; boundaries may fall within a sentence.'}</p><details className="hint"><summary>How splitting works</summary><p>{chunkMethod==='sentences'?'Uses native English sentence segmentation and paragraph boundaries. A sentence longer than the target is split at exact word counts; text without sentence punctuation uses the same fallback. Abbreviations can be ambiguous, so review the chunks.':'The final chunk may be shorter than the target.'} Words are whitespace-separated runs. Text order and every character of the extracted text are preserved, with no overlap. Shorter documents stay whole. Documents with results or previous attempts are kept unchanged. PDF chunks use extracted text, without images or OCR.</p></details><div className="chunking-actions"><Button variant="outline" disabled={workspaceLocked||exporting||!ready||storageConflict||!canSplit||!validChunkWords(Number(chunkWords))} onClick={splitDocuments}>{splitting?'Preparing chunks…':'Split ready documents'}</Button>{canRestore&&<button type="button" className="textbutton" disabled={workspaceLocked||exporting||!ready||storageConflict} onClick={restoreDocuments}>Restore whole documents</button>}</div><p className="hint">Review chunks by clicking their names. Each chunk is a separate annotation; provider charges apply.</p></div>}{!research&&<div className="processing-choice"><label htmlFor="processing-mode">Processing</label><select id="processing-mode" value={processing} disabled={workspaceLocked||!ready} onChange={e=>setProcessing(e.target.value)}><option value="instant">Instant</option><option value="batch" disabled={provider==='openrouter'}>Batch · 50% lower token costs</option></select></div>}{processing==='instant'&&<><div className="processing-choice"><label htmlFor="annotation-concurrency">Parallel annotations</label><select id="annotation-concurrency" value={parallel} disabled={workspaceLocked||!ready||storageConflict} aria-describedby="parallel-help" onChange={e=>setConcurrency(annotationConcurrency(Number(e.target.value),research))}>{concurrencyChoices(research).map(n=><option key={n} value={n}>{n===1?'Off · one at a time':`${n} at a time`}</option>)}</select></div><p id="parallel-help" className="hint batch-explainer">{research?'A run can annotate up to 128 texts at once. Each text gets a separate request; token prices are unchanged. When the provider reports a rate limit, the run waits and goes on with fewer at a time. Annotate next always runs one text.':'Run all can annotate several texts at once. Each text gets a separate request; token prices are unchanged. Speed depends on your provider’s rate limits. Annotate next always runs one text.'}</p></>}{research&&<><div className="processing-choice"><label htmlFor="annotation-repeats">Annotations per text</label><select id="annotation-repeats" value={repeats} disabled={workspaceLocked||!ready||storageConflict} aria-describedby="repeats-help" onChange={e=>setRepeats(cleanRepeats(Number(e.target.value))??1)}>{Array.from({length:MAX_REPEATS},(_,i)=>i+1).map(n=><option key={n} value={n}>{n===1?'1 · each text once':n}</option>)}</select></div><p id="repeats-help" className="hint batch-explainer">{repeatsHint(repeats,sentSettings,'text')}</p></>}{research&&<ResearchRequestOptions provider={provider} model={model} effort={effort} prompt={prompt.trim()?prompt+answerInstructions(sentFields,sentSettings):''} fixed={promptFixed} value={requestSettings} disabled={workspaceLocked||!ready||storageConflict} onChange={setRequestSettings}/>}{processing==='batch'&&!batchJob&&!research&&<p className="hint batch-explainer">Results arrive later, usually within 24 hours. After submission is saved, you can close this page and return in the same browser to collect them. {BATCH_CAPACITY} {provider==='gemini'?'Gemini inline requests also have an 18 MB prepared-request limit.':''}</p>}</div>}
  </section>;
 }
 function saveChartYears(years:Map<string,number|null>){
  setDocs(current=>current.map(doc=>years.has(doc.id)?{...doc,chartYear:years.get(doc.id)}:doc));
 }
 function saveChartGroups(groups:Map<string,string|null>){
  setDocs(current=>current.map(doc=>groups.has(doc.id)?{...doc,chartGroup:groups.get(doc.id)}:doc));
 }
 function renderSetup(options?:KnowledgeSetup){
  const prompt=options?.prompt??setupDefaults.prompt,setPrompt=options?.setPrompt??setupDefaults.setPrompt,ready=options?options.ready&&setupDefaults.ready:setupDefaults.ready,workspaceLocked=options?options.locked:setupDefaults.workspaceLocked,busy=options?options.locked:setupDefaults.busy;
  const names=options?.answerFields??answerFields,changeNames=options?.setAnswerFields??setAnswerFields;
  const fieldSettings=options?options.answerSettings:answerSettings,changeSettings=options?.setAnswerSettings??setAnswerSettings;
  // Settings of a field go when the field does, so a later field of the same name starts plain.
  const keepSettings=(next:string[])=>cleanAnswerSettings(fieldSettings&&{...fieldSettings,fields:fieldSettings.fields?.filter(field=>next.some(name=>name.toLowerCase()===field.name.toLowerCase()))});
  const errors=setupErrors(provider,key,prompt,model,effort),showErrors=options?.validationRequested||setupChecked;
  // The standard Lab's model menu. Research mode's menu adds the account's other models and any model ID.
  const modelCell=<div><label>Model</label><Select value={model} onValueChange={chooseModel} disabled={workspaceLocked||!ready}><SelectTrigger aria-label="Model" title={modelLabel(model)}><SelectValue>{modelLabel(model)}</SelectValue></SelectTrigger><SelectContent>{provider==='openrouter'?['Economical starting points','More capable comparison models'].map((label,index)=><SelectGroup key={label}><SelectLabel>{label}</SelectLabel>{config.models.filter(m=>OPENROUTER_STARTER_MODELS.includes(m)===(index===0)).map(m=><SelectItem value={m} key={m} textValue={modelLabel(m)}>{modelLabel(m)}</SelectItem>)}</SelectGroup>):config.models.map(m=><SelectItem value={m} key={m} textValue={modelLabel(m)}><span>{modelLabel(m)}</span><span className={'model-access-badge '+(modelAccessLabel(provider,m).startsWith('Free')?'free':'paid')}>{modelAccessLabel(provider,m)}</span></SelectItem>)}</SelectContent></Select></div>;
  // A model outside the Lab's lists (research mode) has no description of the Lab's.
  const listedModel=isListedModel(provider,model),modelNote=research?(listedModel?modelFacts(provider,model):'A model outside the Lab’s list.'+(typedPrice?' Its cost is estimated with your own price.':priceFor(provider,model)?'':' The Lab has no price for it; type one under Processing options to have its cost estimated.')):listedModel?modelHint(provider,model):'This study uses a model chosen in research mode. Choose a model here to replace it.';
  // Research mode: "Preview request" stands beside the heading. The standard Lab has the heading alone.
  const heading=<h2 id={options?"knowledge-setup":"workspace"} tabIndex={-1}><span className="step">01</span> Set up your study</h2>,preview=research?(options?options.preview:<ResearchRequestPreview unit="text" source={previewSource} disabled={!ready}/>):null;
  return <aside className="panel setup">{preview?<div className="research-setup-head">{heading}{preview}</div>:heading}{<><label>Provider</label><Select value={provider} onValueChange={chooseProvider} disabled={workspaceLocked||!ready}><SelectTrigger aria-label="Provider"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>{GEMINI_ENABLED&&<SelectItem value="gemini">Google (Gemini)</SelectItem>}<SelectItem value="anthropic">Anthropic (Claude)</SelectItem><SelectItem value="openrouter">OpenRouter</SelectItem></SelectContent></Select></>}{research?<><label>{config.label} API key</label><p className="research-key-line">{key.trim()?<span className="key-set">Key added{rememberKeys?' · remembered in this browser':' · kept until this tab closes'}</span>:<span className="key-missing">No key yet</span>}<button type="button" className="textbutton" onClick={()=>setKeysOpen(true)}>{key.trim()?'Change':'Add a key'}</button></p>{errors.key&&(showErrors||key.trim())&&<p className="message" role="alert">{errors.key}</p>}{!errors.key&&<ProviderKeyStatus value={keyCheck}/>}</>:<><label htmlFor={options?"knowledge-key":"key"}>{config.label} API key</label><input id={options?"knowledge-key":"key"} type="password" value={key} onChange={e=>setKey(e.target.value)} placeholder="Paste your API key" autoComplete="off" disabled={(options?.keyLocked??busy)||!ready}/>{errors.key&&(showErrors||key.trim())&&<p className="message" role="alert">{errors.key}</p>}{!errors.key&&<ProviderKeyStatus value={keyCheck}/>}<p className="hint">Sent directly from your browser to {config.label}; never saved. Re-enter after reloading or reopening. <a href={config.keyUrl} target="_blank" rel="noreferrer">Create a key ↗</a></p></>}<div className="pair model-settings">{research?<ResearchModel fallback={modelCell} provider={provider} model={model} apiKey={keyRejected?'':key} disabled={workspaceLocked||!ready} onChange={chooseModel} onModels={setAccountModels}/>:modelCell}<div><label>{reasoningLabel(provider,model)}</label><Select value={effort} onValueChange={setEffort} disabled={workspaceLocked||!ready}><SelectTrigger aria-label={reasoningLabel(provider,model)}><SelectValue/></SelectTrigger><SelectContent>{efforts.map(m=><SelectItem value={m} key={m} title={/^\d+$/.test(m)?`${m} thinking tokens`:undefined}>{reasoningOptionLabel(m)}</SelectItem>)}</SelectContent></Select></div></div>{showErrors&&errors.model&&<p className="message" role="alert">{errors.model}</p>}{modelNote&&<p className="hint" aria-live="polite">{modelNote}</p>}<label htmlFor={options?"knowledge-prompt":"prompt"}>Annotation prompt</label><textarea id={options?"knowledge-prompt":"prompt"} maxLength={100000} value={prompt} onChange={e=>setPrompt(e.target.value)} disabled={workspaceLocked||!ready} placeholder={research?'Annotation instructions: define the score or category and how it is assigned.':'Paste your course prompt or your own annotation instructions here. Define the score or category and how it should be assigned.'}/>{showErrors&&errors.prompt&&<p className="message" role="alert">{errors.prompt}</p>}{research&&insertNotes(prompt,options?options.columns||[]:columns,options?'subject':'text').map(note=><p className="hint prompt-inserts" key={note}>{note}</p>)}{!research&&<div className="under"><button className="textbutton" disabled={workspaceLocked||!ready} onClick={()=>{if(!prompt||confirm('Replace your prompt with the example?'))setPrompt(options?KNOWLEDGE_SAMPLE:SAMPLE);}}>Use a simple example</button></div>}<SavedPrompts disabled={workspaceLocked||!ready} prompt={prompt} answerFields={names} answerSettings={fieldSettings} onUse={(value,fields,settings)=>{setPrompt(value);changeNames(fields);changeSettings(settings);}}/>{options&&<p className="hint">The model is instructed to report INSUFFICIENT_KNOWLEDGE when it cannot assess a subject.</p>}{research?<ResearchAnswerFields names={names} settings={fieldSettings} onChange={(next,settings)=>{changeNames(next);changeSettings(settings);}} disabled={workspaceLocked||!ready} scale={options?options.scoreScale:scoreScale} onScaleChange={options?options.setScoreScale:setScoreScale}/>:<><AnswerFields names={names} onChange={next=>{changeNames(next);if(fieldSettings)changeSettings(keepSettings(next));}} disabled={workspaceLocked||!ready}/>{fieldSettings&&<p className="hint" role="note">{fieldSettings.plain?'This study asks for plain-text replies, set in research mode; the answer fields above are not used.':'These answer fields have types or other settings from research mode, which still apply here.'} Switch to research mode to change this.</p>}</>}{options?options.extraSetup:renderProcessingOptions()}</aside>;
 }
 // The estimate covers the texts waiting; in research mode, what "Remaining" would annotate (other completed texts only inform it).
 const remainingIds=new Set(scopeRemaining.map(d=>d.id));
 const estimateRows=!research?docs:[...scope.map(d=>remainingIds.has(d.id)&&d.status!=='pending'?{...d,status:'pending'}:d),...(scopeOnly?docs.filter(d=>d.status==='done'&&!scopeOnly.has(d.id)):[])];
 // How many requests a text in the estimate gets: one per annotation, or only the missing ones of a text already begun.
 const requestsFor=times>1?(row:{id:string})=>resume.has(row.id)?missingRepeats(row).length:times:undefined;
 const costEstimate=<CostEstimate rows={docs} research={research} disabled={!ready} batch={processing==='batch'} revision={JSON.stringify([provider,model,effort,prompt,sentFields,sentSettings,processing,docs.map(d=>[d.id,d.status,d.usage,...(d.annotations?[d.annotations.length]:[])]),research?scopeRemaining.map(d=>d.id):0,...(sentRequest?[sentRequest]:[]),...(times>1?[times]:[]),...(typedPrice?[typedPrice]:[])])} load={signal=>studentEstimate({provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,rows:estimateRows,cache:Boolean(sentRequest?.cache),maxOutput:sentRequest?.maxOutput,batch:processing==='batch',times:requestsFor,ownPrice:typedPrice,research,signal})} canCountInputs={!keyRejected&&provider!=='openrouter'&&Boolean(key.trim())&&!workspaceLocked} countInputs={provider==='openrouter'?undefined:(signal,onProgress)=>countStudentInputs({provider,model,effort,prompt,answerFields:sentFields,answerSettings:sentSettings,rows:estimateRows,cache:Boolean(sentRequest?.cache),maxOutput:sentRequest?.maxOutput,batch:processing==='batch',times:requestsFor,ownPrice:typedPrice,research,apiKey:key,signal,onProgress})}/>;
 const hasResults=docs.some(row=>row.status==='done'||row.status==='error'||Boolean(row.history?.length)),clearLocked=workspaceLocked||exporting||!ready||storageConflict;
 const resultButtons=<><ResultsChart rows={rows} onInspect={viewDocument} onSaveYears={saveChartYears} onSaveGroups={saveChartGroups}/><Button className="export" variant="outline" disabled={!docs.length||exporting||splitting||adding} onClick={download}><Download size={16}/>{exporting?'Preparing Excel…':'Download Excel'}</Button></>;
 return <main><header className={research?'research-header':undefined}><div className="brand"><img className="brand-icon" src="/favicon.svg?v=58" width="40" height="40" alt=""/><div className="brandtext"><span>Text Annotation Lab</span><small>Department of English &amp; American Studies Center Aarhus · Aarhus University</small></div></div><div className="header-study-actions">{studyControls}{research&&<ResearchKeys keyring={keyring} remember={rememberKeys} provider={provider} open={keysOpen} onOpenChange={setKeysOpen} onSave={saveKeys} disabled={annotating||batchBusy||knowledgeBusy}/>}<span className="saved" role="status">{showSaved?<><Check size={15}/>Autosaved in this browser</>:workingCopyStatus}</span><ModeSwitch on={research} onChange={toggleResearch}/></div></header><Tabs value={activeTab} onValueChange={changeTab} aria-busy={tabLoading||undefined}><TabsList className="study-tabs" aria-label="Text Annotation Lab sections"><TabsTrigger value="workspace">Workspace</TabsTrigger>{research&&<TabsTrigger value="runs">Runs &amp; agreement{summaries.length>0&&<span className="tab-count"><span>{summaries.length}</span></span>}</TabsTrigger>}{research&&<TabsTrigger value="export">Export</TabsTrigger>}{!research&&<TabsTrigger value="get-started">Get started{startHint&&!docs.length&&<span className="start-hint"><ArrowLeft size={13} aria-hidden="true"/>New? Start here</span>}</TabsTrigger>}{!research&&<TabsTrigger value="tips">Prompting tips</TabsTrigger>}{!research&&<TabsTrigger value="corpus">Corpus examples</TabsTrigger>}{!research&&<TabsTrigger value="study-example">Study example</TabsTrigger>}{!research&&<TabsTrigger value="resources">Further resources</TabsTrigger>}<TabsTrigger value="about">About</TabsTrigger><TabsTrigger value="model-knowledge" className="experimental-tab"><FlaskConical size={16} aria-hidden="true"/>Model knowledge <span className="experimental-nav-label">Experimental</span></TabsTrigger></TabsList><TabsContent value="workspace" forceMount className="workspace-tab"><div className="workspace">{renderSetup()}<section className="panel queue"><div className="sectionhead"><h2><span className="step">02</span> Add your documents</h2><span className="count">{docs.length} texts</span></div><label className={'upload '+(workspaceLocked?'disabled':'')}><Upload size={24}/><strong>Choose documents</strong><span>{research?'One text per file (PDF, DOCX, TXT, MD, HTML, RTF · up to 20 MB each) or a whole corpus as a table (CSV, TSV, XLSX, JSON, JSONL)':'Upload one file per text you want to annotate. PDF, DOCX, TXT, MD, HTML, RTF · up to 20 MB each'}</span><input type="file" aria-label="Choose documents" multiple accept={research?'.txt,.md,.pdf,.docx,.html,.htm,.rtf,.csv,.tsv,.xlsx,.json,.jsonl':'.txt,.md,.pdf,.docx,.html,.htm,.rtf'} disabled={workspaceLocked||!ready||storageConflict} onChange={e=>{const operation=research?addChosen(Array.from(e.target.files||[])):add(e.target.files);e.target.value='';return operation;}}/></label>{pendingImport&&<div className="message" role="group" aria-label="Duplicate documents"><p>{pendingImport.duplicates} duplicate {pendingImport.duplicates===1?'file':'files'} found in this selection or the queue.</p><details><summary>More information</summary><p>Matches have the same name and identical bytes. Keep all for separate annotations of the same document, or exclude the matches. Existing documents stay unchanged.</p></details><div className="actions"><Button onClick={()=>commitDocuments(pendingImport.validFiles,pendingImport.summary)}>Keep all selected files</Button><Button variant="outline" onClick={()=>commitDocuments(pendingImport.accepted,pendingImport.summary)}>Exclude duplicate files</Button><Button variant="outline" onClick={()=>{setPendingImport(null);setNotice('Import canceled; no selected files added.');}}>Cancel import</Button></div></div>}{research&&<ResearchTools rows={docs} removed={removed} fields={studyFields} columns={columns} samples={samples} unit="text" disabled={workspaceLocked||!ready||storageConflict} onApply={applyResearch} lead={costEstimate} onAddTexts={addTexts} tableFile={tableFiles[0]} onTableDone={()=>setTableFiles(queue=>queue.slice(1))}/>}<div className="actions">{research?<><span className="research-run-group"><Button disabled={workspaceLocked||!scopeWaiting||!ready||storageConflict||keyRejected} onClick={()=>run(false,scopeOnly)} title="Annotate one text instantly">Annotate next <ArrowRight size={16}/></Button><span className="research-try"><Button variant="outline" disabled={workspaceLocked||!scope.length||!ready||storageConflict||keyRejected} onClick={trySample} title="Annotate this many texts, picked at random, instantly">Random sample of</Button><input type="number" inputMode="numeric" min={1} aria-label="Number of texts in the random sample" value={tryCount} disabled={workspaceLocked||!ready} onChange={e=>setTryCount(e.target.value)}/></span></span><span className="research-run-divider" aria-hidden="true"/><span className="research-run-group"><span className="research-seg" role="radiogroup" aria-label="How to run"><button type="button" role="radio" aria-checked={processing!=='batch'} disabled={workspaceLocked||!ready} onClick={()=>setProcessing('instant')} title="Send the requests now and see results as they arrive">Now</button><button type="button" role="radio" aria-checked={processing==='batch'} disabled={workspaceLocked||!ready||provider==='openrouter'} onClick={()=>setProcessing('batch')} title={provider==='openrouter'?'Batch processing is not available through OpenRouter':'Submit as a batch: about half the price, results arrive later'}>Batch · ½ price</button></span><Button variant="outline" disabled={workspaceLocked||!scopeEvery.length||!ready||storageConflict||keyRejected} onClick={runEvery} title={processing==='batch'?'Submit every text as a batch. Texts that already have a result are annotated again as a new run; existing results are kept.':'Annotate every text now. Texts that already have a result are annotated again as a new run; existing results are kept.'}><Play size={15}/>All ({scopeEvery.length.toLocaleString('en-US')})</Button><Button variant="outline" disabled={workspaceLocked||!scopeRemaining.length||!ready||storageConflict||keyRejected} onClick={runRemaining} title="Annotate the texts that have no result from the current prompt, model, reasoning effort, and answer fields"><Play size={15}/>Remaining ({scopeRemaining.length.toLocaleString('en-US')})</Button></span></>:<><Button disabled={workspaceLocked||!waiting||!ready||storageConflict||keyRejected} onClick={()=>run(false)} title="Annotate one text instantly to test your prompt">Annotate next <ArrowRight size={16}/></Button><Button variant="outline" disabled={workspaceLocked||!waiting||!ready||storageConflict||keyRejected} onClick={()=>processing==='batch'?submitBatch():run(true)}><Play size={15}/>{processing==='batch'?`Submit batch (${waiting})`:`Run all (${waiting})`}</Button></>}{annotating&&<Button variant="outline" onClick={()=>{stop.current=true;setNotice('Pausing after active annotations finish. No new texts will start.');}}><Pause size={15}/>Pause</Button>}{docs.some(d=>d.status==='error')&&<Button variant="outline" disabled={workspaceLocked||!ready||storageConflict} onClick={()=>retry()}>Queue failed items for retry</Button>}{!research&&docs.length>0&&<div className="clear-actions">{hasResults&&<Button variant="outline" disabled={clearLocked} onClick={clearResults}>Clear results</Button>}<Button type="button" variant="outline" className="clear-workspace" disabled={clearLocked||!docs.length} onClick={clearWorkspace}>Clear workspace</Button></div>}{!research&&resultButtons}</div>{annotating&&<p className="hint run-guidance" role="status">Keep this page open while running.</p>}{research&&processing==='batch'&&!batchJob&&<p className="hint run-guidance">Batch: All and Remaining submit the texts as one batch at about half the token price. Results arrive later, usually within 24 hours. After submission is saved, you can close this page and return in the same browser to collect them. {BATCH_CAPACITY} {provider==='gemini'?'Gemini inline requests also have an 18 MB prepared-request limit.':''}</p>}{research&&scopeOnly&&<p className="hint run-guidance" role="status">The run buttons apply to the {scope.length.toLocaleString('en-US')} {checked.length?'selected':'shown'} {scope.length===1?'text':'texts'}.</p>}{!research&&<SettingsNotice rows={docs} current={{provider,model,effort,prompt,answerFields}}/>}{!research&&costEstimate}{batchJob&&<div className="batch-status" role="status"><div><strong>{batchBusy?(batchJob.state==='submitting'?'Submitting batch…':'Contacting provider…'):batchJob.state==='ready'?'Batch ready to collect':batchJob.state==='unknown'?'Batch needs checking':'Batch processing'}</strong><span>{batchJob.docIds.length} texts{batchJob.repeats?` · ${batchJob.repeats} annotations per text`:''} · {modelLabel(batchJob.model)}{batchJob.completed!==undefined?` · ${batchJob.completed} processed`:''}</span></div>{batchJob.id&&<Button variant="outline" disabled={busy||storageConflict} onClick={()=>manageBatch(batchJob.state==='ready'?'collect':'check')}>{batchJob.state==='ready'?'Collect results':'Check status'}</Button>}<details className="batch-details"><summary>Batch details</summary><p>Submitted: {new Date(batchJob.createdAt).toLocaleString()}. {research?`Collecting the results needs the ${PROVIDERS[batchJob.provider].label} API key of the account that submitted this batch.`:`Re-enter your ${PROVIDERS[batchJob.provider].label} API key if you return later. Keys are never saved.`}</p><p className="batch-reference">{batchJob.id||batchJob.runId}</p>{!batchJob.id&&<><label htmlFor="recover-batch">Batch ID from your provider’s console</label><input id="recover-batch" value={recoverId} onChange={e=>setRecoverId(e.target.value)} placeholder={batchJob.provider==='openai'?'batch_…':batchJob.provider==='anthropic'?'msgbatch_…':'batches/…'}/><Button variant="outline" disabled={busy||!recoverId.trim()||storageConflict} onClick={()=>manageBatch('check',recoverId)}>Recover batch</Button><button className="textbutton" disabled={busy||storageConflict} onClick={releaseUnconfirmedBatch}>No batch to recover</button></>}{batchJob.id&&batchJob.state!=='ready'&&<button className="textbutton" disabled={busy||storageConflict} onClick={()=>manageBatch('cancel')}>Cancel batch</button>}</details></div>}{(docs.length>0||splitting||adding||batchBusy)&&<><div className="progressline" aria-live="polite"><span>{[splitting?'Preparing chunks…':adding?'Checking documents…':batchBusy?'Contacting provider…':'',queueSummary(docs)].filter(Boolean).join(' · ')}</span></div><Progress aria-label="Annotation progress" value={docs.length?done/docs.length*100:0}/></>}{storageIssue&&<div className="message" role="alert">{storageIssue}</div>}{notice&&<div className={isPlainConfirmation(notice)||notice===plainNotice.current?'message info':'message'} role="status">{notice}</div>}{!research&&docs.some(d=>d.status==='done')&&<p className="hint result-hint">Select a row to compare the model’s explanation with the source text.</p>}{research&&docs.length>0&&<ResearchFilters view={view} onChange={next=>{setView(next);setResultPage(0);}} columns={columns} rows={docs} runs={summaries} fields={shown?.fields||[]} field={shown?.field||''} shown={rows.length} total={docs.length} checked={checked.length} onClearChecked={()=>setChecked([])} actions={resultButtons} menu={[...(hasResults?[{label:'Clear results…',disabled:clearLocked,onSelect:clearResults}]:[]),{label:checked.length?`Delete ${checked.length.toLocaleString('en-US')} selected ${checked.length===1?'text':'texts'}…`:'Delete selected texts…',danger:true,disabled:clearLocked||!checked.length,onSelect:()=>deleteTexts(checked,'selected')},{label:'Delete all texts…',danger:true,disabled:clearLocked||!docs.length,onSelect:()=>deleteTexts(docs.map(d=>d.id),'all')},{label:'Clear workspace…',danger:true,disabled:clearLocked,onSelect:clearWorkspace}]}/>}<ResultPages total={rows.length} page={resultPage} onPageChange={page=>{setResultPage(page);setSelected('');}}/><div className="results"><Table><TableHeader><TableRow>{research&&<TableHead className="research-check-cell"><input type="checkbox" aria-label="Select all shown texts" checked={rows.length>0&&rows.every(row=>checkedIds.has(row.id))} onChange={e=>setChecked(e.target.checked?rows.map(row=>row.id):[])}/></TableHead>}<TableHead>Document</TableHead><TableHead>Status</TableHead>{tableFields.showLegacy?<TableHead>Score / category</TableHead>:null}{tableFields.names.map(name=><TableHead key={name}>{name}</TableHead>)}{research&&summaries.length>0&&<TableHead>Run</TableHead>}{compareSource&&<TableHead>{compareSource.kind==='run'?'Run #'+compareSource.run:compareSource.name}</TableHead>}</TableRow></TableHeader><TableBody>{rows.slice(resultStart,resultStart+100).map(d=><TableRow key={d.id} id={'document-row-'+d.id} className={'annotation-row '+(selected===d.id?'active':'')} tabIndex={0} aria-label={'View '+(d.status==='done'?'annotation and explanation':'document details')+' for '+d.name} aria-selected={selected===d.id} aria-controls="annotation-detail" title="Click to view details below" onClick={()=>viewDocument(d.id)} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();viewDocument(d.id);}}}>{research&&<TableCell className="research-check-cell" onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={'Select '+d.name} checked={checkedIds.has(d.id)} onChange={e=>setChecked(current=>e.target.checked?[...current.filter(id=>id!==d.id),d.id]:current.filter(id=>id!==d.id))}/></TableCell>}<TableCell><button className="docbutton" onClick={()=>viewDocument(d.id)}>{d.name}</button></TableCell><TableCell><span className={'status '+d.status+(research&&incomplete(d)?' partial':'')}>{d.status==='done'?(research&&incomplete(d)?(count=>`${count?.ok} of ${count?.of} annotations`)(annotationCount(d)):'Complete'):d.status==='pending'?'Ready':d.status==='error'?'Needs attention':d.status==='queued'?'In batch':'Working…'}</span></TableCell>{tableFields.showLegacy?<TableCell>{d.score||'—'}{shareTag(d,'score')}</TableCell>:null}{tableFields.names.map(name=><TableCell key={name}><span className="answer-cell">{resultAnswer(d,name)||'—'}</span>{shareTag(d,'f'+(d.answerFields?.indexOf(name)??-1))}</TableCell>)}{research&&summaries.length>0&&<TableCell className="research-run-cell">{(tag=>tag?<span title={tag.earlier?`Waiting to be annotated again; the latest result is from run #${tag.run}`:undefined}>{tag.earlier?`(#${tag.run})`:`#${tag.run}`}</span>:'—')(runTag(d))}</TableCell>}{compareSource&&<TableCell><span className={'research-compare '+(d.compared?.match===true?'match':d.compared?.match===false?'differ':'')}>{d.compared?.other||'—'}</span></TableCell>}</TableRow>)}</TableBody></Table></div>{!docs.length&&<div className="empty"><BookOpen size={34}/><p>{research?'No documents yet.':'Add a few documents, then annotate your first text.'}</p></div>}{research&&docs.length>0&&!rows.length&&<p className="hint" role="status">No texts match these filters.</p>}{current&&<div id="annotation-detail" className="detail" tabIndex={-1} role="region" aria-label="Selected document details" onKeyDown={research?event=>stepKey(event,currentAt,rows.length,stepTo):undefined}><button type="button" className="textbutton" onClick={()=>{const row=document.getElementById('document-row-'+current.id);row?.focus();row?.scrollIntoView({block:'nearest'});}}>Back to selected row</button>{research&&<DetailSteps index={currentAt} total={rows.length} onStep={stepTo}/>}<h3>{current.name}</h3>{current.sourceId&&<><p className="hint">Source: {current.sourceName} · Chunk {current.chunkIndex} of {current.chunkCount} · Words {current.wordStart}–{current.wordEnd}</p></>}{current.error&&<p className="message" role="alert">{current.error}</p>}{current.rawResponse&&<details><summary>View returned response</summary><pre>{current.rawResponse}</pre></details>}{(current.explanation||current.answers)?<><NamedAnswerDetail row={current}/><span className="resultscore">{current.score}</span>{hasSeparateExplanation(current)&&<p>{current.explanation}</p>}<small>{current.model} · {current.tokens?.toLocaleString()} tokens</small></>:!current.error?<p>The explanation will appear here after annotation.</p>:null}{research&&<ResearchDetail row={current} columns={columns} study={{kind:'texts',requests,versions:promptVersions}}/>}<SourceTextPreview key={current.id} file={current.file} chunk={Boolean(current.sourceId)}/>{current.history?.length&&<details><summary>Previous failed attempts ({current.history.length})</summary>{current.history.map((attempt,i)=><div key={i}><p>Attempt {i+1}: {attempt.error} · {attempt.model}</p><pre>{attempt.prompt}</pre></div>)}</details>}{current.status==='error'&&!workspaceLocked&&<Button variant="outline" onClick={()=>retry(current.id)}>Queue for retry</Button>}{current.status==='pending'&&!current.earlier?.length&&!workspaceLocked&&<button className="textbutton" onClick={research?()=>deleteTexts([current.id],'one'):()=>setDocs(d=>d.filter(x=>x.id!==current.id))}>Remove document</button>}</div>}</section></div></TabsContent><TabsContent value="model-knowledge" forceMount className="workspace-tab"><ModelKnowledge draftRef={draftRef} keyRejected={keyRejected} studyId={studyId} studyName={studyName} onStudyReady={setKnowledgeSaved} onSaveStateChange={setKnowledgeSaveState} provider={provider} model={model} effort={effort} apiKey={key} parentLocked={annotating||splitting||adding||Boolean(pendingImport)||batchBusy||Boolean(batchJob)||!ready||storageConflict} renderSetup={renderSetup} onBusyChange={setKnowledgeBusy} research={research} onResearchData={research?setKnowledgeData:undefined}/></TabsContent>{research&&<TabsContent value="runs" className="research-panel panel"><ResearchRuns datasets={datasets} studyName={studyName} locked={workspaceLocked||!ready||storageConflict} onShowRun={showRun} onDeleteRun={removeRun} onOpenText={openText} onRenameRun={renameRun} onRetryRun={retryRun}/></TabsContent>}{research&&<TabsContent value="export" className="research-panel panel"><ResearchExport datasets={datasets} studyName={studyName} lab={LAB_VERSION} backup={studyBackup}/></TabsContent>}<ReadingPanels section={activeTab}/></Tabs><footer><div><strong>Text Annotation Lab</strong><span>Developed for teaching and research in the <a href="https://cc.au.dk/en/english" target="_blank" rel="noreferrer">Department of English</a> at Aarhus University. Open to anyone who finds it useful.</span></div><div className="attribution"><span>Developed for teaching and research by</span><strong>Jens Kjeldgaard-Christiansen</strong><span>Methodological advisor: <a href="https://edgardubourg.fr/" target="_blank" rel="noreferrer">Edgar Dubourg</a></span></div></footer></main>;
}
