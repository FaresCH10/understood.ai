import {mkdir,cp,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function pcDemoRoutes(tunnelOrigin){
  const url=new URL(tunnelOrigin);
  if(url.origin!==tunnelOrigin || url.protocol!=='https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname))throw Error('Exact quick tunnel origin required');
  return {version:3,routes:[
    {src:'/(.*)',headers:{'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), geolocation=()','Strict-Transport-Security':'max-age=31536000'},continue:true},
    {src:'/api(?:/(.*))?',dest:tunnelOrigin+'/api/$1',headers:{'Cache-Control':'private, no-store'}},
    {handle:'filesystem'},
    {src:'/(.*)',dest:'/index.html',headers:{'Cache-Control':'no-cache'}}
  ]};
}
async function main(){
  const settings=JSON.parse(await readFile('artifacts/pc-demo/runtime.json','utf8'));
  const root=resolve('artifacts/pc-demo/vercel'),output=join(root,'.vercel/output');
  await mkdir(join(output,'static'),{recursive:true});
  const entries=await readdir('dist');
  for(const name of entries){if(name.startsWith('.') || name.endsWith('.map') || name==='operator.html')continue;await cp(join('dist',name),join(output,'static',name),{recursive:true});}
  await writeFile(join(output,'config.json'),JSON.stringify(pcDemoRoutes(settings.tunnelOrigin),null,2));
  await writeFile(join(root,'vercel.json'),JSON.stringify({framework:null,buildCommand:null,outputDirectory:null}));
  console.log('Prepared static-only Vercel output. No database, secrets, server source, or in-memory API function included.');
}
if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(()=>{console.error('PC demo output preparation failed');process.exitCode=1;});
