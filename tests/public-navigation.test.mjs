import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_SECTIONS,isPublicLandingView,publicLandingTarget} from '../src/public-navigation.ts';

test('all five marketing destinations and product aliases stay public on a direct visit',()=>{
  assert.equal(PUBLIC_SECTIONS.length,5);
  assert.equal(new Set(PUBLIC_SECTIONS.map(section=>section.id)).size,5);
  for(const section of PUBLIC_SECTIONS){assert.ok(isPublicLandingView(section.id));assert.equal(publicLandingTarget(section.id),section.id);}
  for(const role of ['worker','supervisor']){assert.ok(isPublicLandingView(`platform/${role}`));assert.equal(publicLandingTarget(`platform/${role}`),'platform');}
  assert.ok(isPublicLandingView('company-controls'));assert.equal(publicLandingTarget('company-controls'),'company-controls');
  assert.ok(isPublicLandingView('home'));assert.equal(publicLandingTarget('home'),'landing-top');
  assert.ok(isPublicLandingView('contact'));assert.equal(publicLandingTarget('contact'),'landing-top');
});

test('marketing route matching does not swallow authentication or private application routes',()=>{
  for(const view of ['overview','instructions','people','settings','device','worker','register','sign-in','pilot','walkthrough','platform/unknown','companies/private',''])assert.equal(isPublicLandingView(view),false,view);
});
