import test from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleTranslateAdapter,GOOGLE_TRANSLATE_LANGUAGES} from '../server/ai/google-translate.mjs';

const english={title:'Carton routing',text:'Place 2 cartons on the blue shelf before 4 pm. Keep the walkway clear.',
  question:'Where do the 2 cartons go before 4 pm, and what must stay clear?',
  answerChoices:['on the blue shelf','on the yellow shelf','on the red shelf','on the green shelf']};
const hindi={title:'कार्टन वितरण',text:'नीली शेल्फ़ पर 4 बजे से पहले 2 कार्टन रखें। रास्ता साफ़ रखें।',
  question:'2 कार्टन 4 बजे से पहले कहाँ रखने हैं, और रास्ता कैसा रखना है?',
  answerChoices:['नीली शेल्फ़ पर','पीली शेल्फ़ पर','लाल शेल्फ़ पर','हरी शेल्फ़ पर']};
const values=value=>[value.title,value.text,value.question,...value.answerChoices];
const googleReply=texts=>Response.json({data:{translations:texts.map(translatedText=>({translatedText}))}});
const fetcher=handler=>{const calls=[];return {calls,fetch:async(url,options)=>{const body=JSON.parse(options.body);
  calls.push({url,body,headers:options.headers});return handler(body,calls.length);}};};

test('Google Translate is an explicit key-only client for the supported worker languages',()=>{
  for(const options of [{},{apiKey:' '},{apiKey:'key\nvalue'},{apiKey:'key',timeoutMs:500},{apiKey:'key',timeoutMs:40000}])
    assert.throws(()=>createGoogleTranslateAdapter(options),/credentials|timeout/);
  assert.ok(GOOGLE_TRANSLATE_LANGUAGES.includes('fil'));
  assert.ok(GOOGLE_TRANSLATE_LANGUAGES.includes('pa-Guru'));
  assert.ok(!GOOGLE_TRANSLATE_LANGUAGES.includes('pa-Arab'));
});

test('Google Translate sends every instruction segment in one ordered request',async()=>{
  const mock=fetcher(()=>googleReply(values(hindi)));
  const adapter=createGoogleTranslateAdapter({apiKey:'test-only-google-key',fetchImpl:mock.fetch});
  assert.deepEqual(await adapter.translate(english,'hi'),hindi);
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].url,'https://translation.googleapis.com/language/translate/v2');
  assert.equal(mock.calls[0].headers['x-goog-api-key'],'test-only-google-key');
  assert.deepEqual(mock.calls[0].body,{q:values(english),source:'en',target:'hi',format:'text'});
});

test('Google Translate decodes escaped output and preserves worker-language text',async()=>{
  const escaped={...hindi,title:'कार्टन &#39;वितरण&#39;'};
  const mock=fetcher(()=>googleReply(values(escaped)));
  const adapter=createGoogleTranslateAdapter({apiKey:'test-only-google-key',fetchImpl:mock.fetch});
  assert.equal((await adapter.translate(english,'hi')).title,"कार्टन 'वितरण'");
});

test('Google Translate rejects drifted numbers, scripts, choices and unsupported languages',async()=>{
  const cases=[
    {texts:[hindi.title,hindi.text.replace('2','5'),hindi.question,...hindi.answerChoices],reason:/invalid text translation/},
    {texts:[hindi.title,english.text,hindi.question,...hindi.answerChoices],reason:/invalid text translation/},
    {texts:[hindi.title,hindi.text,'',...hindi.answerChoices],reason:/invalid question translation/},
    {texts:[hindi.title,hindi.text,hindi.question,...hindi.answerChoices.slice(0,3)],reason:/malformed/},
    {texts:[hindi.title,hindi.text,hindi.question,hindi.answerChoices[0],hindi.answerChoices[1],hindi.answerChoices[2].replace('पर','पर 9'),hindi.answerChoices[3]],reason:/changed the answer choices/},
  ];
  for(const {texts,reason} of cases){
    const adapter=createGoogleTranslateAdapter({apiKey:'test-only-google-key',fetchImpl:fetcher(()=>googleReply(texts)).fetch});
    await assert.rejects(()=>adapter.translate(english,'hi'),reason);
  }
  const adapter=createGoogleTranslateAdapter({apiKey:'test-only-google-key',fetchImpl:async()=>assert.fail('No request')});
  await assert.rejects(()=>adapter.translate(english,'pa-Arab'),/does not support pa-Arab/);
});

test('Google Translate rejects provider failures and malformed responses',async()=>{
  const failing=createGoogleTranslateAdapter({apiKey:'test-only-google-key',fetchImpl:async()=>new Response('denied',{status:403})});
  await assert.rejects(()=>failing.translate(english,'hi'),/request failed \(403\)/);
  const malformed=createGoogleTranslateAdapter({apiKey:'test-only-google-key',fetchImpl:async()=>Response.json({data:{translations:[{translatedText:'only one'}]}})}) ;
  await assert.rejects(()=>malformed.translate(english,'hi'),/malformed/);
});
