// Research mode, the details of a text: the technical details of each request, the full request and response on
// demand (as the logs of an export show them), and the steps to the previous and next text. The components are
// called with a small stand-in for React (not a browser renderer). No requests are sent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),root=process.cwd(),ts=require('../node_modules/typescript'),req=createRequire(path.join(root,'package.json'));
const cache=new Map();
// One component instance: its state lives in `slots`, and `render` calls it again.
function instance(){const slots=[];let cursor=0;return {react:{useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];},useRef(value){const i=cursor++;return slots[i]||(slots[i]={current:value});},useEffect(){cursor++;},lazy:()=>'Lazy',Suspense:'Suspense'},begin(){cursor=0;}};}
let current=instance();
const jsx=(type,props)=>({type,props});
function load(file){
 const filename=path.join(root,file);if(cache.has(filename))return cache.get(filename);const exports={};cache.set(filename,exports);
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=id=>{
  if(id==='react')return new Proxy({},{get:(_,key)=>current.react[key]});
  if(id==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'Fragment'};
  if(id.endsWith('.css'))return {};
  if(id==='lucide-react'||id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});
  // The text of a file, as the request handlers read it.
  if(id==='@/lib/extract-text')return {extractText:async file=>file.text()};
  const target=id.startsWith('@/')?id.slice(2):id.startsWith('.')?path.relative(root,path.resolve(path.dirname(filename),id)):null;
  if(target===null)return req(id);
  return load(fs.existsSync(path.join(root,target+'.tsx'))?target+'.tsx':target+'.ts');
 };
 new Function('exports','require',code)(exports,local);return exports;
}
function nodes(node,out=[]){if(!node||typeof node!=='object')return out;if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}out.push(node);nodes(node.props?.children,out);return out;}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return text(node.props?.children);}
// A component with state of its own: `tree()` is what it shows now.
function mount(component,props){const mine=instance();return {tree(){current=mine;mine.begin();return component(props);}};}
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));

