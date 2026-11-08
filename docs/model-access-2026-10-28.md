# Model catalog and API access review, October 28, 2026

Checked against first-party documentation:

- Google model catalog: https://ai.google.dev/gemini-api/docs/models
- Google standard/batch pricing and free-tier eligibility: https://ai.google.dev/gemini-api/docs/pricing
- Project quotas: https://ai.google.dev/gemini-api/docs/rate-limits
- Billing-enabled projects: https://ai.google.dev/gemini-api/docs/billing
- Gemini thinking levels: https://ai.google.dev/gemini-api/docs/thinking
- Argon migration requirements: https://ai.google.dev/gemini-api/docs/latest-model
- Legacy Flash alias: https://ai.google.dev/gemini-api/docs/deprecations/
- OpenAI model catalog: https://developers.openai.com/api/docs/models
- Terra rates, reasoning levels, and API access: https://developers.openai.com/api/docs/models/gpt-6.1-terra
- Anthropic model catalog: https://platform.claude.com/docs/en/models/overview
- Anthropic pricing and trial credits: https://platform.claude.com/docs/en/about-claude/pricing

Added Gemini 4 Argon, Gemini 3.6 Flash, and GPT-6.1 Terra. Retained existing models for saved studies. Gemini 3.5 Flash is an alias routed by Google to 3.6 Flash. Google restricts access to 2.5 models to previous active users. The four current Claude families were already present.

Free API tier badges refer to standard requests. Google lists free standard input/output for the included Flash/Flash-Lite models and 2.5 Pro, subject to project eligibility and quotas. Gemini 4 Argon and 3.1 Pro Preview have no free API tier. Batch and web-search access differ from standard requests; badges do not promise either. Paid Google projects use paid rates. Do not infer a visitor's billing tier from their selected model or API key.

OpenAI models are labeled Paid API; free chat subscriptions do not fund API calls. Anthropic trial/promotional credits are distinguished from an ongoing free tier. Access notes and pricing links appear in the shared setup panel for both workspaces.

Argon uses low/medium/high reasoning, a 32,768-token output allowance, and a longer request timeout to follow the migration guide. Standard introductory rates are $2/$10 per million input/output tokens through November 30, 2026, increasing to $4/$20 on December 1. The estimator includes this change and the $1/$5 standard Terra rates.

Verification uses mocked requests, payload checks, and pricing arithmetic. No live user API keys or paid calls are used. Labels describe documented eligibility, not a guarantee of account-specific access or remaining quota.
