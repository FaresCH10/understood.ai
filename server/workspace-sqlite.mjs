import {ensureRecordingSchema} from './recordings.mjs';
import {ensureInstructionSchema} from './instruction-schema.mjs';
import {workspaceOperation} from './workspace.mjs';
import {requireWorkerSiteAccess} from './site-access.mjs';
import {workerCredentialSessionValid} from './auth.mjs';
import {requireWritableEntitlement} from './entitlements.mjs';
import {ensureReportAudienceSchema} from './report-scope.mjs';
import {ensureCaseMessageSchema} from './case-messages.mjs';
export async function sqliteWorkspace(db,session,operation,input,options={}){
 ensureRecordingSchema(db);ensureInstructionSchema(db);ensureCaseMessageSchema(db);
 const hasContentPurges=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='briefing_content_purges'").get();
 const staff=session.principal_type==='staff';
 if(!['staff','worker'].includes(session.principal_type)||staff&&!['owner','supervisor','auditor'].includes(session.role))throw Error('Forbidden');
 if(!db.prepare(`SELECT 1 FROM ${staff?'staff':'workers'} WHERE id=? AND org_id=? AND site_id=? AND active=1`).get(session.principal_id,session.org_id,session.site_id))throw Error('Forbidden');
 if(!staff){requireWorkerSiteAccess(db,session.org_id,session.site_id);if(session.access_mode==='credential'&&!workerCredentialSessionValid(db,session))throw Error('Sign in required');}
 if(operation==='crew-instructions'&&staff&&['owner','supervisor'].includes(session.role))ensureReportAudienceSchema(db);
 if(input.content||input.file||input.complete)requireWritableEntitlement(db,session.org_id);
 // A synchronous adapter executes every statement before the async continuation; the
 // transaction spans the complete operation, including validation and state changes.
 db.exec('BEGIN IMMEDIATE');
 try{const result=await workspaceOperation(async(sql,values=[])=>{sql=sql.replace(' FOR UPDATE','');const statement=db.prepare(hasContentPurges?sql:sql.replaceAll('FROM briefing_content_purges bp','FROM (SELECT NULL AS briefing_id WHERE 0) bp'));return statement.all(...values);},session,operation,input,options);db.exec('COMMIT');return result;}
 catch(error){db.exec('ROLLBACK');throw error;}
}
