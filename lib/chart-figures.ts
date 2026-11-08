// Draws the results charts as self-contained SVG strings.
// The same drawing serves the interactive chart window and the downloaded figure.
import {formatNumber,meanInterval,mean,periodsFor,smoothTrend,trendWindow,type Scale,type Unit} from './chart-model';

export const INK='#1b2942',INK2='#425775',MUTED='#64728b',GRID='#e8ecf2',AXIS='#b7c3d1',ZERO='#8f9caf';
export const SEQUENTIAL=['#86b6ef','#5c9be8','#3684e0','#2369bd','#184f95','#0f3a72','#082650'];
const DIV_LOW=['#9ec5f4','#3987e5','#184f95'],DIV_MID='#c3c2b7',DIV_HIGH=['#ffa98a','#e15102','#8a2e00'];
export const CATEGORICAL=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300','#6250d6','#e34948'];
export const OTHER='#9aa3ad',SINGLE='#2369bd';
const FONT='Arial, Helvetica, sans-serif';

export type Pick={label:string;ids:string[]};
export type Figure={svg:string;width:number;height:number;picks:Pick[];notes:string[]};

// ---------- small helpers ----------
export const esc=(value:string)=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const n=(v:number)=>Number.isFinite(v)?Math.round(v*100)/100:0;
function text(x:number,y:number,value:string,o:{size?:number;fill?:string;anchor?:'start'|'middle'|'end';weight?:number;extra?:string}={}){
 return `<text x="${n(x)}" y="${n(y)}" font-size="${o.size||12}" fill="${o.fill||MUTED}" text-anchor="${o.anchor||'start'}"${o.weight?` font-weight="${o.weight}"`:''}${o.extra?' '+o.extra:''}>${esc(value)}</text>`;
}
const line=(x1:number,y1:number,x2:number,y2:number,color=GRID,width=1)=>`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}"/>`;
const rect=(x:number,y:number,w:number,h:number,fill:string,r=2)=>w>0&&h>0?`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}" fill="${fill}"/>`:'';
function hexToRgb(hex:string){const v=parseInt(hex.slice(1),16);return [v>>16,(v>>8)&255,v&255];}
function mix(a:string,b:string,t:number){const x=hexToRgb(a),y=hexToRgb(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*t).toString(16).padStart(2,'0')).join('');}
function ramp(stops:string[],t:number){if(stops.length===1)return stops[0];const p=Math.max(0,Math.min(1,t))*(stops.length-1),i=Math.min(stops.length-2,Math.floor(p));return mix(stops[i],stops[i+1],p-i);}
export function luminance(hex:string){const c=hexToRgb(hex).map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];}
export const inkOn=(fill:string)=>luminance(fill)<.3?'#ffffff':INK;
export const signed=(v:number)=>v>0?'+'+formatNumber(v):formatNumber(v);
export function scaleLabel(scale:Scale,value:number){return scale.type==='diverging'&&scale.min<0?signed(value):formatNumber(value);}

/** Neutral point of a diverging scale: zero when the scale crosses it, otherwise the middle. */
export function scaleCenter(scale:Scale){return scale.min<0&&scale.max>0?0:(scale.min+scale.max)/2;}
export function scaleColor(scale:Scale,value:number){
 if(scale.type==='sequential'){const span=scale.max-scale.min;return ramp(SEQUENTIAL,span?(value-scale.min)/span:1);}
 const center=scaleCenter(scale);
 if(Math.abs(value-center)<1e-9)return DIV_MID;
 if(value<center){const t=(center-value)/(center-scale.min||1);return ramp([mix(DIV_MID,DIV_LOW[0],.75),...DIV_LOW],t);}
 const t=(value-center)/(scale.max-center||1);return ramp([mix(DIV_MID,DIV_HIGH[0],.75),...DIV_HIGH],t);
}
export function scalePoints(scale:Scale){return Array.from({length:Math.round(scale.max-scale.min)+1},(_,i)=>scale.min+i);}
export function categoryColors(categories:string[]){
 const map=new Map<string,string>();categories.forEach((c,i)=>map.set(c,i<CATEGORICAL.length?CATEGORICAL[i]:OTHER));return map;
}
function wrap(value:string,max:number){
 const words=value.trim().split(/\s+/),lines:string[]=[];let current='';
 for(const word of words){if(current&&(current+' '+word).length>max){lines.push(current);current=word;}else current=current?current+' '+word:word;}
 if(current)lines.push(current);
 return lines.flatMap(l=>l.length>max?l.match(new RegExp(`.{1,${max}}`,'g'))||[l]:[l]);
}
function svgDoc(width:number,height:number,body:string,label:string,interactive:boolean){
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.ceil(height)}" viewBox="0 0 ${width} ${Math.ceil(height)}" role="${interactive?'group':'img'}" aria-label="${esc(label)}"><g font-family="${FONT}">${body}</g></svg>`;
}
function pickOpen(index:number,label:string,interactive:boolean){
 return interactive?`<g data-pick="${index}" role="button" tabindex="0" aria-label="${esc(label)}">`:'<g>';
}
const hit=(x:number,y:number,w:number,h:number,interactive:boolean)=>interactive?`<rect class="pick-hit" x="${n(x)}" y="${n(y)}" width="${n(Math.max(0,w))}" height="${n(Math.max(0,h))}" fill="transparent"/>`:'';
const countAxis=(max:number)=>{const raw=Math.max(1,max/4),unit=10**Math.floor(Math.log10(raw)),f=raw/unit,step=Math.max(1,(f<=1?1:f<=2?2:f<=5?5:10)*unit);const upper=Math.max(step,Math.ceil(max/step)*step);return {upper,ticks:Array.from({length:Math.round(upper/step)+1},(_,i)=>i*step)};};
const pct=(part:number,whole:number)=>whole?Math.round(part/whole*100)+'%':'0%';

