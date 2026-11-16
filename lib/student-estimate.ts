import {answerInstructions,type AnswerSettings} from './answer-fields';
import {remainingEstimateNotice} from './annotation-feedback';
import {estimate,textTokens,usageSample,add,money,type Input,type EstimateConfig} from './cost-estimate/engine';
import {contextWindow,ownRates,priceFor,type OwnPrice} from './cost-estimate/pricing';
import {knowledgeAddition,knowledgeItemText} from './model-knowledge';
import {validModelId,annotationOutputLimit,type Provider} from './providers';
import {documentTags} from './request-frame';
const visualCache=new WeakMap<File,Promise<Input>>(),textCache=new WeakMap<File,Promise<Input>>();
async function fileInput(file:File,textOnly=false):Promise<Input>{
 const cache=textOnly?textCache:visualCache;
 let cached=cache.get(file);if(cached)return cached;
 cached=(async()=>{
  if(/\.pdf$/i.test(file.name)){
   const {getDocumentProxy,extractText}=await import('unpdf');
   const pdf=await getDocumentProxy(new Uint8Array(await file.arrayBuffer()),{maxImageSize:16777216});
   try{
    if(pdf.numPages>500)throw Error('Estimate PDFs of up to 500 pages, or split the document first.');
    const {text}=await extractText(pdf,{mergePages:true});
    // Full PDFs are sent visually by this app; page-image tokens are uncertain.
    if(textOnly&&!text.trim())throw Error('No readable text was found. Scanned PDFs need OCR first.');
    return textOnly?{tokens:textTokens(text)}:{tokens:add(textTokens(text),{low:pdf.numPages*500,high:pdf.numPages*3000}),pdf:true};
   }finally{await pdf.loadingTask.destroy();}
  }
  const {extractText}=await import('./extract-text');const text=await extractText(file);
  if(!text.trim())throw Error('No readable text was found.');
  // The text as a request sends it, between <text> tags after the prompt (lib/request-frame.ts).
  const tags=documentTags(false);
  return {tokens:textTokens(tags.open+text+tags.close)};
 })().catch(error=>{cache.delete(file);throw Error(file.name+': '+(error instanceof Error?error.message:'Could not read this file for estimation.'));});cache.set(file,cached);return cached;
}
// cache, batch: research mode's prompt caching, and whether the texts go out as a batch (a cache write costs more there).
// times: research mode, several annotations per text: how many requests a waiting text gets (absent: one).
// maxOutput: research mode's output limit, where it is not the Lab's own.
// ownPrice: research mode, your own price for the model, used in place of the Lab's (lib/own-prices.ts).
// research: research mode, where a model without a price can be given one.
// system: research mode's own system prompt, sent with every request (lib/request-settings.ts).
export async function studentEstimate({provider,model,effort,prompt,system,rows,answerFields=[],answerSettings,knowledge=false,webSearch=false,cache=false,batch=false,times,maxOutput,ownPrice,research=false,signal}:{provider:Provider;model:string;effort:string;prompt:string;system?:string;rows:any[];answerFields?:string[];answerSettings?:AnswerSettings;knowledge?:boolean;webSearch?:boolean;cache?:boolean;batch?:boolean;times?:(row:any)=>number;maxOutput?:number;ownPrice?:OwnPrice;research?:boolean;signal?:AbortSignal}){
 if(!validModelId(provider,model))throw Error('Choose a supported model.');
 const pending=rows.filter(r=>r.status==='pending'),inputs:Input[]=[];
 for(const row of pending){signal?.throwIfAborted();const count=countFromCache(row,{provider,model,effort,prompt,system,answerFields,answerSettings,knowledge,webSearch});const input:Input=count!==undefined?{tokens:{low:0,high:0},requestTokens:count}:knowledge?{tokens:textTokens(documentTags(true).open+knowledgeItemText(row.fields)+documentTags(true).close)}:await fileInput(row.file);for(let n=times?Math.max(1,times(row)):1;n>0;n--)inputs.push(input);}
 const config:EstimateConfig={provider,model,effort,...(ownPrice?{rates:ownRates(provider,model,ownPrice)}:{}),...(cache?{cache,batch}:{}),...(system?{system}:{}),prompt:prompt.trim()?prompt+answerInstructions(answerFields,answerSettings)+(knowledge?knowledgeAddition(webSearch,answerSettings):''):'',defaultExplanation:answerSettings?.plain||answerSettings?.rationale===false?false:true,webSearch,maxTokens:maxOutput??annotationOutputLimit(provider,model),fields:answerSettings?.plain?[{name:'response',type:'string'}]:[...(answerFields.length?answerFields.map(name=>{const spec=answerSettings?.fields?.find(f=>f.name===name);return {name,type:spec?.type==='text'?'string':'category',...(spec?.description?{description:spec.description}:{})};}):[{name:'score',type:'category'}]),...(answerSettings?.rationale===false?[]:[{name:'explanation',type:'string'}])]};
 const samples=rows.filter(r=>r.status==='done'&&r.provider===provider&&!(provider==='openrouter'&&r.file&&/\.pdf$/i.test(r.file.name)&&r.inputMode!=='pdf-native')&&r.model===model&&r.effort===effort&&r.prompt===prompt&&JSON.stringify(r.answerFields||[])===JSON.stringify(answerFields)&&JSON.stringify(r.answerSettings||null)===JSON.stringify(answerSettings||null)&&Boolean(r.webSearch)===webSearch&&(r.requestSettings?.system||'')===(system||'')).flatMap(r=>(Array.isArray(r.annotations)&&r.annotations.length?r.annotations.filter((a:any)=>a?.status==='done'):[r]).flatMap((request:any)=>{const sample=usageSample(provider,request.usage);return sample?[sample]:[];}));
 const result=estimate(config,inputs,samples);
 if(ownPrice)result.ownPrice=ownPrice;else if(research&&!priceFor(provider,model))result.unknown='The Lab has no price for this model. Type its price under Sampling & limits to have its cost estimated.';
 const notice=remainingEstimateNotice(rows);
 return notice?{...result,unknown:notice}:result;
}

