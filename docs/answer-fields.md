# Optional named answer fields

Text Annotation Lab supports up to 10 distinct, named answer fields per workspace. The collapsed editor below the prompt keeps the original single-score workflow as the default. Students define each field’s meaning and scale in their prompt. All answers share the existing explanation.

Labels map to stable f0, f1, etc. keys in a required nested JSON schema across OpenAI, Anthropic, and Gemini. Each value is a string; no scale validation or automatic ranking across documents is implied. Invalid or missing values are reported as errors without automatic resubmission. Provider calls are unchanged when no fields are configured.

Field definitions and values travel with each attempt and saved batch, survive browser storage and study backups, and become separate results and Excel columns. Earlier single-score results keep their original column in mixed exports. Exported settings record the original prompt and the added answer-format instructions. Retries use current fields and archive earlier settings/values. Token counting and estimation include named output instructions and schemas; usage calibration requires matching field definitions.

Verification: tests/answer-fields.cjs mocks all provider traffic, checks text and model-knowledge requests, batch schemas/results, pre-call validation, missing values, mixed/reordered historical exports, numeric zero, study backups, and retry history. Existing batch, token-counting, model-knowledge web research, estimate, export, and portability tests also cover unchanged behavior.
