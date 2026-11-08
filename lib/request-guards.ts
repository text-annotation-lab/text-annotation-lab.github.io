// The former server routes now run in the visitor's browser (see local-api.ts).
// Browsers drop a script-set Origin header, so a missing Origin is the normal
// in-browser case; a different Origin is still refused.
export function allowedOrigin(request:Request){
 const origin=request.headers.get('origin');
 return !origin||origin===new URL(request.url).origin;
}

// Some browsers do not expose Request.body; read the body as a stream either way.
export async function requestBody(request:Request):Promise<ReadableStream<Uint8Array>|null>{
 return request.body??(await request.blob()).stream();
}
