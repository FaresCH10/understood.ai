import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pcDemoConfig} from '../server/postgres/pc-demo-config.mjs';
import {pcDemoRoutes} from '../scripts/pc-demo-vercel-output.mjs';
const value={synthetic:true,publicOrigin:'https://understood-pc-demo.vercel.app',tunnelOrigin:'https://example-test.trycloudflare.com',schema:'understood_stage_pc_demo',port:3045,audioRoot:resolve('artifacts/pc-demo/private-audio')};
test('PC demo remains synthetic with no operations, mail or live provider registration',()=>{
  const config=pcDemoConfig(value);assert.equal(config.tier,'staging');assert.equal(config.operatorAccess,false);assert.equal(config.mail.available,false);
  assert.equal(config.providerVerification,undefined);assert.equal(config.runtimeRoleProfile,'application');
  assert.equal(pcDemoConfig(value,{service:'worker'}).runtimeRoleProfile,'worker');
  for(const patch of [{synthetic:false},{publicOrigin:'http://localhost:3045'},{publicOrigin:'https://example.com'},
    {tunnelOrigin:'https://evil.com'},{schema:'understood_prod_demo'},{audioRoot:resolve('data/private-audio')}])assert.throws(()=>pcDemoConfig({...value,...patch}));
});
test('PC demo trusts only the loopback tunnel with exact host, HTTPS, and Cloudflare address',()=>{
  const config=pcDemoConfig(value),req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'example-test.trycloudflare.com','x-forwarded-proto':'https','cf-connecting-ip':'192.0.2.1'}};
  assert.equal(config.requestAddress(req),'192.0.2.1');
  assert.throws(()=>config.requestAddress({...req,socket:{remoteAddress:'192.0.2.1'}}));
  for(const change of [{host:'understood-pc-demo.vercel.app'},{'x-forwarded-proto':'http'},{'cf-connecting-ip':'192.0.2.1, 127.0.0.1'}])assert.throws(()=>config.requestAddress({...req,headers:{...req.headers,...change}}));
});
test('Vercel routes forward all API paths before SPA fallback and never cache private API responses',()=>{
  const output=pcDemoRoutes(value.tunnelOrigin),route=output.routes[1];
  assert.equal(output.version,3);assert.equal(route.headers['Cache-Control'],'private, no-store');
  assert.equal(route.dest,value.tunnelOrigin+'/api/$1');
  assert.equal(new RegExp('^'+route.src+'$').exec('/api/auth/staff/login')[1],'auth/staff/login');
  assert.equal(new RegExp('^'+route.src+'$').test('/api-other'),false);
  assert.throws(()=>pcDemoRoutes('http://127.0.0.1:3045'));assert.throws(()=>pcDemoRoutes('https://example.com'));
});
test('PC email requires explicitly supplied valid delivery configuration and keeps the HTTPS verification origin',()=>{
  const mailEnv={UNDERSTOOD_EMAIL_MODE:'resend',UNDERSTOOD_RESEND_KEY:'re_synthetic_test_key_only',
    UNDERSTOOD_EMAIL_FROM:'accounts@example.test',UNDERSTOOD_AUTH_MAIL_KEY:'a'.repeat(64)};
  for(const service of ['api','worker']){
    const config=pcDemoConfig(value,{service,mailEnv});assert.equal(config.mail.available,true);
    assert.equal(config.mail.publicOrigin,value.publicOrigin);assert.equal(config.mail.key.length,32);
  }
  assert.equal(pcDemoConfig(value).mail.available,false);
  for(const field of ['UNDERSTOOD_RESEND_KEY','UNDERSTOOD_EMAIL_FROM','UNDERSTOOD_AUTH_MAIL_KEY'])assert.throws(()=>pcDemoConfig(value,{mailEnv:{...mailEnv,[field]:''}}));
});
