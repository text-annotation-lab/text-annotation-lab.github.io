// Compute the 95% intervals in a background worker and hand them to `done`.
// Only one job runs at a time: starting another stops the one before. Returns
// a function that stops this job. Where workers are unavailable, the intervals
// are computed directly.
import {runJob,type AgreementJob} from './agreement';
import type {Agreement} from './metrics';

let running:Worker|null=null;
export function computeIntervals(job:AgreementJob,done:(ci:Agreement['ci'])=>void):()=>void{
 running?.terminate();running=null;
 const direct=()=>done(runJob(job,true).ci);
 let worker:Worker;
 try{worker=new Worker(new URL('./ci.worker.ts',import.meta.url),{type:'module'});}
 catch{direct();return()=>{};}
 running=worker;
 const stop=()=>{worker.terminate();if(running===worker)running=null;};
 worker.onmessage=(event:MessageEvent<Agreement['ci']>)=>{stop();done(event.data);};
 worker.onerror=()=>{stop();direct();};
 worker.postMessage(job);
 return stop;
}
// The intervals of one job in a worker of its own, for the Export tab's files: a job there must not stop the
// one on Runs & agreement, nor be stopped by it.
export function intervalsOf(job:AgreementJob):Promise<Agreement['ci']>{
 return new Promise(resolve=>{
  const direct=()=>resolve(runJob(job,true).ci);
  let worker:Worker;
  try{worker=new Worker(new URL('./ci.worker.ts',import.meta.url),{type:'module'});}
  catch{direct();return;}
  worker.onmessage=(event:MessageEvent<Agreement['ci']>)=>{worker.terminate();resolve(event.data);};
  worker.onerror=()=>{worker.terminate();direct();};
  try{worker.postMessage(job);}catch{worker.terminate();direct();}
 });
}
