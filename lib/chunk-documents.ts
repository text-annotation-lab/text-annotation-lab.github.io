import {newId} from './identifier';
import {extractText} from './extract-text';
import {splitTextByWords,splitTextBySentences,SENTENCE_SEGMENTER,type ChunkMethod,MAX_CHUNKS,type ChunkableDocument,type ChunkInfo} from './chunk-text';

async function textForChunking(file:File){
 if(!/\.pdf$/i.test(file.name))return extractText(file);
 // Load PDF parsing only when someone chooses to split a PDF. No OCR or API call.
 const {getDocumentProxy,extractText:pdfText}=await import('unpdf');
 const pdf=await getDocumentProxy(new Uint8Array(await file.arrayBuffer()),{maxImageSize:16777216});
 try{
  if(pdf.numPages>500)throw new Error('For chunking, use PDFs of up to 500 pages or upload extracted text.');
  const {text}=await pdfText(pdf,{mergePages:true});
  if(!text.trim())throw new Error('This PDF has no extractable text. Use an OCR text file, or annotate the whole PDF.');
  return text;
 }finally{await pdf.loadingTask.destroy();}
}

export async function chunkDocuments<T extends ChunkableDocument>(docs:T[],wordsPerChunk:number,method:ChunkMethod='exact-words'){
 const result:(T|(ChunkableDocument&ChunkInfo))[]=[];let split=0,created=0;
 for(const doc of docs){
  if(doc.status!=='pending'||doc.sourceId||doc.history?.length){result.push(doc);continue;}
  try{
   const text=await textForChunking(doc.file);
   if(text.length>2000000)throw new Error('The extracted text is too large. Divide the source into smaller files first.');
   const chunks=method==='sentences'?splitTextBySentences(text,wordsPerChunk):splitTextByWords(text,wordsPerChunk);
   if(chunks.length===1){result.push(doc);continue;}
   if(result.length+chunks.length>MAX_CHUNKS)throw new Error('This would create more than 10,000 queued texts. Choose a larger word count.');
   split++;created+=chunks.length;
   chunks.forEach((chunk,index)=>{
    const name=`${doc.name}.chunk-${String(index+1).padStart(3,'0')}-of-${String(chunks.length).padStart(3,'0')}.txt`;
    result.push({id:newId(),name,file:new File([chunk.text],name,{type:'text/plain;charset=utf-8'}),status:'pending',sourceId:doc.id,sourceName:doc.name,sourceFile:doc.file,chunkIndex:index+1,chunkCount:chunks.length,wordsPerChunk,chunkMethod:method,segmenter:method==='sentences'?SENTENCE_SEGMENTER:undefined,wordStart:chunk.wordStart,wordEnd:chunk.wordEnd});
   });
  }catch(error){throw new Error(`${doc.name}: ${error instanceof Error?error.message:'Could not read this document.'} No documents were changed.`);}
 }
 if(result.length>MAX_CHUNKS)throw new Error('This would create more than 10,000 queued texts. Choose a larger word count. No documents were changed.');
 return {docs:result,split,created};
}
