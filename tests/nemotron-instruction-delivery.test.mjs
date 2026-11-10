import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../server/postgres/migrate.mjs';
import {startInstructionSend,completeInstructionSend} from '../server/postgres/instructions.mjs';
import {processOnePreparation} from '../server/postgres/preparation.mjs';
import {instructionReadiness} from '../server/instruction-readiness.mjs';
import {nemotronInstructionDelivery} from '../server/ai/nemotron-instruction-delivery.mjs';
import {NEMOTRON_DELIVERY_ADAPTER} from '../server/ai/instruction-text-providers.mjs';
import {DEEPL_TRANSLATE_ADAPTER,DEEPL_TRANSLATE_LANGUAGES} from '../server/ai/deepl-translate.mjs';
import {NEMOTRON_ULTRA_MODEL} from '../server/ai/nemotron.mjs';

const baseEnv={UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER:'nemotron',VERCEL_ENV:'production',NVIDIA_API_KEY:'test-only-nvidia-key',DEEPL_API_KEY:'test-only-deepl-key:fx'};
const source='Place 2 cartons on the blue shelf before 4 pm. Keep the walkway clear.';
const facts=['Place 2 cartons on the blue shelf before 4 pm.','Keep the walkway clear.'];
const question='Where do the 2 cartons go before 4 pm, and what must stay clear?';
const choices=['on the blue shelf','on the yellow shelf','on the red shelf','on the green shelf'];
const prepared={title:'Carton routing',facts,question,askedFacts:facts,choices};
const hindi={title:'कार्टन वितरण',text:'नीली शेल्फ़ पर 4 बजे से पहले 2 कार्टन रखें। रास्ता साफ़ रखें।',
  question:'2 कार्टन 4 बजे से पहले कहाँ रखने हैं, और रास्ता कैसा रखना है?',
  answerChoices:['नीली शेल्फ़ पर','पीली शेल्फ़ पर','लाल शेल्फ़ पर','हरी शेल्फ़ पर']};
const reply=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
const fetcher=handler=>{const calls=[];return {calls,fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body,headers:options.headers});return handler(body,calls.length,url);}};};
const deeplReply=texts=>Response.json({translations:texts.map(text=>({detected_source_language:'EN',text}))});
const hindiValues=[hindi.title,hindi.text,hindi.question,...hindi.answerChoices];
const english={title:'Carton routing',text:source,question,questionType:'multiple-choice',
  choices:choices.map((text,index)=>({id:`c${index}`,text}))};
const englishValues=[english.title,english.text,english.question,...choices];
async function resetBudget(adapter){
  // Acknowledgment preparation resets the per-send time budget without a provider call.
  await adapter.prepare({source,title:'Carton routing'},{response_mode:'acknowledge',delivery_mode:'text'});
}

test('Nemotron Vercel delivery is explicitly gated and advertises its provider mode',()=>{
  for(const patch of [{UNDERSTOOD_INSTRUCTION_TEXT_PROVIDER:'gemma4'},{VERCEL_ENV:'preview'},
    {UNDERSTOOD_TIER:'production'},{NVIDIA_API_KEY:' '},{DEEPL_API_KEY:' '}])
    assert.equal(nemotronInstructionDelivery({...baseEnv,...patch},async()=>assert.fail('No provider call')),null);
  const adapter=nemotronInstructionDelivery(baseEnv,async()=>assert.fail('No provider call'));
  assert.equal(adapter.mode,'nemotron-text');
  assert.equal(adapter.label,'Nemotron 3 Ultra 550B');
  assert.equal(adapter.translationLabel,'DeepL');
  assert.equal(adapter.translationAdapter,DEEPL_TRANSLATE_ADAPTER);
  assert.equal(adapter.provenanceAdapter,NEMOTRON_DELIVERY_ADAPTER);
  assert.equal(adapter.model,NEMOTRON_ULTRA_MODEL);
  assert.deepEqual(instructionReadiness({instructionTextAdapter:adapter},source),{mode:'nemotron-text',
    providerLabel:'Nemotron 3 Ultra 550B',translationProviderLabel:'DeepL',
    textLanguages:DEEPL_TRANSLATE_LANGUAGES,speechLanguages:['en']});
  assert.deepEqual(instructionReadiness({instructionTextAdapter:adapter},'ضع الصندوق على الرف'),{mode:'nemotron-text',
    providerLabel:'Nemotron 3 Ultra 550B',translationProviderLabel:'DeepL',
    textLanguages:DEEPL_TRANSLATE_LANGUAGES,speechLanguages:[]});
});

