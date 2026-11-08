'use client';
import {useEffect,useState,type ComponentType} from 'react';
import {TabsContent} from '@/components/ui/tabs';

// Teaching content is fetched only when its section is opened. The two workspaces
// stay mounted separately so background runs and storage safeguards are unchanged.
const loaders:Record<string,()=>Promise<ComponentType>>={
 'get-started':()=>import('./get-started').then(module=>module.GetStarted),
 teaching:()=>import('./teaching-panels').then(module=>module.TeachingPanels),
 'study-example':()=>import('./study-example').then(module=>module.StudyExample),
 about:()=>import('./about').then(module=>module.About),
};
const sectionKeys:Record<string,string>={'get-started':'get-started',tips:'teaching',corpus:'teaching',resources:'teaching','study-example':'study-example',about:'about'};
const panels=new Map<string,ComponentType>(),requests=new Map<string,Promise<void>>(),errors=new Map<string,string>();

// Resolve before changing the active tab, so the previous page stays intact.
// Keep resolved components, not just import promises: revisits render synchronously.
export function prepareReadingPanel(section:string):Promise<void>|undefined{
 const key=sectionKeys[section];
 if(!key||panels.has(key))return;
 let request=requests.get(key);
 if(!request){
  errors.delete(key);
  request=loaders[key]().then(Panel=>{panels.set(key,Panel);}).catch(error=>{errors.set(key,'This section could not load. Please try again.');throw error;}).finally(()=>{requests.delete(key);});
  requests.set(key,request);
 }
 return request;
}
export function ReadingPanels({section}:{section:string}){
 const [attempt,setAttempt]=useState(0);
 const key=sectionKeys[section],Panel=panels.get(key),error=errors.get(key);
 useEffect(()=>{
  if(!key||Panel||error)return;
  let current=true;
  const refresh=()=>{if(current)setAttempt(value=>value+1);};
  prepareReadingPanel(section)?.then(refresh,refresh);
  return()=>{current=false;};
 },[section,key,Panel,error,attempt]);
 if(!key)return null;
 if(Panel)return <Panel/>;
 return <TabsContent value={section} className="reading-panel panel"><p role="status">{error||'Loading section…'}</p>{error&&<button type="button" className="textbutton" onClick={()=>{errors.delete(key);setAttempt(value=>value+1);}}>Try again</button>}</TabsContent>;
}
