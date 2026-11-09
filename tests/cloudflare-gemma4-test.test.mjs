import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareGemma4Test} from '../server/ai/cloudflare-gemma4-test.mjs';
import {staffApplicationContextRequired} from '../server/session-context.mjs';

const env={
  VERCEL_ENV:'preview',UNDERSTOOD_CLOUDFLARE_GEMMA4_TEST:'true',
  CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token',
};
const output={
  instruction:'Place 2 sealed cartons on the blue shelf before 4 pm.',
  question:'Where should the sealed cartons go?',
  choices:['Blue shelf','Red shelf','Loading dock','Office'],
};
const providerResult=value=>Response.json({success:true,result:{choices:[{message:{content:JSON.stringify(value)}}]}});

test('Gemma testing requires preview, explicit opt-in and server credentials',()=>{
  for(const override of [
    {VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{UNDERSTOOD_TIER:'production'},
    {UNDERSTOOD_CLOUDFLARE_GEMMA4_TEST:undefined},{CLOUDFLARE_API_TOKEN:''},{CLOUDFLARE_ACCOUNT_ID:'invalid'},
  ])assert.equal(cloudflareGemma4Test({...env,...override}),null);
  assert.equal(staffApplicationContextRequired('/api/instructions/gemma4-test','POST'),true);
});

test('Gemma receives only a supported language and the fixed synthetic fixture',async()=>{
  let requests=0;
  const adapter=cloudflareGemma4Test(env,async (url,options)=>{
    requests++;
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/google/gemma-4-26b-a4b-it`);
    assert.equal(options.headers.authorization,'Bearer test-token');
    assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);
    assert.equal(body.chat_template_kwargs.enable_thinking,false);
    assert.equal(body.response_format.type,'json_object');
    assert.ok(body.messages[0].content.includes(adapter.source));
    return providerResult(output);
  });
  for(const input of [{language:'unsupported'},{language:'en',source:'Private workplace instruction'}])
    assert.equal((await adapter.run(input)).status,400);
  assert.equal(requests,0);
  assert.deepEqual(await adapter.run({language:'en'}),{status:200,data:output});
  assert.equal(requests,1);
});

test('Gemma rejects malformed or wrong-script output and surfaces a rate limit',async()=>{
  for(const [language,result] of [
    ['ar',output],
    ['en',{...output,choices:['Blue shelf','Blue shelf','Loading dock','Office']}],
    ['en',{...output,instruction:'Place sealed cartons on the blue shelf.'}],
  ]){
    const adapter=cloudflareGemma4Test(env,async()=>providerResult(result));
    assert.equal((await adapter.run({language})).status,502);
  }
  const limited=cloudflareGemma4Test(env,async()=>new Response('sensitive upstream details',{status:429}));
  assert.deepEqual(await limited.run({language:'en'}),{status:429,data:{error:'Cloudflare is rate limiting this test. Try again later.'}});
});