(async()=>{
 const {Technical}=load('components/research/technical.tsx'),{ResearchDetail}=load('components/research/filters.tsx'),wrappers=load('components/research-mode.tsx');
 const frames=load('lib/request-frame.ts'),records=load('lib/research/requests.ts'),providers=load('lib/providers.ts'),data=load('lib/research/export-data.ts');
 const model=providers.defaultModel('openai'),PROMPT='Rate the speech from 1 to 5.';
 const settings={provider:'openai',model,effort:'medium',prompt:PROMPT,answerFields:[]};
 const kept=records.recordRequest(undefined,frames.requestFrame(settings,false));
 const usage={input_tokens:1000,output_tokens:264,output_tokens_details:{reasoning_tokens:64},input_tokens_details:{cached_tokens:512}};
 const result=extra=>({status:'done',provider:'openai',model,effort:'medium',prompt:PROMPT,answerFields:[],score:'4',explanation:'Because.',processing:'instant',requestId:kept.id,modelReported:model+'-2026-10-01',stopReason:'completed',output:'{"explanation":"Because.","score":"4"}',responseId:'resp_1',usage,tokens:1264,startedAt:'2026-11-16T07:00:00.000Z',time:'2026-11-16T07:00:02.000Z',runNo:2,...extra});
 const file=new File(['Speech 1. We observe today not a victory of party.'],'speech-001.txt');
 const row={id:'a',name:'speech-001.txt',file,...result()};
 const study={kind:'texts',requests:kept.list,versions:new Map([[1,1],[2,2]])};
 const fields=tree=>Object.fromEntries(nodes(tree).filter(n=>n.type==='div'&&nodes(n).some(x=>x.type==='dt')).map(n=>[text(nodes(n).find(x=>x.type==='dt')),text(nodes(n).find(x=>x.type==='dd'))]));
 const button=(tree,label)=>nodes(tree).find(n=>n.type==='button'&&text(n).startsWith(label));

 // --- The technical details of one request --------------------------------------------------
 const one=mount(Technical,{row,of:row,run:2,study});
 let tree=one.tree();
 assert.equal(tree.type,'details');assert.equal(text(nodes(tree).find(n=>n.type==='summary')),'Technical details');
 assert.deepEqual(fields(tree),{'Model (requested)':model,'Model (reported)':model+'-2026-10-01','Stop reason':'completed','Tokens in / out':'1,000 / 264 (incl. 64 reasoning)','Cache read / write':'512 / 0','Response ID':'resp_1','Run':'#2 · instant · prompt v2'});
 // The reply as the model returned it.
 const raw=nodes(tree).find(n=>n.type==='details'&&n.props.className==='research-technical-part');
 assert.equal(text(nodes(raw).find(n=>n.type==='summary')),'Raw model output');assert.equal(text(nodes(raw).find(n=>n.type==='pre')),'{"explanation":"Because.","score":"4"}');
 // The full request and response are read only when asked for.
 assert(!nodes(tree).some(n=>n.props?.className==='research-technical-full'));
 button(tree,'Show full request and response').props.onClick();
 tree=one.tree();assert.equal(button(tree,'Reading the request').props.disabled,true);
 await settle();tree=one.tree();
 const full=nodes(tree).find(n=>n.props?.className==='research-technical-full'),[requestText,responseText]=nodes(full).filter(n=>n.type==='pre').map(text);
 const shown=JSON.parse(requestText);
 // The request is the one that was sent: what the provider code builds for this text.
 const sent=frames.providerBody({provider:'openai',model,effort:'medium',prompt:PROMPT+load('lib/answer-fields.ts').answerInstructions([],undefined),schemaPrompt:PROMPT,answerFields:[]},{filename:'speech-001.txt',text:await file.text()});
 assert.equal(JSON.stringify(shown.request),JSON.stringify(sent),'The request shown is the request the Lab sends');
 assert.deepEqual([shown.recorded,shown.url],['kept when the request was sent','https://api.openai.com/v1/responses']);
 assert.deepEqual(JSON.parse(responseText),JSON.parse(JSON.stringify(data.responseRecord(row))),'The response is what the logs of an export hold');
 assert.deepEqual(Object.keys(JSON.parse(responseText)),['status','response_text','model_reported','stop_reason','response_id','usage','requested_at','completed_at']);
 assert.equal(JSON.parse(responseText).response_text,'{"explanation":"Because.","score":"4"}');
 assert.match(text(full),/As in the logs of an export\. The Lab keeps a lean record of a response/);
 // The same lines as an export's logs write, from the same code.
 assert.equal(requestText,JSON.stringify(data.requestRecord(data.requestOf({name:'',dataset:{kind:'texts',rows:[],runs:[],columns:[],samples:[]},requests:kept.list,lab:''},row,row),{filename:'speech-001.txt',text:await file.text()},row,''),null,2));
 button(tree,'Hide').props.onClick();tree=one.tree();assert(!nodes(tree).some(n=>n.props?.className==='research-technical-full'));assert(button(tree,'Show full request and response'));

 // A result from before requests were kept: built again from its settings, and said so; what was not recorded says so.
 const old=result({requestId:undefined,modelReported:undefined,stopReason:undefined,output:undefined,rawResponse:'{"explanation":"Because.","score":"4"}',usage:undefined,responseId:undefined,runNo:1});
 const older=mount(Technical,{row:{...row,...old},of:old,run:1,study});tree=older.tree();
 assert.deepEqual(fields(tree),{'Model (requested)':model,'Model (reported)':'not recorded','Stop reason':'not recorded','Tokens in / out':'— / —','Cache read / write':'— / —','Response ID':'—','Run':'#1 · instant · prompt v1'});
 assert.equal(text(nodes(nodes(tree).find(n=>n.props?.className==='research-technical-part')).find(n=>n.type==='pre')),'{"explanation":"Because.","score":"4"}','The reply kept with an older result');
 button(tree,'Show full request and response').props.onClick();await settle();tree=older.tree();
 assert.match(JSON.parse(text(nodes(tree).find(n=>n.type==='pre'&&nodes(tree).indexOf(n)>nodes(tree).findIndex(x=>x.props?.className==='research-technical-full')))).recorded,/^built again from the result’s settings/);
 // A failed request: no reply to show; a batch names its batch.
 const failed=result({status:'error',error:'OpenAI reported a server error. (HTTP 500.)',score:undefined,explanation:undefined,output:undefined,modelReported:undefined,stopReason:undefined,usage:undefined,responseId:undefined,processing:'batch',batchId:'batch_9'});
 const broken=mount(Technical,{row:{...row,...failed},of:failed,run:2,study});tree=broken.tree();
 assert(!nodes(tree).some(n=>n.props?.className==='research-technical-part'));assert.equal(fields(tree)['Batch ID'],'batch_9');assert.equal(fields(tree).Run,'#2 · batch · prompt v2');
 button(tree,'Show full request and response').props.onClick();await settle();tree=broken.tree();
 const failedResponse=JSON.parse(nodes(nodes(tree).find(n=>n.props?.className==='research-technical-full')).filter(n=>n.type==='pre').map(text)[1]);
 assert.deepEqual([failedResponse.status,failedResponse.error,failedResponse.response_text,failedResponse.batch_id],['error','OpenAI reported a server error. (HTTP 500.)',null,'batch_9']);
 // A PDF goes out as a file: a note stands in place of its data.
 const pdfKept=records.recordRequest(kept.list,frames.requestFrame(settings,true)),pdfFile=new File([new Uint8Array(2048)],'report.pdf'),pdfResult=result({requestId:pdfKept.id});
 const pdf=mount(Technical,{row:{id:'p',name:'report.pdf',file:pdfFile,...pdfResult},of:pdfResult,run:2,study:{...study,requests:pdfKept.list}});
 button(pdf.tree(),'Show full request and response').props.onClick();await settle();
 const pdfText=text(nodes(nodes(pdf.tree()).find(n=>n.props?.className==='research-technical-full')).filter(n=>n.type==='pre')[0]);
 assert(pdfText.includes('[PDF file: report.pdf, 2,048 bytes; sent as a file, and not shown here]'));assert(!pdfText.includes('<<FILE_BASE64>>'));
 // A subject of Model knowledge: its request holds the subject's fields.
 const kSettings={...settings,knowledge:true,webSearch:false},kKept=records.recordRequest(undefined,frames.requestFrame(kSettings,false)),kResult=result({requestId:kKept.id,webSearch:false}),subject={id:'s',name:'Jaws',fields:[{heading:'Film',value:'Jaws'}],runNumber:1,...kResult};
 const knowledge=mount(Technical,{row:subject,of:kResult,run:1,study:{kind:'knowledge',requests:kKept.list,versions:new Map([[1,1]])}});
 button(knowledge.tree(),'Show full request and response').props.onClick();await settle();
 const kText=text(nodes(nodes(knowledge.tree()).find(n=>n.props?.className==='research-technical-full')).filter(n=>n.type==='pre')[0]);
 assert(kText.includes('Film: Jaws')||kText.includes('Jaws'),'The subject is in the request');assert(kText.includes('"recorded": "kept when the request was sent"'));
 // A text that cannot be read: the request's address is still shown, with a note.
 const gone=mount(Technical,{row:{...row,file:undefined},of:row,run:2,study});
 button(gone.tree(),'Show full request and response').props.onClick();await settle();
 const goneRequest=JSON.parse(text(nodes(nodes(gone.tree()).find(n=>n.props?.className==='research-technical-full')).filter(n=>n.type==='pre')[0]));
 assert.equal(goneRequest.request,null);assert.match(goneRequest.note,/could not be read/);
 // Nothing was sent for a text without a result.
 assert.equal(mount(Technical,{row:{id:'w',name:'w.txt',status:'pending'},of:{id:'w',name:'w.txt',status:'pending'},study}).tree(),null);
 // A very long reply is shown in part.
 const long=result({output:'x'.repeat(200500)}),longTree=mount(Technical,{row:{...row,...long},of:long,run:2,study}).tree();
 const longText=text(nodes(nodes(longTree).find(n=>n.props?.className==='research-technical-part')).find(n=>n.type==='pre'));
 assert(longText.startsWith('x'.repeat(200000)+'\n\n[500 more characters are not shown here.'));

 // --- In the details of a text --------------------------------------------------------------
 const detail=props=>{current=instance();return ResearchDetail(props);};
 const blocks=tree=>nodes(tree).filter(n=>n.type===Technical).map(n=>[n.props.run,n.props.label,n.props.of.responseId,n.props.row.id,n.key??n.props.key]);
 // One annotation: the text's own request.
 assert.deepEqual(blocks(detail({row,columns:[],study})).map(b=>b.slice(0,4)),[[2,undefined,'resp_1','a']]);
 // Without a study (as before), and for a text waiting or under way: none.
 assert.equal(detail({row,columns:[]}),null);
 assert.equal(detail({row:{id:'w',name:'w.txt',status:'pending'},columns:[],study}),null);
 assert.equal(detail({row:{...row,status:'running'},columns:[],study}),null);
 // Several annotations: one block in each annotation's entry; an earlier result made of several names each.
 const annotations=[1,2,3].map(n=>({n,status:n===2?'error':'done',...(n===2?{error:'Failed.'}:{score:'4',explanation:'Because.'}),responseId:'resp_'+n,requestId:kept.id,usage,time:'2026-11-16T07:00:0'+n+'.000Z'}));
 const several={...row,repeats:3,annotations,responseId:undefined,usage:undefined,earlier:[{...result({runNo:1,responseId:'resp_old'}),status:'done'},{...result({runNo:1,responseId:undefined}),status:'done',repeats:2,annotations:annotations.slice(0,2).map(a=>({...a,responseId:'old_'+a.n}))}]};
 assert.deepEqual(blocks(detail({row:several,columns:[],study})).map(b=>b.slice(0,3)),[[2,undefined,'resp_1'],[2,undefined,'resp_2'],[2,undefined,'resp_3'],[1,'annotation 1','old_1'],[1,'annotation 2','old_2'],[1,undefined,'resp_old']]);
 // A block's details belong to one request: its place is named by text, run, and annotation, so another text starts closed.
 const keys=tree=>nodes(tree).filter(n=>n.type===Technical).map(n=>n.props.key??n.key);
 // A subject of Model knowledge keeps its run as runNumber.
 assert.deepEqual(blocks(detail({row:{...subject,runNo:undefined},columns:[],study:{kind:'knowledge',requests:kKept.list}})).map(b=>b[0]),[1]);
 void keys;

 // --- Previous and Next ---------------------------------------------------------------------
 const {DetailSteps,stepKey}=wrappers,stepped=[];
 const steps=(index,total)=>{current=instance();return DetailSteps({index,total,onStep:to=>stepped.push(to)});};
 assert.equal(steps(-1,6),null,'A text that is not among those shown has no steps');assert.equal(steps(0,1),null);
 tree=steps(2,6);assert.equal(text(tree),'Previous3 of 6Next');assert.deepEqual(nodes(tree).filter(n=>n.type==='button').map(n=>[text(n),n.props['aria-disabled'],n.props.title]),[['Previous',false,'Previous (K)'],['Next',false,'Next (J)']]);
 button(tree,'Next').props.onClick();button(tree,'Previous').props.onClick();assert.deepEqual(stepped.splice(0),[3,1]);
 // At either end the button stays (and keeps the focus) and does nothing.
 tree=steps(0,6);assert.equal(button(tree,'Previous').props['aria-disabled'],true);assert(!('disabled' in button(tree,'Previous').props));button(tree,'Previous').props.onClick();assert.deepEqual(stepped,[]);
 tree=steps(5,6);assert.equal(button(tree,'Next').props['aria-disabled'],true);button(tree,'Next').props.onClick();assert.deepEqual(stepped,[]);
 assert.equal(text(steps(1233,2400)),'Previous1,234 of 2,400Next');
 // J and K step while the details or one of their buttons have the focus; never from a box one types in.
 const region={},press=(key,target=region,extra={})=>stepKey({key,target,currentTarget:region,...extra},2,6,to=>stepped.push(to));
 press('j');press('k');press('J');press('K');assert.deepEqual(stepped.splice(0),[3,1,3,1]);
 press('j',{tagName:'BUTTON'});assert.deepEqual(stepped.splice(0),[3]);
 for(const tagName of ['INPUT','TEXTAREA','SELECT','PRE','SUMMARY'])press('j',{tagName});
 press('j',region,{ctrlKey:true});press('j',region,{metaKey:true});press('j',region,{altKey:true});press('x');press('ArrowDown');assert.deepEqual(stepped,[]);
 stepKey({key:'k',target:region,currentTarget:region},0,6,to=>stepped.push(to));stepKey({key:'j',target:region,currentTarget:region},5,6,to=>stepped.push(to));stepKey({key:'j',target:region,currentTarget:region},-1,6,to=>stepped.push(to));assert.deepEqual(stepped,[]);

 // --- Where it is --------------------------------------------------------------------------
 const page=fs.readFileSync(path.join(root,'app/page.tsx'),'utf8'),knowledgePage=fs.readFileSync(path.join(root,'components/model-knowledge.tsx'),'utf8');
 // Research mode only, in both workspaces; Previous and Next step through the rows the filters leave.
 assert(page.includes("{research&&<DetailSteps index={currentAt} total={rows.length} onStep={stepTo}/>}"));assert(page.includes("{research&&<ResearchDetail row={current} columns={columns} study={{kind:'texts',requests,versions:promptVersions}}/>}"));
 assert(knowledgePage.includes("{research&&<DetailSteps index={currentAt} total={rows.length} onStep={stepTo}/>}"));assert(knowledgePage.includes("{research&&<ResearchDetail row={current} columns={columns} study={{kind:'knowledge',requests,versions:promptVersions}}/>}"));
 // The export's logs and the details are written by the same code.
 const packages=fs.readFileSync(path.join(root,'lib/research/export-packages.ts'),'utf8');
 assert(packages.includes('requests.push({...head,...requestRecord(sent,doc,result,pdf)});')&&packages.includes('responses.push({...head,...responseRecord(result)});'));

 console.log('Text details: technical details per request, the full request and response as the logs hold them, and Previous / Next.');
})().catch(error=>{console.error(error);process.exit(1);});
