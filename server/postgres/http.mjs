import {notificationLiveQuery} from '../neon-realtime.mjs';
import {neonFunctionStatus} from '../neon-services.mjs';
import {handleWorkspaceRoute} from '../workspace-http.mjs';
import {postgresWorkspace} from './workspace.mjs';
import {assertProductionAdmission} from './production-admission.mjs';
import { createServer } from 'node:http';
import {sendPrivateWav} from '../audio-response.mjs';
import {withPostgresClient} from './db.mjs';
import {handleOperationsRoute} from './operations-http.mjs';
import {siteCrewOverview} from './site-crews.mjs';
import {crewOverviewHttpError} from '../crew-overview.mjs';
import {pipelineStatus} from '../ai/pipeline-status.mjs';
import { send,readJson } from '../http.mjs';
import {savePilot,readPilot} from './pilot.mjs';
import {pilotDestination} from '../pilot-input.mjs';
import {handlePilotRoute} from '../pilot-http.mjs';
import {getOnboarding,saveOnboarding,onboardingReceipt} from './onboarding.mjs';
import {clientSessionContext,verifyClientSession} from '../session-context.mjs';
import {readWorkerRedemption} from './worker-redemption.mjs';
import {redemptionHttpInput} from '../worker-redemption.mjs';
import {listSites,createSite,siteCreationReceipt,saveSiteAccess,siteAccessReceipt,inspectSiteLifecycle,saveSiteLifecycle,siteLifecycleReceipt} from './sites.mjs';
import {requireSiteOperational} from './site-lifecycle.mjs';
import {archivedWriteAllowed} from '../site-lifecycle-input.mjs';
import {siteHttpError} from '../site-input.mjs';
import {handleSourceAudioRoute} from '../source-audio-http.mjs';
import {receiveSourceAudio,getSourceAudioReceipt,getSourceAudio,listSourceAudio} from './source-audio.mjs';
import {retrySourceAudio,getSourceRetryReceipt} from './source-audio-retry.mjs';
import { resolveAuthConfig,requireLocalRequest,verifyMutationOrigin,sessionCookie,clearSessionCookie } from '../auth.mjs';
import { authenticateStaff,redeemWorkerGrant,requireSession,revokeSession,issueWorkerGrant,revokeWorkerGrant,listWorkerGrants } from './auth.mjs';
import {workerCompanyContext,workerCredentialStatus,authenticateWorker,assignWorkerPassword} from './worker-credentials.mjs';
import { grantIssueInput } from '../auth.mjs';
import {requestRecovery,resetPassword} from './account-recovery.mjs';
import {requestRegistration,resendRegistration,verifyRegistration,verifyRegistrationCode} from './registration.mjs';
import {listAccountSites,switchAccountSite} from './accounts.mjs';
import {issueInvitation,changeInvitation,listInvitations,invitationReceipt,previewInvitation,acceptInvitation} from './invitations.mjs';
import { sessionContext,listBriefings,getBriefing,workerBriefings,workerBriefing,staffOverview,listProcessing,getProcessing } from './read-models.mjs';
import {getProcessingRetryContext,getProcessingRetryReceipt,retryProcessing} from './processing-retry.mjs';
import {handleProcessingRetryRoute} from '../processing-retry-http.mjs';
import {handleProcessingProvenanceRoute} from '../processing-provenance-http.mjs';
import {getProcessingProvenance} from './processing-provenance.mjs';
import {listPublicationHistory,getPublicationHistoryDetail} from './publication-history.mjs';
import {publicationHistoryQuery} from '../publication-history-input.mjs';
import {searchSite} from './search.mjs';
import {searchQuery} from '../search-input.mjs';
import { createDraft,editDraft,queuePreparation,copyDraft,archiveBriefing,getPreparationRequestContext,getPreparationRequestReceipt,requestPreparation,processOnePreparation } from './preparation.mjs';
import { instructionAudienceOverview,startInstructionSend,instructionSendStatus,completeInstructionSend,reconcileInstructionSend,retryInstructionSend } from './instructions.mjs';
import { acknowledgeAssignment } from './acknowledgments.mjs';
import { publish,submitAnswer,withdrawPublication,domainTransaction } from './domain.mjs';
import {createSchedule,listSchedules,cancelSchedule} from './schedules.mjs';
import {scheduleHttpError} from '../schedule-input.mjs';
import {publicationReceipt} from './publication-receipts.mjs';
import {draftCreationReceipt} from './draft-creations.mjs';
import {draftCreationHttpError} from '../draft-creations.mjs';
import {publicationReceiptHttpError} from '../publication-receipts.mjs';
import { listPublicationResponses,getPublicationResponse,workerSubmissions,workerSubmission,staffWorkerAssignments,workerRequestReceipt } from './responses.mjs';
import { receiveRecording,getRecording,getRecordingAudio } from './recordings.mjs';
import { createPresentation,listPresentations } from './presentations.mjs';
import { readPublicationReport,listReportPublications } from './reports.mjs';
import { listWorkers,createWorker,updateWorker,disableWorker,reenableWorker,listCrews,getCrew,listCrewRecipients,createCrew,moveWorkerToCrew,renameCrew,archiveCrew,restoreCrew,
  workerLanguageState,workerLanguageHistory,selectWorkerLanguage,requestWorkerLanguage,staffWorkerLanguageHistory,listLanguageRequests,decideWorkerLanguageRequest } from './people.mjs';
import {listNotifications,readNotification,notificationReceipt} from './notifications.mjs';
import {listWorkerNotifications,readWorkerNotification,workerNotificationReceipt,savePushSubscription,revokePushSubscription,pushSubscriptionStatus} from './notification-events.mjs';
import {resolvePushAdapter} from '../push-adapter.mjs';
import { requestHelp,listClarifications,getClarification,resolveClarification,assignClarification,clarificationActionReceipt,workerHelpCases,workerHelpHistory } from './clarifications.mjs';
import {listClarificationSubjects,getClarificationSubject,createStaffClarification,staffClarificationCreationReceipt} from './clarification-create.mjs';
import {clarificationPageView,clarificationDetailView,clarificationHttpError} from '../clarification-view.mjs';
import {listCaseTimeline} from './case-timeline.mjs';
import {listStaffCaseRecordings,staffCaseRecordingReceipt,receiveStaffCaseRecording,getStaffCaseRecordingAudio} from './staff-case-recordings.mjs';
import {handleStaffCaseRecordingRoute} from '../staff-case-recording-http.mjs';
import {listCaseMessages,sendCaseMessage,caseMessageReceiptLookup,scopedCase} from './case-messages.mjs';
import {receiveCaseVoice,caseVoiceReceipt,getCaseVoiceAudio} from './case-voice.mjs';
import {queueCaseFollowup,followupReceipt,getCaseFollowupAudio} from './case-followups.mjs';
import {requestCaseRepeat,caseRepeatReceipt,listCaseRepeats} from './case-repeats.mjs';
import {saveCaseReview,caseReviewReceipt,listCaseReviews} from './case-reviews.mjs';
import {caseRepeatPage,caseReviewPage} from './case-workflow-pages.mjs';
import { readImportBytes } from '../worker-import.mjs';
import { previewWorkerImport,getWorkerImport,confirmWorkerImport,workerImportErrorsCsv } from './worker-import.mjs';
import { requestExport,listExports,retryExport,downloadExport,exportReceipt } from './exports.mjs';
import {sendInvoiceDownload} from '../invoice-download.mjs';
import {listInvoices,getInvoice,createInvoice,recordPayment,voidInvoice,billingReceipt} from './billing.mjs';
import {getSettings,updateSettings,settingsReceipt,listSiteContacts} from './settings.mjs';
import {getFirstRun,completeFirstRun} from './first-run.mjs';
import {saveDraftLanguages,draftLanguagesReceipt} from './draft-languages.mjs';
import {listStaff,changeStaff,staffReceipt} from './staff.mjs';
import {saveDraftReview,draftReviewReceipt,verifyDraftReviewReceipt} from './draft-review.mjs';
import {regenerateDraftTarget,regenerationReceipt} from './regeneration.mjs';
import {listTemplates,getTemplate,changeTemplate,templateReceipt} from './templates.mjs';
import {listGlossary,getGlossaryTerm,changeGlossary,glossaryReceipt} from './glossary.mjs';
import {getAssignmentSpeech,getStaffArtifactSpeech} from './generated-audio.mjs';
import {getLanguageReadiness,runLanguageReadiness} from './language-readiness.mjs';
import {getUsage} from './usage.mjs';
import {saveUsageRequest,usageRequestReceipt,listUsageRequests} from './usage-requests.mjs';
import {saveActivationRequest,activationRequestReceipt} from './activation.mjs';
import {getRetention,saveRetention,retentionReceipt} from './retention.mjs';
import {getTextRetention,saveTextRetention,textRetentionReceipt} from './text-retention.mjs';
import {getActivityRetention,saveActivityRetention,activityRetentionReceipt} from './activity-retention.mjs';
import {getBriefingRetention,saveBriefingRetention,briefingRetentionReceipt} from './briefing-retention.mjs';
import {getCaseRetention,saveCaseRetention,caseRetentionReceipt} from './case-retention.mjs';
import {getGeneratedRetention,saveGeneratedRetention,generatedRetentionReceipt} from './generated-retention.mjs';
import {getWorkerDeletion,requestWorkerDeletion,listPrivacyWorkers} from './deletions.mjs';
import {getRecordingNotice,saveRecordingNotice,recordingNoticeReceipt} from './recording-notices.mjs';
import {recordingNoticeLanguage} from '../recording-notice-input.mjs';

const unavailable = new Set(['Briefing unavailable','Assignment unavailable','Worker unavailable','Grant unavailable','Recording unavailable','Publication unavailable','Crew unavailable','Event unavailable','Clarification unavailable','Clarification owner unavailable','Import unavailable','Export unavailable','Response unavailable']);
unavailable.add('Notification unavailable');
unavailable.add('Push subscription unavailable');
unavailable.add('Processing job unavailable');
unavailable.add('Conversation receipt unavailable');
unavailable.add('Follow-up receipt unavailable');
unavailable.add('Follow-up audio unavailable');
unavailable.add('Invoice unavailable');
unavailable.add('Settings unavailable');
unavailable.add('Template unavailable');
unavailable.add('Glossary term unavailable');
unavailable.add('Staff member unavailable');
unavailable.add('Account membership unavailable');
unavailable.add('Generated bundle unavailable');
unavailable.add('Generated audio unavailable');
unavailable.add('Artifact audio unavailable');
unavailable.add('Language request unavailable');
unavailable.add('Presentation unavailable');
unavailable.add('Instruction unavailable');
unavailable.add('Company not found');
const invoiceConflicts=['Invoice void request conflict','Invoice details changed','Invoice is voided','Only unpaid invoices can be voided'];
const conflicts = new Set(['Invoice request conflict','Payment request conflict','Invoice number or request already exists','Payment exceeds outstanding balance','Briefing is archived','Briefing archive request conflict','Draft revision changed','Draft request conflict','Draft copy request conflict','Publication request conflict','Submission ID conflict',
  'Withdrawal request conflict','Publication is no longer current','Crew name changed','Crew is archived','Worker code changed','Worker ID already in use','Reactivation request conflict',
  'Draft cannot be processed now','Recording storage still in progress','Recording unavailable; use a new recording','Assignment deadline passed','Directory entry already exists','Help request conflict','Resolution conflict',
  'Import request ID conflict','Import expired','Fix CSV errors before importing','Export request ID conflict','Export cannot be retried','Export expired','Export is not ready']);
