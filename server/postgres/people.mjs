import { randomUUID } from 'node:crypto';
import { normalizeWorkerLogin } from '../worker-credentials-input.mjs';
import { inputKeys,name,createWorkerInput,workerFilters,crewChangeInput,crewFilters,crewRecipientId,reactivationInput,reactivationReplay,
  selectWorkerLanguageInput,requestWorkerLanguageInput,languageRequestFilters,languageDecisionInput } from '../people.mjs';
import { isWorkerLanguage } from '../languages.mjs';
import { domainTransaction,domainAudit,requirePrincipal } from './domain.mjs';
import { requireWritableEntitlement } from './entitlements.mjs';
import { requireWorkerCapacity } from './worker-capacity.mjs';
import { recordWorkerEvent } from './notification-events.mjs';

function languageRequestDto(row) {
  return {id:row.id,workerId:row.worker_id,workerCode:row.worker_code ?? null,workerName:row.worker_name ?? null,
    currentLanguage:row.current_language,requestedLanguage:row.requested_language,reason:row.reason,state:row.state,
    requestedAt:row.requested_at,decidedAt:row.decided_at ?? null,decidedBy:row.decided_by ?? null,
    decisionNote:row.decision_note ?? null,...(row.worker_active===undefined ? {} : {workerActive:!!row.worker_active})};
}

function workerDto(row) {
  const {pending_request_id,pending_requested_language,pending_current_language,pending_reason,pending_requested_at,...rest}=row;
  return {...rest,name:row.name ?? null,active:!!row.active,
    language_selection_required:!!row.language_selection_required,language_selected:!row.language_selection_required,
    language_selected_at:row.language_selected_at ?? null,language_selected_by:row.language_selected_by ?? null,
    pending_language_request:pending_request_id ? {id:pending_request_id,currentLanguage:pending_current_language,
      requestedLanguage:pending_requested_language,reason:pending_reason,requestedAt:pending_requested_at} : null};
}

const workerColumns=`w.id,w.org_id,w.site_id,w.code,w.name,w.language,w.language_selection_required,
  w.language_selected_at,w.language_selected_by,w.active`;

const workerJoins=`LEFT JOIN worker_language_requests lr ON lr.worker_id=w.id AND lr.org_id=w.org_id AND lr.site_id=w.site_id AND lr.state='pending'
  LEFT JOIN crew_memberships cm ON cm.worker_id=w.id AND cm.org_id=w.org_id AND cm.site_id=w.site_id
  LEFT JOIN crews c ON c.id=cm.crew_id AND c.org_id=w.org_id AND c.site_id=w.site_id`;

const workerPendingColumns=`lr.id AS pending_request_id,lr.requested_language AS pending_requested_language,
  lr.current_language AS pending_current_language,lr.reason AS pending_reason,lr.requested_at AS pending_requested_at`;

async function workerRow(client,session,workerId,{lock=false}={}) {
  const row=(await client.query(`SELECT ${workerColumns},${workerPendingColumns},cm.crew_id,c.name AS crew_name FROM workers w
    ${workerJoins}
    WHERE w.id=$1 AND w.org_id=$2 AND w.site_id=$3 ${lock ? 'FOR UPDATE OF w' : ''}`,[workerId,session.org_id,session.site_id])).rows[0];
  if (!row) throw new Error('Worker unavailable');
  return workerDto(row);
}

async function requireWorkerSelf(client,session,{lock=false}={}) {
  await requirePrincipal(client,session,'worker');
  const row=(await client.query(`SELECT * FROM workers WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true
    ${lock ? 'FOR UPDATE' : ''}`,[session.principal_id,session.org_id,session.site_id])).rows[0];
  if (!row) throw new Error('Forbidden');
  return row;
}

