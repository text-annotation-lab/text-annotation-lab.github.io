import {Button} from '@/components/ui/button';

export function ResultPages({total,page,onPageChange}:{total:number;page:number;onPageChange:(page:number)=>void}){
 if(total<=100)return null;
 const pages=Math.ceil(total/100),current=Math.min(page,pages-1);
 return <nav className="result-pages" aria-label="Result pages"><span>Showing {current*100+1}–{Math.min(total,(current+1)*100)} of {total.toLocaleString()} · exports include all items</span><div><Button variant="outline" disabled={current===0} onClick={()=>onPageChange(current-1)}>Previous</Button><span>Page {current+1} of {pages}</span><Button variant="outline" disabled={current===pages-1} onClick={()=>onPageChange(current+1)}>Next</Button></div></nav>;
}
