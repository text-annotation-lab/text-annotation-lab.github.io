# Text Annotation Lab

A teaching resource for AI-assisted text annotation and content analysis, developed for students in the Department of English at Aarhus University. Public address: <https://asca.au.dk/annotation-lab>, which embeds <https://text-annotation-lab.github.io>.

## How it works

The Lab is a static site published with GitHub Pages. Everything runs in the visitor's browser:

- Visitors enter their own API key (OpenAI, Anthropic, Gemini, or OpenRouter). Requests go directly from the browser to that provider; there is no Lab server, and keys never pass through one.
- Studies, prompts, and results are saved in the visitor's browser for this address.
- The former server routes in `app/api/*/route.ts` are now plain modules. `lib/local-api.ts` routes the interface's `/api/...` requests to them inside the browser.

## Research mode

The switch in the header turns the Lab into a tool for research. It is a view of the same study: switching either way never changes texts, prompts, or results, and the standard Lab looks and works as before apart from the switch.

- Tabs: Workspace, Runs & agreement, Export, About, and Model knowledge. The teaching pages and the guidance text written for students are not shown.
- API keys are entered in the header, one per provider. They are kept until the tab closes unless the visitor ticks "Remember keys in this browser," which stores them in that browser's local storage (research mode only). Keys are never part of a study, a backup, or an export.
- Runs: every annotation belongs to a numbered run that records its provider, model, reasoning effort, prompt, and answer fields. "All" annotates every text, as a new run when texts already have results, and keeps the earlier results. "Remaining" annotates the texts that have no result from the current settings.
- Answer fields: each field has a type (category, ordinal scale, number, yes / no, or free text), the values it allows, and a description for the model. The allowed values are sent as part of the answer format, and an answer outside them is refused and kept for review. The shared explanation can be turned off, and "Plain text" sends no answer format at all and stores the whole reply as one column, "response." These settings are stored with the study and recorded on every run and result (`lib/answer-types.ts`, covered by `tests/answer-types.cjs`). A study that uses none of them sends exactly the requests the standard Lab sends.
- Texts: besides one file per text, a whole corpus can be loaded from a table (CSV, TSV, XLSX, JSON, or JSON Lines) with one row per text, or pasted in. Each text is stored as a plain-text document named after its ID, and the table's other columns become labels or metadata.
- Labels and metadata: a CSV or Excel file is matched to the texts by file name. Each column is either human labels or metadata; both can be used to filter, compare, and stratify a sample.
- Samples: "Draw a sample" marks a random sample, optionally stratified, with a recorded seed so the draw can be repeated.
- Runs & agreement compares a run with human labels or with another run: percent agreement, Cohen's κ, weighted κ, Krippendorff's α, Gwet's AC1 and AC2, with 95% intervals, a confusion matrix, and the list of disagreements. Where a run's field declares its scale or categories, the statistics use them (so Gwet's coefficients and the weights rest on the whole scale, and a label that is not on it is left out and reported); otherwise the scale is read from the run's answers, and the page says which.
- Export: results as CSV (one row per text, or one row per text, run, and answer field), the runs with their settings and prompts, the samples drawn, and the standard Excel workbook.

The code is in `lib/research/` (logic and statistics, covered by `tests/research-lib.cjs`) and `components/research/` (interface, loaded only when research mode is on). `tests/research-mode.cjs` checks the switch, the keys, and that the standard Lab shows nothing of research mode. Code that both modes need, such as the model lists and provider calls, is shared, not copied.

## Working on it

Requires Node.js 22 or later.

```sh
npm ci          # install
npm run dev     # local preview at http://localhost:5173
npm run build   # static build in dist/client
npm test        # all tests (provider traffic is mocked; no real keys)
```

Every push to `main` builds, tests, and publishes the site (`.github/workflows/pages.yml`). Propose changes as pull requests so they can be reviewed before going live.

The embed snippet for the ASCA page (AU's TYPO3 content element) is in `docs/au-embed.html`. Editorial conventions are in `AGENTS.md`.
