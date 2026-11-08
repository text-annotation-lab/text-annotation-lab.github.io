# Student-facing review, November 2, 2026

This update makes first use easier without changing the worked study example.

## Changes

- Separate instructor-key and own-account setup routes; a course-key shortcut selects OpenRouter.
- A short pilot workflow and three fictional practice passages with explicitly handwritten teaching answers. Loading practice texts sends no request and cannot overwrite a populated document queue.
- Compact, expandable provider, saving, privacy, and troubleshooting guidance.
- OpenRouter choices grouped into economical starting points and more capable comparison models.
- One simultaneous annotation is the default for new or missing settings. Existing saved concurrency choices remain unchanged.
- A conditional notice explains when completed annotations used different settings. No results are changed automatically.
- Clearer retry labels, pending-document guidance, completion labels, and latest-run cost scope.
- Excel opens on Results and correctly identifies OpenRouter. Native and historical text-extracted PDF inputs are distinguishable in the export.
- Whole OpenRouter PDFs use documented native file input. Explicit native parsing prevents automatic fallback to a separately billed OCR service. Split PDFs still use extracted text. PDF estimates include a page-image allowance; historical text-only PDF usage is excluded from calibration.
- Browser identifiers retain cryptographic randomness when crypto.randomUUID is unavailable.

## Preservation and rollback

No saved-data migration or deletion is performed. New inputMode metadata is optional; old study backups remain readable. The worked example's source, data, style sheet, and teaching assets are unchanged, and new guide styling is scoped to the guide.

Previous production version: **134**.

- Site: appgprj_6aa188c94ff88191b75dbddc48fb54e3
- Saved version: appgprj_6aa188c94ff88191b75dbddc48fb54e3~appgver_55c77496139c819187972554ce5546fd
- Source commit: dc648dcb5fb8b40fb1577ee4165324cd1e390e13

To roll back the whole release, redeploy that saved version while preserving public access. Source changes are also reversible with a Git revert of the update commit and a new build/publication. Browser studies are not overwritten by redeployment. Export a study backup before deliberately clearing or replacing study contents.

## Validation

All 29 test suites pass, including provider request contracts, native PDF payloads for all six configured OpenRouter models, queue/retry behavior, 3,100-item recovery, saved-study portability, exports, and conditional guidance. TypeScript checking and the production build pass. Browser checks cover the course-key shortcut, grouped model choices, practice loading, cost estimation, and saving a named version.

Provider calls in tests are mocked. No real API keys were entered, and no paid model requests were made. Live upstream PDF acceptance and model quality are therefore not established by these tests.

Native PDF protocol reference: https://openrouter.ai/docs/guides/overview/multimodal/pdfs
