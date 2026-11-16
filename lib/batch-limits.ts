// Shared browser/server limits. Keep source uploads and prepared provider payloads
// separately bounded: extraction, repeated prompts, and PDF encoding change size.
export const MAX_BATCH_ITEMS=10000;
export const MAX_KNOWLEDGE_INPUT_CHARS=8000000;
export const MAX_BATCH_SOURCE_BYTES=50*1024*1024;
export const MAX_BATCH_REQUEST_BYTES=54*1024*1024;
export const MAX_BATCH_PREPARED_BYTES=72*1024*1024;
export const MAX_GEMINI_PREPARED_BYTES=18*1024*1024; // Inline API limit is 20 MB.
export const BATCH_CAPACITY='Batch limit: 10,000 items and 50 MB combined source size per submission. Long prompts and PDF encoding may require a smaller batch.';
// Research mode: a batch run larger than one provider batch is sent as several batches in the same run. Limits of one
// batch: OpenAI 200 MB and 50,000 requests, Anthropic 256 MB and 100,000 requests, of which 95% is used; Gemini's
// inline batches 18 MB as above. A batch holds at most 10,000 requests, so its results can be collected in one piece.
export const SPLIT_LIMITS={openai:{bytes:190e6,requests:10000,label:'OpenAI',providerMb:200},anthropic:{bytes:243.2e6,requests:10000,label:'Anthropic',providerMb:256},gemini:{bytes:MAX_GEMINI_PREPARED_BYTES,requests:10000,label:'Gemini',providerMb:20}} as const;
// A whole run in research mode: requests, source files, and the requests as prepared (held in the page until sent).
export const MAX_SPLIT_REQUESTS=100000;
export const MAX_SPLIT_SOURCE_BYTES=1024*1024*1024;
export const MAX_SPLIT_UPLOAD_BYTES=MAX_SPLIT_SOURCE_BYTES+64*1024*1024;
export const MAX_SPLIT_PREPARED_BYTES=2*1024*1024*1024;
// Results of one batch collected in research mode, which keeps more of each reply.
export const MAX_RECORDED_RESULT_BYTES=128*1024*1024;
export const SPLIT_CAPACITY='A run larger than one provider batch is sent as several batches in the same run, each within the provider’s limit (OpenAI 200 MB, Anthropic 256 MB, Gemini 18 MB) and at most 10,000 requests. A run holds up to 100,000 requests.';
