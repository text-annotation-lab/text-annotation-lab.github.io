# Cost estimator v2

`lib/cost-estimate/` contains Text Annotation Lab’s calculation engine, pricing
table, and React panel. The adapter is `lib/student-estimate.ts`. Active development
now targets this app only; Jens’s Annotation Lab retains the earlier version.
Do not synchronize changes to that app. Never edit a generated bundle.

## Pricing updates

Edit `pricing.ts`, update `PRICE_DATE`, run `node tests/cost-estimate.cjs`, check the
pricing references, and deploy Text Annotation Lab. Every entry is USD per million tokens.
Use the official first-party pricing pages linked in `SOURCES`; older OpenAI
models have their own `/api/docs/models/<model>` page. Keep dated transitions in
`changes`, context thresholds per request, and model-specific tokenizer factors.
Unknown model IDs do not inherit another model's prices. The default local
estimate does not scrape websites or call provider APIs. Google Flash's announced
January 2027 transition is already represented. GPT-5.6 Sol's promotional end is
not known, so the UI displays the provider's confirmed minimum period.

## Assumptions and boundaries

The estimator reads each actual queued text, subject's labeled fields, prompt,
system message, and structured output definition. The default local text estimate uses a
range (roughly 3.2–4.8 characters/token for Latin text), wider for other scripts.
Newer Claude tokenizers use the official approximate 1.3 factor. The student lab
sends whole PDFs, so its adapter adds a broad page-image allowance. Research
Lab uses its existing extracted text; no visual-PDF allowance is added there.

Output heuristics distinguish short labels, sentence/paragraph explanations,
explicit word counts, detail requests, and structured fields. Reasoning uses a
separate effort-dependent interval, bounded by explicit thinking/output caps.
Output plus reasoning is billed only once at output rates. These ranges are
planning assumptions, not statistical confidence intervals or spending limits.

Completed successful runs with matching instructions, model, reasoning, and
response settings calibrate future output ranges. OpenAI and Google report
separate reasoning counts; Anthropic's combined output calibrates total output,
and the panel discloses that its split is still approximate. Legacy total-token-only
records cannot identify input/output shares and are deliberately excluded.
Calibration is available from retained workspace/run results; clearing those
results removes that source of calibration. Failed or incomplete runs are excluded.

Batch halves token costs for listed supported models, across all three providers.
Jens's Lab currently offers OpenAI/Anthropic and shows direct and Batch totals
side by side. No new provider or processing control is introduced.

Web-assisted knowledge annotation includes both the research and annotation
calls, repeated rubric/subject input, search-generated context and notes, and
1–3 searches per subject (Google allowances can reduce fees). This range is wider:
more searches/context can exceed it. Research call default thinking is uncertain.
No batch discount applies to web research, which the student lab runs instantly.

Cache hits are not assumed. When research caching is enabled, the upper input
estimate includes a conservative 25% fresh-write allowance; exact cache eligibility,
reuse, and expiry cannot be known before calls. The student text/annotation paths
disable explicit caching or set no cache breakpoints; implicit provider savings
are not guaranteed. Taxes, retries, account credits, regional pricing, and unsupported
service tiers are excluded. The estimator does not change or cap annotation calls.


## Optional provider input counts (v2)

Inside the existing estimate details, “Count input tokens with provider” sends
prepared prompts and queued files/subject fields to the selected provider’s
count-only endpoint using the API key already entered in the workspace:

- OpenAI: `/v1/responses/input_tokens`
- Anthropic: `/v1/messages/count_tokens`
- Google: `models/<model>:countTokens`, with `generateContentRequest`

The server builds inputs with the same request builder as Batch annotation,
including the system prompt, response schema, subject-mode instructions, and
PDFs. Only count-only URLs are allowed. There is no generation fallback and no
search, provider file upload, or batch submission. Provider failures leave the
local estimate usable. Counts stay in page memory, keyed by file/subject and
request settings, and are invalidated when those settings change. A completed
count replaces the whole request input estimate, without adding instructions or
Claude’s tokenizer multiplier a second time. The count is shown as one figure,
with the caveat that provider counts and final billed usage can differ slightly.
For web-assisted work, future research context remains uncertain and is still
shown as a range. A provider count is not a guaranteed final bill.

No extra pilot-run button is added. The panel recommends 3–5 representative
“Annotate next” calls to calibrate reasoning and output, and says explicitly
that these are normal paid annotations. It never starts paid calls itself.
