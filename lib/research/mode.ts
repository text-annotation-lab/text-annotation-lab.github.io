// Research mode is a view of the same Lab: one switch, remembered in this
// browser. Studies, prompts, and results are shared by both modes.
const MODE_KEY='text-annotation-lab:mode';
const KEYS_KEY='text-annotation-lab:research-keys';
const PROVIDER_IDS=['openai','gemini','anthropic','openrouter'] as const;
export type Keyring=Partial<Record<(typeof PROVIDER_IDS)[number],string>>;

export function readResearchMode():boolean{
 try{return window.localStorage.getItem(MODE_KEY)==='research';}catch{return false;}
}
export function writeResearchMode(on:boolean){
 try{if(on)window.localStorage.setItem(MODE_KEY,'research');else window.localStorage.removeItem(MODE_KEY);}catch{}
}

// API keys are kept only when the researcher ticks "Remember keys in this
// browser" (research mode only). They stay in this browser's local storage and
// are never part of a study, a backup, or an export.
export function cleanKeyring(value:unknown):Keyring{
 const keys:Keyring={};
 if(!value||typeof value!=='object')return keys;
 for(const id of PROVIDER_IDS){const key=(value as Record<string,unknown>)[id];if(typeof key==='string'&&key.trim()&&key.length<=4096)keys[id]=key.trim();}
 return keys;
}
export function readSavedKeys():Keyring|undefined{
 try{const raw=window.localStorage.getItem(KEYS_KEY);return raw===null?undefined:cleanKeyring(JSON.parse(raw));}catch{return undefined;}
}
export function writeSavedKeys(keys:Keyring):boolean{
 try{window.localStorage.setItem(KEYS_KEY,JSON.stringify(cleanKeyring(keys)));return true;}catch{return false;}
}
export function forgetSavedKeys(){
 try{window.localStorage.removeItem(KEYS_KEY);}catch{}
}

// Keys entered in research mode stay available while this tab is open (for
// example when switching studies), in memory only.
let session:Keyring={};
export const sessionKeys=():Keyring=>session;
export function keepSessionKeys(keys:Keyring){session=cleanKeyring(keys);}
