import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readySnapshot} from '../server/briefing-input.mjs';
import {recipientDeliveryReadiness} from '../server/delivery-readiness.mjs';
import {CANONICAL_SOURCE,syntheticPrepare} from '../server/domain.mjs';
import {withMultipleChoice} from '../server/multiple-choice.mjs';

const prepared=withMultipleChoice(syntheticPrepare(CANONICAL_SOURCE));
const briefing={state:'ready',source:CANONICAL_SOURCE,prepared_json:prepared};
const workers=[{language:'ru'},{language:'ar'}];

test('a prepared bundle whose fields keep the target script publishes',()=>{
  const snapshot=readySnapshot(briefing,workers,'synthetic');
  assert.equal(snapshot.languages.ru.text,prepared.languages.ru.text);
});

test('a prepared field in another script is rejected before publication',()=>{
  for(const change of [
    content=>{content.languages.ru.text=content.languages.ar.text;},
    content=>{content.languages.ru.question=content.languages.ar.question;},
    content=>{content.languages.ru.choices[0].text=content.languages.ar.choices[0].text;},
  ]){
    const content=structuredClone(prepared);
    change(content);
    assert.throws(()=>readySnapshot({...briefing,prepared_json:content},workers,'synthetic'),/Prepared content language mismatch: ru/);
  }
});

test('the served document opts out of browser translation',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<html lang="en" translate="no">/);
  assert.match(html,/<meta name="google" content="notranslate"\s*\/>/);
});

test('delivery refuses a recipient bundle in another script, including late releases',()=>{
  assert.deepEqual(recipientDeliveryReadiness(prepared,{language:'ru'},{responseMode:'question',deliveryMode:'both'}),
    {delivery:true,reason:null,language:'ru'});
  for(const change of [
    content=>{content.languages.ru.text=content.languages.ar.text;},
    content=>{content.languages.ru.question=content.languages.ar.question;},
    content=>{content.languages.ru.choices[0].text=content.languages.ar.choices[0].text;},
  ]){
    const content=structuredClone(prepared);
    change(content);
    assert.deepEqual(recipientDeliveryReadiness(content,{language:'ru'},{responseMode:'question',deliveryMode:'both'}),
      {delivery:false,reason:'language_unavailable',language:'ru'});
  }
});
