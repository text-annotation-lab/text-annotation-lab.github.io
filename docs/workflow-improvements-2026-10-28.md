# Study workflow improvements — October 28, 2026

Updates to existing public Text Annotation Lab, based on source version 119.
No audience, provider offerings, prices, corpora, citations, or teaching-method
changes. Model knowledge remains explicitly experimental.

## Behavior

- Model knowledge duplicate review matches ordered fields after outer-whitespace
  trimming and Unicode NFC normalization, case sensitively. It reports matches
  within the submission and against existing rows. Keep-all creates independent
  observations; excluding matches leaves existing data unchanged. Repeat study
  and Annotate subject again remain the linked-repeat workflow.
- Document import offers keep/exclude/cancel for same-name, byte-identical files
  identified with SHA-256, including retained originals of chunks. Different names
  are not assumed to identify the same document. Nothing is silently merged.
- Local preflight checks required keys/prompts and selectable model/reasoning
  combinations, plus recognizable Anthropic/OpenAI/Google key mismatches.
  Unknown key formats proceed to the normal provider checks; this is not a key
  validity guarantee and makes no paid validation calls. Keys remain memory-only.
- Per-row Retry this item and Retry failed items queue work without sending it.
  Confirmation describes current settings and uncertain paid-work risks. Each
  failed attempt is retained with its original prompt, settings, usage, and any
  research. Successful results never change. Interrupted requests are still
  marked for review and are never automatically resubmitted.
- Counts distinguish ready, active/submitted, completed, and failed rows, with
  earlier failed-attempt counts. Insufficient-knowledge results remain separate
  from assessed results. Subject IDs distinguish repeats from new observations.
- Section changes write canonical URL fragments. Refresh, back/forward, existing
  internal anchors, and a local last-section fallback are supported.
- Three synthetic tone texts append to the document queue; the prompt is not
  replaced and no provider call starts. Existing example prompt remains optional.
- Setup explains the intentionally shared provider/model/reasoning/key and the
  separate prompts, queues, and processing options. Per-attempt settings remain
  immutable when current selections change.
- The worked example refers to the existing dated estimator instead of claiming
  undated fixed costs for an entire corpus.

## Backup format v1

`*.tal-study.json` has format `text-annotation-lab-study`, integer version 1,
name, creation timestamp, both workspaces, and deduplicated retained File assets
with base64 bytes, filenames, MIME types, and lastModified timestamps. Includes
unsubmitted structured input, fields, source PDFs/other files, chunks, original
source files, prompts, settings, results, linked runs, failed-attempt history,
web research, batch recovery references, and available import provenance.
Credentials and internal storage revision/snapshot flags are excluded. Backups
contain study material and should be treated accordingly.

Imports validate format/version, types, states, unique IDs, required data,
completed result fields, batch references, file references, lengths, base64,
unsafe/credential properties, and nesting. Limits: 250 MB JSON, 150 MB retained
files, 20 MB per asset, 100,000 records per workspace. Browser storage quotas can
still be lower. No existing workspace schema/key migration is required.

Catalog and both imported workspaces are committed atomically as a separate
snapshot, with a fresh study ID and collision-safe name. The active working copy
is unchanged; Load study retains its existing overwrite confirmation. Loading a
backup does not execute requests. Saved running requests use the existing
interruption guard; batch references use existing manual recovery.

Excel remains the analysis export, including original result settings, source
and chunk IDs, boundary method/target, and the existing wrapped prompt layout.
An Attempt history sheet retains earlier failed attempts as indexed, readable
metadata plus lossless JSON continuation parts. Join parts within a record and
attempt without a separator to reconstruct the full attempt.

## Sentence-aware chunks

“Prefer whole sentences” is available beside the exact-word method. Saved
workspaces without a method retain exact-word behavior. Existing chunks are never rebuilt.
Sentence segmentation uses native `Intl.Segmenter('en', {granularity:'sentence'})`,
paragraph boundaries, and a versioned guard for common English title/abbreviation
endings. Whole-sentence boundaries nearest the target are preferred, so lengths
can exceed the target. Overlong sentences (including unpunctuated passages) fall
back to exact whitespace-word runs. Quotation marks, decimals, Unicode, and all
extracted-text whitespace are retained, in order, without duplication.

This is English-oriented segmentation, not perfect grammatical parsing. Browser
ICU versions may differ. The recorded method, target, segmenter policy, word
ranges, and retained chunk text are the reproducible record. Source files are
retained. Documents/chunks with prior attempts cannot be split/restored in a way
that would discard history; explicit Clear results remains available.

## Verification

Focused tests cover duplicate choices, preflight without traffic, targeted/all
retries, success preservation, changed prompts, accurate counts, history, section
hash navigation, native sentence boundaries, exact text fidelity, long prompts,
Excel formula-like literals/Unicode, and per-result provenance.

Portable round trips serialize actual File bytes (including a valid synthetic
PDF), decode, import into the IndexedDB test implementation, load through the
existing study manager storage logic, and check sources/settings/results/history.
Tests also cover legacy original-study initialization, separate imports, snapshot
immutability, stale-tab conflicts, and malformed/incompatible backups. The test
uses fake-indexeddb; Node's File clone behavior is adapted to match browsers.

Existing extraction, provider-route, queue, pause/drain, batch recovery/scale,
cost, teaching, and corpus regressions are retained. Provider traffic is mocked.
No successful paid annotation or live provider batch is claimed.

Browser QA: desktop preview and a 390 px test frame (375 CSS px after the
scrollbar) showed no horizontal overflow; the narrow study menu remained usable.
The temporary test-frame page is not shipped. Desktop checks confirmed section reload restoration, duplicate
review, local provider/key warning, and portable backup download. HTTP preview
lacks crypto.randomUUID (an existing secure-context requirement), blocking
ID-creating actions in that environment. File-chooser automation also timed out.
Full browser upload/import round trips are therefore not claimed. A development
hot-reload session showed an update-depth overlay; a fresh reload and subsequent
input check did not reproduce it. TypeScript, whitespace checks, the regression suite, and the production build
passed before publication.

## First-visit simplification

The follow-up interface pass removes the synthetic-text loader while retaining existing documents, the example prompt, and teaching corpora. Retry controls appear only when failures exist. A single progress summary shows ready items or completed attempts, with active, failed, and insufficient-knowledge counts only when relevant; repeated subjects are counted as annotations. Duplicate matching and chunking rules are unchanged, with longer explanations available in expandable details. No saved-data formats or provider behavior changed.
