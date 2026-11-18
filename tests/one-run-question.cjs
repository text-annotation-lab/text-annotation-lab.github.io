// A research run that annotates texts again asks one question: the note about the new run goes in the same dialog
// as the cost (Jens saw two dialogs in a row on All, November 18, 2026).
const fs=require('fs'),assert=require('assert/strict');
const page=fs.readFileSync('app/page.tsx','utf8');
const body=name=>{const start=page.indexOf('async function '+name+'(');assert.ok(start>0,name);return page.slice(start,page.indexOf('\n }\n',start));};
for(const name of ['runEvery','runRemaining','trySample']){
 const code=body(name);
 assert.equal((code.match(/confirm\(/g)||[]).length,0,name+' asks no question of its own');
 assert.equal((code.match(/runConfirmed\(/g)||[]).length,1,name+' asks through runConfirmed once');
}
const confirmed=body('runConfirmed');
assert.match(confirmed,/again\.tell\+'\\n\\n'\+question/);
assert.equal((confirmed.match(/confirm\(/g)||[]).length,2,'one confirm on each path');
