import test from 'node:test';
import assert from 'node:assert/strict';
import {instructionCoverage,syntheticInstructionLanguages} from '../server/instruction-coverage.mjs';
import {CANONICAL_SOURCE} from '../server/domain.mjs';
import {WORKER_LANGUAGE_CODES} from '../server/languages.mjs';
const workers=(...languages)=>languages.map((language,index)=>({id:`w${index}`,language}));
const pipeline=(text=['en'],speech=['en'],dataClass='synthetic')=>({dataClass,stages:[
  {id:'translation',configuration:'configured',declaredLanguages:text},
  {id:'speech',configuration:'configured',declaredLanguages:speech}
]});

test('synthetic fixture covers every worker locale for the seeded example and English only for other text',()=>{
  assert.deepEqual(syntheticInstructionLanguages(CANONICAL_SOURCE),WORKER_LANGUAGE_CODES);
  assert.deepEqual(syntheticInstructionLanguages(`  ${CANONICAL_SOURCE}  `),WORKER_LANGUAGE_CODES);
  assert.deepEqual(syntheticInstructionLanguages('Close the north gate before the night shift starts.'),['en']);
});

test('coverage counts each recipient language and marks fixture gaps before send',()=>{
  const coverage=instructionCoverage({workers:workers('en','en','ar'),source:'Inspect the west pump before the shift.'});
  assert.equal(coverage.total,3);
  assert.equal(coverage.ready,2);
  assert.equal(coverage.preparation,'synthetic-fixture');
  assert.deepEqual(coverage.languages,[
    {language:'ar',workers:1,ready:false,reason:'language_unavailable'},
    {language:'en',workers:2,ready:true,reason:null},
  ]);
  assert.deepEqual(coverage.missing,[{language:'ar',workers:1,ready:false,reason:'language_unavailable'}]);
  const canonical=instructionCoverage({workers:workers('en','ar','ur'),source:CANONICAL_SOURCE,deliveryMode:'voice'});
  assert.equal(canonical.ready,3);
  assert.deepEqual(canonical.missing,[]);
});

test('coverage mirrors configured pipeline text and speech declarations for voice delivery',()=>{
  const voice=instructionCoverage({workers:workers('en','ar','ur'),source:CANONICAL_SOURCE,deliveryMode:'voice',
    pipeline:pipeline(['en','ar'],['en'])});
  assert.equal(voice.preparation,'synthetic-provider');
  assert.deepEqual(voice.languages,[
    {language:'ar',workers:1,ready:false,reason:'speech_unavailable'},
    {language:'en',workers:1,ready:true,reason:null},
    {language:'ur',workers:1,ready:false,reason:'language_unavailable'},
  ]);
  const text=instructionCoverage({workers:workers('en','ar','ur'),source:CANONICAL_SOURCE,deliveryMode:'text',
    pipeline:pipeline(['en','ar'],['en'])});
  assert.equal(text.ready,2);
  assert.deepEqual(text.missing,[{language:'ur',workers:1,ready:false,reason:'language_unavailable'}]);
  const disabled=instructionCoverage({workers:workers('ar'),source:CANONICAL_SOURCE,deliveryMode:'voice',
    pipeline:{dataClass:'synthetic',stages:[{id:'translation',configuration:'configured',declaredLanguages:[]},{id:'speech',configuration:'disabled',declaredLanguages:[]}]}});
  assert.equal(disabled.ready,0);
  assert.equal(disabled.languages[0].reason,'language_unavailable');
});

test('coverage accepts an Arabic source when a translating provider is configured',()=>{
  const adapter={textLanguages:['en','hi','ru'],normalizesSource:true};
  const source='ضع الصندوق على الرف قبل الظهر.';
  const text=instructionCoverage({workers:workers('hi'),source,deliveryMode:'text',instructionTextAdapter:adapter});
  assert.equal(text.ready,1);
  assert.deepEqual(text.languages,[{language:'hi',workers:1,ready:true,reason:null}]);
  const voice=instructionCoverage({workers:workers('hi'),source,deliveryMode:'voice',instructionTextAdapter:adapter});
  assert.equal(voice.ready,0);
  assert.equal(voice.languages[0].reason,'speech_unavailable');
  const fixture=instructionCoverage({workers:workers('hi'),source,deliveryMode:'text'});
  assert.equal(fixture.languages[0].reason,'language_unavailable');
  const unnormalized=instructionCoverage({workers:workers('hi'),source,deliveryMode:'text',
    instructionTextAdapter:{textLanguages:['en','hi']}});
  assert.equal(unnormalized.languages[0].reason,'language_unavailable');
});

test('coverage refuses empty and oversized audiences',()=>{
  assert.throws(()=>instructionCoverage({workers:[],source:CANONICAL_SOURCE}),/audience is empty/);
  const many=Array.from({length:5001},(_,index)=>({id:`w${index}`,language:'en'}));
  assert.throws(()=>instructionCoverage({workers:many,source:CANONICAL_SOURCE}),/audience exceeds limit/);
});