// Counts stay in this open page's memory. Neither API keys nor counts are saved.
// Repeated subjects/files reuse counts only under identical request settings.
const fileCounts=new WeakMap<File,Map<string,number>>(),subjectCounts=new Map<string,number>();
type CountingOptions={provider:Provider;model:string;effort:string;prompt:string;system?:string;rows:any[];answerFields?:string[];answerSettings?:AnswerSettings;knowledge?:boolean;webSearch?:boolean;cache?:boolean;batch?:boolean;times?:(row:any)=>number;maxOutput?:number;ownPrice?:OwnPrice;research?:boolean;apiKey:string;signal:AbortSignal;onProgress?:(completed:number,total:number)=>void};
function signature(c:{provider:Provider;model:string;effort:string;prompt:string;system?:string;answerFields?:string[];answerSettings?:AnswerSettings;knowledge?:boolean;webSearch?:boolean}){return JSON.stringify([c.provider,c.model,c.effort,c.prompt,c.answerFields||[],!!c.knowledge,!!c.webSearch,...(c.answerSettings?[c.answerSettings]:[]),...(c.system?[{system:c.system}]:[])]);}
function countFromCache(row:any,c:{provider:Provider;model:string;effort:string;prompt:string;system?:string;answerFields?:string[];answerSettings?:AnswerSettings;knowledge?:boolean;webSearch?:boolean}){const sig=signature(c);return c.knowledge?subjectCounts.get(sig+'\n'+knowledgeItemText(row.fields)):fileCounts.get(row.file)?.get(sig);}
export async function countStudentInputs(c:CountingOptions){
 if(!c.apiKey.trim())throw Error('Enter your selected provider’s API key first.');
 const pending=c.rows.filter(r=>r.status==='pending');let completed=0;
 for(const row of pending){c.signal.throwIfAborted();if(countFromCache(row,c)===undefined){
  const form=new FormData();form.set('provider',c.provider);form.set('model',c.model);form.set('effort',c.effort);form.set('prompt',c.prompt);form.set('answerFields',JSON.stringify(c.answerFields||[]));if(c.answerSettings)form.set('answerSettings',JSON.stringify(c.answerSettings));if(c.system)form.set('requestSettings',JSON.stringify({system:c.system}));
  if(c.knowledge){form.set('mode','model-knowledge');form.set('fields',JSON.stringify(row.fields));form.set('webSearch',String(!!c.webSearch));}else form.set('file',row.file);
  const r=await fetch('/api/count-tokens',{method:'POST',headers:{Authorization:'Bearer '+c.apiKey.trim()},body:form,signal:c.signal}),out=await r.json() as {error?:string;inputTokens?:number};
  if(!r.ok||!Number.isSafeInteger(out.inputTokens)||out.inputTokens!<0)throw Error(out.error||'The provider could not count this input. The rough estimate is still available.');
  const sig=signature(c);if(c.knowledge){if(subjectCounts.size>=10000)subjectCounts.clear();subjectCounts.set(sig+'\n'+knowledgeItemText(row.fields),out.inputTokens!);}else{let map=fileCounts.get(row.file);if(!map){map=new Map();fileCounts.set(row.file,map);}if(map.size>=20)map.clear();map.set(sig,out.inputTokens!);}
 }c.onProgress?.(++completed,pending.length);}
 return studentEstimate(c);
}

