// A batch ID typed in to recover a run's batch (Recover batch, after the page lost the reply that named it). The
// provider's batch must be the run's: as many requests as the run sent, and results that carry the run's references
// (each request is named <runId>_<n>). Another batch of the same account is refused before it is attached.
import type {BatchJob,BatchPart,BatchUpdate} from './batch-types';

// The requests a batch of a run holds: one per text, or, with several annotations per text, one per annotation asked for.
export function batchRequestCount(job:BatchJob,part?:BatchPart):number{
 if(part)return part.requests[1]-part.requests[0];
 const several=(job.repeats||1)>1;
 return job.docIds.reduce((n,_,i)=>n+(several?(job.ns?.[i]||{length:job.repeats!}).length:1),0);
}
// Why the batch the provider describes cannot be this run's (undefined: nothing says it is another).
export function recoveredBatchProblem(job:BatchJob,out:BatchUpdate,part?:BatchPart):string|undefined{
 const expected=batchRequestCount(job,part);
 if(Number(out.total)>0&&out.total!==expected)return `The batch with this ID holds ${out.total.toLocaleString('en-US')} requests, but this run sent ${expected.toLocaleString('en-US')}, so it is probably another batch. Check the ID in your provider’s console. Nothing was changed.`;
 if(Array.isArray(out.results)&&out.results.length&&!out.results.some(result=>typeof result.id==='string'&&result.id.startsWith(job.runId+'_')))return 'The results of the batch with this ID belong to another run. Check the ID in your provider’s console. Nothing was changed.';
 return undefined;
}
