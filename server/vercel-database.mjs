import {createSecureContext} from 'node:tls';

export function vercelRequestsLiveMode(env) {
  return env.UNDERSTOOD_TIER==='production' || env.UNDERSTOOD_AI_MODE==='live' || env.UNDERSTOOD_DATA_CLASS==='real';
}

export function vercelPostgresCaPem(env) {
  const pem=env.UNDERSTOOD_POSTGRES_CA_PEM;
  if(!pem)return undefined;
  if(env.UNDERSTOOD_POSTGRES_CA_FILE || typeof pem!=='string' || Buffer.byteLength(pem)>16384
    || !pem.trimStart().startsWith('-----BEGIN CERTIFICATE-----'))throw Error('Invalid Vercel PostgreSQL CA configuration');
  try{createSecureContext({ca:pem});}catch{throw Error('Invalid Vercel PostgreSQL CA configuration');}
  return pem;
}

export function vercelDatabaseOptions(env) {
  const production=env.UNDERSTOOD_TIER==='production';
  if(!production && vercelRequestsLiveMode(env))throw Error('Select the approved production runtime');

  const key=production?'UNDERSTOOD_POSTGRES_URL':'DATABASE_URL';
  const connectionString=env[key];
  if(!connectionString)throw Error(`${key} is required for a hosted deployment`);
  return {connectionString,tls:true,caFile:production?env.UNDERSTOOD_POSTGRES_CA_FILE:undefined,
    ...(production&&env.UNDERSTOOD_POSTGRES_CA_PEM?{caPem:vercelPostgresCaPem(env)}:{})};
}
