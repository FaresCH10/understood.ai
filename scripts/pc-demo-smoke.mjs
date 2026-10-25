import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
const saved=JSON.parse(readFileSync('artifacts/pc-demo/runtime.json','utf8'));
const live=process.argv.includes('--public'),base=live?saved.publicOrigin:`http://127.0.0.1:${saved.port}`;
const credentials=readFileSync('artifacts/pc-demo/LOGIN.private.txt','utf8');
const email=credentials.match(/Staff email: (.+)/)[1],password=credentials.match(/Password: (.+)/)[1];
const transport=live?{}:{host:new URL(saved.tunnelOrigin).host,'x-forwarded-proto':'https','cf-connecting-ip':'192.0.2.10'};
const request=(path,options={})=>live?fetch(base+path,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)}):new Promise((done,reject)=>{
  const req=httpRequest(base+path,{method:options.method??'GET',headers:{...transport,...options.headers},timeout:20000},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers=new Headers();for(const [key,value] of Object.entries(res.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);done(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Request timed out')));req.end(options.body);
});
try{
  let r=await request('/api/health');assert.equal(r.status,200);assert.equal((await r.json()).backend,'postgres-hosted-synthetic');
  r=await request('/api/session');assert.equal((await r.json()).authenticated,false);
  r=await request('/api/auth/staff/login',{method:'POST',headers:{Origin:saved.publicOrigin,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.ok(cookie?.includes('Secure'));assert.ok(cookie?.includes('HttpOnly'));assert.ok(cookie?.includes('SameSite=Strict'));
  r=await request('/api/session',{headers:{Cookie:cookie.split(';')[0]}});assert.equal(r.status,200);const session=await r.json();assert.equal(session.authenticated,true);
  r=await request('/api/auth/staff/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,403);
  r=await request('/api/demo/session',{method:'POST',headers:{Origin:saved.publicOrigin,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,404);
  const result={checkedAt:new Date().toISOString(),public:live,health:true,persistentPostgresLogin:true,secureCookie:true,crossOriginRejected:true,predictableDemoLoginDisabled:true};
  writeFileSync(`artifacts/pc-demo/smoke-${live?'public':'local'}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error('PC demo smoke failed:',error.message?.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[redacted]'));process.exitCode=1;}
