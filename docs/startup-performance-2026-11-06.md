# Startup performance — November 6, 2026

Keep the current header without the introductory heading or sentence.

## Changes

- Load reading panels only when their tab is opened. The workspace and Model knowledge remain mounted so study persistence and background runs keep their existing behavior.
- Load backup encoding, decoding, and validation only when importing or downloading a backup.
- Wait for asynchronously loaded headings before focusing genuine deep links. Top-tab clicks still do not scroll.
- Existing PDF, document extraction, Excel, and chart imports were already deferred and remain so.

## Measurement

Production manifest static dependency graph rooted at `app/page.tsx` and `virtual:vinext-app-browser-entry`:

| Initial JavaScript | Before (version 156) | After |
| --- | ---: | ---: |
| Raw bytes | 829,334 | 714,071 |
| Sum of per-file gzip bytes | 251,394 | 223,310 |

This is a 13.9% raw / 11.2% gzip reduction. It is not a measurement of total page-load-time improvement. The AU wrapper has its own scripts and consent-gated iframe loading; these are unchanged. No reliable browser navigation timing benchmark was available.

## Verification

- Production build and TypeScript checks passed.
- Startup, startup-bundle, section-navigation, study-portability, workspace, parallel-workspace, teaching, AU embed, review-regression, and student-polish checks passed.
- Browser production-preview checks: all six reading tabs load; top-tab navigation retains scroll position; the data-handling deep link opens its section; deferred backup download succeeds; workspace remains visually unchanged; no browser warnings or errors were reported during tab checks.
- The startup-bundle regression check requires a production build and verifies that optional reading, backup, chart, PDF, and Excel code does not enter the initial static dependency graph.

Rollback: version 156 / commit `37e6e69f13df4c0d06c557dc332ff575603f7430` restores the preceding startup behavior while retaining the same layout.

## Follow-up: stable tab transitions

The first deferred implementation showed a short loading panel on every reading-tab switch, including revisits. That briefly shortened the page and let the footer jump upward. Tab navigation now prepares the requested reading component before changing the active section. Previously loaded components render synchronously, and the three teaching sections share one cached import. Rapid navigation discards stale requests. Direct links and remembered sections use the same preparation path; failed imports still expose a retry button. The workspaces remain mounted.

Verified with delayed-import and race tests, component-cache/retry tests, workspace and parallel-run checks, anchor and AU-embed checks, TypeScript, and a production build. The startup graph still excludes optional reading modules (223,442 gzip bytes). Chrome checks covered all reading sections, revisits without a loading placeholder, unchanged top-tab scroll behavior, and the data-handling deep link.


### Always reopen on Workspace

A fresh visit, refresh, or return from the browser’s back/forward cache now starts at the top of Workspace, even when the incoming address names a previous tab. The old `annotation-section` preference is no longer read or written. Browser scroll restoration is disabled while the workspace is mounted; a cached-page return also cancels pending tab loading. Saved study content and settings are unchanged. In-session section links still work, and ordinary top-tab clicks retain the current scroll position. The AU wrapper already fills the viewport, so no CMS change is needed.

Verified with workspace navigation/restoration and parallel-run checks, deferred-panel checks, section navigation checks, TypeScript, and a production build.