export async function listWorkers(pool,session,filters={}, {schema='public'}={}) {
  const {page,pageSize,search,selectedLanguage,status,crewId,workerId}=workerFilters(filters);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    if(!['all','none'].includes(crewId)) await crewRow(client,session,crewId);
    // Count and page are from one statement snapshot, including an empty requested page.
    const row=(await client.query(`WITH filtered AS (SELECT ${workerColumns},${workerPendingColumns},cm.crew_id,c.name AS crew_name
      FROM workers w ${workerJoins}
      WHERE w.org_id=$1 AND w.site_id=$2 AND ($3='' OR strpos(lower(w.code),lower($3))>0 OR strpos(lower(COALESCE(w.name,'')),lower($3))>0)
      AND ($4='all' OR ($4='unset' AND w.language_selection_required) OR ($4<>'unset' AND w.language=$4 AND NOT w.language_selection_required))
      AND ($5='all' OR w.active=($5='active'))
      AND ($6='all' OR ($6='none' AND cm.worker_id IS NULL) OR cm.crew_id=$6) AND ($9::text IS NULL OR w.id=$9))
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
        (SELECT COALESCE(jsonb_agg(result ORDER BY lower(result.code),result.id),'[]') FROM
          (SELECT * FROM filtered ORDER BY lower(code),id LIMIT $7 OFFSET $8) result) AS items`,
    [session.org_id,session.site_id,search.trim(),selectedLanguage,status,crewId,pageSize,(page-1)*pageSize,workerId])).rows[0];
    return {...row,items:row.items.map(workerDto),page,pageSize};
  });
}

async function writeConflict(operation) {
  try {return await operation();} catch (error) {
    if (error.code==='23505') throw new Error('Directory entry already exists');
    throw error;
  }
}

export async function createWorker(pool,session,input,{schema='public'}={}) {
  const content=createWorkerInput(input),workerId=randomUUID(),login=normalizeWorkerLogin(content.code);
  return writeConflict(() => domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    await requireWritableEntitlement(client,session.org_id);
    if((await client.query('SELECT id FROM workers WHERE org_id=$1 AND upper(code)=$2',[session.org_id,login])).rows.length
      || (await client.query('SELECT worker_id FROM worker_credentials WHERE org_id=$1 AND login_id=$2',[session.org_id,login])).rows.length)
      throw new Error('Worker ID already in use');
    await requireWorkerCapacity(client,session.org_id);
    if (content.language===undefined) {
      await client.query(`INSERT INTO workers(id,org_id,site_id,code,name,language,language_selection_required)
        VALUES ($1,$2,$3,$4,$5,'en',true)`,[workerId,session.org_id,session.site_id,content.code,content.name]);
    } else {
      await client.query(`INSERT INTO workers(id,org_id,site_id,code,name,language,language_selection_required,
        language_selected_at,language_selected_by) VALUES ($1,$2,$3,$4,$5,$6,false,clock_timestamp(),'staff')`,
        [workerId,session.org_id,session.site_id,content.code,content.name,content.language]);
    }
    await domainAudit(client,session,'worker.created',workerId);
    return workerRow(client,session,workerId);
  }));
}

