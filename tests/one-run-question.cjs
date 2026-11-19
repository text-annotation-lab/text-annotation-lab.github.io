// A research run that annotates texts again asks one question: the note about the new run goes in the same dialog
// as the cost (Jens saw two dialogs in a row on All, November 18, 2026). The question is asked in the Lab's own
// window (lib/ask.ts), not the browser's box.
const fs=require('fs'),assert=require('assert/strict');
// (Line endings read as \n, so a Windows checkout with CRLF passes too.)
const page=fs.readFileSync('app/page.tsx','utf8').replace(/\r\n/g,'\n');
const body=name=>{const start=page.indexOf('async function '+name+'(');assert.ok(start>0,name);return page.slice(start,page.indexOf('\n }\n',start));};
for(const name of ['runEvery','runRemaining','trySample']){
 const code=body(name);
 assert.equal((code.match(/\b(?:confirm|ask|askThen)\(/g)||[]).length,0,name+' asks no question of its own');
 assert.equal((code.match(/runConfirmed\(/g)||[]).length,1,name+' asks through runConfirmed once');
}
const confirmed=body('runConfirmed');
assert.match(confirmed,/again\.tell\+'\\n\\n'\+question/);
assert.equal((confirmed.match(/\bask\(/g)||[]).length,2,'one question on each path');
assert.equal((confirmed.match(/\bconfirm\(/g)||[]).length,0,'never the browser\'s own box');
