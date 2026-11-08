'use client';
import {useId,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {suggestedYear,validChartYear,type ChartRow} from '@/lib/results-chart';

const pageSize=20;
export function ChartYearReview({rows,onApply,onCancel}:{
 rows:ChartRow[];onApply:(years:Map<string,number|null>)=>void;onCancel:()=>void;
}) {
 const heading=useId();
 const [edits,setEdits]=useState(()=>new Map<string,string>());
 const [page,setPage]=useState(0);
 const values=useMemo(()=>rows.map(row=>{
  const initial=row.chartYear===undefined?suggestedYear(row.sourceName||row.name):validChartYear(row.chartYear)?String(row.chartYear):'';
  return {row,value:edits.get(row.id)??initial};
 }),[rows,edits]);
 const valid=values.filter(({value})=>/^[1-9]\d{3}$/.test(value)).length;
 const invalid=values.some(({value})=>value!==''&&!/^[1-9]\d{3}$/.test(value));
 const start=Math.min(page,Math.max(0,Math.ceil(values.length/pageSize)-1))*pageSize;
 return <section aria-labelledby={heading} className="chart-year-review">
  <h3 id={heading}>Review years</h3>
  <p>Check the years suggested by the filenames. Leave a year blank to omit that text.</p>
  <div className="year-review-list"><table><thead><tr><th scope="col">Filename</th><th scope="col">Year</th></tr></thead>
   <tbody>{values.slice(start,start+pageSize).map(({row,value})=><tr key={row.id}>
    <td>{row.name}</td><td><input type="text" inputMode="numeric" aria-label={'Year for '+row.name}
     aria-invalid={Boolean(value&&!/^[1-9]\d{3}$/.test(value))} maxLength={4} value={value}
     onChange={event=>{const next=event.target.value;setEdits(current=>new Map(current).set(row.id,next));}}/></td>
   </tr>)}</tbody></table></div>
  {values.length>pageSize&&<div className="chart-pages"><Button variant="outline" disabled={!start} onClick={()=>setPage(start/pageSize-1)}>Previous</Button>
   <span>{start+1}–{Math.min(start+pageSize,values.length)} of {values.length}</span>
   <Button variant="outline" disabled={start+pageSize>=values.length} onClick={()=>setPage(start/pageSize+1)}>Next</Button></div>}
  <p role="status">{invalid?'Use a four-digit year or leave it blank.':`${valid} of ${values.length} texts will be plotted.`}</p>
  <div className="year-review-actions"><Button variant="outline" onClick={onCancel}>Cancel</Button>
   <Button disabled={invalid||!valid} onClick={()=>onApply(new Map(values.map(({row,value})=>[row.id,value?Number(value):null])))}>Plot by year</Button></div>
 </section>;
}
