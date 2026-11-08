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
