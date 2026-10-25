import {tokenHash} from './auth-crypto.mjs';

export const AUTH_WINDOW_MS=15*60_000;
export const AUTH_GLOBAL_LIMIT=1000;
export const AUTH_KEY_LIMIT=2500;
export const AUTH_GLOBAL_KEY=tokenHash('understood:public-auth-budget:v1');

// Call inside a write transaction, before account lookup or expensive password work.
export function consumeAuthBudget(db,keys,limit,{increment=true,now=new Date().toISOString()}={}) {
  const unique=[...new Set(keys)],cutoff=new Date(Date.parse(now)-AUTH_WINDOW_MS).toISOString();
  db.prepare('DELETE FROM auth_attempts WHERE window_started_at<=?').run(cutoff);
  const read=db.prepare('SELECT count,window_started_at FROM auth_attempts WHERE key_hash=?');
  const global=read.get(AUTH_GLOBAL_KEY),rows=unique.map(key=>read.get(key));
  if(global?.count>=AUTH_GLOBAL_LIMIT || rows.some(row=>row?.count>=limit)) return false;
  const missing=rows.filter(row=>!row).length+(!global ? 1 : 0);
  if(db.prepare('SELECT COUNT(*) n FROM auth_attempts').get().n+missing>AUTH_KEY_LIMIT) return false;
  const save=db.prepare('INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET count=excluded.count,window_started_at=excluded.window_started_at');
  save.run(AUTH_GLOBAL_KEY,(global?.count ?? 0)+1,global?.window_started_at ?? now);
  unique.forEach((key,index)=>save.run(key,(rows[index]?.count ?? 0)+(increment ? 1 : 0),rows[index]?.window_started_at ?? now));
  return true;
}

export function recordAuthFailure(db,key,now=new Date().toISOString()) {
  const row=db.prepare('SELECT count,window_started_at FROM auth_attempts WHERE key_hash=?').get(key);
  if(!row || Date.parse(now)-Date.parse(row.window_started_at)>=AUTH_WINDOW_MS){
    db.prepare('INSERT INTO auth_attempts VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET count=excluded.count,window_started_at=excluded.window_started_at')
      .run(key,1,now);
  } else db.prepare('UPDATE auth_attempts SET count=count+1 WHERE key_hash=?').run(key);
}