for(const message of invoiceConflicts) conflicts.add(message);
conflicts.add('Session context changed');
conflicts.add('Usage change request conflict');
for(const message of ['Activation request conflict','Activation request already pending'])conflicts.add(message);
for(const message of ['Select your language first','Language already selected','Language change already pending','Language request already decided','Language request conflict','Language request changed','Worker language changed','Language selection conflict']) conflicts.add(message);
for(const message of ['Historical crew snapshot unavailable','Report crew unavailable'])conflicts.add(message);
for(const message of ['Conversation request conflict','Conversation is closed'])conflicts.add(message);
for(const message of ['Repeat request conflict','Repeat already requested','Repeat requires an earlier answer'])conflicts.add(message);
for(const message of ['Case review request conflict','Case deadline changed','Case deadline unchanged'])conflicts.add(message);
for(const message of ['Case review unavailable','Case review receipt unavailable','Original assessment unavailable'])unavailable.add(message);
for(const message of ['Voice receipt unavailable','Voice audio unavailable'])unavailable.add(message);
for(const message of ['Voice request conflict','Voice storage in progress','Voice recording was not received'])conflicts.add(message);
for(const message of ['Repeat request unavailable','Repeat receipt unavailable'])unavailable.add(message);
for(const message of ['Settings request conflict','Settings revision changed','Settings unchanged']) conflicts.add(message);
for(const message of ['Retention request conflict','Retention revision changed'])conflicts.add(message);
for(const message of ['Text retention request conflict','Text retention revision changed'])conflicts.add(message);
for(const message of ['Activity retention request conflict','Activity retention revision changed'])conflicts.add(message);
for(const message of ['Case retention request conflict','Case retention revision changed'])conflicts.add(message);
for(const message of ['Generated retention request conflict','Generated retention revision changed'])conflicts.add(message);
for(const message of ['Recording notice request conflict','Recording notice revision changed'])conflicts.add(message);
for(const message of ['Deletion request conflict','Worker deletion pending','Worker code unavailable','CSV contains unavailable worker IDs'])conflicts.add(message);
for(const message of ['Invitation request conflict','Invitation revision changed','Invitation is closed','Recipient already has a site membership','An invitation is already pending at this site']) conflicts.add(message);
conflicts.add('Draft review request conflict');
for(const message of ['Draft languages request conflict','Draft languages unchanged'])conflicts.add(message);
for(const message of ['Onboarding request conflict','Onboarding revision changed'])conflicts.add(message);
for(const message of ['Instruction request conflict','Instruction audience exceeds limit','Instruction crew audience exceeds limit','Choose a language for every selected worker in Team before sending.','This instruction requires an answer',
  'Instruction retry conflict','Instruction retry limit reached','Instruction retry unavailable','Instruction deadline passed',
  'Briefing content expired'])conflicts.add(message);
for(const message of ['Presentation language changed','Presentation request conflict','Presentation source conflict'])conflicts.add(message);
conflicts.add('Regeneration request conflict');
conflicts.add('Too many push subscriptions');
conflicts.add('Draft regeneration unavailable');
conflicts.add('Draft version changed');
for(const message of ['Staff request conflict','Staff revision changed','Staff access is revoked','Staff access unchanged','Last active site owner must be retained']) conflicts.add(message);
for(const message of ['Template request conflict','Template revision changed','Template is archived','Template is active']) conflicts.add(message);
for(const message of ['Glossary request conflict','Glossary revision changed','Glossary term is removed','Glossary term is active','Glossary term already exists','Glossary dependency changed','Live glossary generation unavailable']) conflicts.add(message);
const badInput = new Set(['Select one of the published choices','Invalid USD amount','Invalid invoice request','Invalid payment request','Invalid invoice filter','Payment date must not be in the future','Invalid JSON','Request too large','Title or source is invalid','Invalid draft request','Invalid draft revision',
  'Invalid search request','Invalid worker','Invalid crew request',
  'Invalid repeat request','Invalid repeat deadline',
  'Invalid case review','Invalid case deadline',
  'Invalid notification filter','Invalid notification request',
  'Invalid invitation input','Invitation unavailable',
  'Invalid processing filter','Invalid briefing filter','Invalid draft copy request','Invalid briefing archive request','Invalid draft review request',
  'Invalid invoice void request','Invalid regeneration request',
  'Invalid template request','Invalid template filter',
  'Invalid glossary request','Invalid glossary filter',
  'Invalid settings request','Invalid support email','Invalid site timezone','Invalid site contact',
  'Invalid staff request','Invalid staff filter','Invalid recovery input','Invalid recovery link or input','Invalid credential input','Invalid account site request','Invalid credential request',
  'Invalid worker ID','Invalid password','Invalid setup credential','Invalid setup expiry','Confirmation required',
  'Invalid response filter','Response audience exceeds limit',
  'Invalid report scope',
  'Invalid withdrawal request','Invalid reactivation request',
  'Invalid publication request','Invalid publication version','Invalid briefing ID','Invalid publication ID','Invalid deadline','Deadline must be in the future',
  'Recipient unavailable','Recipient language is unavailable','Recipient language not selected','Briefing is not technically ready','Invalid answer submission','Invalid submission ID','Invalid grant expiry','Invalid grant reference','Expected WAV audio','Recording is too large',
  'Unsupported or corrupt recording','Invalid recording length','No audio detected','Invalid input','Invalid worker code','Invalid crew name','Invalid language','Invalid page','Invalid status','Invalid search','Invalid crew',
  'Invalid activity filter','Invalid activity date','Activity exceeds limit; narrow the date, actor or action filter','Activity exceeds export limit',
  'Invalid help request','Invalid clarification filter','Clarifications exceed limit; narrow filters','Resolution notes are required','Invalid clarification owner',
  'Use text/csv for CSV upload','Invalid import request','Invalid import confirmation','Invalid CSV request','CSV must contain 1 byte to 256 KiB','CSV exceeds 256 KiB limit','Invalid export request','Report exceeds export limit']);

for(const message of ['Invalid deletion filters','Invalid deletion request','Invalid retention request','Invalid retention policy','Invalid language readiness request','Invalid usage request'])badInput.add(message);
for(const message of ['Invalid language selection','Invalid language request','Invalid language request note','Invalid language request reason','Invalid language decision'])badInput.add(message);
for(const message of ['Invalid text retention request','Invalid text retention policy'])badInput.add(message);
badInput.add('Invalid draft languages request');
badInput.add('Invalid usage change request');
badInput.add('Invalid activation request');
badInput.add('Invalid voice request');
for(const message of ['Invalid push request','Invalid push subscription','Push service unavailable'])badInput.add(message);
for(const message of ['Invalid conversation request','Invalid conversation filter'])badInput.add(message);
badInput.add('Invalid generation languages');
badInput.add('Invalid presentation request');
badInput.add('Invalid presentation content');
for(const message of ['Invalid onboarding request','Invalid onboarding briefing'])badInput.add(message);
for(const message of ['Invalid recording notice request','Invalid recording notice text','Recording notice requires every supported language'])badInput.add(message);
for(const message of ['Invalid instruction request','Invalid instruction audience','Instruction audience is empty','Instruction preparation unavailable',
  'Invalid instruction retry request','Invalid acknowledgment request','This instruction only requires confirmation'])badInput.add(message);

