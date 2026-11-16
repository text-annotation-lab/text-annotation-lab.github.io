'use client';
import {cacheNote} from '@/lib/cache-note';
import type {Provider} from '@/lib/providers';
import type {RequestSettings} from '@/lib/request-settings';
// Research mode: the prompt caching option in Processing options. `prompt` is the prompt as a request sends it.
// Where the model's provider caches by itself, the box is off and the stored choice is kept for other models.
export function CacheOption({provider,model,prompt,value,disabled,onChange}:{provider:Provider;model:string;prompt:string;value?:RequestSettings;disabled?:boolean;onChange:(value:RequestSettings|undefined)=>void}){
 const note=cacheNote(provider,model,prompt);
 return <label className="research-check research-output-check research-cache-option"><input type="checkbox" checked={note.available&&Boolean(value?.cache)} disabled={disabled||!note.available} onChange={event=>onChange(event.target.checked?{cache:true}:undefined)}/><span>Prompt caching<small>{note.text}</small></span></label>;
}
