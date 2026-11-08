# Experimental Model knowledge workspace

This addition retains the original Workspace as the default. It shares its setup controls, provider configuration, annotation endpoint, result components, browser storage helper, and Excel builder. Experimental subjects, prompts, and results use the separate IndexedDB key `model-knowledge-v1`; the text workspace continues to use `current`. API keys remain in memory only. Switching tabs preserves both workspaces, and only one can run at a time.

Simple list is the default. Structured input accepts user-defined headings and CSV or TSV, including quoted delimiters, escaped quotes, blank fields, and multiline quoted values. Invalid rows block queue insertion. Every item is assessed independently, with labeled fields. The endpoint adds method and abstention instructions server-side. Excel retains original fields and records the method and additional model instructions in Study settings. Instant and Batch processing use the same model-knowledge instructions. No confidence settings are added.

## Background batches and method example

Batch uses the existing provider adapters for OpenAI, Anthropic, and Gemini. Each submission accepts up to 10,000 subjects and 50 MB of fields, validates all subjects before creating a provider job, and sends one independent request per subject. The batch route accepts labeled subject arrays rather than document uploads. Batch is restricted to model knowledge without web search; the interface and server both enforce this. Web-assisted runs retain the two-stage Instant flow.

The separate model-knowledge workspace persists queued items and a recovery reference before submission. Accepted jobs survive reloads without automatic resubmission. Users can check status, collect results, cancel, or recover an uncertain submission from a provider batch ID. Earlier annotation runs are retained. Collection checks unique request IDs and saves complete results before releasing the job. API keys remain editable for recovery but are never saved; study settings are locked while a job is outstanding. Batch times identify collection in the browser rather than provider generation time.

The method note cites Dubourg, Thouzeau, Borredon, and Baumard (2025), *Quantifying and explaining the rise of fiction*, https://doi.org/10.1017/ehs.2025.10011. It explains metadata-only input, separate dimensions, abstention, genre and cross-model checks, and exclusion of the less consistent manga dataset from final temporal analyses. Shared example text is also included in Excel Study settings.

## Web research and repeat runs

Web search is off by default and saved as an explicit workspace setting. When enabled, the selected provider and model first perform a native web-search request; a separate structured annotation request receives only that subject, the rubric, and the collected evidence. This avoids native citation/structured-output incompatibilities. OpenAI research uses the selected reasoning effort; Claude and Gemini research use their provider defaults, recorded with the evidence. The annotation request always uses the selected reasoning setting. Search and token charges apply. A failed or unconfirmed search stops the annotation; there is no silent fallback to model knowledge only.

Each result retains search use, source URLs, cited research notes, queries when supplied, search time, research instructions, and response IDs. Google search suggestions are displayed in a sandboxed frame. Source links accept HTTP(S) only. Web content is treated as untrusted data. No previous answers are sent when repeating an annotation.

Repeat study queues the latest identifiers for each distinct subject once, with a new Run number. Annotate subject again queues a single subject. Both retain previous results and require the usual Annotate next or Run all action before spending provider usage. Clearing results explicitly removes all run history and retains one ready copy per subject.

Existing browser records remain compatible without a database migration. Earlier annotations display as Run 1; missing annotation times remain unrecorded. New results save completion time in UTC. The detail view exposes the recorded prompt and settings. Excel separates method-specific settings and adds Run, Subject ID, Annotation ID, completion time, search use, Web sources, and Web research. Shared method-copy constants keep the interface and workbook aligned. Abstentions are counted separately from assessments.

## Rollback

The pre-experiment source commit is `6550f090eb3c655fe424cdfbf035eb467769a812` (Site version 88). Redeploy that saved version to restore the prior publication, or revert the dedicated experiment commit and publish. Existing document data remains under its original storage key. The separate experimental data can remain in the browser without affecting the prior version.

## Verification

Run `node tests/model-knowledge.cjs`, `node tests/knowledge-web.cjs`, the existing workspace/provider/chunking/batch suites, and TypeScript checking, then build using the Sites helper. Tests use mocked provider responses and do not make paid annotation requests. Web checks cover all providers, native citation parsing, search errors, refusal to silently downgrade, preserved evidence after a scoring failure, and multi-run exports.

## Larger studies

Both workspaces share a 10,000-item / 50 MB source limit. A bounded multipart reader also enforces a 54 MB transport limit without trusting Content-Length. Provider input is serialized one request at a time into Blob parts, with a 72 MB prepared-payload limit (18 MB for Gemini inline requests). Repeated prompts and encoded PDFs count toward this limit. No paid job is created until all items are prepared successfully.

OpenAI and Anthropic JSONL result downloads are parsed incrementally, discarding reasoning and unused provider fields between records. Raw downloads are bounded to 512 MB, individual records to 2 million characters, and compact annotations to 32 MB / 10,000 items. Collection failures retain the saved job. Gemini inline JSON responses remain bounded to 32 MB. Results tables render 100 rows per page; exports and saved records retain every item. Model knowledge accepts up to 10,000 parsed subjects / 8 million input characters and previews the first 100 rows.

Run `node --max-old-space-size=128 tests/batch-scale.cjs` for 3,100-article and 3,100-subject submissions across all providers, a 10,000-subject submission, >48 MB streamed provider outputs, Unicode boundaries, byte limits, and truncated-output protection. These are simulated provider tests; no paid requests are made.
