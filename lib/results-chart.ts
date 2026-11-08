// Small helpers shared by the chart model and the Excel export.

export function validChartYear(value:unknown):value is number {
 return typeof value==='number' && Number.isInteger(value) && value>=1000 && value<=9999;
}

export function suggestedYear(filename:string):string {
 // Match complete tokens, including years separated by underscores, but never digits inside IDs.
 const stem=filename.replace(/\.[a-z][a-z0-9]{0,9}$/i,'');
 // Abbreviated spans such as 1861–65 are ambiguous. A complete ISO date still supplies one year.
 if(/(?:^|[^\p{L}\p{N}])[1-9]\d{3}\s*[-–—]\s*\d{2}(?![\p{L}\p{N}]|-\d{2}(?:$|[^\p{L}\p{N}]))/u.test(stem))return '';
 const tokens=stem.match(/[\p{L}\p{N}]+/gu) || [];
 const years=tokens.filter(token=>/^[1-9]\d{3}$/.test(token));
 return years.length===1 ? years[0] : '';
}

export function chartNumber(value:string):number|null{
 // Do not turn ranges, dates, commas, percentages, or prose into scores.
 if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))return null;
 const number=Number(value);return Number.isFinite(number)?number:null;
}
