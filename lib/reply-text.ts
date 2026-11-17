// How a written reply is shown (research mode). Models often format free text in Markdown: headings, bold,
// lists. The table previews it without the symbols, one line of the reply after another, and the details
// lay it out. Display only: what is sent, stored, and exported stays exactly as the model wrote it.
import {fieldSpec,isExplanationField,PLAIN_FIELD,type AnswerSettings} from './answer-types';

/** A plain-text reply, a Free text field, or the explanation of a research run; the standard Lab is left as is. */
export function isWrittenAnswer(row:{answerSettings?:AnswerSettings},name:string){
 const settings=row.answerSettings;if(!settings)return false;
 if(settings.plain)return name===PLAIN_FIELD;
 return fieldSpec(settings,name)?.type==='text'||isExplanationField(name);
}

export type Inline={text:string;bold?:true;italic?:true;code?:true};
export type Block={kind:'heading';level:number;text:string}|{kind:'paragraph';lines:string[]}|{kind:'list';ordered:boolean;start:number;items:string[]}|{kind:'rule'}|{kind:'code';text:string};

const HEADING=/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,RULE=/^\s{0,3}([-*_])(\s*\1){2,}\s*$/,BULLET=/^\s{0,3}[-*+•]\s+(.*)$/,NUMBERED=/^\s{0,3}(\d{1,3})[.)]\s+(.*)$/,FENCE=/^\s{0,3}(```|~~~)/,QUOTE=/^\s{0,3}>\s?/;

/** The reply in blocks: headings, paragraphs, lists, rules, and code. */
export function replyBlocks(text:string):Block[]{
 const blocks:Block[]=[],lines=text.replace(/\r\n?/g,'\n').split('\n');let para:string[]=[],list:{ordered:boolean;start:number;items:string[]}|null=null,code:string[]|null=null;
 const close=()=>{if(para.length)blocks.push({kind:'paragraph',lines:para});para=[];if(list)blocks.push({kind:'list',...list});list=null;};
 for(const raw of lines){
  if(code){if(FENCE.test(raw)){blocks.push({kind:'code',text:code.join('\n')});code=null;}else code.push(raw);continue;}
  if(FENCE.test(raw)){close();code=[];continue;}
  const line=raw.replace(QUOTE,'');
  if(!line.trim()){close();continue;}
  let m;
  if(RULE.test(line)){close();blocks.push({kind:'rule'});continue;}
  if((m=HEADING.exec(line))){close();blocks.push({kind:'heading',level:m[1].length,text:m[2]});continue;}
  if((m=BULLET.exec(line))){if(para.length||list?.ordered!==false)close();list??={ordered:false,start:1,items:[]};list.items.push(m[1]);continue;}
  if((m=NUMBERED.exec(line))){if(para.length||list?.ordered!==true)close();list??={ordered:true,start:Number(m[1]),items:[]};list.items.push(m[2]);continue;}
  if(list&&/^\s{2,}\S/.test(raw)){list.items[list.items.length-1]+=' '+line.trim();continue;}
  if(list)close();
  para.push(line.trim());
 }
 if(code)blocks.push({kind:'code',text:code.join('\n')});
 close();
 return blocks;
}

/** Bold, italic, and code inside a line; links keep their words. */
export function inlineParts(text:string):Inline[]{
 const parts:Inline[]=[],source=text.replace(/!?\[([^\]]+)\]\((?:[^()\s]+)\)/g,'$1'),pattern=/(\*\*|__)(?=\S)([\s\S]*?\S)\1|(?<![\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)|(?<![\w_])_(?=[^\s_])([^_]*?[^\s_])_(?![\w_])|`([^`]+)`/g;
 let at=0,m;
 while((m=pattern.exec(source))){
  if(m.index>at)parts.push({text:source.slice(at,m.index)});
  if(m[2]!==undefined)parts.push(...inlineParts(m[2]).map(p=>({...p,bold:true as const})));
  else if(m[3]!==undefined||m[4]!==undefined)parts.push(...inlineParts((m[3]??m[4])!).map(p=>({...p,italic:true as const})));
  else parts.push({text:m[5],code:true});
  at=m.index+m[0].length;
 }
 if(at<source.length)parts.push({text:source.slice(at)});
 return parts;
}
const plain=(text:string)=>inlineParts(text).map(p=>p.text).join('');

/** One line for the table: the reply's lines joined by “ · ”, without Markdown symbols. */
export function replyPreview(text:string){
 const out:string[]=[];
 for(const block of replyBlocks(text)){
  if(block.kind==='heading')out.push(plain(block.text));
  else if(block.kind==='paragraph')out.push(...block.lines.map(plain));
  else if(block.kind==='list')out.push(...block.items.map((item,i)=>(block.ordered?`${block.start+i}. `:'')+plain(item)));
  else if(block.kind==='code')out.push(block.text.trim());
 }
 return out.map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join(' · ');
}

/** True when laying the reply out changes how it reads (it has Markdown beyond plain lines). */
export function hasMarkdown(text:string){
 return replyBlocks(text).some(b=>b.kind!=='paragraph'||b.lines.some(line=>inlineParts(line).some(p=>p.bold||p.italic||p.code)||plain(line)!==line));
}
