import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {loadOperatorBuild} from '../server/public-build.mjs';

const manifest={
  'operator.html':{file:'assets/operator-abcdefgh.js',src:'operator.html',isEntry:true,imports:['_shared.js'],dynamicImports:['src/Console.tsx'],css:['assets/operator-abcdefgh.css']},
  '_shared.js':{file:'assets/shared-abcdefgh.js'},
  'src/Console.tsx':{file:'assets/Console-abcdefgh.js',isDynamicEntry:true},
  'index.html':{file:'assets/customer-abcdefgh.js',src:'index.html',isEntry:true},
};
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'understood-operator-build-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'assets'));await mkdir(join(root,'.vite'));
  const html='<!doctype html><html><head><title>Understood Operations</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/assets/operator-abcdefgh.css"></head><body><div id="root"></div><script type="module" src="/assets/operator-abcdefgh.js"></script></body></html>';
  await writeFile(join(root,'operator.html'),html);await writeFile(join(root,'favicon.svg'),'<svg/>');
  await writeFile(join(root,'.vite','manifest.json'),JSON.stringify(manifest));
  for(const name of ['operator-abcdefgh.js','operator-abcdefgh.css','shared-abcdefgh.js','Console-abcdefgh.js','customer-abcdefgh.js'])await writeFile(join(root,'assets',name),name);
  await writeFile(join(root,'index.html'),'CUSTOMER ENTRY');await writeFile(join(root,'sw.js'),'CUSTOMER SHELL');
  return {root,html,save:value=>writeFile(join(root,'.vite','manifest.json'),JSON.stringify(value))};
}
test('operator build serves only its entry graph, without customer PWA, microphone or customer assets',async t=>{
  const f=await fixture(t),handler=await loadOperatorBuild(f.root),server=createServer((req,res)=>handler(req,res,new URL(req.url,'http://127.0.0.1')));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/','/index.html','/operator.html']) {
    const result=await fetch(base+path);assert.equal(result.status,200);assert.equal(await result.text(),f.html);
    assert.equal(result.headers.get('cache-control'),'no-store');assert.match(result.headers.get('content-security-policy'),/worker-src 'none'/);
    assert.equal(result.headers.get('permissions-policy'),'microphone=(), camera=(), geolocation=()');
  }
  for(const name of ['operator-abcdefgh.js','operator-abcdefgh.css','shared-abcdefgh.js','Console-abcdefgh.js']) {
    const result=await fetch(base+'/assets/'+name);assert.equal(result.status,200);assert.equal(await result.text(),name);
    assert.match(result.headers.get('cache-control'),/immutable/);
    assert.equal((await fetch(base+'/assets/'+name,{headers:{'if-none-match':result.headers.get('etag')}})).status,304);
  }
  for(const path of ['/assets/customer-abcdefgh.js','/sw.js','/manifest.webmanifest','/worker-import-template.csv','/product-workspace.jpg','/auth/gulf-workplace.jpg','/auth/worker-tablet.png','/landing/gulf-site.jpg','/landing/site-worker.png','/landing/journey/retail.png','/landing/journey/retail-place.jpg','/landing/journey/site.png','/landing/journey/site-place.jpg','/landing/journey/hospitality.png','/landing/journey/hospitality-place.jpg','/landing/journey/food.png','/landing/journey/food-place.jpg','/.vite/manifest.json','/.env','/src/operator-entry.tsx'])assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await fetch(base+'/',{method:'POST',body:'synthetic'})).status,405);
  const head=await fetch(base+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('operator build rejects missing, malformed, escaping and other-entry manifest dependencies',async t=>{
  const f=await fixture(t);
  const changes=[null,[],{}, {...manifest,'operator.html':{...manifest['operator.html'],isEntry:false}},
    {...manifest,'operator.html':{...manifest['operator.html'],src:'index.html'}},
    {...manifest,'_shared.js':{file:'../private.js'}},
    {...manifest,'_shared.js':{file:'assets/private.map'}},
    {...manifest,'operator.html':{...manifest['operator.html'],imports:['index.html']}},
    {...manifest,'operator.html':{...manifest['operator.html'],imports:['missing']}},
    {...manifest,'operator.html':{...manifest['operator.html'],imports:'_shared.js'}},
    {...manifest,'operator.html':{...manifest['operator.html'],css:[null]}}];
  for(const value of changes){await f.save(value);await assert.rejects(loadOperatorBuild(f.root));}
  await f.save(manifest);await writeFile(join(f.root,'operator.html'),f.html.replace('</head>','<link rel="manifest" href="/manifest.webmanifest"></head>'));
  await assert.rejects(loadOperatorBuild(f.root),/missing file|offline shell/);
  await writeFile(join(f.root,'operator.html'),f.html.replace('operator-abcdefgh.js','missing-abcdefgh.js'));
  await assert.rejects(loadOperatorBuild(f.root),/missing file/);
  await rm(join(f.root,'.vite','manifest.json'));await assert.rejects(loadOperatorBuild(f.root),{code:'ENOENT'});
});
test('operator build refuses a linked manifest directory escaping its build directory',async t=>{
  const f=await fixture(t),outside=await mkdtemp(join(tmpdir(),'understood-operator-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true}));
  const target=join(outside,'manifest.json');await writeFile(target,JSON.stringify(manifest));await rm(join(f.root,'.vite'),{recursive:true});
  await symlink(outside,join(f.root,'.vite'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(loadOperatorBuild(f.root),/Invalid operator build manifest/);
});
