// Run after the production build: optional tools must stay out of the initial graph.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root='dist/client',manifest=JSON.parse(fs.readFileSync(path.join(root,'.vite/manifest.json'),'utf8'));
const initial=new Set();
function visit(key){assert(manifest[key],`Missing manifest entry: ${key}`);if(initial.has(key))return;initial.add(key);for(const dependency of manifest[key].imports||[])visit(dependency);}
visit('index.html');
for(const key of ['components/get-started.tsx','components/teaching-panels.tsx','components/study-example.tsx','components/about.tsx','lib/study-backup.ts','lib/export-results.ts','components/results-chart-dialog.tsx','node_modules/unpdf/dist/pdfjs.mjs']){
 assert(manifest[key]?.isDynamicEntry,`${key} must remain available on demand`);
 assert(!initial.has(key),`${key} must not block workspace startup`);
}
const files=[...initial].map(key=>manifest[key].file).filter(file=>file.endsWith('.js'));
const sizes=files.map(file=>{const bytes=fs.readFileSync(path.join(root,file));return {file,raw:bytes.length,gzip:zlib.gzipSync(bytes).length};});
console.log(JSON.stringify({files:sizes,raw:sizes.reduce((n,f)=>n+f.raw,0),gzip:sizes.reduce((n,f)=>n+f.gzip,0)},null,2));
console.log('PASS: reading pages, backups, charts, Excel, and PDF processing are outside the initial JavaScript dependency graph.');
