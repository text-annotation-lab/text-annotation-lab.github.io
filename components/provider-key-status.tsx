'use client';
import {useEffect,useState} from 'react';
import type {Provider} from '@/lib/providers';
import {canCheckKey} from '@/lib/workflow-safety';

type Allowance = {limit:number|null;remaining:number|null;reset:string|null;checkedAt:string};
type Check = {status:'checking'|'accepted'|'rejected'|'unverified';balance?:Allowance};

async function checkKey(provider:Provider,key:string,signal:AbortSignal):Promise<Check> {
 const router = provider === 'openrouter';
 const response = await fetch(router ? '/api/openrouter-balance' : '/api/check-key', {
  method:'POST', headers:{Authorization:'Bearer '+key,'X-Lab-Provider':provider}, cache:'no-store', signal,
 });
 if (router && response.status === 401) return {status:'rejected'};
 if (!response.ok) return {status:'unverified'};
 if (router) {
  const balance = await response.json() as Allowance|null;
  return typeof balance?.checkedAt === 'string' ? {status:'accepted',balance} : {status:'unverified'};
 }
 const result = await response.json() as {status?:string}|null;
 if (result?.status === 'accepted' || result?.status === 'rejected') return {status:result.status};
 return {status:'unverified'};
}

export function useProviderKeyCheck(provider:Provider,apiKey:string,running:boolean) {
 const key = apiKey.trim();
 const pauseAllowance = provider === 'openrouter' && running;
 const [revision,setRevision] = useState(0);
 const [result,setResult] = useState<{key:string;provider:Provider;check:Check}>();
 useEffect(()=>{
  setResult(undefined);
  if (!key || !canCheckKey(provider,key) || pauseAllowance) return;
  const controller = new AbortController();
  const timer = setTimeout(async()=>{
   let check:Check;
   try { check = await checkKey(provider,key,controller.signal); }
   catch { check = {status:'unverified'}; }
   if (!controller.signal.aborted) setResult({key,provider,check});
  },500);
  return ()=>{clearTimeout(timer);controller.abort();};
 },[provider,key,pauseAllowance,revision]);

 let check:Check = {status:canCheckKey(provider,key) ? 'checking' : 'unverified'};
 if (result?.key === key && result.provider === provider) check = result.check;
 return {empty:!key,check,pauseAllowance,canRetry:canCheckKey(provider,key),refresh:()=>setRevision(value=>value+1)};
}

const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:3});
const keyBadges = {
 checking: {label:'Checking key…', icon:''},
 accepted: {label:'Key accepted', icon:'✓'},
 rejected: {label:'Key rejected', icon:'×'},
 unverified: {label:'Couldn’t verify this key', icon:'?'},
};

export function ProviderKeyStatus({value}:{value:ReturnType<typeof useProviderKeyCheck>}) {
 const {empty,check,pauseAllowance,canRetry,refresh} = value;
 const balance = check.balance;
 const badge = keyBadges[check.status];
 let detail = '';
 if (check.status === 'rejected') detail = 'Check the provider and paste your key again.';
 if (balance?.remaining != null) detail = money.format(balance.remaining)+' remaining on this key';
 else if (balance) detail = 'No spending limit set on this key';
 return <div className="provider-key-status">
  <span role="status" aria-atomic="true">
   {!empty && (pauseAllowance ? 'Spending details refresh after the run.' : <>
    <span className="key-status-badge" data-status={check.status}>
     {badge.icon && <span aria-hidden="true">{badge.icon}</span>}{badge.label}
    </span>{detail && <> {detail}</>}
   </>)}
  </span>
  {canRetry && !pauseAllowance && (check.status==='unverified'||check.status==='rejected') &&
   <button type="button" className="textbutton" onClick={refresh}>Retry</button>}
  {balance && !pauseAllowance && <details>
   <summary>Spending details</summary>
   {balance.limit!==null && <p>Key limit: {money.format(balance.limit)}. {balance.reset?'Resets '+balance.reset+'.':'No automatic reset.'}</p>}
   <p>Charges draw on the owner’s OpenRouter account. Checked {new Date(balance.checkedAt).toLocaleTimeString()}.</p>
   <button type="button" className="textbutton" onClick={refresh}>Refresh</button>
  </details>}
 </div>;
}
