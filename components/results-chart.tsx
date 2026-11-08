'use client';
import {useState,type ComponentType} from 'react';
import {ChartNoAxesCombined} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {ChartRow} from '@/lib/results-chart';

export type ResultsChartProps={rows:ChartRow[];onInspect:(id:string)=>void;subjectLabel?:string;onSaveYears?:(years:Map<string,number|null>)=>void};
export type ResultsChartDialogProps=ResultsChartProps&{open:boolean;onOpenChange:(open:boolean)=>void};
export function ResultsChart(props:ResultsChartProps){
 const [Chart,setChart]=useState<ComponentType<ResultsChartDialogProps>|null>(null),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 if(!props.rows.some(row=>row.status==='done'))return null;
 async function show(){
  setError('');if(Chart){setOpen(true);return;}setLoading(true);
  try{const module=await import('./results-chart-dialog');setChart(()=>module.default);setOpen(true);}catch{setError('Could not open the chart. Please try again.');}finally{setLoading(false);}
 }
 return <><Button variant="outline" disabled={loading} onClick={show}><ChartNoAxesCombined size={16} aria-hidden="true"/>{loading?'Opening chart…':'Chart results'}</Button>{error&&<span role="status" className="hint">{error}</span>}{Chart&&<Chart {...props} open={open} onOpenChange={setOpen}/>}</>;
}
