// Research mode: a request as a person reads it, for "Preview request". The request itself is built by
// lib/request-frame.ts, the same code that sends it, so the preview cannot differ from what is sent.
import {fillRequest,requestFrame,LAYOUT,type FrameSettings} from '../request-frame';

// system: research mode's own system prompt, where one is sent. message: the message as the model reads it (the
// prompt with the Lab's own instructions, then the document). settings: everything else in the body. cached,
// systemCached: the message, or the system prompt, carries the mark for the provider's prompt cache.
export type RequestView={url:string;system?:string;systemCached?:boolean;message:string;settings:Record<string,unknown>;cached:boolean;body:unknown};
export const PREVIEW_PLACEHOLDER={text:'(your text appears here)',subject:'(your subject’s fields appear here)'} as const;

const isFile=(part:any)=>part?.type==='input_file'||part?.type==='file'||part?.type==='document'||Boolean(part?.inlineData);
// The words of a message, whichever way a provider writes them: a string, or parts that are text or a file. The
// parts of a text are one text (a cache mark divides the part every text shares from the rest).
const words=(content:any):string=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>typeof part?.text==='string'?part.text:isFile(part)?'\n\n[The PDF file is attached here.]':'').join(''):'';
const whole=(content:any):string=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>typeof part?.text==='string'?part.text:'').join(''):'';
const marked=(content:any):boolean=>Array.isArray(content)&&content.some(part=>Boolean(part?.cache_control||part?.prompt_cache_breakpoint));

// The parts of a request body, for any of the four providers.
export function splitRequest(body:any):Pick<RequestView,'system'|'systemCached'|'message'|'settings'|'cached'>{
 const settings:Record<string,any>=JSON.parse(JSON.stringify(body??{}));
 // system: what stands in the provider's place for a system prompt. contents: the messages after it.
 let system:string|undefined,systemCached=false,contents:any[]=[];
 if(settings.systemInstruction||Array.isArray(settings.contents)){
  // Gemini
  if(settings.systemInstruction)system=whole(settings.systemInstruction.parts);
  contents=(settings.contents||[]).map((item:any)=>item?.parts);
  delete settings.systemInstruction;delete settings.contents;
 }else if(settings.input!==undefined){
  // OpenAI: `instructions`, or a developer message when it carries the cache mark.
  const input:any[]=Array.isArray(settings.input)?[...settings.input]:[{content:settings.input}];
  if(typeof settings.instructions==='string'){system=settings.instructions;delete settings.instructions;}
  else if(input[0]?.role==='developer'){const first=input.shift();system=whole(first.content);systemCached=marked(first.content);}
  contents=input.map(item=>item?.content);delete settings.input;
 }else if(Array.isArray(settings.messages)){
  // Anthropic (`system`) and OpenRouter (a system message)
  const messages:any[]=[...settings.messages];
  if(settings.system!==undefined){system=whole(settings.system);systemCached=marked(settings.system);delete settings.system;}
  else if(messages[0]?.role==='system'){const first=messages.shift();system=whole(first.content);systemCached=marked(first.content);}
  contents=messages.map(item=>item?.content);delete settings.messages;
 }
 return {...(system!==undefined?{system,systemCached}:{}),message:contents.map(words).join('\n\n'),cached:marked(contents[0]),settings};
}

// The request a run would send for one document, in the current layout. A PDF sent as a file is named, not shown.
export function previewRequest(settings:FrameSettings,doc:({filename:string;text:string}|{filename:string;pdf:true})&{inserts?:Map<string,string>}):RequestView{
 const pdf='pdf' in doc,frame=requestFrame({...settings,layout:LAYOUT},pdf);
 const body=fillRequest(frame.body,pdf?{filename:doc.filename,file:'[the PDF file, base64-encoded]',inserts:doc.inserts}:{filename:doc.filename,text:doc.text,inserts:doc.inserts});
 return {url:frame.url,...splitRequest(body),body};
}