test('Nemotron prepares one grounded English question with four checked choices',async()=>{
  const mock=fetcher(()=>reply(prepared));
  const adapter=nemotronInstructionDelivery(baseEnv,mock.fetch);
  const value=await adapter.prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'});
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].url,'https://integrate.api.nvidia.com/v1/chat/completions');
  assert.equal(mock.calls[0].body.model,NEMOTRON_ULTRA_MODEL);
  assert.equal(mock.calls[0].body.chat_template_kwargs.enable_thinking,false);
  assert.equal(value.provenance.adapter,'synthetic-instruction-v1');
  assert.equal(value.provenance.live,false);
  assert.equal(value.question,question);
  assert.equal(value.languages.en.question,question);
  assert.equal(value.languages.en.text,source);
  assert.equal(value.rubric.mode,'multiple-choice');
  assert.equal(value.languages.en.choices.length,4);
  assert.ok(value.languages.en.choices.every(choice=>choices.includes(choice.text)));
  assert.equal(value.languages.en.choices.find(choice=>choice.id===value.rubric.correctChoiceId).text,choices[0]);
  assert.equal(await adapter.prepare({source,title:'Carton routing'},{response_mode:'acknowledge',delivery_mode:'text'}),null);
  assert.equal(mock.calls.length,1);

  const ungrounded=nemotronInstructionDelivery(baseEnv,fetcher(()=>reply({...prepared,
    facts:['Buy three red chairs.'],askedFacts:['Buy three red chairs.']})).fetch);
  assert.equal(await ungrounded.prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'}),null);
  const malformed=nemotronInstructionDelivery(baseEnv,fetcher(()=>reply({title:'Carton routing'})).fetch);
  assert.equal(await malformed.prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'}),null);
});

