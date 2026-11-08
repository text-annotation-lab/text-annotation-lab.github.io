'use client';
import {useId,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Unit} from '@/lib/chart-model';

const pageSize=20;
type Entry={unit:Unit;initial:string};

/** Lets students check and correct the year or group of each text before plotting. */
export function ChartReview({kind,entries,noun,onApply,onCancel,rules,rule,onRuleChange}:{
 kind:'year'|'group';entries:Entry[];noun:string;
 onApply:(values:Map<string,string>)=>void;onCancel:()=>void;
 rules?:{value:string;label:string}[];rule?:string;onRuleChange?:(rule:string)=>void;
}){
 const heading=useId(),ruleId=useId();
 const [edits,setEdits]=useState(()=>new Map<string,string>());
 const [page,setPage]=useState(0);
 // Texts without a suggestion come first, so gaps are easy to spot.
 const values=useMemo(()=>entries.map(({unit,initial})=>({unit,value:edits.get(unit.key)??initial})).sort((a,b)=>Number(Boolean(a.value))-Number(Boolean(b.value))),[entries,edits]);
 const valid=(value:string)=>kind==='year'?/^[1-9]\d{3}$/.test(value):value.trim().length>0&&value.trim().length<=40;
 const invalid=values.some(({value})=>value!==''&&!valid(value));
 const filled=values.filter(({value})=>valid(value)).length;
 const groups=kind==='group'?Array.from(new Set(values.map(v=>v.value.trim()).filter(Boolean))):[];
 const start=Math.min(page,Math.max(0,Math.ceil(values.length/pageSize)-1))*pageSize;
 function renameGroup(from:string,to:string){setEdits(current=>{const next=new Map(current);for(const {unit,value} of values)if(value.trim()===from)next.set(unit.key,to);return next;});}
 return <section aria-labelledby={heading} className="chart-review">
  <h3 id={heading}>{kind==='year'?'Review years':'Set up groups'}</h3>
  <p>{kind==='year'?`Check the years read from the filenames. Leave a year blank to leave that ${noun.replace(/s$/,'')} out.`:`Give each ${noun.replace(/s$/,'')} a group. Leave it blank to leave it out. Groups are saved with your study.`}</p>
  {rules&&rules.length>0&&<div className="chart-review-rule"><label htmlFor={ruleId}>Suggest groups from</label><select id={ruleId} value={rule||''} onChange={event=>{setEdits(new Map());onRuleChange?.(event.target.value);}}>{rules.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></div>}
  {kind==='group'&&groups.length>0&&groups.length<=8&&<div className="chart-review-groups"><span>Rename groups</span>{groups.map(group=><input key={group} aria-label={`Rename group ${group}`} defaultValue={group} maxLength={40} onBlur={event=>{const next=event.target.value.trim();if(next&&next!==group)renameGroup(group,next);}}/>)}</div>}
  <div className="chart-review-list"><table><thead><tr><th scope="col">{noun==='subjects'?'Subject':'Filename'}</th><th scope="col">{kind==='year'?'Year':'Group'}</th></tr></thead>
   <tbody>{values.slice(start,start+pageSize).map(({unit,value})=><tr key={unit.key}>
    <td>{unit.name}</td><td><input type="text" inputMode={kind==='year'?'numeric':'text'} aria-label={`${kind==='year'?'Year':'Group'} for ${unit.name}`}
     aria-invalid={Boolean(value&&!valid(value))} maxLength={kind==='year'?4:40} value={value} placeholder={kind==='year'?'—':'No group'}
     onChange={event=>{const next=event.target.value;setEdits(current=>new Map(current).set(unit.key,next));}}/></td>
   </tr>)}</tbody></table></div>
  {values.length>pageSize&&<div className="chart-pages"><Button variant="outline" disabled={!start} onClick={()=>setPage(start/pageSize-1)}>Previous</Button>
   <span>{start+1}–{Math.min(start+pageSize,values.length)} of {values.length}</span>
   <Button variant="outline" disabled={start+pageSize>=values.length} onClick={()=>setPage(start/pageSize+1)}>Next</Button></div>}
  <p role="status" className="chart-review-status">{invalid?(kind==='year'?'Use a four-digit year or leave it blank.':'Use up to 40 characters or leave it blank.'):`${filled} of ${values.length} ${noun} will be plotted${kind==='group'?` in ${groups.length} ${groups.length===1?'group':'groups'}`:''}.`}</p>
  <div className="chart-review-actions"><Button variant="outline" onClick={onCancel}>Cancel</Button>
   <Button disabled={invalid||!filled} onClick={()=>onApply(new Map(values.map(({unit,value})=>[unit.key,value.trim()])))}>Save and plot</Button></div>
 </section>;
}
