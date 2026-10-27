import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PGlite} from '@electric-sql/pglite';
import {runMigrations,verifyMigrations} from '../server/postgres/migrate.mjs';
import {expandBriefingLanguageRequestCheck,expandGenerationLanguageChecks,guardBriefingLanguageRequest} from '../server/generation-language-schema.mjs';
import {WORKER_LANGUAGE_CODES,languageTextMatches} from '../server/languages.mjs';
import {prepareLanguageBundle,checkedPreparedBundle} from '../server/ai/prepared-bundle.mjs';
import {encodeWav} from '../src/audio.ts';

const samples={en:'Blue shelf',ar:'الرف الأزرق',hi:'नीली शेल्फ',ur:'نیلی شیلف',bn:'নীল তাক',ml:'നീല ഷെൽഫ്',ta:'நீல அலமாரி',te:'నీలం షెల్ఫ్',ne:'नीलो दराज',fil:'Asul na istante',si:'නිල් රාක්කය',ru:'Синяя полка','pa-Guru':'ਨੀਲੀ ਸ਼ੈਲਫ','pa-Arab':'نیلی شیلف',id:'Rak biru'};
const source='Put finished items on the blue shelf.';
const wav=()=>Buffer.from(encodeWav({duration:1,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array(16000).fill(.2)}));

