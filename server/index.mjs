import { createServer as createHttpServer } from "node:http";
import { send,readJson } from './http.mjs';
import {ensurePilotSchema,savePilot,readPilot} from './pilot.mjs';
import {pilotDestination} from './pilot-input.mjs';
import {handlePilotRoute} from './pilot-http.mjs';
import {ensureOnboardingSchema,getOnboarding,saveOnboarding,onboardingReceipt} from './onboarding.mjs';
import { randomUUID } from "node:crypto";
import {clientSessionContext,verifyClientSession} from './session-context.mjs';
import {readWorkerRedemption,redemptionHttpInput} from './worker-redemption.mjs';
import {listSites,createSite,siteCreationReceipt,saveSiteAccess,siteAccessReceipt,inspectSiteLifecycle,saveSiteLifecycle,siteLifecycleReceipt} from './sites.mjs';
import {ensureSiteAdmissionGuards} from './site-schema.mjs';
import {siteLifecycleState,requireSiteOperational} from './site-lifecycle.mjs';
import {archivedWriteAllowed} from './site-lifecycle-input.mjs';
import {siteHttpError} from './site-input.mjs';
import { openDatabase, NOW, transaction } from "./db.mjs";
import { tokenHash } from "./auth-crypto.mjs";
import { seed } from "./seed.mjs";
import { metrics, publish, submitAnswer,withdrawPublication } from "./domain.mjs";
import { handleRecordingRoute } from "./recording-http.mjs";
import {handleSourceAudioRoute} from './source-audio-http.mjs';
import {receiveSourceAudio,getSourceAudioReceipt,getSourceAudio,listSourceAudio} from './source-audio.mjs';
import {retrySourceAudio,getSourceRetryReceipt} from './source-audio-retry.mjs';
import {DEFAULT_AUDIO_ROOT} from './recordings.mjs';
import { ensureRecordingSchema, isCurrentRecording, responseColumns } from "./recordings.mjs";
import { briefingActivityCsv,listReportPublications,reportActivity } from "./reports.mjs";
import {reportScope} from './report-scope.mjs';
import { listAuditEvents, getAuditEvent, exportAuditEvents } from './audit.mjs';
import {listNotifications,readNotification,notificationReceipt} from './notifications.mjs';
import {listWorkerNotifications,readWorkerNotification,workerNotificationReceipt,savePushSubscription,revokePushSubscription,pushSubscriptionStatus} from './notification-events.mjs';
import {resolvePushAdapter} from './push-adapter.mjs';
import {searchSite} from './search.mjs';
import {searchQuery} from './search-input.mjs';
import { ensureClarificationSchema,listClarifications,getClarification,requestHelp,resolveClarification,assignClarification,clarificationActionReceipt,workerHelpCases,workerHelpHistory } from './clarifications.mjs';
import {listClarificationSubjects,getClarificationSubject,createStaffClarification,staffClarificationCreationReceipt} from './clarification-create.mjs';
import {clarificationPageView,clarificationDetailView,clarificationHttpError} from './clarification-view.mjs';
import {listCaseTimeline} from './case-timeline.mjs';
import {ensureStaffCaseRecordingSchema} from './staff-case-recording-schema.mjs';
import {listStaffCaseRecordings,staffCaseRecordingReceipt,receiveStaffCaseRecording,getStaffCaseRecordingAudio} from './staff-case-recordings.mjs';
import {handleStaffCaseRecordingRoute} from './staff-case-recording-http.mjs';
import {audioStore} from './private-storage.mjs';
import {ensureCaseMessageSchema,listCaseMessages,sendCaseMessage,caseMessageReceiptLookup} from './case-messages.mjs';
import {queueCaseFollowup,followupReceipt,followupGenerationAvailable,getFollowupAudio} from './case-followups.mjs';
import {resolveCaseFollowup} from './ai/case-followup-config.mjs';
import { ensureBriefingSchema,createDraft,editDraft,queuePreparation,copyDraft,archiveBriefing,getPreparationRequestContext,getPreparationRequestReceipt,requestPreparation } from './preparation.mjs';
import {ensureInstructionSchema} from './instruction-schema.mjs';
import {startInstructionSend,completeInstructionSend,instructionSendStatus,instructionAudienceOverview,retryInstructionSend,instructionDeliveryContentForAssignment} from './instructions.mjs';
import {acknowledgeAssignment} from './acknowledgments.mjs';
import {createPresentation,listPresentations} from './presentations.mjs';
import {processOne} from './worker.mjs';
import { briefingFilters } from './briefing-input.mjs';
import {listPublicationHistory,getPublicationHistoryDetail} from './publication-history.mjs';
import {publicationHistoryQuery} from './publication-history-input.mjs';
import {createSchedule,listSchedules,cancelSchedule} from './schedules.mjs';
import {scheduleHttpError} from './schedule-input.mjs';
import {publicationReceipt,publicationReceiptHttpError} from './publication-receipts.mjs';
import {draftCreationReceipt,draftCreationHttpError} from './draft-creations.mjs';
import { listProcessing,getProcessing,getProcessingProvenance } from './processing.mjs';
import {handleProcessingProvenanceRoute} from './processing-provenance-http.mjs';
import {getProcessingRetryContext,getProcessingRetryReceipt,retryProcessing} from './processing-retry.mjs';
import {handleProcessingRetryRoute} from './processing-retry-http.mjs';
import {ensureBillingSchema,listInvoices,getInvoice,createInvoice,recordPayment,voidInvoice,billingReceipt} from './billing.mjs';
import {billingRecoveryScope} from './billing-input.mjs';
import {ensureSettingsSchema,getSettings,updateSettings,settingsReceipt,listSiteContacts,getDraftLanguageSelection} from './settings.mjs';
import {getFirstRun,completeFirstRun} from './first-run.mjs';
import {saveDraftLanguages,draftLanguagesReceipt} from './draft-languages.mjs';
import {listStaff,changeStaff,staffReceipt} from './staff.mjs';
import {staffRecoveryScope} from './staff-input.mjs';
import {staffSiteScope} from './account-input.mjs';
import {resolveMailConfig} from './auth-mail.mjs';
import {ensureRecoverySchema,requestRecovery,resetPassword} from './account-recovery.mjs';
import {ensureRegistrationSchema,requestRegistration,resendRegistration,verifyRegistration} from './registration.mjs';
import {listAccountSites,switchAccountSite} from './accounts.mjs';
import {siteCrewOverview} from './site-crews.mjs';
import {crewOverviewHttpError} from './crew-overview.mjs';
import {issueInvitation,changeInvitation,listInvitations,invitationReceipt,previewInvitation,acceptInvitation} from './invitations.mjs';
import {getDraftReview,saveDraftReview,draftReviewReceipt} from './draft-review.mjs';
import {ensureTemplateSchema,listTemplates,getTemplate,changeTemplate,templateReceipt} from './templates.mjs';
import {templateRecoveryScope} from './template-input.mjs';
import {listGlossary,getGlossaryTerm,changeGlossary,glossaryReceipt} from './glossary.mjs';
import { listPublicationResponses,getPublicationResponse,workerSubmissions,workerSubmission,staffWorkerAssignments,workerBriefings,workerRequestReceipt } from './responses.mjs';
import { ensureExportSchema, requestExport, listExports, retryExport, downloadExport,exportReceipt } from './exports.mjs';
import {sendInvoiceDownload} from './invoice-download.mjs';
import {languageReadinessModel,latestPublicationSnapshot} from './language-readiness.mjs';
import {usageModel,usageEntitlement} from './usage.mjs';
import {entitlementState} from './entitlements.mjs';
import {countActiveWorkers} from './worker-capacity.mjs';
import {saveActivationRequest,activationRequestReceipt} from './activation.mjs';
import {getRetention,saveRetention,retentionReceipt} from './retention.mjs';
import {getWorkerDeletion,requestWorkerDeletion,listPrivacyWorkers} from './deletions.mjs';
import {getRecordingNotice,saveRecordingNotice,recordingNoticeReceipt} from './recording-notices.mjs';
import {recordingNoticeLanguage} from './recording-notice-input.mjs';
import { ensureWorkerImportSchema, readImportBytes, previewWorkerImport, getWorkerImport,
  confirmWorkerImport, workerImportErrorsCsv } from './worker-import.mjs';
import { ensurePeopleSchema, listWorkers, createWorker, updateWorker, disableWorker,reenableWorker,
  listCrews,getCrew,listCrewRecipients, createCrew, moveWorkerToCrew, renameCrew, archiveCrew,restoreCrew,
  workerLanguageState, workerLanguageHistory, selectWorkerLanguage, requestWorkerLanguage,
  staffWorkerLanguageHistory, listLanguageRequests, decideWorkerLanguageRequest } from './people.mjs';
import {
  authenticateStaff,
  clearSessionCookie,
  createSession,
  issueWorkerGrant,
  grantIssueInput,
  listWorkerGrants,
  redeemWorkerGrant,
  requireLocalRequest,
  requireSession,
  resolveAuthConfig,
  revokeSession,
  revokeWorkerGrant,
  sessionCookie,
  verifyMutationOrigin,
} from "./auth.mjs";
import {workerCompanyContext,workerCredentialStatus,authenticateWorker,assignWorkerPassword} from './worker-credentials.mjs';

function staffOnly(session) {
  if (session.principal_type !== "staff" || !['owner','supervisor','auditor'].includes(session.role)) throw new Error("Forbidden");
}

function writableStaff(session) {
  staffOnly(session);
  if (!["owner", "supervisor"].includes(session.role))
    throw new Error("Forbidden");
}

function latestPublication(db, session) {
  return db
    .prepare(
      `SELECT p.* FROM publications p WHERE p.org_id=? AND p.site_id=? AND p.state='published'
    ORDER BY p.published_at DESC LIMIT 1`,
    )
    .get(session.org_id, session.site_id);
}

function staffOverview(db, session, config) {
  const organization = db
    .prepare("SELECT name FROM organizations WHERE id=?")
    .get(session.org_id)?.name;
  const site = db
    .prepare("SELECT name FROM sites WHERE id=? AND org_id=?")
    .get(session.site_id, session.org_id)?.name;
  const publication = latestPublication(db, session);
  const counts = publication
    ? metrics(db, session.org_id, publication.id)
    : {
        assigned: 0,
        responses: 0,
        matches: 0,
        clarifications: 0,
        unassessed: 0,
        pending: 0,
        completion: 0,
      };
  const cases = db
    .prepare(
      `SELECT c.id,c.reason,c.status,c.created_at,w.code AS worker,a.language,b.title
    FROM clarifications c JOIN assignments a ON a.id=c.assignment_id AND a.org_id=c.org_id
    JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id
    JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id
    JOIN briefings b ON b.id=p.briefing_id AND b.org_id=p.org_id
    WHERE c.org_id=? AND a.site_id=? AND c.status='open' ORDER BY c.created_at DESC LIMIT 5`,
    )
    .all(session.org_id, session.site_id);
  return {
    organization,
    site,
    date: "Friday, 2 October",
    metrics: counts,
    cases,
    publication: publication
      ? {
          id: publication.id,
          briefingId: publication.briefing_id,
          version: publication.version,
          title: JSON.parse(publication.snapshot_json).title,
        }
      : null,
    demo: config.accessMode === "demo",
  };
}

