import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRegistrationVerification,sendRegistrationVerification,checkRegistrationCode} from '../server/registration-verification.mjs';
const env={UNDERSTOOD_REGISTRATION_PROVIDER:'neon',UNDERSTOOD_AUTH_MAIL_KEY:'01'.repeat(32),UNDERSTOOD_NEON_AUTH_URL:'https://ep-test.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth'};
const config=resolveRegistrationVerification(env,{},'http://127.0.0.1:3020');
test('Neon configuration validates endpoint and fails closed without falling back to Resend',()=>{
 assert.equal(config.available,true);
 assert.equal(resolveRegistrationVerification({...env,UNDERSTOOD_NEON_AUTH_URL:''},{available:true},config.publicOrigin).available,false);
 for(const url of ['http://example.com/auth','https://example.com/neondb/auth',env.UNDERSTOOD_NEON_AUTH_URL+'?key=secret'])
  assert.throws(()=>resolveRegistrationVerification({...env,UNDERSTOOD_NEON_AUTH_URL:url},{},config.publicOrigin));
});
test('Neon transport sends only email/code, never creates a session, and rejects ambiguous success',async()=>{
 const calls=[];const transport=async(url,options)=>{calls.push({url,options});return Response.json({success:true});};
 await sendRegistrationVerification(config,'job-1',{email:'test@example.test',password:'never-send'},transport);
 assert.equal(await checkRegistrationCode(config,'test@example.test','001234',transport),true);
 assert.deepEqual(JSON.parse(calls[0].options.body),{email:'test@example.test',type:'sign-in'});
 assert.deepEqual(JSON.parse(calls[1].options.body),{email:'test@example.test',type:'sign-in',otp:'001234'});
 assert(calls[1].url.endsWith('/email-otp/check-verification-otp'));
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
 for(const response of [Response.json({success:false}),Response.json({error:'private provider detail'},{status:400}),new Response('x'.repeat(17000))])
  await assert.rejects(checkRegistrationCode(config,'test@example.test','123456',async()=>response),/^Error: Registration verification unavailable$/);
 assert.throws(()=>checkRegistrationCode(config,'test@example.test','12345',transport));
});
