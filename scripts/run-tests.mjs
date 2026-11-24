// Runs every test in tests/, several at a time. Provider traffic is mocked; no real keys are used.
// `node scripts/run-tests.mjs name …` runs only the test files whose names contain one of the words.
import {readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {availableParallelism} from 'node:os';
const only=process.argv.slice(2),tests=readdirSync('tests').filter(name=>/\.(cjs|mjs)$/.test(name)&&(!only.length||only.some(word=>name.includes(word)))).sort();
const results=new Map();let next=0;
const run=name=>new Promise(resolve=>{
 const child=spawn(process.execPath,['tests/'+name],{stdio:['ignore','pipe','pipe']});let out='',err='';
 child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
 child.on('error',error=>resolve({ok:false,out,err:err+String(error)}));child.on('close',code=>resolve({ok:code===0,out,err}));
});
async function worker(){while(next<tests.length){const name=tests[next++];results.set(name,await run(name));}}
await Promise.all(Array.from({length:Math.max(1,Math.min(availableParallelism(),8,tests.length))},worker));
let failed=0;
// A failed test shows the end of what it printed and of what it reported as an error, both.
const tail=text=>text.trim().split('\n').slice(-12).join('\n');
for(const name of tests){
 const result=results.get(name);
 if(result.ok)console.log('ok   '+name);
 else{failed++;console.log(['FAIL '+name,tail(result.out),tail(result.err)].filter(Boolean).join('\n'));}
}
console.log(`${tests.length-failed}/${tests.length} test files passed.`);
process.exit(failed?1:0);
