// Research mode: a request as a person reads it, for "Preview request". The request itself is built by
// lib/request-frame.ts, the same code that sends it, so the preview cannot differ from what is sent.
import {fillRequest,requestFrame,type FrameSettings} from '../request-frame';

// prompt: the prompt as sent, with the Lab's own instructions. message: what carries the document.
// settings: everything else in the body. cached: the prompt is marked for the provider's prompt cache.
export type RequestView={url:string;prompt:string;message:string;settings:Record<string,unknown>;cached:boolean;body:unknown};
export const PREVIEW_PLACEHOLDER={text:'(your text appears here)',subject:'(your subject’s fields appear here)'} as const;

const isFile=(part:any)=>part?.type==='input_file'||part?.type==='file'||part?.type==='document'||Boolean(part?.inlineData);
// The words of a message, whichever way a provider writes them: a string, or parts that are text or a file.
const words=(content:any):string=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>typeof part?.text==='string'?part.text:isFile(part)?'[The PDF file is attached here.]':'').filter(Boolean).join('\n\n'):'';
// The prompt, which is one text even where it is sent in two parts (the part every text shares, which carries
// the cache mark, and the part that holds a text's own values).
const whole=(content:any):string=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
const marked=(content:any):boolean=>Array.isArray(content)&&content.some(part=>Boolean(part?.cache_control||part?.prompt_cache_breakpoint));

// The parts of a request body, for any of the four providers.
export function splitRequest(body:any):Pick<RequestView,'prompt'|'message'|'settings'|'cached'>{
 const settings:Record<string,any>=JSON.parse(JSON.stringify(body??{}));
 let prompt='',message='',cached=false;
 if(settings.systemInstruction||Array.isArray(settings.contents)){
  // Gemini
  prompt=whole(settings.systemInstruction?.parts);message=(settings.contents||[]).map((item:any)=>words(item?.parts)).join('\n\n');
  delete settings.systemInstruction;delete settings.contents;
 }else if(settings.input!==undefined){
  // OpenAI: the prompt is `instructions`, or a developer message when it carries the cache mark.
  const input:any[]=Array.isArray(settings.input)?[...settings.input]:[{content:settings.input}];
  if(typeof settings.instructions==='string'){prompt=settings.instructions;delete settings.instructions;}
  else if(input[0]?.role==='developer'){const first=input.shift();prompt=whole(first.content);cached=marked(first.content);}
  message=input.map(item=>words(item?.content)).join('\n\n');delete settings.input;
 }else if(Array.isArray(settings.messages)){
  // Anthropic (`system`) and OpenRouter (a system message)
  const messages:any[]=[...settings.messages];
  if(settings.system!==undefined){prompt=whole(settings.system);cached=marked(settings.system);delete settings.system;}
  else if(messages[0]?.role==='system'){const first=messages.shift();prompt=whole(first.content);cached=marked(first.content);}
  message=messages.map(item=>words(item?.content)).join('\n\n');delete settings.messages;
 }
 return {prompt,message,settings,cached};
}

// The request a run would send for one document. A PDF sent as a file is named, not shown.
export function previewRequest(settings:FrameSettings,doc:({filename:string;text:string}|{filename:string;pdf:true})&{inserts?:Map<string,string>}):RequestView{
 const pdf='pdf' in doc,frame=requestFrame(settings,pdf);
 const body=fillRequest(frame.body,pdf?{filename:doc.filename,file:'[the PDF file, base64-encoded]',inserts:doc.inserts}:{filename:doc.filename,text:doc.text,inserts:doc.inserts});
 return {url:frame.url,...splitRequest(body),body};
}
