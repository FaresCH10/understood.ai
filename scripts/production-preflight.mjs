import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {productionAdmissionConfig} from '../server/postgres/production-admission.mjs';
import {loadPublicBuild,loadOperatorBuild} from '../server/public-build.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
function read(name){const path=resolve(root,name);if(!existsSync(path)||statSync(path).size>65536)throw Error(`${name} is missing or too large`);return readFileSync(path,'utf8');}
function approvalPath(value){if(typeof value!=='string'||!value)throw Error('Production approval file required');return value.startsWith('/run/understood/')?join(root,'deploy/runtime',value.slice('/run/understood/'.length)):resolve(value);}
function configFor(env,service){const path=approvalPath(env.UNDERSTOOD_RELEASE_APPROVAL_FILE);let approvalManifest;try{if(statSync(path).size>65536)throw Error();approvalManifest=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Production approval file unavailable');}return productionAdmissionConfig(env,{service,approvalManifest});}
async function main(){
  const apiEnv=parseEnv(read('.env.production')),workerEnv={...apiEnv,...parseEnv(read('.env.production.worker'))},operatorEnv=parseEnv(read('.env.production.operator'));
  const configs=[configFor(apiEnv,'api'),configFor(workerEnv,'worker'),configFor(operatorEnv,'operator')];
  const identities=[apiEnv,workerEnv,operatorEnv].map(env=>new URL(env.UNDERSTOOD_POSTGRES_URL));
  if(new Set(identities.map(url=>decodeURIComponent(url.username))).size!==3||new Set(identities.map(url=>url.password)).size!==3)throw Error('Production services require distinct database logins and passwords');
  if(new Set(identities.map(url=>url.hostname+url.pathname)).size!==1||new Set(configs.map(config=>config.schema)).size!==1)throw Error('Production services must use the same database and schema');
  if(JSON.stringify(configs[0].geminiSettings)!==JSON.stringify(configs[1].geminiSettings))throw Error('API and worker Gemini configuration differ');
  if(configs[0].publicOrigin!==configs[1].publicOrigin||configs[2].customerOrigin!==configs[0].publicOrigin)throw Error('Production origins do not match');
  const caddy=parseEnv(read('deploy/.env.caddy'));
  if('https://'+caddy.UNDERSTOOD_CUSTOMER_HOST!==configs[0].publicOrigin||'https://'+caddy.UNDERSTOOD_OPERATOR_HOST!==configs[2].publicOrigin)throw Error('Caddy origins do not match production configuration');
  read('compose.production.yaml');read('compose.production.operator.yaml');
  await loadPublicBuild(resolve(root,'dist'));await loadOperatorBuild(resolve(root,'dist'));
  console.log(JSON.stringify({configurationReady:true,networkRequests:0,deployed:false,externalChecksPerformed:false,services:configs.map(config=>config.service)},null,2));
}
main().catch(error=>{console.error('Production preflight failed: '+error.message);process.exitCode=1;});
