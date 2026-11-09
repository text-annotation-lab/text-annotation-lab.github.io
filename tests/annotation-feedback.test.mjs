import test from 'node:test';
import assert from 'node:assert/strict';
import {missingAnnotationSetup,remainingEstimateNotice,isPlainConfirmation} from '../lib/annotation-feedback.ts';
test('reports only missing setup fields for instant and batch annotation',()=>{
 assert.equal(missingAnnotationSetup('', 'Classify tone'), 'Add your API key first.');
 assert.equal(missingAnnotationSetup('key', ' '), 'Add your annotation prompt first.');
 assert.equal(missingAnnotationSetup(' ', ''), 'Add your API key and annotation prompt first.');
 assert.equal(missingAnnotationSetup('key', 'Classify tone'), undefined);
});
test('restored completed studies are distinguished from an empty or pending queue',()=>{
 const restored=JSON.parse(JSON.stringify([{status:'done'},{status:'done'}]));
 assert.match(remainingEstimateNotice(restored),/All annotations are complete/);
 assert.equal(remainingEstimateNotice([]),undefined);
 assert.equal(remainingEstimateNotice([...restored,{status:'pending'}]),undefined);
 assert.match(remainingEstimateNotice([{status:'running'}]),/in progress/);
 assert.match(remainingEstimateNotice([{status:'queued'},{status:'done'}]),/submitted as a batch/);
 assert.match(remainingEstimateNotice([{status:'done'},{status:'error'}]),/review their errors/);
});
test('only caveat-free confirmations are shown in the neutral color',()=>{
 assert.equal(isPlainConfirmation('12 documents added.'),true);
 assert.equal(isPlainConfirmation('1 document added.'),true);
 assert.equal(isPlainConfirmation('12 documents added. 2 invalid file(s): use nonempty PDF, DOCX, TXT, MD, HTML, or RTF up to 20 MB each.'),false);
 assert.equal(isPlainConfirmation('Stopped starting new annotations after an error.'),false);
});
