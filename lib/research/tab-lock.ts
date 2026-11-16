// Research mode works in one tab at a time, as the same author's separate research tool does: two tabs on the same
// data could send (and pay for) the same requests twice, or overwrite each other's changes. The tab in research mode
// holds a Web Lock until it turns research mode off, or is closed or reloaded. The standard Lab takes no part.
//
// A tab that opens in research mode while another tab holds it shows a notice instead of the Lab, and asks again only
// when the user turns to it (switches to it, clicks in it, or clicks "Open here"), and a few times in the moment right
// after it has loaded; it never polls: a window that is merely in view must not take research mode from a tab that is
// being reloaded (the lock is free for a moment during a reload). A tab in the standard Lab that is switched to research
// mode asks once, and stays in the standard Lab if it is refused.

export const LOCK='text-annotation-lab-research';

export type TabLock={
 /** Asks for research mode without waiting for it (true when this tab has it). If refused, it asks again a few times
  * for a moment afterwards, but only while this tab keeps the focus; after the first call at page load also without it.
  * A refusal shows the notice (setWaiting(true)). */
 ask:()=>Promise<boolean>;
 /** Asks once, for switching on research mode in the standard Lab. A refusal does not show the notice. */
 claim:()=>Promise<boolean>;
 /** Lets research mode go (research mode turned off in this tab). */
 release:()=>void;
 held:()=>boolean;
};

export function tabLock(locks:Pick<LockManager,'request'>,setWaiting:(waiting:boolean)=>void,focused:()=>boolean):TabLock{
 let held=false,loaded=false,generation=0;
 let letGo:(()=>void)|undefined;
 // One request at a time: e.g. visibilitychange and focus fire together when the user switches to this tab.
 let pending:Promise<boolean>|undefined;
 let again:ReturnType<typeof setTimeout>|undefined;
 const once=(show:boolean)=>{
  const asked=generation;
  return new Promise<boolean>(resolve=>{
   let answered=false;
   locks.request(LOCK,{ifAvailable:true},lock=>{
    answered=true;
    // Research mode was turned off while this request was on its way: the lock is let go at once.
    if(asked!==generation||held){resolve(held);return;}
    if(!lock){if(show)setWaiting(true);resolve(false);return;}
    held=true;setWaiting(false);resolve(true);
    return new Promise<void>(done=>{letGo=done;}); // held until research mode is turned off, or this tab is closed or reloaded
   }).catch(()=>{
    // Locks unusable here (e.g. a sandboxed frame): research mode works without them, as in browsers that have none.
    // Not when the lock did answer and only this tab's own handling failed: another tab may hold it.
    if(!answered&&asked===generation&&!held){held=true;setWaiting(false);}
    resolve(held);
   });
  });
 };
 const attempt=(show:boolean)=>{
  if(held)return Promise.resolve(true);
  if(!pending){const request:Promise<boolean>=once(show).finally(()=>{if(pending===request)pending=undefined;});pending=request;}
  return pending;
 };
 // Closing the tab in research mode brings this one to the front a moment before the closed tab lets go of the lock
 // (about 20 ms in Chrome): ask again shortly while this tab keeps the focus. A tab the user has left stops asking. At
 // page load, whether focused or not: a page loaded in place of the Lab's own page (another address of the Lab in the
 // same tab) asks before the old page has let go.
 const retry=(tries:number,atLoad:boolean):Promise<boolean>=>{
  clearTimeout(again);
  const asked=generation;
  return attempt(true).then(ok=>{
   if(!ok&&tries>1&&asked===generation){
    clearTimeout(again);
    again=setTimeout(()=>{if(asked===generation&&(atLoad||focused()))void retry(tries-1,atLoad);},500);
   }
   return ok;
  });
 };
 return {
  ask(){const atLoad=!loaded;loaded=true;return retry(4,atLoad);},
  claim(){loaded=true;return attempt(false);},
  release(){generation++;clearTimeout(again);pending=undefined;held=false;letGo?.();letGo=undefined;setWaiting(false);},
  held:()=>held,
 };
}
