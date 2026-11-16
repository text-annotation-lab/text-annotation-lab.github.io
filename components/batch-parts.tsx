import type {BatchJob,BatchPart} from '@/lib/batch-types';

const STATES:Record<BatchPart['state'],string>={waiting:'not sent yet',submitting:'being submitted',unknown:'needs checking',processing:'processing',ready:'ended, ready to collect',collected:'collected',unsent:'not sent'};
// Research mode: the batches of a run sent as several, with their references and states. unit: texts or subjects.
export function BatchParts({job,unit}:{job:BatchJob;unit:string}){
 return <ol className="batch-parts">{job.parts!.map((part,k)=>{const n=part.items[1]-part.items[0];return <li key={k}><code>{part.id||'no reference'}</code>{` · ${n.toLocaleString('en-US')} ${n===1?unit.replace(/s$/,''):unit} · ${STATES[part.state]}${part.state==='processing'&&part.total?` (${(part.completed||0).toLocaleString('en-US')} of ${part.total.toLocaleString('en-US')} requests)`:''}`}</li>;})}</ol>;
}
