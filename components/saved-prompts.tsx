"use client";
import {useEffect,useState} from 'react';
import {listSavedPrompts,savePrompt,deletePrompt,type LibraryPrompt} from '@/lib/saved-prompts';
import {Button} from '@/components/ui/button';

export function SavedPrompts({disabled,prompt,answerFields,onUse}:{disabled:boolean;prompt:string;answerFields:string[];onUse:(prompt:string,fields:string[])=>void}){
 const [entries,setEntries]=useState<LibraryPrompt[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[naming,setNaming]=useState(false),[name,setName]=useState('');
 const chosen=entries.find(entry=>entry.id===selected),locked=disabled||busy;
 async function refresh(){try{setEntries(await listSavedPrompts());}catch(error){setMessage(error instanceof Error?error.message:'Could not read saved prompts.');}}
 useEffect(()=>{void refresh();const reload=()=>{void refresh();};window.addEventListener('saved-prompts-changed',reload);window.addEventListener('focus',reload);return()=>{window.removeEventListener('saved-prompts-changed',reload);window.removeEventListener('focus',reload);};},[]);
 async function save(){
  if(locked)return;setBusy(true);setMessage('');
  try{const updated=await savePrompt(name,prompt,answerFields);setEntries(updated);setSelected(updated[updated.length-1].id);setNaming(false);setName('');setMessage('Prompt saved.');window.dispatchEvent(new Event('saved-prompts-changed'));}catch(error){setMessage(error instanceof Error?error.message:'Could not save prompt.');}finally{setBusy(false);}
 }
 async function remove(){
  if(!chosen||locked||!confirm(`Delete saved prompt “${chosen.name}”? Existing studies will keep their prompts.`))return;
  setBusy(true);setMessage('');try{setEntries(await deletePrompt(chosen.id));setSelected('');setMessage('Saved prompt deleted.');window.dispatchEvent(new Event('saved-prompts-changed'));}catch(error){setMessage(error instanceof Error?error.message:'Could not delete prompt.');}finally{setBusy(false);}
 }
 return <div className="saved-prompts hint">
  <div className="saved-prompt-actions"><select aria-label="Saved prompts" value={chosen?selected:''} disabled={locked} onFocus={()=>void refresh()} onChange={event=>{setSelected(event.target.value);setMessage('');}}>
   <option value="">Saved prompts…</option>{entries.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}
  </select><button type="button" className="textbutton" disabled={locked||!prompt.trim()} onClick={()=>{setNaming(!naming);setMessage('');}}>Save prompt</button></div>
  {naming&&<div className="saved-prompt-actions"><input aria-label="Prompt name" placeholder="Name this prompt" maxLength={80} value={name} disabled={locked} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void save();}}}/><Button type="button" variant="outline" disabled={locked||!name.trim()} onClick={()=>void save()}>Save</Button><button type="button" className="textbutton" disabled={locked} onClick={()=>setNaming(false)}>Cancel</button></div>}
  {chosen&&<div className="saved-prompt-actions"><Button type="button" variant="outline" disabled={locked} onClick={()=>{
   const differs=prompt!==chosen.prompt||JSON.stringify(answerFields)!==JSON.stringify(chosen.answerFields);
   if(differs&&(prompt.trim()||answerFields.length)&&!confirm('Replace your current prompt and answer fields with this saved prompt?'))return;
   onUse(chosen.prompt,[...chosen.answerFields]);setMessage('Prompt loaded.');
  }}>Use prompt</Button><button type="button" className="textbutton" disabled={locked} onClick={()=>void remove()}>Delete</button></div>}
  {message&&<p role="status">{message}</p>}
 </div>;
}
