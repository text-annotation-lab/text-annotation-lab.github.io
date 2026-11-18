'use client';
// Research mode: the ⓘ beside a setting, which shows what it does (lib/research/setting-help.ts), and the list of
// them all in a closed fold-out at the end of research mode’s About page.
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {SETTING_HELP,settingHelp,type SettingHelpId} from '@/lib/research/setting-help';
// text: what to show instead of the general text, where the selected provider or model makes it more exact.
export function SettingInfo({topic,text}:{topic:SettingHelpId;text?:string[]}){
 const help=settingHelp(topic),shown=text??help.text;
 return <Popover><PopoverTrigger asChild><button type="button" className="setting-info" aria-label={'About '+help.label} onClick={event=>event.stopPropagation()}>i</button></PopoverTrigger><PopoverContent align="start" sideOffset={6} className="setting-info-text">{shown.map((part,i)=><p key={i}>{part}</p>)}</PopoverContent></Popover>;
}
export function SettingsExplained(){
 return <details className="settings-explained"><summary><h3 id="settings-explained">Settings explained</h3></summary><dl>{SETTING_HELP.map(entry=><div key={entry.id}><dt>{entry.label}</dt>{entry.text.map((part,i)=><dd key={i}>{part}</dd>)}</div>)}</dl></details>;
}
