import {Button} from '@/components/ui/button';

// compact: small ‹ › buttons (research mode) instead of Previous / Next.
export function ResultPages({total,page,onPageChange,compact}:{total:number;page:number;onPageChange:(page:number)=>void;compact?:boolean}){
 if(total<=100)return null;
 const pages=Math.ceil(total/100),current=Math.min(page,pages-1);
 return <nav className={compact?'result-pages compact':'result-pages'} aria-label="Result pages"><span>Showing {current*100+1}–{Math.min(total,(current+1)*100)} of {total.toLocaleString()} · exports include all items</span><div><Button variant="outline" disabled={current===0} onClick={()=>onPageChange(current-1)} aria-label={compact?'Previous page':undefined} title={compact?'Previous page':undefined}>{compact?'‹':'Previous'}</Button><span>Page {current+1} of {pages}</span><Button variant="outline" disabled={current===pages-1} onClick={()=>onPageChange(current+1)} aria-label={compact?'Next page':undefined} title={compact?'Next page':undefined}>{compact?'›':'Next'}</Button></div></nav>;
}
