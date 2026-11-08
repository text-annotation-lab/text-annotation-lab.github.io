import {PROVIDERS,reasoningOptions,type Provider} from './providers';
export function keyProvider(key:string):Provider|undefined {
 if (key.startsWith('sk-or-')) return 'openrouter';
 if (key.startsWith('sk-ant-')) return 'anthropic';
 if (key.startsWith('AIza') || key.startsWith('AQ.')) return 'gemini';
 if (key.startsWith('sk-')) return 'openai';
}

export function canCheckKey(provider:Provider,key:string) {
 return keyProvider(key) === provider && /^[A-Za-z0-9._-]{12,2048}$/.test(key)
  && !/^sk-(?:ant-)?admin/i.test(key);
}
export function setupErrors(provider:Provider,apiKey:string,prompt:string,model:string,effort:string){
 const key=apiKey.trim();let keyError='';
 const recognized=keyProvider(key);
 if(!key)keyError='Add your API key before starting.';
 else if(recognized&&recognized!==provider)keyError=`This key appears to be for ${PROVIDERS[recognized].label}. Select that provider or enter a ${PROVIDERS[provider].label} key. Key format alone does not verify access.`;
 return {key:keyError,prompt:!prompt.trim()?'Add an annotation prompt before starting.':prompt.length>100000?'Keep the prompt within 100,000 characters.':'',model:!PROVIDERS[provider].models.includes(model)?'Choose an available model.':!reasoningOptions(provider,model).includes(effort)?'Choose a supported reasoning setting.':''};
}
export type Attempt = {status:string;[key:string]:any};
export type RetryRecord={id:string;status:string;history?:Attempt[];[key:string]:any};
const attemptKeys=['inputMode','runId','runStartedAt','runSize','responseFormat','rawResponse','answerFields','answers','status','error','provider','model','effort','prompt','processing','concurrency','batchId','instructions','webSearch','webUsed','research','score','explanation','tokens','usage','responseId','time','startedAt'];
// Preserve failed attempts before requeuing; successful records never change.
export function queueRetries<T extends RetryRecord>(records:T[],id?:string):T[]{
 return records.map(record=>{
  if(record.status!=='error'||id&&record.id!==id)return record;
  const next={...record},attempt:Attempt={status:record.status};
  for(const key of attemptKeys){if(record[key]!==undefined)attempt[key]=record[key];delete next[key];}
  return {...next,status:'pending',history:[...(record.history||[]),attempt]} as T;
 });
}
export function retryMessage(count:number){return `Queue ${count} failed item${count===1?'':'s'} for retry? Retries use the current prompt, provider, model, reasoning, and processing options when you start them. Previous attempts remain in the backup and Excel history; successful results stay unchanged. Check provider usage first: an interrupted or unreadable request may already have completed and been charged. This only queues retries; it does not send requests.`;}
export function queueSummary(records:RetryRecord[],unit='text',insufficient=0){
 if(!records.length)return '';
 const count=(status:string)=>records.filter(r=>r.status===status).length;
 const ready=count('pending'),done=count('done'),active=count('running')+count('queued'),failed=count('error');
 if(ready===records.length)return `${ready} ${unit}${ready===1?'':'s'} ready`;
 return [`${done} of ${records.length} complete`,active?`${active} in progress`:'',failed?`${failed} need${failed===1?'s':''} attention`:'',insufficient?`${insufficient} insufficient knowledge`:''].filter(Boolean).join(' · ');
}