export type ViewOptions={width:number;interactive:boolean;noun:string};

// ---------- Distribution: scale ----------
export function distributionScale(units:Unit[],scale:Scale,o:ViewOptions):Figure{
 const points=scalePoints(scale),bins=points.map(()=>[] as Unit[]),notes:string[]=[];
 let rounded=false;
 for(const unit of units){const v=unit.number!;const r=Math.round(v);if(r!==v)rounded=true;const i=Math.max(0,Math.min(points.length-1,r-scale.min));bins[i].push(unit);}
 if(rounded)notes.push(`Averages across runs or chunks are rounded to the nearest score in this chart.`);
 const W=o.width,l=48,r=W-8,t=34,b=250,H=b+34,max=Math.max(...bins.map(x=>x.length),1),axis=countAxis(max),Y=(v:number)=>b-v/axis.upper*(b-t),slot=(r-l)/points.length;
 let s='';
 for(const tick of axis.ticks)s+=line(l,Y(tick),r,Y(tick),tick?GRID:AXIS)+text(l-10,Y(tick)+4,String(tick),{anchor:'end'});
 s+=`<text transform="translate(12 ${(t+b)/2}) rotate(-90)" font-size="12" fill="${MUTED}" text-anchor="middle">Number of ${esc(o.noun)}</text>`;
 const picks:Pick[]=[];
 points.forEach((point,i)=>{
  const c=bins[i].length,w=Math.min(64,slot*.64),x=l+i*slot+(slot-w)/2,h=b-Y(c),label=scaleLabel(scale,point);
  if(c){picks.push({label:`Score ${label}`,ids:bins[i].flatMap(u=>u.ids)});s+=pickOpen(picks.length-1,`Score ${label}: ${c} ${o.noun}. Show them.`,o.interactive)+hit(l+i*slot,t,slot,b-t+26,o.interactive);}
  else s+='<g>';
  if(c)s+=`<path d="M${n(x)},${b} V${n(b-h+4)} Q${n(x)},${n(b-h)} ${n(x+4)},${n(b-h)} H${n(x+w-4)} Q${n(x+w)},${n(b-h)} ${n(x+w)},${n(b-h+4)} V${b}Z" fill="${scaleColor(scale,point)}"/>`;
  else s+=line(x+8,b-1,x+w-8,b-1,'#cfd8e3',2);
  if(c){s+=text(x+w/2,b-h-20,String(c),{anchor:'middle',fill:INK,size:13,weight:700})+text(x+w/2,b-h-7,pct(c,units.length),{anchor:'middle',size:11});}
  else s+=text(x+w/2,b-9,'0',{anchor:'middle',fill:'#9aa6b6'});
  s+=text(x+w/2,b+20,label,{anchor:'middle',fill:INK,size:13,weight:700})+'</g>';
 });
 return {svg:svgDoc(W,H,s,'Distribution of scores',o.interactive),width:W,height:H,picks,notes};
}

