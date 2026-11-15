'use client';
// Research mode's answer fields. Each field has a type, the values it allows,
// and a description for the model (a codebook entry); or the whole reply is
// kept as plain text. A field left as free text without a description is sent
// exactly as the standard Lab sends it.
import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowUp,Plus,Trash2} from 'lucide-react';
import {FIELD_TYPES,FIELD_TYPE_LABELS,MAX_ANSWER_FIELDS,PLAIN_FIELD,fieldSpec,toNumber,type AnswerSettings,type FieldSpec,type FieldType} from '@/lib/answer-types';

// A field as typed: the name and the list of values stay as written until they are usable.
type Draft={name:string;type:FieldType;values:string;description:string};
const draftsOf=(names:string[],settings?:AnswerSettings):Draft[]=>names.map(name=>{const spec=fieldSpec(settings,name);return {name,type:spec?.type||'text',values:(spec?.values||[]).join(', '),description:spec?.description||''};});
const listed=(text:string)=>text.split(',').map(value=>value.trim()).filter(Boolean);
const takesValues=(type:FieldType)=>type==='category'||type==='ordinal';
// What the drafts stand for: the fields with a name of their own, in order.
export function fieldsFromDrafts(drafts:Draft[]):{names:string[];fields:FieldSpec[]}{
 const names:string[]=[],fields:FieldSpec[]=[];
 for(const draft of drafts){
  const name=draft.name.trim();
  if(!name||name.length>60||names.length>=MAX_ANSWER_FIELDS||names.some(other=>other.toLowerCase()===name.toLowerCase()))continue;
  names.push(name);
  if(draft.type!=='text'||draft.description.trim())fields.push({name,type:draft.type,values:takesValues(draft.type)?listed(draft.values):[],description:draft.description});
 }
 return {names,fields};
}
const problemOf=(drafts:Draft[],index:number)=>{
 const name=drafts[index].name.trim().toLowerCase();
 if(!name)return 'Name this field; a field without a name is not sent.';
 return drafts.slice(0,index).some(other=>other.name.trim().toLowerCase()===name)?'That field name is already in use; this field is not sent.':'';
};

