// Save a text file from the browser.
export function downloadText(name:string,text:string,type:string){
 const url=URL.createObjectURL(new Blob([text],{type:type+';charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function downloadBytes(name:string,bytes:BlobPart,type:string){
 const url=URL.createObjectURL(new Blob([bytes],{type}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
