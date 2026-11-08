// Set false and republish to hide Gemini and reject its API requests.
export const GEMINI_ENABLED = true;
export const OPENROUTER_STARTER_MODELS = ['openai/gpt-6-luna','anthropic/claude-haiku-5.5','google/gemini-3.1-flash-lite'];
export type Provider = 'openai' | 'gemini' | 'anthropic' | 'openrouter';
// Stable order by standard text input/output rates, checked October 28, 2026.
// Equal rates retain an explicit order; capability does not determine price order.
export const PROVIDERS = {
 openrouter: {label:'OpenRouter',models:['openai/gpt-6-luna','anthropic/claude-haiku-5.5','google/gemini-3.1-flash-lite','openai/gpt-6-sol','anthropic/claude-sonnet-5.5','google/gemini-3.8-flash'],efforts:['low','medium','high'],keyUrl:'https://openrouter.ai/settings/keys'},
 openai: {label:'OpenAI (ChatGPT)',models:['gpt-6-luna','gpt-5.6-luna','gpt-6.1-terra','gpt-6.1-sol','gpt-6-sol','gpt-5.6-terra','gpt-5.6-sol','gpt-6-astra'],efforts:['low','medium','high'],keyUrl:'https://platform.openai.com/api-keys'},
 gemini: {label:'Google (Gemini)',models:['gemini-2.5-flash-lite','gemini-3.1-flash-lite','gemini-3.5-flash-lite','gemini-2.5-flash','gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-2.5-pro','gemini-4-argon','gemini-3.1-pro-preview'],efforts:['minimal','low','medium','high'],keyUrl:'https://aistudio.google.com/api-keys'},
 anthropic: {label:'Anthropic (Claude)',models:['claude-haiku-5-5','claude-haiku-4-5-20251001','claude-sonnet-5-5','claude-opus-5-5','claude-fable-5-1'],efforts:['low','medium','high','xhigh','max'],keyUrl:'https://platform.claude.com/settings/keys'}
};
// Defaults are independent of price order: Gemini 2.5 access is restricted.
export function defaultModel(provider:Provider):string {return provider==='openrouter'?'openai/gpt-6-luna':provider==='gemini'?'gemini-3.1-flash-lite':provider==='anthropic'?'claude-haiku-5-5':'gpt-6-luna';}
export function selectedModel(provider:Provider,saved:unknown):string {return typeof saved==='string'&&PROVIDERS[provider].models.includes(saved)?saved:defaultModel(provider);}
export function availableProvider(value:unknown):Provider {return value==='openrouter'?'openrouter':value==='anthropic'?'anthropic':GEMINI_ENABLED && value==='gemini'?'gemini':'openai';}
export function reasoningOptions(provider:Provider,model:string):string[]{
 if(provider==='openrouter'&&model==='google/gemini-3.1-flash-lite')return ['minimal','low','medium','high'];
 if(provider==='gemini'){
  if(model==='gemini-2.5-pro')return ['dynamic','1024','4096','8192'];
  if(model.startsWith('gemini-2.5-'))return ['off','dynamic','1024','4096','8192'];
  if(model==='gemini-4-argon'||model==='gemini-3.8-flash'||model==='gemini-3.1-pro-preview')return ['low','medium','high'];
 }
 if(provider==='openai'&&(model==='gpt-6-sol'||model==='gpt-6-luna'||model==='gpt-6.1-terra'||model.startsWith('gpt-5.6-')))return ['none','low','medium','high','xhigh','max'];
 if(provider==='openai'&&(model==='gpt-6-astra'||model==='gpt-6.1-sol'))return ['low','medium','high','xhigh','max'];
 return provider==='anthropic'&&model.startsWith('claude-haiku-4-5')?['off','1024','4096','8192']:PROVIDERS[provider].efforts;
}
export function defaultEffort(provider:Provider,model:string):string{
 if(provider==='openrouter')return model==='google/gemini-3.1-flash-lite'?'minimal':'medium';
 if(provider==='gemini')return model==='gemini-2.5-flash-lite'?'off':model.startsWith('gemini-2.5-')?'dynamic':model==='gemini-3.1-pro-preview'?'high':model==='gemini-3.8-flash'||model==='gemini-3.6-flash'||model==='gemini-4-argon'?'medium':'minimal';
 return provider==='anthropic'?(model.startsWith('claude-haiku-4-5')?'off':model==='claude-opus-5-5'||model==='claude-haiku-5-5'?'medium':'high'):'medium';
}
// Use one short label throughout the interface. Legacy numeric budgets retain
// their original API values; the menu presents them as relative levels.
export function reasoningLabel(_provider:string|undefined,_model:string):string{return 'Reasoning effort';}
export function reasoningOptionLabel(value:string):string{return ({'1024':'low','4096':'medium','8192':'high','dynamic':'auto'} as Record<string,string>)[value]||value;}

