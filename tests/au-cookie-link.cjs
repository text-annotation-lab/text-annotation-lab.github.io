// The Lab's footer offers AU's cookie preferences only when the Lab is embedded on the ASCA page
// (components/au-cookie-link.tsx), where the Lab covers AU's own cookie link.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ts=require('../node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(process.cwd(),'components/au-cookie-link.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const mod={};new Function('exports','require',code)(mod,require);
const {embeddedInAsca,ASCA_ORIGIN,COOKIE_MESSAGE}=mod;
const framed=(ancestors,referrer='')=>{const win={location:{ancestorOrigins:ancestors},parent:{}};return embeddedInAsca(win,{referrer});};
const top={};top.parent=top;top.location={};
assert.equal(embeddedInAsca(top,{referrer:'https://asca.au.dk/'}),false,'not on its own address');
assert.equal(framed(['https://asca.au.dk']),true);
assert.equal(framed(['https://example.com'],'https://asca.au.dk/'),false,'the actual parent wins over the referrer');
assert.equal(framed(undefined,'https://asca.au.dk/'),true,'browsers without ancestorOrigins use the referrer');
assert.equal(framed(undefined,'https://example.com/'),false);
assert.equal(framed(undefined,''),false);
const embed=fs.readFileSync('docs/au-embed.html','utf8');
assert(embed.includes(`'${COOKIE_MESSAGE}'`),'the embed code must answer the footer link');
assert.equal(ASCA_ORIGIN,'https://asca.au.dk');
assert.match(fs.readFileSync('app/page.tsx','utf8'),/<footer>[^]*?<AuCookieLink\/>[^]*?<\/footer>/,'the footer shows the link');
console.log('PASS: the footer offers AU cookie preferences only inside the ASCA page, and the embed code answers it.');
