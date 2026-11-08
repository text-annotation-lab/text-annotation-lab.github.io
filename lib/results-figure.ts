import type {chartData,ChartPoint} from './results-chart';
import {calendarAxis,numericChartLayout} from './results-chart';

export type FigureData=ReturnType<typeof chartData>;
export type FigureBar={label:string;count:number;value?:number;points:ChartPoint[]};
export type FigureDistribution={kind:'category'|'scores'|'histogram';bars:FigureBar[];edges?:number[]};
export type FigureStyle='distribution'|'points'|'stacked'|'ranked'|'year';
export const rankedPageSize=15;
export type RankedOptions={query:string;order:'lowest'|'highest';page:number};
export function defaultFigureStyle(data:FigureData):FigureStyle{return data.numeric&&data.points.length<50?'points':'distribution';}
export function figureStyles(data:FigureData):{value:FigureStyle;label:string}[]{
 return data.numeric?[{value:'points',label:'Individual scores'},{value:'distribution',label:'Score distribution'},{value:'ranked',label:'Ranked scores'}]:[{value:'distribution',label:'Category bars'},...(data.categories.length>1&&data.categories.length<=8?[{value:'stacked' as const,label:'Share of total'}]:[])];
}

export function rankedDistribution(data:FigureData,query='',order:'lowest'|'highest'='lowest'):FigureDistribution{
 if(!data.numeric)throw new Error('Ranked scores requires numeric results.');
 const search=query.trim().toLocaleLowerCase();
 return {kind:'scores',bars:data.points.filter(point=>point.name.toLocaleLowerCase().includes(search)).sort((a,b)=>(order==='highest'?b.number!-a.number!:a.number!-b.number!)||a.order-b.order).map(point=>({label:point.name,value:point.number!,count:1,points:[point]}))};
}

// Score position conveys magnitude; numeric marks do not need a second color scale.
export function scoreColor(_data:FigureData){return (_value:number)=>'#344f6c';}

function yearDistribution(data:FigureData):FigureDistribution {
 const groups=new Map<string,FigureBar>();
 for(const point of data.points) {
  const label=`${point.year} · ${point.number}`;
  const group=groups.get(label);
  if(group){group.points.push(point);group.count++;}
  else groups.set(label,{label,count:1,value:point.number!,points:[point]});
 }
 return {kind:'scores',bars:Array.from(groups.values()).sort((a,b)=>a.points[0].year!-b.points[0].year! || a.value!-b.value!)};
}

const categoryPalette=['#346d8a','#b77435','#43877d','#97729a','#888343','#6b92b7','#b86f77','#777c84'];

export function figureNumber(value:number){
 return Math.abs(value)>=1e6||(value!==0&&Math.abs(value)<.001)?value.toExponential(2):new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(value);
}

export function figureDistribution(data:FigureData):FigureDistribution{
 if(!data.points.length)throw new Error('There are no completed values to include in this figure.');
 if(!data.numeric){
  if(data.categories.length>40)throw new Error('There are too many categories for a readable figure. Use Download Excel to work with all the results.');
  return {kind:'category',bars:data.categories.map(category=>({label:category.value,count:category.points.length,points:category.points}))};
 }
 const groups=new Map<number,ChartPoint[]>();
 for(const point of data.points){const group=groups.get(point.number!);if(group)group.push(point);else groups.set(point.number!,[point]);}
 const values=Array.from(groups.keys()).sort((a,b)=>a-b);
 const min=data.scale?.min??values[0],max=data.scale?.max??values[values.length-1];
 if(values.every(Number.isInteger)&&Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&max-min<=20){
  return {kind:'scores',bars:Array.from({length:max-min+1},(_,i)=>({label:String(min+i),value:min+i,count:groups.get(min+i)?.length||0,points:groups.get(min+i)||[]}))};
 }
 if(values.length<=16){
  // Preserve exact values in labels; different decimal scores must not collapse after rounding.
  return {kind:'scores',bars:values.map(value=>({label:String(value),value,count:groups.get(value)!.length,points:groups.get(value)!}))};
 }
 const bins=Math.min(12,Math.max(5,Math.ceil(Math.sqrt(data.points.length))));
 const magnitude=Math.max(Math.abs(min),Math.abs(max),1),low=min/magnitude,high=max/magnitude;
 const edges=Array.from({length:bins+1},(_,i)=>min*(1-i/bins)+max*(i/bins));
 const bars:FigureBar[]=Array.from({length:bins},(_,i)=>({label:`${Number(edges[i].toPrecision(12))}–${Number(edges[i+1].toPrecision(12))}`,count:0,points:[]}));
 for(const point of data.points){
  const position=(point.number!/magnitude-low)/(high-low);
  const bar=bars[Math.max(0,Math.min(bins-1,Math.floor(position*bins)))];bar.count++;bar.points.push(point);
 }
 return {kind:'histogram',bars,edges};
}

