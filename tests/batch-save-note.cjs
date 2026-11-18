// After a batch is checked, the notice says whether the user can leave the page, from the workspace's save state as
// it is now: saved, still saving, or not saved. Jens asked (2026-11-18) to know for sure. No provider is called.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
const root=process.cwd();
const load=file=>{const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,require);return exports;};
const note=load('lib/batch-save-note.ts');
const still='The batch is still processing. '+note.CLOSE_WHEN_SAVED;
assert.equal(note.withSaveState(still,'saved'),'The batch is still processing. Your workspace is saved, so you can close this page and check back later.');
assert.equal(note.withSaveState(still,'saving'),'The batch is still processing. Saving the workspace… Keep this page open until this says it is saved.');
assert.equal(note.withSaveState(still,'failed'),'The batch is still processing. The workspace could not be saved in this browser, so keep this page open.');
assert.equal(note.withSaveState('Batch results collected.','saved'),'Batch results collected.','Other notices are left as they are');
// Every place that says it: the page (standard Lab and research mode, Workspace and Runs & agreement), Model
// knowledge, and a run sent as several batches; each shows the notice with the save state.
const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8'),mk=fs.readFileSync(path.join(root,'components/model-knowledge.tsx'),'utf8'),split=fs.readFileSync(path.join(root,'lib/research/batch-split.ts'),'utf8');
for(const source of [page,mk,split])assert(source.includes('CLOSE_WHEN_SAVED')&&!source.includes('You can close this page once the workspace is saved.'));
assert(page.includes("const saveState:SaveState=workingCopyFailed?'failed':workingCopySaved?'saved':'saving';"));
assert(page.includes('role="status">{withSaveState(notice,saveState)}</div>'));
assert(mk.includes("{withSaveState(notice,conflict||storageIssue?'failed':ready&&saved?'saved':'saving')}"));
console.log('Batch notices say whether the workspace is saved.');
// While a batch waits, the study's settings are locked on purpose (the texts in it must stay as they were sent);
// the setup panel says so, and a locked text button looks locked.
assert(page.includes("{batchJob&&<p className=\"hint setup-locked\" role=\"note\">"));
assert(page.includes('Settings are locked while a batch is waiting. Collect its results or cancel it to change them.'));
assert(fs.readFileSync(path.join(root,'app/globals.css'),'utf8').includes('.textbutton:disabled{'));
