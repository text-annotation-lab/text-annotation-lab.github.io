import {answerValues,resultAnswer,answerLabel,type NamedAnswers} from '@/lib/answer-fields';
import {useState,type ReactNode} from 'react';
import {hasMarkdown,inlineParts,isWrittenAnswer,replyBlocks,replyPreview} from '@/lib/reply-text';
export function NamedAnswerDetail({row}:{row:NamedAnswers}){return row.answerFields?.length?<dl className="knowledge-fields">{row.answerFields.map(name=><div key={name}><dt>{name}</dt><dd>{(value=>value&&isWrittenAnswer(row,name)?<ReplyText text={value}/>:answerLabel(value)||'—')(resultAnswer(row,name))}</dd></div>)}</dl>:null;}
export function collectedAnswers(result:any,names:string[]=[]):NamedAnswers{if(result.error)return {answerFields:names,answers:Object.fromEntries(Object.entries(result.answers||{}).filter(([key,value])=>/^f\d+$/.test(key)&&typeof value==='string')) as Record<string,string>};return {answerFields:names,answers:answerValues(result,names)};}

function Line({text}:{text:string}){return <>{inlineParts(text).map((p,i)=>{let node:ReactNode=p.code?<code>{p.text}</code>:p.text;if(p.italic)node=<em>{node}</em>;if(p.bold)node=<strong>{node}</strong>;return <span key={i}>{node}</span>;})}</>;}

/** A written reply laid out (headings, bold, lists), with the reply exactly as received one click away. */
export function ReplyText({text}:{text:string}){
 const [raw,setRaw]=useState(false);
 if(!hasMarkdown(text))return <>{text}</>;
 return <div className="reply-text">{raw?<div className="reply-raw">{text}</div>:replyBlocks(text).map((b,i)=>b.kind==='heading'?<p key={i} className="reply-heading"><Line text={b.text}/></p>:b.kind==='paragraph'?<p key={i}>{b.lines.map((line,j)=><span key={j}>{j>0&&<br/>}<Line text={line}/></span>)}</p>:b.kind==='list'?(b.ordered?<ol key={i} start={b.start}>{b.items.map((item,j)=><li key={j}><Line text={item}/></li>)}</ol>:<ul key={i}>{b.items.map((item,j)=><li key={j}><Line text={item}/></li>)}</ul>):b.kind==='rule'?<hr key={i}/>:<pre key={i}>{b.text}</pre>)}<button type="button" className="textbutton" aria-pressed={raw} onClick={()=>setRaw(v=>!v)}>{raw?'Show laid out':'Show exactly as received'}</button></div>;
}

/** The table's preview of a written reply: no Markdown symbols, up to two lines. */
export function ReplyPreview({text}:{text:string}){const line=replyPreview(text);return <span className="answer-cell reply-preview" title={line.length>160?undefined:line}>{line||'—'}</span>;}
