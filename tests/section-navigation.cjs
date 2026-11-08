const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('../node_modules/typescript');
let frame,observer,found,focused=0,scrolled=0,disconnected=0;
global.document={body:{},getElementById:id=>id==='data-handling'?found:null};
global.requestAnimationFrame=callback=>{frame=callback;return 1;};
global.cancelAnimationFrame=()=>{frame=undefined;};
global.MutationObserver=class{constructor(callback){observer=callback;}observe(){}disconnect(){disconnected++;}};
const exportsObject={};new Function('exports',ts.transpileModule(fs.readFileSync('lib/section-navigation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(exportsObject);
const heading={focus(){focused++;},scrollIntoView(options){assert.equal(options.block,'start');scrolled++;}};
const cancel=exportsObject.focusSectionWhenReady('data-handling');frame();assert.equal(focused,0);
found=heading;observer();assert.equal(focused,1);assert.equal(scrolled,1);assert.equal(disconnected,1);cancel();
// Immediate anchors need no observer, and leaving a pending section cancels its work.
observer=undefined;exportsObject.focusSectionWhenReady('data-handling');frame();assert.equal(focused,2);assert.equal(observer,undefined);
found=undefined;const leave=exportsObject.focusSectionWhenReady('data-handling');leave();assert.equal(frame,undefined);
console.log('PASS: direct links wait for deferred content, existing anchors focus immediately, and navigation cancels pending work.');
