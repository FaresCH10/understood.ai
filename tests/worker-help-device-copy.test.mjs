import test from 'node:test';
import assert from 'node:assert/strict';
import {workerHelpCopy,workerDeviceCopy,workerHelpReasonText} from '../src/worker-help-device-copy.ts';
import {assertWorkerDictionary,workerLocaleCodes} from './helpers/worker-locales.mjs';

test('worker Help and Device additions cover every selectable language in its own script',()=>{
  assertWorkerDictionary(workerHelpCopy,'workerHelpCopy');
  assertWorkerDictionary(workerDeviceCopy,'workerDeviceCopy');
});
test('Help reasons prefill an editable message only when a specific reason was selected',()=>{
  for(const code of workerLocaleCodes){
    assert.equal(workerHelpReasonText(code,null),undefined);
    assert.equal(workerHelpReasonText(code,'other'),undefined);
    for(const reason of ['unclear','equipment','problem'])assert.equal(workerHelpReasonText(code,reason),workerHelpCopy[code][reason]);
  }
});
