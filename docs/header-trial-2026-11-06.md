# Reversible introduction trial

## Current trial: entire introduction removed

The user clarified that the explanatory sentence should also go. This explicitly supersedes the earlier instruction to preserve it on the page. Both the slogan and sentence are now absent; the navigation follows the site header with a 16 px gap.

To restore the sentence-only version, restore the introduction markup and its `intro-plain` CSS block from version 155, source commit `b3e78cee9aa0972c52204a5d8706488ab9111676`, and remove the new `main>header+[data-slot=tabs]` spacing rule. The earlier smaller-heading rollback is documented below.

## Previous trial: heading removed

Following version 154 (`fe3823f74ccb895614c43b3a9239093c13c3b7af`), the user asked to try removing the large heading altogether. The exact explanatory sentence remains, left-aligned above the tabs. The `intro-plain` class removes the heading's blue rule and lets the sentence use the available width.

To restore the smaller-heading version independently of any chart changes: remove the marked heading-free CSS block, remove `intro-plain` from the introduction in `app/page.tsx`, and insert `<div><h1>Explore texts.<br/><span>Build your own study.</span></h1></div>` before its paragraph. Version 154 also remains available as a complete rollback.

## Previous trial: smaller heading

Baseline: published version 153, source commit `31daefc0cef3e1fe2a3bcac2c59a48b7be0c4c21`.

The trial preserves the slogan, exact restored explanation, two-column layout, serif type, and blue rule. It changes only the compact-introduction CSS block in `app/globals.css`: desktop heading 42 to 36 px, mobile heading 34 to 30 px, smaller vertical margins, and vertical centering of the two text blocks. No introduction markup or copy changed.

To undo only the introduction trial while retaining the single-color charts, replace that marked CSS block with:

```css
/* Compact introduction */
.intro{margin-top:22px;margin-bottom:20px}@media(max-width:780px){.intro{margin-top:18px;margin-bottom:18px}.intro>p{margin-top:12px}}
```

The separate chart change uses one blue for numeric score marks in interactive distributions, ranked views, and exported figures. Distinct category colors are preserved because they identify categories in the share-of-total view.
