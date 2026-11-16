// Research mode, labels and metadata from a spreadsheet: a sheet replaces the values of the texts it lists (a
// blank cell leaves no value); texts it does not list keep theirs unless asked; several rows for one text are
// merged when they agree and block the sheet when they differ; the Lab's own results files are refused; and the
// first guess at a column's role knows the study's answer fields. The rules are in lib/research/columns.ts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>{
  const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;
  if(target===null)return req(id);
  return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');
 };
 new Function('exports','require',code)(exports,local);return exports;
}
const columns=load('lib/research/columns.ts');
const {applySheet,guessRole,resultsFileColumns,appendTexts}=columns;
const cells=result=>result.docs.map(doc=>doc.cells);

// A study with two columns already filled in for a, b, and c; d has nothing yet.
const study=[{id:'a',name:'a.txt',cells:['POSITIVE','1961']},{id:'b',name:'b.txt',cells:['NEGATIVE','1981']},{id:'c',name:'c.txt',cells:['MIXED','2001']},{id:'d',name:'d.txt'}];
const cols=[{name:'tone_human',role:'label'},{name:'year',role:'meta'}];
const roles=['','label'];

// The sheet lists a and b: a gets a new value, b's blank cell leaves no value; c keeps its value; year is not touched.
let result=applySheet(study,cols,{header:['file','tone_human'],rows:[['a','NEGATIVE'],['b','']]},0,roles);
assert.deepEqual(cells(result),[['NEGATIVE','1961'],['','1981'],['MIXED','2001'],undefined]);
assert.deepEqual([result.matched,result.changed,[...result.removed],result.replaced,result.unlisted,result.added],[2,1,[['tone_human',1]],['tone_human'],['c'],[]]);
// Asked to, the values of the texts it does not list go too, in the sheet's columns only.
result=applySheet(study,cols,{header:['file','tone_human'],rows:[['a','NEGATIVE'],['b','']]},0,roles,{clearUnlisted:true});
assert.deepEqual(cells(result),[['NEGATIVE','1961'],['','1981'],['','2001'],undefined]);
assert.deepEqual([...result.removed],[['tone_human',2]]);
// A text left with no values at all has none stored.
result=applySheet([{id:'a',name:'a.txt',cells:['POSITIVE']}],[cols[0]],{header:['file','tone_human'],rows:[['a','']]},0,roles);
assert.equal(result.docs[0].cells,undefined);assert(!('cells' in result.docs[0])||result.docs[0].cells===undefined);
// A new column: nothing was there, so nothing is removed or replaced, and nothing counts as unlisted.
result=applySheet(study,cols,{header:['file','party'],rows:[['a','Democratic'],['b','']]},0,['','meta']);
assert.deepEqual(cells(result),[['POSITIVE','1961','Democratic'],['NEGATIVE','1981',''],['MIXED','2001'],undefined]);
assert.deepEqual([result.added,result.replaced,result.removed.size,result.unlisted,result.changed],[['party'],[],0,[],0]);
// The same value again is no change.
assert.equal(applySheet(study,cols,{header:['file','tone_human'],rows:[['a','POSITIVE']]},0,roles).changed,0);

// Several rows for one text: merged when they agree (a blank adds nothing), refused when they differ.
result=applySheet(study,cols,{header:['file','tone_human','year'],rows:[['a','NEGATIVE',''],['a.txt','NEGATIVE','1962'],['b','POSITIVE','1981']]},0,['','label','meta']);
assert.deepEqual(result.conflicts,[]);assert.deepEqual(result.repeated,['a']);
assert.deepEqual(cells(result).slice(0,2),[['NEGATIVE','1962'],['POSITIVE','1981']]);
result=applySheet(study,cols,{header:['file','tone_human'],rows:[['a','NEGATIVE'],['b','POSITIVE'],['a','POSITIVE']]},0,roles);
assert.deepEqual(result.conflicts,['a'],'One row per coder is not one row per text');
assert.equal(result.docs,study,'Nothing changes until the sheet is fixed');assert.equal(result.columns,cols);

// A row that matches more than one text leaves them alone, even when unlisted values are removed.
const twins=[{id:'n1',name:'notes.txt',cells:['POSITIVE']},{id:'n2',name:'notes.md',cells:['NEGATIVE']},{id:'o',name:'other.txt',cells:['MIXED']}];
result=applySheet(twins,[cols[0]],{header:['file','tone_human'],rows:[['notes','']]},0,roles,{clearUnlisted:true});
assert.deepEqual(result.ambiguous,['notes']);assert.deepEqual(cells(result),[['POSITIVE'],['NEGATIVE'],undefined]);assert.deepEqual(result.unlisted,['o']);

// Chunks: a row that names the source file gives every chunk its values.
const chunks=[{id:'c1',name:'Report.pdf · chunk 1',sourceName:'Report.pdf'},{id:'c2',name:'Report.pdf · chunk 2',sourceName:'Report.pdf'}];
assert.deepEqual(cells(applySheet(chunks,[],{header:['file','tone_human'],rows:[['Report.pdf','POSITIVE']]},0,roles)),[['POSITIVE'],['POSITIVE']]);

// The Lab's own results files hold the model's answers: they are recognized by columns only they have.
assert.deepEqual(resultsFileColumns(['doc_id','document','run','score','explanation','model_requested','model_reported','prompt_hash','n_ok']),['model_requested','model_reported','prompt_hash','n_ok']);
assert.deepEqual(resultsFileColumns(['document','run1_score','run1_explanation','tone_replicate_agreement']),['run1_explanation','tone_replicate_agreement']);
assert.deepEqual(resultsFileColumns(['Annotation ID','File','Annotated / collected at (UTC)']),['Annotation ID','Annotated / collected at (UTC)'],"The standard Lab's workbook");
assert.deepEqual(resultsFileColumns(['file','tone_human','response_id','explanation','year']),[],'A survey export or a coder’s sheet is not a results file');

// The first guess at a column's role: a column named after an answer field, alone or with marker words, holds
// human labels; so does a name with a word such as coder, rater, gold, or human, with or without a number.
const fields=['tone','Party lean'];
for(const name of ['tone','Tone','tone_coder2','tone-coder-2','gold_tone','tone_expert','tone gold','human.tone','party_lean','Party lean (final)'.replace(/[()]/g,''),'party_lean_rater1'])assert.equal(guessRole(name,fields),'label',name);
for(const name of ['coder2','rater_1','tone_human','gold','label','human_score','manual coding'])assert.equal(guessRole(name),'label',name);
for(const name of ['year','party','speaker','pilot','final','tone_length','tones','tone_notes','tone_confidence'])assert.equal(guessRole(name,fields),'meta',name);
assert.equal(guessRole('tone'),'meta','Without the study’s fields, a bare field name is a guess for metadata');
assert.equal(guessRole('pilot',['pilot']),'label','A field may itself be a marker word');

// Texts added from a table: their other columns are guessed the same way.
const appended=appendTexts([],[],[{name:'x.txt',text:'x',values:['NEGATIVE','1999']}],['tone_gold','year'],text=>({id:'x',name:text.name}),fields);
assert.deepEqual(appended.columns,[{name:'tone_gold',role:'label'},{name:'year',role:'meta'}]);assert.deepEqual(appended.docs[0].cells,['NEGATIVE','1999']);

console.log('Label sheet checks passed.');
