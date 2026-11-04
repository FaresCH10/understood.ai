import test from 'node:test';
import assert from 'node:assert/strict';
import {helpGuides,findHelpGuides} from '../src/help-content.ts';
import {isHelpView,isPublicLandingView} from '../src/public-navigation.ts';

test('help guides support direct public visits without swallowing private or worker help routes',()=>{
  for(const route of ['support',...helpGuides.map(guide=>`support/${guide.id}`),'support/missing-guide']){
    assert.equal(isHelpView(route),true);assert.equal(isPublicLandingView(route),true);
  }
  for(const route of ['help','support-settings','settings','settings/staff','inbox','worker-access'])assert.equal(isHelpView(route),false);
});

test('each guide has a unique safe URL and complete English and Arabic article content',()=>{
  assert.equal(helpGuides.length,8);
  assert.equal(new Set(helpGuides.map(guide=>guide.id)).size,helpGuides.length);
  for(const guide of helpGuides){
    assert.match(guide.id,/^[a-z]+(?:-[a-z]+)*$/);
    for(const locale of ['en','ar']){
      assert.ok(guide[locale].title&&guide[locale].summary);
      assert.ok(guide[locale].sections.length>=3);
      assert.ok(guide[locale].sections.every(section=>section.title&&section.body.length&&section.body.every(Boolean)));
    }
  }
});

test('search combines role and body keywords, handles Arabic and has an honest empty result',()=>{
  assert.ok(findHelpGuides('private access link','worker','en').some(guide=>guide.id==='worker-sign-in'));
  assert.ok(findHelpGuides('invoices','owner','en').some(guide=>guide.id==='plans-and-invoices'));
  assert.ok(findHelpGuides('المِيكروفون','supervisor','ar').some(guide=>guide.id==='languages-and-audio'));
  assert.equal(findHelpGuides('no-such-help-topic','all','en').length,0);
  assert.ok(findHelpGuides('','worker','en').every(guide=>guide.role==='worker'));
  assert.equal(findHelpGuides('  ','all','en').length,8);
});
