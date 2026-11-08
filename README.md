# Text Annotation Lab

A teaching resource for AI-assisted text annotation and content analysis, developed for students in the Department of English at Aarhus University. Public address: <https://asca.au.dk/annotation-lab>, which embeds <https://text-annotation-lab.github.io>.

## How it works

The Lab is a static site published with GitHub Pages. Everything runs in the visitor's browser:

- Visitors enter their own API key (OpenAI, Anthropic, Gemini, or OpenRouter). Requests go directly from the browser to that provider; there is no Lab server, and keys never pass through one.
- Studies, prompts, and results are saved in the visitor's browser for this address.
- The former server routes in `app/api/*/route.ts` are now plain modules. `lib/local-api.ts` routes the interface's `/api/...` requests to them inside the browser.

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