export function OutputEditor({names,settings,onChange,disabled}:{names:string[];settings?:AnswerSettings;onChange:(names:string[],settings:AnswerSettings|undefined)=>void;disabled:boolean}){
 const [drafts,setDrafts]=useState<Draft[]>(()=>draftsOf(names,settings)),[startOpen]=useState(()=>settings?.plain===true||names.length>0),box=useRef<HTMLDetailsElement>(null);
 const plain=settings?.plain===true,rationale=settings?.rationale!==false;
 // A study or saved prompt loaded elsewhere replaces what is being typed here.
 const outside=JSON.stringify(fieldsFromDrafts(draftsOf(names,settings))),own=JSON.stringify(fieldsFromDrafts(drafts));
 useEffect(()=>{if(outside===own)return;setDrafts(draftsOf(names,settings));if((names.length||settings?.plain)&&box.current)box.current.open=true;},[outside]);
 const emit=(next:Draft[],changes:{plain?:boolean;rationale?:boolean}={})=>{
  const {names:nextNames,fields}=fieldsFromDrafts(next),isPlain=changes.plain??plain,asks=changes.rationale??rationale;
  const nextSettings:AnswerSettings={...(isPlain?{plain:true as const}:{}),...(asks?{}:{rationale:false as const}),...(fields.length?{fields}:{})};
  onChange(nextNames,Object.keys(nextSettings).length?nextSettings:undefined);
 };
 const change=(next:Draft[])=>{if(disabled)return;setDrafts(next);emit(next);};
 const edit=(index:number,changes:Partial<Draft>)=>change(drafts.map((draft,i)=>i===index?{...draft,...changes}:draft));
 const move=(index:number,by:number)=>{const next=[...drafts];[next[index],next[index+by]]=[next[index+by],next[index]];change(next);};
 const remove=(index:number)=>{
  const draft=drafts[index];
  if((draft.description.trim()||draft.values.trim())&&!confirm(`Remove the field “${draft.name.trim()||'without a name'}” with its description and values?`))return;
  change(drafts.filter((_,i)=>i!==index));
 };
 const count=fieldsFromDrafts(drafts).names.length;
 return <details className="answer-fields research-output" ref={box} open={startOpen}>
  <summary>Answer fields{plain?' (plain text)':count?` (${count})`:' (optional)'}</summary>
  <div className="research-segment research-output-mode" role="radiogroup" aria-label="Answer format">
   <button type="button" role="radio" aria-checked={!plain} disabled={disabled} onClick={()=>emit(drafts,{plain:false})}>Structured fields</button>
   <button type="button" role="radio" aria-checked={plain} disabled={disabled} onClick={()=>emit(drafts,{plain:true})}>Plain text</button>
  </div>
  {plain?<p className="hint">The whole reply is stored as one column, “{PLAIN_FIELD}.” No answer format is sent or added to your prompt, and no explanation is asked for separately.</p>:<>
   <p className="hint">{drafts.length?'The model must return exactly these fields, so every result becomes a clean column. It writes them in this order.':'Without fields, the model returns one score or category. Add fields to get one column per judgment.'}</p>
   {drafts.map((draft,index)=>{
    const problem=problemOf(drafts,index),notWhole=draft.type==='ordinal'&&listed(draft.values).some(value=>!Number.isInteger(toNumber(value)));
    return <div className="research-field" key={index}>
     <div className="research-field-top">
      <input aria-label="Field name" placeholder="Name, e.g., Tone" maxLength={60} value={draft.name} disabled={disabled} onChange={event=>edit(index,{name:event.target.value})}/>
      <button type="button" className="research-icon-button" title="Move up (the model writes the fields in this order)" aria-label="Move field up" disabled={disabled||index===0} onClick={()=>move(index,-1)}><ArrowUp size={15} aria-hidden="true"/></button>
      <button type="button" className="research-icon-button" title="Move down (the model writes the fields in this order)" aria-label="Move field down" disabled={disabled||index===drafts.length-1} onClick={()=>move(index,1)}><ArrowDown size={15} aria-hidden="true"/></button>
      <button type="button" className="research-icon-button" title="Remove field" aria-label="Remove field" disabled={disabled} onClick={()=>remove(index)}><Trash2 size={15} aria-hidden="true"/></button>
     </div>
     <div className="research-field-row">
      <select aria-label="Field type" value={draft.type} disabled={disabled} onChange={event=>edit(index,{type:event.target.value as FieldType})}>{FIELD_TYPES.map(type=><option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}</select>
      {takesValues(draft.type)&&<input aria-label="Allowed values" placeholder={draft.type==='ordinal'?'Allowed values, e.g., 0, 1, 2':'Allowed values, e.g., positive, neutral, negative'} value={draft.values} disabled={disabled} onChange={event=>edit(index,{values:event.target.value})}/>}
     </div>
     {notWhole&&<p className="hint research-field-problem" role="status">Ordinal values must be whole numbers; other values are not sent.</p>}
     <input aria-label="Field description" placeholder="Description for the model (optional)" maxLength={2000} value={draft.description} disabled={disabled} onChange={event=>edit(index,{description:event.target.value})}/>
     {problem&&<p className="hint research-field-problem" role="status">{problem}</p>}
    </div>;
   })}
   {drafts.length<MAX_ANSWER_FIELDS&&<button type="button" className="textbutton research-add-field" disabled={disabled} onClick={()=>change([...drafts,{name:'',type:'category',values:'',description:''}])}><Plus size={14} aria-hidden="true"/>Add field</button>}
   <label className="research-check research-output-check"><input type="checkbox" checked={rationale} disabled={disabled} onChange={event=>emit(drafts,{rationale:event.target.checked})}/><span>Ask for an explanation<small>Written before the answers; useful when checking disagreements.</small></span></label>
  </>}
  <p className="hint">Changes apply to future annotations. Results keep the fields they were made with.</p>
 </details>;
}
