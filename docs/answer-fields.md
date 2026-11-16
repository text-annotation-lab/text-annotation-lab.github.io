# Optional named answer fields

Text Annotation Lab supports up to 10 distinct, named answer fields per workspace. The collapsed editor below the prompt keeps the original single-score workflow as the default. Students define each field’s meaning and scale in their prompt. All answers share the existing explanation.

Labels map to stable f0, f1, etc. keys in a required nested JSON schema across OpenAI, Anthropic, and Gemini. Each value is a string; no scale validation or automatic ranking across documents is implied. Invalid or missing values are reported as errors without automatic resubmission. Provider calls are unchanged when no fields are configured.

Field definitions and values travel with each attempt and saved batch, survive browser storage and study backups, and become separate results and Excel columns. Earlier single-score results keep their original column in mixed exports. Exported settings record the original prompt and the added answer-format instructions. Retries use current fields and archive earlier settings/values. Token counting and estimation include named output instructions and schemas; usage calibration requires matching field definitions.

Verification: tests/answer-fields.cjs mocks all provider traffic, checks text and model-knowledge requests, batch schemas/results, pre-call validation, missing values, mixed/reordered historical exports, numeric zero, study backups, and retry history. Existing batch, token-counting, model-knowledge web research, estimate, export, and portability tests also cover unchanged behavior.

## Research mode: fields under their own names

In research mode, the fields go to the provider under their own names and types, and nothing about the answer format is added to the prompt (`named` in the answer settings, `lib/answer-fields.ts`). The schema holds a `rationale` first (where an explanation is asked for), then each field in its order: a category as text, an ordinal scale as a whole number limited to its values (for Gemini, between its lowest and highest value), a number as a number, yes / no as true or false, and free text as text. A field gets a description only where one was written. A name that is not a key (letters, digits, and `_`, not starting with a digit) is sent as a key made from it (`Word count` → `word_count`); `rationale` and repeated keys get a suffix. Replies are stored as before: by f0, f1, … as text, with a number as JavaScript writes it and true / false as yes / no.

Model knowledge keeps its own paragraph after the prompt (in research mode it names no key), and its scales, numbers, and yes / no fields go as text limited to their values and INSUFFICIENT_KNOWLEDGE. The paragraph is shown in Preview request, a run’s Settings window, the recorded prompt and settings, and the exports.

The standard Lab sends the earlier format unchanged. Results made with the earlier format are another setup in research mode, so Remaining counts their texts again; Retry failed sends a run’s requests as the run made them.