const xml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
function wrap(value:string,max:number,measure?:(text:string)=>number){
 const lines:string[]=[];let line='';
 const fits=(text:string)=>measure?measure(text)<=max:Array.from(text).length<=max;
 for(const word of value.trim().split(/\s+/)){
  if(line&&fits(line+' '+word)){line+=' '+word;continue;}
  if(line){lines.push(line);line='';}
  for(const character of word){if(line&&!fits(line+character)){lines.push(line);line=character;}else line+=character;}
 }
 if(line)lines.push(line);return lines.length?lines:[''];
}
function countAxis(max:number){
 const raw=Math.max(1,max/5),unit=10**Math.floor(Math.log10(raw)),fraction=raw/unit;
 const step=Math.max(1,(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*unit);
 const upper=Math.max(step,Math.ceil(max/step)*step);
 return {upper,ticks:Array.from({length:Math.round(upper/step)+1},(_,i)=>i*step)};
}

/** A self-contained figure: no UI, external fonts, links, or document contents. */
export function resultsFigureSvg(data:FigureData,label:string,title:string,requestedStyle:FigureStyle='distribution',options:{compact?:boolean;interactive?:boolean;rankedPage?:number;rankedQuery?:string;rankedOrder?:'lowest'|'highest';rankedScope?:'all'|'page';overviewWidth?:number}={}){
 const yearPlot=requestedStyle==='year'&&data.numeric;
 const style=yearPlot?'year':figureStyles(data).some(option=>option.value===requestedStyle)?requestedStyle:'distribution';
 const distribution=yearPlot?yearDistribution(data):style==='ranked'?rankedDistribution(data,options.rankedQuery,options.rankedOrder):figureDistribution(data),{bars,kind}=distribution;
 if(!bars.length)throw new Error('No matching results. Try another name.');
 const rankedPage=Math.max(0,Math.min(Math.floor(options.rankedPage||0),Math.ceil(bars.length/rankedPageSize)-1)),rankedStart=rankedPage*rankedPageSize;
 const rankedVisible=options.compact||options.rankedScope==='page'?bars.slice(rankedStart,rankedStart+rankedPageSize):bars;
 const color=scoreColor(data);
 const width=(style==='ranked'||yearPlot)&&options.compact?Math.max(280,options.overviewWidth||800):1200,ink='#202b38',muted='#546170',blue='#344f6c',grid='#e3e7ec';
 const measure=typeof document==='undefined'?null:document.createElement('canvas').getContext('2d');
 const lines=(value:string,chars:number,size:number)=>{
  if(!measure)return wrap(value,chars);
  measure.font=`${size}px Arial`;
  return wrap(value,chars*size*.55,text=>measure.measureText(text).width);
 };
 const titleLines=lines(title.trim()||`${label} distribution`,58,32);
 const labelLines=lines(label,80,21);
 const top=options.compact?30:72+titleLines.length*40+labelLines.length*26+54;
 const axis=countAxis(bars.reduce((largest,bar)=>Math.max(largest,bar.count),0));
 const parts:string[]=[];
 const text=(x:number,y:number,value:string,size=22,anchor='start',color=ink,extra='')=>parts.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${color}" ${extra}>${xml(value)}</text>`);
 const line=(x1:number,y1:number,x2:number,y2:number,color=grid)=>parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5"/>`);
 const begin=(index:number,focusable=true)=>{const bar=bars[index],description=style==='ranked'?`${bar.label}: ${bar.points[0].value}. Show explanation.`:`${bar.label}: ${bar.count} results. Show matching results.`;parts.push(options.interactive&&bar.count?`<g data-figure-bin="${index}" role="button" tabindex="${focusable?0:-1}" aria-pressed="false" aria-label="${xml(description)}">`:'<g>');};
 const end=()=>parts.push('</g>');
 const hit=(x:number,y:number,w:number,h:number)=>{if(options.interactive)parts.push(`<rect class="figure-hit" x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>`);};
 if(!options.compact){
 titleLines.forEach((value,i)=>text(70,68+i*40,value,32,'start',ink,'font-weight="600"'));
 labelLines.forEach((value,i)=>text(70,76+titleLines.length*40+i*26,value,21,'start',muted));
 const summary=style==='ranked'?`${rankedVisible.length.toLocaleString('en-US')} of ${data.points.length.toLocaleString('en-US')} results · ${options.rankedOrder==='highest'?'Highest':'Lowest'} first`:`n = ${data.points.length.toLocaleString('en-US')} annotations${data.mean!==undefined?`   ·   Mean = ${figureNumber(data.mean)}`:''}`;
 text(70,top-28,summary,20,'start',muted);
 }
 let bottom:number;
 if(style==='ranked'){
  // Only the interactive overview is paged; an exported figure includes every result.
  if(!options.compact&&rankedVisible.length>100)throw new Error('There are too many named results for one readable figure. Choose Current page or Score distribution.');
  const start=options.compact||options.rankedScope==='page'?rankedStart:0,visible=rankedVisible;
  const compact=options.compact,left=compact?Math.max(115,Math.min(300,width*.38)):440,right=compact?width-65:1030,rowTop=top+(compact?50:70),font=compact?14:21;
  const layout=numericChartLayout(data.points,data.points.length,1200,data.scale);
  const x=(value:number)=>left+(layout.bottom-layout.y(value))/(layout.bottom-layout.top)*(right-left);
  const rows=visible.map(bar=>({bar,lines:lines(bar.label,compact?(left-35)/(font*.55):30,font)})),heights=rows.map(row=>Math.max(compact?30:40,row.lines.length*(compact?18:25)+12));
  const rowBottom=rowTop+heights.reduce((sum,height)=>sum+height,0);
  text((left+right)/2,top+(compact?4:13),'Score',compact?14:22,'middle');
  for(const tick of layout.ticks){line(x(tick.value),rowTop-8,x(tick.value),rowBottom,tick.value===0?'#aab5c0':grid);text(x(tick.value),top+(compact?30:46),String(Number(tick.value.toPrecision(12))),compact?12:19,'middle',muted);text(x(tick.value),rowBottom+(compact?24:32),String(Number(tick.value.toPrecision(12))),compact?12:19,'middle',muted);}
  let y=rowTop;
  rows.forEach(({bar,lines},index)=>{
   const center=y+heights[index]/2;
   begin(start+index);hit(compact?4:60,y,width-(compact?8:120),heights[index]);
   line(left,center,right,center,'#f0f2f5');
   lines.forEach((value,i)=>text(left-(compact?16:26),center-(lines.length-1)*(compact?9:12.5)+i*(compact?18:25)+(compact?5:7),value,font,'end'));
   parts.push(`<circle cx="${x(bar.value!)}" cy="${center}" r="${compact?5:7}" fill="${color(bar.value!)}"/>`);
   text(width-(compact?8:70),center+(compact?5:7),String(bar.value),font,'end');end();y+=heights[index];
  });
  bottom=rowBottom+62;
 }else if(style==='points'||yearPlot){
  const small=yearPlot&&options.compact, left=small?54:110,right=width-(small?24:70),plotBottom=top+(small?240:390);
  const total=data.points.length+data.excluded,layout=numericChartLayout(data.points,total,1200,data.scale);
  const calendar=yearPlot?calendarAxis(data.points,left+12,right-12,width):undefined;
  const x=calendar?.x??((order:number)=>left+(layout.x(order)-layout.left)/(layout.right-layout.left)*(right-left));
  const y=(value:number)=>top+(layout.y(value)-layout.top)/(layout.bottom-layout.top)*(plotBottom-top);
  for(const tick of layout.ticks){line(left,y(tick.value),right,y(tick.value),tick.value===0?'#aab5c0':grid);text(left-(small?8:18),y(tick.value)+(small?4:7),String(Number(tick.value.toPrecision(12))),small?12:20,'end',muted);}
  parts.push(`<text transform="translate(${small?13:38} ${(top+plotBottom)/2}) rotate(-90)" text-anchor="middle" font-size="${small?14:22}" fill="${ink}">Score</text>`);
  if(yearPlot) {
   bars.forEach((bar,index)=>{
    const point=bar.points[0],cx=x(point.year!),cy=y(point.number!);
    begin(index);
    if(options.interactive) {
     parts.push(`<title>${xml(bar.count===1?`${point.name} · ${point.year} · ${point.value}`:`${bar.label} · ${bar.count} texts`)}</title>`);
     hit(cx-7,cy-7,14,14);
    }
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${bar.count>1?7:4.5}" fill="${blue}" stroke="white"/>`);
    end();
   });
  } else for(const point of data.points)parts.push(`<circle cx="${x(point.order)}" cy="${y(point.number!)}" r="${data.points.length>250?3:5}" fill="${blue}" fill-opacity="0.8"/>`);
  line(left,plotBottom+15,right,plotBottom+15,'#9aa6b2');
  for(const tick of calendar?.ticks??layout.xTicks)text(x(tick),plotBottom+(small?35:48),String(tick),small?12:20,'middle',muted);
  text((left+right)/2,plotBottom+(small?62:92),yearPlot?'Year':'Annotation order',small?15:22,'middle');bottom=plotBottom+(small?64:124);
 }else if(style==='stacked'){
  const palette=categoryPalette;
  const left=70,right=1130,barY=top+12;let x=left;
  bars.forEach((bar,i)=>{
   const span=bar.count/data.points.length*(right-left);
   begin(i);
   parts.push(`<rect x="${x}" y="${barY}" width="${span}" height="72" fill="${palette[i]}" stroke="white" stroke-width="2"/>`);
   if(span>=76)text(x+span/2,barY+44,`${Math.round(bar.count/data.points.length*100)}%`,23,'middle','#fff','font-weight="600"');
   end();
   x+=span;
  });
  for(const tick of [0,25,50,75,100])text(left+tick/100*(right-left),barY+104,`${tick}%`,19,'middle',muted);
  let y=barY+162;
  bars.forEach((bar,i)=>{
   const wrapped=lines(bar.label,65,22),height=Math.max(48,wrapped.length*27+16);
   begin(i,false);hit(left-8,y-8,right-left+16,height);
   parts.push(`<rect x="${left}" y="${y}" width="22" height="22" fill="${palette[i]}"/>`);
   wrapped.forEach((value,j)=>text(left+38,y+19+j*27,value,22));
   text(right,y+19,`${bar.count.toLocaleString('en-US')} (${Math.round(bar.count/data.points.length*100)}%)`,21,'end');
   end();
   y+=height;
  });
  bottom=y+8;
 }else if(kind==='category'){
  const left=390,right=1000;
  const rows=bars.map(bar=>({bar,lines:lines(bar.label,27,21)}));
  const rowHeights=rows.map(row=>Math.max(60,row.lines.length*25+20));
  bottom=top+rowHeights.reduce((sum,height)=>sum+height,0);
  if(bottom>4200)throw new Error('The category labels are too long for a readable figure. Use Download Excel to work with these results.');
  for(const tick of axis.ticks){const x=left+tick/axis.upper*(right-left);line(x,top-6,x,bottom);text(x,bottom+32,tick.toLocaleString('en-US'),19,'middle',muted);}
  let y=top;
  rows.forEach(({bar,lines},index)=>{
   const center=y+rowHeights[index]/2;
   begin(index);hit(60,y,1080,rowHeights[index]);
   lines.forEach((value,i)=>text(left-26,center-(lines.length-1)*12.5+i*25+7,value,21,'end'));
   parts.push(`<rect x="${left}" y="${center-15}" width="${bar.count/axis.upper*(right-left)}" height="30" rx="3" fill="${bars.length<=8?categoryPalette[index]:blue}"/>`);
   text(1130,center+7,`${bar.count.toLocaleString('en-US')} (${Math.round(bar.count/data.points.length*100)}%)`,21,'end');
   end();
   y+=rowHeights[index];
  });
  text((left+right)/2,bottom+76,'Number of annotations',21,'middle');
  bottom+=100;
 }else{
  const left=110,right=1130,plotBottom=top+390,slot=(right-left)/bars.length;
  for(const tick of axis.ticks){const y=plotBottom-tick/axis.upper*360;line(left,y,right,y);text(left-18,y+7,tick.toLocaleString('en-US'),20,'end',muted);}
  parts.push(`<text transform="translate(38 ${(top+plotBottom)/2}) rotate(-90)" text-anchor="middle" font-size="21" fill="${ink}">Number of annotations</text>`);
  bars.forEach((bar,i)=>{
   const barWidth=kind==='histogram'?slot-2:Math.min(100,slot*.64),x=left+i*slot+(slot-barWidth)/2,h=bar.count/axis.upper*360;
   begin(i);hit(left+i*slot,top,slot,plotBottom-top+48);
   const value=bar.value??(distribution.edges![i]/2+distribution.edges![i+1]/2),share=slot>=95&&bar.count>0;
   if(bar.count)parts.push(`<rect x="${x}" y="${plotBottom-h}" width="${barWidth}" height="${h}" rx="${kind==='histogram'?0:4}" fill="${color(value)}"/>`);
   text(left+(i+.5)*slot,plotBottom-h-(share?30:12),bar.count.toLocaleString('en-US'),20,'middle',bar.count?ink:muted,'font-weight="600"');
   if(share)text(left+(i+.5)*slot,plotBottom-h-10,`${Math.round(bar.count/data.points.length*100)}%`,16,'middle',muted);
   end();
  });
  line(left,plotBottom,right,plotBottom,'#9aa6b2');
  let rotated=false;
  if(kind==='histogram'){
   const edges=distribution.edges!,step=Math.ceil(bars.length/6);
   // Labels show actual bin boundaries. Only the last bin includes its upper endpoint.
   const ticks=edges.map((edge,i)=>({edge,i})).filter(({i})=>i%step===0||i===bars.length);
   const labels=ticks.map(({edge})=>String(Number(edge.toPrecision(12))));
   ticks.forEach(({edge,i},index)=>text(left+i*slot,plotBottom+34,new Set(labels).size===labels.length?labels[index]:String(edge),18,'middle',muted));
  }else{
   rotated=bars.some(bar=>bar.label.length*12>slot*.9);
   if(bars.some(bar=>bar.label.length>25))throw new Error('These score labels are too long for a readable figure. Use Download Excel to work with these results.');
   bars.forEach((bar,i)=>{
    const x=left+(i+.5)*slot,y=plotBottom+34;
    text(x,y,bar.label,20,rotated?'end':'middle',muted,rotated?`transform="rotate(-35 ${x} ${y})"`:'');
   });
  }
  bottom=plotBottom+(rotated?150:78);
  text((left+right)/2,bottom,'Score',22,'middle');bottom+=40;
 }
 const notes:string[]=[];
 if(yearPlot&&!options.compact&&bars.some(bar=>bar.count>1))notes.push('Larger dots represent multiple texts with the same year and score.');
 if(style==='ranked'&&!options.compact){
  if(options.rankedScope==='page')notes.push(`Results ${rankedStart+1}–${rankedStart+rankedVisible.length} of ${bars.length}${options.rankedQuery?.trim()?' matching results':' in score order'}.`);
  if(options.rankedQuery?.trim())notes.push(...lines(`Name filter: ${options.rankedQuery.trim()}`,100,18));
 }
 if(kind==='histogram'&&style!=='points')notes.push('Scores are grouped into equal-width intervals.');
 if(data.excluded&&!options.compact)notes.push(`${data.excluded.toLocaleString('en-US')} ${data.excluded===1?'result':'results'} without a plotted value excluded.`);
 for(const note of notes){text(70,bottom+24,note,18,'start',muted);bottom+=27;}
 const height=Math.ceil(bottom+40);
 if(height>4400)throw new Error('The labels are too long for a readable figure. Use Download Excel to work with these results.');
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="${options.interactive?'group':'img'}" aria-label="${xml(label+' chart')}"><title>${xml(title||`${label} distribution`)}</title><rect width="100%" height="100%" fill="white"/><g font-family="Arial, Helvetica, sans-serif">${parts.join('')}</g></svg>`,width,height,distribution,style};
}

function saveFigureBlob(blob:Blob,title:string,extension:'png'|'svg'){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=(title.replace(/[^\p{L}\p{N} -]/gu,'').trim().replace(/\s+/g,'-').slice(0,90)||'results-figure')+'.'+extension;
 document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export function downloadFigureSvg(figure:ReturnType<typeof resultsFigureSvg>,title:string){
 saveFigureBlob(new Blob([figure.svg],{type:'image/svg+xml;charset=utf-8'}),title,'svg');
}

export async function downloadFigurePng(figure:ReturnType<typeof resultsFigureSvg>,title:string){
 const svgUrl=URL.createObjectURL(new Blob([figure.svg],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const image=new Image();image.src=svgUrl;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=figure.width*2;canvas.height=figure.height*2;
  const context=canvas.getContext('2d');if(!context)throw new Error('Your browser could not create the image. Please try again.');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The image could not be created. Please try again.')),'image/png'));
  saveFigureBlob(blob,title,'png');
 }finally{URL.revokeObjectURL(svgUrl);}
}
