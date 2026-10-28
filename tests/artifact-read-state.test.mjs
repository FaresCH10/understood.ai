import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactReadKey,artifactReadView} from '../src/artifact-read-state.ts';
import {staffRequestBinding} from '../src/staff-request.ts';
const session={authenticated:true,role:'staff',clientContext:'a'.repeat(64),staffScope:'site-one',staffRole:'owner',siteState:'active',mode:'credential',expiresAt:'2099-01-01T00:00:00.000Z'};
const path='/api/processing/answer_check:job/provenance?page=1&pageSize=10';
test('artifact read display belongs to exact authority, request path and refresh before effects run',()=>{
  const key=artifactReadKey(staffRequestBinding(session),path,1),data={private:'synthetic selection one'},state={key,data,loading:false,error:''};
  assert.deepEqual(artifactReadView(state,key,true),{data,loading:false,error:''});
  const changes=[{clientContext:'b'.repeat(64)},{staffScope:'site-two'},{staffRole:'auditor'},{siteState:'archived'},{mode:'synthetic-credential'},{expiresAt:'2099-01-02T00:00:00.000Z'},{authenticated:false},{role:'worker'}];
  for(const change of changes)assert.deepEqual(artifactReadView(state,artifactReadKey(staffRequestBinding({...session,...change}),path,1),true),{data:null,loading:true,error:''});
  for(const next of [path.replace('page=1','page=2'),path.replace('job','another-job'),path+'&language=ar'])assert.equal(artifactReadView(state,artifactReadKey(staffRequestBinding(session),next,1),true).data,null);
  assert.equal(artifactReadView(state,artifactReadKey(staffRequestBinding(session),path,2),true).data,null);
  assert.deepEqual(artifactReadView({...state,error:'Earlier selection error'},key+'changed',true),{data:null,loading:true,error:''});
});
test('artifact read display removes private results after authority loss and does not adopt late prior completions',()=>{
  const key=artifactReadKey('original','/api/artifact?page=1',1),state={key,data:{id:'original'},loading:false,error:''};
  const denied=artifactReadView(state,key,false);assert.equal(denied.data,null);assert.equal(denied.loading,false);assert.match(denied.error,/Session context changed/);
  const next=artifactReadKey('original','/api/artifact?page=2',1);
  assert.equal(artifactReadView(state,next,true).data,null);
  assert.deepEqual(artifactReadView({key:next,data:{id:'next'},loading:false,error:''},next,true),{data:{id:'next'},loading:false,error:''});
  assert.equal(artifactReadView(state,next,true).data,null);
  assert.deepEqual(artifactReadView({key:next,data:null,loading:false,error:'Read unavailable'},next,true),{data:null,loading:false,error:'Read unavailable'});
});
