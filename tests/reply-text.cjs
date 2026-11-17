// Written replies (research mode) are shown without Markdown symbols in the tables and laid out in the details.
// Display only: the stored reply is never changed, and the standard Lab is left as is. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;const local=id=>id.startsWith('@/')?load(id.slice(2)+'.ts'):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(filename),id+'.ts'))):req(id);new Function('exports','require',code)(exports,local);return exports;}

const r=load('lib/reply-text.ts');
const reply='### 1. Score: 3\n\n### 2. Explanation\nRonald Reagan’s language is **plain and direct**, with *short* sentences.\n\n- one `x`\n- two [link](https://a.b)\n\n---\n**Representative sentence:** “We the people.”';
assert.equal(r.replyPreview(reply),'1. Score: 3 · 2. Explanation · Ronald Reagan’s language is plain and direct, with short sentences. · one x · two link · Representative sentence: “We the people.”');
assert.equal(r.hasMarkdown(reply),true);
const blocks=r.replyBlocks(reply);
assert.deepEqual(blocks.map(b=>b.kind),['heading','heading','paragraph','list','rule','paragraph']);
assert.deepEqual(r.inlineParts('a **b** c'),[{text:'a '},{text:'b',bold:true},{text:' c'}]);
// Plain prose, numbers, and words with underscores or asterisks in them stay as they are.
for(const plain of ['A plain answer.','3','snake_case_name stays','2*3*4 = 24','Line one\nLine two'])assert.equal(r.hasMarkdown(plain),false,plain);
assert.equal(r.replyPreview('Line one\nLine two'),'Line one · Line two');
const numbered='1. Score (1–7): 4\n2. Explanation: mixed.';
assert.equal(r.replyPreview(numbered),'1. Score (1–7): 4 · 2. Explanation: mixed.');
// Which answers count as written: research plain text, Free text fields, and the explanation; never the standard Lab.
assert.equal(r.isWrittenAnswer({answerSettings:{plain:true}},'response'),true);
assert.equal(r.isWrittenAnswer({answerSettings:{named:true,fields:[{name:'tone',type:'category'},{name:'notes',type:'text'}]}},'tone'),false);
assert.equal(r.isWrittenAnswer({answerSettings:{named:true,fields:[{name:'notes',type:'text'}]}},'notes'),true);
assert.equal(r.isWrittenAnswer({answerSettings:{named:true}},'explanation'),true);
assert.equal(r.isWrittenAnswer({},'explanation'),false);
assert.equal(r.isWrittenAnswer({answerFields:['response']},'response'),false);
// The display never touches the stored reply.
const src=fs.readFileSync(path.join(root,'components/named-answer-detail.tsx'),'utf8');
assert(!/dangerouslySetInnerHTML/.test(src),'Replies are rendered as text, never as HTML');
console.log('reply-text ok');
