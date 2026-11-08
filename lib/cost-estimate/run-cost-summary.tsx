import {latestRunCost,type CostRecord} from './run-cost';
export function RunCostSummary({rows}:{rows:CostRecord[]}){
 const run=latestRunCost(rows);if(!run)return null;
 const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:4,maximumFractionDigits:4}).format(run.amount);
 const amount=run.amount>0&&run.amount<0.0001?'< $0.0001':dollars;
 return <section className="cost-history" aria-label={run.legacy?'Saved annotation costs':'Most recent run cost'}>
  <strong>{run.legacy?'Saved annotations':`Latest run · ${run.planned} ${run.planned===1?'annotation':'annotations'}`}</strong>
  <p>{run.known?<><b>{amount} USD</b> · {run.calculated?'Calculated cost (estimate)':run.missing?'Reported subtotal':'Actual cost reported by OpenRouter'}</>:'Cost unavailable: no usable charge or token usage was returned.'}</p>
  <p>{run.known} of {run.count} attempted annotations included.{run.planned>run.count?' '+(run.planned-run.count)+' items from this run were not started.':''}{run.active?' '+run.active+' annotations are still in progress.':''}</p>
  {run.missing>0&&<p>Incomplete total: charges for {run.missing} annotations are unknown or still pending. Missing costs are not treated as free. Check provider usage for the full charge.</p>}
  {run.calculated>0&&<p>Calculated from reported tokens and the Lab’s listed rates, including the batch discount where applicable. This is not a billing total. Requests with cached tokens or web search are omitted unless an actual charge is available.</p>}
  {!run.legacy&&<p className="hint">The latest click on Annotate next, Run all, or Submit batch. A later retry starts a new run; this is not the total for your study.</p>}<details><summary>What this total covers</summary><p>{run.legacy?'These older results have no run identifiers. This total includes all saved attempts in this workspace, including retained retry history.':'Includes failed attempts with reported costs.'} Clearing results also clears these cost records.</p><p>OpenRouter amounts are the charges reported for these requests, not changes in the shared account balance. Separate provider bills for bring-your-own-key usage, taxes, and credit-purchase fees are not included.</p></details>
 </section>;
}
