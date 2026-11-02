import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const roots=['api','src','server','scripts','tests','public','evaluation'];
const files=['package.json','package-lock.json','index.html','operator.html','tsconfig.json','vite.config.ts','.github/workflows/verify.yml'];
const excluded=new Set(['node_modules','dist','data','artifacts','references','.git','.npm-cache','.clean-check','.npmrc']);
const hash=value=>createHash('sha256').update(value).digest('hex');

export function cleanVerifyEnvironment(env={},directory,{registryReads=false}={}){
  const result={};
  for(const name of ['PATH','Path','PATHEXT','ComSpec','COMSPEC','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','LANG','LC_ALL','TZ'])
    if(typeof env[name]==='string')result[name]=env[name];
  return {...result,NPM_CONFIG_USERCONFIG:join(directory,'npm-user.config'),NPM_CONFIG_GLOBALCONFIG:join(directory,'npm-global.config'),
    NPM_CONFIG_OFFLINE:String(!registryReads),NPM_CONFIG_REGISTRY:'https://registry.npmjs.org/',NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false'};
}

async function sourceInventory(root){
  const rows=[];
  async function visit(name){
    const path=join(root,name),info=await lstat(path),base=name.split(/[\\/]/).at(-1);
    if(info.isSymbolicLink())throw Error('Clean verification refuses linked source paths');
    if(excluded.has(base) || base.startsWith('.env'))throw Error('Private or generated path found in clean source selection');
    if(info.isDirectory()){
      for(const child of (await readdir(path)).sort())await visit(join(name,child));
    }else if(info.isFile()){
      const bytes=await readFile(path);
      rows.push({path:name.replaceAll('\\','/'),bytes:bytes.length,sha256:hash(bytes)});
    }else throw Error('Clean verification requires regular source files');
  }
  for(const name of [...roots,...files])await visit(name);
  return rows.sort((a,b)=>a.path.localeCompare(b.path));
}

export async function snapshotCleanSource(root,destination){
  root=resolve(root);destination=resolve(destination);
  if(relative(root,destination).startsWith('..') || !relative(root,destination))throw Error('Clean snapshot must be inside the workspace');
  if((await lstat(root)).isSymbolicLink())throw Error('Linked workspace is not allowed');
  const rows=await sourceInventory(root);
  await mkdir(destination,{mode:0o700});
  for(const row of rows){
    const source=join(root,row.path),target=join(destination,row.path),bytes=await readFile(source);
    if(hash(bytes)!==row.sha256)throw Error('Source changed while capturing clean snapshot');
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    await writeFile(target,bytes,{flag:'wx',mode:0o600});
  }
  if(JSON.stringify(rows)!==JSON.stringify(await sourceInventory(root)))throw Error('Source changed while capturing clean snapshot');
  return {files:rows.length,sha256:hash(JSON.stringify(rows))};
}

export async function runCleanCommand(command,args,{cwd,env,logPath,timeoutMs=900000}={}){
  const {open}=await import('node:fs/promises'),log=await open(logPath,'wx',0o600);
  let child,timedOut=false;
  try{
    child=spawn(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
    const completion=new Promise(resolve=>{child.once('error',()=>resolve({exitCode:null,spawnFailed:true}));child.once('close',exitCode=>resolve({exitCode}));});
    const timer=setTimeout(()=>{
      timedOut=true;
      if(process.platform==='win32' && child.pid && child.exitCode===null){
        const killer=spawn(join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],
          {shell:false,windowsHide:true,stdio:'ignore'});
        killer.once('error',()=>child.kill());
      }else child.kill();
    },timeoutMs);timer.unref();
    try{return {...await completion,timedOut};}finally{clearTimeout(timer);}
  }finally{await log.close();}
}

export async function runCleanVerification(root,args=[],{env=process.env,npmCli,runner=runCleanCommand}={}){
  if(![1,2].includes(args.length) || args[0]!=='--confirm-local-clean' || args.length===2 && args[1]!=='--allow-registry-reads')
    throw Error('Use clean-verify.mjs --confirm-local-clean [--allow-registry-reads]; no cloud configuration is inherited');
  const registryReads=args.length===2;
  root=resolve(root);
  npmCli ??= join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  if(!(await lstat(npmCli)).isFile())throw Error('A local npm-cli.js installation is required');
  const parent=join(root,'.clean-check');
  await mkdir(parent,{recursive:true,mode:0o700});
  if((await lstat(parent)).isSymbolicLink())throw Error('Clean verification directory must not be linked');
  const id=randomUUID(),run=join(parent,id),workspace=join(run,'workspace');
  await mkdir(run,{mode:0o700});
  const evidencePath=join(run,'result.json'),report={id,startedAt:new Date().toISOString(),state:'running',productionReady:false,
    scope:'local-clean-install',registryReads,cloudConfigurationInherited:false,originalDataCopied:false,steps:[]};
  const checkpoint=()=>writeFile(evidencePath,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  await checkpoint();
  try{
    report.source=await snapshotCleanSource(root,workspace);
    const lock=JSON.parse(await readFile(join(workspace,'package-lock.json'),'utf8'));
    if(registryReads && Object.values(lock.packages || {}).some(row=>row.resolved && !/^https:\/\/registry\.npmjs\.org\//.test(row.resolved)))
      throw Error('Clean installation allows only locked npm registry package URLs');
    for(const name of ['npm-user.config','npm-global.config'])await writeFile(join(run,name),'',{flag:'wx',mode:0o600});
    const childEnv=cleanVerifyEnvironment(env,run,{registryReads});
    const commands=[['install',npmCli,['ci',registryReads?'--prefer-offline':'--offline','--no-audit','--no-fund','--cache',join(root,'.npm-cache')]],
      ['build',npmCli,['run','build']],['tests',npmCli,['test']],
      ['contract',npmCli,['run','evaluate:contract','--','--output',join(run,'contract.json')]],
      ['pipeline',npmCli,['run','evaluate:rehearsal','--','--output',join(run,'pipeline.json')]]];
    for(const [name,script,commandArgs] of commands){
      const step={name,state:'running',startedAt:new Date().toISOString()};report.steps.push(step);await checkpoint();
      const result=await runner(process.execPath,[script,...commandArgs],{cwd:workspace,env:childEnv,logPath:join(run,name+'.log')});
      Object.assign(step,result,{state:result.exitCode===0 && !result.timedOut?'passed':'failed',finishedAt:new Date().toISOString()});await checkpoint();
      if(step.state!=='passed')throw Error('Clean verification command failed');
    }
    report.sourceUnchanged=hash(JSON.stringify(await sourceInventory(root)))===report.source.sha256;
    if(!report.sourceUnchanged)throw Error('Source changed during clean verification');
    report.state='passed';
  }catch{report.state='failed';}
  report.finishedAt=new Date().toISOString();await checkpoint();
  return {passed:report.state==='passed',path:evidencePath,report};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await runCleanVerification(resolve(dirname(fileURLToPath(import.meta.url)),'..'),process.argv.slice(2));
    console.log(JSON.stringify({passed:result.passed,evidence:result.path,productionReady:false}));
    if(!result.passed)process.exitCode=1;
  }catch{console.error('Clean verification refused: check confirmation, regular source paths and local npm installation. No cloud test is enabled.');process.exitCode=2;}
}
