// Research mode: a text whose request fails is marked, and the run carries on with the other texts. The run
// stops by itself when its first requests all failed in a way every request would meet (the connection, the
// key, the account, the model, or a setting), or when, later in the run, the account stops working (the credit or
// quota ran out, or the key was revoked), so that it does not send request after request that cannot succeed.
// `account`: the requests that failed one after another at the end, for the account, after some had succeeded.
export type EarlyStop={answered:number;connection:boolean;account?:number};

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
// Later in a run: three requests in a row, for at least two texts, that failed for the account (any other reply
// starts the count again).
export function earlyStopper():(text:string,shared?:string)=>EarlyStop|undefined{
 let answered=0,marked=0,connection=false,inRow=0;
 const texts=new Set<string>(),messages=new Set<string>(),rowTexts=new Set<string>();
 return (text,shared)=>{
  answered++;
  if(shared){marked++;texts.add(text);if(shared.startsWith('same:'))messages.add(shared);if(shared==='connection')connection=true;}
  if(shared==='account'){inRow++;rowTexts.add(text);}else{inRow=0;rowTexts.clear();}
  if(answered>=3&&marked===answered&&texts.size>=2&&messages.size<=1)return {answered,connection};
  return inRow>=3&&rowTexts.size>=2?{answered,connection:false,account:inRow}:undefined;
 };
}

export function earlyStopNotice(stop:EarlyStop,unit:'text'|'subject'):string{
 if(stop.account)return `Stopped: the last ${stop.account} requests failed for the account (the credit or quota may have run out, or the key no longer works), so the rest would fail too. Requests under way will finish, and completed results are kept. See the error of a failed ${unit}, and send the rest again once the account works.`;
 return `Stopped: the first ${stop.answered} requests all failed the same way, which points to ${stop.connection?'the connection':'the settings or the account'} rather than the ${unit}s. Requests under way will finish, and completed results are kept. See the error of a failed ${unit} before running again.`;
}
// What a run that carried on reports when it ends: how many of the requests that came back failed, and how they
// are sent again (research mode's "Remaining"; in the standard Lab and Model knowledge, "Queue failed items for retry"; for requests
// that "Retry failed" sent again within their run, that button once more).
// paused: the person paused the run, which says so itself.
// Model knowledge with several annotations per subject: 'knowledge-missing' when the failed requests were
// annotations of subjects that have others (Run all makes the missing ones), 'knowledge-mixed' when some subjects
// also have none.
export function carriedOnNotice(failed:number,answered:number,kind:'workspace'|'knowledge'|'knowledge-missing'|'knowledge-mixed'|'retry',paused=false):string{
 const n=(value:number)=>value.toLocaleString('en-US'),them=failed===1?'it':'them';
 const what=answered===1?'The request failed.':failed===answered?`All ${n(answered)} requests failed.`:`${n(failed)} of ${n(answered)} requests failed${paused?'':', and the run carried on'}.`;
 const next=kind==='workspace'?`“Remaining” sends ${them} again.`:kind==='retry'?`“Retry failed” under Runs & agreement sends ${them} again.`:kind==='knowledge-missing'?`“Run all” sends ${them} again.`:kind==='knowledge-mixed'?'“Run all” makes the missing annotations; “Queue failed items for retry” makes the subjects without any ready to run again.':`“Queue failed items for retry” makes ${them} ready to run again.`;
 return `${what} ${next}`;
}
// "Retry failed" sent a run's failed requests again, and every one came back with a usable answer.
export const retriedNotice=(run:number,answered:number):string=>`Run #${run}: ${answered===1?'the request was sent again and has':`${answered.toLocaleString('en-US')} requests were sent again and all have`} a usable answer now.`;
