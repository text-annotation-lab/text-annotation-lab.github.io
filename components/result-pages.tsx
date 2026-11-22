import type {ReactNode} from 'react';
import {Button} from '@/components/ui/button';

// compact: small ‹ › buttons (research mode) instead of Previous / Next. always: show the line even with one page,
// so that extra (research mode's Clear menu) has a place beside the count. unit: what the rows are.
export function ResultPages({total,page,onPageChange,compact,always,unit='text',extra}:{total:number;page:number;onPageChange:(page:number)=>void;compact?:boolean;always?:boolean;unit?:string;extra?:ReactNode}){
 if(total<=100&&!always)return null;
 const pages=Math.max(1,Math.ceil(total/100)),current=Math.min(page,pages-1);
 return <nav className={compact?'result-pages compact':'result-pages'} aria-label="Result pages"><span>{pages>1?<>Showing {current*100+1}–{Math.min(total,(current+1)*100)} of {total.toLocaleString('en-US')} · exports include all items</>:<>Showing {total.toLocaleString('en-US')} {total===1?unit:unit+'s'}</>}</span><div>{extra}{pages>1&&<><Button variant="outline" disabled={current===0} onClick={()=>onPageChange(current-1)} aria-label={compact?'Previous page':undefined} title={compact?'Previous page':undefined}>{compact?'‹':'Previous'}</Button><span>Page {current+1} of {pages}</span><Button variant="outline" disabled={current===pages-1} onClick={()=>onPageChange(current+1)} aria-label={compact?'Next page':undefined} title={compact?'Next page':undefined}>{compact?'›':'Next'}</Button></>}</div></nav>;
}
