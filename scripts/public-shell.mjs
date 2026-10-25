import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export function shellWorker(manifest) {
  if(!Array.isArray(manifest) || !manifest.length || new Set(manifest.map(item=>item.path)).size!==manifest.length
    || !manifest.some(item=>item.path==='/index.html') || manifest.some(item=>!/^\/(?:index\.html|manifest\.webmanifest|favicon\.svg|icon-(?:192|512)\.png|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/.test(item.path) || !/^[a-f0-9]{64}$/.test(item.hash)))
    throw Error('Invalid public shell manifest');
  const version=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return `const files=${JSON.stringify(manifest)};
const cacheName='understood-shell-v1-${version}';
const paths=new Set(files.map(file=>file.path));
const notificationPath='/#notifications';
function notificationCopy(event) {
  const fallback={title:'Understood',body:'Open Understood to review new activity.',tag:'understood-update'};
  let payload;
  try {payload=event.data?.json();}catch{return fallback;}
  if(!payload || typeof payload!=='object' || Array.isArray(payload))return fallback;
  const text=(value,max)=>typeof value==='string' && value.trim() && value.length<=max && !/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/.test(value)
    ? value.replace(/[\\r\\n\\t]+/g,' ').trim() : '';
  return {title:text(payload.title,80) || fallback.title,body:text(payload.body,200) || fallback.body,
    tag:/^understood-[a-z._-]{1,40}$/.test(payload.tag) ? payload.tag : fallback.tag};
}
async function matches(response,expected) {
  if(!response?.ok)return false;
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')===expected;
}
async function prepare() {
  const responses=await Promise.all(files.map(async file=>{
    const response=await fetch(file.path,{credentials:'omit',cache:'reload',redirect:'error'});
    if(!await matches(response,file.hash))throw Error('Public shell unavailable or changed');
    return [file.path,response];
  }));
  const cache=await caches.open(cacheName);
  try {for(const [path,response] of responses)await cache.put(path,response);}
  catch(error){await caches.delete(cacheName);throw error;}
}
async function ready() {
  const cache=await caches.open(cacheName);
  return (await Promise.all(files.map(async file=>matches(await cache.match(file.path),file.hash)))).every(Boolean);
}
self.addEventListener('install',event=>event.waitUntil(prepare()));
self.addEventListener('message',event=>{
  if(event.data?.type!=='understood-shell-status' || !event.ports?.[0] || !event.source?.url || new URL(event.source.url).origin!==self.location.origin)return;
  event.waitUntil((async()=>{
    let available=false;
    try {if(event.data.repair===true && !await ready())await prepare();available=await ready();}catch{}
    event.ports[0].postMessage({type:'understood-shell-status',ready:available});
  })());
});
self.addEventListener('push',event=>{
  const copy=notificationCopy(event);
  event.waitUntil(self.registration.showNotification(copy.title,{body:copy.body,tag:copy.tag,
    icon:'/icon-192.png',badge:'/icon-192.png',data:{url:notificationPath}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL(notificationPath,self.location.origin).href;
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=clients.find(item=>{try{return new URL(item.url).origin===self.location.origin;}catch{return false;}});
    if(client){
      await client.focus();
      if(client.url!==target && typeof client.navigate==='function')await client.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('understood-shell-v1-') && key!==cacheName)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin || url.search || request.headers.has('authorization'))return;
  if(request.mode==='navigate' && url.pathname==='/') {
    event.respondWith((async()=>{
      try {const response=await fetch(request);if(response.status<500)return response;}catch {}
      const response=await (await caches.open(cacheName)).match('/index.html');
      return response || Response.error();
    })());
  }else if(paths.has(url.pathname))event.respondWith((async()=>{
    const response=await (await caches.open(cacheName)).match(url.pathname);
    return response || fetch(request);
  })());
});
`;
}

export function publicShellPlugin() {
  let directory;
  return {
    name:'understood-public-shell',apply:'build',enforce:'post',
    configResolved(config){
      if(config.base!=='/')throw Error('The public shell requires root deployment');
      directory=join(config.root,config.build.outDir);
    },
    async writeBundle(_options,bundle){
      const paths=['index.html','manifest.webmanifest','favicon.svg','icon-192.png','icon-512.png',...Object.keys(bundle).filter(path=>/^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path))].sort();
      const manifest=await Promise.all(paths.map(async path=>({path:'/'+path,hash:createHash('sha256').update(await readFile(join(directory,path))).digest('hex')})));
      const {writeFile}=await import('node:fs/promises');
      await writeFile(join(directory,'sw.js'),shellWorker(manifest));
    },
  };
}