export async function updateWorker(pool,session,workerId,input,{schema='public'}={}) {
  inputKeys(input,['code','name','language']);
  if (!Object.keys(input).length) throw new Error('Invalid input');
  return writeConflict(() => domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const before=await workerRow(client,session,workerId,{lock:true});
    const code=input.code===undefined ? before.code : name(input.code,'worker code');
    const workerName=input.name===undefined ? before.name : input.name===null ? null : name(input.name,'worker name');
    const requestedLanguage=input.language===undefined ? before.language : input.language;
    if(!isWorkerLanguage(requestedLanguage)) throw new Error('Invalid language');
    const codeChanged=code!==before.code,nameChanged=workerName!==before.name;
    const languageChanged=requestedLanguage!==before.language,selecting=input.language!==undefined && before.language_selection_required;
    if (codeChanged || nameChanged || languageChanged || selecting) {
      if (codeChanged) {
        const login=normalizeWorkerLogin(code);
        if((await client.query('SELECT id FROM workers WHERE org_id=$1 AND upper(code)=$2 AND id<>$3',[session.org_id,login,workerId])).rows.length
          || (await client.query('SELECT worker_id FROM worker_credentials WHERE org_id=$1 AND login_id=$2 AND worker_id<>$3',[session.org_id,login,workerId])).rows.length)
          throw new Error('Worker ID already in use');
        await client.query(`UPDATE worker_credentials SET login_id=$4,updated_at=clock_timestamp()
          WHERE worker_id=$1 AND org_id=$2 AND site_id=$3`,[workerId,session.org_id,session.site_id,login]);
      }
      if (languageChanged || selecting) {
        await client.query(`UPDATE worker_language_requests SET state='rejected',decided_at=clock_timestamp(),decided_by=$4,
          decision_note='Superseded by direct supervisor correction'
          WHERE org_id=$1 AND site_id=$2 AND worker_id=$3 AND state='pending'`,
          [session.org_id,session.site_id,workerId,session.principal_id]);
        await client.query(`UPDATE workers SET code=$4,name=$5,language=$6,language_selection_required=false,
          language_selected_at=clock_timestamp(),language_selected_by='staff' WHERE id=$1 AND org_id=$2 AND site_id=$3`,
          [workerId,session.org_id,session.site_id,code,workerName,requestedLanguage]);
        await domainAudit(client,session,'worker.language_corrected',workerId);
      } else {
        await client.query('UPDATE workers SET code=$4,name=$5 WHERE id=$1 AND org_id=$2 AND site_id=$3',
          [workerId,session.org_id,session.site_id,code,workerName]);
      }
      if (codeChanged || nameChanged) await domainAudit(client,session,'worker.updated',workerId);
    }
    return workerRow(client,session,workerId);
  }));
}

export async function readWorkerLanguageState(client,session) {
  const worker=await requireWorkerSelf(client,session);
  const pending=(await client.query(`SELECT * FROM worker_language_requests
    WHERE org_id=$1 AND site_id=$2 AND worker_id=$3 AND state='pending'`,
  [session.org_id,session.site_id,worker.id])).rows[0];
  return {workerId:worker.id,language:worker.language,selected:!worker.language_selection_required,
    selectedAt:worker.language_selected_at ?? null,selectedBy:worker.language_selected_by ?? null,
    pendingRequest:pending ? languageRequestDto(pending) : null};
}

export async function workerLanguageState(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,client=>readWorkerLanguageState(client,session));
}

export async function selectWorkerLanguage(pool,session,input,{schema='public'}={}) {
  const value=selectWorkerLanguageInput(input);
  return domainTransaction(pool,schema,async (client) => {
    const worker=await requireWorkerSelf(client,session,{lock:true});
    if (!worker.language_selection_required) {
      if (worker.language_selection_request_id===value.requestId && worker.language===value.language) {
        return {...await readWorkerLanguageState(client,session),duplicate:true};
      }
      throw new Error('Language already selected');
    }
    const changed=await client.query(`UPDATE workers SET language=$4,language_selection_required=false,
      language_selected_at=clock_timestamp(),language_selected_by='worker',language_selection_request_id=$5
      WHERE id=$1 AND org_id=$2 AND site_id=$3 AND language_selection_required`,
    [worker.id,session.org_id,session.site_id,value.language,value.requestId]);
    if (changed.rowCount!==1) throw new Error('Language selection conflict');
    await domainAudit(client,session,'worker.language_selected',worker.id);
    return {...await readWorkerLanguageState(client,session),duplicate:false};
  });
}

