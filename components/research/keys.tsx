'use client';
// API keys for research mode: one dialog in the header for every provider.
// Keys stay in this tab unless the researcher chooses to remember them in this
// browser. They are never part of a study, a backup, or an export.
import {useEffect,useState} from 'react';
import {KeyRound} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {GEMINI_ENABLED,PROVIDERS,type Provider} from '@/lib/providers';
import {cleanKeyring,type Keyring} from '@/lib/research/mode';
import {forgetModelLists} from './model-choice';

const ORDER:Provider[]=(['openai','gemini','anthropic','openrouter'] as Provider[]).filter(p=>p!=='gemini'||GEMINI_ENABLED);

export function KeysControl({keyring,remember,provider,open,onOpenChange,onSave,disabled}:{keyring:Keyring;remember:boolean;provider:Provider;open:boolean;onOpenChange:(open:boolean)=>void;onSave:(keys:Keyring,remember:boolean)=>void;disabled?:boolean}){
 const [draft,setDraft]=useState<Keyring>(keyring),[keep,setKeep]=useState(remember);
 useEffect(()=>{if(open){setDraft(keyring);setKeep(remember);}},[open]);
 const count=ORDER.filter(p=>keyring[p]).length;
 const save=()=>{onSave(cleanKeyring(draft),keep);onOpenChange(false);};
 return <>
  <Button type="button" variant="outline" className="research-keys-trigger" onClick={()=>onOpenChange(true)} aria-label={`API keys: ${count?`${count} set`:'none set'}`} title={count?`${count} API ${count===1?'key':'keys'} set. Add or change API keys`:'No API key set. Add an API key to annotate'}><span className="research-keys-icon" aria-hidden="true"><KeyRound size={15}/><span className={'research-keys-dot'+(count?' set':'')}/></span><span>API keys</span></Button>
  <Dialog open={open} onOpenChange={onOpenChange}>
   <DialogContent className="research-dialog research-keys-dialog">
    <DialogTitle>API keys</DialogTitle>
    <DialogDescription>Each key is sent only to its own provider, directly from this browser. Keys are never part of a study, a backup, or an export.</DialogDescription>
    <form onSubmit={event=>{event.preventDefault();save();}}>
     {ORDER.map(p=><div className="research-key-field" key={p}>
      <label htmlFor={'research-key-'+p}>{PROVIDERS[p].label}{p===provider&&<span className="research-key-current">selected provider</span>}</label>
      <input id={'research-key-'+p} type="password" autoComplete="off" spellCheck={false} placeholder="Paste your API key" value={draft[p]||''} disabled={disabled} onChange={event=>setDraft({...draft,[p]:event.target.value})}/>
      <a href={PROVIDERS[p].keyUrl} target="_blank" rel="noreferrer">Create a key ↗</a>
     </div>)}
     <label className="research-check"><input type="checkbox" checked={keep} disabled={disabled} onChange={event=>setKeep(event.target.checked)}/>Remember keys in this browser</label>
     <p className="hint">Off: keys are kept only until you close or reload this tab. On: keys are stored unencrypted in this browser’s local storage. Use this on a personal computer only.</p>
     <div className="research-dialog-actions">
      <Button type="submit" disabled={disabled}>Save</Button>
      <Button type="button" variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button>
      {(count>0||remember)&&<button type="button" className="textbutton research-forget" disabled={disabled} onClick={()=>{forgetModelLists();onSave({},false);onOpenChange(false);}}>Forget all keys</button>}
     </div>
    </form>
   </DialogContent>
  </Dialog>
 </>;
}