function staffBriefings(db, session,filters) {
  const {search,status,publicationStatus,scheduleStatus,archiveStatus,sort,page,pageSize}=briefingFilters(filters);
  const order={updated:'updated_at DESC,id',oldest:'updated_at,id',title:'lower(title),id'}[sort];
  const row=db.prepare(`WITH scoped AS (
    SELECT b.id,b.title,b.state,b.revision,b.next_version,b.updated_at,p.version AS published_version,p.state AS publication_state,p.id AS latest_publication_id,p.snapshot_json AS latest_snapshot_json,a.occurred_at AS archived_at,s.state AS schedule_state,s.publish_at AS scheduled_for
    FROM briefings b LEFT JOIN publications p ON p.id=(SELECT latest.id FROM publications latest
      WHERE latest.briefing_id=b.id AND latest.org_id=b.org_id AND latest.site_id=b.site_id ORDER BY latest.version DESC LIMIT 1)
    LEFT JOIN briefing_archives a ON a.briefing_id=b.id AND a.org_id=b.org_id AND a.site_id=b.site_id
    LEFT JOIN publication_schedules s ON s.id=(SELECT latest.id FROM publication_schedules latest
      WHERE latest.briefing_id=b.id AND latest.org_id=b.org_id AND latest.site_id=b.site_id ORDER BY CASE WHEN latest.state='queued' THEN 0 ELSE 1 END,latest.created_at DESC,latest.id LIMIT 1)
    WHERE b.org_id=? AND b.site_id=?), filtered AS (
    SELECT * FROM scoped WHERE (?='' OR instr(lower(title),lower(?))>0) AND (?='all' OR state=?)
    AND (?='all' OR publication_state=? OR (?='unpublished' AND published_version IS NULL))
    AND (?='all' OR schedule_state=? OR (?='none' AND schedule_state IS NULL))
    AND (?='all' OR (?='active' AND archived_at IS NULL) OR (?='archived' AND archived_at IS NOT NULL)))
    SELECT (SELECT COUNT(*) FROM filtered) AS total,
      (SELECT json_group_array(json_object('id',id,'title',title,'state',state,'revision',revision,'next_version',next_version,
        'updated_at',updated_at,'published_version',published_version,'publication_state',publication_state,'latest_publication_id',latest_publication_id,'latest_snapshot_json',latest_snapshot_json,'archived_at',archived_at,'schedule_state',schedule_state,'scheduled_for',scheduled_for))
        FROM (SELECT * FROM filtered ORDER BY ${order} LIMIT ? OFFSET ?)) AS items_json`)
    .get(session.org_id,session.site_id,search,search,status,status,publicationStatus,publicationStatus,publicationStatus,scheduleStatus,scheduleStatus,scheduleStatus,archiveStatus,archiveStatus,archiveStatus,pageSize,(page-1)*pageSize);
  const items=JSON.parse(row.items_json).map(item=>{
    const {latest_snapshot_json,latest_publication_id,...rest}=item;
    const send=db.prepare('SELECT response_mode,delivery_mode,state,delivered,undelivered FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?')
      .get(item.id,session.org_id,session.site_id);
    return {...rest,...(send?{responseMode:send.response_mode,deliveryMode:send.delivery_mode,sendState:send.state,delivered:send.delivered,undelivered:send.undelivered}:{}),
      languages:latest_snapshot_json?Object.keys(JSON.parse(latest_snapshot_json).languages || {}):[],metrics:latest_publication_id?metrics(db,session.org_id,latest_publication_id):null};
  });
  const countRow=db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN b.state='processing' THEN 1 ELSE 0 END) AS processing,SUM(CASE WHEN b.state='ready' THEN 1 ELSE 0 END) AS ready,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM briefing_archives a WHERE a.briefing_id=b.id AND a.org_id=b.org_id AND a.site_id=b.site_id) THEN 1 ELSE 0 END) AS archived,
    SUM(CASE WHEN EXISTS(SELECT 1 FROM publications p WHERE p.briefing_id=b.id AND p.org_id=b.org_id AND p.site_id=b.site_id AND p.version=(SELECT MAX(latest.version) FROM publications latest WHERE latest.briefing_id=b.id AND latest.org_id=b.org_id AND latest.site_id=b.site_id) AND p.state='published') THEN 1 ELSE 0 END) AS published
    FROM briefings b WHERE b.org_id=? AND b.site_id=?`).get(session.org_id,session.site_id);
  return {items,total:row.total,page,pageSize,counts:countRow};
}

export function createAppHandler(db, options = {}) {
  const config = options.config ?? resolveAuthConfig(options);
  const caseFollowupAdapter = Object.hasOwn(options,'caseFollowupAdapter') ? options.caseFollowupAdapter : resolveCaseFollowup();
  const mail=resolveMailConfig({...options.mail,publicOrigin:config.publicOrigin,allowLocal:true});
  const destination=pilotDestination(options.pilotDestination);
  const pilotMail=config.accessMode==='credential'?mail:{available:false};
  const presentationTranslator=options.presentationTranslator ?? null;
  const presentationGenerationAllowed=options.presentationGenerationAllowed !== false;
  const pushAdapter=options.pushAdapter ?? resolvePushAdapter(options.pushEnv);
  db ??= openDatabase();
  if (config.accessMode === "demo") seed(db);
  ensureRecordingSchema(db);
  ensurePeopleSchema(db);
  ensureExportSchema(db);
  ensureWorkerImportSchema(db);
  ensureClarificationSchema(db);
  ensureCaseMessageSchema(db);
  ensureStaffCaseRecordingSchema(db);
  ensureBriefingSchema(db);
  ensureInstructionSchema(db);
  ensureBillingSchema(db);
  ensureSettingsSchema(db);
  ensureTemplateSchema(db);
  ensureRecoverySchema(db);
  ensureRegistrationSchema(db);
  ensurePilotSchema(db);
  ensureOnboardingSchema(db);
  ensureSiteAdmissionGuards(db);
  const handler = async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;
    try {
      if (!config.remoteDemo) requireLocalRequest(req);
      if (path === "/api/health")
        return send(res, 200, {
          status: "ok",
          mode: `synthetic-${config.accessMode}`,
        });
      if (req.method !== "GET") verifyMutationOrigin(req, config);
      if(path.startsWith('/api/ops/'))return send(res,path==='/api/ops/session' && req.method==='GET'?200:404,
        path==='/api/ops/session' && req.method==='GET'?{available:false,authenticated:false}:{error:'Not found'});
      if(await handlePilotRoute(req,res,url,{save:(input,address)=>savePilot(db,input,address,{mail:pilotMail,destination}),read:(id,secret)=>readPilot(db,id,secret)}))return;
      if(path==='/api/auth/recovery' && req.method==='POST') {
        if(config.accessMode!=='credential') return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid recovery input');
        return send(res,202,requestRecovery(db,await readJson(req),req.socket.remoteAddress,mail));
      }
      if(path==='/api/auth/reset-password' && req.method==='POST') {
        if(config.accessMode!=='credential') return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid recovery input');
        const result=await resetPassword(db,await readJson(req),req.socket.remoteAddress,mail);
        return send(res,200,result,{'set-cookie':clearSessionCookie()});
      }
      if(path==='/api/auth/registrations' && req.method==='POST') {
        if(config.accessMode!=='credential') return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid registration input');
        return send(res,202,await requestRegistration(db,await readJson(req),req.socket.remoteAddress,mail));
      }
      if(path==='/api/auth/registrations/resend' && req.method==='POST') {
        if(config.accessMode!=='credential') return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid registration input');
        return send(res,202,resendRegistration(db,await readJson(req),req.socket.remoteAddress,mail));
      }
      if(path==='/api/auth/registrations/verify' && req.method==='POST') {
        if(config.accessMode!=='credential') return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid registration input');
        return send(res,200,verifyRegistration(db,await readJson(req),req.socket.remoteAddress,mail));
      }
      const invitationAcceptMatch=path.match(/^\/api\/auth\/invitations\/(preview|signup|accept)$/);
      if(invitationAcceptMatch && req.method==='POST') {
        if(config.accessMode!=='credential') return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid invitation input');
        const input=await readJson(req),action=invitationAcceptMatch[1];
        if(action==='preview') return send(res,200,previewInvitation(db,input,req.socket.remoteAddress));
        let actor=null;try {actor=requireSession(db,req,config);}catch(error) {if(error.message!=='Sign in required') throw error;}
        if(action==='accept' && !actor) throw new Error('Sign in required');
        const result=await acceptInvitation(db,actor,action==='signup' ? 'signup' : 'existing',input,req.socket.remoteAddress,mail);
        return send(res,200,result,action==='signup' ? {'set-cookie':clearSessionCookie()} : {});
      }
      if (path === "/api/session" && req.method === "GET") {
        try {
          const session = requireSession(db, req, config);
          const organization = db
            .prepare("SELECT name FROM organizations WHERE id=?")
            .get(session.org_id)?.name;
          const site = db
            .prepare("SELECT name,timezone FROM sites WHERE id=? AND org_id=?")
            .get(session.site_id, session.org_id);
          const siteSettings=session.principal_type==='staff'
            ? db.prepare('SELECT staff_interface_language,first_run_completed_at FROM site_settings WHERE site_id=? AND org_id=?')
              .get(session.site_id,session.org_id)
            : null;
          return send(res, 200, {
            authenticated: true,
            ...clientSessionContext(session),
            mode: `synthetic-${config.accessMode}`,
            role: session.principal_type,
            staffRole:session.principal_type==='staff' ? session.role : null,
            staffScope:staffSiteScope(session),
            staffRecoveryScope:staffRecoveryScope(session),
            billingRecoveryScope:billingRecoveryScope(session),
            templateRecoveryScope:templateRecoveryScope(session),
            name: session.name || session.code,
            email: session.principal_type === "staff" && session.account_id
              ? db.prepare("SELECT c.email FROM staff_accounts a JOIN staff_credentials c ON c.staff_id=a.credential_staff_id WHERE a.id=?")
                .get(session.account_id)?.email
              : undefined,
            organization,
            site:site?.name,
            siteState:siteLifecycleState(db,session.org_id,session.site_id).state,
            timezone:site?.timezone,
            staffInterfaceLanguage: session.principal_type==='staff' ? siteSettings?.staff_interface_language ?? 'en' : null,
            firstRunRequired: session.principal_type==='staff' && session.role==='owner' && !!siteSettings && siteSettings.first_run_completed_at===null,
            language: session.language || "en",
            languageSelectionRequired: session.principal_type === "worker" ? !!session.language_selection_required : false,
            languageSelectedAt: session.principal_type === "worker" ? session.language_selected_at ?? null : null,
            languageSelectedBy: session.principal_type === "worker" ? session.language_selected_by ?? null : null,
            workerId:
              session.principal_type === "worker" ? session.principal_id : null,
          });
        } catch {
          return send(res, 200, {
            authenticated: false,
            mode: `synthetic-${config.accessMode}`,
          });
        }
      }
      if (path === "/api/demo/session" && req.method === "POST") {
        if (config.accessMode !== "demo")
          return send(res, 404, { error: "Not found" });
        const body = await readJson(req);
        const allowed = new Set([
          "maya",
          "worker-14",
          "worker-29",
          "worker-30",
          "harbor-owner",
          "harbor-worker",
        ]);
        if (!allowed.has(body.principal))
          throw new Error("Unknown synthetic profile");
        const type =
          body.principal.startsWith("worker") ||
          body.principal === "harbor-worker"
            ? "worker"
            : "staff";
        const principal = db
          .prepare(
            `SELECT * FROM ${type === "staff" ? "staff" : "workers"} WHERE id=? AND active=1`,
          )
          .get(body.principal);
        if (!principal) throw new Error("Unknown synthetic profile");
        let session;
        if (config.demoSessionToken) {
          const maxSeconds = 8 * 3600;
          const token = config.demoSessionToken(body.principal);
          db.prepare(`INSERT INTO sessions(token_hash,org_id,site_id,principal_type,principal_id,expires_at,revoked_at,grant_id,access_mode)
            VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at,revoked_at=NULL`)
            .run(tokenHash(token),principal.org_id,principal.site_id,type,principal.id,
              new Date(Date.now()+maxSeconds*1000).toISOString(),null,null,"demo");
          session={token,maxSeconds};
        } else {
          session = createSession(db, principal, type, "demo");
        }
        return send(
          res,
          200,
          { ok: true },
          { "set-cookie": sessionCookie(session.token, session.maxSeconds, config.cookieOptions) },
        );
      }
      if (path === "/api/auth/staff/login" && req.method === "POST") {
        if (config.accessMode !== "credential")
          return send(res, 404, { error: "Not found" });
        const body = await readJson(req);
        const principal = authenticateStaff(
          db,
          body.email,
          body.password,
          req.socket.remoteAddress,
        );
        const session = createSession(db, principal, "staff", "credential");
        return send(
          res,
          200,
          { ok: true },
          { "set-cookie": sessionCookie(session.token, session.maxSeconds) },
        );
      }
      if (path === "/api/auth/worker/redeem" && req.method === "POST") {
        if (config.accessMode !== "credential")
          return send(res, 404, { error: "Not found" });
        const body = await readJson(req);
        if(!['token','company','workerId','password'].every(key=>typeof body[key]==='string' && body[key].length>0))throw new Error('Invalid credentials');
        const session = authenticateWorker(db,body,req.socket.remoteAddress);
        return send(
          res,
          200,
          { ok: true },
          { "set-cookie": sessionCookie(session.token, session.maxSeconds) },
        );
      }
      if (path === "/api/auth/worker/context" && req.method === "GET") {
        if (config.accessMode !== "credential") return send(res,404,{error:'Not found'});
        const keys=[...url.searchParams.keys()];
        if(keys.length!==1 || keys[0]!=='company' || url.searchParams.getAll('company').length!==1)
          throw new Error('Invalid input');
        return send(res,200,workerCompanyContext(db,{company:url.searchParams.get('company')}));
      }
      if (path === "/api/auth/worker/login" && req.method === "POST") {
        if (config.accessMode !== "credential") return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid input');
        const session = authenticateWorker(db, await readJson(req), req.socket.remoteAddress);
        return send(res,200,{ok:true},{'set-cookie':sessionCookie(session.token,session.maxSeconds)});
      }
      if (path === "/api/auth/worker/setup" && req.method === "POST") {
        if (config.accessMode !== "credential") return send(res,404,{error:'Not found'});
        if(url.search) throw new Error('Invalid input');
        return send(res,410,{error:'Use the worker ID and password assigned by your company.'});
      }
      const session = requireSession(db, req, config);
      if(!archivedWriteAllowed(path,req.method))requireSiteOperational(db,session.org_id,session.site_id);
      try {verifyClientSession(req,session,path);}catch(error) {
        if(error.message==='Session context changed')return send(res,409,{error:error.message});
        throw error;
      }
      if(path==='/api/search' && req.method==='GET')return send(res,200,searchSite(db,session,searchQuery(url.searchParams)));
      if(path==='/api/auth/worker/redemption' && req.method==='GET')return send(res,200,readWorkerRedemption(db,session,redemptionHttpInput(req,url)));
      if(await handleSourceAudioRoute(req,res,session,url,{
        list:(s,filters)=>listSourceAudio(db,s,filters),
        retry:(s,id,input)=>retrySourceAudio(db,s,id,input),
        retryReceipt:(s,id,retryId)=>getSourceRetryReceipt(db,s,id,retryId),
        receive:(s,input,original,wav)=>receiveSourceAudio(db,s,input,original,wav,options.audioRoot ?? DEFAULT_AUDIO_ROOT),
        receipt:(s,id)=>getSourceAudioReceipt(db,s,id),
        audio:(s,id,kind)=>getSourceAudio(db,s,id,options.audioRoot ?? DEFAULT_AUDIO_ROOT,kind),
      }))return;
      if(path==='/api/account/sites' && req.method==='GET') return send(res,200,listAccountSites(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/account/site' && req.method==='POST') {
        if(url.search) throw new Error('Invalid account site request');
        const next=switchAccountSite(db,req,config,await readJson(req));
        return send(res,200,{ok:true},{'set-cookie':sessionCookie(next.token,next.maxSeconds)});
      }
      if (path === "/api/logout" && req.method === "POST") {
        revokeSession(db, req);
        return send(
          res,
          200,
          { ok: true },
          { "set-cookie": clearSessionCookie(config.cookieOptions) },
        );
      }
      if (
        path === "/api/worker-grants" &&
        req.method === "POST" &&
        config.accessMode === "credential"
      ) {
        const body = grantIssueInput(await readJson(req));
        const grant = issueWorkerGrant(
          db,
          session,
          body.workerId,
          body.expiresInMinutes ?? 240,
        );
        return send(res, 201, grant);
      }
      const grantRevoke = path.match(/^\/api\/worker-grants\/([^/]+)\/revoke$/);
      if (
        grantRevoke &&
        req.method === "POST" &&
        config.accessMode === "credential"
      ) {
        if(Object.keys(await readJson(req)).length) throw new Error('Invalid input');
        revokeWorkerGrant(db, session, grantRevoke[1]);
        return send(res, 200, { ok: true });
      }
      if (
        await handleRecordingRoute(
          req,
          res,
          db,
          session,
          path,
          options.audioRoot,
        )
      )
        return;
      if (path === "/api/overview" && req.method === "GET") {
        staffOnly(session);
        return send(res, 200, staffOverview(db, session, config));
      }
      if(path==='/api/instructions/audience' && req.method==='GET') {
        if(url.search) throw new Error('Invalid instruction request');
        return send(res,200,instructionAudienceOverview(db,session));
      }
      if(path==='/api/instructions/send' && req.method==='POST') {
        if(url.search) throw new Error('Invalid instruction request');
        const started=startInstructionSend(db,session,await readJson(req));
        let briefingState=db.prepare('SELECT state FROM briefings WHERE id=? AND org_id=? AND site_id=?')
          .get(started.briefingId,session.org_id,session.site_id)?.state;
        for(let i=0;i<10 && briefingState==='processing';i++) {
          if(!processOne(db)) break;
          briefingState=db.prepare('SELECT state FROM briefings WHERE id=? AND org_id=? AND site_id=?')
            .get(started.briefingId,session.org_id,session.site_id)?.state;
        }
        const result=completeInstructionSend(db,session,started.requestId);
        return send(res,result.state==='failed'?409:result.duplicate?200:201,result);
      }
      const instructionSendMatch=path.match(/^\/api\/instructions\/sends\/([^/]+)$/);
      if(instructionSendMatch && req.method==='GET') {
        if(url.search) throw new Error('Invalid instruction request');
        const current=instructionSendStatus(db,session,decodeURIComponent(instructionSendMatch[1]));
        if(current.state!=='preparing') return send(res,200,current);
        let briefingState=db.prepare('SELECT state FROM briefings WHERE id=? AND org_id=? AND site_id=?')
          .get(current.briefingId,session.org_id,session.site_id)?.state;
        for(let i=0;i<10 && briefingState==='processing';i++) {
          if(!processOne(db)) break;
          briefingState=db.prepare('SELECT state FROM briefings WHERE id=? AND org_id=? AND site_id=?')
            .get(current.briefingId,session.org_id,session.site_id)?.state;
        }
        const result=completeInstructionSend(db,session,current.requestId);
        return send(res,result.state==='failed'?409:200,result);
      }
      const instructionRetryMatch=path.match(/^\/api\/instructions\/sends\/([^/]+)\/retry$/);
      if(instructionRetryMatch && req.method==='POST') {
        if(url.search) throw new Error('Invalid instruction request');
        const result=retryInstructionSend(db,session,decodeURIComponent(instructionRetryMatch[1]),await readJson(req));
        return send(res,result.duplicate?200:201,result);
      }
      if(path==='/api/push/status' && req.method==='GET') {
        if(url.search) throw Error('Invalid push request');
        return send(res,200,pushSubscriptionStatus(db,session,pushAdapter));
      }
      if(path==='/api/push/subscriptions' && req.method==='POST') {
        if(url.search) throw Error('Invalid push request');
        return send(res,201,savePushSubscription(db,session,await readJson(req)));
      }
      const pushSubscriptionMatch=path.match(/^\/api\/push\/subscriptions\/([^/]+)$/);
      if(pushSubscriptionMatch && req.method==='DELETE') {
        if(url.search) throw Error('Invalid push request');
        return send(res,200,revokePushSubscription(db,session,decodeURIComponent(pushSubscriptionMatch[1])));
      }
      if(path==='/api/notifications' && req.method==='GET')return send(res,200,session.principal_type==='worker'
        ?listWorkerNotifications(db,session,Object.fromEntries(url.searchParams))
        :listNotifications(db,session,Object.fromEntries(url.searchParams)));
      const notificationReceiptMatch=path.match(/^\/api\/notifications\/([^/]+)\/receipt$/);
      if(notificationReceiptMatch && req.method==='GET') {
        if(url.search)throw Error('Invalid notification request');return send(res,200,session.principal_type==='worker'
          ?workerNotificationReceipt(db,session,notificationReceiptMatch[1])
          :notificationReceipt(db,session,notificationReceiptMatch[1]));
      }
      const notificationMatch=path.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if(notificationMatch && req.method==='POST') {
        if(url.search || Object.keys(await readJson(req)).length)throw Error('Invalid notification request');
        return send(res,200,session.principal_type==='worker'
          ?readWorkerNotification(db,session,notificationMatch[1])
          :readNotification(db,session,notificationMatch[1]));
      }
      if (path === '/api/audit' && req.method === 'GET') return send(res, 200, listAuditEvents(db, session, Object.fromEntries(url.searchParams)));
      if (path === '/api/audit.csv' && req.method === 'GET') {
        const csv = exportAuditEvents(db, session, Object.fromEntries(url.searchParams));
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="activity-history.csv"',
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        res.end(csv); return;
      }
      const auditMatch = path.match(/^\/api\/audit\/([^/]+)$/);
      if (auditMatch && req.method === 'GET') return send(res, 200, getAuditEvent(db, session, auditMatch[1]));
      if(path==='/api/people/crew-overview' && req.method==='GET') {
        try {
          if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid crew overview request');
          return send(res,200,siteCrewOverview(db,session,Object.fromEntries(url.searchParams)));
        }catch(error){const failure=crewOverviewHttpError(error);return send(res,failure.status,{error:failure.message});}
      }
      if (path === '/api/people/workers') {
        if (req.method === 'GET') return send(res, 200, listWorkers(db, session, Object.fromEntries(url.searchParams)));
        if (req.method === 'POST') return send(res, 201, createWorker(db, session, await readJson(req)));
      }
      const workerAssignments=path.match(/^\/api\/people\/workers\/([^/]+)\/assignments$/);
      if(workerAssignments && req.method==='GET') return send(res,200,staffWorkerAssignments(db,session,workerAssignments[1],Object.fromEntries(url.searchParams)));
      const workerLanguageRequests=path.match(/^\/api\/people\/workers\/([^/]+)\/language-requests$/);
      if(workerLanguageRequests && req.method==='GET') {
        if(url.search)throw Error('Invalid language request');
        return send(res,200,staffWorkerLanguageHistory(db,session,workerLanguageRequests[1]));
      }
      if(path==='/api/people/language-requests' && req.method==='GET')
        return send(res,200,listLanguageRequests(db,session,Object.fromEntries(url.searchParams)));
      const languageDecision=path.match(/^\/api\/people\/language-requests\/([^/]+)\/decision$/);
      if(languageDecision && req.method==='POST') {
        if(url.search)throw Error('Invalid language decision');
        return send(res,200,decideWorkerLanguageRequest(db,session,languageDecision[1],await readJson(req)));
      }
      const workerAccess=path.match(/^\/api\/people\/workers\/([^/]+)\/access$/);
      if(workerAccess && req.method==='GET' && config.accessMode==='credential') return send(res,200,listWorkerGrants(db,session,workerAccess[1],Object.fromEntries(url.searchParams)));
      const workerCredentials=path.match(/^\/api\/people\/workers\/([^/]+)\/credentials$/);
      if(workerCredentials && config.accessMode==='credential') {
        if(req.method!=='GET') return send(res,404,{error:'Not found'});
        if(url.search)throw Error('Invalid credential request');
        return send(res,200,workerCredentialStatus(db,session,workerCredentials[1]));
      }
      const workerPasswordAssignment=path.match(/^\/api\/people\/workers\/([^/]+)\/credentials\/password$/);
      if(workerPasswordAssignment && req.method==='POST'){
        if(config.accessMode!=='credential')return send(res,404,{error:'Not found'});
        if(url.search)throw new Error('Invalid input');
        return send(res,200,assignWorkerPassword(db,session,decodeURIComponent(workerPasswordAssignment[1]),await readJson(req)));
      }
      const workerCredentialSetup=path.match(/^\/api\/people\/workers\/([^/]+)\/credentials\/setup$/);
      if(workerCredentialSetup && config.accessMode==='credential') {
        if(req.method!=='POST') return send(res,404,{error:'Not found'});
        if(url.search)throw Error('Invalid credential request');
        workerCredentialStatus(db,session,workerCredentialSetup[1]);
        return send(res,410,{error:'Assign the worker ID and password from Team.'});
      }
      if (path === '/api/people/crews') {
        if (req.method === 'GET') return send(res, 200, listCrews(db, session,Object.fromEntries(url.searchParams)));
        if (req.method === 'POST') return send(res, 201, createCrew(db, session, await readJson(req)));
      }
      const crewRecipients=path.match(/^\/api\/people\/crews\/([^/]+)\/recipients$/);
      if(crewRecipients && req.method==='GET') {
        try {return send(res,200,listCrewRecipients(db,session,crewRecipients[1],Object.fromEntries(url.searchParams)));}
        catch(error) {
          const message=error.message,status=message==='Forbidden'?403:message==='Sign in required'?401:['Invalid input','Invalid crew','Crew unavailable','Crew recipient limit exceeded'].includes(message)?400:503;
          return send(res,status,{error:status===503?'Crew recipients unavailable':message});
        }
      }
      const crewMatch = path.match(/^\/api\/people\/crews\/([^/]+)(?:\/(archive|restore))?$/);
      if (crewMatch) {
        if(!crewMatch[2] && req.method==='GET'){if(url.search)throw Error('Invalid crew request');return send(res,200,getCrew(db,session,decodeURIComponent(crewMatch[1])));}
        const [, id, action] = crewMatch;
        if (!action && req.method === 'PATCH') return send(res, 200, renameCrew(db, session, id, await readJson(req)));
        if (action === 'archive' && req.method === 'POST') return send(res, 200, archiveCrew(db, session, id, await readJson(req)));
        if (action === 'restore' && req.method === 'POST') return send(res, 200, restoreCrew(db, session, id, await readJson(req)));
      }
      if (path === '/api/people/imports/preview' && req.method === 'POST') {
        writableStaff(session);
        if (req.headers['content-type']?.split(';')[0].trim() !== 'text/csv') throw new Error('Use text/csv for CSV upload');
        if ([...url.searchParams.keys()].some((key) => !['requestId', 'filename'].includes(key))) throw new Error('Invalid import request');
        return send(res, 200, previewWorkerImport(db, session, { requestId: url.searchParams.get('requestId'),
          filename: url.searchParams.get('filename'), bytes: await readImportBytes(req) }));
      }
      const importMatch = path.match(/^\/api\/people\/imports\/([^/]+)(?:\/(confirm|errors.csv))?$/);
      if (importMatch) {
        const [, id, action] = importMatch;
        if (!action && req.method === 'GET') return send(res, 200, getWorkerImport(db, session, id));
        if (action === 'confirm' && req.method === 'POST') {
          if (Object.keys(await readJson(req)).length) throw new Error('Invalid import confirmation');
          return send(res, 200, confirmWorkerImport(db, session, id));
        }
        if (action === 'errors.csv' && req.method === 'GET') {
          const csv = workerImportErrorsCsv(db, session, id);
          res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="worker-import-errors.csv"',
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
          res.end(csv); return;
        }
      }
      const peopleMatch = path.match(/^\/api\/people\/workers\/([^/]+)(?:\/(disable|reenable|crew|deletion))?$/);
      if (peopleMatch) {
        const [, id, action] = peopleMatch;
        if (!action && req.method === 'PATCH') return send(res, 200, updateWorker(db, session, id, await readJson(req)));
        if (action === 'disable' && req.method === 'POST') return send(res, 200, disableWorker(db, session, id));
        if (action === 'reenable' && req.method === 'POST') return send(res, 200, reenableWorker(db, session, id, await readJson(req)));
        if(action==='deletion'){
          if(url.search)throw new Error('Invalid deletion request');
          if(req.method==='GET')return send(res,200,getWorkerDeletion(db,session,id));
          if(req.method==='POST')return send(res,200,requestWorkerDeletion(db,session,id,await readJson(req)));
        }
        if (action === 'crew' && req.method === 'POST') {
          const body = await readJson(req);
          if (Object.keys(body).some((key) => key !== 'crewId')) throw new Error('Invalid input');
          return send(res, 200, moveWorkerToCrew(db, session, id, body.crewId));
        }
      }
      if (path === "/api/briefings" && req.method === "GET") {
        staffOnly(session);
        return send(res, 200, staffBriefings(db, session,Object.fromEntries(url.searchParams)));
      }
      const responses=path.match(/^\/api\/publications\/([^/]+)\/responses(?:\/([^/]+))?$/);
      if(responses && req.method==='GET') return send(res,200,responses[2]
        ? getPublicationResponse(db,session,responses[1],responses[2],Object.fromEntries(url.searchParams))
        : listPublicationResponses(db,session,responses[1],Object.fromEntries(url.searchParams)));
      if (path === "/api/briefings" && req.method === "POST") {
        const result=createDraft(db,session,await readJson(req));
        return send(res,result.duplicate ? 200 : 201,result);
      }
      const draftCreationRoute=path.match(/^\/api\/draft-creation-receipts\/([^/]+)$/);
      if(draftCreationRoute && req.method==='GET') {
        if(url.search) throw Error('Invalid draft creation receipt request');
        return send(res,200,draftCreationReceipt(db,session,decodeURIComponent(draftCreationRoute[1])));
      }
      const publicationReceiptRoute=path.match(/^\/api\/briefings\/([^/]+)\/publication-receipts\/([^/]+)\/([^/]+)$/);
      if(publicationReceiptRoute && req.method==='GET') {
        if(url.search)throw Error('Invalid publication receipt request');
        return send(res,200,publicationReceipt(db,session,...publicationReceiptRoute.slice(1).map(decodeURIComponent)));
      }
      const scheduleRoute=path.match(/^\/api\/briefings\/([^/]+)\/schedules(?:\/([^/]+)\/cancel)?$/);
      if(scheduleRoute) {
        const [,id,scheduleId]=scheduleRoute;
        if(req.method==='GET' && !scheduleId)return send(res,200,listSchedules(db,session,id,Object.fromEntries(url.searchParams)));
        if(req.method==='POST') {
          if(url.search)throw Error('Invalid publication schedule');
          if(scheduleId)return send(res,200,cancelSchedule(db,session,id,scheduleId,await readJson(req)));
          const result=createSchedule(db,session,id,await readJson(req,600000));return send(res,result.duplicate?200:202,result);
        }
      }
      const publicationHistoryRoute=path.match(/^\/api\/briefings\/([^/]+)\/publications(?:\/([^/]+))?$/);
      if(publicationHistoryRoute && req.method==='GET') {
        const [,briefingId,publicationId]=publicationHistoryRoute.map(value=>value?decodeURIComponent(value):value);
        const input=publicationHistoryQuery(url.searchParams,!!publicationId);
        return send(res,200,publicationId?getPublicationHistoryDetail(db,session,briefingId,publicationId):listPublicationHistory(db,session,briefingId,input));
      }
      const preparationRequestMatch=path.match(/^\/api\/briefings\/([^/]+)\/preparation-requests(?:\/([^/]+))?$/);
      if(preparationRequestMatch) {
        if(url.search)throw Error('Invalid preparation request');
        const [,id,requestId]=preparationRequestMatch;
        if(req.method==='GET')return send(res,200,requestId?getPreparationRequestReceipt(db,session,id,requestId):getPreparationRequestContext(db,session,id));
        if(req.method==='POST' && !requestId)return send(res,202,requestPreparation(db,session,id,await readJson(req)));
      }
      const briefingMatch = path.match(
        /^\/api\/briefings\/([^/]+)(?:\/(process|publish|withdraw|copy|archive|review))?$/,
      );
      if (briefingMatch) {
        staffOnly(session);
        const [, id, action] = briefingMatch;
        const briefing = db
          .prepare(
            "SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?",
          )
          .get(id, session.org_id, session.site_id);
        if (!briefing) return send(res, 404, { error: "Not found" });
        if (!action && req.method === "GET") {
          const archive=db.prepare('SELECT request_json,archived_by,occurred_at FROM briefing_archives WHERE briefing_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);
          const publications = db
            .prepare(
              "SELECT id,version,snapshot_json,published_at,state FROM publications WHERE briefing_id=? AND org_id=? AND site_id=? ORDER BY version DESC LIMIT 1",
            )
            .all(id, session.org_id,session.site_id)
            .map((row) => ({
              ...row,
              snapshot: JSON.parse(row.snapshot_json),
              snapshot_json: undefined,
              metrics: metrics(db, session.org_id, row.id),
              withdrawal: db.prepare('SELECT reason,withdrawn_by,occurred_at FROM publication_withdrawals WHERE publication_id=? AND org_id=? AND site_id=?').get(row.id,session.org_id,session.site_id) || null,
            }));
          return send(res, 200, {
            ...briefing,
            prepared: briefing.prepared_json
              ? JSON.parse(briefing.prepared_json)
              : null,
            prepared_json: undefined,
            publications,
            review:getDraftReview(db,id,session.org_id,session.site_id),
            generationLanguages:getDraftLanguageSelection(db,session.org_id,session.site_id,id),
            archive:archive ? {reason:JSON.parse(archive.request_json).reason,archived_by:archive.archived_by,occurred_at:archive.occurred_at} : null,
            ...(()=>{const sendRow=db.prepare('SELECT state,delivered,undelivered,audience_count FROM instruction_sends WHERE briefing_id=? AND org_id=? AND site_id=?').get(id,session.org_id,session.site_id);return sendRow?{sendState:sendRow.state,delivered:sendRow.delivered,undelivered:sendRow.undelivered,audienceCount:sendRow.audience_count}:{};})(),
          });
        }
        if (!action && req.method==='PATCH') return send(res,200,editDraft(db,session,id,await readJson(req)));
        if(action==='review' && req.method==='POST') {if(url.search) throw new Error('Invalid draft review request');return send(res,200,saveDraftReview(db,session,id,await readJson(req,100000)));}
        if(action==='archive' && req.method==='POST') return send(res,200,archiveBriefing(db,session,id,await readJson(req)));
        if(action==='copy' && req.method==='POST') {
          const result=copyDraft(db,session,id,await readJson(req));
          return send(res,result.duplicate ? 200 : 201,result);
        }
        if (action === "process" && req.method === "POST") {
          const body=await readJson(req);
          if (Object.keys(body).some((key) => key!=='revision')) throw new Error('Invalid draft request');
          return send(res,202,queuePreparation(db,session,id,body.revision));
        }
        if (action === "publish" && req.method === "POST") {
          const result = publish(db, session, id,await readJson(req,600000));
          return send(res,result.duplicate ? 200 : 201,result);
        }
        if (action === 'withdraw' && req.method === 'POST') return send(res,200,withdrawPublication(db,session,id,await readJson(req)));
      }
      if(path==='/api/templates' && req.method==='GET') return send(res,200,listTemplates(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/glossary' && req.method==='GET') return send(res,200,listGlossary(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/glossary' && req.method==='POST') {if(url.search) throw new Error('Invalid glossary request');const result=changeGlossary(db,session,'create',null,await readJson(req));return send(res,result.duplicate ? 200 : 201,result);}
      const glossaryReceiptMatch=path.match(/^\/api\/glossary\/receipts\/([^/]+)$/);
      if(glossaryReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid glossary request');return send(res,200,glossaryReceipt(db,session,decodeURIComponent(glossaryReceiptMatch[1])));}
      const glossaryMatch=path.match(/^\/api\/glossary\/([^/]+)(?:\/(edit|remove|restore|regenerate))?$/);
      if(glossaryMatch && !glossaryMatch[2] && req.method==='GET') return send(res,200,getGlossaryTerm(db,session,decodeURIComponent(glossaryMatch[1]),Object.fromEntries(url.searchParams)));
      if(glossaryMatch && glossaryMatch[2] && req.method==='POST') {if(url.search) throw new Error('Invalid glossary request');return send(res,200,changeGlossary(db,session,glossaryMatch[2],decodeURIComponent(glossaryMatch[1]),await readJson(req)));}
      const reviewReceiptMatch=path.match(/^\/api\/briefing-review\/receipts\/([^/]+)$/);
      const languagesMatch=path.match(/^\/api\/briefings\/([^/]+)\/generation-languages$/),languagesReceipt=path.match(/^\/api\/briefing-languages\/receipts\/([^/]+)$/);
      if(languagesMatch && req.method==='POST'){if(url.search)throw Error('Invalid draft languages request');return send(res,200,saveDraftLanguages(db,session,decodeURIComponent(languagesMatch[1]),await readJson(req,4096)));}
      if(languagesReceipt && req.method==='GET'){if(url.search)throw Error('Invalid draft languages request');return send(res,200,draftLanguagesReceipt(db,session,decodeURIComponent(languagesReceipt[1])));}
      if(reviewReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid draft review request');return send(res,200,draftReviewReceipt(db,session,decodeURIComponent(reviewReceiptMatch[1])));}
      if(path==='/api/templates' && req.method==='POST') {if(url.search) throw new Error('Invalid template request');const result=changeTemplate(db,session,'create',null,await readJson(req));return send(res,result.duplicate ? 200 : 201,result);}
      const templateReceiptMatch=path.match(/^\/api\/templates\/receipts\/([^/]+)$/);
      if(templateReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid template request');return send(res,200,templateReceipt(db,session,decodeURIComponent(templateReceiptMatch[1])));}
      const templateMatch=path.match(/^\/api\/templates\/([^/]+)(?:\/(edit|archive|restore|duplicate|use))?$/);
      if(templateMatch && !templateMatch[2] && req.method==='GET') return send(res,200,getTemplate(db,session,templateMatch[1],Object.fromEntries(url.searchParams)));
      if(templateMatch && templateMatch[2] && req.method==='POST') {if(url.search) throw new Error('Invalid template request');return send(res,200,changeTemplate(db,session,templateMatch[2],templateMatch[1],await readJson(req)));}
      if(path==='/api/settings/staff' && req.method==='GET') return send(res,200,listStaff(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/settings/invitations' && req.method==='GET') return send(res,200,listInvitations(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/settings/invitations' && req.method==='POST') {
        if(url.search) throw new Error('Invalid invitation input');const result=issueInvitation(db,session,await readJson(req),mail);
        return send(res,result.duplicate ? 200 : 202,result);
      }
      const invitationReceiptMatch=path.match(/^\/api\/settings\/invitations\/receipts\/([^/]+)$/);
      if(invitationReceiptMatch && req.method==='GET') {
        if(url.search) throw new Error('Invalid invitation input');return send(res,200,invitationReceipt(db,session,decodeURIComponent(invitationReceiptMatch[1])));
      }
      const invitationChangeMatch=path.match(/^\/api\/settings\/invitations\/([^/]+)\/(resend|cancel)$/);
      if(invitationChangeMatch && req.method==='POST') {
        if(url.search) throw new Error('Invalid invitation input');const result=changeInvitation(db,session,decodeURIComponent(invitationChangeMatch[1]),invitationChangeMatch[2],await readJson(req),mail);
        return send(res,invitationChangeMatch[2]==='resend' && !result.duplicate ? 202 : 200,result);
      }
      const staffReceiptMatch=path.match(/^\/api\/settings\/staff\/receipts\/([^/]+)$/);
      if(staffReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid staff request');return send(res,200,staffReceipt(db,session,decodeURIComponent(staffReceiptMatch[1])));}
      const staffChangeMatch=path.match(/^\/api\/settings\/staff\/([^/]+)\/(role|revoke|restore)$/);
      if(staffChangeMatch && req.method==='POST') {if(url.search) throw new Error('Invalid staff request');return send(res,200,changeStaff(db,session,decodeURIComponent(staffChangeMatch[1]),staffChangeMatch[2],await readJson(req)));}
      if(path==='/api/onboarding/first-run' && ['GET','POST'].includes(req.method)) {
        if(url.search)throw Error('Invalid onboarding input');
        const result=req.method==='GET'?getFirstRun(db,session):completeFirstRun(db,session,await readJson(req,4096));
        return send(res,200,result);
      }
      if(path==='/api/settings/onboarding' && ['GET','POST'].includes(req.method)) {
        if(url.search)throw Error('Invalid onboarding request');
        return send(res,200,req.method==='GET'?getOnboarding(db,session):saveOnboarding(db,session,await readJson(req,4096)));
      }
      const onboardingMatch=path.match(/^\/api\/settings\/onboarding\/receipts\/([a-f0-9-]{36})$/i);
      if(onboardingMatch && req.method==='GET'){if(url.search)throw Error('Invalid onboarding request');return send(res,200,onboardingReceipt(db,session,onboardingMatch[1]));}
      if(path==='/api/settings/sites' && ['GET','POST'].includes(req.method)) {
        if(req.method==='GET')return send(res,200,listSites(db,session,Object.fromEntries(url.searchParams)));
        if(url.search)throw Error('Invalid site creation');return send(res,200,createSite(db,session,await readJson(req)));
      }
      if(path==='/api/settings/sites/access' && req.method==='POST'){
        if(url.search)throw Error('Invalid site access request');return send(res,200,saveSiteAccess(db,session,await readJson(req)));
      }
      if(path==='/api/settings/sites/lifecycle' && req.method==='POST'){
        if(url.search)throw Error('Invalid site lifecycle request');return send(res,200,saveSiteLifecycle(db,session,await readJson(req,4096)));
      }
      const lifecycleReceipt=path.match(/^\/api\/settings\/sites\/lifecycle\/receipts\/([^/]+)$/);
      if(lifecycleReceipt && req.method==='GET'){
        if(url.search)throw Error('Invalid site lifecycle request');return send(res,200,siteLifecycleReceipt(db,session,decodeURIComponent(lifecycleReceipt[1])));
      }
      const lifecycleDetail=path.match(/^\/api\/settings\/sites\/([^/]+)\/lifecycle$/);
      if(lifecycleDetail && req.method==='GET'){
        if(url.search)throw Error('Invalid site lifecycle request');return send(res,200,inspectSiteLifecycle(db,session,decodeURIComponent(lifecycleDetail[1])));
      }
      const siteAccessMatch=path.match(/^\/api\/settings\/sites\/access\/receipts\/([^/]+)$/);
      if(siteAccessMatch && req.method==='GET'){
        if(url.search)throw Error('Invalid site access request');return send(res,200,siteAccessReceipt(db,session,siteAccessMatch[1]));
      }
      const siteReceiptMatch=path.match(/^\/api\/settings\/sites\/receipts\/([^/]+)$/);
      if(siteReceiptMatch && req.method==='GET'){if(url.search)throw Error('Invalid site creation');return send(res,200,siteCreationReceipt(db,session,siteReceiptMatch[1]));}
      if(path==='/api/settings/contacts' && req.method==='GET')return send(res,200,listSiteContacts(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/settings' && req.method==='GET') {if(url.search) throw new Error('Invalid settings request');return send(res,200,getSettings(db,session));}
      const settingsMatch=path.match(/^\/api\/settings\/(organization|site)$/);
      const settingsReceiptMatch=path.match(/^\/api\/settings\/(organization|site)\/receipts\/([^/]+)$/);
      if(settingsReceiptMatch && req.method==='GET'){if(url.search)throw Error('Invalid settings request');return send(res,200,settingsReceipt(db,session,settingsReceiptMatch[1],settingsReceiptMatch[2]));}
      if(settingsMatch && req.method==='POST') {if(url.search) throw new Error('Invalid settings request');return send(res,200,updateSettings(db,session,settingsMatch[1],await readJson(req)));}
      if(path==='/api/invoices' && req.method==='GET') return send(res,200,listInvoices(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/invoices' && req.method==='POST') {const result=createInvoice(db,session,await readJson(req));return send(res,result.duplicate ? 200 : 201,result);}
      const billingRequest=path.match(/^\/api\/invoices\/requests\/([^/]+)\/([^/]+)$/);
      if(billingRequest && req.method==='GET') {if(url.search) throw new Error('Invalid invoice filter');return send(res,200,billingReceipt(db,session,billingRequest[1],billingRequest[2]));}
      const invoiceMatch=path.match(/^\/api\/invoices\/([^/]+)(?:\/(payments|download|void))?$/);
      if(invoiceMatch && !invoiceMatch[2] && req.method==='GET') return send(res,200,getInvoice(db,session,invoiceMatch[1],Object.fromEntries(url.searchParams)));
      if(invoiceMatch && invoiceMatch[2]==='download' && req.method==='GET') return sendInvoiceDownload(res,getInvoice(db,session,invoiceMatch[1],Object.fromEntries(url.searchParams)));
      if(invoiceMatch && invoiceMatch[2]==='payments' && req.method==='POST') {const result=recordPayment(db,session,invoiceMatch[1],await readJson(req));return send(res,result.duplicate ? 200 : 201,result);}
      if(invoiceMatch && invoiceMatch[2]==='void' && req.method==='POST') {const result=voidInvoice(db,session,invoiceMatch[1],await readJson(req));return send(res,result.duplicate ? 200 : 201,result);}
      if(await handleProcessingProvenanceRoute(req,res,session,url,(actor,id,filters)=>getProcessingProvenance(db,actor,id,filters)))return;
      if(await handleProcessingRetryRoute(req,res,session,url,{context:(actor,id)=>getProcessingRetryContext(db,actor,id),receipt:(actor,id,requestId)=>getProcessingRetryReceipt(db,actor,id,requestId),retry:(actor,id,input)=>retryProcessing(db,actor,id,input)}))return;
      if (path === "/api/processing" && req.method === "GET") {
        return send(res,200,listProcessing(db,session,Object.fromEntries(url.searchParams)));
      }
      const processingMatch=path.match(/^\/api\/processing\/([^/]+)$/);
      if(processingMatch && req.method==='GET') return send(res,200,getProcessing(db,session,decodeURIComponent(processingMatch[1])));
      if(path==='/api/language-readiness' && req.method==='GET') {getSettings(db,session);if(url.search) throw new Error('Invalid language readiness request');return send(res,200,languageReadinessModel({mode:`synthetic-${config.accessMode}`,publication:latestPublicationSnapshot(db,session),generationDefaults:getSettings(db,session).site.generationLanguages}));}
      if(path==='/api/language-readiness/test' && req.method==='POST') {getSettings(db,session);if(!['owner','administrator','supervisor'].includes(session.role)) throw new Error('Forbidden');if(url.search) throw new Error('Invalid language readiness request');const input=await readJson(req);if(Object.keys(input).length) throw new Error('Invalid language readiness request');return send(res,200,languageReadinessModel({mode:`synthetic-${config.accessMode}`,publication:latestPublicationSnapshot(db,session),generationDefaults:getSettings(db,session).site.generationLanguages,testedAt:new Date().toISOString()}));}
      if(path==='/api/usage' && req.method==='GET') {getSettings(db,session);if(url.search) throw new Error('Invalid usage request');const publication=latestPublication(db,session);return send(res,200,usageModel({mode:`synthetic-${config.accessMode}`,metrics:publication ? metrics(db,session.org_id,publication.id) : null,latestPublication:publication,entitlement:usageEntitlement(entitlementState(db,session.org_id),countActiveWorkers(db,session.org_id))}));}
      if(path==='/api/entitlement/requests' && req.method==='POST') {
        if(url.search)throw Error('Invalid activation request');
        const result=saveActivationRequest(db,session,await readJson(req,4096));
        return send(res,result.duplicate?200:201,result);
      }
      const activationReceipt=path.match(/^\/api\/entitlement\/requests\/([^/]+)$/);
      if(activationReceipt && req.method==='GET') {
        if(url.search)throw Error('Invalid activation request');
        return send(res,200,activationRequestReceipt(db,session,decodeURIComponent(activationReceipt[1])));
      }
      if(path==='/api/privacy/recording-notice' && ['GET','POST'].includes(req.method)){
        const language=recordingNoticeLanguage(url.searchParams,session,req.method);
        return send(res,200,req.method==='GET'?getRecordingNotice(db,session,{language}):saveRecordingNotice(db,session,await readJson(req,100000)));
      }
      const noticeRequest=path.match(/^\/api\/privacy\/recording-notice\/requests\/([^/]+)$/);
      if(noticeRequest && req.method==='GET'){
        if(url.search)throw Error('Invalid recording notice request');
        return send(res,200,recordingNoticeReceipt(db,session,decodeURIComponent(noticeRequest[1])));
      }
      if(path==='/api/retention' && req.method==='GET') {if(url.search) throw new Error('Invalid retention request');return send(res,200,getRetention(db,session));}
      if(path==='/api/privacy/workers' && req.method==='GET')return send(res,200,listPrivacyWorkers(db,session,Object.fromEntries(url.searchParams)));
      if(path==='/api/retention' && req.method==='POST') {if(url.search) throw new Error('Invalid retention request');return send(res,200,saveRetention(db,session,await readJson(req)));}
      const retentionRequest=path.match(/^\/api\/retention\/requests\/([^/]+)$/);
      if(retentionRequest && req.method==='GET'){if(url.search)throw new Error('Invalid retention request');return send(res,200,retentionReceipt(db,session,decodeURIComponent(retentionRequest[1])));}
      if(path==='/api/clarification-creations/subjects'&&req.method==='GET'){
        if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid clarification subject filter');
        return send(res,200,{...listClarificationSubjects(db,session,Object.fromEntries(url.searchParams)),clientContext:clientSessionContext(session).clientContext});
      }
      const creationSubject=path.match(/^\/api\/clarification-creations\/subjects\/([^/]+)$/);
      if(creationSubject&&req.method==='GET'){if(url.search)throw Error('Invalid clarification subject');return send(res,200,{...getClarificationSubject(db,session,creationSubject[1]),clientContext:clientSessionContext(session).clientContext});}
      if(path==='/api/clarification-creations'&&req.method==='POST'){if(url.search)throw Error('Invalid clarification creation');return send(res,200,{...createStaffClarification(db,session,await readJson(req)),clientContext:clientSessionContext(session).clientContext});}
      const creationReceipt=path.match(/^\/api\/clarification-creations\/([^/]+)$/);
      if(creationReceipt&&req.method==='GET'){if(url.search)throw Error('Invalid clarification creation');return send(res,200,{...staffClarificationCreationReceipt(db,session,creationReceipt[1]),clientContext:clientSessionContext(session).clientContext});}
      if (path === "/api/clarifications" && req.method === "GET") {
        if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid clarification filter');
        return send(res,200,clarificationPageView(listClarifications(db,session,Object.fromEntries(url.searchParams)),clientSessionContext(session).clientContext));
      }
      if(await handleStaffCaseRecordingRoute(req,res,session,path,url.searchParams,{
        list:(s,id,input)=>listStaffCaseRecordings(db,s,id,input),receipt:(s,id,requestId)=>staffCaseRecordingReceipt(db,s,id,requestId),
        receive:(s,id,requestId,language,bytes)=>receiveStaffCaseRecording(db,s,id,requestId,language,bytes,audioStore(options.audioRoot??DEFAULT_AUDIO_ROOT)),
        audio:(s,id,requestId)=>getStaffCaseRecordingAudio(db,s,id,requestId,audioStore(options.audioRoot??DEFAULT_AUDIO_ROOT)),
      }))return;
      const timeline=path.match(/^\/api\/clarifications\/([^/]+)\/timeline$/);
      if(timeline&&req.method==='GET'){
        if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid case timeline page');
        return send(res,200,{...listCaseTimeline(db,session,timeline[1],Object.fromEntries(url.searchParams)),clientContext:clientSessionContext(session).clientContext});
      }
      const caseAction=path.match(/^\/api\/clarifications\/([^/]+)\/actions\/([^/]+)$/);
      if(caseAction&&req.method==='GET'){
        if(url.search)throw Error('Invalid clarification action');
        return send(res,200,{...clarificationActionReceipt(db,session,caseAction[1],caseAction[2]),clientContext:clientSessionContext(session).clientContext});
      }
      const followup=path.match(/^\/api\/clarifications\/([^/]+)\/followups(?:\/([^/]+))?$/);
      if(followup) {
        const [,id,receiptId]=followup;
        if(url.search)throw Error('Invalid conversation request');
        if(receiptId && req.method==='GET')return send(res,200,{...followupReceipt(db,session,id,receiptId),clientContext:clientSessionContext(session).clientContext});
        if(!receiptId && req.method==='POST')return send(res,202,{...queueCaseFollowup(db,session,id,await readJson(req),caseFollowupAdapter),clientContext:clientSessionContext(session).clientContext});
      }
      const followupAudio=path.match(/^\/api\/clarifications\/([^/]+)\/messages\/([^/]+)\/audio$/);
      if(followupAudio && req.method==='GET') {
        if(url.search)throw Error('Invalid conversation request');
        const bytes=getFollowupAudio(db,session,followupAudio[1],followupAudio[2]);
        res.writeHead(200,{'content-type':'audio/wav','content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});return res.end(bytes);
      }
      const conversation=path.match(/^\/api\/clarifications\/([^/]+)\/messages(?:\/([^/]+))?$/);
      if(conversation) {
        const [,id,receiptId]=conversation;
        if(receiptId && req.method==='GET'){if(url.search)throw Error('Invalid conversation request');return send(res,200,{...caseMessageReceiptLookup(db,session,id,receiptId),clientContext:clientSessionContext(session).clientContext});}
        if(!receiptId && req.method==='GET'){const page=listCaseMessages(db,session,id,Object.fromEntries(url.searchParams));return send(res,200,{...page,caseId:id,clientContext:clientSessionContext(session).clientContext,canGenerate:session.principal_type==='staff' && followupGenerationAvailable(caseFollowupAdapter,page.language),canVoice:false});}
        if(!receiptId && req.method==='POST'){if(url.search)throw Error('Invalid conversation request');return send(res,200,{...sendCaseMessage(db,session,id,await readJson(req)),clientContext:clientSessionContext(session).clientContext});}
      }
      const caseMatch = path.match(
        /^\/api\/clarifications\/([^/]+)(?:\/(resolve|assign))?$/,
      );
      if (caseMatch) {
        const [, id, action] = caseMatch;
        if(url.search)throw Error('Invalid clarification filter');
        if (!action && req.method==='GET') return send(res,200,clarificationDetailView(getClarification(db,session,id),clientSessionContext(session).clientContext));
        if (action==='resolve' && req.method==='POST') return send(res,200,{...resolveClarification(db,session,id,await readJson(req)),clientContext:clientSessionContext(session).clientContext});
        if (action==='assign' && req.method==='POST') return send(res,200,{...assignClarification(db,session,id,await readJson(req)),clientContext:clientSessionContext(session).clientContext});
      }
      if(path==='/api/reports/publications' && req.method==='GET')return send(res,200,listReportPublications(db,session,Object.fromEntries(url.searchParams)));
      if (path === "/api/reports" && req.method === "GET") {
        staffOnly(session);
        const {publicationId,...reportFilters}=Object.fromEntries(url.searchParams);
        const scope=reportScope(reportFilters);
        const publication = publicationId
          ? db.prepare('SELECT * FROM publications WHERE id=? AND org_id=? AND site_id=?').get(publicationId, session.org_id, session.site_id)
          : latestPublication(db, session);
        if (publicationId && !publication) return send(res, 404, { error: 'Publication unavailable' });
        const availablePublications = db.prepare('SELECT id,version,state,snapshot_json FROM publications WHERE org_id=? AND site_id=? ORDER BY published_at DESC,id LIMIT 100')
          .all(session.org_id, session.site_id).map((row) => ({ id: row.id, version: row.version, state: row.state, title: JSON.parse(row.snapshot_json).title }));
        const timezone = db.prepare('SELECT timezone FROM sites WHERE id=? AND org_id=?').get(session.site_id, session.org_id).timezone;
        return send(
          res,
          200,
          publication
            ? {
                title: JSON.parse(publication.snapshot_json).title,
                publicationId: publication.id,
                version: publication.version,
                ...reportActivity(db,session,publication,scope),
                availablePublications, timezone, asOf: NOW(),
                date: publication.published_at,
              }
            : { metrics: null, availablePublications, timezone },
        );
      }
      if (path === '/api/reports/exports') {
        if(url.search)throw Error('Invalid export request');
        if (req.method === 'GET') return send(res, 200, listExports(db, session));
        if (req.method === 'POST') return send(res, 202, requestExport(db, session, await readJson(req)));
      }
      const exportReceiptMatch=path.match(/^\/api\/reports\/exports\/receipts\/(create|retry)\/([^/]+)$/);
      if(exportReceiptMatch && req.method==='GET') {
        if(url.search)throw Error('Invalid export request');return send(res,200,exportReceipt(db,session,exportReceiptMatch[1],exportReceiptMatch[2]));
      }
      const exportMatch = path.match(/^\/api\/reports\/exports\/([^/]+)\/(download|retry)$/);
      if (exportMatch) {
        const [, id, action] = exportMatch;
        if (action === 'retry' && req.method === 'POST') {if(url.search)throw Error('Invalid export request');return send(res, 202, retryExport(db, session, id,await readJson(req)));}
        if (action === 'download' && req.method === 'GET') {
          const file = downloadExport(db, session, id);
          res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
            'content-disposition': `attachment; filename="${file.filename}"`, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
          res.end(file.csv); return;
        }
      }
      if (path === "/api/reports.csv" && req.method === "GET") {
        staffOnly(session);
        const publication = latestPublication(db, session);
        if (!publication)
          return send(res, 404, { error: "No published briefing" });
        const csv = briefingActivityCsv(db, session, publication);
        db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), session.org_id, session.site_id,
          'staff', session.principal_id, 'report.downloaded', publication.id, NOW());
        res.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="briefing-activity.csv"',
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        });
        res.end(csv);
        return;
      }
      if (path === "/api/worker/language" && req.method === "GET") {
        if (session.principal_type !== "worker") throw new Error("Forbidden");
        if(url.search)throw Error('Invalid language request');
        return send(res, 200, {...workerLanguageState(db,session),...workerLanguageHistory(db,session)});
      }
      if (path === "/api/worker/language/selection" && req.method === "POST") {
        if(url.search)throw Error('Invalid language selection');
        return send(res, 200, selectWorkerLanguage(db, session, await readJson(req)));
      }
      if (path === "/api/worker/language/requests" && req.method === "POST") {
        if(url.search)throw Error('Invalid language request');
        return send(res, 200, requestWorkerLanguage(db, session, await readJson(req)));
      }
      if (path === "/api/worker/briefings" && req.method === "GET") {
        if (session.principal_type !== "worker") throw new Error("Forbidden");
        return send(res, 200, workerBriefings(db, session,Object.fromEntries(url.searchParams)));
      }
      if (path === '/api/worker/history' && req.method === 'GET') {
        if (session.principal_type !== 'worker') throw new Error('Forbidden');
        return send(res, 200, workerBriefings(db, session,Object.fromEntries(url.searchParams),true));
      }
      const workerReceiptMatch=path.match(/^\/api\/worker\/briefings\/([^/]+)\/receipts\/([^/]+)\/([^/]+)$/);
      if(workerReceiptMatch && req.method==='GET'){
        if(url.search)throw Error('Invalid response filter');
        const [,assignmentId,kind,requestId]=workerReceiptMatch;
        return send(res,200,{...workerRequestReceipt(db,session,assignmentId,kind,requestId),assignmentId,requestId,clientContext:clientSessionContext(session).clientContext});
      }
      const helpHistory=path.match(/^\/api\/worker\/briefings\/([^/]+)\/help-history$/);
      if(helpHistory&&req.method==='GET')return send(res,200,{...workerHelpHistory(db,session,helpHistory[1],Object.fromEntries(url.searchParams)),clientContext:clientSessionContext(session).clientContext});
      const exactSubmission=path.match(/^\/api\/worker\/briefings\/([^/]+)\/submissions\/([^/]+)$/);
      if(exactSubmission&&req.method==='GET')return send(res,200,{...workerSubmission(db,session,exactSubmission[1],exactSubmission[2],Object.fromEntries(url.searchParams)),clientContext:clientSessionContext(session).clientContext});
      const workerMatch = path.match(
        /^\/api\/worker\/briefings\/([^/]+)(?:\/(answers|help|submissions|acknowledge|presentations))?$/,
      );
      if (workerMatch) {
        if (session.principal_type !== "worker") throw new Error("Forbidden");
        const [, id, action] = workerMatch;
        if(action==='submissions' && req.method==='GET') return send(res,200,{...workerSubmissions(db,session,id,Object.fromEntries(url.searchParams)),clientContext:clientSessionContext(session).clientContext});
        if(action==='presentations' && req.method==='GET'){
          if(url.search)throw Error('Invalid presentation request');
          return send(res,200,{...listPresentations(db,session,id),clientContext:clientSessionContext(session).clientContext});
        }
        if(action==='presentations' && req.method==='POST'){
          if(url.search)throw Error('Invalid presentation request');
          const body=await readJson(req);
          return send(res,200,{...await createPresentation(db,session,id,body,
            {translator:presentationTranslator,generationAllowed:presentationGenerationAllowed}),clientContext:clientSessionContext(session).clientContext});
        }
        if(action==='acknowledge' && req.method==='POST') {
          const body=await readJson(req),result=acknowledgeAssignment(db,session,id,body.requestId);
          return send(res,result.duplicate?200:201,{...result,assignmentId:id,requestId:body.requestId,clientContext:clientSessionContext(session).clientContext});
        }
        const row = db
          .prepare(
            `SELECT a.id,a.publication_id,a.due_at,a.language,p.version,p.state,p.snapshot_json,${responseColumns}
          FROM assignments a JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id
          WHERE a.id=? AND a.org_id=? AND a.site_id=? AND a.worker_id=?`,
          )
          .get(id, session.org_id, session.site_id, session.principal_id);
        if (!row) return send(res, 404, { error: "Not found" });
        if (!action && req.method === "GET") {
          const snapshot = JSON.parse(row.snapshot_json);
          const language = row.language;
          const delivered=instructionDeliveryContentForAssignment(db,session.org_id,session.site_id,session.principal_id,id);
          const content=delivered?.language===language ? delivered.content : snapshot.languages[language];
          if (!content) throw new Error('Assignment language unavailable');
          const currentAudio = isCurrentRecording(row);
          const responseMode=snapshot.responseMode || 'question',deliveryMode=snapshot.deliveryMode || 'both';
          const acknowledgedAt=row.acknowledged_at || null;
          return send(res, 200, {
            id,
            publicationId: row.publication_id,
            version: row.version,
            state: row.state,
            dueAt: row.due_at,
            language,
            responseMode,
            deliveryMode,
            content: {
              title: content.title,
              text: content.text,
              ...(responseMode==='question' ? {question: content.question,...(content.questionType==='multiple-choice'?{questionType:content.questionType,choices:content.choices}:{})} : {}),
              speech: deliveryMode!=='text' && content.speech === 'device-synthesis-demo' ? 'device-synthesis-demo' : null,
            },
            outcome: responseMode==='acknowledge' ? null : currentAudio ? null : row.outcome,
            acknowledgedAt,
            assessmentStatus: responseMode==='acknowledge' ? acknowledgedAt ? 'complete' : null
              : currentAudio ? 'pending' : row.outcome ? 'complete' : null,
            audioStatus: currentAudio ? row.audio_status : null,
            recordingId: currentAudio ? row.recording_id : null,
            speechAvailable: deliveryMode!=='text' && content.speech === 'device-synthesis-demo' ? 'speechSynthesis' : null,
          });
        }
        if (action === "answers" && req.method === "POST") {
          const body = await readJson(req);
          return send(
            res,
            201,
            {...submitAnswer(db, session, id, body.submissionId, body.text, body.presentationId ?? null),assignmentId:id,requestId:body.submissionId,clientContext:clientSessionContext(session).clientContext},
          );
        }
        if (action === "help" && req.method === "POST") {
          const body=await readJson(req),result=requestHelp(db,session,id,body);
          return send(res,result.duplicate ? 200 : 201,{...result,assignmentId:id,requestId:body.requestId,clientContext:clientSessionContext(session).clientContext});
        }
        if (action==='help' && req.method==='GET') return send(res,200,workerHelpCases(db,session,id));
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      if(path.startsWith('/api/clarification-creations')||/^\/api\/clarifications(?:\/[^/]+(?:\/(?:timeline|resolve|assign|actions\/[^/]+))?)?$/.test(path)){const result=clarificationHttpError(error);return send(res,result.status,{error:result.error});}
      if(/\/help-history$/.test(path)&&error?.message==='Assignment unavailable')return send(res,404,{error:error.message});
      if(error?.message==='Invalid help history request')return send(res,400,{error:error.message});
      if(/\/draft-creation-receipts\//.test(path)) {const {status,error:message}=draftCreationHttpError(error);return send(res,status,{error:message});}
      if(/\/publication-receipts\//.test(path)) {const {status,error:message}=publicationReceiptHttpError(error);return send(res,status,{error:message});}
      if(/\/schedules(?:\/|$)/.test(path)) {const {status,error:message}=scheduleHttpError(error);return send(res,status,{error:message});}
      const message = String(error.message || error);
      if(path==='/api/entitlement/requests' || /^\/api\/entitlement\/requests\/[^/]+$/.test(path)) {
        if(message==='Sign in required')return send(res,401,{error:message});
        if(['Forbidden','Forbidden origin'].includes(message))return send(res,403,{error:message});
        if(['Invalid activation request','Invalid JSON'].includes(message))return send(res,400,{error:message});
        if(message==='Request too large')return send(res,413,{error:message});
        if(['Activation request conflict','Activation request already pending','Session context changed'].includes(message))return send(res,409,{error:message});
        return send(res,503,{error:'Activation request unavailable. Check the receipt before retrying.'});
      }
      if(['Presentation unavailable','Presentation language changed','Presentation request conflict','Presentation source conflict',
        'Invalid presentation request','Invalid presentation content'].includes(message)) {
        const status=message==='Presentation unavailable'?404
          :['Presentation language changed','Presentation request conflict','Presentation source conflict'].includes(message)?409:400;
        return send(res,status,{error:message});
      }
      if(/\/worker\/briefings\/[^/]+\/acknowledge$/.test(path)) {
        const status=message==='Sign in required'?401:['Forbidden','Worker access paused','Site archived','Workspace is read-only'].includes(message)?403
          :message==='Assignment unavailable'?404
          :['This instruction requires an answer','Assignment deadline passed'].includes(message)?409
          :message==='Invalid acknowledgment request'?400
          :message==='Request too large'?413:503;
        return send(res,status,{error:status===503?'Acknowledgment unavailable. Check the receipt before retrying.':message});
      }
      if(/\/clarifications\/[^/]+\/(?:messages|followups)(?:\/|$)/.test(path)) {
        const followupUnavailable=['Follow-up translation unavailable','Follow-up generation unavailable','Follow-up language unavailable'].includes(message);
        const status=['Sign in required'].includes(message)?401:['Forbidden','Forbidden origin','Worker access paused','Site archived','Workspace is read-only'].includes(message)?403
          :['Clarification unavailable','Conversation receipt unavailable','Follow-up receipt unavailable','Follow-up audio unavailable'].includes(message)?404
          :['Conversation request conflict','Conversation is closed','Session context changed'].includes(message)?409
          :followupUnavailable?503
          :['Invalid conversation request','Invalid conversation filter','Invalid JSON'].includes(message)?400:message==='Request too large'?413:503;
        return send(res,status,{error:status===503 && !followupUnavailable?'Conversation unavailable. Check the receipt before retrying.':message});
      }
      if(['Worker access paused','Site archived','Workspace is read-only'].includes(message))return send(res,403,{error:message});
      if(path==='/api/onboarding/first-run') {
        if(['Forbidden','Forbidden origin','Sign in required'].includes(message))
          return send(res,message==='Sign in required'?401:403,{error:message});
        if(message==='Invalid onboarding input') return send(res,400,{error:message});
        if(message==='Onboarding already completed') return send(res,409,{error:message});
        if(message==='Onboarding unavailable') return send(res,404,{error:message});
        return send(res,503,{error:'Onboarding unavailable. Refresh before retrying.'});
      }
      if(path.startsWith('/api/auth/registrations')) {
        if(message==='Email delivery unavailable') return send(res,503,{error:message});
        if(message==='Sign in required') return send(res,401,{error:message});
        if(['Forbidden','Forbidden origin'].includes(message)) return send(res,403,{error:message});
        if(['Invalid registration input','Registration verification unavailable'].includes(message)) return send(res,400,{error:message});
        return send(res,503,{error:'Registration unavailable. Check the service before retrying.'});
      }
      if(path.startsWith('/api/auth/invitations/') || path.startsWith('/api/settings/invitations')) {
        if(message==='Email delivery unavailable') return send(res,503,{error:message});
        if(['Sign in required','Sign in to accept this invitation','Sign out before creating an account'].includes(message)) return send(res,401,{error:message});
        if(['Forbidden','Forbidden origin'].includes(message)) return send(res,403,{error:message});
        if(['Invalid invitation input','Invitation unavailable','Invalid input'].includes(message)) return send(res,400,{error:message});
        if(['Invitation request conflict','Invitation revision changed','Invitation is closed','Recipient already has a site membership','An invitation is already pending at this site'].includes(message)) return send(res,409,{error:message});
        return send(res,503,{error:'Invitation operation unavailable. Check the service before retrying.'});
      }
      if(path==='/api/account/sites' || path==='/api/account/site') {
        if(message==='Account membership unavailable') return send(res,404,{error:message});
        if(!['Sign in required','Forbidden','Forbidden origin','Invalid input','Invalid account site request'].includes(message))
          return send(res,503,{error:'Operation unavailable. Retry after checking the service.'});
      }
      if(message==='Email delivery unavailable') return send(res,503,{error:message});
      if(path.startsWith('/api/privacy/recording-notice')){
        if(['Forbidden','Forbidden origin'].includes(message))return send(res,403,{error:message});
        if(message==='Sign in required')return send(res,401,{error:message});
        if(['Invalid input','Invalid JSON','Invalid recording notice request','Invalid recording notice text','Recording notice requires every supported language'].includes(message))return send(res,400,{error:message});
        if(['Recording notice request conflict','Recording notice revision changed'].includes(message))return send(res,409,{error:message});
        if(message==='Request too large')return send(res,413,{error:message});
        return send(res,503,{error:'Recording notice unavailable. Check the request status before retrying.'});
      }
      if(path==='/api/privacy/workers'){
        if(['Forbidden','Forbidden origin'].includes(message))return send(res,403,{error:message});
        if(message==='Sign in required')return send(res,401,{error:message});
        if(['Invalid input','Invalid page','Invalid search','Invalid deletion filters'].includes(message))return send(res,400,{error:message});
        return send(res,503,{error:'Worker data requests unavailable. Refresh after checking the service.'});
      }
      if(/^\/api\/people\/workers\/[^/]+\/deletion$/.test(path)){
        if(['Forbidden','Forbidden origin'].includes(message))return send(res,403,{error:message});
        if(message==='Sign in required')return send(res,401,{error:message});
        if(message==='Invalid deletion request')return send(res,400,{error:message});
        if(message==='Worker unavailable')return send(res,404,{error:message});
        if(['Deletion request conflict','Worker code changed','Worker deletion pending'].includes(message))return send(res,409,{error:message});
        if(message!=='Request too large')return send(res,503,{error:'Deletion operation unavailable. Check the request status before retrying.'});
      }
      if(path==='/api/auth/worker/redemption') {
        if(['Sign in required','Forbidden','Forbidden origin','Session context changed'].includes(message))return send(res,message==='Sign in required'?401:message==='Session context changed'?409:403,{error:message});
        if(message==='Invalid worker redemption check')return send(res,400,{error:message});
        return send(res,503,{error:'Worker access check unavailable.'});
      }
      if(path.startsWith('/api/push')) {
        if(message==='Sign in required')return send(res,401,{error:message});
        if(['Forbidden','Forbidden origin'].includes(message))return send(res,403,{error:message});
        if(message==='Push subscription unavailable')return send(res,404,{error:message});
        if(message==='Too many push subscriptions')return send(res,409,{error:message});
        if(['Invalid push request','Invalid push subscription','Push service unavailable','Invalid JSON','Invalid input'].includes(message))return send(res,400,{error:message});
        return send(res,message==='Request too large'?413:503,{error:'Push notifications unavailable. Refresh to check before retrying.'});
      }
      if(path.startsWith('/api/notifications')) {
        if(['Sign in required','Forbidden','Forbidden origin'].includes(message))return send(res,message==='Sign in required'?401:403,{error:message});
        if(message==='Notification unavailable')return send(res,404,{error:message});
        if(['Invalid notification filter','Invalid notification request','Invalid JSON','Invalid input'].includes(message))return send(res,400,{error:message});
        return send(res,message==='Request too large'?413:503,{error:'Notifications unavailable. Refresh to check before retrying.'});
      }
      if(path==='/api/reports/publications') {
        if(['Sign in required','Forbidden','Forbidden origin'].includes(message))return send(res,message==='Sign in required'?401:403,{error:message});
        if(['Invalid report publication filter','Invalid report publication date','Report publication history exceeds limit; narrow the search or dates'].includes(message))return send(res,400,{error:message});
        return send(res,503,{error:'Publication history unavailable. Refresh after checking the service.'});
      }
      if(path.startsWith('/api/settings/sites')) {const result=siteHttpError(error);return send(res,result.status,{error:result.error});}
      if(message==='Request too large') return send(res,413,{error:message});
      if(['Retention request conflict','Retention revision changed','Draft version changed'].includes(message))return send(res,409,{error:message});
      const status = /Sign in required|Invalid credentials|Invalid or expired setup code/.test(message)
        ? 401
        : /Forbidden/.test(message)
          ? 403
            : /Staff member unavailable|Glossary term unavailable|Template unavailable|Invoice unavailable|Processing job unavailable|Grant unavailable|Worker unavailable|Crew unavailable|Instruction unavailable|Recording unavailable|Publication unavailable|Briefing unavailable|Export unavailable|Import unavailable|Event unavailable|Clarification unavailable|Clarification owner unavailable|Response unavailable|Language request unavailable|Company not found/.test(
                message,
              )
            ? 404
            : /Worker deletion pending|Staff request conflict|Staff revision changed|Staff access is revoked|Staff access unchanged|Last active site owner must be retained|Glossary request conflict|Glossary revision changed|Glossary term is removed|Glossary term is active|Glossary term already exists|Glossary dependency changed|Template request conflict|Template revision changed|Template is archived|Template is active|Draft review request conflict|Settings request conflict|Settings revision changed|Settings unchanged|Invoice void request conflict|Invoice details changed|Invoice is voided|Only unpaid invoices can be voided|Invoice request conflict|Payment request conflict|Invoice number already exists|Payment exceeds outstanding balance|Briefing archive request conflict|Briefing is archived|Worker code changed|Worker ID already in use|Worker capacity reached|Reactivation request conflict|Crew name changed|Crew is archived|Instruction request conflict|Instruction retry conflict|Instruction retry limit reached|Instruction deadline passed|Instruction audience exceeds limit|Instruction crew audience exceeds limit|Choose a language for every selected worker in Team before sending.|Select your language first|Language already selected|Language change already pending|Language request already decided|Language request conflict|Language request changed|Worker language changed|Language selection conflict|unavailable|not technically ready|cannot be processed|Export expired|Export is not ready|Import expired|Fix CSV errors|cannot be retried|ID conflict|Help request conflict|Resolution conflict|Draft request conflict|Draft copy request conflict|Draft revision changed|Publication request conflict|Withdrawal request conflict|Publication is no longer current|Assignment deadline passed/.test(
                  message,
                )
              ? 409
              : /UNIQUE constraint/.test(message)
                ? 409
                : 400;
      return send(res, status, { error: message });
    }
  };
  return handler;
}

export function createAppServer(db, options = {}) {
  return createHttpServer(createAppHandler(db, options));
}

if (process.argv[1]?.endsWith("index.mjs")) {
  createAppServer().listen(3021, "127.0.0.1", () => {
    console.log("Understood synthetic API on http://127.0.0.1:3021");
    process.send?.({ type: 'ready' });
  });
}
