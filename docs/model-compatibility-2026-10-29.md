# Model compatibility audit — October 29, 2026

Scope: all 23 selectable model identifiers in version 122, their provider routes, reasoning controls, structured annotation outputs, text/PDF transport, batch preparation, input-token counting, and optional model-knowledge web research. This audit uses official provider documentation and intercepted requests. It does not certify live account access, quota, latency, model quality, or successful provider-side PDF parsing.

## Model inventory

| Provider | Identifiers checked |
| --- | --- |
| OpenAI | gpt-6-luna, gpt-5.6-luna, gpt-6.1-terra, gpt-6.1-sol, gpt-6-sol, gpt-5.6-terra, gpt-5.6-sol, gpt-6-astra |
| Google | gemini-2.5-flash-lite, gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-2.5-flash, gemini-3.8-flash, gemini-3.6-flash, gemini-3.5-flash, gemini-2.5-pro, gemini-4-argon, gemini-3.1-pro-preview |
| Anthropic | claude-haiku-5-5, claude-haiku-4-5-20251001, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-1 |

The configured destinations are OpenAI Responses, Anthropic Messages, and Google Generate Content v1beta, with provider-specific authentication headers. The Gemini endpoint remains supported as the legacy Generate Content API; this audit does not migrate APIs. Structured output schemas and PDF encoding match each provider's request format. Existing batch routes and collection tests remain in place.

## Changes

- GPT-5.6 Luna, Terra, and Sol now expose all six documented effort levels: none, low, medium, high, xhigh, and max. The previous low/medium/high choices were valid but incomplete. Defaults and recorded historical settings are unchanged.
- Gemini 4 Argon's separate web-research request now explicitly sends MEDIUM thinking, as required by the Generate Content thinking guide. The research record stores medium. Final scoring still uses the user's selected effort, and research and scoring remain separately recorded. Other research requests retain their existing settings.
- Added an independent model/effort contract matrix. It checks 109 combinations across 23 identifiers, 218 Instant TXT/PDF requests, equality of matching batch payloads, count-only routes, all-model research followed by scoring, credential routing, and rejection of invalid effort or wrong-provider IDs before fetch. All network traffic is mocked. PDF fixtures test byte transport only; document-format regressions are separate.

## Access and reproducibility caveats

Gemini 2.5 models remain served but are restricted to users who actively used them previously. Gemini 3.5 Flash is a deprecated identifier that Google automatically routes to 3.6 Flash; it is retained for saved studies, with an existing explanatory hint. Gemini 3.1 Pro remains a preview. A free standard-request tier does not imply free Batch or search access, nor availability for a particular Google project. These caveats were already present in the interface.

No real credentials were available for this audit. Account-specific access, billing, rate limits, provider-side tool permissions, real batch completion, and successful paid annotations remain unverified. High effort can exhaust the app's bounded output budget or timeout; the app reports these outcomes and does not silently retry ambiguous paid work. The test suite does not treat a mocked success as evidence of real service availability.

## Primary references

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://platform.claude.com/docs/en/models/overview
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/release-notes/overview
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/generate-content/thinking
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview
- https://ai.google.dev/gemini-api/docs/models/gemini-4-argon
- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/pricing

## Validation

All CJS regression programs and all 16 Node test cases passed. TypeScript checking passed. These checks include document extraction, UTF-8/UTF-16, malformed input, Excel settings/history/provenance, retry and interruption handling, portable studies, chunking, and large batch preparation/collection. The new matrix uses independent expected model IDs and effort lists rather than deriving its expectations from the UI registry.

Production build passed. The build retains its existing large-chunk and static-route-classification warnings. No layout changes were made; this audit did not repeat browser layout testing.
