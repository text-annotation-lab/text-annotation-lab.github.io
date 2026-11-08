# Text Annotation Lab functional audit

November 7, 2026 · Source revision `d597f3a`

**Follow-up.** All seven findings below describe the audited revision. The subsequent fixes passed the 50 automated checks, TypeScript, and the production build. In a fresh Chrome session, a two-tab conflict produced an importable backup containing the conflicted prompt, the other workspace’s prompt, and the source file. The other tab retained its own saved version. A simulated key rejection kept the document queued.

## Findings

### 1. A student cannot back up the open draft after a save conflict

**Priority — fix first.** Open the same working copy in two tabs. Save a prompt edit in the second tab, then edit the prompt in the first. The first tab warns that another tab saved changes. Its new prompt is still visible, but both **Save study** and **Download backup** are disabled. A fresh tab restores the second tab’s version. Excel remains available for analysis, but it cannot restore the complete first draft.

Reproduced in Chrome on the published app with a disposable study. Preserve the protection against overwriting changes and allow the conflicted tab to download a recovery copy from the data it still holds in memory. Reading the last saved copy from browser storage would recover the wrong version.

Relevant code is in `app/page.tsx:113` and `components/study-manager.tsx:62`.

### 2. Excel omits the years students reviewed for a figure

**Priority — fix before students submit figures.** A document named `letter.txt` with a manually assigned year of 1863 produced a workbook with no year column or value. A separate year-plot check confirmed that a manually assigned year is included in the figure. Someone using the workbook cannot reproduce that plot from its data without entering the years again.

Generated the workbook with the app’s exporter and reopened it with ExcelJS. Include a numeric Year column when reviewed years are present and preserve intentionally blank years.

Relevant code is in `lib/export-results.ts:40`.

### 3. A rejected key still sends a document into the annotation workflow

**Priority — fix before classroom use.** With a document queued and the red **Key rejected** badge visible, **Annotate next** remained enabled. Clicking it made an annotation request and changed the document to **Needs attention**. Correcting the key then requires queuing the document for retry.

Reproduced against the published interface with local test responses for key verification and annotation. No document or real key reached a provider. For a confirmed rejection, keep the document queued and direct the student back to the key field. An inconclusive check should still allow the student to proceed.

Relevant code is in `app/page.tsx:157` and `components/provider-key-status.tsx:63`.

### 4. Returning to the Lab rereads every saved study to refresh the prompt menu

**Priority — performance for returning users.** With one named study and the prompt library already initialized, one window-focus event read the study’s document workspace twice and its model-knowledge workspace twice. These records contain the study data and references to its uploaded files. The same refresh runs on mount. The number of unnecessary reads grows with the number of saved studies.

Observed the browser’s storage reads after importing a disposable study. The prompt library scans all saved workspaces before checking whether older prompts still need migrating. Check the library first and perform the migration only when needed. This audit measured read counts, not loading time.

Relevant code is in `lib/saved-prompts.ts:38` and `components/saved-prompts.tsx:10`.

### 5. A failed batch answer discards usage that the provider returned

**Priority — accuracy of recorded costs.** An example batch response that stopped at the output limit reported 120 input tokens, 70 output tokens, and a response ID. The batch parser returned only an error. The same happened for a completed response with unreadable answer text. The cost panel consequently treats the usage as unknown even when the provider supplied it.

Reproduced locally with synthetic OpenAI batch responses. Preserve usage, token totals, and the response ID when recording these failures. The cost panel already supports partial totals.

Relevant code is in `lib/batch-provider.ts:79`.

### 6. Older studies can export two columns headed “Explanation”

**Priority — compatibility.** In a supported older study with the named fields **Tone** and **Explanation**, the exported row had its explanation in the first Explanation column and an empty cell in the second. Newer rows using the automatic explanation write to the other column. A student analyzing one column can miss explanations from part of a mixed study.

Reproduced by generating and reopening a workbook. Use one explanation column for the ordinary case and preserve both texts if an older row contains two distinct explanations.

Relevant code is in `lib/export-results.ts:39`.

### 7. Abbreviated date ranges look like single years

**Priority — small chart correction.** The filename helper leaves `letters_1861–1865.txt` blank for review but suggests **1861** for `letters_1861–65.txt`. The student can correct it, but accepting the suggestions puts a range at a single year. Recognize abbreviated ranges and leave them blank too.

Reproduced with the filename parser in `lib/results-chart.ts:13`.

## Checks and limits

- All 50 automated checks passed. TypeScript also passed.
- The public AU entry page and direct Lab returned HTTP 200 in Chrome. In a fresh browser profile, the embedded Lab waited for consent and displayed the workspace after acceptance.
- All eight tabs opened on the direct site. The Workspace page fit a 375-pixel viewport without page-wide horizontal overflow.
- A synthetic document, prompt, and failed result survived reload. The page reopened on Workspace at the top with an empty key field.
- Importing and opening a study backup, reviewing years, and requesting figure and workbook downloads were exercised in Chrome. The SVG rendered, PNG data was generated, and the workbook was checked independently. The automated browser canceled file saves, including a plain-text control download, so saving to disk through the browser remains unverified.
- Provider success and failure responses were simulated. The audit did not spend API credit or measure live provider billing. Mobile Safari and Firefox were outside the browser checks.
- The audit changed no application code or published content.
