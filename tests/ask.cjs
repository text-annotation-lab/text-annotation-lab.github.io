// The Lab's own question window (lib/ask.ts, components/ask-dialog.tsx): no code calls the browser's confirm,
// a message is split into a heading and its text, and without the window the answer comes at once.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
function load(file){const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,require);return exports;}
const {ask,askThen,askParts,setAskHost}=load('lib/ask.ts');

// No source file asks through the browser's box (lib/ask.ts itself reads it only as the stand-in for tests).
const sources=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sources(path.join(dir,entry.name)):/\.tsx?$/.test(entry.name)?[path.join(dir,entry.name)]:[]);
for(const file of ['app','components','lib'].flatMap(sources)){
 if(file===path.join('lib','ask.ts'))continue;
 assert.doesNotMatch(fs.readFileSync(file,'utf8'),/(?<![.\w])(?:window\.)?(?:confirm|alert)\(/,file+' asks in the Lab\'s own window');
}
assert.match(fs.readFileSync('app/main.tsx','utf8'),/<AskDialog\/>/,'the window is on the page');

// The first sentence is the heading; the rest is the text, one paragraph per blank line.
assert.deepEqual(askParts('Clear all documents and results from the workspace? Saved studies are not affected. Download the Excel workbook first.'),{title:'Clear all documents and results from the workspace?',text:['Saved studies are not affected. Download the Excel workbook first.']});
assert.deepEqual(askParts('Replace your prompt with the example?'),{title:'Replace your prompt with the example?',text:[]});
assert.deepEqual(askParts('Send 120 requests to gpt-6.2-sol (40 texts × 3 annotations)? Provider charges apply: about $1.20.\n\n2 texts are probably too long.'),{title:'Send 120 requests to gpt-6.2-sol (40 texts × 3 annotations)?',text:['Provider charges apply: about $1.20.','2 texts are probably too long.']});
// A heading of its own keeps the whole message as the text.
assert.deepEqual(askParts('This annotates all 40 texts, as a new run.\n\nSend 80 requests to m? Charges apply.','Annotate again?'),{title:'Annotate again?',text:['This annotates all 40 texts, as a new run.','Send 80 requests to m? Charges apply.']});

(async()=>{
 // Without the window: the environment's confirm answers at once, and yes where there is none.
 delete globalThis.confirm;let ran=0;
 askThen('One?',()=>ran++);assert.equal(ran,1);assert.equal(await ask('Two?'),true);
 const asked=[];globalThis.confirm=message=>{asked.push(message);return false;};
 askThen('Three?',()=>ran++);assert.equal(ran,1);assert.equal(await ask('Four?'),false);assert.deepEqual(asked,['Three?','Four?']);
 // With the window: nothing happens until it answers; the options travel with the question.
 const shown=[];setAskHost(question=>shown.push(question));
 askThen('Delete run #2?',()=>ran++,{yes:'Delete run',danger:true});
 assert.equal(ran,1);assert.equal(shown[0].message,'Delete run #2?');assert.equal(shown[0].yes,'Delete run');assert.equal(shown[0].danger,true);
 shown[0].resolve(true);assert.equal(ran,2);
 askThen('Again?',()=>ran++);shown[1].resolve(false);assert.equal(ran,2);
 const waiting=ask('Wait?');shown[2].resolve(true);assert.equal(await waiting,true);
 assert.equal(asked.length,2,'the browser\'s box is not used while the window is there');
 setAskHost(undefined);delete globalThis.confirm;
 console.log('ask: ok');
})().catch(error=>{console.error(error);process.exit(1);});
