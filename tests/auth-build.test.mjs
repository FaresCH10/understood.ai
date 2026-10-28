import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {loadPublicBuild} from '../server/public-build.mjs';

test('optimized customer delivery serves the authentication and landing images with correct bytes, MIME and cache validation',async t=>{
  const handler=await loadPublicBuild('dist');
  const server=createServer((req,res)=>handler(req,res,new URL(req.url,'http://127.0.0.1')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const [path,type] of [['/auth/gulf-workplace.jpg','image/jpeg'],['/auth/worker-tablet.png','image/png'],['/landing/gulf-site.jpg','image/jpeg'],['/landing/site-worker.png','image/png'],['/landing/journey/retail.png', 'image/png'],['/landing/journey/retail-place.jpg', 'image/jpeg'],['/landing/journey/site.png', 'image/png'],['/landing/journey/site-place.jpg', 'image/jpeg'],['/landing/journey/hospitality.png', 'image/png'],['/landing/journey/hospitality-place.jpg', 'image/jpeg'],['/landing/journey/food.png', 'image/png'],['/landing/journey/food-place.jpg', 'image/jpeg']]){
    const response=await fetch(base+path);
    assert.equal(response.status,200,path);
    assert.equal(response.headers.get('content-type'),type);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile('public'+path));
    assert.equal((await fetch(base+path,{headers:{'if-none-match':response.headers.get('etag')}})).status,304);
    const head=await fetch(base+path,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(base+path,{method:'POST',body:'unavailable'})).status,405);
  }
  assert.equal((await fetch(base+'/auth/private-source.jpg')).status,404);
});
