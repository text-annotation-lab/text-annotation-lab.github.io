export const DEFAULT_CHUNK_WORDS = 1000;
export const MAX_CHUNKS = 10000;

export type ChunkInfo = {
 sourceId:string; sourceName:string; sourceFile:File;
 chunkIndex:number; chunkCount:number; wordsPerChunk:number;
 wordStart:number; wordEnd:number; chunkMethod?:ChunkMethod; segmenter?:string;
};

export function validChunkWords(value:unknown):value is number {
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=1000000;
}

// A word is a nonempty run of non-whitespace characters. Punctuation and
// hyphenated forms remain attached. Preserve every character between boundaries.
export function splitTextByWords(text:string,wordsPerChunk:number){
 if(!validChunkWords(wordsPerChunk))throw new Error('Enter a whole number from 1 to 1,000,000 for words per chunk.');
 const chunks:{text:string;wordStart:number;wordEnd:number}[]=[];
 let start=0,count=0,firstWord=1;
 for(const word of text.matchAll(/\S+/gu)){
  if(count>0&&count%wordsPerChunk===0){
   if(chunks.length>=MAX_CHUNKS-1)throw new Error('This would create more than 10,000 chunks. Choose a larger word count.');
   chunks.push({text:text.slice(start,word.index),wordStart:firstWord,wordEnd:count});
   start=word.index;firstWord=count+1;
  }
  count++;
 }
 if(!count)throw new Error('This document contains no readable text to split.');
 chunks.push({text:text.slice(start),wordStart:firstWord,wordEnd:count});
 return chunks;
}

export type ChunkableDocument = {id:string;name:string;file:File;status:string;history?:import('./workflow-safety').Attempt[]}&Partial<ChunkInfo>;

export function restorableSourceIds(docs:ChunkableDocument[]){
 const groups=new Map<string,boolean>();
 for(const doc of docs){
  if(doc.sourceId)groups.set(doc.sourceId,(groups.get(doc.sourceId)??true)&&doc.status==='pending'&&!doc.history?.length);
 }
 return new Set([...groups].filter(([,pending])=>pending).map(([id])=>id));
}

// Restore only groups where all remaining chunks are ready and have no results.
export function restoreWholeDocuments<T extends ChunkableDocument>(docs:T[]):(T|ChunkableDocument)[]{
 const eligible=restorableSourceIds(docs);
 const seen=new Set<string>();
 return docs.flatMap(d=>{
  if(!d.sourceId||!eligible.has(d.sourceId))return [d];
  if(seen.has(d.sourceId))return [];
  seen.add(d.sourceId);
  return [{id:d.sourceId,name:d.sourceName!,file:d.sourceFile!,status:'pending'}];
 });
}

export type ChunkMethod='exact-words'|'sentences';
export const SENTENCE_SEGMENTER='Intl.Segmenter/en/sentence; paragraph boundaries; abbreviation guard v1';
// Native Unicode sentence segmentation; a small guard covers common English
// titles that some ICU versions treat as complete sentences. Stored chunks are
// authoritative across browser/ICU versions; no imported chunks are regenerated.
export function splitTextBySentences(text:string,target:number){
 if(!validChunkWords(target))throw new Error('Enter a whole number from 1 to 1,000,000 for words per chunk.');
 if(typeof Intl.Segmenter!=='function')throw new Error('Sentence segmentation is unavailable in this browser. Choose exact-word chunking.');
 const wordStarts=Array.from(text.matchAll(/\S+/gu),m=>m.index!);
 if(!wordStarts.length)throw new Error('This document contains no readable text to split.');
 const validBoundaries=new Set(wordStarts),cuts=new Set<number>([0,text.length]);
 const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
 for(const sentence of segmenter.segment(text)){
  const end=sentence.index+sentence.segment.length;
  if((end===text.length||validBoundaries.has(end))&&!/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)\.\s*$/iu.test(sentence.segment))cuts.add(end);
 }
 for(const paragraph of text.matchAll(/(?:\r?\n)[\t ]*(?:\r?\n)\s*/gu)){const end=paragraph.index!+paragraph[0].length;if(validBoundaries.has(end))cuts.add(end);}
 const bounds=[...cuts].sort((a,b)=>a-b),units:string[]=[];
 for(let i=1;i<bounds.length;i++){const piece=text.slice(bounds[i-1],bounds[i]);const words=(piece.match(/\S+/gu)||[]).length;if(words>target)units.push(...splitTextByWords(piece,target).map(c=>c.text));else units.push(piece);}
 const chunks:{text:string;wordStart:number;wordEnd:number}[]=[];let buffer='',count=0,total=0;
 const flush=()=>{if(!count)return;if(chunks.length>=MAX_CHUNKS)throw new Error('This would create more than 10,000 chunks. Choose a larger word count.');chunks.push({text:buffer,wordStart:total+1,wordEnd:total+count});total+=count;buffer='';count=0;};
 for(const unit of units){const words=(unit.match(/\S+/gu)||[]).length;
  if(count&&count+words>target&&target-count<=count+words-target)flush();
  buffer+=unit;count+=words;if(count>=target)flush();
 }
 flush();return chunks;
}
