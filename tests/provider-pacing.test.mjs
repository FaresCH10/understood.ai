import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderPacer} from '../server/ai/provider-pacing.mjs';

test('metered handles share paced model slots while text and speech quotas stay independent',async()=>{
  let time=0;const waits=[];
  const pace=createProviderPacer({intervalMs:6000,now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;}});
  await pace('text');await pace('speech');assert.deepEqual(waits,[]);
  await pace('text');assert.deepEqual(waits,[6000]);
  await pace('speech');assert.deepEqual(waits,[6000]);
  time+=9000;await pace('text');assert.deepEqual(waits,[6000]);
  assert.throws(()=>createProviderPacer({intervalMs:-1}));
});

test('speech has an independent, slower request limit across metered handles',async()=>{
  let time=0;const waits=[];
  const pace=createProviderPacer({intervalMs:6000,intervals:{tts:20000},now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;}});
  await pace('tts');await pace('text');await pace('text');await pace('tts');
  assert.deepEqual(waits,[6000,14000]);
  assert.throws(()=>createProviderPacer({intervals:{tts:60001}}));
});