export function modelLabel(model:string):string{
 if(model.includes('/')){const [vendor,id]=model.split('/');return (vendor==='google'?'Google · ':vendor==='anthropic'?'Anthropic · ':'OpenAI · ')+modelLabel(id.replace(/claude-(haiku|sonnet)-(\d+)\.(\d+)/,'claude-$1-$2-$3'));}
 const labels:Record<string,string>={'gemini-4-argon':'Gemini 4 Argon','gemini-3.6-flash':'Gemini 3.6 Flash','gemini-3.5-flash-lite':'Gemini 3.5 Flash-Lite','gemini-3.1-flash-lite':'Gemini 3.1 Flash-Lite','gemini-3.8-flash':'Gemini 3.8 Flash','gemini-3.5-flash':'Gemini 3.5 Flash','gemini-3.1-pro-preview':'Gemini 3.1 Pro (preview)','gemini-2.5-flash-lite':'Gemini 2.5 Flash-Lite','gemini-2.5-flash':'Gemini 2.5 Flash','gemini-2.5-pro':'Gemini 2.5 Pro'};
 if(model.startsWith('gpt-'))return model.replace(/^gpt-/,'GPT-').replace(/-(luna|terra|sol|astra)$/,(_,name:string)=>' '+name[0].toUpperCase()+name.slice(1));
 if(model==='claude-haiku-4-5-20251001')return 'Claude Haiku 4.5';
 if(model.startsWith('claude-'))return model.replace(/^claude-(\w+)-(\d+)-(\d+)$/,(_,name:string,major:string,minor:string)=>'Claude '+name[0].toUpperCase()+name.slice(1)+' '+major+'.'+minor);
 return labels[model]||model;
}
export function geminiModelHint(model:string):string{
 if(model==='gemini-4-argon')return 'Google’s current flagship reasoning model for demanding analysis. Paid API access only; complex requests can take several minutes.';
 if(model==='gemini-3.6-flash')return 'A previous-generation Flash model, retained for production use and comparisons.';
 if(model==='gemini-3.5-flash-lite')return 'A current, economical starting point for small annotation trials.';
 if(model==='gemini-3.1-flash-lite')return 'A lower-cost Flash-Lite option for simple annotation tasks.';
 if(model==='gemini-3.8-flash')return 'The latest Flash model for more demanding annotation tasks.';
 if(model==='gemini-3.1-pro-preview')return 'An advanced Pro option for complex tasks, with paid API access; this model is in preview.';
 if(model==='gemini-2.5-flash-lite')return 'The lowest-cost option in this selection. Google limits 2.5 access to accounts that used these models previously. Thinking is off by default.';
 if(model==='gemini-2.5-flash')return 'An older budget option. Google limits 2.5 access to accounts that used these models previously.';
 if(model==='gemini-2.5-pro')return 'An older Pro model for demanding tasks. Google limits 2.5 access to accounts that used these models previously.';
 return 'An earlier Flash identifier, retained for existing studies. Google now routes it to Gemini 3.6 Flash.';
}