export async function requestWorkerLanguage(pool,session,input,{schema='public'}={}) {
  const value=requestWorkerLanguageInput(input);
  return domainTransaction(pool,schema,async (client) => {
    const worker=await requireWorkerSelf(client,session,{lock:true});
    if (worker.language_selection_required) throw new Error('Select your language first');
    const old=(await client.query('SELECT * FROM worker_language_requests WHERE id=$1',[value.requestId])).rows[0];
    if (old) {
      if (old.org_id!==session.org_id || old.site_id!==session.site_id || old.worker_id!==worker.id
        || old.requested_language!==value.language || old.reason!==value.reason) throw new Error('Language request conflict');
      return {...languageRequestDto(old),duplicate:true};
    }
    if (value.language===worker.language) throw new Error('Language already selected');
    if ((await client.query(`SELECT 1 FROM worker_language_requests
      WHERE org_id=$1 AND site_id=$2 AND worker_id=$3 AND state='pending'`,
    [session.org_id,session.site_id,worker.id])).rows.length) throw new Error('Language change already pending');
    try {
      await client.query(`INSERT INTO worker_language_requests
        (id,org_id,site_id,worker_id,current_language,requested_language,reason,state,requested_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',clock_timestamp())`,
      [value.requestId,session.org_id,session.site_id,worker.id,worker.language,value.language,value.reason]);
    } catch (error) {
      if (error.code==='23505') throw new Error('Language change already pending');
      throw error;
    }
    await domainAudit(client,session,'worker.language_requested',value.requestId);
    const row=(await client.query('SELECT * FROM worker_language_requests WHERE id=$1',[value.requestId])).rows[0];
    return {...languageRequestDto(row),duplicate:false};
  });
}

export async function workerLanguageHistory(pool,session,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    const worker=await requireWorkerSelf(client,session);
    const items=(await client.query(`SELECT * FROM worker_language_requests
      WHERE org_id=$1 AND site_id=$2 AND worker_id=$3 ORDER BY requested_at DESC,id DESC LIMIT 50`,
    [session.org_id,session.site_id,worker.id])).rows.map(languageRequestDto);
    return {items};
  });
}

export async function staffWorkerLanguageHistory(pool,session,workerId,{schema='public'}={}) {
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const worker=await workerRow(client,session,workerId);
    const items=(await client.query(`SELECT * FROM worker_language_requests
      WHERE org_id=$1 AND site_id=$2 AND worker_id=$3 ORDER BY requested_at DESC,id DESC LIMIT 50`,
    [session.org_id,session.site_id,workerId])).rows.map(languageRequestDto);
    return {worker:{id:worker.id,code:worker.code,name:worker.name,language:worker.language,languageSelected:worker.language_selected},items};
  });
}

export async function listLanguageRequests(pool,session,filters={}, {schema='public'}={}) {
  const {status,page,pageSize}=languageRequestFilters(filters);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const row=(await client.query(`WITH scoped AS (
      SELECT r.*,w.code AS worker_code,w.name AS worker_name,w.active AS worker_active
      FROM worker_language_requests r JOIN workers w ON w.id=r.worker_id AND w.org_id=r.org_id AND w.site_id=r.site_id
      WHERE r.org_id=$1 AND r.site_id=$2 AND ($3='all' OR r.state=$3))
      SELECT (SELECT COUNT(*)::int FROM scoped) AS total,
        (SELECT COALESCE(jsonb_agg(result ORDER BY result.requested_at DESC,result.id DESC),'[]') FROM
          (SELECT * FROM scoped ORDER BY requested_at DESC,id DESC LIMIT $4 OFFSET $5) result) AS items`,
    [session.org_id,session.site_id,status,pageSize,(page-1)*pageSize])).rows[0];
    return {...row,items:row.items.map(languageRequestDto),page,pageSize};
  });
}

