import {differentSettingsCount,settingsDifferences,type SettingDifference} from '@/lib/student-guidance';
import {modelLabel,PROVIDERS,reasoningOptionLabel,type Provider} from '@/lib/providers';
export function SaveHelp(){return <details className="hint save-help"><summary>Save, export, and return</summary>
 <dl><div><dt>Autosave</dt><dd>Keeps your current work in this browser.</dd></div>
 <div><dt>Studies → Save a version</dt><dd>Keeps a named point you can return to before changing your prompt.</dd></div>
 <div><dt>Studies → Download study backup</dt><dd>Creates a file you can reopen in the lab on another computer.</dd></div>
 <div><dt>Download Excel</dt><dd>Exports results and recorded study settings for analysis; it cannot reopen a study in the lab.</dd></div></dl>
 <p>Browser copies can be lost if browser data is cleared. Keep a downloaded backup. Re-enter your API key after reloading or reopening; keys are never saved.</p>
 </details>}
const settingNames:Record<SettingDifference['key'],string>={model:'model',prompt:'prompt',effort:'reasoning effort',provider:'provider',answerFields:'answer fields',webSearch:'web search'};
function settingValue(key:SettingDifference['key'],value:string):string{
 if(key==='model')return modelLabel(value);
 if(key==='provider')return PROVIDERS[value as Provider]?.label||value;
 if(key==='effort')return reasoningOptionLabel(value);
 if(key==='answerFields')return value||'none';
 return value;
}
export function SettingsNotice({rows,current,knowledge=false}:{rows:Parameters<typeof differentSettingsCount>[0];current:Parameters<typeof differentSettingsCount>[1];knowledge?:boolean}){
 const count=differentSettingsCount(rows,current);if(!count)return null;
 const differences=settingsDifferences(rows,current);
 const now:Record<SettingDifference['key'],string>={model:current.model||'',prompt:current.prompt||'',effort:current.effort||'',provider:current.provider||'',answerFields:(current.answerFields||[]).join(', '),webSearch:current.webSearch?'on':'off'};
 return <details className="hint settings-notice"><summary>{count} completed {count===1?'annotation uses':'annotations use'} different settings{differences.length?` (${differences.map(d=>settingNames[d.key]).join(', ')})`:''}</summary>
 <ul className="settings-differences">{differences.map(({key,earlier})=><li key={key}><strong>{settingNames[key][0].toUpperCase()+settingNames[key].slice(1)}:</strong> {key==='prompt'?<>{earlier.reduce((n,e)=>n+e.count,0)} {earlier.reduce((n,e)=>n+e.count,0)===1?'result was':'results were'} made with a different prompt than the one now in the prompt box.</>:<>{earlier.map(e=>`${settingValue(key,e.value)} (${e.count} ${e.count===1?'result':'results'})`).join('; ')} in the results; {settingValue(key,now[key])} now.</>}</li>)}</ul>
 <p>Changing the prompt, model, reasoning effort, or answer fields does not update earlier results. {knowledge?'Web-search settings are also recorded for each result. ':''}Save a version in Studies before rerunning if you want to keep the earlier results.</p>
 <p>{knowledge?'For an intentional comparison, Repeat study keeps earlier runs and records the settings for each.':'For your final dataset, use one final prompt and settings for every text. After saving your pilot, Clear results keeps the documents ready for a fresh run. New annotations can add to your spending.'}</p>
 </details>;
}
