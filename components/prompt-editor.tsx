import {useRef,useState} from 'react';
import {Maximize2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';

// "Expand": the prompt in a large window, for long prompts that the setup column wraps into a narrow strip. The
// window edits the same prompt as the box (each keystroke goes straight back), so there is nothing to save or
// cancel. Closing it returns to the box, with the cursor where it was left in the window.
// target: the id of the box it expands. title: the window's heading (the box's label).
export function ExpandPrompt({target,title,value,maxLength,disabled,placeholder,onChange}:{target:string;title:string;value:string;maxLength:number;disabled?:boolean;placeholder?:string;onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false);
 const area=useRef<HTMLTextAreaElement>(null),caret=useRef<[number,number]>([0,0]);
 const box=()=>document.getElementById(target) as HTMLTextAreaElement|null;
 const show=()=>{const small=box();caret.current=small?[small.selectionStart,small.selectionEnd]:[value.length,value.length];setOpen(true);};
 return <>
  <button type="button" className="prompt-expand" onClick={show} disabled={disabled} aria-label={'Expand the '+title.toLowerCase()} title={'Open the '+title.toLowerCase()+' in a large window'}><Maximize2 size={13} aria-hidden="true"/>Expand</button>
  <Dialog open={open} onOpenChange={setOpen}>
   <DialogContent className="prompt-editor-dialog" onOpenAutoFocus={event=>{event.preventDefault();const editor=area.current;if(!editor)return;editor.focus();editor.setSelectionRange(...caret.current);}} onCloseAutoFocus={event=>{event.preventDefault();const small=box();if(!small)return;small.focus();small.setSelectionRange(...caret.current);}}>
    <div className="prompt-editor-head"><DialogTitle>{title}</DialogTitle><DialogDescription>Changes go straight into your study.</DialogDescription></div>
    <textarea ref={area} aria-label={title} value={value} maxLength={maxLength} placeholder={placeholder} spellCheck onSelect={event=>{caret.current=[event.currentTarget.selectionStart,event.currentTarget.selectionEnd];}} onChange={event=>onChange(event.target.value)}/>
    <div className="prompt-editor-foot"><span className="count">{value.length.toLocaleString('en-US')} characters</span><Button onClick={()=>setOpen(false)}>Done</Button></div>
   </DialogContent>
  </Dialog>
 </>;
}
