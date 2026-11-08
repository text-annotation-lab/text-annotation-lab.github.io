// Runs every test in tests/. Provider traffic is mocked; no real keys are used.
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const tests=readdirSync('tests').filter(name=>/\.(cjs|mjs)$/.test(name)).sort();
let failed=0;
for(const name of tests){
 const run=spawnSync(process.execPath,['tests/'+name],{encoding:'utf8'});
 if(run.status===0)console.log('ok   '+name);
 else{failed++;console.log('FAIL '+name+'\n'+(run.stderr||run.stdout).trim().split('\n').slice(-12).join('\n'));}
}
console.log(`${tests.length-failed}/${tests.length} test files passed.`);
process.exit(failed?1:0);
