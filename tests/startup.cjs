// Returning studies should not deserialize files twice before becoming usable.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ts = require('../node_modules/typescript');
const {indexedDB, IDBObjectStore} = require('fake-indexeddb');
global.indexedDB = indexedDB;
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports', 'require', code)(exports, id => id.startsWith('.') ? load(path.join(path.dirname(file), id) + '.ts') : require(id));
  return exports;
}
(async () => {
  const studies = load('lib/studies.ts'), {createWorkspaceStorage} = load('lib/workspace-storage.ts');
  await studies.studySnapshot('initialize');
  const storage = createWorkspaceStorage(studies.studyWorkspaceKey(studies.WORKING_STUDY_ID));
  await storage.restore();
  const document = {id: 'kept', name: 'source.txt', status: 'done', score: '2', explanation: 'Evidence', file: new Blob(['Original document'])};
  await storage.save({docs: [document], prompt: 'Preserve this prompt'});
  const get = IDBObjectStore.prototype.get, reads = [];
  IDBObjectStore.prototype.get = function(key) { reads.push(key); return get.call(this, key); };
  const result = await studies.studySnapshot('initialize');
  IDBObjectStore.prototype.get = get;
  assert.equal(result.working.name, 'Untitled working copy');
  assert.deepEqual(reads.sort(), ['named-studies-v1', 'working-copy-meta-v2']);
  const restored = await storage.restore();
  assert.equal(restored.prompt, 'Preserve this prompt');
  assert.equal(restored.docs[0].score, '2');
  assert.equal(await restored.docs[0].file.text(), 'Original document');
  console.log('PASS: returning-study initialization reads only metadata; documents, prompts, scores, and revisions remain intact.');
})().catch(error => { console.error(error); process.exitCode = 1; });
