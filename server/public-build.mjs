import {readFile,readdir,realpath,lstat} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';

const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webmanifest:'application/manifest+json; charset=utf-8',csv:'text/csv; charset=utf-8'};
const publicFiles=['index.html','sw.js','manifest.webmanifest','favicon.svg','icon-192.png','icon-512.png','product-workspace.jpg','worker-import-template.csv','auth/gulf-workplace.jpg','auth/worker-tablet.png','landing/gulf-site.jpg','landing/site-worker.png','landing/journey/retail.png','landing/journey/retail-place.jpg','landing/journey/site.png','landing/journey/site-place.jpg','landing/journey/hospitality.png','landing/journey/hospitality-place.jpg','landing/journey/food.png','landing/journey/food-place.jpg'];
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
async function operatorFiles(root) {
  const manifestPath=join(root,'.vite','manifest.json'),actual=await realpath(manifestPath),inside=relative(root,actual);
  if(inside.startsWith('..') || isAbsolute(inside) || !(await lstat(manifestPath)).isFile())throw Error('Invalid operator build manifest');
  const bytes=await readFile(manifestPath);if(bytes.length>1024*1024)throw Error('Invalid operator build manifest');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(!manifest || typeof manifest!=='object' || Array.isArray(manifest) || Object.keys(manifest).length>250
    || !Object.hasOwn(manifest,'operator.html') || manifest['operator.html']?.isEntry!==true
    || manifest['operator.html']?.src!=='operator.html')throw Error('Optimized operator entry is unavailable');
  const selected=new Set(['operator.html','favicon.svg']),visited=new Set();
  const asset=path=>{if(typeof path!=='string' || !/^assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path))throw Error('Invalid operator build asset');selected.add(path);};
  function visit(key) {
    if(visited.has(key))return;visited.add(key);
    if(!Object.hasOwn(manifest,key))throw Error('Operator build dependency is unavailable');
    const item=manifest[key];
    if(!item || typeof item!=='object' || Array.isArray(item) || key!=='operator.html' && item.isEntry)throw Error('Invalid operator build dependency');
    asset(item.file);
    for(const field of ['css','assets','imports','dynamicImports']) {
      if(item[field]===undefined)continue;
      if(!Array.isArray(item[field]) || item[field].length>250 || item[field].some(value=>typeof value!=='string'))throw Error('Invalid operator build dependency');
      for(const value of item[field])if(field==='imports' || field==='dynamicImports')visit(value);else asset(value);
    }
  }
  visit('operator.html');return [...selected];
}

export async function loadOperatorBuild(directory) {return loadBuild(directory,true);}
export async function loadPublicBuild(directory) {return loadBuild(directory,false);}
async function loadBuild(directory,operator) {
  const root=await realpath(resolve(directory)),files=new Map();let total=0;
  const names=await readdir(join(root,'assets'));
  const assets=names.filter(name=>/^[A-Za-z0-9_.-]+\.(?:js|css)$/.test(name));
  if(!assets.length || assets.length>250)throw Error('Optimized public build is unavailable');
  const selected=operator?await operatorFiles(root):[...publicFiles,...assets.map(name=>`assets/${name}`)];
  for(const path of selected) {
    const target=join(root,path),actual=await realpath(target),inside=relative(root,actual);
    if(inside.startsWith('..') || isAbsolute(inside) || !(await lstat(target)).isFile())throw Error('Invalid public build file');
    const bytes=await readFile(target);total+=bytes.length;if(total>20*1024*1024)throw Error('Public build exceeds delivery limit');
    files.set('/'+path,{bytes,type:types[path.split('.').at(-1)],etag:`"${createHash('sha256').update(bytes).digest('hex')}"`});
  }
  const entry=operator?'/operator.html':'/index.html',html=files.get(entry).bytes.toString('utf8');
  if(html.includes('/src/') || !/src="\/assets\/[A-Za-z0-9_.-]+\.js"/.test(html))throw Error('Use an optimized public build, not development HTML');
  for(const match of html.matchAll(/(?:src|href)="(\/(?:assets\/[^"?#]+|favicon\.svg|manifest\.webmanifest|icon-192\.png))"/g))if(!files.has(match[1]))throw Error('Public build references a missing file');
  if(operator && /serviceWorker|manifest\.webmanifest|\/sw\.js/.test(html))throw Error('Operator entry must not register the customer offline shell');
  return (req,res,url)=>{
    const headers={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':operator?csp.replace("worker-src 'self'","worker-src 'none'"):csp,'permissions-policy':operator?'microphone=(), camera=(), geolocation=()':'microphone=(self), camera=(), geolocation=()'};
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,'cache-control':'no-store',allow:'GET, HEAD'});return res.end();}
    const path=url.pathname==='/' || operator && url.pathname==='/index.html'?entry:url.pathname,file=files.get(path);
    if(!file){res.writeHead(404,{...headers,'cache-control':'no-store'});return res.end();}
    const immutable=/^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(path);
    const cache=url.search || operator && path===entry?'no-store':immutable?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate';
    const responseHeaders={...headers,'content-type':file.type,'cache-control':cache,etag:file.etag,...(path==='/sw.js'?{'service-worker-allowed':'/'}:{})};
    if(req.headers['if-none-match']===file.etag){res.writeHead(304,responseHeaders);return res.end();}
    res.writeHead(200,{...responseHeaders,'content-length':file.bytes.length});res.end(req.method==='HEAD'?undefined:file.bytes);
  };
}