test('every worker locale can complete the text/check/speech bundle with exact stored references',async()=>{
  const translated=[],checked=[],spoken=[],stages=[];
  const adapter={provenance:{adapter:'fixture-all-languages',dataClass:'synthetic',textModel:'fixture-text',speechModel:'fixture-speech',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'},
    capabilities:{textLanguages:WORKER_LANGUAGE_CODES,speechLanguages:WORKER_LANGUAGE_CODES},
    async prepare(){return {title:'Shelf instruction',question:'Where do finished items go?',facts:[source],askedFacts:[source]};},
    async checkPreparation(){return {sourceGrounded:true,questionAligned:true,ambiguous:false,factEvidence:[{factIndex:0,quote:source}],askedFactIndexes:[0],reasons:[]};},
    async translate(content,language){translated.push(language);return {title:samples[language],text:samples[language],question:samples[language]+'?'};},
    async checkTranslation(content,value,language){checked.push(language);return {faithful:true,complete:true,languageCorrect:true,terminologyApplied:true,reasons:[]};},
    async speech(text,language){assert.ok(languageTextMatches(language,text));spoken.push(language);return wav();}};
  const bundle=await prepareLanguageBundle({source,revision:1,languages:WORKER_LANGUAGE_CODES,dataClass:'synthetic',adapter,assertCurrent:async()=>true,onStage:event=>stages.push(event)});
  assert.deepEqual(Object.keys(bundle.manifest.languages),WORKER_LANGUAGE_CODES);
  assert.equal(bundle.audio.length,30);assert.equal(new Set(bundle.audio.map(item=>item.id)).size,30);
  assert.deepEqual(translated,WORKER_LANGUAGE_CODES.filter(code=>code!=='en'));assert.deepEqual(checked,translated);
  for(const language of WORKER_LANGUAGE_CODES)assert.equal(spoken.filter(code=>code===language).length,2);
  assert.equal(stages.filter(event=>event.state==='completed').length,60);
  assert.equal(checkedPreparedBundle(bundle).audio.length,30);
});

test('SQLite expands legacy generation checks without changing receipts, foreign keys, columns or frozen history',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE site_settings(id TEXT PRIMARY KEY,generation_languages_json TEXT NOT NULL CHECK(generation_languages_json IN ('["en"]','["en","ar"]','["en","ur"]','["en","ar","ur"]')),opaque TEXT NOT NULL) STRICT;
      CREATE TABLE source_audio_requests(id TEXT PRIMARY KEY,generation_languages_json TEXT CHECK(generation_languages_json IS NULL OR generation_languages_json IN ('["en"]','["en","ar"]','["en","ur"]','["en","ar","ur"]')),site_id TEXT REFERENCES site_settings(id),original_bytes BLOB) STRICT;
      CREATE INDEX source_reference ON source_audio_requests(site_id);
      CREATE TRIGGER source_frozen BEFORE UPDATE OF original_bytes ON source_audio_requests BEGIN SELECT RAISE(ABORT,'Source is immutable');END;
      INSERT INTO site_settings VALUES('site','["en","ar","ur"]','Private settings');
      INSERT INTO source_audio_requests VALUES('receipt',NULL,'site',x'010203');`);
    const before=db.prepare('SELECT * FROM source_audio_requests').all();
    expandGenerationLanguageChecks(db);expandGenerationLanguageChecks(db);
    assert.deepEqual(db.prepare('SELECT * FROM source_audio_requests').all(),before);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    db.prepare('UPDATE site_settings SET generation_languages_json=? WHERE id=?').run(JSON.stringify(WORKER_LANGUAGE_CODES),'site');
    for(const value of [['en','hi','hi'],['en','ur','ar'],['en','xx'],['hi'],[]])assert.throws(()=>db.prepare('UPDATE site_settings SET generation_languages_json=?').run(JSON.stringify(value)));
    assert.throws(()=>db.prepare('UPDATE source_audio_requests SET original_bytes=?').run(Buffer.from([4])),/Source is immutable/);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='source_reference'").get());
  }finally{db.close();}
});

test('draft language receipts keep every worker locale after the old four-value check is replaced',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`CREATE TABLE briefing_language_requests (
      request_id TEXT PRIMARY KEY,request_json TEXT NOT NULL,
      CHECK(json_extract(request_json,'$.generationLanguages') IS NULL OR json_extract(request_json,'$.generationLanguages') IN ('["en"]','["en","ar"]','["en","ur"]','["en","ar","ur"]'))
    ) STRICT;
    INSERT INTO briefing_language_requests VALUES('old','{"generationLanguages":["en","ar"]}');`);
    assert.throws(()=>db.prepare('INSERT INTO briefing_language_requests VALUES(?,?)').run('blocked',JSON.stringify({generationLanguages:['en','hi']})));
    expandBriefingLanguageRequestCheck(db);guardBriefingLanguageRequest(db);expandBriefingLanguageRequestCheck(db);
    assert.deepEqual(JSON.parse(db.prepare('SELECT request_json FROM briefing_language_requests WHERE request_id=?').get('old').request_json).generationLanguages,['en','ar']);
    db.prepare('INSERT INTO briefing_language_requests VALUES(?,?)').run('ready',JSON.stringify({generationLanguages:['en','hi','ne']}));
    for(const value of [['hi'],['en','ne','hi'],['en','xx'],['en','hi','hi']])assert.throws(()=>db.prepare('INSERT INTO briefing_language_requests VALUES(?,?)').run('bad',JSON.stringify({generationLanguages:value})));
  }finally{db.close();}
});

test('PostgreSQL generation settings accept all locales and reject duplicates, unknown codes and noncanonical order',async()=>{
  const db=new PGlite(),schema='understood_test_generation_locales';
  const client={async query(sql,args){return args?.length?db.query(sql,args):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};
  const pool={async connect(){return client;}};
  try{
    await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
    const bounds=(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('preparation_stage_events'::regclass,'generated_bundles'::regclass) AND contype='c'")).rows.map(row=>row.definition);
    assert.ok(bounds.some(value=>value.includes('step')&&value.includes('68')));assert.ok(bounds.some(value=>value.includes('provider_operation_count')&&value.includes('68')));
    await db.query("INSERT INTO organizations(id,name) VALUES('org','Organization')");
    await db.query("INSERT INTO sites(id,org_id,name,timezone) VALUES('site','org','Site','UTC')");
    await db.query('INSERT INTO site_settings(site_id,org_id,revision,generation_languages_json) VALUES($1,$2,0,$3)',['site','org',JSON.stringify(['en','ar','ur'])]);
    await db.exec(`ALTER TABLE site_settings DROP CONSTRAINT site_settings_generation_locale_set;
      ALTER TABLE site_settings ADD CONSTRAINT legacy_generation_languages CHECK(generation_languages_json IN ('["en"]','["en","ar"]','["en","ur"]','["en","ar","ur"]'));
      DELETE FROM schema_migrations WHERE version='109_generation_language_locales.sql';`);
    await assert.rejects(verifyMigrations(pool,{schema}),/not current/);
    assert.deepEqual(await runMigrations(pool,{schema}),['109_generation_language_locales.sql']);
    assert.deepEqual((await db.query('SELECT generation_languages_json FROM site_settings')).rows[0].generation_languages_json,['en','ar','ur']);
    await db.query('UPDATE site_settings SET generation_languages_json=$1',[JSON.stringify(WORKER_LANGUAGE_CODES)]);
    for(const value of [['en','hi','hi'],['en','ur','ar'],['en','xx'],['hi'],[],{},['en',1]])await assert.rejects(db.query('UPDATE site_settings SET generation_languages_json=$1',[JSON.stringify(value)]));
    assert.deepEqual((await db.query('SELECT generation_languages_json FROM site_settings')).rows[0].generation_languages_json,WORKER_LANGUAGE_CODES);
  }finally{await db.close();}
});

test('Arabic normalization plus both bounded repairs completes all 15 locales within the metered stage limit',async()=>{
  const {preparationOperationEvidence}=await import('../server/ai/preparation-provenance.mjs');
  const {randomUUID,createHash}=await import('node:crypto');
  const {bundleHash}=await import('../server/ai/prepared-bundle.mjs');
  const arabic='أبق الممر خالياً.',english='Keep the walkway clear.';
  const provider={adapter:'fixture-all-languages',dataClass:'synthetic',textModel:'fixture-text',speechModel:'fixture-speech',voice:'fixture',promptVersion:'v1',schemaVersion:'v1'};
  const terms=[{id:'walkway',revision:1,term:'walkway',sourceLanguage:'en',targetLanguage:'ar',override:'الممر',suggestion:''}];
  const input={source:arabic,title:'Supervisor entered title',revision:1,languages:WORKER_LANGUAGE_CODES,review:null,glossary:{revision:1,terms,hash:createHash('sha256').update(JSON.stringify(terms)).digest('hex')}};
  const job={id:randomUUID(),org_id:'synthetic',site_id:'synthetic',briefing_id:randomUUID(),revision:1,token:randomUUID()};
  let checks=0,translationChecks=0,event=null;const evidence=[],seenTerms=[];
  const raw={provenance:provider,capabilities:{textLanguages:WORKER_LANGUAGE_CODES,speechLanguages:WORKER_LANGUAGE_CODES},
    async prepare(){return {title:'Generated title',question:'What must stay clear?',facts:[english],askedFacts:[english]};},
    async checkPreparation(){checks++;return {sourceGrounded:true,questionAligned:checks>1,ambiguous:false,factEvidence:[{factIndex:0,quote:arabic}],askedFactIndexes:[0],reasons:checks>1?[]:['question_alignment']};},
    async translate(value,language,options){if(language==='ar')seenTerms.push(options.terms);return {title:language==='en'?input.title:samples[language],text:language==='en'?english:samples[language],question:language==='en'?'What must stay clear?':samples[language]+'?'};},
    async checkTranslation(_,__,language){const repair=language==='ar'&&translationChecks++===0;return {faithful:true,complete:!repair,languageCorrect:true,terminologyApplied:true,reasons:repair?['incomplete_translation']:[]};},
    async speech(){return wav();}};
  const adapter={...raw};for(const method of ['prepare','checkPreparation','translate','checkTranslation','speech'])adapter[method]=async(...args)=>{evidence.push(preparationOperationEvidence(job,input,method,args,event,provider));return raw[method](...args);};
  const bundle=await prepareLanguageBundle({...input,dataClass:'synthetic',adapter,assertCurrent:async()=>true,onStage:value=>{event=value;},multipleChoice:true});
  assert.equal(bundle.audio.length,30);assert.equal(evidence.length,66);assert.equal(Math.max(...evidence.map(item=>item.preparationContext.step)),66);
  assert.ok(seenTerms.length===2&&seenTerms.every(value=>value[0]?.term==='walkway'));
  assert.equal(bundle.manifest.languages.en.title,input.title);
});
