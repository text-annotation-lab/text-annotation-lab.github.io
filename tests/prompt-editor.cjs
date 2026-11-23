// "Expand" opens the annotation prompt (and the research System prompt) in a large window that edits the same value,
// and textarea scrollbars keep clear of the rounded corners.
const fs=require('node:fs'),assert=require('node:assert/strict');
const page=fs.readFileSync('app/page.tsx','utf8'),editor=fs.readFileSync('components/prompt-editor.tsx','utf8');
const system=fs.readFileSync('components/research/request-options.tsx','utf8'),css=fs.readFileSync('app/globals.css','utf8');
assert.match(page,/<ExpandPrompt target=\{options\?"knowledge-prompt":"prompt"\}[^>]*value=\{prompt\} onChange=\{setPrompt\}/,'the prompt box has Expand in both modes and in Model knowledge');
assert.match(system,/<ExpandPrompt target=\{id\} title="System prompt"[^>]*onChange=\{onChange\}/,'the System prompt has Expand');
assert.match(editor,/onChange=\{event=>onChange\(event\.target\.value\)\}/,'edits in the window go straight back');
assert(!/confirm\(/.test(editor),'never the browser’s own box');
assert.match(css,/textarea::-webkit-scrollbar-track\{background:transparent;margin:8px 0\}/,'scrollbar track stays off the corners');
console.log('PASS: Expand opens the prompt in a large window that edits the same prompt; scrollbars keep off the corners.');
