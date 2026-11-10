import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeepLTranslateAdapter,DEEPL_TRANSLATE_LANGUAGES} from '../server/ai/deepl-translate.mjs';

const english={title:'Carton routing',text:'Place 2 cartons on the blue shelf before 4 pm. Keep the walkway clear.',
  question:'Where do the 2 cartons go before 4 pm, and what must stay clear?',
  answerChoices:['on the blue shelf','on the yellow shelf','on the red shelf','on the green shelf']};
const hindi={title:'कार्टन वितरण',text:'नीली शेल्फ़ पर 4 बजे से पहले दो कार्टन रखें। रास्ता साफ़ रखें।',
  question:'दो कार्टन 4 बजे से पहले कहाँ रखने हैं, और रास्ता कैसा रखना है?',
  answerChoices:['नीली शेल्फ़ पर','पीली शेल्फ़ पर','लाल शेल्फ़ पर','हरी शेल्फ़ पर']};
const russian={title:'Маршрутизация коробок',text:'Перед 16:00 разместите 2 коробки на синей полке. Не заставляйте проход.',
  question:'Куда нужно поставить 2 коробки до 16:00 и что должно оставаться свободным?',
  answerChoices:['на синей полке','на жёлтой полке','на красной полке','на зелёной полке']};
const values=value=>[value.title,value.text,value.question,...value.answerChoices];
const deeplReply=texts=>Response.json({translations:texts.map(text=>({detected_source_language:'EN',text}))});
const fetcher=handler=>{const calls=[];return {calls,fetch:async(url,options)=>{const body=JSON.parse(options.body);
  calls.push({url,body,headers:options.headers});return handler(body,calls.length);}};};

test('DeepL is an explicit key-only client for the supported worker languages',()=>{
  for(const options of [{},{apiKey:' '},{apiKey:'key\nvalue'},{apiKey:'key',timeoutMs:500},{apiKey:'key',timeoutMs:40000}])
    assert.throws(()=>createDeepLTranslateAdapter(options),/credentials|timeout/);
  assert.ok(DEEPL_TRANSLATE_LANGUAGES.includes('fil'));
  assert.ok(DEEPL_TRANSLATE_LANGUAGES.includes('pa-Guru'));
  assert.ok(!DEEPL_TRANSLATE_LANGUAGES.includes('pa-Arab'));
  assert.ok(!DEEPL_TRANSLATE_LANGUAGES.includes('si'));
});

test('DeepL sends every instruction segment in one ordered free-tier request',async()=>{
  const mock=fetcher(()=>deeplReply(values(hindi)));
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:mock.fetch});
  assert.deepEqual(await adapter.translate(english,'hi'),hindi);
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].url,'https://api-free.deepl.com/v2/translate');
  assert.equal(mock.calls[0].headers.authorization,'DeepL-Auth-Key test-only:fx');
  assert.deepEqual(mock.calls[0].body,{text:values(english),source_lang:'EN',target_lang:'HI'});
});

test('DeepL normalizes a non-English source to English with detected source language',async()=>{
  const arabic={title:'توجيه الكراتين',text:'ضع كرتين على الرف الأزرق قبل الساعة 4 مساءً. أبقِ الممر خالياً.'};
  const mock=fetcher(()=>Response.json({translations:[
    {detected_source_language:'AR',text:english.title},
    {detected_source_language:'AR',text:english.text},
  ]}));
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:mock.fetch});
  assert.deepEqual(await adapter.translateToEnglish(arabic),{title:english.title,text:english.text});
  assert.equal(mock.calls.length,1);
  assert.deepEqual(mock.calls[0].body,{text:[arabic.title,arabic.text],target_lang:'EN-GB'});
});

test('DeepL rejects a source normalization that does not return English',async()=>{
  const arabic={title:'توجيه الكراتين',text:'ضع كرتين على الرف الأزرق قبل الساعة 4 مساءً.'};
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:fetcher(()=>Response.json({translations:[
    {detected_source_language:'AR',text:arabic.title},{detected_source_language:'AR',text:arabic.text},
  ]})).fetch});
  await assert.rejects(()=>adapter.translateToEnglish(arabic),/invalid title translation/);
  await assert.rejects(()=>adapter.translateToEnglish({title:english.title,text:''}),/Invalid translation input/);
});

test('DeepL selects the pro endpoint for a pro key',async()=>{
  const mock=fetcher(()=>deeplReply(values(hindi)));
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only-pro-key',fetchImpl:mock.fetch});
  await adapter.translate(english,'hi');
  assert.equal(mock.calls[0].url,'https://api.deepl.com/v2/translate');
});

test('DeepL accepts localized number words and 24-hour times',async()=>{
  const hindiMock=fetcher(()=>deeplReply(values(hindi)));
  assert.deepEqual(await createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:hindiMock.fetch})
    .translate(english,'hi'),hindi);
  const russianMock=fetcher(()=>deeplReply(values(russian)));
  assert.deepEqual(await createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:russianMock.fetch})
    .translate(english,'ru'),russian);
});

test('DeepL rejects drifted scripts, choices and unsupported languages',async()=>{
  const cases=[
    {texts:[hindi.title,english.text,hindi.question,...hindi.answerChoices],reason:/invalid text translation/},
    {texts:[hindi.title,hindi.text,'',...hindi.answerChoices],reason:/invalid question translation/},
    {texts:[hindi.title,hindi.text,hindi.question,...hindi.answerChoices.slice(0,3)],reason:/malformed/},
    {texts:[hindi.title,hindi.text,hindi.question,hindi.answerChoices[0],hindi.answerChoices[1],'on the red shelf',hindi.answerChoices[3]],reason:/changed the answer choices/},
  ];
  for(const {texts,reason} of cases){
    const adapter=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:fetcher(()=>deeplReply(texts)).fetch});
    await assert.rejects(()=>adapter.translate(english,'hi'),reason);
  }
  const adapter=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:async()=>assert.fail('No request')});
  await assert.rejects(()=>adapter.translate(english,'pa-Arab'),/does not support pa-Arab/);
  await assert.rejects(()=>adapter.translate(english,'si'),/does not support si/);
});

test('DeepL rejects provider failures and malformed responses',async()=>{
  const failing=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:async()=>new Response('denied',{status:403})});
  await assert.rejects(()=>failing.translate(english,'hi'),/request failed \(403\)/);
  const malformed=createDeepLTranslateAdapter({apiKey:'test-only:fx',fetchImpl:async()=>Response.json({translations:[{text:'only one'}]})}) ;
  await assert.rejects(()=>malformed.translate(english,'hi'),/malformed/);
});
