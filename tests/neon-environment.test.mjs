import test from 'node:test';
import assert from 'node:assert/strict';
import {neonEnvironment} from '../server/neon-env.mjs';
import {resolveRegistrationVerification} from '../server/registration-verification.mjs';
import {neonFunctionStatus} from '../server/neon-services.mjs';

test('Neon CLI values configure existing adapters without overwriting explicit credentials',()=>{
  const source={NEON_AUTH_BASE_URL:'https://ep-fixture.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth',AWS_ENDPOINT_URL_S3:'https://example',AWS_REGION:'eu-central-1',AWS_ACCESS_KEY_ID:'new',UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID:'existing'};
  const result=neonEnvironment(source);
  assert.equal(result.UNDERSTOOD_NEON_AUTH_URL,source.NEON_AUTH_BASE_URL);
  assert.equal(result.UNDERSTOOD_NEON_STORAGE_BUCKET,'assets');
  assert.equal(result.UNDERSTOOD_NEON_STORAGE_ACCESS_KEY_ID,'existing');
  assert.equal(source.UNDERSTOOD_NEON_AUTH_URL,undefined);
});
test('registration supports the pulled Auth URL while retaining explicit overrides',()=>{
  const env={UNDERSTOOD_REGISTRATION_PROVIDER:'neon',UNDERSTOOD_AUTH_MAIL_KEY:'aa'.repeat(32),NEON_AUTH_BASE_URL:'https://ep-fixture.neonauth.c-8.eu-central-1.aws.neon.tech/neondb/auth'};
  assert.equal(resolveRegistrationVerification(env,{},'http://127.0.0.1:3020').authUrl,env.NEON_AUTH_BASE_URL);
});
test('Function readiness fails closed on a false successful response',async()=>{
  const env={NEON_FUNCTION_HELLO_BASE_URL:'https://function.compute.neon.tech/'};
  await assert.rejects(neonFunctionStatus(env,async()=>Response.json({app:'understood',postgres:'disconnected'})),/unavailable/);
  assert.deepEqual(await neonFunctionStatus(env,async()=>Response.json({app:'understood',postgres:'connected'})),{configured:true,functions:'connected',postgres:'connected'});
});
