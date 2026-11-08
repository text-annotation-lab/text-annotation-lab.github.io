'use client';
import {useEffect, useRef, useState, type ReactNode, type RefObject} from 'react';
import {ChevronDown} from 'lucide-react';
import {Popover, PopoverTrigger, PopoverContent} from '@/components/ui/popover';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {deleteStudy,listStudies,renameStudy,studySnapshot,studyWorkspaceKey,WORKING_STUDY_ID,type Study,type WorkingStudy} from '@/lib/studies';
import {workspaceRevision} from '@/lib/workspace-storage';

type Action='new'|'update'|'load'|'rename'|'delete';
export type OpenStudyDraft = RefObject<{texts?:Record<string,unknown>;knowledge?:Record<string,unknown>}>;
export function StudyManager({children}:{children:(study:Study,controls:ReactNode,onReady:(ready:boolean)=>void,version:number,draftRef:OpenStudyDraft,onRecoveryChange:(available:boolean)=>void)=>ReactNode}){
 const [studies,setStudies]=useState<Study[]>([]),[selected,setSelected]=useState('');
 const [draft,setDraft]=useState<WorkingStudy>({name:'Untitled working copy'}),[version,setVersion]=useState(0);
 const [loaded,setLoaded]=useState(false),[available,setAvailable]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[menuOpen,setMenuOpen]=useState(false);
 const [editing,setEditing]=useState<Action|null>(null),[name,setName]=useState('');
 const [newStudy,setNewStudy]=useState<'confirm'|'save'|null>(null),[saveName,setSaveName]=useState('');
 const backupInput=useRef<HTMLInputElement>(null);
 const menuTrigger=useRef<HTMLButtonElement>(null);
 const target=studies.find(s=>s.id===selected),source=studies.find(s=>s.id===draft.sourceId);
 const draftRef=useRef<OpenStudyDraft['current']>({});
 const [canRecover,setCanRecover]=useState(false);
 const disabled=!available||busy;
 useEffect(()=>{
  let preferredId:string|undefined;try{preferredId=sessionStorage.getItem('annotation-study')||undefined;}catch{}
  studySnapshot('initialize',{preferredId}).then(result=>{setStudies(result.studies);setDraft(result.working);setSelected(result.working.sourceId||result.studies[0]?.id||'');setLoaded(true);}).catch(e=>setError(e.message));
 },[]);
 useEffect(()=>{
  const refresh=()=>{listStudies().then(setStudies).catch(()=>{});};
  window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);
 },[]);
 function begin(action:Action){setEditing(action);setName(action==='rename'?target?.name||'':'');setError('');setMessage('');}
 async function startNewStudy(save:boolean){
  if(disabled)return;
  setBusy(true);setError('');
  try{
   const revisions=[workspaceRevision(studyWorkspaceKey(WORKING_STUDY_ID)),workspaceRevision(studyWorkspaceKey(WORKING_STUDY_ID,true))];
   const result=await studySnapshot(save?'save-and-blank':'blank',{name:saveName,revisions});
   setStudies(result.studies);setDraft(result.working);setSelected(result.studies[0]?.id||'');
   setAvailable(false);setVersion(v=>v+1);setNewStudy(null);setMenuOpen(false);
  }catch(e){setError(e instanceof Error?e.message:'Could not start a new study. Your current work is unchanged.');}
  finally{setBusy(false);}
 }
 async function submit(){
  if(disabled||!editing)return;
  setBusy(true);setError('');setMessage('');
  try{
   if(editing==='rename'){
    setStudies(await renameStudy(selected,name));setMessage('Study renamed.');
   }else if(editing==='delete'){
    const items=await deleteStudy(selected);setStudies(items);setSelected(items[0]?.id||'');setMessage('Saved study deleted. Your current work is still open.');
   }else{
    const revisions=[workspaceRevision(studyWorkspaceKey(WORKING_STUDY_ID)),workspaceRevision(studyWorkspaceKey(WORKING_STUDY_ID,true))];
    const action=editing==='new'?'save-new':editing;
    const result=await studySnapshot(action,{id:editing==='update'?draft.sourceId:selected,name,revisions});
    setStudies(result.studies);setDraft(result.working);setSelected(result.working.sourceId||result.studies[0]?.id||'');
    if(editing==='load'){setAvailable(false);setVersion(v=>v+1);setMenuOpen(false);}
    else setMessage('Study saved in this browser. Save again to update it.');
   }
   setEditing(null);
  }catch(e){setError(e instanceof Error?e.message:'The change could not be saved. Try again.');}
  finally{setBusy(false);}
 }
 async function exportBackup(){
  if(busy||(!available&&!canRecover))return;
  setBusy(true);setError('');setMessage('Preparing complete study backup…');
  try{
   const {encodeStudyBackup,readWorkingBackup}=await import('@/lib/study-backup');
   const name=source?.name||draft.name;
   let data;
   if(canRecover){
    const {texts,knowledge}=draftRef.current;
    if(!texts||!knowledge)throw new Error('Wait for both workspaces to finish opening before downloading a recovery copy.');
    data={name,texts,knowledge,createdAt:new Date().toISOString()};
   }else{
    const revisions=[workspaceRevision(studyWorkspaceKey(WORKING_STUDY_ID)),workspaceRevision(studyWorkspaceKey(WORKING_STUDY_ID,true))];
    data=await readWorkingBackup(name,revisions);
   }
   const json=await encodeStudyBackup(data);
   const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
   const link=document.createElement('a');
   link.href=url;link.download=(name.replace(/[^a-z0-9_-]+/gi,'_')||'study')+(canRecover?'-recovery':'')+'.tal-study.json';
   link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   setMessage(canRecover?'Recovery copy downloaded. You can import it as a separate study.':'Complete working-copy backup downloaded. API keys are excluded.');
  }catch(e){setError(e instanceof Error?e.message:'Backup export failed.');}finally{setBusy(false);}
 }
 async function importBackup(file?:File){
  if(!file||disabled)return;setBusy(true);setError('');setMessage('Validating study backup…');
  try{const {decodeStudyBackup,importStudyBackup,MAX_BACKUP_BYTES}=await import('@/lib/study-backup');if(file.size>MAX_BACKUP_BYTES)throw Error('Use a study backup smaller than 250 MB.');const data=decodeStudyBackup(await file.text());const result=await importStudyBackup(data);setStudies(result.studies);setSelected(result.study.id);setMessage(`Imported “${result.study.name}”. Choose Open to use it.`);}catch(e){setMessage('');setError(e instanceof Error?e.message:'Could not import this backup.');}finally{setBusy(false);}
 }
 const confirmation=editing==='load'?{title:`Open "${target?.name}"?`,text:'This replaces your open work in both workspaces. Save it first if you want to keep it.',button:'Open study'}:
 editing==='update'?{title:`Save "${source?.name}"?`,text:'Replace this saved study with your current work? To keep both, cancel and choose More options → Save a copy.',button:'Save study'}:
 editing==='delete'?{title:`Delete "${target?.name}"?`,text:'This permanently deletes the saved study. Your current work stays open. This cannot be undone.',button:'Delete permanently'}:undefined;
 const controls=<div className="study-controls">
 <Dialog open={newStudy!==null} onOpenChange={open=>{if(!busy){setNewStudy(open?'confirm':null);setSaveName('');setError('');setMenuOpen(false);}}}>
  <DialogContent className="new-study-dialog" showCloseButton={false} onCloseAutoFocus={e=>{e.preventDefault();menuTrigger.current?.focus();}} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>{if(busy)e.preventDefault();}}>
   <DialogTitle>{newStudy==='save'?'Save current work first':'Start a new study?'}</DialogTitle>
   <DialogDescription>Save your current work before starting over? Your saved studies will remain available.</DialogDescription>
   {newStudy==='save'?<form onSubmit={e=>{e.preventDefault();void startNewStudy(true);}}>
    <label htmlFor="new-study-save-name">Save current work as</label>
    <input id="new-study-save-name" autoFocus value={saveName} maxLength={80} disabled={busy} onChange={e=>{setSaveName(e.target.value);setError('');}} autoComplete="off"/>
    <div className="new-study-actions"><Button type="submit" disabled={disabled||!saveName.trim()}>{busy?'Saving…':'Save and start new'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setNewStudy(null)}>Cancel</Button></div>
   </form>:<div className="new-study-actions">
    <Button disabled={disabled} onClick={()=>{setNewStudy('save');setError('');}}>Save and start new</Button>
    <Button variant="outline" disabled={disabled} onClick={()=>void startNewStudy(false)}>{busy?'Starting…':'Start without saving'}</Button>
    <Button variant="ghost" disabled={busy} autoFocus onClick={()=>setNewStudy(null)}>Cancel</Button>
   </div>}
   {error&&<p className="message" role="alert">{error}</p>}
  </DialogContent>
 </Dialog>
 <Popover open={menuOpen} onOpenChange={value=>{if(!busy){setMenuOpen(value);if(!value)setEditing(null);}}}>
  <PopoverTrigger asChild><Button ref={menuTrigger} variant="outline" className="study-menu-trigger" title={source?.name||draft.name}><span>Studies</span><span className="active-study-name">{source?.name||draft.name}</span><ChevronDown size={15} aria-hidden="true"/></Button></PopoverTrigger>
  <PopoverContent align="end" sideOffset={10} className="study-menu" aria-label="Manage studies" onCloseAutoFocus={e=>{if(newStudy!==null)e.preventDefault();}}>
   {!editing&&<>
    <div className="study-primary-actions">
     <Button variant="outline" disabled={disabled} onClick={()=>{setMenuOpen(false);setNewStudy('confirm');setSaveName('');setError('');setMessage('');}}>New study</Button>
     <Button disabled={disabled} onClick={()=>begin(source?'update':'new')}>Save study</Button>
    </div>
    <div className="study-saved-list"><label htmlFor="open-study">Saved studies in this browser</label>{studies.length?<><select id="open-study" value={target?selected:''} disabled={disabled} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Choose a study</option>{studies.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><div className="study-menu-actions"><Button variant="outline" disabled={disabled||!target} onClick={()=>begin('load')}>Open</Button></div></>:<p className="hint">No saved studies yet.</p>}</div>
    <details className="study-more-options"><summary>More options</summary><div className="study-menu-actions">
     {source&&<button className="textbutton" disabled={disabled} onClick={()=>begin('new')}>Save a copy</button>}
     {target&&<><button className="textbutton" disabled={disabled} onClick={()=>begin('rename')}>Rename selected study</button><button className="textbutton study-delete" disabled={disabled} onClick={()=>begin('delete')}>Delete selected study</button></>}
     <button className="textbutton" disabled={busy||(!available&&!canRecover)} onClick={exportBackup}>Download backup</button>
     <button className="textbutton" disabled={disabled} onClick={()=>backupInput.current?.click()}>Import backup</button>
     <input ref={backupInput} type="file" hidden accept=".json" aria-label="Import study backup" disabled={disabled} onChange={e=>{void importBackup(e.target.files?.[0]);e.target.value='';}}/>
    </div></details>
   </>}
   {(editing==='new'||editing==='rename')&&<form className="study-name-form" onSubmit={e=>{e.preventDefault();void submit();}}><label htmlFor="study-name">Study name</label><input id="study-name" autoFocus value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)} autoComplete="off"/><div className="study-menu-actions"><Button type="submit" disabled={disabled||!name.trim()}>{busy?'Saving…':'Save'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setEditing(null)}>Cancel</Button></div></form>}
   {confirmation&&<div className="study-delete-confirm" role="group" aria-label={confirmation.title}><strong>{confirmation.title}</strong><p>{confirmation.text}</p><div className="study-menu-actions"><Button variant={editing==='delete'?'destructive':'default'} disabled={disabled} onClick={()=>void submit()}>{busy?'Working...':confirmation.button}</Button><Button variant="outline" disabled={busy} autoFocus onClick={()=>setEditing(null)}>Cancel</Button></div></div>}
   {message&&<p className="hint" role="status">{message}</p>}{error&&<p className="message" role="alert">{error}</p>}
  </PopoverContent>
 </Popover></div>;
 if(!loaded)return <main><div className="study-loading">{error?<><p role="alert">{error}</p><Button onClick={()=>window.location.reload()}>Reload</Button></>:<p role="status">Opening working copy...</p>}</div></main>;
 return children({id:WORKING_STUDY_ID,name:source?.name||draft.name},controls,setAvailable,version,draftRef,setCanRecover);
}
