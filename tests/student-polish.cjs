const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
function load(file){const exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require','fetch',code)(exports,id=>id.startsWith('.')?load(path.join(path.dirname(file),id)+'.ts'):require(id),()=>{throw Error('Preview must not contact a provider');});return exports;}
function pdfFile(text){const stream=text?`BT /F1 12 Tf 50 700 Td (${text}) Tj ET`:'';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];let data='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(data);data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n${xref}\n%%EOF`;return new File([data],'source.pdf',{type:'application/pdf'});}
(async()=>{
 const {resultColumns,resultAnswer}=load('lib/answer-fields.ts'),{knowledgeAssessment}=load('lib/model-knowledge.ts');
 const fields=['Tone','Complexity'],pending={status:'pending'};
 assert.deepEqual(resultColumns([],fields),{names:fields,showLegacy:false});
 assert.deepEqual(resultColumns([pending],fields),{names:fields,showLegacy:false});
 const old={status:'done',score:'3'},named={status:'done',answerFields:['Complexity','Tone'],answers:{f0:'2',f1:'NEUTRAL'}};
 assert.deepEqual(resultColumns([old,named,pending],fields),{names:fields,showLegacy:true});
 assert.equal(resultAnswer(named,'Tone'),'NEUTRAL');assert.deepEqual(resultColumns([named,pending],[]),{names:['Complexity','Tone'],showLegacy:true});
 assert.equal(knowledgeAssessment(old),'Assessed');assert.equal(knowledgeAssessment({score:' insufficient_knowledge '}),'Insufficient knowledge');
 const partial={name:'Partial',status:'done',score:'',answerFields:fields,answers:{f0:'NEUTRAL',f1:'INSUFFICIENT_KNOWLEDGE'}};
 const unknown={...partial,name:'Unknown',answers:{f0:'INSUFFICIENT_KNOWLEDGE',f1:'INSUFFICIENT_KNOWLEDGE'}};
 assert.equal(knowledgeAssessment(partial),'Partly assessed');assert.equal(knowledgeAssessment(unknown),'Insufficient knowledge');assert.equal(knowledgeAssessment(named),'Assessed');
 const {createResultsWorkbook}=load('lib/export-results.ts'),ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();
 await book.xlsx.load(await createResultsWorkbook([partial,unknown],{workspace:'model-knowledge',prompt:'Assess tone and complexity.',model:'gpt-6-luna',effort:'medium'}));
 const sheet=book.getWorksheet('Results'),headers=sheet.getRow(1).values,col=name=>headers.indexOf(name);
 assert.equal(sheet.getCell(2,col('Status')).value,'Partly assessed');assert.equal(sheet.getCell(3,col('Status')).value,'Insufficient knowledge');assert.equal(sheet.getCell(2,col('Complexity')).value,'INSUFFICIENT_KNOWLEDGE');
 const {sourcePreview,SOURCE_PREVIEW_LIMIT}=load('lib/source-preview.ts');
 assert.deepEqual(await sourcePreview(new File(['Café\nA second paragraph.'],'sample.txt')),{text:'Café\nA second paragraph.',truncated:false});
 const html=await sourcePreview(new File(['<html><head><title>Exclude</title></head><body><p>Read this.</p><script>malicious()</script></body></html>'],'sample.html'));assert.equal(html.text,'Read this.');
 assert.equal((await sourcePreview(new File(['{\\rtf1\\ansi First\\par Second}'],'sample.rtf'))).text.trim(),'First\n\nSecond');
 const Zip=require('node:module').createRequire(require.resolve('exceljs'))('jszip'); // use ExcelJS's existing ZIP dependency
 const zip=new Zip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A DOCX source.</w:t></w:r></w:p></w:body></w:document>');
 assert.equal((await sourcePreview(new File([await zip.generateAsync({type:'nodebuffer'})],'sample.docx'))).text.trim(),'A DOCX source.');
 assert.match((await sourcePreview(pdfFile('A PDF source.'))).text,/A PDF source\./);await assert.rejects(sourcePreview(pdfFile('')),/no extractable text/);
 const long=await sourcePreview(new File(['x'.repeat(SOURCE_PREVIEW_LIMIT+10)],'large.txt'));assert.equal(long.text.length,SOURCE_PREVIEW_LIMIT);assert(long.truncated);
 await assert.rejects(sourcePreview(new File([new Uint8Array([0xff,0x80])],'invalid.txt')),/encoding/);
 console.log('PASS: pending and historical field columns; full/partial/unknown knowledge statuses including Excel; local TXT, HTML, RTF, DOCX, PDF previews; scanned PDF and encoding errors; long-source limits. No paid requests.');
})().catch(e=>{console.error(e);process.exit(1);});
