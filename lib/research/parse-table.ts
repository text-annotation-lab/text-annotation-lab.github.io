// Reading and writing tables: CSV or TSV text, and Excel workbooks.
import type {Sheet} from './columns';

// The delimiter that splits the first line into the most cells (comma, semicolon, or tab).
function sniff(text:string):string{
 let line='',quoted=false;
 for(const ch of text){if(ch==='"')quoted=!quoted;else if((ch==='\n'||ch==='\r')&&!quoted)break;line+=quoted&&ch!=='"'?' ':ch;}
 const count=(d:string)=>line.split(d).length-1;
 return [',',';','\t'].reduce((best,d)=>count(d)>count(best)?d:best,',');
}
// RFC 4180: quoted cells may hold delimiters, line breaks, and doubled quotes.
export function parseDelimited(input:string):Sheet{
 const text=input.replace(/^﻿/,''),delimiter=sniff(text);
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,i=0,line=1,openedOn=0;
 const endCell=()=>{row.push(cell);cell='';};
 const endRow=()=>{endCell();if(row.some(value=>value.trim()!==''))rows.push(row);row=[];};
 while(i<text.length){
  const ch=text[i];
  if(quoted){
   if(ch==='"'){if(text[i+1]==='"'){cell+='"';i+=2;continue;}quoted=false;i++;continue;}
   if(ch==='\n')line++;cell+=ch;i++;continue;
  }
  if(ch==='"'&&cell.trim()===''){cell='';quoted=true;openedOn=line;i++;continue;}
  if(ch===delimiter){endCell();i++;continue;}
  if(ch==='\r'){if(text[i+1]==='\n')i++;line++;endRow();i++;continue;}
  if(ch==='\n'){line++;endRow();i++;continue;}
  cell+=ch;i++;
 }
 // A quoted value that is never closed would take every later row into one cell (one text instead of many).
 if(quoted)throw new Error(`A value that starts with a quotation mark (") on line ${openedOn} is never closed, so the rows after it cannot be read. Close the quotation mark or remove it, then add the table again.`);
 if(cell!==''||row.length)endRow();
 return toSheet(rows);
}
// Column names made unique, ignoring case: a second "Coder" becomes "Coder (2)", or "Coder (3)" when the table
// already has a "Coder (2)", so no column takes another's values.
export function uniqueHeader(names:string[]):string[]{
 const used=new Set(names.map(name=>name.toLowerCase())),seen=new Set<string>();
 return names.map(base=>{
  if(!seen.has(base.toLowerCase())){seen.add(base.toLowerCase());return base;}
  let n=2,name=`${base} (${n})`;while(used.has(name.toLowerCase()))name=`${base} (${++n})`;
  used.add(name.toLowerCase());seen.add(name.toLowerCase());return name;
 });
}
function toSheet(rows:string[][]):Sheet{
 if(!rows.length)return {header:[],rows:[]};
 let width=0;for(const row of rows)if(row.length>width)width=row.length;
 const header=uniqueHeader(Array.from({length:width},(_,i)=>String(rows[0][i]??'').normalize('NFC').trim()||'Column '+(i+1)));
 return {header,rows:rows.slice(1).map(row=>Array.from({length:width},(_,i)=>String(row[i]??'').trim()))};
}
// An Excel cell as the text a reader sees: formulas give their result, dates an ISO date.
function cellText(value:any):string{
 if(value===null||value===undefined)return '';
 if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().slice(0,value.getUTCHours()||value.getUTCMinutes()||value.getUTCSeconds()?19:10).replace('T',' ');
 if(typeof value==='object'){
  if('result' in value)return cellText(value.result);
  if(Array.isArray(value.richText))return value.richText.map((part:any)=>String(part?.text??'')).join('');
  if('text' in value)return cellText(value.text);
  if('error' in value)return '';
  return '';
 }
 return String(value);
}
export const SPREADSHEET_ACCEPT='.csv,.tsv,.txt,.xlsx';
export async function parseSpreadsheet(file:File,maxMegabytes=20):Promise<Sheet>{
 if(file.size>maxMegabytes*1024*1024)throw new Error(`Choose a spreadsheet of up to ${maxMegabytes} MB.`);
 if(/\.xls$/i.test(file.name))throw new Error('Save this workbook as .xlsx or .csv first; the older .xls format cannot be read.');
 if(/\.xlsx$/i.test(file.name)){
  const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet=workbook.worksheets.find(candidate=>candidate.actualRowCount>1)||workbook.worksheets[0];
  if(!sheet)return {header:[],rows:[]};
  const rows:string[][]=[];
  sheet.eachRow({includeEmpty:false},row=>{
   const values:string[]=[];
   // A number Excel shows with leading zeros (an ID formatted 0000 shows 1 as 0001) is read as it is shown.
   row.eachCell({includeEmpty:true},(cell,column)=>{values[column-1]=typeof cell.value==='number'&&/^0+$/.test(String(cell.numFmt||''))?String(cell.value).padStart(String(cell.numFmt).length,'0'):cellText(cell.value);});
   const filled=Array.from(values,value=>value??'');
   if(filled.some(value=>value.trim()!==''))rows.push(filled);
  });
  return toSheet(rows);
 }
 return parseDelimited(await readTableText(file));
}
// A CSV or TSV file's text: UTF-8 (the usual), or UTF-16 when the file starts with its byte-order mark (Excel's
// “Unicode text”). Anything else (a CSV saved by Excel in Windows-1252, say) is refused rather than read with letters
// replaced by �, since the texts must arrive exactly as written.
export async function readTableText(file:Blob):Promise<string>{
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes);
 if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be').decode(bytes);
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{throw new Error('This table is not saved as UTF-8, so some letters (such as æ, ø, å, or é) would be changed. In Excel, choose File → Save As → CSV UTF-8, then add it again.');}
}

// CSV for analysis software: every value exactly as it is, quoted where needed.
export function toCsv(rows:(string|number|null|undefined)[][]):string{
 const cell=(value:string|number|null|undefined)=>{const text=value===null||value===undefined?'':String(value);return /[",\r\n]/.test(text)||/^\s|\s$/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
 return '﻿'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