export const MODEL_PRICING_URLS:Record<Provider,string>={openrouter:'https://openrouter.ai/models',openai:'https://developers.openai.com/api/docs/pricing',anthropic:'https://platform.claude.com/docs/en/about-claude/pricing',gemini:'https://ai.google.dev/gemini-api/docs/pricing'};
export function modelHint(provider:Provider,model:string):string {
 if(provider==='openrouter')return OPENROUTER_STARTER_MODELS.includes(model)?'An economical starting point. Test it on a varied sample before running your study.':'A more capable comparison model. Compare its judgments with your own reading of the texts.';
 if(provider==='gemini')return geminiModelHint(model);
 const hints:Record<string,string>={
  'gpt-6-luna':'An economical starting point for classification and routine text annotation. Test it on a varied sample before running your study.',
  'gpt-5.6-luna':'An earlier economical Luna model, retained for existing studies and comparisons.',
  'gpt-6.1-terra':'A current, lower-cost option for visual reasoning, writing, and text interpretation. Test it on a varied sample before running your study.',
  'gpt-6.1-sol':'A current general-purpose reasoning model to try when annotations require more nuanced interpretation.',
  'gpt-6-sol':'A general-purpose reasoning model for detailed annotation and interpretation; standard input/output rates match GPT-6.1 Sol.',
  'gpt-5.6-terra':'An earlier general-purpose model, retained for existing studies. Its output rate is higher than GPT-6 Sol’s.',
  'gpt-5.6-sol':'An earlier reasoning model, retained for existing studies and comparisons with the GPT-6 family.',
  'gpt-6-astra':'An advanced reasoning option to test on difficult or ambiguous texts, with substantially higher API rates.',
  'claude-haiku-5-5':'A current, economical Claude starting point for classification and routine text annotation. Test it on a varied sample first.',
  'claude-haiku-4-5-20251001':'An earlier Haiku model, retained for existing studies and comparisons.',
  'claude-sonnet-5-5':'A general-purpose Claude model to try for more nuanced interpretation and detailed annotation.',
  'claude-opus-5-5':'A Claude reasoning option for complex analysis and demanding knowledge work.',
  'claude-fable-5-1':'An advanced Claude option for demanding reasoning, with substantially higher API rates.'
 };
 return hints[model]||'Test this model on a small, varied sample before running your study.';
}

// Standard-request eligibility, verified against first-party pricing. This does
// not inspect an API key or promise quota for a particular account.
export const MODEL_ACCESS_CHECKED='October 28, 2026';
const FREE_GEMINI_MODELS=new Set(['gemini-3.1-flash-lite','gemini-3.5-flash-lite','gemini-3.8-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-2.5-flash-lite','gemini-2.5-flash','gemini-2.5-pro']);
export function modelAccessLabel(provider:Provider,model:string):string{
 if(provider!=='gemini')return 'Paid API';
 if(FREE_GEMINI_MODELS.has(model))return model.startsWith('gemini-2.5-')?'Free tier · restricted':'Free API tier';
 return 'Paid API';
}
export function modelAccessHint(provider:Provider,model:string):string{
 if(provider==='openrouter')return 'Usage draws from the account behind your OpenRouter key and counts toward its spending limit. A course-issued key does not require your own provider account. OpenRouter sends your prompt and text to a serving provider for the selected model; both services\u2019 data policies apply. Model availability depends on the key and account settings.';
 if(provider==='openai')return 'OpenAI API usage is billed separately from ChatGPT subscriptions. These models have no ongoing free API tier.';
 if(provider==='anthropic')return 'Claude API usage is billed separately from Claude chat subscriptions. Trial or promotional credits may be available; they are not an ongoing free tier.';
 if(!FREE_GEMINI_MODELS.has(model))return 'No free API tier for this model. Free access inside AI Studio does not imply free access through this Lab.';
 return 'Free API tier for standard requests, within your Google project’s quotas. This does not make a billing-enabled project free. Batch and web search have separate eligibility. For a first trial, use Instant, turn web search off, and run one annotation at a time.';
}
export function annotationOutputLimit(provider:string,model:string):number{return provider==='gemini'&&model==='gemini-4-argon'?32768:12000;}