// ---------- Distribution: free numbers (no fixed scale) ----------
export function distributionNumbers(units:Unit[],o:ViewOptions):Figure{
 const values=units.map(u=>u.number!),low=Math.min(...values),high=Math.max(...values);
 const binsCount=Math.min(12,Math.max(5,Math.ceil(Math.sqrt(units.length))));
 // Interpolate rather than subtract, so even extreme finite values stay finite.
 const edges=Array.from({length:binsCount+1},(_,i)=>low*(1-i/binsCount)+high*(i/binsCount));
 const bins=Array.from({length:binsCount},()=>[] as Unit[]),size=Math.max(Math.abs(low),Math.abs(high),Number.MIN_VALUE);
 for(const unit of units){const p=high===low?0:(unit.number!/size-low/size)/(high/size-low/size);bins[Math.max(0,Math.min(binsCount-1,Math.floor(p*binsCount)))].push(unit);}
 const W=o.width,l=48,r=W-8,t=34,b=250,H=b+52,axis=countAxis(Math.max(...bins.map(x=>x.length),1)),Y=(v:number)=>b-v/axis.upper*(b-t),slot=(r-l)/binsCount;
 let s='';const picks:Pick[]=[];
 for(const tick of axis.ticks)s+=line(l,Y(tick),r,Y(tick),tick?GRID:AXIS)+text(l-10,Y(tick)+4,String(tick),{anchor:'end'});
 bins.forEach((bin,i)=>{
  const c=bin.length,x=l+i*slot+1,h=b-Y(c),label=`${formatNumber(edges[i])} to ${formatNumber(edges[i+1])}`;
  if(c){picks.push({label,ids:bin.flatMap(u=>u.ids)});s+=pickOpen(picks.length-1,`${label}: ${c} ${o.noun}. Show them.`,o.interactive)+hit(l+i*slot,t,slot,b-t,o.interactive)+rect(x,b-h,slot-2,h,SINGLE,0)+text(x+slot/2-1,b-h-7,String(c),{anchor:'middle',fill:INK,weight:700})+'</g>';}
 });
 const step=Math.ceil(binsCount/6);edges.forEach((e,i)=>{if(i%step===0||i===binsCount)s+=text(l+i*slot,b+20,formatNumber(e),{anchor:'middle'});});
 s+=text((l+r)/2,b+42,'Value',{anchor:'middle',fill:INK2});
 return {svg:svgDoc(W,H,s,'Distribution of values',o.interactive),width:W,height:H,picks,notes:['Values are grouped into equal-width ranges; only the last range includes its upper end.']};
}

// ---------- Distribution: categories ----------
export function distributionCategories(units:Unit[],o:ViewOptions):Figure{
 const counts=new Map<string,Unit[]>();for(const u of units){const list=counts.get(u.value);if(list)list.push(u);else counts.set(u.value,[u]);}
 const sorted=Array.from(counts).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
 const shown=sorted.slice(0,25),notes:string[]=[];
 if(sorted.length>25)notes.push(`${sorted.length-25} smaller categories are not shown here; see the table.`);
 const W=o.width,labelW=Math.min(260,W*.34),l=labelW+14,r=W-70,max=Math.max(...shown.map(x=>x[1].length)),axis=countAxis(max),X=(v:number)=>l+v/axis.upper*(r-l);
 const rows=shown.map(([label,list])=>({label,list,lines:wrap(label,Math.max(12,Math.floor(labelW/7))).slice(0,3)}));
 let y=10,s='';const picks:Pick[]=[];
 const heights=rows.map(row=>Math.max(34,row.lines.length*15+14)),bottom=y+heights.reduce((a,h)=>a+h,0);
 for(const tick of axis.ticks)s+=line(X(tick),y,X(tick),bottom,tick?GRID:AXIS)+text(X(tick),bottom+18,String(tick),{anchor:'middle'});
 rows.forEach((row,i)=>{
  const h=heights[i],cy=y+h/2;picks.push({label:row.label,ids:row.list.flatMap(u=>u.ids)});
  s+=pickOpen(i,`${row.label}: ${row.list.length} ${o.noun}. Show them.`,o.interactive)+hit(0,y,W,h,o.interactive);
  row.lines.forEach((ln,j)=>{s+=text(l-12,cy-(row.lines.length-1)*7.5+j*15+4,ln,{anchor:'end',fill:INK,size:12.5});});
  s+=rect(l,cy-10,X(row.list.length)-l,20,SINGLE,3)+text(W-4,cy+4,`${row.list.length} (${pct(row.list.length,units.length)})`,{anchor:'end',fill:INK,size:12.5})+'</g>';
  y+=h;
 });
 s+=text((l+r)/2,bottom+38,`Number of ${o.noun}`,{anchor:'middle',fill:INK2});
 return {svg:svgDoc(W,bottom+46,s,'Categories',o.interactive),width:W,height:bottom+46,picks,notes};
}

