// The Lab is hosted as static files. Requests the interface sends to its
// former server routes (/api/...) are handled here, in the visitor's browser,
// and go straight from the browser to the selected provider. API keys never
// pass through a Lab server.
type Handler={POST:(request:Request)=>Promise<Response>};
const routes:Record<string,()=>Promise<Handler>>={
 '/api/annotate':()=>import('@/app/api/annotate/route'),
 '/api/batch':()=>import('@/app/api/batch/route'),
 '/api/check-key':()=>import('@/app/api/check-key/route'),
 '/api/count-tokens':()=>import('@/app/api/count-tokens/route'),
 '/api/openrouter-balance':()=>import('@/app/api/openrouter-balance/route'),
};

export function installLocalApi(){
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=new URL(input instanceof Request?input.url:String(input),window.location.href);
  const load=url.origin===window.location.origin?routes[url.pathname]:undefined;
  if(!load)return nativeFetch(input,init);
  const {POST}=await load();
  return POST(new Request(url,input instanceof Request?input:init));
 };
}

// Load the request handlers ahead of use, for the same reason as the reading
// sections: a run started after a new publish must not need the old files.
export function preloadLocalApi(){for(const load of Object.values(routes))load().catch(()=>{});}
