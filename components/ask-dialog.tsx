import {useEffect,useRef,useState} from 'react';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {askParts,setAskHost,type Question} from '@/lib/ask';

// The window in which the Lab asks its yes/no questions (lib/ask.ts). One is on the page, beside the Lab itself.
export function AskDialog(){
 const [question,setQuestion]=useState<Question>();
 const current=useRef<Question|undefined>(undefined),yes=useRef<HTMLButtonElement>(null),no=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  // A second question while one is open answers the first with no.
  setAskHost(next=>{current.current?.resolve(false);current.current=next;setQuestion(next);});
  return()=>{setAskHost(undefined);current.current?.resolve(false);current.current=undefined;};
 },[]);
 const answer=(value:boolean)=>{const asked=current.current;current.current=undefined;setQuestion(undefined);asked?.resolve(value);};
 if(!question)return null;
 const parts=askParts(question.message,question.title);
 return <AlertDialog open onOpenChange={open=>{if(!open)answer(false);}}>
  <AlertDialogContent className="ask-dialog" onOpenAutoFocus={event=>{event.preventDefault();(question.danger?no:yes).current?.focus();}} {...(parts.text.length?{}:{'aria-describedby':undefined})}>
   <AlertDialogHeader>
    <AlertDialogTitle>{parts.title}</AlertDialogTitle>
    {parts.text.length>0&&<AlertDialogDescription asChild><div className="ask-text">{parts.text.map((text,index)=><p key={index}>{text}</p>)}</div></AlertDialogDescription>}
   </AlertDialogHeader>
   <AlertDialogFooter>
    <AlertDialogCancel ref={no} onClick={()=>answer(false)}>{question.no??'Cancel'}</AlertDialogCancel>
    <AlertDialogAction ref={yes} variant={question.danger?'destructive':'default'} onClick={()=>answer(true)}>{question.yes??'OK'}</AlertDialogAction>
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