export async function decideWorkerLanguageRequest(pool,session,id,input,{schema='public'}={}) {
  if(typeof id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error('Invalid language request');
  const value=languageDecisionInput(input);
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const row=(await client.query(`SELECT r.*,w.code AS worker_code,w.name AS worker_name,w.active AS worker_active,
      w.language AS worker_language,w.language_selection_required
      FROM worker_language_requests r JOIN workers w ON w.id=r.worker_id AND w.org_id=r.org_id AND w.site_id=r.site_id
      WHERE r.id=$1 AND r.org_id=$2 AND r.site_id=$3 FOR UPDATE OF r,w`,[id,session.org_id,session.site_id])).rows[0];
    if (!row) throw new Error('Language request unavailable');
    if (row.requested_language!==value.expectedRequestedLanguage) throw new Error('Language request changed');
    const state=value.action==='approve' ? 'approved' : 'rejected';
    if (row.state!=='pending') {
      if (row.state===state && row.decided_by===session.principal_id && (row.decision_note ?? '')===value.note)
        return {...languageRequestDto(row),duplicate:true};
      throw new Error('Language request already decided');
    }
    if (value.action==='approve') {
      if (!row.worker_active) throw new Error('Worker unavailable');
      if (row.language_selection_required || row.worker_language!==row.current_language) throw new Error('Worker language changed');
    }
    const changed=await client.query(`UPDATE worker_language_requests SET state=$4,decided_at=clock_timestamp(),
      decided_by=$5,decision_note=$6 WHERE id=$1 AND org_id=$2 AND site_id=$3 AND state='pending'`,
    [id,session.org_id,session.site_id,state,session.principal_id,value.note || null]);
    if (changed.rowCount!==1) throw new Error('Language request already decided');
    if (value.action==='approve') {
      const updated=await client.query(`UPDATE workers SET language=$5,language_selected_at=clock_timestamp(),language_selected_by='staff'
        WHERE id=$1 AND org_id=$2 AND site_id=$3 AND language=$4 AND language_selection_required=false`,
      [row.worker_id,session.org_id,session.site_id,row.current_language,row.requested_language]);
      if (updated.rowCount!==1) throw new Error('Worker language changed');
    }
    await domainAudit(client,session,value.action==='approve' ? 'worker.language_request_approved' : 'worker.language_request_rejected',id);
    await recordWorkerEvent(client,{orgId:session.org_id,siteId:session.site_id,workerId:row.worker_id,kind:'language.decided',
      objectType:'language_request',objectId:id,dedupeKey:`language.decided:${id}`});
    const saved=(await client.query('SELECT * FROM worker_language_requests WHERE id=$1',[id])).rows[0];
    return {...languageRequestDto(saved),duplicate:false};
  });
}

export async function disableWorker(pool,session,workerId,{schema='public'}={}) {  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const before=await workerRow(client,session,workerId,{lock:true});
    if (before.active) {
      await client.query('UPDATE workers SET active=false WHERE id=$1 AND org_id=$2 AND site_id=$3',[workerId,session.org_id,session.site_id]);
      await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL',[workerId,session.org_id,session.site_id]);
      await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL',[workerId,session.org_id,session.site_id]);
      await client.query(`UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL`,[workerId,session.org_id,session.site_id]);
      await domainAudit(client,session,'worker.disabled',workerId);
    }
    return workerRow(client,session,workerId);
  });
}

async function oldReactivation(client,session,id,change,kind) {
  const old=(await client.query('SELECT * FROM directory_reactivations WHERE request_id=$1 AND org_id=$2 AND site_id=$3',
    [change.requestId,session.org_id,session.site_id])).rows[0];
  return reactivationReplay(old,id,change,kind);
}

