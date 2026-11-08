// Read RTF text while tracking nested groups, destinations, and Unicode fallbacks.
export function rtfText(raw: string): string {
  if (!/^\s*\{\\rtf\d/.test(raw)) throw new Error('This file is not a valid RTF document.');
  type State = {skip:boolean; uc:number; encoding:string};
  let state:State={skip:false,uc:1,encoding:'windows-1252'},fallback=0;
  const stack:State[]=[],out:string[]=[];
  const destinations=new Set(['fonttbl','colortbl','stylesheet','info','pict','object','objdata','fldinst','header','headerl','headerr','footer','footerl','footerr','listtable','listoverridetable','generator','filetbl','datastore','themedata','colorschememapping']);
  const text=(s:string)=>{if(fallback>0){fallback--;return;}if(!state.skip)out.push(s);};
  const symbols:Record<string,string>={par:'\n\n',line:'\n',tab:'\t',cell:'\t',row:'\n',emdash:'—',endash:'–',lquote:'‘',rquote:'’',ldblquote:'“',rdblquote:'”',bullet:'•'};
  for(let i=0;i<raw.length;){
    const c=raw[i++];
    if(c==='{'){stack.push({...state});continue;}
    if(c==='}'){if(!stack.length)throw new Error('The RTF document has invalid grouping.');state=stack.pop()!;continue;}
    if(c==='\r'||c==='\n')continue;
    if(c!=='\\'){text(c);continue;}
    const next=raw[i++];
    if(next===undefined)throw new Error('The RTF document is incomplete.');
    if(next==='*'){state.skip=true;continue;}
    if(next==='\\'||next==='{'||next==='}'){text(next);continue;}
    if(next==="'"){
      const hex=raw.slice(i,i+2);if(!/^[0-9a-f]{2}$/i.test(hex))throw new Error('Invalid RTF character encoding.');i+=2;
      // Decode consecutive escaped bytes together for multibyte code pages.
      const bytes=[parseInt(hex,16)];
      while(raw.slice(i,i+2)==="\\'"&&/^[0-9a-f]{2}$/i.test(raw.slice(i+2,i+4))){bytes.push(parseInt(raw.slice(i+2,i+4),16));i+=4;}
      const skipped=Math.min(fallback,bytes.length);fallback-=skipped;
      if(!state.skip&&skipped<bytes.length)out.push(new TextDecoder(state.encoding).decode(new Uint8Array(bytes.slice(skipped))));
      continue;
    }
    if(next==='~'){text('\u00a0');continue;}
    if(next==='_'){text('‑');continue;}
    if(next==='-'){text('\u00ad');continue;}
    if(!/[a-z]/i.test(next))continue;
    const start=i-1;while(i<raw.length&&/[a-z]/i.test(raw[i]))i++;
    const word=raw.slice(start,i);const match=/^-?\d+/.exec(raw.slice(i));const num=match?Number(match[0]):undefined;if(match)i+=match[0].length;
    if(raw[i]===' ')i++;
    if(word==='bin'&&num!==undefined){if(num<0||i+num>raw.length)throw new Error('Invalid RTF binary data.');i+=num;continue;}
    if(destinations.has(word)){state.skip=true;continue;}
    if(word==='uc'&&num!==undefined){state.uc=Math.max(0,num);continue;}
    if(word==='ansicpg'&&num!==undefined){const enc=num===65001?'utf-8':num===932?'shift_jis':num===936?'gbk':num===950?'big5':`windows-${num}`;try{new TextDecoder(enc);}catch{throw new Error('This RTF character encoding is unsupported. Save as DOCX or UTF-8 TXT.');}state.encoding=enc;continue;}
    if(word==='u'&&num!==undefined){if(!state.skip)out.push(String.fromCharCode(num&65535));fallback=state.uc;continue;}
    if(symbols[word])text(symbols[word]);
  }
  if(stack.length)throw new Error('The RTF document is incomplete. Save it again and retry.');
  return out.join('').trim();
}
