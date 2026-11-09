type Settings = {provider?:string;model?:string;effort?:string;prompt?:string;answerFields?:string[];webSearch?:boolean};
// Compare research instructions, not processing speed or billing settings.
export function differentSettingsCount(rows:(Settings & {status:string})[],current:Settings):number {
 return rows.filter(row=>row.status==='done'&&row.prompt!==undefined&&row.model&&(
  row.prompt!==current.prompt||row.model!==current.model||
  (row.provider!==undefined&&row.provider!==current.provider)||
  (row.effort!==undefined&&row.effort!==current.effort)||
  JSON.stringify(row.answerFields||[])!==JSON.stringify(current.answerFields||[])||
  Boolean(row.webSearch)!==Boolean(current.webSearch)
 )).length;
}
export type SettingKey='prompt'|'model'|'provider'|'effort'|'answerFields'|'webSearch';
export type SettingDifference={key:SettingKey;earlier:{value:string;count:number}[]};
// Which settings differ, and what the earlier results used, so the notice can say so.
export function settingsDifferences(rows:(Settings & {status:string})[],current:Settings):SettingDifference[]{
 const done=rows.filter(row=>row.status==='done'&&row.prompt!==undefined&&row.model);
 const checks:[SettingKey,(row:Settings)=>string|undefined,string][]=[
  ['model',row=>row.model,current.model||''],
  ['prompt',row=>row.prompt,current.prompt||''],
  ['effort',row=>row.effort,current.effort||''],
  ['provider',row=>row.provider,current.provider||''],
  ['answerFields',row=>(row.answerFields||[]).join(', '),(current.answerFields||[]).join(', ')],
  ['webSearch',row=>row.webSearch?'on':'off',current.webSearch?'on':'off'],
 ];
 const result:SettingDifference[]=[];
 for(const [key,read,now] of checks){
  const counts=new Map<string,number>();
  for(const row of done){const value=read(row);if(value!==undefined&&value!==now)counts.set(value,(counts.get(value)||0)+1);}
  if(counts.size)result.push({key,earlier:[...counts].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count)});
 }
 return result;
}
