const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const projectRequire=createRequire(path.join(process.cwd(),'package.json'));
const Zip=createRequire(projectRequire.resolve('exceljs'))('jszip');
const ts=projectRequire('typescript');
(async()=>{
 const corpora={
  'inaugural-corpus.zip':{count:60,include:/\.txt$/i},
  'presidential_debates_corpus.zip':{count:2278,include:/\/texts\/.*\.txt$/i},
  'obituary_pairs_corpus.zip':{count:200,include:/\/texts_clean\/.*\.txt$/i},
  'scouts_campfire_corpus.zip':{count:120,include:/\/texts\/.*\.txt$/i},
  'wpa_narratives_women_men.zip':{count:100,include:/\/texts\/.*\.txt$/i},
  'campaign_speeches_2008_2016.zip':{count:117,include:/\/texts\/.*\.txt$/i},
  'dime_westerns_1870s.zip':{count:24,include:/\/texts\/.*\.txt$/i},
  'billboard_corpus.zip':{count:4547,include:/\/texts\/.*\.txt$/i}
 };
 for(const [name,{count,include}] of Object.entries(corpora)){
  const zip=await Zip.loadAsync(fs.readFileSync(path.join('public/teaching',name)),{checkCRC32:true});
  const texts=Object.values(zip.files).filter(file=>!file.dir&&include.test(file.name));assert.equal(texts.length,count,name);
  for(const file of texts)assert((await file.async('string')).trim().length>0,file.name);
  if(name==='presidential_debates_corpus.zip'){
   for(const [folder,expected] of Object.entries({debates:37,candidates:77,turns_sample:290,turns_all:1874})){
    assert.equal(texts.filter(file=>file.name.includes(`/texts/${folder}/`)).length,expected,folder);
   }
   assert(zip.file('presidential_debates_corpus/README.md'));
   assert(zip.file('presidential_debates_corpus/presidential_debates_metadata.xlsx'));
  }
  if(name==='billboard_corpus.zip'){
   // The archive lists a SHA-256 for each of its files: the ones beside the texts must still match it (a README
   // edited inside the archive needs its line updated).
   const sums=(await zip.file('Billboard_corpus/CHECKSUMS.txt').async('string')).split(/\r?\n/).filter(Boolean).map(line=>line.split('  '));assert.equal(sums.length,4552);
   for(const [sum,file] of sums.filter(([,file])=>!file.startsWith('texts/')))assert.equal(require('node:crypto').createHash('sha256').update(await zip.file('Billboard_corpus/'+file).async('nodebuffer')).digest('hex'),sum,file);
  }
 }
 const tips=JSON.parse(fs.readFileSync('lib/teaching-tips.json','utf8'));assert.equal(tips.length,10);assert(tips.every(tip=>tip.includes('. ')));
 const exports={};new Function('exports',ts.transpileModule(fs.readFileSync('lib/study-closer-look.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exports);
 const study=exports.withCloserLookNotes(JSON.parse(fs.readFileSync('lib/study-example.json','utf8')).html);assert.equal((study.match(/data-study-note=/g)||[]).length,6);
 // Every component, in every folder under components/ (research mode's too).
 const source=[...fs.readdirSync('components',{recursive:true}).map(String).filter(file=>file.endsWith('.tsx')).sort().map(file=>fs.readFileSync(path.join('components',file),'utf8')),fs.readFileSync('app/page.tsx','utf8'),study].join('\n');
 const ids=new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]));
 // Shared workspace controls can choose their IDs with a JSX expression.
 const page=ts.createSourceFile('page.tsx',fs.readFileSync('app/page.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function collect(node){if(ts.isJsxAttribute(node)&&node.name.getText(page)==='id'&&node.initializer&&ts.isJsxExpression(node.initializer)){const strings=n=>{if(ts.isStringLiteral(n))ids.add(n.text);ts.forEachChild(n,strings);};strings(node.initializer);}ts.forEachChild(node,collect);}collect(page);
 for(const [,url] of source.matchAll(/(?:href|src)=["']([^"']+)["']/g)){
  if(url.startsWith('#'))assert(ids.has(url.slice(1)),`Missing section ${url}`);
  if(url.startsWith('/')&&!url.startsWith('//'))assert(fs.existsSync(path.join('public',url.split('?')[0])),`Missing asset ${url}`);
 }
 assert(!/<script\b|\bon\w+\s*=/i.test(study),'Study HTML must remain static');
 console.log('PASS: eight corpus ZIP CRCs, 7,446 nonempty text files across the supplied study levels, presidential debate folder counts and documentation, the Billboard archive’s checksums beside its texts, local downloads/images, internal section targets, ten tips, and six closer-look notes. External website availability is not covered.');
})().catch(error=>{console.error(error);process.exit(1);});
