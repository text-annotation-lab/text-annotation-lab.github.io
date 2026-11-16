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
- Plain-text replies that are JSON: when the whole reply is one JSON object (optionally inside a ```` ```json ```` fence), the export tables, the Excel workbook, the comparisons, and the charts have a column for each of its values next to "response," which keeps the reply as written. Nested keys are joined with an underscore, a list is kept as written, and each explanation follows its scores. A reply that holds JSON among other words is a failed result that keeps the reply, because its columns would otherwise be silently empty; prose is never judged. `lib/json-reply.ts` holds the rules and `tests/json-replies.cjs` covers them.
- Prompt caching (Processing options, off unless switched on): the prompt, which is the same for every text, is marked for the provider's prompt cache, so that later texts read it at the provider's cache rate. Anthropic gets `cache_control` on the system prompt (a five-minute entry; one hour in a batch). OpenAI caches only up to a mark inside a message, so the prompt is then sent as a developer message that carries the mark, in place of `instructions`; without the option, OpenAI caching stays switched off as in the standard Lab. Through OpenRouter, Claude and GPT models get the same marks. Gemini caches repeated prompts by itself, so there is nothing to switch. The setting is stored with the study, recorded on every result made with it, listed per run and in the long results table, and never sent by the standard Lab. Recorded costs price cached tokens where the provider's pricing page lists a cache rate for the model (otherwise the cost stays unknown), and the estimate assumes one cache write followed by reads at its lower edge and a write for every text at its upper edge. `lib/request-settings.ts` holds the request shapes and `tests/prompt-caching.cjs` covers them.
- Parallel annotations: up to 128 texts at once (the standard Lab offers 1, 2, or 4, and a study set to more runs one at a time there). When a provider refuses a request for a short-term rate limit or because it is overloaded, the run waits, sends the request again, and goes on with half as many at a time, rising again as requests get through. A text is sent at most eight times. Quota, billing, and daily limits, and waits of more than two minutes, stop the run as any other error does. `lib/annotation-queue.ts` holds the pacing and `retryWait` in `lib/provider-errors.ts` decides what may be sent again; `tests/annotation-queue.test.mjs` and `tests/rate-limits.cjs` cover them.
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
