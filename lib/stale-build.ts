// Each publish replaces the Lab's files. A page opened before a publish still asks
// for the old files when it loads a section, the chart, or the Excel export, and
// those requests fail. Vite reports every such failure as 'vite:preloadError'.
export const STALE_BUILD_EVENT='text-annotation-lab:stale-build';
let stale=false;
export const isStaleBuild=()=>stale;
export function watchForStaleBuild(){
 window.addEventListener('vite:preloadError',()=>{
  if(stale)return;
  stale=true;
  window.dispatchEvent(new Event(STALE_BUILD_EVENT));
 });
}
