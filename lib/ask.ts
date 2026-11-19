// The Lab asks its yes/no questions in its own window (components/ask-dialog.tsx), not the browser's box: that box
// is unstyled and, where the Lab is embedded, is titled with the embedded page's address.
export type AskOptions={
 // The window's heading. Left out, the first sentence of the message is the heading and the rest is the text.
 title?:string;
 // The button that says yes ("OK" when left out) and the one that says no ("Cancel").
 yes?:string;no?:string;
 // The yes button deletes or discards something: it is shown in red, and Enter does not press it.
 danger?:boolean;
};
export type Question=AskOptions&{message:string;resolve:(yes:boolean)=>void};
type Host=(question:Question)=>void;
let host:Host|undefined;
// The window registers itself here while it is on the page.
export const setAskHost=(next?:Host)=>{host=next;};
// Without the window (the tests, which call the code with no page), the answer comes at once from the
// environment's own confirm, or is yes where there is none.
function atOnce(message:string):boolean{
 const own=(globalThis as {confirm?:(message:string)=>boolean}).confirm;
 return typeof own==='function'?own(message):true;
}
// For code that can wait for the answer.
export function ask(message:string,options:AskOptions={}):Promise<boolean>{
 if(!host)return Promise.resolve(atOnce(message));
 const show=host;return new Promise(resolve=>show({...options,message,resolve}));
}
// For handlers that do not wait: `then` runs after a yes.
export function askThen(message:string,then:()=>void,options:AskOptions={}):void{
 if(!host){if(atOnce(message))then();return;}
 host({...options,message,resolve:yes=>{if(yes)then();}});
}
// The heading and the paragraphs the window shows for a message.
export function askParts(message:string,title?:string):{title:string;text:string[]}{
 const paragraphs=(text:string)=>text.split(/\n{2,}/).map(part=>part.trim()).filter(Boolean);
 if(title)return {title,text:paragraphs(message)};
 const first=message.trim().match(/^([^\n]*?[?.!])(?:\s+|$)/);
 if(!first)return {title:message.trim(),text:[]};
 return {title:first[1],text:paragraphs(message.trim().slice(first[0].length))};
}
