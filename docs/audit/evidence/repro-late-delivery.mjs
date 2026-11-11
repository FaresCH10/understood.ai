import {PGlite} from '@electric-sql/pglite';
import {runMigrations} from '../../../server/postgres/migrate.mjs';
import {startInstructionSend,completeInstructionSend,retryInstructionSend} from '../../../server/postgres/instructions.mjs';
import {processOnePreparation} from '../../../server/postgres/preparation.mjs';
import {createPresentation} from '../../../server/postgres/presentations.mjs';
import {getPublicationResponse} from '../../../server/postgres/responses.mjs';
import {CANONICAL_SOURCE} from '../../../server/domain.mjs';
import {randomUUID} from 'node:crypto';
import {submitAnswer} from '../../../server/postgres/domain.mjs';
import {requestHelp} from '../../../server/postgres/clarifications.mjs';
import {requestCaseRepeat} from '../../../server/postgres/case-repeats.mjs';
const db=new PGlite();const client={async query(sql,values){return values?.length?db.query(sql,values):(await db.exec(sql)).at(-1)||{rows:[]};},release(){}};const pool={async connect(){return client;}};
const schema='understood_test_audit';const options={schema,integrationMode:'synthetic'};
const owner={principal_type:'staff',principal_id:'s',org_id:'a',site_id:'a',role:'owner'};
try{
 await db.exec(`CREATE SCHEMA ${schema};SET search_path TO ${schema},pg_catalog`);await runMigrations(pool,{schema});
 await db.exec(`INSERT INTO organizations VALUES('a','Synthetic audit');INSERT INTO sites VALUES('a','a','Test','UTC');INSERT INTO staff(id,org_id,site_id,name,role) VALUES('s','a','a','Owner','owner');INSERT INTO workers(id,org_id,site_id,code,language) VALUES('w-en','a','a','001','en'),('w-hi','a','a','002','hi');`);
 const request={requestId:randomUUID(),title:'Shelf handover',source:CANONICAL_SOURCE,audience:{type:'all'},responseMode:'question',deliveryMode:'text'};
 await startInstructionSend(pool,owner,request,options);await processOnePreparation(pool,options);
 const hindi=(await db.query("SELECT prepared_json->'languages'->'hi' content FROM briefings WHERE id=$1",[request.requestId])).rows[0].content;
 await db.query("UPDATE briefings SET prepared_json=jsonb_set(prepared_json,'{languages}',(prepared_json->'languages')-'hi') WHERE id=$1",[request.requestId]);
 const initial=await completeInstructionSend(pool,owner,request.requestId,options);
 await db.query("UPDATE briefings SET prepared_json=jsonb_set(prepared_json,'{languages,hi}',$2::jsonb) WHERE id=$1",[request.requestId,JSON.stringify(hindi)]);
 const retry=await retryInstructionSend(pool,owner,request.requestId,{requestId:randomUUID()},options);
 const late=(await db.query("SELECT assignment_id,content_json FROM instruction_deliveries WHERE request_id=$1 AND worker_id='w-hi'",[request.requestId])).rows[0];
 const presentation=await createPresentation(pool,{principal_type:'worker',principal_id:'w-hi',org_id:'a',site_id:'a'},late.assignment_id,{requestId:randomUUID(),sourceKind:'instruction'},options);
 const staffDetail=await getPublicationResponse(pool,owner,initial.publicationId,late.assignment_id,{},options);
 console.log(JSON.stringify({case:'late_language_presentation',initialDelivered:initial.delivered,afterRetry:retry.delivered,deliveryHasQuestion:!!late.content_json?.question,presentation,staffDetailWorkerQuestion:staffDetail.workerQuestion,staffChoices:staffDetail.choices?.map(x=>x.text),deliveredChoices:late.content_json?.choices?.map(x=>x.text)}));
 const worker={principal_type:'worker',principal_id:'w-hi',org_id:'a',site_id:'a'};
 await db.query("UPDATE workers SET language='ur' WHERE id='w-hi'");
 const changed=await createPresentation(pool,worker,late.assignment_id,{requestId:randomUUID(),sourceKind:'instruction'},options);
 console.log(JSON.stringify({case:'late_language_after_profile_change',presentation:changed}));
 await submitAnswer(pool,worker,late.assignment_id,randomUUID(),late.content_json.choices[0].id,options);
 const help=await requestHelp(pool,worker,late.assignment_id,{requestId:randomUUID(),text:'Please clarify'},options);
 try {await requestCaseRepeat(pool,owner,help.id,{requestId:randomUUID(),dueAt:new Date(Date.now()+3600000).toISOString()},{...options,withQuestion:true});console.log(JSON.stringify({case:'late_language_checkback',succeeded:true}));}
 catch(error){console.log(JSON.stringify({case:'late_language_checkback',succeeded:false,error:error.message}));}
 await db.query("INSERT INTO instruction_compositions(id,org_id,site_id,staff_id,content_json,updated_at) VALUES('orphan','missing','missing','missing','not json','invalid date')");
 await db.query("INSERT INTO instruction_attachments(id,request_id,org_id,site_id,staff_id,name,mime,bytes,data_base64,created_at) VALUES('orphan-file','missing','missing','missing','missing','bad','bad',-1,'not base64','invalid date')");
 console.log(JSON.stringify({case:'workspace_invalid_rows',compositions:(await db.query("SELECT count(*)::int n FROM instruction_compositions WHERE org_id='missing'")).rows[0].n,negativeAttachments:(await db.query('SELECT count(*)::int n FROM instruction_attachments WHERE bytes<0')).rows[0].n}));
}finally{await db.close();}
