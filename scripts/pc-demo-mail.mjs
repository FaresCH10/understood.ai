import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {pcDemoConfig} from '../server/postgres/pc-demo-config.mjs';

const secretPath=resolve('artifacts/pc-demo/.env.email.local'),runtimePath=resolve('artifacts/pc-demo/runtime.json');
try{
  const action=process.argv[2];
  if(action==='init'){
    if(existsSync(secretPath))throw Error('Email secret file already exists; preserving it');
    writeFileSync(secretPath,[
      '# Private PC-only email configuration. Never paste the API key into chat.',
      '# Paste your Resend API key after the equals sign below, then save this file.',
      'UNDERSTOOD_EMAIL_MODE=resend','UNDERSTOOD_RESEND_KEY=',
      'UNDERSTOOD_EMAIL_FROM=onboarding@resend.dev',
      '# Keep this encryption key unchanged: outstanding verification links depend on it.',
      'UNDERSTOOD_AUTH_MAIL_KEY='+randomBytes(32).toString('hex'),''
    ].join('\n'),{flag:'wx',mode:0o600});
    console.log('Private email configuration file created. Delivery remains disabled until explicitly enabled.');
  }else if(['check','enable'].includes(action)){
    const saved=JSON.parse(readFileSync(runtimePath,'utf8')),mailEnv=parseEnv(readFileSync(secretPath,'utf8'));
    const config=pcDemoConfig(saved,{service:'api',mailEnv});
    if(!config.mail.available)throw Error('Email is disabled in the secret file');
    if(action==='enable'){saved.mailSecretPath=secretPath;writeFileSync(runtimePath,JSON.stringify(saved,null,2));}
    console.log(action==='enable'?'PC runtime now references the private mail file. Restart API and worker to activate.':'Mail configuration is valid. Secret values are not displayed.');
  }else throw Error('Use init, check or enable');
}catch(error){console.error(error.message==='Email secret file already exists; preserving it'?error.message:'Email setup incomplete. Check the private file, API key, sender and stable encryption key. Secret values are not logged.');process.exitCode=1;}
