# Optional Gemini integration

To remove Gemini from the interface and reject Gemini API requests, set GEMINI_ENABLED to false in lib/providers.ts, rebuild and publish. Existing annotations remain readable/exportable. Saved Gemini workspace settings fall back to OpenAI; users re-enter their key.

OpenAI remains the default. Provider changes clear the in-memory key. No keys are persisted. Gemini is implemented separately in lib/gemini.ts; no additional dependency or database migration is required.

Models: gemini-3.1-flash-lite and gemini-3.5-flash. Gemini uses thinking levels rather than OpenAI reasoning settings. Each completed/attempted annotation records its own provider, model and settings. Old records default to OpenAI in exports.

Quota errors stop the queue and preserve results; requests are never automatically retried. A user may review usage, return the failed document to the queue and resume. No free-tier access is promised for the EEA/UK/Switzerland.

Validation: node tests/gemini.cjs (mocked provider APIs; no paid calls), TypeScript check and production build. Live account/model eligibility must be checked with a user-owned Gemini key via the interface; do not paste keys into chat.

Baseline before this feature: 02fdeb8e943d754d2cb4b7d7f83a7e050ad93aaf, published version 20. Prefer the feature flag over reverting unrelated later edits.
