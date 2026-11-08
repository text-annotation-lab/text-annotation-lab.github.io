import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDocumentUploads} from '../lib/document-uploads.ts';

test('keeps different texts even with identical names and byte lengths', async () => {
  const first = new File(['cat'], 'source.txt');
  const second = new File(['dog'], 'source.txt');
  assert.equal(first.size, second.size);
  const result = await prepareDocumentUploads([second], [{file: first}]);
  assert.deepEqual(result.accepted, [second]);
  assert.equal(result.duplicates, 0);
  assert.equal(result.matchingNames, 1);
});

test('counts identical files in an upload and against the saved queue', async () => {
  const first = new File(['same text'], 'source.txt');
  const copy = new File(['same text'], 'source.txt', {lastModified: 1});
  const result = await prepareDocumentUploads([first, copy], []);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal((await prepareDocumentUploads([copy], [{file:first}])).duplicates, 1);
});

test('recognizes the original document retained by its chunks', async () => {
  const source = new File(['one two three'], 'original.txt');
  const chunk = new File(['one two'], 'chunk.txt');
  const copy = new File(['one two three'], 'original.txt');
  const result = await prepareDocumentUploads([copy], [{file:chunk, sourceFile:source}]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.accepted.length, 0);
});

test('uses bytes, including for PDF candidates, and preserves different filenames', async () => {
  const original = new File([new Uint8Array([0, 255, 5])], 'source.pdf');
  const changed = new File([new Uint8Array([0, 255, 6])], 'source.pdf');
  const renamed = new File([new Uint8Array([0, 255, 5])], 'another.pdf');
  const result = await prepareDocumentUploads([changed, renamed], [{file:original}]);
  assert.equal(result.accepted.length, 2);
});

test('accounts for unsupported and empty inputs', async () => {
  const result = await prepareDocumentUploads([new File([], 'empty.txt'), new File(['x'], 'image.png'), new File(['ok'], 'valid.md')], []);
  assert.equal(result.rejected, 2);
  assert.equal(result.accepted.length, 1);
});

test('reports unreadable duplicate candidates without changing the queue', async () => {
  const original = new File(['abc'], 'source.txt');
  const unreadable = new File(['def'], 'source.txt');
  unreadable.arrayBuffer = async () => {throw new Error('unreadable');};
  const queue = [{file: original}];
  const result = await prepareDocumentUploads([unreadable], queue);
  assert.equal(result.unreadable, 1);
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(queue, [{file: original}]);
});