// Research mode: the texts of a run that are probably too long for the model: the prompt and the text, at the middle
// of their estimated length in tokens, with room for the longest answer, more than its context window. Only a
// Claude model's window is known; for any other model, none. rows: the texts (or subjects) of the run. pdfs false:
// PDFs are not read (reading every PDF of a corpus takes long; before a run they are).
export async function tooLongTexts({provider,model,prompt,system,rows,knowledge=false,maxOutput,signal,pdfs=true}:{provider:Provider;model:string;prompt:string;system?:string;rows:any[];knowledge?:boolean;maxOutput?:number;signal?:AbortSignal;pdfs?:boolean}):Promise<{window?:number;names:string[]}>{
 const window=contextWindow(provider,model);if(!window)return {names:[]};
 const multiplier=priceFor(provider,model)?.tokenMultiplier||1,middle=(r:{low:number;high:number})=>(r.low+r.high)/2*multiplier;
 const room=window-middle(textTokens((system||'')+'\n'+prompt))-(maxOutput??annotationOutputLimit(provider,model)),names:string[]=[];
 for(const row of rows){
  signal?.throwIfAborted();
  // A text file has at most as many characters as bytes: one that short cannot be too long, and is not read.
  if(!knowledge&&row.file&&(/\.pdf$/i.test(row.file.name)?!pdfs:row.file.size*multiplier/3.2<room))continue;
  const tokens=knowledge?textTokens(knowledgeItemText(row.fields)):(await fileInput(row.file).catch(()=>undefined))?.tokens;
  if(tokens&&middle(tokens)>room)names.push(String(row.name));
 }
 return {window,names};
}
// Research mode, before a run of more than 50 requests or with texts that are probably too long: the question to
// confirm, with the estimated cost (as in the cost estimate; batch price for a batch). rows: the texts of the run;
// samples: the study's results, which calibrate the estimate. undefined: nothing to ask.
export async function runQuestion(o:{provider:Provider;model:string;effort:string;prompt:string;system?:string;rows:any[];samples:any[];answerFields?:string[];answerSettings?:AnswerSettings;knowledge?:boolean;webSearch?:boolean;cache?:boolean;batch?:boolean;times:number;maxOutput?:number;ownPrice?:OwnPrice;unit:string}):Promise<string|undefined>{
 const requests=o.rows.length*Math.max(1,o.times),long=await tooLongTexts(o);
 if(requests<=50&&!long.names.length)return undefined;
 let cost='no price known for this model';
 try{
  const result=await studentEstimate({...o,rows:[...o.rows.map(row=>({...row,status:'pending'})),...o.samples.filter(row=>row.status==='done')],times:()=>o.times,research:true});
  const range=o.batch?result.batch:result.total;
  if(!result.unknown&&range)cost='about '+money(range)+(o.batch?' at batch price (½)':'')+' (a rough guide; see the cost estimate for how it is worked out)';
 }catch{cost='the cost could not be estimated';}
 const n=requests.toLocaleString('en-US'),units=o.unit+'s',few=long.names.slice(0,3).join(', ');
 const longText=long.names.length?`\n\n${long.names.length} ${long.names.length===1?o.unit+' is':units+' are'} probably too long for this model (about ${Math.round((long.window??0)/1000)}k tokens including the answer), e.g. ${few}. Those requests will most likely fail.`:'';
 return `${o.batch?'Submit a batch of':'Send'} ${n} request${requests===1?'':'s'} to ${o.model}${o.times>1?` (${o.rows.length.toLocaleString('en-US')} ${units} × ${o.times} annotations)`:''}? Provider charges apply: ${cost}.${longText}`;
}
