import {ensureRecordingSchema} from './recordings.mjs';
import {ensureInstructionSchema} from './instruction-schema.mjs';
import {workspaceOperation} from './workspace.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {workerCredentialSessionValid} from './auth.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {ensureReportAudienceSchema} from './report-scope.mjs';
import {ensureCaseMessageSchema} from './case-messages.mjs';
import {withAttachmentScanOutsideTransaction} from './attachment-policy.mjs';

const queues=new WeakMap();
async function exclusive(db,run){
 const previous=queues.get(db)||Promise.resolve();
 let release;const tail=new Promise(resolve=>{release=resolve;});queues.set(db,tail);
 await previous;
 try{return await run();}finally{release();if(queues.get(db)===tail)queues.delete(db);}
}
export async function sqliteWorkspace(db,session,operation,input={},options={}){
 // Never wait for external services inside a shared synchronous SQLite transaction.
 // First authorize and validate in a transaction, roll back at the scan boundary,
 // scan outside it, then repeat all checks before inserting or releasing bytes.
 return withAttachmentScanOutsideTransaction(options,checked=>exclusive(db,()=>workspaceTransaction(db,session,operation,input,checked)));
}
async function workspaceTransaction(db,session,operation,input,options){
 ensureRecordingSchema(db);ensureInstructionSchema(db);ensureCaseMessageSchema(db);
 const hasContentPurges=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='briefing_content_purges'").get();
 const staff=session.principal_type==='staff';
 if(!['staff','worker'].includes(session.principal_type)||staff&&!['owner','supervisor','auditor'].includes(session.role))throw Error('Forbidden');
 if(!db.prepare(`SELECT 1 FROM ${staff?'staff':'workers'} WHERE id=? AND org_id=? AND site_id=? AND active=1 ${staff?'AND role=?':''}`).get(session.principal_id,session.org_id,session.site_id,...(staff?[session.role]:[])))throw Error('Forbidden');
 if(session.token_hash!==undefined&&!db.prepare(`SELECT 1 FROM sessions WHERE token_hash=? AND principal_type=? AND principal_id=? AND org_id=? AND site_id=? AND revoked_at IS NULL AND expires_at>?`).get(session.token_hash,session.principal_type,session.principal_id,session.org_id,session.site_id,new Date().toISOString()))throw Error('Sign in required');
 if(!staff){requireWorkerSiteAccess(db,session.org_id,session.site_id);if(session.access_mode==='credential'&&!workerCredentialSessionValid(db,session))throw Error('Sign in required');}
 if(operation==='worker-crew'||operation==='crew-instructions'&&staff&&['owner','supervisor'].includes(session.role))ensureReportAudienceSchema(db);
 if(input.content||input.file||input.complete)requireWritableEntitlement(db,session.org_id);
 // No external I/O is allowed here. Workspace calls on this connection are serialized.
 db.exec('BEGIN IMMEDIATE');
 try{const result=await workspaceOperation(async(sql,values=[])=>{sql=sql.replace(' FOR UPDATE','');const statement=db.prepare(hasContentPurges?sql:sql.replaceAll('FROM briefing_content_purges bp','FROM (SELECT NULL AS briefing_id WHERE 0) bp'));return statement.all(...values);},session,operation,input,options);db.exec('COMMIT');return result;}
 catch(error){db.exec('ROLLBACK');throw error;}
}
