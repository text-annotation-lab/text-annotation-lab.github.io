# Export and error clarity

Excel Study settings now lists common fields once, followed by only the differences for each S1/S2 settings ID. Results retain their existing IDs and mapping. A single settings group still has one complete block. Prompts that differ remain separate; long prompts and model instructions retain continuation rows. Missing historical concurrency stays “Not recorded.” Attempt history is unchanged. Excel’s existing CRLF-to-LF normalization is unchanged.

Common provider HTTP errors now explain access, quota/billing, oversized inputs, temporary service failures, and timeouts. Recognized output-limit and refusal reasons are distinguished from unspecified incomplete responses. Numeric Retry-After headers and Gemini retry delays are included when supplied. This applies to annotation requests, web-research HTTP errors, batch-management HTTP errors, and input counting. No automatic retries were added. Ambiguous batch submissions retain their recovery protection. Raw provider messages are not echoed because they can contain credentials or submitted content; unsupported error codes retain conservative guidance.

Official error references reviewed October 29, 2026:
- https://ai.google.dev/gemini-api/docs/api-errors
- https://platform.claude.com/docs/en/api/errors
- https://developers.openai.com/api/docs/guides/error-codes

Verification includes synthetic mixed settings, long Unicode prompts, previous attempts, unannotated rows, model-knowledge repeats, mocked all-provider HTTP failures (including non-JSON bodies), retry delays, batch uncertainty, and existing provider/workspace/export regressions. No live paid annotations were run.
