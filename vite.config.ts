import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {execSync} from 'node:child_process';

// The commit being built: GitHub names it when publishing; a local build asks git.
function commit(){
 if(process.env.GITHUB_SHA)return process.env.GITHUB_SHA.slice(0,7);
 try{return execSync('git rev-parse --short=7 HEAD',{stdio:['ignore','pipe','ignore']}).toString().trim();}catch{return '';}
}

export default defineConfig({
 plugins:[react()],
 // The publish date shown on the About page, and the commit research mode records with it on each result.
 define:{__BUILD_DATE__:JSON.stringify(new Date().toISOString().slice(0,10)),__BUILD_COMMIT__:JSON.stringify(commit())},
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 build:{outDir:'dist/client',manifest:true,emptyOutDir:true},
});
