// The build of the Lab that is running: its publish date and commit. Research mode records it on every
// result, so an export can say which version of the Lab made a request.
declare const __BUILD_DATE__:string|undefined,__BUILD_COMMIT__:string|undefined;
export const LAB_VERSION=typeof __BUILD_DATE__==='string'?[__BUILD_DATE__,typeof __BUILD_COMMIT__==='string'?__BUILD_COMMIT__:''].filter(Boolean).join(' '):'development';
