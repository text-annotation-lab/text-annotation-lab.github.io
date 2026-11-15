// Bootstrap intervals for the agreement statistics, computed away from the
// page so it stays responsive (10,000 resamples take a moment).
import {runJob,type AgreementJob} from './agreement';

self.onmessage=(event:MessageEvent<AgreementJob>)=>{
 self.postMessage(runJob(event.data,true).ci);
};
