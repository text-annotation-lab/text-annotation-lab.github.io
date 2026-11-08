// Recognize explicit output declarations only; never infer scales from prose,
// examples, or bare numbers. Conflicting or qualified declarations stay free text.
export type AnswerRule={name:string;values:string[];min:number;max:number};
export function explicitAnswerRules(prompt:string,names:string[]=[],knowledge=false):AnswerRule[]{
 if(/```|<examples?\b|\bexamples?\s*:/i.test(prompt))return [];
 const blocks=[...prompt.matchAll(/<output>\s*([\s\S]*?)\s*<\/output>/gi)];
 const source=blocks.length===1?blocks[0][1]:blocks.length? '':prompt;
 const labels=names.length?names:['score'];
 return labels.flatMap(name=>{
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const declarations=source.split(/\r?\n/).filter(line=>new RegExp('^\\s*'+escaped+'\\s*:', 'i').test(line));
  if(declarations.length!==1)return [];
  const match=new RegExp('^\\s*'+escaped+'\\s*:\\s*(?:an?\\s+)?integer\\s+from\\s+([+−-]?\\d+)\\s+to\\s+([+−-]?\\d+)\\s*(?:,?\\s*without a plus sign)?[.]?\\s*$','i').exec(declarations[0]);
  if(!match)return [];
  const min=Number(match[1].replace('−','-')),max=Number(match[2].replace('−','-'));
  if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min>max||max-min>200)return [];
  // Abstention instructions elsewhere must not be erased by a numeric constraint.
  // Only the application's established knowledge sentinel is unambiguous here.
  if(/\b(?:N\/?A|UNKNOWN|UNCLEAR|NULL|NONE|MISSING|NOT[ _-]APPLICABLE|ABSTAIN|UNSCORABLE|UNRATABLE)\b/i.test(prompt))return [];
  const values=Array.from({length:max-min+1},(_,i)=>String(min+i));
  if(knowledge||/\bINSUFFICIENT_KNOWLEDGE\b/.test(prompt))values.push('INSUFFICIENT_KNOWLEDGE');
  return [{name,values,min,max}];
 });
}
export function annotationValidationError(result:any,names:string[]=[],prompt='',knowledge=false):string|undefined{
 if(!result||typeof result.score!=='string'||typeof result.explanation!=='string')return 'The response has an invalid answer format. Review the returned response before retrying.';
 const rules=explicitAnswerRules(prompt,names,knowledge);
 const entries=names.length?names.map((name,i)=>[name,result.answers?.['f'+i]]):[['score',result.score]];
 for(const [name,value] of entries){
  if(typeof value!=='string'||!value.trim())return `The answer for “${name}” is missing. Review the returned response before retrying.`;
  const rule=rules.find(r=>r.name===name);
  if(rule&&!rule.values.includes(value))return `Invalid answer for “${name}”: ${JSON.stringify(value.slice(0,120))}. Expected ${rule.min} to ${rule.max} as an integer${rule.values.includes('INSUFFICIENT_KNOWLEDGE')?', or INSUFFICIENT_KNOWLEDGE':''}. The response is kept for review; no retry was sent.`;
  // Catch empty placeholders and code debris, without imposing numeric rules on categories.
  if((/^(score|category|label|explanation)$/i.test(name)&&value.trim().toLowerCase()===name.toLowerCase())||/^[\s;(){}\[\]\\]+$/.test(value))return `The answer for “${name}” looks like a label or an unfinished response (${JSON.stringify(value.slice(0,120))}). Check it before retrying. The response is kept for review.`;
 }
 if(!result.explanation.trim()&&!names.some((name,i)=>name.toLowerCase()==='explanation'&&result.answers?.['f'+i]?.trim()))return 'The response is missing its explanation. Review it before retrying.';
}

// Recheck recorded results against their own prompt, never the current editor.
// Preserve answers, usage, and timestamps; this only makes the review/retry path available.
export function reviewStoredAnswer<T extends {status:string;prompt?:string;score?:string;explanation?:string;answerFields?:string[];answers?:Record<string,string>;rawResponse?:string}>(row:T,knowledge=false):T{
 if(row.status!=='done'||typeof row.prompt!=='string'||typeof row.explanation!=='string')return row;
 const error=annotationValidationError(row,row.answerFields,row.prompt,knowledge);
 return error?{...row,status:'error',error,rawResponse:row.rawResponse||JSON.stringify({score:row.score,explanation:row.explanation,answers:row.answers})}:row;
}
