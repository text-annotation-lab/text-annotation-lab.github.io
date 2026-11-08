import {allowedOrigin} from '@/lib/request-guards';
import {providerError,providerJson} from '@/lib/provider-errors';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const amount=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
// The ordinary student key can read only its own allowance. Never query account credits.
export async function POST(request:Request){
 if(!allowedOrigin(request))return reply({error:'Request origin not allowed.'},403);
 const auth=request.headers.get('authorization')||'';
 if(!/^Bearer sk-or-[\w-]+$/.test(auth))return reply({error:'Enter an OpenRouter API key to check its allowance.'},401);
 try{
  const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:auth},cache:'no-store',redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
  const out:any=await providerJson(response);
  if(!response.ok)return reply({error:providerError('openrouter',response.status,out,response.headers)},response.status);
  const data=out?.data;
  if(!data||(data.limit!==null&&!amount(data.limit))||(data.limit!==null&&!(typeof data.limit_remaining==='number'&&Number.isFinite(data.limit_remaining)))||!amount(data.usage)||!(data.limit_reset===null||['daily','weekly','monthly'].includes(data.limit_reset)))return reply({error:'OpenRouter returned an unreadable allowance. Try Refresh again.'},502);
  return reply({limit:data.limit,remaining:data.limit===null?null:Math.max(0,data.limit_remaining),used:data.usage,reset:data.limit_reset,checkedAt:new Date().toISOString()});
 }catch{return reply({error:'Could not refresh the allowance. Try again; no annotation was run.'},502);}
}