async function readAudio(req) {
  if (req.headers['content-type']!=='audio/wav') throw new Error('Expected WAV audio');
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if (size>2880044) throw new Error('Recording is too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks,size);
}

// Isolated authenticated rehearsal only. No default seed, no demo-profile login, no production bypass.
export function createPostgresRehearsalServer(pool,{storage,dataClass,schema,...options}={}) {
  const config=resolveAuthConfig(options);
  if (config.accessMode!=='credential' || dataClass!=='synthetic' || !/^understood_test_[a-z0-9_]+$/.test(schema || '')
    || typeof pool?.connect!=='function') throw new Error('Use an explicitly isolated synthetic PostgreSQL rehearsal');
  return createServer(postgresHandler(pool,{...options,storage,schema,config:{...config,dataClass,caseFollowupAdapter:options.caseFollowupAdapter},cookieName:'understood_pg_rehearsal',backend:'postgres-rehearsal',requestAddress:req=>{requireLocalRequest(req);return req.socket.remoteAddress;}}));
}
export function createPostgresHostedServer(pool,{config,storage,publicBuild}={}) {
  if(config?.tier==='production')assertProductionAdmission(config);
  if(config?.service!=='api' || config.operatorAccess!==false || config.runtimeRoleProfile!=='application' || config.providerVerification!==undefined
    || !(config.tier==='staging'&&config.dataClass==='synthetic'&&config.integrationMode==='synthetic'||config.tier==='production'&&config.dataClass==='real'&&config.integrationMode==='live') || config.accessMode!=='credential'
    || typeof config.requestAddress!=='function' || typeof publicBuild!=='function' || typeof pool?.connect!=='function')throw Error('Invalid hosted synthetic runtime');
  return createServer(postgresHandler(pool,{...config,config,storage,publicBuild,secure:true,cookieName:'__Host-understood_session',backend:config.integrationMode==='live'?'postgres-hosted-live':'postgres-hosted-synthetic'}));
}
export function postgresHandler(pool,{storage,schema,config,cookieName,backend,requestAddress,secure=false,publicBuild,...options}) {
  const voiceAvailable=!!storage && ['save','read','remove','exists'].every(key=>typeof storage[key]==='function');
  const presentationTranslator=options.presentationTranslator ?? null;
  const presentationGenerationAllowed=options.presentationGenerationAllowed !== false;
  const pushAdapter=options.pushAdapter ?? resolvePushAdapter(options.pushEnv);
  const cookieOptions={name:cookieName,secure};
  const pipeline=pipelineStatus(options);
  const repository={schema,integrationMode:config.integrationMode??'synthetic',cookieName,pipeline,providerVerification:options.providerVerification,storage};
  const mail=options.mail ?? {available:false};
  const registrationVerification=options.registrationVerification ?? mail;
  const destination=pilotDestination(options.pilotDestination);
  const advanceInstructionPreparation=async(started,session)=>{
    const state=()=>domainTransaction(pool,repository.schema,async client=>(await client.query(
      'SELECT state FROM briefings WHERE id=$1 AND org_id=$2 AND site_id=$3',[started.briefingId,session.org_id,session.site_id])).rows[0]?.state);
    // Provider preparation belongs to the background worker. An HTTP status poll
    // must never claim that job with the local demo processor.
    if(options.preparationAdapter||repository.integrationMode==='live')return state();
    let current=await state();
    for(let i=0;i<10 && current==='processing';i++) {
      if(!await processOnePreparation(pool,{schema:repository.schema,integrationMode:'synthetic'})) break;
      current=await state();
    }
    return current;
  };
  return async (req,res) => {
    let requestPath='';
    try {
      // Health exposes no tenant data and also serves a private load-balancer check.
      if(secure && req.url==='/api/health' && req.method==='GET' && req.headers['x-forwarded-proto']===undefined) {
        await withPostgresClient(pool,client=>client.query('SELECT 1'));
        return send(res,200,{status:'ok',mode:`${config.aiMode}-credential`,backend});
      }
      const address=requestAddress(req);
      if(secure)res.setHeader('strict-transport-security','max-age=31536000');
      const url=new URL(req.url || '/','http://127.0.0.1'),path=url.pathname;
      requestPath=path;
      if(path==='/api/neon/status'&&req.method==='GET')return send(res,200,await neonFunctionStatus());
      if (path==='/api/health' && req.method==='GET') {
        await withPostgresClient(pool,client=>client.query('SELECT 1'));
        return send(res,200,{status:'ok',mode:`${config.aiMode}-credential`,backend});
      }
      if(!path.startsWith('/api/') && publicBuild)return publicBuild(req,res,url);
      if (req.method!=='GET') verifyMutationOrigin(req,config);
      if(await handleOperationsRoute(pool,req,res,url,{schema,enabled:options.operatorAccess===true,providerVerification:options.providerVerification,pipeline,secure,clientAddress:address}))return;
      if(await handlePilotRoute(req,res,url,{save:(input)=>savePilot(pool,input,address,{...repository,mail,destination}),read:(id,secret)=>readPilot(pool,id,secret,repository)}))return;
      if (path==='/api/demo/session') return send(res,404,{error:'Not found'});
      if(path==='/api/auth/recovery' && req.method==='POST') {
        if(url.search) throw new Error('Invalid recovery input');
        return send(res,202,await requestRecovery(pool,await readJson(req),address,mail,repository));
      }
      if(path==='/api/auth/reset-password' && req.method==='POST') {
        if(url.search) throw new Error('Invalid recovery link or input');
        return send(res,200,await resetPassword(pool,await readJson(req),address,mail,repository),
          {'set-cookie':clearSessionCookie(cookieOptions)});
      }
      if(path==='/api/auth/registrations/options' && req.method==='GET')return send(res,200,{available:registrationVerification.available===true,verification:registrationVerification.provider==='neon'?'neon-code':'link'});
      if(path==='/api/auth/registrations/verify-code' && req.method==='POST'){
        if(url.search)throw Error('Invalid registration input');
        return send(res,200,await verifyRegistrationCode(pool,await readJson(req),address,registrationVerification,repository));
      }
      if(path==='/api/auth/registrations' && req.method==='POST') {
        if(url.search) throw new Error('Invalid registration input');
        const input=await readJson(req);
        const result=await requestRegistration(pool,input,address,registrationVerification,repository);
        await options.dispatchRegistration?.(result.requestId ?? input.requestId);
        return send(res,202,result);
      }
      if(path==='/api/auth/registrations/resend' && req.method==='POST') {
        if(url.search) throw new Error('Invalid registration input');
        const input=await readJson(req);
        const result=await resendRegistration(pool,input,address,registrationVerification,repository);
        await options.dispatchRegistration?.(input.requestId);
        return send(res,202,result);
      }
      if(path==='/api/auth/registrations/verify' && req.method==='POST') {
        if(url.search) throw new Error('Invalid registration input');
        return send(res,200,await verifyRegistration(pool,await readJson(req),address,registrationVerification,repository));
      }
      const invitationAcceptMatch=path.match(/^\/api\/auth\/invitations\/(preview|signup|accept)$/);
      if(invitationAcceptMatch && req.method==='POST') {
        if(url.search) throw new Error('Invalid invitation input');const input=await readJson(req),action=invitationAcceptMatch[1];
        if(action==='preview') return send(res,200,await previewInvitation(pool,input,address,repository));
        let actor=null;try {actor=await requireSession(pool,req,repository);}catch(error) {if(error.message!=='Sign in required') throw error;}
        if(action==='accept' && !actor) throw new Error('Sign in required');
        const result=await acceptInvitation(pool,actor,action==='signup' ? 'signup' : 'existing',input,address,mail,repository);
        return send(res,200,result,action==='signup' ? {'set-cookie':clearSessionCookie(cookieOptions)} : {});
      }
      if (path==='/api/auth/staff/login' && req.method==='POST') {
        const body=await readJson(req);
        const login=await authenticateStaff(pool,body.email,body.password,address,repository);
        return send(res,200,{ok:true},{'set-cookie':sessionCookie(login.session.token,login.session.maxSeconds,cookieOptions)});
      }
      if (path==='/api/auth/worker/redeem' && req.method==='POST') {
        const body=await readJson(req);if(!['token','company','workerId','password'].every(key=>typeof body[key]==='string' && body[key].length>0))throw new Error('Invalid credentials');
        const session=await authenticateWorker(pool,body,req.socket.remoteAddress,repository);
        return send(res,200,{ok:true},{'set-cookie':sessionCookie(session.token,session.maxSeconds,cookieOptions)});
      }
      if(path==='/api/auth/worker/context' && req.method==='GET') {
        const keys=[...url.searchParams.keys()];
        if(keys.length!==1 || keys[0]!=='company' || url.searchParams.getAll('company').length!==1) throw new Error('Invalid input');
        return send(res,200,await workerCompanyContext(pool,{company:url.searchParams.get('company')},repository));
      }
      if(path==='/api/auth/worker/login' && req.method==='POST') {
        if(url.search) throw new Error('Invalid input');
        const session=await authenticateWorker(pool,await readJson(req),address,repository);
        return send(res,200,{ok:true},{'set-cookie':sessionCookie(session.token,session.maxSeconds,cookieOptions)});
      }
      if(path==='/api/auth/worker/setup' && req.method==='POST') {
        if(url.search) throw new Error('Invalid input');
        return send(res,410,{error:'Use the worker ID and password assigned by your company.'});
      }
      if (path==='/api/logout' && req.method==='POST') {
        let actor;
        try {actor=await requireSession(pool,req,repository);}catch(error) {
          if(error.message!=='Sign in required' || req.headers['x-client-session-context']!==undefined)throw error;
        }
        if(actor)verifyClientSession(req,actor,path);
        await revokeSession(pool,req,repository);
        return send(res,200,{ok:true},{'set-cookie':clearSessionCookie(cookieOptions)});
      }
      let session;
      try {session=await requireSession(pool,req,repository);} catch (error) {
        if (path==='/api/session' && req.method==='GET' && error.message==='Sign in required') return send(res,200,{authenticated:false,mode:`${config.aiMode}-credential`});
        throw error;
      }
      verifyClientSession(req,session,path);
      if(!archivedWriteAllowed(path,req.method))await domainTransaction(pool,repository.schema,client=>requireSiteOperational(client,session.org_id,session.site_id));
      if(await handleSourceAudioRoute(req,res,session,url,{
        list:(s,filters)=>listSourceAudio(pool,s,filters,repository),
        retry:(s,id,input)=>retrySourceAudio(pool,s,id,input,repository),
        retryReceipt:(s,id,retryId)=>getSourceRetryReceipt(pool,s,id,retryId,repository),
        receive:(s,input,original,wav)=>receiveSourceAudio(pool,s,input,original,wav,storage,repository),
        receipt:(s,id)=>getSourceAudioReceipt(pool,s,id,repository),
        audio:(s,id,kind)=>getSourceAudio(pool,s,id,storage,kind,repository),
      }))return;
      if (path==='/api/session' && req.method==='GET') return send(res,200,{authenticated:true,mode:`${config.aiMode}-credential`,...clientSessionContext(session),...await sessionContext(pool,session,repository)});
      if(path==='/api/auth/worker/redemption' && req.method==='GET')return send(res,200,await readWorkerRedemption(pool,session,redemptionHttpInput(req,url),repository));
      if(path==='/api/search' && req.method==='GET')return send(res,200,await searchSite(pool,session,searchQuery(url.searchParams),repository));
      if(path==='/api/account/sites' && req.method==='GET') return send(res,200,await listAccountSites(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/account/site' && req.method==='POST') {
        if(url.search) throw new Error('Invalid account site request');
        const next=await switchAccountSite(pool,req,await readJson(req),repository);
        return send(res,200,{ok:true},{'set-cookie':sessionCookie(next.token,next.maxSeconds,cookieOptions)});
      }
      if (path==='/api/overview' && req.method==='GET') return send(res,200,await staffOverview(pool,session,repository));
      if(await handleWorkspaceRoute(req,res,session,url,(s,op,input)=>postgresWorkspace(pool,s,op,input,repository)))return;
      if(path==='/api/instructions/audience' && req.method==='GET') {
        if(url.search) throw new Error('Invalid instruction request');
        return send(res,200,await instructionAudienceOverview(pool,session,repository));
      }
      if(path==='/api/instructions/send' && req.method==='POST') {
        if(url.search) throw new Error('Invalid instruction request');
        const started=await startInstructionSend(pool,session,await readJson(req),repository);
        await advanceInstructionPreparation(started,session);
        const result=await completeInstructionSend(pool,session,started.requestId,repository);
        return send(res,result.state==='failed'?409:result.duplicate?200:201,result);
      }
      const instructionSendMatch=path.match(/^\/api\/instructions\/sends\/([^/]+)$/);
      if(instructionSendMatch && req.method==='GET') {
        if(url.search) throw new Error('Invalid instruction request');
        const current=await instructionSendStatus(pool,session,decodeURIComponent(instructionSendMatch[1]),repository);
        if(current.state==='preparing') {
          await advanceInstructionPreparation(current,session);
          const result=await completeInstructionSend(pool,session,current.requestId,repository);
          return send(res,result.state==='failed'?409:200,result);
        }
        if(current.deliveryStates?.preparing>0) {
          await advanceInstructionPreparation(current,session);
          const result=await reconcileInstructionSend(pool,session,current.requestId,repository);
          return send(res,result.send.state==='failed'?409:200,result.send);
        }
        return send(res,200,current);
      }
      const instructionRetryMatch=path.match(/^\/api\/instructions\/sends\/([^/]+)\/retry$/);
      if(instructionRetryMatch && req.method==='POST') {
        if(url.search) throw new Error('Invalid instruction request');
        const result=await retryInstructionSend(pool,session,decodeURIComponent(instructionRetryMatch[1]),await readJson(req),repository);
        if(result.deliveryStates?.preparing>0) {
          await advanceInstructionPreparation(result,session);
          const next=result.state==='published'
            ? await reconcileInstructionSend(pool,session,result.requestId,repository)
            : {send:await completeInstructionSend(pool,session,result.requestId,repository),released:0};
          return send(res,next.send.state==='failed'?409:result.duplicate?200:201,
            {...next.send,retryRequestId:result.retryRequestId,retried:result.retried,released:next.released,duplicate:result.duplicate});
        }
        return send(res,result.state==='failed'?409:result.duplicate?200:201,result);
      }
      if(path==='/api/templates' && req.method==='GET') return send(res,200,await listTemplates(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/glossary' && req.method==='GET') return send(res,200,await listGlossary(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/glossary' && req.method==='POST') {if(url.search) throw new Error('Invalid glossary request');const result=await changeGlossary(pool,session,'create',null,await readJson(req),repository);return send(res,result.duplicate ? 200 : 201,result);}
      const glossaryReceiptMatch=path.match(/^\/api\/glossary\/receipts\/([^/]+)$/);
      if(glossaryReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid glossary request');return send(res,200,await glossaryReceipt(pool,session,decodeURIComponent(glossaryReceiptMatch[1]),repository));}
      const glossaryMatch=path.match(/^\/api\/glossary\/([^/]+)(?:\/(edit|remove|restore|regenerate))?$/);
      if(glossaryMatch && !glossaryMatch[2] && req.method==='GET') return send(res,200,await getGlossaryTerm(pool,session,decodeURIComponent(glossaryMatch[1]),Object.fromEntries(url.searchParams),repository));
      if(glossaryMatch && glossaryMatch[2] && req.method==='POST') {if(url.search) throw new Error('Invalid glossary request');return send(res,200,await changeGlossary(pool,session,glossaryMatch[2],decodeURIComponent(glossaryMatch[1]),await readJson(req),repository));}
      const reviewReceiptMatch=path.match(/^\/api\/briefing-review\/receipts\/([^/]+)$/);
      const languagesMatch=path.match(/^\/api\/briefings\/([^/]+)\/generation-languages$/),languagesReceipt=path.match(/^\/api\/briefing-languages\/receipts\/([^/]+)$/);
      if(languagesMatch && req.method==='POST'){if(url.search)throw Error('Invalid draft languages request');return send(res,200,await saveDraftLanguages(pool,session,decodeURIComponent(languagesMatch[1]),await readJson(req,4096),repository));}
      if(languagesReceipt && req.method==='GET'){if(url.search)throw Error('Invalid draft languages request');return send(res,200,await draftLanguagesReceipt(pool,session,decodeURIComponent(languagesReceipt[1]),repository));}
      const regenerationReceiptMatch=path.match(/^\/api\/briefing-regeneration\/receipts\/([^/]+)$/);
      if(regenerationReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid regeneration request');return send(res,200,await regenerationReceipt(pool,session,decodeURIComponent(regenerationReceiptMatch[1]),repository));}
      if(reviewReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid draft review request');return send(res,200,await draftReviewReceipt(pool,session,decodeURIComponent(reviewReceiptMatch[1]),repository));}
      const reviewReceiptVerify=path.match(/^\/api\/briefing-review\/receipts\/([^/]+)\/verify$/);
      if(reviewReceiptVerify && req.method==='POST'){if(url.search)throw Error('Invalid draft review request');return send(res,200,await verifyDraftReviewReceipt(pool,session,decodeURIComponent(reviewReceiptVerify[1]),await readJson(req),repository));}
      if(path==='/api/templates' && req.method==='POST') {if(url.search) throw new Error('Invalid template request');const result=await changeTemplate(pool,session,'create',null,await readJson(req),repository);return send(res,result.duplicate ? 200 : 201,result);}
      const templateReceiptMatch=path.match(/^\/api\/templates\/receipts\/([^/]+)$/);
      if(templateReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid template request');return send(res,200,await templateReceipt(pool,session,decodeURIComponent(templateReceiptMatch[1]),repository));}
      const templateMatch=path.match(/^\/api\/templates\/([^/]+)(?:\/(edit|archive|restore|duplicate|use))?$/);
      if(templateMatch && !templateMatch[2] && req.method==='GET') return send(res,200,await getTemplate(pool,session,templateMatch[1],Object.fromEntries(url.searchParams),repository));
      if(templateMatch && templateMatch[2] && req.method==='POST') {if(url.search) throw new Error('Invalid template request');return send(res,200,await changeTemplate(pool,session,templateMatch[2],templateMatch[1],await readJson(req),repository));}
      if(path==='/api/settings/staff' && req.method==='GET') return send(res,200,await listStaff(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/settings/invitations' && req.method==='GET') return send(res,200,await listInvitations(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/settings/invitations' && req.method==='POST') {
        if(url.search) throw new Error('Invalid invitation input');const result=await issueInvitation(pool,session,await readJson(req),mail,repository);
        return send(res,result.duplicate ? 200 : 202,result);
      }
      const invitationReceiptMatch=path.match(/^\/api\/settings\/invitations\/receipts\/([^/]+)$/);
      if(invitationReceiptMatch && req.method==='GET') {
        if(url.search) throw new Error('Invalid invitation input');return send(res,200,await invitationReceipt(pool,session,decodeURIComponent(invitationReceiptMatch[1]),repository));
      }
      const invitationChangeMatch=path.match(/^\/api\/settings\/invitations\/([^/]+)\/(resend|cancel)$/);
      if(invitationChangeMatch && req.method==='POST') {
        if(url.search) throw new Error('Invalid invitation input');const result=await changeInvitation(pool,session,decodeURIComponent(invitationChangeMatch[1]),invitationChangeMatch[2],await readJson(req),mail,repository);
        return send(res,invitationChangeMatch[2]==='resend' && !result.duplicate ? 202 : 200,result);
      }
      const staffReceiptMatch=path.match(/^\/api\/settings\/staff\/receipts\/([^/]+)$/);
      if(staffReceiptMatch && req.method==='GET') {if(url.search) throw new Error('Invalid staff request');return send(res,200,await staffReceipt(pool,session,decodeURIComponent(staffReceiptMatch[1]),repository));}
      const staffChangeMatch=path.match(/^\/api\/settings\/staff\/([^/]+)\/(role|revoke|restore)$/);
      if(staffChangeMatch && req.method==='POST') {if(url.search) throw new Error('Invalid staff request');return send(res,200,await changeStaff(pool,session,decodeURIComponent(staffChangeMatch[1]),staffChangeMatch[2],await readJson(req),repository));}
      if(path==='/api/onboarding/first-run' && ['GET','POST'].includes(req.method)) {
        if(url.search)throw Error('Invalid onboarding input');
        return send(res,200,req.method==='GET'?await getFirstRun(pool,session,repository):await completeFirstRun(pool,session,await readJson(req,4096),repository));
      }
      if(path==='/api/settings/onboarding' && ['GET','POST'].includes(req.method)) {
        if(url.search)throw Error('Invalid onboarding request');
        return send(res,200,req.method==='GET'?await getOnboarding(pool,session,repository):await saveOnboarding(pool,session,await readJson(req,4096),repository));
      }
      const onboardingMatch=path.match(/^\/api\/settings\/onboarding\/receipts\/([a-f0-9-]{36})$/i);
      if(onboardingMatch && req.method==='GET'){if(url.search)throw Error('Invalid onboarding request');return send(res,200,await onboardingReceipt(pool,session,onboardingMatch[1],repository));}
      if(path==='/api/settings/sites' && ['GET','POST'].includes(req.method)) {
        if(req.method==='GET')return send(res,200,await listSites(pool,session,Object.fromEntries(url.searchParams),repository));
        if(url.search)throw Error('Invalid site creation');return send(res,200,await createSite(pool,session,await readJson(req),repository));
      }
      if(path==='/api/settings/sites/access' && req.method==='POST'){
        if(url.search)throw Error('Invalid site access request');return send(res,200,await saveSiteAccess(pool,session,await readJson(req),repository));
      }
      if(path==='/api/settings/sites/lifecycle' && req.method==='POST'){
        if(url.search)throw Error('Invalid site lifecycle request');return send(res,200,await saveSiteLifecycle(pool,session,await readJson(req,4096),repository));
      }
      const lifecycleReceipt=path.match(/^\/api\/settings\/sites\/lifecycle\/receipts\/([^/]+)$/);
      if(lifecycleReceipt && req.method==='GET'){
        if(url.search)throw Error('Invalid site lifecycle request');return send(res,200,await siteLifecycleReceipt(pool,session,decodeURIComponent(lifecycleReceipt[1]),repository));
      }
      const lifecycleDetail=path.match(/^\/api\/settings\/sites\/([^/]+)\/lifecycle$/);
      if(lifecycleDetail && req.method==='GET'){
        if(url.search)throw Error('Invalid site lifecycle request');return send(res,200,await inspectSiteLifecycle(pool,session,decodeURIComponent(lifecycleDetail[1]),repository));
      }
      const siteAccessMatch=path.match(/^\/api\/settings\/sites\/access\/receipts\/([^/]+)$/);
      if(siteAccessMatch && req.method==='GET'){
        if(url.search)throw Error('Invalid site access request');return send(res,200,await siteAccessReceipt(pool,session,siteAccessMatch[1],repository));
      }
      const siteReceiptMatch=path.match(/^\/api\/settings\/sites\/receipts\/([^/]+)$/);
      if(siteReceiptMatch && req.method==='GET'){if(url.search)throw Error('Invalid site creation');return send(res,200,await siteCreationReceipt(pool,session,siteReceiptMatch[1],repository));}
      if(path==='/api/settings/contacts' && req.method==='GET')return send(res,200,await listSiteContacts(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/settings' && req.method==='GET') {if(url.search) throw new Error('Invalid settings request');return send(res,200,await getSettings(pool,session,repository));}
      const settingsMatch=path.match(/^\/api\/settings\/(organization|site)$/);
      const settingsReceiptMatch=path.match(/^\/api\/settings\/(organization|site)\/receipts\/([^/]+)$/);
      if(settingsReceiptMatch && req.method==='GET'){if(url.search)throw Error('Invalid settings request');return send(res,200,await settingsReceipt(pool,session,settingsReceiptMatch[1],settingsReceiptMatch[2],repository));}
      if(settingsMatch && req.method==='POST') {if(url.search) throw new Error('Invalid settings request');return send(res,200,await updateSettings(pool,session,settingsMatch[1],await readJson(req),repository));}
      if(path==='/api/invoices' && req.method==='GET') return send(res,200,await listInvoices(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/invoices' && req.method==='POST') {const result=await createInvoice(pool,session,await readJson(req),repository);return send(res,result.duplicate ? 200 : 201,result);}
      const billingRequest=path.match(/^\/api\/invoices\/requests\/([^/]+)\/([^/]+)$/);
      if(billingRequest && req.method==='GET') {if(url.search) throw new Error('Invalid invoice filter');return send(res,200,await billingReceipt(pool,session,billingRequest[1],billingRequest[2],repository));}
      const invoiceMatch=path.match(/^\/api\/invoices\/([^/]+)(?:\/(payments|download|void))?$/);
      if(invoiceMatch && !invoiceMatch[2] && req.method==='GET') return send(res,200,await getInvoice(pool,session,invoiceMatch[1],Object.fromEntries(url.searchParams),repository));
      if(invoiceMatch && invoiceMatch[2]==='download' && req.method==='GET') return sendInvoiceDownload(res,await getInvoice(pool,session,invoiceMatch[1],Object.fromEntries(url.searchParams),repository));
      if(invoiceMatch && invoiceMatch[2]==='payments' && req.method==='POST') {const result=await recordPayment(pool,session,invoiceMatch[1],await readJson(req),repository);return send(res,result.duplicate ? 200 : 201,result);}
      if(invoiceMatch && invoiceMatch[2]==='void' && req.method==='POST') {const result=await voidInvoice(pool,session,invoiceMatch[1],await readJson(req),repository);return send(res,result.duplicate ? 200 : 201,result);}
      const preparationRequestMatch=path.match(/^\/api\/briefings\/([^/]+)\/preparation-requests(?:\/([^/]+))?$/);
      if(preparationRequestMatch) {
        if(url.search)throw Error('Invalid preparation request');
        const [,id,requestId]=preparationRequestMatch;
        if(req.method==='GET')return send(res,200,requestId?await getPreparationRequestReceipt(pool,session,id,requestId,repository):await getPreparationRequestContext(pool,session,id,repository));
        if(req.method==='POST' && !requestId)return send(res,202,await requestPreparation(pool,session,id,await readJson(req),repository));
      }
      if(await handleProcessingProvenanceRoute(req,res,session,url,(actor,id,filters)=>getProcessingProvenance(pool,actor,id,filters,repository)))return;
      if(await handleProcessingRetryRoute(req,res,session,url,{context:(actor,id)=>getProcessingRetryContext(pool,actor,id,repository),receipt:(actor,id,requestId)=>getProcessingRetryReceipt(pool,actor,id,requestId,repository),retry:(actor,id,input)=>retryProcessing(pool,actor,id,input,repository)}))return;
      if (path==='/api/processing' && req.method==='GET') return send(res,200,await listProcessing(pool,session,Object.fromEntries(url.searchParams),repository));
      const processingMatch=path.match(/^\/api\/processing\/([^/]+)$/);
      if(processingMatch && req.method==='GET') return send(res,200,await getProcessing(pool,session,decodeURIComponent(processingMatch[1]),repository));
      if(path==='/api/language-readiness' && req.method==='GET') {if(url.search) throw new Error('Invalid language readiness request');return send(res,200,await getLanguageReadiness(pool,session,repository));}
      if(path==='/api/language-readiness/test' && req.method==='POST') {if(url.search) throw new Error('Invalid language readiness request');return send(res,200,await runLanguageReadiness(pool,session,await readJson(req),repository));}
      if(path==='/api/usage' && req.method==='GET') {if(url.search) throw new Error('Invalid usage request');return send(res,200,await getUsage(pool,session,repository));}
      if(path==='/api/usage/requests') {
        if(req.method==='GET')return send(res,200,await listUsageRequests(pool,session,Object.fromEntries(url.searchParams),repository));
        if(req.method==='POST'){if(url.search)throw Error('Invalid usage change request');const result=await saveUsageRequest(pool,session,await readJson(req),repository);return send(res,result.duplicate?200:201,result);}
      }
      const usageReceipt=/^\/api\/usage\/requests\/([^/]+)$/.exec(path);
      if(usageReceipt && req.method==='GET'){if(url.search)throw Error('Invalid usage change request');return send(res,200,await usageRequestReceipt(pool,session,usageReceipt[1],repository));}
      if(path==='/api/entitlement/requests' && req.method==='POST'){
        if(url.search)throw Error('Invalid activation request');
        const result=await saveActivationRequest(pool,session,await readJson(req,4096),repository);
        return send(res,result.duplicate?200:201,result);
      }
      const activationReceipt=/^\/api\/entitlement\/requests\/([^/]+)$/.exec(path);
      if(activationReceipt && req.method==='GET'){
        if(url.search)throw Error('Invalid activation request');
        return send(res,200,await activationRequestReceipt(pool,session,activationReceipt[1],repository));
      }
      if(path==='/api/privacy/recording-notice' && ['GET','POST'].includes(req.method)){
        const language=recordingNoticeLanguage(url.searchParams,session,req.method);
        return send(res,200,req.method==='GET'?await getRecordingNotice(pool,session,{...repository,language}):await saveRecordingNotice(pool,session,await readJson(req,100000),repository));
      }
      const noticeRequest=path.match(/^\/api\/privacy\/recording-notice\/requests\/([^/]+)$/);
      if(noticeRequest && req.method==='GET'){
        if(url.search)throw Error('Invalid recording notice request');
        return send(res,200,await recordingNoticeReceipt(pool,session,decodeURIComponent(noticeRequest[1]),repository));
      }
      if(path==='/api/retention' && req.method==='GET') {if(url.search) throw new Error('Invalid retention request');return send(res,200,await getRetention(pool,session,repository));}
      if(path==='/api/retention/text' && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await getTextRetention(pool,session,repository));}
      if(path==='/api/retention/briefings' && ['GET','POST'].includes(req.method)){if(url.search)throw Error('Invalid text retention request');return send(res,200,req.method==='GET'?await getBriefingRetention(pool,session,repository):await saveBriefingRetention(pool,session,await readJson(req),repository));}
      const briefingRetentionRequest=path.match(/^\/api\/retention\/briefings\/requests\/([^/]+)$/);
      if(briefingRetentionRequest && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await briefingRetentionReceipt(pool,session,decodeURIComponent(briefingRetentionRequest[1]),repository));}
      if(path==='/api/retention/activity' && ['GET','POST'].includes(req.method)){if(url.search)throw Error('Invalid text retention request');return send(res,200,req.method==='GET'?await getActivityRetention(pool,session,repository):await saveActivityRetention(pool,session,await readJson(req),repository));}
      const activityRetentionRequest=path.match(/^\/api\/retention\/activity\/requests\/([^/]+)$/);
      if(activityRetentionRequest && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await activityRetentionReceipt(pool,session,decodeURIComponent(activityRetentionRequest[1]),repository));}
      if(path==='/api/retention/cases' && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await getCaseRetention(pool,session,repository));}
      if(path==='/api/retention/generated' && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await getGeneratedRetention(pool,session,repository));}
      if(path==='/api/retention/generated' && req.method==='POST'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await saveGeneratedRetention(pool,session,await readJson(req),repository));}
      const generatedRetentionRequest=path.match(/^\/api\/retention\/generated\/requests\/([^/]+)$/);
      if(generatedRetentionRequest && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await generatedRetentionReceipt(pool,session,decodeURIComponent(generatedRetentionRequest[1]),repository));}
      if(path==='/api/retention/cases' && req.method==='POST'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await saveCaseRetention(pool,session,await readJson(req),repository));}
      const caseRetentionRequest=path.match(/^\/api\/retention\/cases\/requests\/([^/]+)$/);
      if(caseRetentionRequest && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await caseRetentionReceipt(pool,session,decodeURIComponent(caseRetentionRequest[1]),repository));}
      if(path==='/api/retention/text' && req.method==='POST'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await saveTextRetention(pool,session,await readJson(req),repository));}
      const textRetentionRequest=path.match(/^\/api\/retention\/text\/requests\/([^/]+)$/);
      if(textRetentionRequest && req.method==='GET'){if(url.search)throw Error('Invalid text retention request');return send(res,200,await textRetentionReceipt(pool,session,decodeURIComponent(textRetentionRequest[1]),repository));}
      if(path==='/api/privacy/workers' && req.method==='GET')return send(res,200,await listPrivacyWorkers(pool,session,Object.fromEntries(url.searchParams),repository));
      if(path==='/api/retention' && req.method==='POST') {if(url.search) throw new Error('Invalid retention request');return send(res,200,await saveRetention(pool,session,await readJson(req),repository));}
      const retentionRequest=path.match(/^\/api\/retention\/requests\/([^/]+)$/);
      if(retentionRequest && req.method==='GET'){if(url.search)throw new Error('Invalid retention request');return send(res,200,await retentionReceipt(pool,session,decodeURIComponent(retentionRequest[1]),repository));}
      if (path==='/api/worker-grants' && req.method==='POST') {
        const body=grantIssueInput(await readJson(req));
        return send(res,201,await issueWorkerGrant(pool,session,body.workerId,body.expiresInMinutes ?? 240,repository));
      }
      const workerCredentials=path.match(/^\/api\/people\/workers\/([^/]+)\/credentials$/);
      if(workerCredentials && req.method==='GET') {
        if(url.search) throw new Error('Invalid credential request');
        return send(res,200,await workerCredentialStatus(pool,session,workerCredentials[1],repository));
      }
      const workerPasswordAssignment=path.match(/^\/api\/people\/workers\/([^/]+)\/credentials\/password$/);
      if(workerPasswordAssignment && req.method==='POST'){
        if(config.accessMode!=='credential')return send(res,404,{error:'Not found'});
        if(url.search)throw new Error('Invalid input');
        return send(res,200,await assignWorkerPassword(pool,session,decodeURIComponent(workerPasswordAssignment[1]),await readJson(req),repository));
      }
      const workerCredentialSetup=path.match(/^\/api\/people\/workers\/([^/]+)\/credentials\/setup$/);
      if(workerCredentialSetup && req.method==='POST') {
        if(url.search) throw new Error('Invalid credential request');
        await workerCredentialStatus(pool,session,workerCredentialSetup[1],repository);
        return send(res,410,{error:'Assign the worker ID and password from Team.'});
      }
      const grant=path.match(/^\/api\/worker-grants\/([^/]+)\/revoke$/);
      if (grant && req.method==='POST') {
        if(Object.keys(await readJson(req)).length) throw new Error('Invalid input');
        await revokeWorkerGrant(pool,session,grant[1],repository); return send(res,200,{ok:true});
      }
      if(path==='/api/push/status' && req.method==='GET') {
        if(url.search) throw Error('Invalid push request');
        return send(res,200,await pushSubscriptionStatus(pool,session,pushAdapter,repository));
      }
      if(path==='/api/push/subscriptions' && req.method==='POST') {
        if(url.search) throw Error('Invalid push request');
        return send(res,201,await savePushSubscription(pool,session,await readJson(req),repository));
      }
      const pushSubscriptionMatch=path.match(/^\/api\/push\/subscriptions\/([^/]+)$/);
      if(pushSubscriptionMatch && req.method==='DELETE') {
        if(url.search) throw Error('Invalid push request');
        return send(res,200,await revokePushSubscription(pool,session,decodeURIComponent(pushSubscriptionMatch[1]),repository));
      }
      if(path==='/api/notifications/live'&&req.method==='GET'){
        await listNotifications(pool,session,{pageSize:'1'},repository);
        const live=await notificationLiveQuery(session,{schema});
        return send(res,live?200:404,live||{error:'Not configured'});
      }
      if(path==='/api/notifications' && req.method==='GET')return send(res,200,session.principal_type==='worker'
        ?await listWorkerNotifications(pool,session,Object.fromEntries(url.searchParams),repository)
        :await listNotifications(pool,session,Object.fromEntries(url.searchParams),repository));
      const notificationReceiptMatch=path.match(/^\/api\/notifications\/([^/]+)\/receipt$/);
      if(notificationReceiptMatch && req.method==='GET') {
        if(url.search)throw Error('Invalid notification request');return send(res,200,session.principal_type==='worker'
          ?await workerNotificationReceipt(pool,session,notificationReceiptMatch[1],repository)
          :await notificationReceipt(pool,session,notificationReceiptMatch[1],repository));
      }
      const notificationMatch=path.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if(notificationMatch && req.method==='POST') {
        if(url.search || Object.keys(await readJson(req)).length)throw Error('Invalid notification request');
        return send(res,200,session.principal_type==='worker'
          ?await readWorkerNotification(pool,session,notificationMatch[1],repository)
          :await readNotification(pool,session,notificationMatch[1],repository));
      }
      if(path==='/api/clarification-creations/subjects'&&req.method==='GET'){
        if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid clarification subject filter');
        return send(res,200,{...await listClarificationSubjects(pool,session,Object.fromEntries(url.searchParams),repository),clientContext:clientSessionContext(session).clientContext});
      }
      const creationSubject=path.match(/^\/api\/clarification-creations\/subjects\/([^/]+)$/);
      if(creationSubject&&req.method==='GET'){if(url.search)throw Error('Invalid clarification subject');return send(res,200,{...await getClarificationSubject(pool,session,creationSubject[1],repository),clientContext:clientSessionContext(session).clientContext});}
      if(path==='/api/clarification-creations'&&req.method==='POST'){if(url.search)throw Error('Invalid clarification creation');return send(res,200,{...await createStaffClarification(pool,session,await readJson(req),repository),clientContext:clientSessionContext(session).clientContext});}
      const creationReceipt=path.match(/^\/api\/clarification-creations\/([^/]+)$/);
      if(creationReceipt&&req.method==='GET'){if(url.search)throw Error('Invalid clarification creation');return send(res,200,{...await staffClarificationCreationReceipt(pool,session,creationReceipt[1],repository),clientContext:clientSessionContext(session).clientContext});}
      if (path==='/api/clarifications' && req.method==='GET') {
        if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid clarification filter');
        return send(res,200,clarificationPageView(await listClarifications(pool,session,Object.fromEntries(url.searchParams),repository),clientSessionContext(session).clientContext));
      }
      if(await handleStaffCaseRecordingRoute(req,res,session,path,url.searchParams,{
        list:(s,id,input)=>listStaffCaseRecordings(pool,s,id,input,repository),receipt:(s,id,requestId)=>staffCaseRecordingReceipt(pool,s,id,requestId,repository),
        receive:(s,id,requestId,language,bytes)=>receiveStaffCaseRecording(pool,s,id,requestId,language,bytes,storage,repository),
        audio:(s,id,requestId)=>getStaffCaseRecordingAudio(pool,s,id,requestId,storage,repository),
      }))return;
      const timeline=path.match(/^\/api\/clarifications\/([^/]+)\/timeline$/);
      if(timeline&&req.method==='GET'){
        if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid case timeline page');
        return send(res,200,{...await listCaseTimeline(pool,session,timeline[1],Object.fromEntries(url.searchParams),repository),clientContext:clientSessionContext(session).clientContext});
      }
      const caseAction=path.match(/^\/api\/clarifications\/([^/]+)\/actions\/([^/]+)$/);
      if(caseAction&&req.method==='GET'){
        if(url.search)throw Error('Invalid clarification action');
        return send(res,200,{...await clarificationActionReceipt(pool,session,caseAction[1],caseAction[2],repository),clientContext:clientSessionContext(session).clientContext});
      }
      const review=path.match(/^\/api\/clarifications\/([^/]+)\/reviews(?:\/([^/]+))?$/);
      if(review) {
        const [,id,requestId]=review,context=clientSessionContext(session).clientContext;
        if(requestId && req.method==='GET'){if(url.search)throw Error('Invalid case review');return send(res,200,{...await caseReviewReceipt(pool,session,id,requestId,repository),clientContext:context});}
        if(!requestId && req.method==='GET'){if(!url.search)return send(res,200,await listCaseReviews(pool,session,id,repository));if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid case workflow page');return send(res,200,{...await caseReviewPage(pool,session,id,Object.fromEntries(url.searchParams),repository),clientContext:context});}
        if(!requestId && req.method==='POST'){if(url.search)throw Error('Invalid case review');return send(res,200,{...await saveCaseReview(pool,session,id,await readJson(req),repository),clientContext:context});}
      }
      const repeat=path.match(/^\/api\/clarifications\/([^/]+)\/repeats(?:\/([^/]+))?$/);
      if(repeat) {
        const [,id,requestId]=repeat,context=clientSessionContext(session).clientContext;
        if(requestId && req.method==='GET'){if(url.search)throw Error('Invalid repeat request');return send(res,200,{...await caseRepeatReceipt(pool,session,id,requestId,repository),clientContext:context});}
        if(!requestId && req.method==='GET'){if(!url.search)return send(res,200,await listCaseRepeats(pool,session,id,repository));if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid case workflow page');return send(res,200,{...await caseRepeatPage(pool,session,id,Object.fromEntries(url.searchParams),repository),clientContext:context});}
        if(!requestId && req.method==='POST'){if(url.search)throw Error('Invalid repeat request');return send(res,200,{...await requestCaseRepeat(pool,session,id,await readJson(req),repository),clientContext:context});}
      }
      const followup=path.match(/^\/api\/clarifications\/([^/]+)\/followups(?:\/([^/]+))?$/);
      if(followup) {
        const [,id,receiptId]=followup;if(url.search)throw Error('Invalid conversation request');
        if(receiptId && req.method==='GET')return send(res,200,{...await followupReceipt(pool,session,id,receiptId,repository),clientContext:clientSessionContext(session).clientContext});
        if(!receiptId && req.method==='POST')return send(res,202,{...await queueCaseFollowup(pool,session,id,await readJson(req),{...repository,adapter:config.caseFollowupAdapter,dataClass:config.dataClass}),clientContext:clientSessionContext(session).clientContext});
      }
      const followupAudio=path.match(/^\/api\/clarifications\/([^/]+)\/messages\/([^/]+)\/audio$/);
      if(followupAudio && req.method==='GET') {
        if(url.search)throw Error('Invalid conversation request');
        const bytes=await getCaseFollowupAudio(pool,session,followupAudio[1],followupAudio[2],storage,repository);
        res.writeHead(200,{'content-type':'audio/wav','content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff'});return res.end(bytes);
      }
      const voiceAudio=path.match(/^\/api\/clarifications\/([^/]+)\/messages\/([^/]+)\/voice$/);
      if(voiceAudio && req.method==='GET') {
        if(url.search)throw Error('Invalid voice request');
        const bytes=await getCaseVoiceAudio(pool,session,voiceAudio[1],voiceAudio[2],storage,repository);
        res.writeHead(200,{'content-type':'audio/wav','content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});return res.end(bytes);
      }
      const voiceReply=path.match(/^\/api\/clarifications\/([^/]+)\/voice\/([^/]+)$/);
      if(voiceReply && ['GET','POST'].includes(req.method)) {
        if(url.search)throw Error('Invalid voice request');
        if(session.principal_type!=='worker')throw Error('Forbidden');
        const thread=await domainTransaction(pool,schema ?? 'public',client=>scopedCase(client,session,voiceReply[1]));
        const receipt=req.method==='GET'
          ?await caseVoiceReceipt(pool,session,thread.assignment_id,'reply',voiceReply[1],voiceReply[2],repository)
          :await receiveCaseVoice(pool,session,thread.assignment_id,'reply',voiceReply[1],voiceReply[2],await readAudio(req),storage,repository);
        return send(res,200,{...receipt,clientContext:clientSessionContext(session).clientContext});
      }
      const conversation=path.match(/^\/api\/clarifications\/([^/]+)\/messages(?:\/([^/]+))?$/);
      if(conversation) {
        const [,id,receiptId]=conversation;
        if(receiptId && req.method==='GET'){if(url.search)throw Error('Invalid conversation request');return send(res,200,{...await caseMessageReceiptLookup(pool,session,id,receiptId,repository),clientContext:clientSessionContext(session).clientContext});}
        if(!receiptId && req.method==='GET') {
          const thread=await listCaseMessages(pool,session,id,Object.fromEntries(url.searchParams),repository);
          return send(res,200,{...thread,caseId:id,clientContext:clientSessionContext(session).clientContext,canVoice:session.principal_type==='worker' && voiceAvailable && thread.canReply,canGenerate:session.principal_type==='staff' && ['synthetic','real'].includes(config.dataClass)
            && config.caseFollowupAdapter?.provenance?.dataClass===config.dataClass
            && !!config.caseFollowupAdapter?.capabilities?.speechLanguages.includes(thread.language)});
        }
        if(!receiptId && req.method==='POST'){if(url.search)throw Error('Invalid conversation request');return send(res,200,{...await sendCaseMessage(pool,session,id,await readJson(req),repository),clientContext:clientSessionContext(session).clientContext});}
      }
      const clarification=path.match(/^\/api\/clarifications\/([^/]+)(?:\/(resolve|assign))?$/);
      if (clarification) {
        const [,id,action]=clarification;
        if(url.search)throw Error('Invalid clarification filter');
        if (!action && req.method==='GET') return send(res,200,clarificationDetailView(await getClarification(pool,session,id,repository),clientSessionContext(session).clientContext));
        if (action==='resolve' && req.method==='POST') return send(res,200,{...await resolveClarification(pool,session,id,await readJson(req),repository),clientContext:clientSessionContext(session).clientContext});
        if (action==='assign' && req.method==='POST') return send(res,200,{...await assignClarification(pool,session,id,await readJson(req),repository),clientContext:clientSessionContext(session).clientContext});
      }
      if(path==='/api/people/crew-overview' && req.method==='GET') {
        try {
          if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)throw Error('Invalid crew overview request');
          return send(res,200,await siteCrewOverview(pool,session,Object.fromEntries(url.searchParams),repository));
        }catch(error){const failure=crewOverviewHttpError(error);return send(res,failure.status,{error:failure.message});}
      }
      if (path==='/api/people/workers') {
        if (req.method==='GET') return send(res,200,await listWorkers(pool,session,Object.fromEntries(url.searchParams),repository));
        if (req.method==='POST') return send(res,201,await createWorker(pool,session,await readJson(req),repository));
      }
      const workerAssignments=path.match(/^\/api\/people\/workers\/([^/]+)\/assignments$/);
      if(workerAssignments && req.method==='GET') return send(res,200,await staffWorkerAssignments(pool,session,workerAssignments[1],Object.fromEntries(url.searchParams),repository));
      const workerLanguageRequests=path.match(/^\/api\/people\/workers\/([^/]+)\/language-requests$/);
      if(workerLanguageRequests && req.method==='GET') {
        if(url.search)throw Error('Invalid language request');
        return send(res,200,await staffWorkerLanguageHistory(pool,session,workerLanguageRequests[1],repository));
      }
      if(path==='/api/people/language-requests' && req.method==='GET')
        return send(res,200,await listLanguageRequests(pool,session,Object.fromEntries(url.searchParams),repository));
      const languageDecision=path.match(/^\/api\/people\/language-requests\/([^/]+)\/decision$/);
      if(languageDecision && req.method==='POST') {
        if(url.search)throw Error('Invalid language decision');
        return send(res,200,await decideWorkerLanguageRequest(pool,session,languageDecision[1],await readJson(req),repository));
      }
      const workerAccess=path.match(/^\/api\/people\/workers\/([^/]+)\/access$/);
      if(workerAccess && req.method==='GET') return send(res,200,await listWorkerGrants(pool,session,workerAccess[1],Object.fromEntries(url.searchParams),repository));
      if (path==='/api/people/crews') {
        if (req.method==='GET') return send(res,200,await listCrews(pool,session,Object.fromEntries(url.searchParams),repository));
        if (req.method==='POST') return send(res,201,await createCrew(pool,session,await readJson(req),repository));
      }
      const crewRecipients=path.match(/^\/api\/people\/crews\/([^/]+)\/recipients$/);
      if(crewRecipients && req.method==='GET') {
        try {return send(res,200,await listCrewRecipients(pool,session,crewRecipients[1],Object.fromEntries(url.searchParams),repository));}
        catch(error) {
          const message=error.message,status=message==='Forbidden'?403:message==='Sign in required'?401:['Invalid input','Invalid crew','Crew unavailable','Crew recipient limit exceeded'].includes(message)?400:503;
          return send(res,status,{error:status===503?'Crew recipients unavailable':message});
        }
      }
      const crew=path.match(/^\/api\/people\/crews\/([^/]+)(?:\/(archive|restore))?$/);
      if(crew) {
        if(!crew[2] && req.method==='GET'){if(url.search)throw Error('Invalid crew request');return send(res,200,await getCrew(pool,session,decodeURIComponent(crew[1]),repository));}
        const [,id,action]=crew;
        if(!action && req.method==='PATCH') return send(res,200,await renameCrew(pool,session,id,await readJson(req),repository));
        if(action==='archive' && req.method==='POST') return send(res,200,await archiveCrew(pool,session,id,await readJson(req),repository));
        if(action==='restore' && req.method==='POST') return send(res,200,await restoreCrew(pool,session,id,await readJson(req),repository));
      }
      if (path==='/api/people/imports/preview' && req.method==='POST') {
        if (session.principal_type!=='staff' || !['owner','supervisor'].includes(session.role)) throw new Error('Forbidden');
        if (req.headers['content-type']?.split(';')[0].trim()!=='text/csv') throw new Error('Use text/csv for CSV upload');
        if ([...url.searchParams.keys()].some((key) => !['requestId','filename'].includes(key))) throw new Error('Invalid import request');
        return send(res,200,await previewWorkerImport(pool,session,{requestId:url.searchParams.get('requestId'),filename:url.searchParams.get('filename'),bytes:await readImportBytes(req)},repository));
      }
      const workerImport=path.match(/^\/api\/people\/imports\/([^/]+)(?:\/(confirm|errors.csv))?$/);
      if (workerImport) {
        const [,id,action]=workerImport;
        if (!action && req.method==='GET') return send(res,200,await getWorkerImport(pool,session,id,repository));
        if (action==='confirm' && req.method==='POST') {
          if (Object.keys(await readJson(req)).length) throw new Error('Invalid import confirmation');
          return send(res,200,await confirmWorkerImport(pool,session,id,repository));
        }
        if (action==='errors.csv' && req.method==='GET') {
          const csv=await workerImportErrorsCsv(pool,session,id,repository);
          res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="worker-import-errors.csv"','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
          res.end(csv); return;
        }
      }
      const person=path.match(/^\/api\/people\/workers\/([^/]+)(?:\/(disable|reenable|crew|deletion))?$/);
      if (person) {
        const [,id,action]=person;
        if (!action && req.method==='PATCH') return send(res,200,await updateWorker(pool,session,id,await readJson(req),repository));
        if (action==='disable' && req.method==='POST') return send(res,200,await disableWorker(pool,session,id,repository));
        if (action==='reenable' && req.method==='POST') return send(res,200,await reenableWorker(pool,session,id,await readJson(req),repository));
        if(action==='deletion'){
          if(url.search)throw new Error('Invalid deletion request');
          if(req.method==='GET')return send(res,200,await getWorkerDeletion(pool,session,id,repository));
          if(req.method==='POST')return send(res,200,await requestWorkerDeletion(pool,session,id,await readJson(req),repository));
        }
        if (action==='crew' && req.method==='POST') {
          const body=await readJson(req);
          if (Object.keys(body).some((key) => key!=='crewId')) throw new Error('Invalid input');
          return send(res,200,await moveWorkerToCrew(pool,session,id,body.crewId,repository));
        }
      }
      if (path==='/api/briefings') {
        if (req.method==='GET') return send(res,200,await listBriefings(pool,session,Object.fromEntries(url.searchParams),repository));
        if (req.method==='POST') {
          const result=await createDraft(pool,session,await readJson(req),repository);
          return send(res,result.duplicate ? 200 : 201,result);
        }
      }
      const responses=path.match(/^\/api\/publications\/([^/]+)\/responses(?:\/([^/]+))?$/);
      if(responses && req.method==='GET') return send(res,200,responses[2]
        ? await getPublicationResponse(pool,session,responses[1],responses[2],Object.fromEntries(url.searchParams),repository)
        : await listPublicationResponses(pool,session,responses[1],Object.fromEntries(url.searchParams),repository));
      const artifactSpeech=path.match(/^\/api\/briefings\/([^/]+)\/artifacts\/(draft|publication)\/([^/]+)\/(en|ar|ur)\/(body|question)$/);
      if(artifactSpeech && req.method==='GET') {
        if(url.search) throw Error('Artifact audio unavailable');
        const bytes=await getStaffArtifactSpeech(pool,session,...artifactSpeech.slice(1),storage,repository);
        res.writeHead(200,{'content-type':'audio/wav','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
        res.end(bytes);return;
      }
      const draftCreationRoute=path.match(/^\/api\/draft-creation-receipts\/([^/]+)$/);
      if(draftCreationRoute && req.method==='GET') {
        if(url.search) throw Error('Invalid draft creation receipt request');
        return send(res,200,await draftCreationReceipt(pool,session,decodeURIComponent(draftCreationRoute[1]),repository));
      }
      const publicationReceiptRoute=path.match(/^\/api\/briefings\/([^/]+)\/publication-receipts\/([^/]+)\/([^/]+)$/);
      if(publicationReceiptRoute && req.method==='GET') {
        if(url.search)throw Error('Invalid publication receipt request');
        return send(res,200,await publicationReceipt(pool,session,...publicationReceiptRoute.slice(1).map(decodeURIComponent),repository));
      }
      const scheduleRoute=path.match(/^\/api\/briefings\/([^/]+)\/schedules(?:\/([^/]+)\/cancel)?$/);
      if(scheduleRoute) {
        const [,id,scheduleId]=scheduleRoute;
        if(req.method==='GET' && !scheduleId)return send(res,200,await listSchedules(pool,session,id,Object.fromEntries(url.searchParams),repository));
        if(req.method==='POST') {
          if(url.search)throw Error('Invalid publication schedule');
          if(scheduleId)return send(res,200,await cancelSchedule(pool,session,id,scheduleId,await readJson(req),repository));
          const result=await createSchedule(pool,session,id,await readJson(req,600000),{...repository,storage});return send(res,result.duplicate?200:202,result);
        }
      }
      const publicationHistoryRoute=path.match(/^\/api\/briefings\/([^/]+)\/publications(?:\/([^/]+))?$/);
      if(publicationHistoryRoute && req.method==='GET') {
        const [,briefingId,publicationId]=publicationHistoryRoute.map(value=>value?decodeURIComponent(value):value);
        const input=publicationHistoryQuery(url.searchParams,!!publicationId);
        return send(res,200,publicationId?await getPublicationHistoryDetail(pool,session,briefingId,publicationId,repository):await listPublicationHistory(pool,session,briefingId,input,repository));
      }
      const briefing=path.match(/^\/api\/briefings\/([^/]+)(?:\/(process|publish|withdraw|copy|archive|review|regenerate))?$/);
      if (briefing) {
        const [,id,action]=briefing;
        if (!action && req.method==='GET') return send(res,200,await getBriefing(pool,session,id,repository));
        if (!action && req.method==='PATCH') return send(res,200,await editDraft(pool,session,id,await readJson(req),repository));
        if(action==='review' && req.method==='POST') {if(url.search) throw new Error('Invalid draft review request');return send(res,200,await saveDraftReview(pool,session,id,await readJson(req,100000),repository));}
        if(action==='regenerate' && req.method==='POST') {if(url.search) throw new Error('Invalid regeneration request');return send(res,200,await regenerateDraftTarget(pool,session,id,await readJson(req),repository));}
        if(action==='copy' && req.method==='POST') {
          const result=await copyDraft(pool,session,id,await readJson(req),repository);
          return send(res,result.duplicate ? 200 : 201,result);
        }
        if (action==='process' && req.method==='POST') {
          const body=await readJson(req);
          if (Object.keys(body).some((key) => key!=='revision')) throw new Error('Invalid draft request');
          return send(res,202,await queuePreparation(pool,session,id,body.revision,repository));
        }
        if (action==='publish' && req.method==='POST') {
          const result=await publish(pool,session,id,await readJson(req,600000),{...repository,storage});
          return send(res,result.duplicate ? 200 : 201,result);
        }
        if (action==='withdraw' && req.method==='POST') return send(res,200,await withdrawPublication(pool,session,id,await readJson(req),repository));
        if (action==='archive' && req.method==='POST') return send(res,200,await archiveBriefing(pool,session,id,await readJson(req),repository));
      }
      if(path==='/api/reports/publications' && req.method==='GET')return send(res,200,await listReportPublications(pool,session,Object.fromEntries(url.searchParams),repository));
      if (path==='/api/reports' && req.method==='GET') {
        const {publicationId,...filters}=Object.fromEntries(url.searchParams);
        return send(res,200,await readPublicationReport(pool,session,{...repository,...(publicationId!==undefined?{publicationId}:{}),filters}));
      }
      if (path==='/api/reports/exports') {
        if(url.search)throw Error('Invalid export request');
        if (req.method==='GET') return send(res,200,await listExports(pool,session,repository));
        if (req.method==='POST') return send(res,202,await requestExport(pool,session,await readJson(req),repository));
      }
      const exportReceiptMatch=path.match(/^\/api\/reports\/exports\/receipts\/(create|retry)\/([^/]+)$/);
      if(exportReceiptMatch && req.method==='GET') {
        if(url.search)throw Error('Invalid export request');return send(res,200,await exportReceipt(pool,session,exportReceiptMatch[1],exportReceiptMatch[2],repository));
      }
      const reportExport=path.match(/^\/api\/reports\/exports\/([^/]+)\/(download|retry)$/);
      if (reportExport) {
        const [,id,action]=reportExport;
        if (action==='retry' && req.method==='POST') {if(url.search)throw Error('Invalid export request');return send(res,202,await retryExport(pool,session,id,await readJson(req),repository));}
        if (action==='download' && req.method==='GET') {
          const file=await downloadExport(pool,session,id,repository);
          res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${file.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
          res.end(file.csv); return;
        }
      }
      if (path==='/api/worker/language' && req.method==='GET') {
        if(session.principal_type!=='worker')throw Error('Forbidden');
        if(url.search)throw Error('Invalid language request');
        return send(res,200,{...await workerLanguageState(pool,session,repository),...await workerLanguageHistory(pool,session,repository)});
      }
      if (path==='/api/worker/language/selection' && req.method==='POST') {
        if(url.search)throw Error('Invalid language selection');
        return send(res,200,await selectWorkerLanguage(pool,session,await readJson(req),repository));
      }
      if (path==='/api/worker/language/requests' && req.method==='POST') {
        if(url.search)throw Error('Invalid language request');
        return send(res,200,await requestWorkerLanguage(pool,session,await readJson(req),repository));
      }
      if (path==='/api/worker/briefings' && req.method==='GET') return send(res,200,await workerBriefings(pool,session,repository,Object.fromEntries(url.searchParams)));
      if (path==='/api/worker/history' && req.method==='GET') return send(res,200,await workerBriefings(pool,session,{...repository,history:true},Object.fromEntries(url.searchParams)));
      const speech=path.match(/^\/api\/worker\/briefings\/([^/]+)\/speech\/(body|question)$/);
      if(speech && req.method==='GET') {
        if(url.searchParams.size) throw Error('Assignment unavailable');
        const bytes=await getAssignmentSpeech(pool,session,speech[1],speech[2],storage,repository);
        sendPrivateWav(req,res,bytes);return;
      }
      const receiptMatch=path.match(/^\/api\/worker\/briefings\/([^/]+)\/receipts\/([^/]+)\/([^/]+)$/);
      if(receiptMatch && req.method==='GET'){
        if(url.search)throw Error('Invalid response filter');
        const [,assignmentId,kind,requestId]=receiptMatch;
        return send(res,200,{...await workerRequestReceipt(pool,session,assignmentId,kind,requestId,repository),assignmentId,requestId,clientContext:clientSessionContext(session).clientContext});
      }
      const voiceHelp=path.match(/^\/api\/worker\/briefings\/([^/]+)\/help-audio\/([^/]+)$/);
      if(voiceHelp && ['GET','POST'].includes(req.method)) {
        if(url.search)throw Error('Invalid voice request');
        const receipt=req.method==='GET'
          ?await caseVoiceReceipt(pool,session,voiceHelp[1],'help',voiceHelp[2],voiceHelp[2],repository)
          :await receiveCaseVoice(pool,session,voiceHelp[1],'help',voiceHelp[2],voiceHelp[2],await readAudio(req),storage,repository);
        return send(res,200,{...receipt,clientContext:clientSessionContext(session).clientContext});
      }
      const helpHistory=path.match(/^\/api\/worker\/briefings\/([^/]+)\/help-history$/);
      if(helpHistory&&req.method==='GET')return send(res,200,{...await workerHelpHistory(pool,session,helpHistory[1],Object.fromEntries(url.searchParams),repository),clientContext:clientSessionContext(session).clientContext});
      const exactSubmission=path.match(/^\/api\/worker\/briefings\/([^/]+)\/submissions\/([^/]+)$/);
      if(exactSubmission&&req.method==='GET')return send(res,200,{...await workerSubmission(pool,session,exactSubmission[1],exactSubmission[2],Object.fromEntries(url.searchParams),repository),clientContext:clientSessionContext(session).clientContext});
      const assignment=path.match(/^\/api\/worker\/briefings\/([^/]+)(?:\/(answers|audio|help|submissions|acknowledge|presentations))?$/);
      if (assignment) {
        const [,id,action]=assignment;
        if(action==='acknowledge' && req.method==='POST') {
          const body=await readJson(req),result=await acknowledgeAssignment(pool,session,id,body.requestId,repository);
          return send(res,result.duplicate?200:201,{...result,assignmentId:id,requestId:body.requestId,clientContext:clientSessionContext(session).clientContext});
        }
        if(action==='submissions' && req.method==='GET') return send(res,200,{...await workerSubmissions(pool,session,id,Object.fromEntries(url.searchParams),repository),clientContext:clientSessionContext(session).clientContext});
        if(action==='presentations' && req.method==='GET'){
          if(url.search)throw Error('Invalid presentation request');
          return send(res,200,{...await listPresentations(pool,session,id,repository),clientContext:clientSessionContext(session).clientContext});
        }
        if(action==='presentations' && req.method==='POST'){
          if(url.search)throw Error('Invalid presentation request');
          const body=await readJson(req);
          return send(res,200,{...await createPresentation(pool,session,id,body,
            {schema,queueGeneration:config.integrationMode==='live',translator:presentationTranslator,generationAllowed:presentationGenerationAllowed}),clientContext:clientSessionContext(session).clientContext});
        }
        if (!action && req.method==='GET') return send(res,200,{...await workerBriefing(pool,session,id,repository),canVoiceHelp:voiceAvailable});
        if (action==='help' && req.method==='GET') return send(res,200,await workerHelpCases(pool,session,id,repository));
        if (action==='help' && req.method==='POST') {
          const body=await readJson(req),result=await requestHelp(pool,session,id,body,repository);
          return send(res,result.duplicate ? 200 : 201,{...result,assignmentId:id,requestId:body.requestId,clientContext:clientSessionContext(session).clientContext});
        }
        if (action==='answers' && req.method==='POST') {
          const body=await readJson(req),result=await submitAnswer(pool,session,id,body.submissionId,body.text,{...repository,presentationId:body.presentationId ?? null});
          return send(res,result.duplicate ? 200 : 201,{...result,assignmentId:id,requestId:body.submissionId,clientContext:clientSessionContext(session).clientContext});
        }
        if (action==='audio' && req.method==='POST') {
          if (!storage) return send(res,503,{error:'Private storage unavailable'});
          const header=req.headers['x-presentation-id'];
          if(Array.isArray(header))throw Error('Presentation unavailable');
          const presentationId=typeof header==='string'&&header?header:null;
          const result=await receiveRecording(pool,session,id,req.headers['x-submission-id'],await readAudio(req),storage,
            {...repository,presentationId});
          return send(res,result.duplicate ? 200 : 201,{...result,assignmentId:id,requestId:req.headers['x-submission-id'],clientContext:clientSessionContext(session).clientContext});
        }
      }
      const recording=path.match(/^\/api\/recordings\/([^/]+)(?:\/(audio))?$/);
      if (recording && req.method==='GET') {
        if (recording[2]) {
          const bytes=await getRecordingAudio(pool,session,recording[1],storage,repository);
          sendPrivateWav(req,res,bytes);return;
        }
        return send(res,200,await getRecording(pool,session,recording[1],repository));
      }
      return send(res,404,{error:'Not found'});
    } catch (error) {
      if(requestPath.startsWith('/api/clarification-creations')||/^\/api\/clarifications(?:\/[^/]+(?:\/(?:timeline|resolve|assign|actions\/[^/]+))?)?$/.test(requestPath)){if(res.headersSent){res.destroy();return;}const result=clarificationHttpError(error);return send(res,result.status,{error:result.error});}
      if(error?.message==='Invalid help history request' || error?.message==='Invalid case workflow page')return send(res,400,{error:error.message});
      if(error?.message==='Session context changed'){if(res.headersSent){res.destroy();return;}return send(res,409,{error:error.message});}
      if(['Worker access paused','Site archived'].includes(error?.message))return send(res,403,{error:error.message});
      if(requestPath.startsWith('/api/settings/sites')) {const result=siteHttpError(error);return send(res,result.status,{error:result.error});}
      if(/\/draft-creation-receipts\//.test(requestPath)) {const {status,error:message}=draftCreationHttpError(error);return send(res,status,{error:message});}
      if(/\/publication-receipts\//.test(requestPath)) {const {status,error:message}=publicationReceiptHttpError(error);return send(res,status,{error:message});}
      if(/\/schedules(?:\/|$)/.test(requestPath)) {const {status,error:message}=scheduleHttpError(error);return send(res,status,{error:message});}
      const message=error?.message;
      if (res.headersSent) {res.destroy(); return;}
      if(requestPath==='/api/onboarding/first-run') {
        if(message==='Invalid onboarding input') return send(res,400,{error:message});
        if(message==='Onboarding already completed') return send(res,409,{error:message});
        if(message==='Onboarding unavailable') return send(res,404,{error:message});
      }
      if(requestPath.startsWith('/api/auth/registrations')) {
        if(message==='Email delivery unavailable') return send(res,503,{error:message});
        if(['Invalid registration input','Registration verification unavailable'].includes(message)) return send(res,400,{error:message});
        return send(res,503,{error:'Registration unavailable. Check the service before retrying.'});
      }
      if(requestPath==='/api/auth/worker/redemption' && !['Sign in required','Forbidden','Forbidden origin','Session context changed','Workspace access paused','Worker access paused','Site archived','Invalid worker redemption check'].includes(message))return send(res,503,{error:'Worker access check unavailable.'});
      if(message==='Invalid worker redemption check')return send(res,400,{error:message});
      if (['Sign in required','Invalid credentials','Invalid or expired setup code','Sign in to accept this invitation','Sign out before creating an account'].includes(message)) return send(res,401,{error:message});
      if (message==='Forbidden' || message==='Forbidden origin' || message==='Forbidden transport' || message==='Workspace access paused' || message==='Workspace is read-only') return send(res,403,{error:message});
      if(['Invalid publication history request','Invalid report publication filter','Invalid report publication date','Report publication history exceeds limit; narrow the search or dates'].includes(message))return send(res,400,{error:message});
      if (message==='Email delivery unavailable') return send(res,503,{error:message});
      if(['Follow-up translation unavailable','Follow-up generation unavailable','Follow-up language unavailable'].includes(message))return send(res,503,{error:message});
      if (unavailable.has(message)) return send(res,404,{error:message});
      if (typeof message==='string' && message.startsWith('Worker capacity reached')) return send(res,409,{error:message});
      if (conflicts.has(message)) return send(res,409,{error:message});
      if (badInput.has(message) || /^Recipient language is unavailable: (?:unknown|[A-Z]{2}(?:-[A-Z]+)?(?:, [A-Z]{2}(?:-[A-Z]+)?)*)$/.test(message)) return send(res,['Request too large','Recording is too large','CSV exceeds 256 KiB limit'].includes(message) ? 413 : 400,{error:message});
      return send(res,503,{error:'Operation unavailable. Retry after checking the service.'});
    }
  };
}
