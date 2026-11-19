import {useState} from 'react';

// On the ASCA page the Lab fills the whole window and covers AU's own cookie link, so the footer offers one instead.
// The ASCA page's embed code (docs/au-embed.html) opens AU's cookie preferences when it gets this message.
export const ASCA_ORIGIN='https://asca.au.dk';
export const COOKIE_MESSAGE='text-annotation-lab:cookie-preferences';

export function embeddedInAsca(win:Window=window,doc:Document=document){
 if(win.parent===win)return false;
 const ancestor=win.location.ancestorOrigins?.[0];
 if(ancestor)return ancestor===ASCA_ORIGIN;
 try{return new URL(doc.referrer).origin===ASCA_ORIGIN;}catch{return false;}
}

export function AuCookieLink(){
 const [shown]=useState(()=>typeof window!=='undefined'&&embeddedInAsca());
 if(!shown)return null;
 return <button type="button" className="textbutton footer-cookie-link" onClick={()=>window.parent.postMessage({type:COOKIE_MESSAGE},ASCA_ORIGIN)}>AU cookie preferences</button>;
}
