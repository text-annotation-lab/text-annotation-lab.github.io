// Shared browser/server limits. Keep source uploads and prepared provider payloads
// separately bounded: extraction, repeated prompts, and PDF encoding change size.
export const MAX_BATCH_ITEMS=10000;
export const MAX_KNOWLEDGE_INPUT_CHARS=8000000;
export const MAX_BATCH_SOURCE_BYTES=50*1024*1024;
export const MAX_BATCH_REQUEST_BYTES=54*1024*1024;
export const MAX_BATCH_PREPARED_BYTES=72*1024*1024;
export const MAX_GEMINI_PREPARED_BYTES=18*1024*1024; // Inline API limit is 20 MB.
export const BATCH_CAPACITY='Batch limit: 10,000 items and 50 MB combined source size per submission. Long prompts and PDF encoding may require a smaller batch.';
