// Deep links may point into a section whose content has not arrived yet.
// User-clicked top tabs bypass this helper and keep their current scroll position.
export function focusSectionWhenReady(id:string){
 let observer:MutationObserver|undefined;
 const focus=()=>{
  const heading=document.getElementById(id);
  if(!heading)return false;
  heading.focus();heading.scrollIntoView({block:'start'});observer?.disconnect();return true;
 };
 const frame=requestAnimationFrame(()=>{
  if(focus())return;
  observer=new MutationObserver(focus);
  observer.observe(document.body,{childList:true,subtree:true});
 });
 return()=>{cancelAnimationFrame(frame);observer?.disconnect();};
}
