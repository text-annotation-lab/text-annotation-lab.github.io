import {extractText} from './extract-text';
export const SOURCE_PREVIEW_LIMIT=200000;
export async function sourcePreview(file:File){
 let text:string;
 if(/\.pdf$/i.test(file.name)){
  const {getDocumentProxy,extractText:pdfText}=await import('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(await file.arrayBuffer()),{maxImageSize:16777216});
  try{
   if(pdf.numPages>500)throw Error('Open the original PDF to check this source. In-browser previews support up to 500 pages.');
   ({text}=await pdfText(pdf,{mergePages:true}));
   if(!text.trim())throw Error('This PDF has no extractable text. Open the original PDF to check its pages; this preview does not perform OCR.');
  }finally{await pdf.loadingTask.destroy();}
 }else text=await extractText(file);
 return {text:text.slice(0,SOURCE_PREVIEW_LIMIT),truncated:text.length>SOURCE_PREVIEW_LIMIT};
}
