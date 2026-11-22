'use client';
// Research mode: the model menu. It offers the Lab's own models, the other models on the account behind the
// key, "Other model ID…", which opens a box for any ID the provider knows, and "Refresh model list".
import {useEffect,useId,useState} from 'react';
import {Select,SelectContent,SelectGroup,SelectItem,SelectLabel,SelectSeparator,SelectTrigger,SelectValue} from '@/components/ui/select';
import {PROVIDERS,OPENROUTER_STARTER_MODELS,defaultModel,isListedModel,modelAccessLabel,modelLabel,validModelId,type AccountModel,type Provider} from '@/lib/providers';
import {canCheckKey} from '@/lib/workflow-safety';

const OTHER='other-model-id',REFRESH='refresh-model-list',MENU_LIMIT=150;
// A provider's list is asked for once per key and kept while this page is open; "refresh" asks again.
const lists=new Map<string,Promise<AccountModel[]>>();
// "Forget all keys": the lists go too, since each is kept under its key.
export function forgetModelLists(){lists.clear();}
function accountModels(provider:Provider,key:string):Promise<AccountModel[]>{
 const tag=provider+'\n'+key,kept=lists.get(tag);
 if(kept)return kept;
 const asked=(async()=>{
  const response=await fetch('/api/models',{method:'POST',headers:{Authorization:'Bearer '+key,'X-Lab-Provider':provider},cache:'no-store'});
  const out=await response.json() as {models?:AccountModel[];error?:string}|null;
  if(!response.ok||!Array.isArray(out?.models))throw Error(out?.error||'The list of models could not be read.');
  return out.models;
 })();
 lists.set(tag,asked);asked.catch(()=>{if(lists.get(tag)===asked)lists.delete(tag);});
 return asked;
}
type Listed={tag:string;status:'loading'|'ok'|'error';models:AccountModel[];error?:string};

// apiKey: the selected provider's key (empty: no list is asked for). onChange: the model chosen or typed.
// onModels: the account's models once they are known, for the reasoning settings each one takes.
export function ModelChoice({provider,model,apiKey,disabled,onChange,onModels}:{provider:Provider;model:string;apiKey:string;disabled?:boolean;onChange:(model:string)=>void;onModels:(value:{provider:Provider;models:AccountModel[]}|undefined)=>void}){
 const id=useId(),key=apiKey.trim(),usable=canCheckKey(provider,key),tag=provider+'\n'+key;
 const [listed,setListed]=useState<Listed>(),[revision,setRevision]=useState(0),[typing,setTyping]=useState(false);
 useEffect(()=>{
  if(!usable){setListed(undefined);return;}
  let current=true;setListed({tag,status:'loading',models:[]});
  accountModels(provider,key).then(models=>{if(current)setListed({tag,status:'ok',models});},error=>{if(current)setListed({tag,status:'error',models:[],error:error instanceof TypeError||!(error instanceof Error)?'The list of models could not be read. Check your connection and try again.':error.message});});
  return ()=>{current=false;};
 },[provider,key,usable,tag,revision]);
 const account=listed?.tag===tag?listed:undefined,known=account?.status==='ok'?account.models:undefined;
 useEffect(()=>{onModels(known?{provider,models:known}:undefined);},[known,provider,onModels]);
 useEffect(()=>setTyping(false),[provider]);
 const config=PROVIDERS[provider],others=(known||[]).filter(item=>!isListedModel(provider,item.id)),inMenu=others.length<=MENU_LIMIT?others:[];
 const offered=isListedModel(provider,model)||inMenu.some(item=>item.id===model),typed=typing||!offered;
 const refresh=()=>{lists.delete(tag);setRevision(value=>value+1);};
 const back=()=>{setTyping(false);if(!offered)onChange(defaultModel(provider));};
 const wellFormed=validModelId(provider,model),unknown=Boolean(known)&&wellFormed&&!isListedModel(provider,model)&&!known!.some(item=>item.id===model);
 const item=(value:string)=><SelectItem value={value} key={value} textValue={modelLabel(value)}><span>{modelLabel(value)}</span>{provider!=='openrouter'&&<span className={'model-access-badge '+(modelAccessLabel(provider,value).startsWith('Free')?'free':'paid')}>{modelAccessLabel(provider,value)}</span>}</SelectItem>;
 return <>
  <div>
   <label htmlFor={id}>Model</label>
   {typed?<>
    <input id={id} className="research-model-id" value={model} placeholder="Model ID" list={id+'-ids'} autoFocus={typing} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" disabled={disabled} aria-describedby={id+'-account'} onChange={event=>onChange(event.target.value.replace(/\s+/g,''))}/>
    <datalist id={id+'-ids'}>{[...config.models,...others.map(entry=>entry.id)].map(value=><option key={value} value={value}/>)}</datalist>
   </>:<Select value={model} onValueChange={value=>{if(value===OTHER)setTyping(true);else if(value===REFRESH)refresh();else onChange(value);}} disabled={disabled}>
    <SelectTrigger id={id} aria-label="Model" title={isListedModel(provider,model)?modelLabel(model):model}><SelectValue>{isListedModel(provider,model)?modelLabel(model):model}</SelectValue></SelectTrigger>
    <SelectContent>
     {provider==='openrouter'?['Economical starting points','More capable comparison models'].map((label,index)=><SelectGroup key={label}><SelectLabel>{label}</SelectLabel>{config.models.filter(value=>OPENROUTER_STARTER_MODELS.includes(value)===(index===0)).map(item)}</SelectGroup>):config.models.map(item)}
     {inMenu.length>0&&<SelectGroup><SelectLabel>Other models on your account</SelectLabel>{inMenu.map(entry=><SelectItem value={entry.id} key={entry.id} textValue={entry.id} title={entry.name}>{entry.id}</SelectItem>)}</SelectGroup>}
     <SelectSeparator/>
     <SelectItem value={OTHER}>Other model ID…</SelectItem>
     {account?.status==='ok'&&<SelectItem value={REFRESH}>Refresh model list</SelectItem>}
    </SelectContent>
   </Select>}
  </div>
  {(typed||(account&&account.status!=='ok'))&&<p id={id+'-account'} className="hint research-model-account" aria-live="polite">
   {typed&&<button type="button" className="textbutton" disabled={disabled} onClick={back}>Back to the list</button>}
   {typed&&model!==''&&!wellFormed&&<span>This does not look like a model ID of {config.label}{provider==='openrouter'?', which has the form vendor/model':''}.</span>}
   {account?.status==='loading'&&<span>Loading the models on your account…</span>}
   {account?.status==='error'&&<span>{account.error} <button type="button" className="textbutton" onClick={refresh}>Try again</button></span>}
   {typed&&unknown&&<span>This ID is not on your account.</span>}
  </p>}
 </>;
}
