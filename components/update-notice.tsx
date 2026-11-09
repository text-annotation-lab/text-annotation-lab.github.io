'use client';
import {useEffect,useState} from 'react';
import {isStaleBuild,STALE_BUILD_EVENT} from '@/lib/stale-build';

// Shown when part of the Lab fails to load, which almost always means a newer
// version was published while this page was open. Reloading fixes it.
export function UpdateNotice(){
 const [show,setShow]=useState(isStaleBuild);
 useEffect(()=>{const on=()=>setShow(true);window.addEventListener(STALE_BUILD_EVENT,on);return()=>window.removeEventListener(STALE_BUILD_EVENT,on);},[]);
 if(!show)return null;
 return <div className="update-notice" role="alert"><p><strong>Part of the Lab could not load.</strong> The Lab was probably updated while this page was open. Reload the page to get the current version. Your documents and results are autosaved in this browser, but you will need to enter your API key again. If annotations are running, wait until they finish.</p><div className="update-notice-actions"><button type="button" onClick={()=>window.location.reload()}>Reload page</button><button type="button" className="textbutton" onClick={()=>setShow(false)}>Not now</button></div></div>;
}
