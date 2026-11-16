// Research mode: a text whose request fails is marked, and the run carries on with the other texts. The run
// stops by itself only when its first requests all failed in a way every request would meet (the connection, the
// key, the account, the model, or a setting), so that it does not send request after request that cannot succeed.
export type EarlyStop={answered:number;connection:boolean};

// The mark of a failed reply (`shared`: 'connection', 'account', or 'same:…'; see sharedFailure in
// lib/provider-errors.ts). It is taken off the reply, so that it is never kept with a result.
export function takeShared(reply:unknown):string|undefined{
 if(!reply||typeof reply!=='object')return undefined;
 const {shared}=reply as {shared?:unknown};
 delete (reply as {shared?:unknown}).shared;
 return typeof shared==='string'&&shared?shared:undefined;
}

// No connection to the provider at all (offline, or an extension, a firewall, or a proxy in the way): the request
// got no HTTP reply, and it did not time out. Every request of a run would meet the same.
export function connectionFailure(error:unknown):{shared?:'connection'}{
 const e=error as {name?:unknown;message?:unknown}|null;
 if(!e||typeof e!=='object')return {};
 const said=`${typeof e.name==='string'?e.name:''} ${typeof e.message==='string'?e.message:''}`;
 if(/AbortError|TimeoutError|timed? ?out/i.test(said))return {};
 return /failed to fetch|fetch failed|networkerror|network error|load failed|connection/i.test(said)?{shared:'connection'}:{};
}

// Call once for every request that came back, with its text and the mark of its failure (absent for a result, or
// for a failure that may be about the text itself). Returns the stop once at least three requests have come
// back, for at least two texts, every one of them failed with a mark, and the HTTP 400s among them with the same
// message. Several annotations of one text never stop a run.
export function earlyStopper():(text:string,shared?:string)=>EarlyStop|undefined{
 let answered=0,marked=0,connection=false;
 const texts=new Set<string>(),messages=new Set<string>();
 return (text,shared)=>{
  answered++;
  if(shared){marked++;texts.add(text);if(shared.startsWith('same:'))messages.add(shared);if(shared==='connection')connection=true;}
  return answered>=3&&marked===answered&&texts.size>=2&&messages.size<=1?{answered,connection}:undefined;
 };
}

export function earlyStopNotice(stop:EarlyStop,unit:'text'|'subject'):string{
 return `Stopped: the first ${stop.answered} requests all failed the same way, which points to ${stop.connection?'the connection':'the settings or the account'} rather than the ${unit}s. Requests under way will finish, and completed results are kept. See the error of a failed ${unit} before running again.`;
}
// What a run that carried on reports when it ends: how many of the requests that came back failed, and how they
// are sent again (the workspace's "Remaining"; in Model knowledge, "Queue failed items for retry"; for requests
// that "Retry failed" sent again within their run, that button once more).
// paused: the person paused the run, which says so itself.
export function carriedOnNotice(failed:number,answered:number,kind:'workspace'|'knowledge'|'retry',paused=false):string{
 const n=(value:number)=>value.toLocaleString('en-US'),them=failed===1?'it':'them';
 const what=answered===1?'The request failed.':failed===answered?`All ${n(answered)} requests failed.`:`${n(failed)} of ${n(answered)} requests failed${paused?'':', and the run carried on'}.`;
 return `${what} ${kind==='workspace'?`“Remaining” sends ${them} again.`:kind==='retry'?`“Retry failed” under Runs & agreement sends ${them} again.`:`“Queue failed items for retry” makes ${them} ready to run again.`}`;
}
// "Retry failed" sent a run's failed requests again, and every one came back with a usable answer.
export const retriedNotice=(run:number,answered:number):string=>`Run #${run}: ${answered===1?'the request was sent again and has':`${answered.toLocaleString('en-US')} requests were sent again and all have`} a usable answer now.`;