test('spelling corrections and paraphrased facts stay grounded while invented details are rejected',async()=>{
  const typoSource='make me a chiken shwarma sandwich with gralic and pickles';
  const corrected={title:'Chicken Shawarma Sandwich with Garlic and Pickles',
    facts:['User wants a chicken shawarma sandwich.','Sandwich must include garlic.','Sandwich must include pickles.'],
    question:'What three components does the user explicitly request for the sandwich?',
    askedFacts:['User wants a chicken shawarma sandwich.','Sandwich must include garlic.','Sandwich must include pickles.'],
    choices:['Chicken shawarma, garlic, and pickles','Chicken shawarma, garlic, and tomatoes','Beef shawarma, garlic, and pickles','Chicken shawarma, onions, and pickles']};
  const adapter=nemotronInstructionDelivery(baseEnv,fetcher(()=>reply(corrected)).fetch);
  const value=await adapter.prepare({source:typoSource,title:'make a sandwich'},{response_mode:'question',delivery_mode:'text'});
  assert.equal(value.languages.en.question,corrected.question);
  assert.equal(value.languages.en.choices.find(choice=>choice.id===value.rubric.correctChoiceId).text,corrected.choices[0]);

  const invented={...corrected,
    choices:['Pita bread or flatbread','Hamburger bun','Sliced sandwich bread','Baguette']};
  assert.equal(await nemotronInstructionDelivery(baseEnv,fetcher(()=>reply(invented)).fetch)
    .prepare({source:typoSource,title:'make a sandwich'},{response_mode:'question',delivery_mode:'text'}),null);

  const wrongQuantity={...prepared,facts:['Place 3 cartons on the blue shelf before 4 pm.'],
    askedFacts:['Place 3 cartons on the blue shelf before 4 pm.']};
  assert.equal(await nemotronInstructionDelivery(baseEnv,fetcher(()=>reply(wrongQuantity)).fetch)
    .prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'}),null);
});

test('a generic provider answer is rejected and retried, then fails instead of publishing',async()=>{
  const generic={...prepared,question:'Which action follows the instruction “Carton routing”?',
    choices:['Carry on with another task without following this instruction.','Do the opposite of this instruction.',
      'Replace this instruction with your own steps.','on the blue shelf']};
  const retryMock=fetcher((body,count)=>reply(count===1?generic:prepared));
  const retried=nemotronInstructionDelivery(baseEnv,retryMock.fetch);
  const value=await retried.prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'});
  assert.equal(retryMock.calls.length,2);
  assert.equal(value.question,question);
  assert.equal(value.languages.en.choices.find(choice=>choice.id===value.rubric.correctChoiceId).text,choices[0]);

  const genericMock=fetcher(()=>reply(generic));
  const rejected=nemotronInstructionDelivery(baseEnv,genericMock.fetch);
  assert.equal(await rejected.prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'}),null);
  assert.equal(genericMock.calls.length,2);
});

test('a transient NVIDIA failure is retried once',async()=>{
  let calls=0;
  const adapter=nemotronInstructionDelivery(baseEnv,async()=>{
    calls++;
    return calls===1?new Response('busy',{status:503}):reply(prepared);
  });
  const value=await adapter.prepare({source,title:'Carton routing'},{response_mode:'question',delivery_mode:'text'});
  assert.equal(calls,2);
  assert.equal(value.question,question);
});

test('a failed provider question fails the send instead of publishing the generic template',async()=>{
  const db=new PGlite();
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  const schema='understood_test_nemotron_generic';
  try {
    await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations(id,name) VALUES('a','Synthetic');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','Synthetic','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','001','ru');");
    const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
    const scope={schema};
    const adapter={mode:'nemotron-text',label:'Nemotron 3 Ultra 550B',translationLabel:'DeepL',
      provenanceAdapter:NEMOTRON_DELIVERY_ADAPTER,model:NEMOTRON_ULTRA_MODEL,textLanguages:DEEPL_TRANSLATE_LANGUAGES,
      async prepare(){return null;},
      async translate(){throw Error('Translation must not run');}};
    const input={requestId:randomUUID(),title:'сделай бутерброд',
      source:'Сделай мне сэндвич с куриной шаурмой, чесноком и маринованными огурчиками.',
      audience:{type:'all'},responseMode:'question',deliveryMode:'text'};
    const started=await startInstructionSend(pool,owner,input,scope);
    assert.equal(await processOnePreparation(pool,{schema,integrationMode:'synthetic',briefingId:started.briefingId,
      instructionTextAdapter:adapter}),true);
    const result=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(result.state,'failed');
    assert.equal(result.delivered,0);
    assert.match(result.error,/checked question/);
    const briefing=(await db.query('SELECT state,prepared_json FROM briefings WHERE id=$1',[input.requestId])).rows[0];
    assert.equal(briefing.state,'failed');
    assert.equal(briefing.prepared_json,null);
  } finally {
    await db.close();
  }
});

test('an Arabic source is translated to English before Nemotron generates and DeepL translates',async()=>{
  const arabic={title:'توجيه الكراتين',text:'ضع كرتين على الرف الأزرق قبل الساعة 4 مساءً. أبقِ الممر خالياً.'};
  const mock=fetcher((body,count,url)=>{
    if(url==='https://integrate.api.nvidia.com/v1/chat/completions')return reply(prepared);
    if(body.target_lang==='EN-GB')return Response.json({translations:[
      {detected_source_language:'AR',text:'Carton routing'},
      {detected_source_language:'AR',text:source},
    ]});
    return deeplReply(hindiValues);
  });
  const adapter=nemotronInstructionDelivery(baseEnv,mock.fetch);
  const value=await adapter.prepare({source:arabic.text,title:arabic.title},{response_mode:'question',delivery_mode:'text'});
  assert.equal(value.source,arabic.text);
  assert.equal(value.title,'Carton routing');
  assert.equal(value.languages.en.title,'Carton routing');
  assert.equal(value.languages.en.text,source);
  assert.equal(value.languages.en.question,question);
  assert.equal(value.question,question);
  const normalize=mock.calls.find(call=>call.body.target_lang==='EN-GB');
  assert.deepEqual(normalize.body,{text:[arabic.title,arabic.text],target_lang:'EN-GB'});
  const generation=mock.calls.find(call=>call.url.includes('nvidia'));
  assert.deepEqual(JSON.parse(generation.body.messages[1].content),{source,review:null});
  assert.equal(mock.calls.length,2);

  await resetBudget(adapter);
  const english={title:value.languages.en.title,text:value.languages.en.text,question:value.languages.en.question,
    questionType:'multiple-choice',choices:value.languages.en.choices};
  assert.deepEqual(await adapter.translate('hi',english),{title:hindi.title,text:hindi.text,question:hindi.question,
    questionType:'multiple-choice',choices:hindi.answerChoices.map((text,index)=>({id:english.choices[index].id,text}))});
  assert.deepEqual(mock.calls.at(-1).body,{text:[english.title,english.text,english.question,...english.choices.map(choice=>choice.text)],source_lang:'EN',target_lang:'HI'});

  const unavailable=nemotronInstructionDelivery(baseEnv,async url=>{
    if(url.includes('deepl'))return new Response('denied',{status:403});
    assert.fail('NVIDIA must not be called without an English source');
  });
  assert.equal(await unavailable.prepare({source:arabic.text,title:arabic.title},{response_mode:'question',delivery_mode:'text'}),null);
});

test('DeepL translates instruction text and ordered choices for the worker language',async()=>{
  const mock=fetcher(()=>deeplReply(hindiValues));
  const adapter=nemotronInstructionDelivery(baseEnv,mock.fetch);
  await resetBudget(adapter);
  assert.deepEqual(await adapter.translate('hi',english),{title:hindi.title,text:hindi.text,question:hindi.question,
    questionType:'multiple-choice',choices:hindi.answerChoices.map((text,index)=>({id:`c${index}`,text}))});
  assert.equal(mock.calls.length,1);
  assert.equal(mock.calls[0].url,'https://api-free.deepl.com/v2/translate');
  assert.equal(mock.calls[0].headers.authorization,'DeepL-Auth-Key test-only-deepl-key:fx');
  assert.deepEqual(mock.calls[0].body,{text:englishValues,source_lang:'EN',target_lang:'HI'});
});

test('DeepL rejects translated scripts or choices that drift from the source',async()=>{
  const variants=[
    {texts:[hindi.title,source,hindi.question,...hindi.answerChoices],reason:/invalid text translation/},
    {texts:[hindi.title,hindi.text,'',...hindi.answerChoices],reason:/invalid question translation/},
    {texts:[hindi.title,hindi.text,hindi.question,hindi.answerChoices[0],hindi.answerChoices[1],
      'on the red shelf',hindi.answerChoices[3]],reason:/changed the answer choices/},
  ];
  for(const {texts,reason} of variants){
    const adapter=nemotronInstructionDelivery(baseEnv,fetcher(()=>deeplReply(texts)).fetch);
    await resetBudget(adapter);
    await assert.rejects(()=>adapter.translate('hi',english),reason);
  }
});

test('a Vercel instruction send from an Arabic source publishes after English generation and DeepL translation',async()=>{
  const db=new PGlite();
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  const schema='understood_test_nemotron_arabic';
  try {
    await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations(id,name) VALUES('a','Synthetic');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','Synthetic','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','001','hi');");
    const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
    const scope={schema};
    const arabic={title:'توجيه الكراتين',text:'ضع كرتين على الرف الأزرق قبل الساعة 4 مساءً. أبقِ الممر خالياً.'};
    const mock=fetcher((body,count,url)=>{
      if(url==='https://integrate.api.nvidia.com/v1/chat/completions')return reply(prepared);
      if(body.target_lang==='EN-GB')return Response.json({translations:[
        {detected_source_language:'AR',text:'Carton routing'},
        {detected_source_language:'AR',text:source},
      ]});
      return deeplReply(hindiValues);
    });
    const adapter=nemotronInstructionDelivery(baseEnv,mock.fetch);
    const input={requestId:randomUUID(),title:arabic.title,source:arabic.text,audience:{type:'all'},
      responseMode:'question',deliveryMode:'text'};
    const started=await startInstructionSend(pool,owner,input,scope);
    assert.equal(await processOnePreparation(pool,{schema,integrationMode:'synthetic',briefingId:started.briefingId,
      instructionTextAdapter:adapter}),true);
    const row=(await db.query('SELECT prepared_json,state FROM briefings WHERE id=$1',[input.requestId])).rows[0];
    assert.equal(row.state,'ready');
    assert.equal(row.prepared_json.source,arabic.text);
    assert.equal(row.prepared_json.title,'Carton routing');
    assert.equal(row.prepared_json.languages.en.text,source);
    assert.equal(row.prepared_json.languages.en.question,question);
    assert.equal(row.prepared_json.languages.hi.text,hindi.text);
    assert.equal(row.prepared_json.languages.hi.question,hindi.question);
    assert.equal(row.prepared_json.provenance.questionAdapter,NEMOTRON_DELIVERY_ADAPTER);
    const result=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(result.state,'published');
    assert.equal(result.delivered,1);
    assert.equal(result.undelivered,0);
  } finally {
    await db.close();
  }
});
test('a Vercel instruction send publishes supported languages and leaves Sinhala undelivered',async()=>{
  const db=new PGlite();
  const pool={async connect(){return {query:async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]},release(){}};}};
  const schema='understood_test_nemotron';
  try {
    await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},pg_catalog`);
    await runMigrations(pool,{schema});
    await db.exec("INSERT INTO organizations(id,name) VALUES('a','Synthetic');INSERT INTO sites(id,org_id,name,timezone) VALUES('a','a','Synthetic','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('owner','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w1','a','a','001','hi'),('w2','a','a','002','si');");
    const owner={principal_type:'staff',principal_id:'owner',org_id:'a',site_id:'a',role:'owner'};
    const scope={schema};
    const mock=fetcher(()=>deeplReply([hindi.title,hindi.text]));
    const adapter=nemotronInstructionDelivery(baseEnv,mock.fetch);
    const input={requestId:randomUUID(),title:'Carton routing',source,audience:{type:'all'},
      responseMode:'acknowledge',deliveryMode:'text'};
    const started=await startInstructionSend(pool,owner,input,scope);
    assert.equal(await processOnePreparation(pool,{schema,integrationMode:'synthetic',briefingId:started.briefingId,
      instructionTextAdapter:adapter}),true);
    const row=(await db.query('SELECT prepared_json,state FROM briefings WHERE id=$1',[input.requestId])).rows[0];
    assert.equal(row.state,'ready');
    assert.equal(row.prepared_json.provenance.adapter,NEMOTRON_DELIVERY_ADAPTER);
    assert.equal(row.prepared_json.provenance.questionAdapter,'synthetic-instruction-v1');
    assert.equal(row.prepared_json.provenance.translationAdapter,DEEPL_TRANSLATE_ADAPTER);
    assert.equal(row.prepared_json.provenance.model,NEMOTRON_ULTRA_MODEL);
    assert.equal(row.prepared_json.provenance.live,false);
    assert.equal(row.prepared_json.languages.en.text,source);
    assert.equal(row.prepared_json.languages.hi.text,hindi.text);
    assert.equal(row.prepared_json.languages.si,undefined);
    assert.equal(mock.calls.length,1);
    assert.equal(mock.calls[0].url,'https://api-free.deepl.com/v2/translate');
    const result=await completeInstructionSend(pool,owner,input.requestId,scope);
    assert.equal(result.state,'published');
    assert.equal(result.delivered,1);
    assert.equal(result.undelivered,1);
  } finally {
    await db.close();
  }
});
