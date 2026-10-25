import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingNotice} from '../src/recording-notice.ts';
import {WORKER_LOCALES} from '../server/languages.mjs';
import {assertWorkerDictionary} from './helpers/worker-locales.mjs';

test('recording notice localizes every privacy statement for every worker UI language and distinguishes synthetic from configured AI',()=>{
  const dictionary=Object.fromEntries(WORKER_LOCALES.map(({code})=>[code,recordingNotice(code,true)]));
  assertWorkerDictionary(dictionary,'recordingNotice');
  for(const {code} of WORKER_LOCALES){
    const synthetic=dictionary[code],configured=recordingNotice(code,false);
    assert.deepEqual(Object.keys(synthetic),['title','local','access','processing','retention']);
    for(const field of ['title','local','access','retention'])assert.equal(synthetic[field],configured[field]);
    assert.notEqual(synthetic.processing,configured.processing);
    assert.doesNotMatch(Object.values(synthetic).join(' '),/\b(?:30|90) days\b|GDPR compliant|legally consented/);
  }
  assert.equal(new Set(Object.values(dictionary).map(value=>value.local)).size,WORKER_LOCALES.length);
  const english=dictionary.en;
  assert.match(english.local,/Leaving or reloading can lose an unsaved preview/);
  assert.match(english.local,/unless you explicitly save a copy/);
  assert.match(english.local,/Saving does not send it; sending requires a separate action/);
  assert.match(english.processing,/not sent to a live AI provider/);
  assert.match(english.retention,/does not erase old backups/);
});
