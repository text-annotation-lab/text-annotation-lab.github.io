# Audit — October 13, 2026

Audited the current public Text Annotation Lab, project
`appgprj_6aa188c94ff88191b75dbddc48fb54e3`.

## Findings fixed

- Restored interrupted annotations and obsolete settings were normalized in memory
  but skipped by the first autosave. Persist those changes after restoration.
- Leaving while an autosave was pending had no unload warning unless annotation
  was also running. Warn for unsaved changes too, on browsers that support it.
- Provider regression tests still treated Haiku 5.5 as Haiku 4.5, and export tests
  expected old provider and reasoning labels. Update their assertions.

## Verification passed

- Component event tests: upload validation, annotation queue, pause, stop on error,
  completed-result preservation, return to queue, clear results, provider switching,
  key isolation, interrupted restoration, unload guard, storage-conflict blocking.
- Route/provider tests: request routing and supported settings, text/PDF payloads,
  credential separation, origin checks, timeout signals, provider failures,
  refusals, incomplete output, malformed annotations, safe response fields.
- Real extraction fixtures: TXT, HTML, RTF, and DOCX.
- Excel workbook round trips: mixed provider/prompt/model settings, numeric and
  categorical scores, strings resembling formulas, long prompts and explanations.
- Teaching assets: all six ZIPs pass CRC checks; their 621 selected study texts
  are nonempty; referenced local downloads/images and internal section targets
  exist; all ten prompting tips and six closer-look notes are present.
- TypeScript check and production Worker/client build.

Provider documentation reviewed for current API request formats and model settings:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/guides/file-inputs
- https://platform.claude.com/docs/en/models/haiku-5-5/whats-new-haiku-5-5
- https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/generate-content/thinking

## Limits

No browser control skill was available, so browser QA was skipped under the Sites
managed-preview rules. Component tests use a hook/event harness rather than a real
DOM. IndexedDB transactions, download behavior, keyboard/screen-reader behavior,
mobile layout, and browser-specific unload behavior therefore remain unverified in
an actual browser. Provider requests were mocked; no paid API calls were made and
account-specific access or billing was not tested. PDF payload routing was checked,
but actual provider PDF interpretation was not. External links were not all checked
for availability. This is not a load test or a guarantee for every input document.

The production build succeeds with a bundle-size warning. Excel generation remains
lazy-loaded; no performance refactor was introduced. Document chunking is unchanged.

## Repeat the checks

Run each command from the checkout:

```sh
node tests/workspace.cjs
node tests/audit.cjs
node tests/anthropic.cjs
node tests/gemini.cjs
node tests/teaching.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Use the Sites build helper for the production build.

## Optional chunking — October 14, 2026

A collapsed “Split into chunks” control exposes a words-per-chunk input and an
explicit action to split ready documents. Whole-document annotation remains the
initial behavior. Exact boundaries count non-whitespace word runs, preserve the
extracted text without overlap, and retain a shorter final chunk. Documents below
the chosen count remain whole. Each chunk becomes a separate queued text and API
request using the usual prompt and provider settings; there is no automatic
aggregation. The input accepts integers from 1 through 1,000,000; preparation is
limited to 10,000 queued texts and 2,000,000 extracted characters per source.

PDF splitting uses unpdf 1.8.1 locally, loading it only when needed, with a 500-page
limit. It uses the text layer rather than OCR or page images. Empty/scanned or
corrupt PDFs report an error and leave the workspace unchanged. Other supported
formats use the existing extraction pipeline. Source files are retained for
restoring wholly unannotated groups; clear-results preserves chunk metadata.

Tests cover exact boundaries and whitespace, remainders, invalid values, repeated
splitting, preservation of existing results, undo, saved settings, per-chunk API
payloads, real PDF/HTML/RTF extraction, and Excel source/word-range fields. Existing
provider, extraction, export, and teaching tests pass. Browser QA remains
unavailable. Run `node tests/chunking.cjs` and `node tests/workspace.cjs` to repeat
the new checks; the production build also passes.