async function recordReactivation(client,session,id,change,kind) {
  await client.query(`INSERT INTO directory_reactivations(request_id,org_id,site_id,worker_id,crew_id,expected_label,requested_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[change.requestId,session.org_id,session.site_id,kind==='worker' ? id : null,kind==='crew' ? id : null,change.expectedLabel,session.principal_id]);
}

export async function reenableWorker(pool,session,id,input,{schema='public'}={}) {
  const change=reactivationInput(id,input,'worker');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const before=await workerRow(client,session,id,{lock:true});
    if((await client.query('SELECT 1 FROM worker_deletion_requests WHERE worker_id=$1',[id])).rows.length)throw new Error('Worker deletion pending');
    if(await oldReactivation(client,session,id,change,'worker')) return {...before,duplicate:true};
    await requireWritableEntitlement(client,session.org_id);
    if(before.code!==change.expectedLabel) throw new Error('Worker code changed');
    if(!before.active) {
      await requireWorkerCapacity(client,session.org_id);
      await client.query('UPDATE workers SET active=true WHERE id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id]);
      await client.query('UPDATE worker_grants SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL',[id,session.org_id,session.site_id]);
      await client.query('UPDATE worker_setup_tokens SET revoked_at=clock_timestamp() WHERE worker_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL',[id,session.org_id,session.site_id]);
      await client.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE principal_type='worker' AND principal_id=$1 AND org_id=$2 AND site_id=$3 AND revoked_at IS NULL",[id,session.org_id,session.site_id]);
      await domainAudit(client,session,'worker.reenabled',id);
    }
    await recordReactivation(client,session,id,change,'worker');
    return {...await workerRow(client,session,id),duplicate:false};
  });
}

export async function listCrews(pool,session,filters={}, {schema='public'}={}) {
  const {page,pageSize,search,status}=crewFilters(filters);
  return domainTransaction(pool,schema,client=>readCrewPage(client,session,{page,pageSize,search,status}));
}

export async function readCrewPage(client,session,{page,pageSize,search,status}) {
    await requirePrincipal(client,session,'staff');
    const row=(await client.query(`WITH filtered AS (
      SELECT c.id,c.name,c.active FROM crews c WHERE c.org_id=$1 AND c.site_id=$2
        AND ($3='' OR strpos(lower(c.name),lower($3))>0) AND ($4='all' OR c.active=($4='active'))),
      page AS (SELECT f.*,(SELECT COUNT(*)::int FROM crew_memberships cm JOIN workers w ON w.id=cm.worker_id
        AND w.org_id=cm.org_id AND w.site_id=cm.site_id WHERE cm.crew_id=f.id
        AND cm.org_id=$1 AND cm.site_id=$2 AND w.active) AS member_count
        FROM filtered f ORDER BY lower(f.name),f.id LIMIT $5 OFFSET $6)
      SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
        (SELECT COALESCE(jsonb_agg(page ORDER BY lower(page.name),page.id),'[]') FROM page) AS items`,
      [session.org_id,session.site_id,search,status,pageSize,(page-1)*pageSize])).rows[0];
    return {...row,page,pageSize};
}

export async function createCrew(pool,session,input,{schema='public'}={}) {
  inputKeys(input,['name']); const crewName=name(input.name,'crew name'),crewId=randomUUID();
  return writeConflict(() => domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    await client.query('INSERT INTO crews(id,org_id,site_id,name) VALUES ($1,$2,$3,$4)',[crewId,session.org_id,session.site_id,crewName]);
    await domainAudit(client,session,'crew.created',crewId);
    return {id:crewId,org_id:session.org_id,site_id:session.site_id,name:crewName,active:true,member_count:0};
  }));
}

export async function listCrewRecipients(pool,session,id,filters={}, {schema='public'}={}) {
  crewRecipientId(id,filters);
  return domainTransaction(pool,schema,async client=>{
    await requirePrincipal(client,session,'staff');
    const crew=await crewRow(client,session,id,{lock:'share'});
    if(!crew.active)throw Error('Crew unavailable');
    const items=(await client.query(`SELECT w.id,w.code,w.name,w.language,c.name AS crew_name FROM crew_memberships cm
      JOIN crews c ON c.id=cm.crew_id AND c.org_id=cm.org_id AND c.site_id=cm.site_id
      JOIN workers w ON w.id=cm.worker_id AND w.org_id=cm.org_id AND w.site_id=cm.site_id
      WHERE cm.crew_id=$1 AND cm.org_id=$2 AND cm.site_id=$3 AND w.active AND NOT w.language_selection_required
      ORDER BY lower(w.code),w.id LIMIT 5001`,[id,session.org_id,session.site_id])).rows;
    if(items.length>5000)throw Error('Crew recipient limit exceeded');
    return {crew:{id:crew.id,name:crew.name},items,asOf:new Date().toISOString()};
  });
}

async function crewRow(client,session,id,{lock=false}={}) {
  const row=(await client.query(`SELECT c.id,c.org_id,c.site_id,c.name,c.active,
    (SELECT COUNT(*)::int FROM crew_memberships cm JOIN workers w ON w.id=cm.worker_id
      AND w.org_id=cm.org_id AND w.site_id=cm.site_id WHERE cm.crew_id=c.id
      AND cm.org_id=c.org_id AND cm.site_id=c.site_id AND w.active) AS member_count
    FROM crews c WHERE c.id=$1 AND c.org_id=$2 AND c.site_id=$3 ${lock==='share' ? 'FOR SHARE OF c' : lock ? 'FOR UPDATE OF c' : ''}`,
  [id,session.org_id,session.site_id])).rows[0];
  if(!row) throw new Error('Crew unavailable');
  return row;
}

export function getCrew(pool,session,id,{schema='public'}={}){
  crewRecipientId(id);return domainTransaction(pool,schema,async client=>{await requirePrincipal(client,session,'staff');return crewRow(client,session,id);});
}

export async function renameCrew(pool,session,id,input,{schema='public'}={}) {
  const change=crewChangeInput(id,input,'rename');
  return writeConflict(() => domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const before=await crewRow(client,session,id,{lock:true});
    if(!before.active) throw new Error('Crew is archived');
    if(before.name===change.name) return before;
    if(before.name!==change.expectedName) throw new Error('Crew name changed');
    await client.query('UPDATE crews SET name=$4 WHERE id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id,change.name]);
    await domainAudit(client,session,'crew.renamed',id);
    return crewRow(client,session,id);
  }));
}

export async function archiveCrew(pool,session,id,input,{schema='public'}={}) {
  const change=crewChangeInput(id,input,'archive');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    // Membership moves hold a share lock on this same crew before accepting new members.
    const before=await crewRow(client,session,id,{lock:true});
    if(before.name!==change.expectedName) throw new Error('Crew name changed');
    if(before.active) {
      await client.query('UPDATE crews SET active=false WHERE id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id]);
      await domainAudit(client,session,'crew.archived',id);
    }
    return crewRow(client,session,id);
  });
}

export async function restoreCrew(pool,session,id,input,{schema='public'}={}) {
  const change=reactivationInput(id,input,'crew');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const before=await crewRow(client,session,id,{lock:true});
    if(await oldReactivation(client,session,id,change,'crew')) return {...before,duplicate:true};
    if(before.name!==change.expectedLabel) throw new Error('Crew name changed');
    if(!before.active) {
      await client.query('UPDATE crews SET active=true WHERE id=$1 AND org_id=$2 AND site_id=$3',[id,session.org_id,session.site_id]);
      await domainAudit(client,session,'crew.restored',id);
    }
    await recordReactivation(client,session,id,change,'crew');
    return {...await crewRow(client,session,id),duplicate:false};
  });
}

export async function moveWorkerToCrew(pool,session,workerId,crewId,{schema='public'}={}) {
  if (crewId!==null && (typeof crewId!=='string' || !crewId || crewId.length>100)) throw new Error('Invalid crew');
  return domainTransaction(pool,schema,async (client) => {
    await requirePrincipal(client,session,'staff');
    const worker=await workerRow(client,session,workerId,{lock:true});
    if (!worker.active) throw new Error('Worker unavailable');
    if (crewId!==null && !(await client.query('SELECT id FROM crews WHERE id=$1 AND org_id=$2 AND site_id=$3 AND active=true FOR SHARE',[crewId,session.org_id,session.site_id])).rows.length) throw new Error('Crew unavailable');
    if (worker.crew_id!==crewId) {
      if (crewId===null) await client.query('DELETE FROM crew_memberships WHERE worker_id=$1 AND org_id=$2 AND site_id=$3',[workerId,session.org_id,session.site_id]);
      else await client.query(`INSERT INTO crew_memberships(worker_id,org_id,site_id,crew_id) VALUES ($1,$2,$3,$4)
        ON CONFLICT(worker_id) DO UPDATE SET crew_id=excluded.crew_id,joined_at=clock_timestamp()`,[workerId,session.org_id,session.site_id,crewId]);
      await domainAudit(client,session,'worker.crew_moved',workerId);
    }
    return workerRow(client,session,workerId);
  });
}
