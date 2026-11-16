// An Excel workbook made of tables: each sheet has a styled header row that stays in view, filters, column
// widths that fit, and numbers stored as numbers.
import type {Table} from './export-tables';

// numbers: the columns whose values are numbers where they look like numbers (answers and labels); other text
// stays text, so an identifier made of digits is never changed. frozen: columns kept in view at the left.
// prose: columns of running text, shown wide and wrapped.
export type Sheet={name:string;table:Table;numbers?:(column:string,index:number)=>boolean;frozen?:number;prose?:(column:string)=>boolean};
const CELL_LIMIT=32000;
const numeric=(value:string)=>/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)&&value.replace(/\D/g,'').length<=15;
// Carriage returns would show as _x000D_ in Excel, and a cell holds at most 32,767 characters.
const clean=(value:string)=>{const text=value.replace(/\r\n?/g,'\n');return text.length>CELL_LIMIT?text.slice(0,CELL_LIMIT)+' …[truncated]':text;};
export const isProse=(column:string)=>/(^|_)(explanation|reasoning)$/i.test(column)||column==='rationale'||column==='prompt'||column==='reasoning_summary';
// A name Excel accepts: none of [ ] : * ? / \, at most 31 characters, and not the name of another sheet.
function sheetName(taken:Set<string>,wanted:string):string{
 const tidy=(name:string)=>name.replace(/[[\]:*?/\\]/g,'_').slice(0,31).replace(/^'+|'+$/g,'')||'Sheet';
 let name=tidy(wanted);
 for(let n=2;taken.has(name.toLowerCase());n++)name=tidy(wanted).slice(0,31-`_${n}`.length)+'_'+n;
 taken.add(name.toLowerCase());return name;
}
export async function buildWorkbook(sheets:Sheet[]):Promise<ArrayBuffer>{
 const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook(),taken=new Set<string>();
 for(const sheet of sheets){
  const table=sheet.table.length>1?sheet.table:[['note'],['No data']],header=table[0].map(String),prose=sheet.prose||isProse;
  const body=table.slice(1).map(row=>header.map((column,i)=>{
   const value=row[i];
   if(typeof value==='number')return Number.isFinite(value)?value:null;
   if(value===undefined||value===null||value==='')return null;
   const text=String(value);
   return sheet.numbers?.(column,i)&&numeric(text)?Number(text):clean(text);
  }));
  const worksheet=workbook.addWorksheet(sheetName(taken,sheet.name),{views:[{state:'frozen',xSplit:sheet.frozen||0,ySplit:1}]});
  worksheet.columns=header.map((column,i)=>{
   const long=column==='text'||column==='response'||column==='value';
   const widest=body.reduce((max,row)=>Math.max(max,String(row[i]??'').length),0);
   return {header:column,key:'c'+i,width:prose(column)?70:long?40:Math.min(60,Math.max(9,column.length+3,widest+2))};
  });
  worksheet.addRows(body);
  const head=worksheet.getRow(1);
  head.font={bold:true,color:{argb:'FFFFFFFF'}};head.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF003D73'}};head.alignment={vertical:'middle'};head.height=28;
  worksheet.autoFilter={from:{row:1,column:1},to:{row:1,column:header.length}};
  header.forEach((column,i)=>{
   const cells=worksheet.getColumn(i+1),first=body.find(row=>row[i]!==null)?.[i];
   // Running text is wrapped; a whole text or a raw reply stays on one line, so rows stay compact.
   cells.alignment=typeof first==='number'?{vertical:'top',horizontal:'center'}:{vertical:'top',wrapText:prose(column)};
  });
  head.alignment={vertical:'middle'};
 }
 return await workbook.xlsx.writeBuffer() as ArrayBuffer;
}
