import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactReviewTabs,artifactTabsFor,nextArtifactTab,copyArtifactText,artifactGlossaryDependency} from '../src/artifact-review.ts';
import {checkedArtifactGlossary} from '../src/artifact-glossary.ts';

const context='a'.repeat(64),now=Date.parse('2026-10-12T12:00:00.000Z');
const staff={authenticated:true,role:'staff',staffRole:'owner',clientContext:context,expiresAt:'2026-10-12T13:00:00.000Z'};

test('artifact tabs use a stable four-view order and support wrapping arrows, Home and End',()=>{
  assert.deepEqual(artifactReviewTabs,['text','audio','question','glossary']);
  for(let n=0;n<4;n++){
    assert.equal(nextArtifactTab(artifactReviewTabs[n],'ArrowRight'),artifactReviewTabs[(n+1)%4]);
    assert.equal(nextArtifactTab(artifactReviewTabs[n],'ArrowLeft'),artifactReviewTabs[(n+3)%4]);
    assert.equal(nextArtifactTab(artifactReviewTabs[n],'Home'),'text');assert.equal(nextArtifactTab(artifactReviewTabs[n],'End'),'glossary');
    assert.equal(nextArtifactTab(artifactReviewTabs[n],'Enter'),null);
  }
});

test('tab keyboard navigation wraps within the tabs a version actually shows',()=>{
  const visible=['text','question','glossary'];
  assert.equal(nextArtifactTab('text','ArrowRight',visible),'question');
  assert.equal(nextArtifactTab('question','ArrowRight',visible),'glossary');
  assert.equal(nextArtifactTab('glossary','ArrowRight',visible),'text');
  assert.equal(nextArtifactTab('text','ArrowLeft',visible),'glossary');
  assert.equal(nextArtifactTab('glossary','Home',visible),'text');
  assert.equal(nextArtifactTab('text','End',visible),'glossary');
  assert.equal(nextArtifactTab('text','Enter',visible),null);
});

test('artifact tabs follow the delivery and response modes workers actually received',()=>{
  assert.deepEqual(artifactTabsFor({deliveryMode:'text',responseMode:'question'}),['text','question','glossary']);
  assert.deepEqual(artifactTabsFor({deliveryMode:'both',responseMode:'question'}),['text','audio','question','glossary']);
  assert.deepEqual(artifactTabsFor({deliveryMode:'both',responseMode:'acknowledge'}),['text','audio','glossary']);
  assert.deepEqual(artifactTabsFor({deliveryMode:'text',responseMode:'acknowledge'}),['text','glossary']);
  assert.deepEqual(artifactTabsFor({deliveryMode:'text'}),['text','question','glossary']);
  assert.deepEqual(artifactTabsFor(null),['text','audio','question','glossary']);
  assert.deepEqual(artifactTabsFor(undefined),['text','audio','question','glossary']);
});

test('artifact copy writes only the exact selected value after a current scoped staff session read',async()=>{
  for(const role of ['owner','supervisor','auditor'])for(const value of ['English source','الرف الأزرق','نیلی شیلف','http://127.0.0.1:3020/api/briefings/brief/artifacts/publication/frozen/ar/body']){
    let reads=0;const written=[];
    await copyArtifactText(value,context,async()=>{reads++;return {...staff,staffRole:role};},async text=>written.push(text),()=>true,()=>now);
    assert.equal(reads,1);assert.deepEqual(written,[value]);
  }
});

test('unrelated, expired, disabled-role and unavailable session evidence cannot write the clipboard',async()=>{
  for(const session of [null,{},[],{...staff,authenticated:false},{...staff,role:'worker'},{...staff,staffRole:'administrator'},
    {...staff,clientContext:'b'.repeat(64)},{...staff,expiresAt:'2026-10-12T12:00:00.000Z'},{...staff,expiresAt:'2099'}]){
    let writes=0;await assert.rejects(copyArtifactText('Selected text',context,async()=>session,async()=>{writes++;},()=>true,()=>now));assert.equal(writes,0);
  }
  let writes=0;await assert.rejects(copyArtifactText('Selected text',context,async()=>{throw Error('Private server failure');},async()=>{writes++;},()=>true,()=>now));assert.equal(writes,0);
});

test('unmounted, changed-version/language and invalid copy commands never start a stale clipboard write',async()=>{
  for(const value of ['', ' ', 'x'.repeat(5001),'bad\0text']){
    let reads=0;await assert.rejects(copyArtifactText(value,context,async()=>{reads++;return staff;},async()=>assert.fail('Unexpected clipboard write'),()=>true,()=>now));assert.equal(reads,0);
  }
  let current=true;await assert.rejects(copyArtifactText('Original text',context,async()=>{current=false;return staff;},async()=>assert.fail('Stale write'),()=>current,()=>now));
  await assert.rejects(copyArtifactText('Original text',context,async()=>assert.fail('Unmounted read'),async()=>assert.fail('Unmounted write'),()=>false,()=>now));
  await assert.rejects(copyArtifactText('Original text','invalid',async()=>assert.fail('Invalid context read'),async()=>assert.fail('Invalid context write'),()=>true,()=>now));
});

test('clipboard denial and a context change during a write cannot report copied success',async()=>{
  await assert.rejects(copyArtifactText('Selected text',context,async()=>staff,async()=>{throw Error('Clipboard denied');},()=>true,()=>now));
  let current=true,writes=0;await assert.rejects(copyArtifactText('Selected text',context,async()=>staff,async()=>{writes++;current=false;},()=>current,()=>now),/context changed/);assert.equal(writes,1);
});

test('recorded glossary dependency is separate from current terms and does not invent missing historical contents',()=>{
  const hash='b'.repeat(64);
  assert.deepEqual(artifactGlossaryDependency({dependencies:{glossaryRevision:3,glossaryHash:hash}}),{revision:3,hash});
  assert.deepEqual(artifactGlossaryDependency({provenance:{glossary:{revision:2,hash,terms:[{id:'old',revision:1}]}}}),{revision:2,hash});
  for(const value of [null,{}, {dependencies:{glossaryRevision:-1,glossaryHash:hash}},{dependencies:{glossaryRevision:'3',glossaryHash:hash}},
    {dependencies:{glossaryRevision:3,glossaryHash:'bad'}}])assert.equal(artifactGlossaryDependency(value),null);
});

test('artifact glossary validates exact language pair, page, bounded rows and private-field-free projection',()=>{
  const row={id:'term',term:'blue shelf',sourceLanguage:'en',targetLanguage:'ar',revision:1,status:'active',content:{override:'',suggestion:'الرف الأزرق',provenance:{adapter:'synthetic-glossary-v1',live:false}}};
  const page={items:[row],total:1,page:1,pageSize:20};assert.deepEqual(checkedArtifactGlossary(page,'ar',1),page);
  for(const change of [{page:2},{pageSize:50},{total:-1},{privateRubric:'private'},{items:[row,row],total:2},
    {items:[{...row,sourceLanguage:'ur'}]},{items:[{...row,targetLanguage:'ur'}]},{items:[{...row,status:'removed'}]},
    {items:[{...row,token:'secret'}]},{items:[{...row,content:{...row.content,override:'x'.repeat(501)}}]},
    {items:[{...row,content:{...row.content,provenance:{adapter:'fixture',live:'false'}}}]},{items:[null]}])
    assert.throws(()=>checkedArtifactGlossary({...page,...change},'ar',1),/could not be verified/);
  assert.deepEqual(checkedArtifactGlossary({items:[],total:0,page:1,pageSize:20},'ur',1).items,[]);
});