// ---------- Over time: each text ----------
function dotLayout(units:Unit[],width:number){
 const dated=units.filter(u=>u.year!==undefined&&u.number!==null),years=dated.map(u=>u.year!);
 const y0=Math.min(...years),y1=Math.max(...years),pad=Math.max(2,(y1-y0)*.02),l=40,r=width-10,radius=width<500?3.8:4.6;
 // Room for dots that share a year: the space between neighboring years, but never less than one dot.
 const yearWidth=y1===y0?(r-l)/3:(r-l)/(y1-y0+2*pad);
 const slots=new Map<string,number>();for(const u of dated){const k=u.year+'|'+u.number;slots.set(k,(slots.get(k)||0)+1);}
 const most=Math.max(0,...slots.values()),spacing=(c:number)=>c<2?0:Math.min(radius*1.9,Math.max(yearWidth*.9,radius*1.9)/(c-1));
 return {dated,years,y0,y1,pad,l,r,radius,slots,spacing,crowded:most>1&&spacing(most)<radius*1.2};
}
/** True when so many dots share a year and score that they would pile up; shares per period read better then. */
export function crowdedDots(units:Unit[],width:number){return dotLayout(units,width).crowded;}
export function timeDots(units:Unit[],scale:Scale|undefined,trend:boolean,o:ViewOptions):Figure{
 const {dated,years,y0,y1,pad,radius,slots,spacing,crowded}=dotLayout(units,o.width),values=dated.map(u=>u.number!);
 const lo=scale?scale.min:Math.min(...values),hi=scale?scale.max:Math.max(...values),vpad=scale?.5:Math.max((hi-lo)*.06,.5);
 const W=o.width,l=40,r=W-10,t=12,b=262,H=b+46,X=(y:number)=>y1===y0?(l+r)/2:l+(y-y0+pad)/(y1-y0+2*pad)*(r-l),Y=(v:number)=>b-(v-lo+vpad)/(hi-lo+2*vpad)*(b-t);
 let s='';
 if(scale&&scale.max-scale.min<=12){for(const p of scalePoints(scale)){s+=rect(l,Y(p+.5),r-l,Y(p-.5)-Y(p+.5),(p-scale.min)%2?'#ffffff':'#f7f9fc',0)+text(l-8,Y(p)+4,scaleLabel(scale,p),{anchor:'end',fill:INK,size:12.5,weight:700});}}
 else{for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4;s+=line(l,Y(v),r,Y(v))+text(l-8,Y(v)+4,formatNumber(v),{anchor:'end'});}}
 if(scale&&scale.type==='diverging'&&scale.min<0&&scale.max>0)s+=line(l,Y(0),r,Y(0),ZERO,1);
 s+=line(l,b,r,b,AXIS);
 const span=y1-y0,step=[1,2,5,10,20,25,50,100,200,500].find(st=>span/st<=(W<500?4:7))||1000;
 for(let y=Math.ceil(y0/step)*step;y<=y1;y+=step)s+=line(X(y),b,X(y),b+4,AXIS)+text(X(y),b+18,String(y),{anchor:'middle'});
 if(y0===y1)s+=text(X(y0),b+18,String(y0),{anchor:'middle'});
 s+=text((l+r)/2,b+38,'Year',{anchor:'middle',fill:INK2,size:12.5});
 const notes:string[]=[];
 if(trend){
  const pts=smoothTrend(dated.map(u=>({year:u.year!,value:u.number!})),trendWindow(years));
  if(pts.length){const d='M'+pts.map(p=>`${n(X(p.year))},${n(Y(p.value))}`).join(' L');
   s+=`<path d="${d}" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round" opacity=".9"/><path d="${d}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
   notes.push(`Trend line: a smoothed average that weighs ${o.noun} closest in time most heavily (about a ${Math.round(trendWindow(years)*2)}-year window).`);}
  else notes.push(`The trend line needs at least 5 ${o.noun} with years spread over time.`);
 }
 // Dots sit on their exact score; only dots that would cover each other move sideways.
 const seen=new Map<string,number>(),picks:Pick[]=[];
 const order=[...dated].sort((a,b)=>a.year!-b.year!);
 for(const u of order){
  const k=u.year+'|'+u.number,count=slots.get(k)!,index=seen.get(k)||0;seen.set(k,index+1);
  const cx=X(u.year!)+(index-(count-1)/2)*spacing(count),cy=Y(u.number!),fill=scale?scaleColor(scale,u.number!):SINGLE;
  const light=luminance(fill)>.35;
  picks.push({label:`${u.name} · ${u.year} · ${u.value}`,ids:u.ids});
  s+=pickOpen(picks.length-1,`${u.name}, ${u.year}: ${u.value}. Show details.`,o.interactive)+(o.interactive?`<title>${esc(`${u.name} · ${u.year} · ${u.value}`)}</title>`:'')+hit(cx-7,cy-7,14,14,o.interactive)+`<circle cx="${n(cx)}" cy="${n(cy)}" r="${radius}" fill="${fill}"${crowded?' fill-opacity=".45"':` stroke="${light?mix(fill,'#000000',.35):'#ffffff'}" stroke-width="1.2"`}/></g>`;
 }
 if(crowded)notes.push(`Many ${o.noun} share a year and score, so their dots overlap; darker spots hold more ${o.noun}. “Share per period” shows them more clearly.`);
 else if(Array.from(slots.values()).some(c=>c>1))notes.push(`Dots with the same year and score sit side by side.`);
 return {svg:svgDoc(W,H,s,'Scores by year',o.interactive),width:W,height:H,picks,notes};
}

// ---------- Over time: share per period ----------
export function timeShares(units:Unit[],scale:Scale|undefined,categories:string[]|undefined,length:number,o:ViewOptions):Figure{
 const dated=units.filter(u=>u.year!==undefined);
 const periods=periodsFor(dated.map(u=>u.year!),length);
 const keys=scale?scalePoints(scale).map(String):[...categories!,...(units.some(u=>!categories!.includes(u.value))?['Other']:[])];
 const colorOf=(k:string)=>scale?scaleColor(scale,Number(k)):categoryColors(categories!).get(k)||OTHER;
 const keyOf=(u:Unit)=>scale?String(Math.max(scale.min,Math.min(scale.max,Math.round(u.number!)))):(categories!.includes(u.value)?u.value:'Other');
 const W=o.width,l=44,r=W-6,t=10,b=250,H=b+46,slot=(r-l)/periods.length,bw=Math.min(84,slot*.7),Y=(p:number)=>b-p*(b-t);
 let s='';const picks:Pick[]=[],notes:string[]=[];
 for(const p of [0,.25,.5,.75,1])s+=line(l,Y(p),r,Y(p),p?GRID:AXIS)+text(l-8,Y(p)+4,Math.round(p*100)+'%',{anchor:'end'});
 let smallest=Infinity;
 periods.forEach((period,i)=>{
  const inPeriod=dated.filter(u=>u.year!>=period.start&&u.year!<=period.end),total=inPeriod.length,x=l+i*slot+(slot-bw)/2;
  if(total)smallest=Math.min(smallest,total);
  let acc=0;
  for(const key of keys){
   const members=inPeriod.filter(u=>keyOf(u)===key),c=members.length;if(!c)continue;
   const top=Y((acc+c)/total),h=Y(acc/total)-top,fill=colorOf(key),label=scale?scaleLabel(scale,Number(key)):key;
   picks.push({label:`${period.start}–${period.end} · ${label}`,ids:members.flatMap(u=>u.ids)});
   s+=pickOpen(picks.length-1,`${period.start} to ${period.end}, ${label}: ${c} of ${total} ${o.noun}. Show them.`,o.interactive)+hit(x,top,bw,h,o.interactive)+rect(x,top+1,bw,h-2,fill);
   if(h>=18&&bw>=44){const ink=inkOn(fill),short=scale?label:'';
    s+=`<text x="${n(x+bw/2)}" y="${n(top+h/2+4)}" font-size="11.5" text-anchor="middle" fill="${ink}">${short?`<tspan font-weight="700">${esc(short)}</tspan><tspan dx="5" opacity=".85">${pct(c,total)}</tspan>`:esc(pct(c,total))}</text>`;}
   s+='</g>';acc+=c;
  }
  if(!total)s+=text(x+bw/2,b-8,'none',{anchor:'middle',fill:'#9aa6b6'});
  const end=Math.min(period.end,Math.max(...dated.map(u=>u.year!)));
  s+=text(x+bw/2,b+17,slot<70?`${period.start}s`:`${period.start}–${end}`,{anchor:'middle',fill:INK,size:12})+text(x+bw/2,b+32,`${total} ${total===1?o.noun.replace(/s$/,''):o.noun}`,{anchor:'middle',size:11});
 });
 if(Number.isFinite(smallest)&&smallest<8)notes.push(`The smallest period holds only ${smallest} ${smallest===1?o.noun.replace(/s$/,''):o.noun}, so one of them moves its column by ${Math.round(100/smallest)} percentage points.`);
 return {svg:svgDoc(W,H,s,'Share of each score per period',o.interactive),width:W,height:H,picks,notes};
}

// ---------- Compare groups ----------
export function groupsView(units:Unit[],groups:string[],scale:Scale|undefined,categories:string[]|undefined,o:ViewOptions):Figure{
 const W=o.width,narrow=W<620,labelW=narrow?92:140,showMeans=Boolean(scale);
 const barL=labelW+12,barR=showMeans&&!narrow?W*.64:W-22,meanL=showMeans&&!narrow?W*.70:0,meanR=W-8;
 const rowH=58,top=26,picks:Pick[]=[],notes:string[]=[];
 const meansTop=narrow&&showMeans?top+groups.length*rowH+44:top;
 const H=(narrow&&showMeans?meansTop+groups.length*40+40:top+groups.length*rowH+40);
 let s='';
 const keys=scale?scalePoints(scale).map(String):[...categories!,...(units.some(u=>!categories!.includes(u.value))?['Other']:[])];
 const colorOf=(k:string)=>scale?scaleColor(scale,Number(k)):categoryColors(categories!).get(k)||OTHER;
 const keyOf=(u:Unit)=>scale?String(Math.max(scale.min,Math.min(scale.max,Math.round(u.number!)))):(categories!.includes(u.value)?u.value:'Other');
 const diverging=scale?.type==='diverging';
 // Diverging bars are centered on the neutral point; others start at the left edge.
 const center=diverging?barL+(barR-barL)*.5:barL,U=diverging?(barR-barL)/2:(barR-barL);
 if(diverging){for(const p of [-1,-.5,0,.5,1])s+=line(center+p*U,top-6,center+p*U,top+groups.length*rowH-6,p?GRID:ZERO,p?1:1.5)+text(center+p*U,top+groups.length*rowH+10,Math.abs(p*100)+'%',{anchor:'middle'});
  s+=text(center-8,top-12,'← lower',{anchor:'end',size:11.5,fill:INK2})+text(center+8,top-12,'higher →',{size:11.5,fill:INK2});}
 else for(const p of [0,.25,.5,.75,1])s+=line(barL+p*U,top-6,barL+p*U,top+groups.length*rowH-6,p?GRID:AXIS)+text(barL+p*U,top+groups.length*rowH+10,Math.round(p*100)+'%',{anchor:'middle'});
 groups.forEach((group,gi)=>{
  const members=units.filter(u=>u.group===group),total=members.length,y=top+gi*rowH,h=34;
  s+=text(labelW,y+h/2,group,{anchor:'end',fill:INK,size:13,weight:700})+text(labelW,y+h/2+15,`${total} ${o.noun}`,{anchor:'end',size:11});
  let x=center;
  if(diverging){const below=members.filter(u=>Math.round(u.number!)<scaleCenter(scale!)).length,mid=members.filter(u=>Math.round(u.number!)===scaleCenter(scale!)).length;x=center-(below+mid/2)/Math.max(1,total)*U;}
  for(const key of keys){
   const list=members.filter(u=>keyOf(u)===key),c=list.length;if(!c)continue;
   const w=c/total*U,fill=colorOf(key),label=scale?scaleLabel(scale,Number(key)):key;
   picks.push({label:`${group} · ${label}`,ids:list.flatMap(u=>u.ids)});
   s+=pickOpen(picks.length-1,`${group}, ${label}: ${c} of ${total} ${o.noun}. Show them.`,o.interactive)+hit(x,y,w,h,o.interactive)+rect(x+1,y,w-2,h,fill);
   const ink=inkOn(fill);
   if(scale&&w>=58)s+=`<text x="${n(x+w/2)}" y="${n(y+h/2+4)}" font-size="11.5" text-anchor="middle" fill="${ink}"><tspan font-weight="700">${esc(label)}</tspan><tspan dx="5" opacity=".85">${pct(c,total)}</tspan></text>`;
   else if(w>=34)s+=text(x+w/2,y+h/2+4,pct(c,total),{anchor:'middle',fill:ink,size:11.5});
   s+='</g>';x+=w;
  }
 });
 if(showMeans&&scale){
  const L2=narrow?barL:meanL,R2=meanR,X=(v:number)=>L2+(v-scale.min)/(scale.max-scale.min||1)*(R2-L2);
  const t0=narrow?meansTop:top,rows=narrow?40:rowH;
  s+=text((L2+R2)/2,t0-12,'Average, with 95% range',{anchor:'middle',size:11.5,fill:INK2});
  const tickStep=scale.max-scale.min>10?Math.ceil((scale.max-scale.min)/10):1;
  for(let v=scale.min;v<=scale.max;v+=tickStep)s+=line(X(v),t0-6,X(v),t0+groups.length*rows-6,v===scaleCenter(scale)&&diverging?ZERO:GRID)+text(X(v),t0+groups.length*rows+10,scaleLabel(scale,v),{anchor:'middle'});
  groups.forEach((group,gi)=>{
   const values=units.filter(u=>u.group===group).map(u=>u.number!);if(!values.length)return;
   const ci=meanInterval(values),y=t0+gi*rows+17;
   if(narrow)s+=text(L2-12,y+4,group,{anchor:'end',fill:INK,size:12,weight:700});
   if(Number.isFinite(ci.low))s+=line(X(Math.max(scale.min,ci.low)),y,X(Math.min(scale.max,ci.high)),y,INK,2.5)+line(X(Math.max(scale.min,ci.low)),y-6,X(Math.max(scale.min,ci.low)),y+6,INK,2)+line(X(Math.min(scale.max,ci.high)),y-6,X(Math.min(scale.max,ci.high)),y+6,INK,2);
   s+=`<circle cx="${n(X(ci.mean))}" cy="${y}" r="4.5" fill="${INK}" stroke="#fff" stroke-width="2"/>`+text(X(ci.mean),y-11,formatNumber(ci.mean),{anchor:'middle',fill:INK,size:12,weight:700});
  });
  if(groups.some(g=>units.filter(u=>u.group===g).length<2))notes.push('A group needs at least 2 texts for a 95% range.');
 }
 return {svg:svgDoc(W,H,s,'Groups compared',o.interactive),width:W,height:H,picks,notes};
}

// ---------- Run agreement ----------
export function runsView(units:Unit[],scale:Scale|undefined,o:ViewOptions):Figure{
 const repeated=units.filter(u=>u.values.length>1);
 const numeric=Boolean(scale)&&repeated.every(u=>u.numbers.every(v=>v!==null));
 const spread=(u:Unit)=>numeric?Math.max(...u.numbers as number[])-Math.min(...u.numbers as number[]):new Set(u.values).size-1;
 const rows=[...repeated].sort((a,b)=>spread(b)-spread(a)||(numeric?mean(b.numbers as number[])-mean(a.numbers as number[]):0)||a.name.localeCompare(b.name));
 const W=o.width,labelW=Math.min(200,W*.3),l=labelW+14,r=W-(W<500?70:110),rh=28,t=26,H=t+rows.length*rh+12,picks:Pick[]=[];
 let s='';
 if(numeric&&scale){
  const X=(v:number)=>l+(v-scale.min)/(scale.max-scale.min||1)*(r-l),tickStep=scale.max-scale.min>10?Math.ceil((scale.max-scale.min)/10):1;
  for(let v=scale.min;v<=scale.max;v+=tickStep)s+=line(X(v),t-4,X(v),t+rows.length*rh)+text(X(v),t-10,scaleLabel(scale,v),{anchor:'middle',fill:INK,weight:700});
  s+=text(W-4,t-10,'Runs',{anchor:'end',size:11.5});
  rows.forEach((u,i)=>{
   const y=t+i*rh+rh/2,nums=u.numbers as number[],d=spread(u);
   picks.push({label:u.name,ids:u.ids});
   s+=pickOpen(i,`${u.name}: runs gave ${u.values.join(', ')}. Show them.`,o.interactive)+hit(0,y-rh/2,W,rh,o.interactive);
   if(i%2===0)s+=rect(0,y-rh/2,W,rh,'#f8fafc',0);
   s+=text(l-12,y+4,u.name.length>34?u.name.slice(0,33)+'…':u.name,{anchor:'end',fill:INK,size:12.5});
   if(d)s+=rect(X(Math.min(...nums)),y-4,X(Math.max(...nums))-X(Math.min(...nums)),8,'#dfe6ef',4);
   const tally=new Map<number,number>();nums.forEach(v=>tally.set(v,(tally.get(v)||0)+1));
   for(const [v,c] of tally)for(let k=0;k<c;k++){const fill=scaleColor(scale,v);s+=`<circle cx="${n(X(v)+(k-(c-1)/2)*9)}" cy="${y}" r="5" fill="${fill}" stroke="${luminance(fill)>.35?mix(fill,'#000000',.35):'#fff'}" stroke-width="1.3"/>`;}
   s+=d===0?text(W-4,y+4,'✓ agree',{anchor:'end',fill:'#2f6b48',weight:700}):text(W-4,y+4,d>=2?`▲ differ by ${formatNumber(d)}`:`differ by ${formatNumber(d)}`,{anchor:'end',fill:d>=2?'#9a4a12':MUTED,weight:d>=2?700:undefined});
   s+='</g>';
  });
 }else{
  s+=text(l,t-10,'Answers in each run',{fill:INK2,size:11.5})+text(W-4,t-10,'Runs',{anchor:'end',size:11.5});
  rows.forEach((u,i)=>{
   const y=t+i*rh+rh/2,d=spread(u);picks.push({label:u.name,ids:u.ids});
   s+=pickOpen(i,`${u.name}: runs gave ${u.values.join(', ')}. Show them.`,o.interactive)+hit(0,y-rh/2,W,rh,o.interactive);
   if(i%2===0)s+=rect(0,y-rh/2,W,rh,'#f8fafc',0);
   s+=text(l-12,y+4,u.name.length>34?u.name.slice(0,33)+'…':u.name,{anchor:'end',fill:INK,size:12.5})+text(l,y+4,u.values.join('  ·  ').slice(0,80),{fill:INK,size:12.5});
   s+=(d===0?text(W-4,y+4,'✓ agree',{anchor:'end',fill:'#2f6b48',weight:700}):text(W-4,y+4,'▲ differ',{anchor:'end',fill:'#9a4a12',weight:700}))+'</g>';
  });
 }
 return {svg:svgDoc(W,H,s,'Agreement between runs',o.interactive),width:W,height:H,picks,notes:[]};
}

// ---------- Downloaded figure ----------
/** Wraps a chart in a white figure with its title above and a caption below. */
export function exportFigure(chart:Figure,title:string,caption:string,legend:{label:string;color:string}[]=[]){
 const W=chart.width+48,titleLines=wrap(title||'Results',64),captionLines=caption.trim()?wrap(caption.trim(),Math.floor(W/7.4)):[];
 let y=40,head='';
 titleLines.forEach(l=>{head+=text(24,y,l,{size:22,fill:INK,weight:700});y+=28;});
 if(legend.length){let x=24;y+=2;for(const item of legend){head+=rect(x,y-10,12,12,item.color,2)+text(x+17,y,item.label,{size:12,fill:INK2});x+=17+item.label.length*6.6+16;if(x>W-120){x=24;y+=20;}}y+=16;}
 const chartTop=y;let foot='',cy=chartTop+chart.height+22;
 const notes=chart.notes.flatMap(note=>wrap(note,Math.floor(W/7)));
 for(const l of captionLines){foot+=text(24,cy,l,{size:12.5,fill:INK2});cy+=18;}
 if(captionLines.length&&notes.length)cy+=4;
 for(const l of notes){foot+=text(24,cy,l,{size:11.5,fill:MUTED});cy+=16;}
 const H=cy+14,inner=chart.svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
 return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.ceil(H)}" viewBox="0 0 ${W} ${Math.ceil(H)}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="100%" height="100%" fill="#ffffff"/><g font-family="${FONT}">${head}${foot}</g><g transform="translate(24 ${chartTop})">${inner}</g></svg>`,width:W,height:Math.ceil(H)};
}

export function saveBlob(blob:Blob,name:string){
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function fileName(title:string,ext:string){return (title.replace(/[^\p{L}\p{N} -]/gu,'').trim().replace(/\s+/g,'-').slice(0,90)||'results-figure')+'.'+ext;}
export async function downloadPng(figure:{svg:string;width:number;height:number},title:string){
 const url=URL.createObjectURL(new Blob([figure.svg],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const image=new Image();image.src=url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=figure.width*2;canvas.height=figure.height*2;
  const context=canvas.getContext('2d');if(!context)throw new Error('Your browser could not create the image. Please try again.');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('The image could not be created. Please try again.')),'image/png'));
  saveBlob(blob,fileName(title,'png'));
 }finally{URL.revokeObjectURL(url);}
}
export function downloadSvg(figure:{svg:string},title:string){saveBlob(new Blob([figure.svg],{type:'image/svg+xml;charset=utf-8'}),fileName(title,'svg'));}
