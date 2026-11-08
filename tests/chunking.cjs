const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
function load(file){
 const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',code)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id));return exports;
}
// Small real PDF fixtures, with a text layer or an empty page. No external service.
function pdfFile(text,name='source.pdf'){
 const stream=text?`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`:'';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(data);
 data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;
 return new File([data],name,{type:'application/pdf'});
}
const document=(file,status='pending')=>({id:crypto.randomUUID(),name:file.name,file,status});
(async()=>{
 const {splitTextByWords,validChunkWords,restoreWholeDocuments}=load('lib/chunk-text.ts');
 const {chunkDocuments}=load('lib/chunk-documents.ts');
 const text='  Café—yes\tsecond-word\n\nthird 😀  fifth\n';
 const parts=splitTextByWords(text,2);assert.equal(parts.map(p=>p.text).join(''),text);assert.deepEqual(parts.map(p=>[p.wordStart,p.wordEnd]),[[1,2],[3,4],[5,5]]);
 assert.deepEqual(parts.map(p=>(p.text.match(/\S+/gu)||[]).length),[2,2,1]);
 assert.equal(splitTextByWords('a b c d',2).length,2);assert.equal(splitTextByWords('a',1000).length,1);
 for(const invalid of [0,-1,1.5,NaN,Infinity,1000001,'1000']){assert.equal(validChunkWords(invalid),false);assert.throws(()=>splitTextByWords('a b',invalid));}
 assert.throws(()=>splitTextByWords(' \n\t',1000));assert.throws(()=>splitTextByWords('w '.repeat(10001),1),/10,000/);
 const source=document(new File([Array.from({length:2400},(_,i)=>'word'+i).join(' ')],'article.md'));
 const {docs}=await chunkDocuments([source],1000);assert.equal(docs.length,3);assert.deepEqual(docs.map(d=>[d.wordStart,d.wordEnd]),[[1,1000],[1001,2000],[2001,2400]]);assert(docs.every(d=>d.sourceFile===source.file&&d.sourceName==='article.md'&&d.chunkCount===3));
 assert.equal((await Promise.all(docs.map(d=>d.file.text()))).join(''),await source.file.text());
 assert.deepEqual(restoreWholeDocuments(docs),[source]);assert.equal((await chunkDocuments(docs,500)).docs.length,3,'Never resplit an existing chunk');
 assert.equal(restoreWholeDocuments([{...docs[0],status:'done'},...docs.slice(1)]).length,3,'Keep completed results');
 const complete=document(new File(['a b c'],'done.txt'),'done');assert.equal((await chunkDocuments([complete],1)).docs[0],complete);
 const html=await chunkDocuments([document(new File(['<p>one two three</p><script>ignore me</script>'],'web.html'))],2);assert.equal(html.docs.length,2);assert.equal(await html.docs[1].file.text(),'three');
 const rtf=await chunkDocuments([document(new File(['{\\rtf1\\ansi one two three}'],'word.rtf'))],2);assert.equal(rtf.docs.length,2);
 const pdf=await chunkDocuments([document(pdfFile('one two three four five'))],2);assert.equal(pdf.docs.length,3);assert.equal((await pdf.docs[2].file.text()).trim(),'five');
 await assert.rejects(()=>chunkDocuments([source,document(pdfFile(''))],1000),/no extractable text.*No documents were changed/);
 await assert.rejects(()=>chunkDocuments([document(new File(['not a PDF'],'bad.pdf'))],2),/No documents were changed/);
 const {createResultsWorkbook}=load('lib/export-results.ts'),ExcelJS=require('exceljs'),wb=new ExcelJS.Workbook();
 await wb.xlsx.load(await createResultsWorkbook([...docs,complete],{provider:'openai',model:'gpt-6-luna',effort:'medium',prompt:'p'}));
 const results=wb.getWorksheet('Results'),headers=results.getRow(1).values;
 const column=label=>headers.indexOf(label);
 assert.equal(results.getCell(2,column('Source document')).value,'article.md');assert.equal(results.getCell(2,column('Chunk')).value,1);assert.equal(results.getCell(4,column('Last word')).value,2400);assert.equal(results.getCell(2,column('Words per chunk')).value,1000);assert.equal(results.getCell(5,column('Source document')).value,'done.txt');assert.equal(results.getCell(5,column('Chunk')).value,null);
 const notes=[];wb.getWorksheet('Study settings').eachRow(row=>notes.push(row.getCell(1).value));assert(notes.includes('Chunk boundaries'));
 console.log('PASS: exact boundaries, Unicode/whitespace fidelity, remainder, invalid inputs, size guard, whole/annotated preservation, undo, HTML/RTF/real PDF extraction, blank/corrupt PDF errors, and Excel source/range metadata.');
})().catch(error=>{console.error(error);process.exit(1);});
