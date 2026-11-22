// What each setting does. The research About page lists them all under “Settings explained”, from this one list.
// An ⓘ beside a setting shows its text only where the Lab's own behavior is not obvious; settings researchers know
// from the providers' APIs (temperature, output limit, reasoning summary, OpenAI's logs, system prompt, parallel
// requests) have none in research mode. What depends on the current
// input (a prompt's length for caching, a limit of the chosen model, a warning) stays beside the setting itself.
import {PRICE_DATE} from '@/lib/cost-estimate/pricing';
import {PLAIN_FIELD} from '@/lib/answer-types';
const PRICES_AS_OF=new Date(PRICE_DATE+'T00:00:00Z').toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
// Ask for an explanation, in both modes (the standard Lab shows these three, research mode adds two lines).
export const EXPLANATION_HELP=[
 'This adds nothing to your prompt. It adds an explanation field to the answer format sent with each request, ahead of the answers, so the model must write one before it answers. It is kept as each result’s explanation.',
 'The format asks only for a brief justification, citing the text where relevant. Say in your prompt what a good explanation should contain, such as its length or the evidence to cite.',
 'Without it the reply has no place for an explanation, even if your prompt asks for one. A field of your own named Explanation takes its place.',
];
export type SettingHelpId='temperature'|'max-output'|'prices'|'reasoning-summary'|'openai-logs'|'prompt'|'system-prompt'|'answer-fields'|'plain-text'|'json-scale'|'explanation'|'chunking'|'parallel'|'repeats'|'prompt-caching';
export const SETTING_HELP:{id:SettingHelpId;label:string;text:string[]}[]=[
 {id:'temperature',label:'Temperature',text:['Empty: no temperature is sent and the model uses its own. From 0 to 2 (0 to 1 for Anthropic). Many reasoning models accept only their default and reject a request with another value. Claude models that reason take no temperature, so none is sent.']},
 {id:'max-output',label:'Max output tokens',text:['The most tokens a reply may use, reasoning included. A reply that reaches the limit counts as failed. The line under the box gives the Lab’s own limit for the chosen model.']},
 {id:'prices',label:'Price per million tokens',text:[`Used only for the cost estimate before a run. The Lab’s prices are list prices as of ${PRICES_AS_OF}, and can go out of date; type your own to replace them. Your own price is kept in this browser.`]},
 {id:'reasoning-summary',label:'Record the model’s reasoning summary',text:['A readable summary of the model’s reasoning, kept with each result and in the exports. Some models return none.']},
 {id:'openai-logs',label:'Show requests in OpenAI’s logs',text:['Lets you inspect the requests on platform.openai.com. OpenAI keeps stored requests for a limited time; switch this off for confidential texts.']},
 {id:'prompt',label:'Annotation prompt',text:['Each text is added after the prompt. {{text}} in the prompt places it there instead; {{meta.column}} inserts the text’s value of a metadata column, and {{id}} its name without the file extension. In Model knowledge, the subject’s fields take the place of the text, and {{id}} is the subject’s name.']},
 {id:'system-prompt',label:'System prompt',text:['Sent unchanged with every request as the system prompt, ahead of the message with your prompt and the text. Leave empty unless you follow a setup that uses one.']},
 {id:'answer-fields',label:'Answer fields',text:['Without fields, the model returns one score or category. With fields, the model must return exactly these fields, in this order, so every result becomes a clean column.','Changes apply to future annotations. Results keep the fields they were made with.']},
 {id:'plain-text',label:'Plain text',text:[`The whole reply is stored as one column, “${PLAIN_FIELD}.” When a reply is one JSON object, exports, charts, and comparisons also have a column for each of its values; a reply with JSON among other text counts as failed. No answer format is sent or added to your prompt, and no explanation is asked for separately.`]},
 {id:'json-scale',label:'Scale of the scores',text:['If the replies are JSON with scores (for example, "race": −2), give their scale. Agreement then uses all of it, as for an ordinal field: Gwet’s AC1 and AC2 count every point, and a number off the scale (for example, 7) is left out and reported. A value answered only with 0 and 1 keeps its own range. Empty: the range of the scores the model gave. Not sent to the model; applies to every plain-text run of this study, also earlier ones.']},
 {id:'explanation',label:'Ask for an explanation',text:[EXPLANATION_HELP[0],EXPLANATION_HELP[1]+' Preview request shows it in the request.',EXPLANATION_HELP[2],'It is not the reasoning summary, which is the provider’s digest of a reasoning model’s hidden thinking.']},
 {id:'chunking',label:'Split into chunks',text:['Choose a word-count target and boundary method. Each chunk gets its own annotation and result. Whole sentences: sentences are kept together where possible, so chunk lengths are approximate. Exact word counts: boundaries may fall within a sentence.']},
 {id:'parallel',label:'Parallel annotations',text:['A run can annotate up to 128 texts at once. Each text gets a separate request; token prices are unchanged. When the provider reports a rate limit, the run waits and goes on with fewer at a time. Annotate next always runs one text.']},
 {id:'repeats',label:'Annotations per text',text:['Use 2 or more to measure how consistent the model is. Each text is then annotated that many times, each time with a request of its own. Results show the majority (categories), the median (ordinal scales), or the mean (numbers), and how consistent the repeats were; scores in plain-text JSON answers are combined by their median, other values by majority. Use an odd number so a median is a whole number.']},
 {id:'prompt-caching',label:'Prompt caching',text:['The provider stores the part of the prompt that is the same for every text (with the system prompt); later texts read it at a lower price, and storing it costs extra. OpenAI keeps it for 30 minutes, Anthropic for 5 minutes. Prompts below the model’s minimum length are not cached; the line under the box gives this prompt’s length.']},
];
export const settingHelp=(id:SettingHelpId)=>SETTING_HELP.find(entry=>entry.id===id)!;
