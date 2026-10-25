import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {shellWorker} from '../scripts/public-shell.mjs';

const bodies={'/index.html':'<html>Public application</html>','/assets/app-123.js':'export const app=true;'};
const manifest=Object.entries(bodies).map(([path,body])=>({path,hash:createHash('sha256').update(body).digest('hex')}));
function harness({badHash=false,failPut=false,windows=[]}={}) {
  const handlers={},stores=new Map(),fetches=[],shown=[],opened=[],closed=[];let claimed=0;
  const caches={keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),open:async key=>{
    if(!stores.has(key))stores.set(key,new Map());const store=stores.get(key);
    return {put:async(path,response)=>{if(failPut)throw Error('Disk full');store.set(path,response.clone());},match:async path=>store.get(path)?.clone()};
  }};
  let network=async(path,options)=>{
    fetches.push({path:typeof path==='string'?path:path.url,options});
    return new Response(badHash?'Changed':bodies[path] || 'Network',{status:200});
  };
  runInNewContext(shellWorker(manifest),{self:{location:{origin:'https://example.test'},clients:{claim:async()=>claimed++,matchAll:async()=>windows,openWindow:async url=>opened.push(url)},
    registration:{showNotification:async(title,options)=>shown.push({title,options})},addEventListener:(name,handler)=>handlers[name]=handler},caches,crypto:webcrypto,Uint8Array,URL,Response,fetch:(...args)=>network(...args)});
  return {stores,fetches,shown,opened,get closed(){return closed.length;},get claimed(){return claimed;},network(fn){network=fn;},lifecycle:async name=>{let work;handlers[name]({waitUntil:promise=>work=promise});await work;},fetch(path,options={}){
    let response;handlers.fetch({request:{url:new URL(path,'https://example.test').href,method:options.method || 'GET',mode:options.mode || 'cors',headers:new Headers(options.headers)},respondWith:value=>response=value});return response;
  },async message(data,source='https://example.test/#device'){
    let work,response;handlers.message({data,source:{url:source},ports:[{postMessage:value=>response=value}],waitUntil:promise=>work=promise});await work;return response;
  },async push(data){
    let work;handlers.push({data:data===null?null:{json:()=>{if(data instanceof Error)throw data;return data;}},waitUntil:promise=>work=promise});await work;
  },async click(){
    let work;handlers.notificationclick({notification:{close:()=>closed.push(true)},waitUntil:promise=>work=promise});await work;
  }};
}
test('public shell installs only integrity-checked anonymous build files',async()=>{
  const h=harness();await h.lifecycle('install');assert.equal(h.stores.size,1);
  assert.deepEqual([...h.stores.values()][0].keys().toArray(),Object.keys(bodies));
  for(const call of h.fetches)assert.deepEqual({...call.options},{credentials:'omit',cache:'reload',redirect:'error'});
  assert.equal(await (await h.fetch('/assets/app-123.js')).text(),bodies['/assets/app-123.js']);
});
test('changed bytes and failed cache writes leave no partial shell',async()=>{
  for(const options of [{badHash:true},{failPut:true}]){
    const h=harness(options);await assert.rejects(h.lifecycle('install'));assert.equal(h.stores.size,0);
  }
});
test('HTTP failure or a redirected install download cannot prepare a shell',async()=>{
  for(const network of [async()=>new Response('Unavailable',{status:503}),async()=>{throw Error('Redirect refused');}]){
    const h=harness();h.network(network);await assert.rejects(h.lifecycle('install'));assert.equal(h.stores.size,0);
  }
});
test('activation removes only obsolete public-shell caches',async()=>{
  const h=harness();await h.lifecycle('install');h.stores.set('understood-shell-v1-old',new Map());h.stores.set('other-application',new Map());
  await h.lifecycle('activate');assert.equal(h.stores.size,2);assert.ok(h.stores.has('other-application'));assert.equal(h.claimed,1);
  assert.doesNotMatch(shellWorker(manifest),/skipWaiting/);
});
test('private API, access-link queries, writes, authorization and foreign origins bypass the worker',()=>{
  const h=harness();for(const [path,options] of [['/api/session',{}],['/api/worker/recordings/123',{}],['/?token=secret',{mode:'navigate'}],['/assets/app-123.js?token=secret',{}],['/',{method:'POST',mode:'navigate'}],['/',{headers:{authorization:'Bearer secret'},mode:'navigate'}],['https://other.test/assets/app-123.js',{}],['/unlisted.js',{}]])assert.equal(h.fetch(path,options),undefined);
});
test('navigation uses the network and falls back to public HTML only on outage',async()=>{
  const h=harness();await h.lifecycle('install');
  h.network(async()=>new Response('Forbidden',{status:403}));assert.equal((await h.fetch('/',{mode:'navigate'})).status,403);
  h.network(async()=>new Response('Unavailable',{status:503}));assert.equal(await (await h.fetch('/',{mode:'navigate'})).text(),bodies['/index.html']);
  h.network(async()=>{throw Error('Offline');});assert.equal(await (await h.fetch('/',{mode:'navigate'})).text(),bodies['/index.html']);
});
test('runtime misses never populate the public cache',async()=>{
  const h=harness();h.network(async()=>new Response('Network'));await h.fetch('/assets/app-123.js');assert.equal([...h.stores.values()][0].size,0);
});
test('public shell readiness verifies every cached hash, not merely an active registration',async()=>{
  const h=harness();await h.lifecycle('install');const read=()=>h.message({type:'understood-shell-status'});
  assert.equal((await read()).ready,true);
  const cache=[...h.stores.values()][0];cache.delete('/assets/app-123.js');assert.equal((await read()).ready,false);
  cache.set('/assets/app-123.js',new Response('Changed'));assert.equal((await read()).ready,false);
  h.stores.clear();assert.equal((await read()).ready,false);
});
test('explicit public-cache repair reuses anonymous integrity checks and cannot report failed repair as ready',async()=>{
  const h=harness();const repair=()=>h.message({type:'understood-shell-status',repair:true});
  assert.equal((await repair()).ready,true);
  for(const call of h.fetches)assert.deepEqual({...call.options},{credentials:'omit',cache:'reload',redirect:'error'});
  h.stores.clear();h.network(async()=>new Response('Unavailable',{status:503}));assert.equal((await repair()).ready,false);
  assert.equal([...h.stores.values()][0].size,0);
  assert.equal(await h.message({type:'understood-shell-status',repair:true},'https://other.test/'),undefined);
  assert.equal(await h.message({type:'unknown',repair:true}),undefined);
});
test('push shows the bounded generic alert and ignores payload links',async()=>{
  const h=harness();await h.lifecycle('install');
  await h.push({title:'New instruction',body:'Open Understood to review it.',tag:'understood-instruction.available',url:'https://foreign.test/#/takeover'});
  assert.equal(h.shown.length,1);
  assert.equal(h.shown[0].title,'New instruction');
  assert.equal(h.shown[0].options.body,'Open Understood to review it.');
  assert.equal(h.shown[0].options.tag,'understood-instruction.available');
  assert.equal(h.shown[0].options.icon,'/icon-192.png');
  assert.equal(h.shown[0].options.badge,'/icon-192.png');
  assert.equal(h.shown[0].options.data.url,'/#notifications');
});
test('missing, malformed or oversized push payloads fall back to generic lock-screen copy',async()=>{
  const h=harness();
  await h.push(null);await h.push(Error('Invalid JSON'));await h.push({title:'x'.repeat(81),body:'line\nbreak',tag:'../../foreign'});
  assert.deepEqual(h.shown.map(item=>item.title),['Understood','Understood','Understood']);
  assert.equal(h.shown[0].options.body,'Open Understood to review new activity.');
  assert.equal(h.shown[0].options.tag,'understood-update');
  assert.equal(h.shown[2].options.body,'line break');
  assert.equal(h.shown[2].options.tag,'understood-update');
  for(const item of h.shown)assert.equal(item.options.data.url,'/#notifications');
});
test('notification click focuses a same-origin window, excludes foreign clients and ignores foreign URLs',async()=>{
  const events=[];
  const foreign={url:'https://foreign.test/#overview',focus:async()=>events.push('foreign-focus'),navigate:async()=>events.push('foreign-navigate')};
  const broken={url:'not a url',focus:async()=>events.push('broken-focus'),navigate:async()=>events.push('broken-navigate')};
  const own={url:'https://example.test/#briefings',focus:async()=>events.push('focus'),navigate:async url=>events.push(`navigate:${url}`)};
  const h=harness({windows:[foreign,broken,own]});await h.click();
  assert.equal(h.closed,1);assert.deepEqual(events,['focus','navigate:https://example.test/#notifications']);assert.deepEqual(h.opened,[]);
});
test('notification click does not re-navigate the current inbox and opens a window when none is usable',async()=>{
  const events=[];const current={url:'https://example.test/#notifications',focus:async()=>events.push('focus'),navigate:async()=>events.push('navigate')};
  const h=harness({windows:[current]});await h.click();assert.deepEqual(events,['focus']);assert.deepEqual(h.opened,[]);
  const empty=harness();await empty.click();assert.deepEqual(empty.opened,['https://example.test/#notifications']);assert.equal(empty.closed,1);
});
test('manifest rejects protected paths, duplicates and absent public HTML',()=>{
  for(const invalid of [[],[manifest[0],manifest[0]],[manifest[1]],[...manifest,{path:'/api/session',hash:manifest[0].hash}],[{path:'/index.html',hash:'invalid'}]])assert.throws(()=>shellWorker(invalid));
});
