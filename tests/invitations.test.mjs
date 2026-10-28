import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSessionContextFetch} from './helpers/session-http.mjs';
const fetch=createSessionContextFetch();
import {openDatabase} from '../server/db.mjs';
import {seed} from '../server/seed.mjs';
import {provisionStaffCredential,authenticateStaff,createSession,requireSession} from '../server/auth.mjs';
import {resolveMailConfig,openMail,sealMail} from '../server/auth-mail.mjs';
import {issueInvitation,changeInvitation,listInvitations,invitationReceipt,previewInvitation,acceptInvitation,processOneInvitation,expireInvitations,ensureInvitationSchema} from '../server/invitations.mjs';
import {invitationIssueInput,invitationChangeInput,invitationFilters,invitationTokenInput,invitationAcceptInput} from '../server/invitation-input.mjs';
import {createAppServer} from '../server/index.mjs';
import {ensureRecoverySchema,requestRecovery} from '../server/account-recovery.mjs';
import {AUTH_MAIL_QUEUE_LIMIT} from '../server/auth-mail-budget.mjs';

const password='Disposable-synthetic-password-123';
const owner={principal_type:'staff',principal_id:'maya',org_id:'cedar',site_id:'beirut',role:'owner',access_mode:'credential'};
const auth={accessMode:'credential'};
const mail=resolveMailConfig({mode:'resend',apiKey:'re_synthetic_only',from:'fixture@example.test',key:'07'.repeat(32),publicOrigin:'http://127.0.0.1:3140',allowLocal:true});
const issue=(email='recipient@example.test',role='supervisor')=>({requestId:randomUUID(),name:'Synthetic recipient',email,role,confirmed:true});
const change=revision=>({requestId:randomUUID(),revision,confirmed:true});
function fixture() {const db=openDatabase(':memory:');seed(db);provisionStaffCredential(db,'maya','owner@example.test',password);ensureInvitationSchema(db);return db;}
async function deliver(db) {let token,message;await processOneInvitation(db,mail,{send:async(_config,_id,value)=>{message=value;token=value.text.match(/#accept-invitation\/([A-Za-z0-9_-]{43})/)[1];return {providerId:'synthetic-only'};}});return {token,message};}
const accept=(token,requestId=randomUUID())=>({requestId,token,password,confirmation:password});

test('shared full mail backlog rolls back new invitations, permits exact replay and replaces resend capacity atomically',()=>{
  const db=fixture();try {
    ensureRecoverySchema(db);const now=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();
    const insert=db.prepare("INSERT INTO staff_recovery_mail VALUES(?,'reset',?,NULL,?,?,?,'queued',0,NULL,NULL,NULL)");
    for(let n=0;n<AUTH_MAIL_QUEUE_LIMIT;n++) insert.run(`capacity-${n}`,'a'.repeat(64),now,expires,now);
    const value=issue();assert.throws(()=>issueInvitation(db,owner,value,mail),/Email delivery unavailable/);
    assert.equal(listInvitations(db,owner).total,0);assert.equal(invitationReceipt(db,owner,value.requestId).accepted,false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE action='staff.invitation_issued'").get().n,0);
    db.prepare("UPDATE staff_recovery_mail SET state='failed' WHERE id='capacity-0'").run();
    const result=issueInvitation(db,owner,value,mail);assert.equal(issueInvitation(db,owner,value,mail).duplicate,true);
    requestRecovery(db,{email:'cannot-enqueue@example.test'},'capacity-ip',mail);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM staff_recovery_mail').get().n,AUTH_MAIL_QUEUE_LIMIT);
    assert.equal(changeInvitation(db,owner,result.id,'resend',change(1),mail).revision,2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM staff_invitation_mail WHERE state IN ('queued','processing')").get().n,1);
  }finally {db.close();}
});

test('invitation input rejects forged scope, unsupported roles, malformed links and unbounded pages',()=>{
  const good=issue(' Recipient@Example.test ');assert.equal(invitationIssueInput(good).email,'recipient@example.test');
  for(const input of [{...good,orgId:'foreign'},{...good,confirmed:false},{...good,role:'translator'},{...good,email:'<bad>@example.test'},{...good,name:'a\nname'},{...good,requestId:'no'}]) assert.throws(()=>invitationIssueInput(input),/Invalid invitation/);
  for(const input of [{...change(1),revision:true},{...change(1),token:'forged'},{...change(1),confirmed:false}]) assert.throws(()=>invitationChangeInput(input),/Invalid invitation/);
  for(const input of [{page:true},{page:[]},{pageSize:51},{status:'sent'},{email:'foreign@example.test'}]) assert.throws(()=>invitationFilters(input),/Invalid invitation/);
  for(const token of ['', 'a'.repeat(42),'a'.repeat(43)+'?extra']) assert.throws(()=>invitationTokenInput({token},'fixture'),/Invalid invitation/);
  assert.throws(()=>invitationAcceptInput({...accept('a'.repeat(43)),confirmation:'wrong'},'signup','fixture'),/Invalid invitation/);
  assert.throws(()=>invitationAcceptInput(accept('a'.repeat(43)),'existing','fixture'),/Invalid invitation/);
});

test('invitation issue is scoped, encrypted, exactly replayed and audit-atomic, never fake delivery',()=>{
  const db=fixture();try {
    const input=issue(),result=issueInvitation(db,owner,input,mail);assert.equal(result.delivery,'queued');assert.equal(result.revision,1);
    const invitation=db.prepare('SELECT * FROM staff_invitations').get(),job=db.prepare('SELECT * FROM staff_invitation_mail').get();
    assert.ok(!JSON.stringify({invitation,job}).includes(input.email));assert.equal(job.payload,null);assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_tokens').get().n,0);
    assert.equal(openMail(mail,invitation.id,invitation.email_payload).email,input.email);
    assert.equal(issueInvitation(db,owner,input,{available:false}).duplicate,true);assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_mail').get().n,1);
    assert.throws(()=>issueInvitation(db,owner,{...input,role:'auditor'},mail),/request conflict/);
    assert.throws(()=>issueInvitation(db,owner,issue(),mail),/already pending/);
    assert.throws(()=>issueInvitation(db,owner,issue('other@example.test'),{available:false}),/Email delivery unavailable/);
    assert.throws(()=>issueInvitation(db,{...owner,site_id:'harbor-yard'},issue('other@example.test'),mail),/Forbidden/);
    assert.throws(()=>issueInvitation(db,{...owner,access_mode:'demo'},issue('other@example.test'),mail),/Forbidden/);
    assert.equal(invitationReceipt(db,owner,input.requestId).accepted,true);assert.equal(listInvitations(db,owner).total,1);
    assert.ok(!/email_hash|payload|token_hash|issuer_revision/.test(JSON.stringify(listInvitations(db,owner))));
    db.exec("CREATE TRIGGER fail_invite_audit BEFORE INSERT ON audit WHEN NEW.action='staff.invitation_issued' BEGIN SELECT RAISE(ABORT,'Injected audit failure');END;");
    assert.throws(()=>issueInvitation(db,owner,issue('rollback@example.test'),mail),/Injected/);
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitations').get().n,1);
  }finally {db.close();}
});

test('new account acceptance preserves evidence, requires the exact live link and safely replays without signing in',async()=>{
  const db=fixture();try {
    const before=db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json,input=issue();issueInvitation(db,owner,input,mail);
    const {token}=await deliver(db);assert.ok(token);const preview=previewInvitation(db,{token},'fixture');assert.equal(preview.role,'supervisor');assert.equal(preview.site,'Beirut site');assert.ok(!JSON.stringify(preview).includes(input.email));
    const request=accept(token),result=await acceptInvitation(db,null,'signup',request,'fixture',mail);assert.equal(result.signInRequired,true);assert.equal(result.duplicate,false);
    const principal=authenticateStaff(db,input.email,password,'fixture');assert.equal(principal.role,'supervisor');assert.equal(principal.site_id,'beirut');
    assert.equal((await acceptInvitation(db,null,'signup',request,'fixture',mail)).duplicate,true);
    await assert.rejects(acceptInvitation(db,null,'signup',accept(token),'fixture',mail),/Invitation unavailable/);
    await assert.rejects(acceptInvitation(db,null,'signup',{...request,password:password+'wrong',confirmation:password+'wrong'},'fixture',mail),/Invitation unavailable/);
    assert.throws(()=>previewInvitation(db,{token},'fixture'),/Invitation unavailable/);
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_acceptances').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM staff_credentials').get().n,2);
    assert.equal(db.prepare("SELECT snapshot_json FROM publications WHERE id='shelf-v3'").get().snapshot_json,before);
    assert.equal(db.prepare('SELECT email_payload FROM staff_invitations').get().email_payload,null);
    const consumed=db.prepare('SELECT * FROM staff_invitation_tokens').get();assert.ok(consumed.used_at && consumed.revoked_at);
    assert.throws(()=>db.prepare('UPDATE staff_invitation_acceptances SET kind=?').run('existing'),/immutable/);
    assert.throws(()=>db.prepare('UPDATE staff_invitation_tokens SET used_at=NULL').run(),/immutable/);
    assert.equal(db.prepare("SELECT count(*) n FROM sessions WHERE principal_id=?").get(result.staffId).n,0);
  }finally{db.close();}
});

test('existing-account acceptance cannot overwrite passwords, cross-link another recipient or change an existing site grant',async()=>{
  const db=fixture();try {
    db.prepare("INSERT INTO staff VALUES('recipient-home','harbor','harbor-yard','Synthetic recipient home','auditor',1)").run();
    provisionStaffCredential(db,'recipient-home','recipient@example.test',password);
    const original=db.prepare("SELECT * FROM staff_credentials WHERE staff_id='recipient-home'").get();
    const principal=authenticateStaff(db,'recipient@example.test',password,'fixture'),session=createSession(db,principal,'staff','credential');
    const actor=requireSession(db,{headers:{cookie:`understood_session=${session.token}`}},auth);
    const input=issue();issueInvitation(db,owner,input,mail);const {token}=await deliver(db);
    await assert.rejects(acceptInvitation(db,null,'signup',accept(token),'fixture',mail),/Sign in to accept/);
    await assert.rejects(acceptInvitation(db,owner,'existing',{token,requestId:randomUUID()},'fixture',mail),/Sign in to accept/);
    const request={token,requestId:randomUUID()},result=await acceptInvitation(db,actor,'existing',request,'fixture',mail);
    assert.equal(result.signInRequired,false);assert.equal((await acceptInvitation(db,actor,'existing',request,'fixture',mail)).duplicate,true);
    assert.deepEqual(db.prepare("SELECT * FROM staff_credentials WHERE staff_id='recipient-home'").get(),original);
    assert.equal(db.prepare("SELECT role FROM staff WHERE id='recipient-home'").get().role,'auditor');
    assert.equal(db.prepare('SELECT role FROM staff WHERE id=?').get(result.staffId).role,'supervisor');
    assert.equal(db.prepare("SELECT count(*) n FROM staff_account_memberships WHERE account_id='recipient-home'").get().n,2);
    assert.equal(requireSession(db,{headers:{cookie:`understood_session=${session.token}`}},auth).site_id,'harbor-yard');
    assert.throws(()=>issueInvitation(db,owner,issue(),mail),/already has a site membership/);
  }finally{db.close();}
});

test('resend revokes earlier links and inflight mail; cancellation is permanent and replay cannot issue a fresh link',async()=>{
  const db=fixture();try {
    const input=issue();issueInvitation(db,owner,input,mail);const first=await deliver(db),resend=change(1);
    assert.equal(changeInvitation(db,owner,input.requestId,'resend',resend,mail).revision,2);
    assert.equal(changeInvitation(db,owner,input.requestId,'resend',resend,mail).duplicate,true);
    assert.throws(()=>previewInvitation(db,{token:first.token},'fixture'),/Invitation unavailable/);
    const second=await deliver(db);assert.notEqual(second.token,first.token);assert.equal(previewInvitation(db,{token:second.token},'fixture').role,'supervisor');
    const cancel=change(2);assert.equal(changeInvitation(db,owner,input.requestId,'cancel',cancel,mail).state,'cancelled');
    assert.equal(changeInvitation(db,owner,input.requestId,'cancel',cancel,mail).duplicate,true);
    await assert.rejects(acceptInvitation(db,null,'signup',accept(second.token),'fixture',mail),/Invitation unavailable/);
    assert.throws(()=>changeInvitation(db,owner,input.requestId,'resend',change(2),mail),/closed/);
    assert.equal(issueInvitation(db,owner,input,mail).duplicate,true);assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_tokens').get().n,2);
    assert.throws(()=>db.prepare("UPDATE staff_invitations SET state='pending'").run(),/immutable/);
  }finally{db.close();}
});

test('issuer role/access and account disable/restore invalidate old invitations; administrators cannot invite elevated roles',async()=>{
  const db=fixture();try {
    db.prepare("INSERT INTO staff VALUES('admin','cedar','beirut','Synthetic administrator','administrator',1)").run();provisionStaffCredential(db,'admin','admin@example.test',password);
    const admin={...owner,principal_id:'admin',role:'administrator'};
    for(const role of ['owner','administrator']) assert.throws(()=>issueInvitation(db,admin,issue(`new-${role}@example.test`,role),mail),/Forbidden/);
    const input=issue();issueInvitation(db,owner,input,mail);const {token}=await deliver(db);
    db.prepare("UPDATE staff_accounts SET active=0 WHERE id='maya'").run();db.prepare("UPDATE staff_accounts SET active=1 WHERE id='maya'").run();
    assert.throws(()=>previewInvitation(db,{token},'fixture'),/Invitation unavailable/);
    assert.equal(changeInvitation(db,owner,input.requestId,'resend',change(1),mail).revision,2);const fresh=await deliver(db);
    db.prepare("UPDATE staff SET role='auditor' WHERE id='maya'").run();
    await assert.rejects(acceptInvitation(db,null,'signup',accept(fresh.token),'fixture',mail),/Invitation unavailable/);
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_acceptances').get().n,0);
  }finally{db.close();}
});

test('acceptance and preparation audit failure roll back all membership, credential, token and delivery changes',async()=>{
  const db=fixture();try {
    const input=issue();issueInvitation(db,owner,input,mail);
    db.exec("CREATE TRIGGER fail_prepare BEFORE INSERT ON audit WHEN NEW.action='staff.invitation_prepared' BEGIN SELECT RAISE(ABORT,'Injected preparation audit');END;");
    await assert.rejects(deliver(db),/Injected preparation/);assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_tokens').get().n,0);
    assert.equal(db.prepare('SELECT attempts FROM staff_invitation_mail').get().attempts,0);db.exec('DROP TRIGGER fail_prepare');
    const {token}=await deliver(db),before=db.prepare('SELECT count(*) n FROM staff').get().n;
    db.exec("CREATE TRIGGER fail_accept BEFORE INSERT ON audit WHEN NEW.action='staff.invitation_accepted' BEGIN SELECT RAISE(ABORT,'Injected acceptance audit');END;");
    await assert.rejects(acceptInvitation(db,null,'signup',accept(token),'fixture',mail),/Injected acceptance/);
    assert.equal(db.prepare('SELECT count(*) n FROM staff').get().n,before);assert.equal(db.prepare('SELECT count(*) n FROM staff_credentials').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_acceptances').get().n,0);assert.equal(db.prepare('SELECT used_at FROM staff_invitation_tokens').get().used_at,null);
    assert.equal(previewInvitation(db,{token},'fixture').role,'supervisor');
  }finally{db.close();}
});

test('delivery retries keep the same encrypted link/key, expiry fences acceptance and stale completion cannot mark sent',async context=>{
  context.mock.timers.enable({apis:['Date'],now:Date.now()});const db=fixture();try {
    const input=issue();issueInvitation(db,owner,input,mail);const deliveries=[];
    const send=async(_config,id,message)=>{deliveries.push({id,message});throw new Error('Private provider failure');};
    await processOneInvitation(db,mail,{send});const envelope=db.prepare('SELECT payload FROM staff_invitation_mail').get().payload;
    context.mock.timers.tick(31000);await processOneInvitation(db,mail,{send});assert.deepEqual(deliveries[1],deliveries[0]);assert.equal(db.prepare('SELECT payload FROM staff_invitation_mail').get().payload,envelope);
    context.mock.timers.tick(61000);
    await processOneInvitation(db,mail,{send:async()=>{context.mock.timers.tick(31000);return {providerId:'too-late'};}});
    assert.equal(db.prepare('SELECT state FROM staff_invitation_mail').get().state,'processing');expireInvitations(db);assert.equal(db.prepare('SELECT state FROM staff_invitation_mail').get().state,'failed');
    assert.equal(db.prepare('SELECT payload FROM staff_invitation_mail').get().payload,null);
    const token=deliveries[0].message.text.match(/#accept-invitation\/([A-Za-z0-9_-]{43})/)[1];
    context.mock.timers.tick(49*3600000);expireInvitations(db);assert.throws(()=>previewInvitation(db,{token},'fixture'),/Invitation unavailable/);
    assert.equal(db.prepare('SELECT state,email_payload FROM staff_invitations').get().state,'expired');assert.equal(db.prepare('SELECT email_payload FROM staff_invitations').get().email_payload,null);
    const replacement=issue();assert.equal(issueInvitation(db,owner,replacement,mail).state,'pending');
  }finally{db.close();}
});

test('concurrent acceptance of the same request consumes once and returns an authenticated replay',async()=>{
  const db=fixture();try {
    issueInvitation(db,owner,issue(),mail);const {token}=await deliver(db),request=accept(token);
    const before=db.prepare('SELECT count(*) n FROM staff').get().n;
    const results=await Promise.all([acceptInvitation(db,null,'signup',request,'fixture',mail),acceptInvitation(db,null,'signup',request,'fixture',mail)]);
    assert.equal(results.filter(row=>row.duplicate).length,1);assert.equal(results[0].staffId,results[1].staffId);
    assert.equal(db.prepare('SELECT count(*) n FROM staff').get().n,before+1);
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_acceptances').get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM audit WHERE action='staff.invitation_accepted'").get().n,1);
  }finally {db.close();}
});

test('expired list reads are truthful before scheduled cleanup and remain read-only',async context=>{
  context.mock.timers.enable({apis:['Date'],now:Date.now()});const db=fixture();try {
    issueInvitation(db,owner,issue(),mail);context.mock.timers.tick(49*3600000);
    assert.equal(listInvitations(db,owner,{status:'pending'}).total,0);
    const expired=listInvitations(db,owner,{status:'expired'});assert.equal(expired.total,1);assert.equal(expired.items[0].state,'expired');assert.equal(expired.items[0].delivery,'expired');
    assert.equal(db.prepare('SELECT state FROM staff_invitations').get().state,'pending');
    assert.equal(db.prepare('SELECT state FROM staff_invitation_mail').get().state,'queued');
  }finally {db.close();}
});

test('private envelope corruption and inflight cancellation fail closed without provider completion',async()=>{
  const db=fixture();try {
    const first=issue();issueInvitation(db,owner,first,mail);
    db.prepare("UPDATE staff_invitations SET email_payload=NULL WHERE id=?").run(first.requestId);
    let calls=0;await processOneInvitation(db,mail,{send:async()=>{calls++;return {providerId:'must-not-send'};}});
    assert.equal(calls,0);assert.equal(db.prepare('SELECT state FROM staff_invitation_mail').get().state,'failed');
    const second=issue('inflight@example.test');issueInvitation(db,owner,second,mail);
    await processOneInvitation(db,mail,{send:async()=>{changeInvitation(db,owner,second.requestId,'cancel',change(1),mail);return {providerId:'late-provider-ack'};}});
    assert.equal(db.prepare('SELECT state,payload,provider_id FROM staff_invitation_mail WHERE invitation_id=?').get(second.requestId).state,'ignored');
    assert.equal(db.prepare('SELECT provider_id FROM staff_invitation_mail WHERE invitation_id=?').get(second.requestId).provider_id,null);
    const third=issue('retry-corrupt@example.test');issueInvitation(db,owner,third,mail);
    await processOneInvitation(db,mail,{send:async()=>{throw new Error('Synthetic failure');}});
    const job=db.prepare('SELECT * FROM staff_invitation_mail WHERE invitation_id=?').get(third.requestId);
    db.prepare('UPDATE staff_invitation_mail SET payload=?,next_at=? WHERE id=?').run(sealMail(mail,job.id,{email:third.email,subject:'Your Understood invitation',text:null}),new Date(0).toISOString(),job.id);
    await processOneInvitation(db,mail,{send:async()=>{calls++;return {providerId:'must-not-send'};}});
    assert.equal(calls,0);assert.equal(db.prepare('SELECT state,payload FROM staff_invitation_mail WHERE id=?').get(job.id).state,'failed');
    assert.throws(()=>db.prepare('UPDATE staff_invitation_mail SET generation=generation+1 WHERE id=?').run(job.id),/immutable/);
    assert.throws(()=>db.prepare('INSERT INTO staff_invitation_tokens VALUES(?,?,?,?,NULL,NULL)').run('forged-generation',third.requestId,2,job.expires_at),/generation mismatch/);
  }finally {db.close();}
});

test('preview and acceptance share a bounded anonymous throttle and scoped readers never enumerate other sites',async()=>{
  const db=fixture();try {
    for(let index=0;index<6;index++) issueInvitation(db,owner,issue(`paged-${index}@example.test`),mail);
    assert.equal(listInvitations(db,owner,{page:1}).items.length,5);assert.equal(listInvitations(db,owner,{page:2}).items.length,1);
    const {token}=await deliver(db);for(let index=0;index<10;index++) previewInvitation(db,{token},'bounded-ip');
    assert.throws(()=>previewInvitation(db,{token},'bounded-ip'),/Invitation unavailable/);
    await assert.rejects(acceptInvitation(db,null,'signup',accept(token),'bounded-ip',mail),/Invitation unavailable/);
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_acceptances').get().n,0);
    db.prepare("INSERT INTO staff VALUES('foreign-reader','harbor','harbor-yard','Synthetic reader','auditor',1)").run();provisionStaffCredential(db,'foreign-reader','reader@example.test',password);
    const reader={...owner,principal_id:'foreign-reader',org_id:'harbor',site_id:'harbor-yard',role:'auditor'};
    assert.equal(listInvitations(db,reader).total,0);assert.equal(invitationReceipt(db,reader,db.prepare('SELECT request_id FROM staff_invitation_requests LIMIT 1').get().request_id).accepted,false);
    assert.throws(()=>issueInvitation(db,reader,issue('denied@example.test'),mail),/Forbidden/);
  }finally {db.close();}
});

test('invitation HTTP requires origin and credentials, redacts failures and never publishes bearer links',async()=>{
  const db=fixture(),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:mail.publicOrigin,
    mail:{mode:'resend',apiKey:'re_synthetic_only',from:'fixture@example.test',key:'07'.repeat(32)}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const signed=createSession(db,{id:'maya',org_id:'cedar',site_id:'beirut'},'staff','credential'),cookie=`understood_session=${signed.token}`;
  const call=(path,body,actor='',origin=mail.publicOrigin)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',origin,...(actor ? {cookie:actor} : {})},body:JSON.stringify(body)});
  try {
    const input=issue();assert.equal((await call('/api/settings/invitations',input)).status,401);
    assert.equal((await call('/api/settings/invitations',input,cookie,'https://foreign.test')).status,403);
    assert.equal((await call('/api/settings/invitations?site=foreign',input,cookie)).status,400);
    assert.equal((await call('/api/settings/invitations',{...input,orgId:'foreign'},cookie)).status,400);
    const issued=await call('/api/settings/invitations',input,cookie);assert.equal(issued.status,202);const result=await issued.json();assert.equal(result.delivery,'queued');assert.ok(!/token|email|payload/i.test(JSON.stringify(result)));
    const list=await fetch(url+'/api/settings/invitations',{headers:{cookie}});assert.equal(list.status,200);assert.ok(!/token_hash|payload|email_hash/.test(JSON.stringify(await list.json())));
    const {token}=await deliver(db);
    const preview=await call('/api/auth/invitations/preview',{token});assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');assert.equal(preview.headers.get('referrer-policy'),'no-referrer');
    assert.equal((await call('/api/auth/invitations/preview?token='+token,{token})).status,400);
    assert.equal((await fetch(url+'/api/auth/invitations/preview?token='+token)).status,401);
    assert.equal((await call('/api/auth/invitations/accept',{token,requestId:randomUUID()})).status,401);
    assert.equal((await call('/api/auth/invitations/signup',accept(token),cookie)).status,401);
    const request=accept(token),accepted=await call('/api/auth/invitations/signup',request);assert.equal(accepted.status,200);assert.match(accepted.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await accepted.json()).signInRequired,true);
    assert.equal((await call('/api/auth/invitations/signup',request)).status,200);
    assert.equal((await call('/api/auth/invitations/signup',accept(token))).status,400);
    const after=await fetch(url+'/api/session');assert.equal((await after.json()).authenticated,false);
    db.exec("CREATE TRIGGER fail_http_invite BEFORE INSERT ON audit WHEN NEW.action='staff.invitation_issued' BEGIN SELECT RAISE(ABORT,'Private provider-key=never-expose');END;");
    const failed=await call('/api/settings/invitations',issue('rollback-http@example.test'),cookie);assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes('provider-key'));
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitations').get().n,1);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('disabled invitation email does not pretend to onboard staff',async()=>{
  const db=fixture(),server=createAppServer(db,{tier:'local',aiMode:'synthetic',accessMode:'credential',publicOrigin:mail.publicOrigin,mail:{mode:'disabled'}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const signed=createSession(db,{id:'maya',org_id:'cedar',site_id:'beirut'},'staff','credential');
  try {
    const response=await fetch(url+'/api/settings/invitations',{method:'POST',headers:{'content-type':'application/json',origin:mail.publicOrigin,cookie:`understood_session=${signed.token}`},body:JSON.stringify(issue())});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Email delivery unavailable'});
    assert.equal(db.prepare('SELECT count(*) n FROM staff_invitation_mail').get().n,0);
  }finally {await new Promise(resolve=>server.close(resolve));db.close();}
});
