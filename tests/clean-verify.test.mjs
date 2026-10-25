import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cleanVerifyEnvironment,snapshotCleanSource,runCleanVerification,runCleanCommand} from '../scripts/clean-verify.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'understood-clean-verify-'));
  t.after(async()=>{const {rm}=await import('node:fs/promises');await rm(root,{recursive:true,force:true});});
  for(const name of ['src','server','scripts','tests','public','evaluation','.github/workflows','data','node_modules','dist'])await mkdir(join(root,name),{recursive:true});
  for(const name of ['package.json','package-lock.json','index.html','operator.html','tsconfig.json','vite.config.ts','.github/workflows/verify.yml'])await writeFile(join(root,name),'fixture');
  await writeFile(join(root,'package-lock.json'),JSON.stringify({packages:{}}));
  await writeFile(join(root,'src','entry.ts'),'export const fixture=true;');
  for(const name of ['.env','data/private.sqlite','dist/old.js','node_modules/old.js'])await writeFile(join(root,name),'PRIVATE_NOT_FOR_SNAPSHOT');
  const npmCli=join(root,'npm-cli.js');await writeFile(npmCli,'');
  return {root,npmCli};
}

test('clean environment excludes cloud, database, provider and injected Node/npm configuration',()=>{
  const env=cleanVerifyEnvironment({PATH:'tools',PATHEXT:'.EXE;.CMD',ComSpec:'cmd.exe',SystemRoot:'Windows',GEMINI_API_KEY:'PRIVATE',UNDERSTOOD_PG_TEST_URL:'PRIVATE',
    UNDERSTOOD_NEON_TEST_URL:'PRIVATE',NODE_OPTIONS:'PRIVATE',NPM_CONFIG_REGISTRY:'PRIVATE',NPM_TOKEN:'PRIVATE'},'/isolated');
  assert.equal(env.PATH,'tools');assert.equal(env.NPM_CONFIG_OFFLINE,'true');
  assert.equal(env.PATHEXT,'.EXE;.CMD');assert.equal(env.ComSpec,'cmd.exe');
  assert.doesNotMatch(JSON.stringify(env),/PRIVATE/);assert.match(env.NPM_CONFIG_USERCONFIG,/npm-user\.config$/);
});

test('clean snapshot copies only selected source, never dependencies, build, data or environment',async t=>{
  const {root}=await fixture(t),destination=join(root,'snapshot'),result=await snapshotCleanSource(root,destination);
  assert.equal(result.files,8);assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(destination,'operator.html'),'utf8'),'fixture');
  for(const name of ['.env','data','dist','node_modules'])await assert.rejects(lstat(join(destination,name)),{code:'ENOENT'});
  assert.equal(await readFile(join(destination,'src/entry.ts'),'utf8'),'export const fixture=true;');
  await assert.rejects(snapshotCleanSource(root,root),/inside the workspace/);
});

test('private paths accidentally placed inside source reject before snapshot is created',async t=>{
  const {root}=await fixture(t);await writeFile(join(root,'src','.env.local'),'PRIVATE');
  await assert.rejects(snapshotCleanSource(root,join(root,'snapshot')),/Private or generated/);
  await assert.rejects(lstat(join(root,'snapshot')),{code:'ENOENT'});
});

test('clean verification requires exact confirmation before creating a run',async t=>{
  const {root,npmCli}=await fixture(t);
  for(const args of [[],['--confirm-local-clean','extra'],['--confirm-cloud']])await assert.rejects(runCleanVerification(root,args,{npmCli}),/confirm-local-clean/);
  await assert.rejects(lstat(join(root,'.clean-check')),{code:'ENOENT'});
});

test('fresh workflow installs offline, builds before hosted tests, evaluates and keeps isolated evidence',async t=>{
  const {root,npmCli}=await fixture(t),calls=[];
  const result=await runCleanVerification(root,['--confirm-local-clean'],{npmCli,env:{GEMINI_API_KEY:'PRIVATE',UNDERSTOOD_PG_TEST_URL:'PRIVATE'},runner:async(command,args,options)=>{
    calls.push({command,args,options});assert.notEqual(options.cwd,root);assert.doesNotMatch(JSON.stringify(options.env),/PRIVATE/);return {exitCode:0,timedOut:false};
  }});
  assert.equal(result.passed,true);assert.equal(result.report.sourceUnchanged,true);assert.equal(result.report.productionReady,false);
  assert.deepEqual(result.report.steps.map(row=>row.name),['install','build','tests','contract','pipeline']);
  assert.ok(calls[0].args.includes('--offline'));assert.ok(calls[1].args.includes('build'));assert.ok(calls[2].args.includes('test'));
  assert.equal(JSON.parse(await readFile(result.path,'utf8')).state,'passed');
});

test('a failed clean build stops before tests and retains a failed journal',async t=>{
  const {root,npmCli}=await fixture(t);let count=0;
  const result=await runCleanVerification(root,['--confirm-local-clean'],{npmCli,runner:async()=>({exitCode:++count===2?1:0,timedOut:false})});
  assert.equal(result.passed,false);assert.equal(count,2);assert.equal(result.report.steps.at(-1).state,'failed');
  assert.equal(JSON.parse(await readFile(result.path,'utf8')).state,'failed');
});

test('registry reads are explicit and reject non-registry locked URLs before commands',async t=>{
  const {root,npmCli}=await fixture(t);let calls=0;
  await writeFile(join(root,'package-lock.json'),JSON.stringify({packages:{dependency:{resolved:'https://untrusted.example.test/archive.tgz'}}}));
  const result=await runCleanVerification(root,['--confirm-local-clean','--allow-registry-reads'],{npmCli,runner:async()=>{calls++;return {exitCode:0};}});
  assert.equal(result.passed,false);assert.equal(calls,0);
  const env=cleanVerifyEnvironment({},root,{registryReads:true});assert.equal(env.NPM_CONFIG_OFFLINE,'false');
  assert.equal(env.NPM_CONFIG_REGISTRY,'https://registry.npmjs.org/');
});

test('source changes during verification cannot receive a clean pass',async t=>{
  const {root,npmCli}=await fixture(t);
  const result=await runCleanVerification(root,['--confirm-local-clean'],{npmCli,runner:async()=>{
    await writeFile(join(root,'src/entry.ts'),'changed');return {exitCode:0,timedOut:false};
  }});
  assert.equal(result.passed,false);assert.equal(result.report.sourceUnchanged,false);
});

test('actual owned command saves output and returns terminal status',async t=>{
  const {root}=await fixture(t),path=join(root,'command.log');
  assert.deepEqual(await runCleanCommand(process.execPath,['-e','console.log("synthetic command");console.error("synthetic diagnostic")'],
    {cwd:root,env:cleanVerifyEnvironment(process.env,root),logPath:path}),{exitCode:0,timedOut:false});
  const log=await readFile(path,'utf8');assert.match(log,/synthetic command/);assert.match(log,/synthetic diagnostic/);
});

test('CI builds files before tests that load the hosted public shell',async()=>{
  const text=await readFile(new URL('../.github/workflows/verify.yml',import.meta.url),'utf8');
  const buildIndex=text.indexOf('run: npm run build'),testIndexes=['run: npm test','run: npm run test:shard']
    .map(command=>text.indexOf(command)).filter(index=>index>=0);
  assert.equal(testIndexes.length,1);
  assert.ok(buildIndex>text.indexOf('run: npm ci'));
  assert.ok(buildIndex<testIndexes[0]);
});
