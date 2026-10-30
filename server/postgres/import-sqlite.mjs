import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {checkedPresentationChoices} from '../presentation-choice-input.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyLocalBackup } from '../../scripts/local-backup.mjs';
import { createPostgresPool, acquirePostgresClient } from './db.mjs';
import { runMigrations, schemaName } from './migrate.mjs';
import {validateImportedCaseVoice,normalizeImportedCaseVoice} from './staff-case-recording-import.mjs';
import {isWorkerLanguage} from '../languages.mjs';
import {inspectCaseWorkflowRuntimeGuards} from './case-workflow-permissions.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = {
  pilot_inquiries:'id receipt_hash request_hash content_json destination state created_at expires_at next_at attempts lease_token lease_until provider_id',
  organizations: 'id name', sites: 'id org_id name timezone', staff: 'id org_id site_id name role active',
  staff_accounts:'id credential_staff_id active revision',staff_account_memberships:'staff_id account_id org_id site_id',
  staff_invitations:'id org_id site_id name role email_hash email_hint email_payload issuer_id issuer_revision issuer_account_revision state revision created_at expires_at',
  staff_invitation_tokens:'token_hash invitation_id generation expires_at used_at revoked_at',
  staff_invitation_mail:'id invitation_id generation payload created_at expires_at next_at state attempts lease_token lease_until provider_id',
  staff_invitation_requests:'request_id org_id site_id invitation_id action request_json result_json created_by created_at',
  staff_invitation_acceptances:'token_hash request_id account_id staff_id org_id site_id kind created_at',
  workers: 'id org_id site_id code language active', crews: 'id org_id site_id name active',
  crew_memberships: 'worker_id org_id site_id crew_id joined_at',
  briefings: 'id org_id site_id title source revision next_version state prepared_json created_at updated_at',
  draft_creations:'request_id org_id site_id briefing_id request_hash requested_by occurred_at',
  source_audio_requests:'request_id org_id site_id requested_by request_hash title generation_languages_json id sha256 bytes duration_seconds original_id original_sha256 original_bytes original_type authority_json status created_at received_at briefing_id lease_token lease_until error attempts retry_at',
  publications: 'id org_id site_id briefing_id version snapshot_json published_at state',
  assignments: 'id org_id site_id publication_id worker_id due_at created_at',
  presentation_artifacts: 'id org_id site_id worker_id assignment_id publication_id publication_version source_kind source_id original_language target_language source_hash status title text question provider live error_code lease_token lease_until created_at updated_at ready_at',
  publication_report_audience:'assignment_id org_id site_id publication_id crew_id crew_name',
  assignment_reminders:'assignment_id org_id site_id publication_id worker_id requested_by authority_json due_at state finished_at',
  attempts: 'id org_id assignment_id submission_id answer_text outcome reasons_json received_at',
  answer_presentation_bindings: 'attempt_id org_id site_id assignment_id presentation_id presentation_language presented_question created_at',
  clarifications: 'id org_id assignment_id attempt_id reason owner_staff_id status notes created_at',
  jobs: 'id org_id site_id briefing_id revision kind status attempts due_at lease_until error created_at',
  preparation_requests:'request_id org_id site_id briefing_id revision job_id generation request_json requested_by created_at',
  worker_grants: 'id org_id site_id worker_id token_hash expires_at redeemed_at revoked_at created_at',
  worker_credentials: 'worker_id org_id site_id login_id state password_salt password_hash credential_revision setup_issued_at password_changed_at created_at updated_at',
  worker_setup_tokens: 'id org_id site_id worker_id token_hash expires_at used_at revoked_at created_by created_at',
  sessions: 'token_hash org_id site_id principal_type principal_id expires_at revoked_at grant_id access_mode',
  audit: 'id org_id site_id actor_type actor_id action object_id occurred_at',
  notification_reads:'event_id staff_id org_id site_id read_at',
  notification_events:'id org_id site_id audience recipient_id kind object_type object_id dedupe_key created_at',
  notification_event_reads:'event_id principal_type principal_id org_id site_id read_at',
  recordings: 'id org_id site_id assignment_id submission_id sha256 duration_seconds bytes status transcript error created_at attempts lease_until retry_at received_at lease_token',
  processing_retries:'request_id org_id site_id requested_by kind job_id publication_id assignment_id generation request_json created_at',
  submission_receipts: 'sequence org_id assignment_id submission_id kind received_at',
  report_exports: 'id org_id site_id publication_id requested_by created_at expires_at status snapshot_json csv checksum attempts lease_token lease_until error',
  report_export_retries:'request_id org_id site_id export_id requested_by attempts created_at',
  worker_imports: 'id org_id site_id requested_by filename sha256 status rows_json errors_json created_at expires_at imported_count',
  help_requests: 'case_id org_id site_id assignment_id text created_at',
  case_messages:'id org_id site_id case_id assignment_id actor_type actor_id language text request_hash created_at',
  case_voice:'id request_id org_id site_id assignment_id worker_id kind requested_case_id case_id language sha256 bytes duration_seconds status created_at received_at lease_token lease_until cleanup_state cleanup_token cleanup_until cleanup_checked_at actor_type actor_id actor_role',
  clarification_action_receipts:'request_id org_id site_id case_id actor_id actor_role kind request_hash effect result_status result_owner_id reason_code created_at',
  clarification_creations:'request_id org_id site_id case_id assignment_id publication_id publication_version attempt_id actor_id actor_role request_hash created_at',
  publication_requests: 'request_id org_id site_id briefing_id publication_id request_json',
  publication_schedules:'id org_id site_id briefing_id request_json snapshot_hash recipients_json requested_by authority_json publish_at created_at state publication_id error finished_at attempts retry_at',
  publication_withdrawals: 'request_id org_id site_id publication_id version reason withdrawn_by occurred_at',
  directory_reactivations: 'request_id org_id site_id worker_id crew_id expected_label requested_by occurred_at',
  briefing_copies: 'request_id org_id site_id source_briefing_id source_revision copy_briefing_id title requested_by occurred_at',
  briefing_archives: 'request_id org_id site_id briefing_id request_json publication_ids_json archived_by occurred_at',
  invoices:'id org_id site_id number description issue_date due_date amount_cents currency request_json created_by created_at issuer_name site_name',
  invoice_payments:'id org_id site_id invoice_id amount_cents payment_date reference note request_json recorded_by recorded_at',
  invoice_voids:'id org_id site_id invoice_id reason request_json created_by created_at',
  organization_settings:'org_id revision support_email',
  site_settings:'site_id org_id revision',
  settings_requests:'id org_id site_id kind request_json revision created_by created_at',
  recording_notices:'site_id org_id revision notices_json updated_at',
  recording_notice_requests:'id org_id site_id actor_id request_json revision created_at',
  retention_policies:'site_id org_id revision audio_days updated_at',
  retention_requests:'id org_id site_id actor_id request_json revision created_at',
  worker_deletion_requests:'id org_id site_id worker_id actor_id fingerprint reason created_at',
  worker_deletion_redactions:'request_id org_id site_id worker_id completed_at',
  worker_deletion_pseudonyms:'request_id org_id site_id worker_id code_hash pseudonym completed_at',
  worker_deletion_completions:'request_id org_id site_id worker_id completed_at',
  recording_purges:'recording_id org_id site_id status created_at completed_at attempts lease_token lease_until retry_at error',
  source_audio_purges:'request_id org_id site_id reason status created_at completed_at verified_at attempts lease_token lease_until retry_at error',
  source_audio_retries:'retry_id source_request_id org_id site_id requested_by source_hash created_at',
  draft_reviews:'briefing_id org_id site_id content_json',
  briefing_review_requests:'request_id org_id site_id briefing_id accepted_revision request_json requested_by occurred_at',
  briefing_language_requests:'request_id org_id site_id briefing_id accepted_revision request_json requested_by occurred_at',
  site_onboarding:'site_id org_id revision step first_briefing_id technical_json updated_at',
  onboarding_requests:'request_id org_id site_id request_json revision requested_by occurred_at',
  site_creations:'request_id org_id origin_site_id site_id created_by owner_id request_json created_at',
  site_access_controls:'site_id org_id revision state reason updated_at',
  site_access_requests:'request_id org_id origin_site_id site_id actor_id request_json revision created_at',
  templates:'id org_id site_id revision status created_at updated_at',
  template_versions:'template_id org_id site_id revision status content_json created_by created_at',
  template_requests:'request_id org_id site_id template_id briefing_id request_json result_json created_by created_at',
  glossary_terms:'id org_id site_id term term_key source_lang target_lang revision status created_at updated_at',
  glossary_versions:'term_id org_id site_id revision status content_json created_by created_at',
  glossary_requests:'request_id org_id site_id term_id request_json result_json created_by created_at',
  staff_access_revisions:'staff_id org_id site_id revision',
  staff_access_requests:'request_id org_id site_id staff_id action request_json result_json created_by created_at',
  case_routing:'case_id org_id site_id routed_owner_id due_at created_at manual escalated_at',
  // Restore the freeze policy only after all retained operational history is imported.
  site_lifecycle:'site_id org_id revision state reason updated_at',
  site_lifecycle_requests:'request_id org_id origin_site_id site_id actor_id request_json revision created_at',
  instruction_compositions:'id org_id site_id staff_id content_json updated_at',
  instruction_attachments:'id request_id org_id site_id staff_id name mime bytes data_base64 created_at',
  assignment_completions:'assignment_id org_id site_id worker_id completed_at',
  instruction_sends:'request_id org_id site_id briefing_id publication_request_id audience_json response_mode delivery_mode state publication_id audience_count delivered undelivered undelivered_json error request_json requested_by created_at updated_at',
  instruction_deliveries:'request_id org_id site_id worker_id language state reason attempts assignment_id content_json content_hash updated_at',
  instruction_retries:'request_id send_request_id org_id site_id requested_by generation request_json created_at',
  acknowledgments:'request_id org_id site_id assignment_id worker_id received_at',
  worker_language_requests:'id org_id site_id worker_id current_language requested_language reason state requested_at decided_at decided_by decision_note',
  organization_entitlements:'org_id state started_at ends_at worker_limit plan terms_reference revision updated_by updated_at',
  organization_entitlement_transitions:'org_id revision state started_at ends_at worker_limit plan terms_reference reason actor_type actor_id request_id created_at',
  organization_activation_requests:'request_id org_id site_id requested_by note entitlement_revision state created_at decided_at decided_by decision_ref',
};
const tables = Object.keys(columns);
const omitted = ['staff_credentials', 'auth_attempts', 'push_subscriptions', 'push_deliveries'];
// Local credentials are not migrated, so their recovery secrets and pending delivery must not be replayed either.
const sourceOnlyAuth = ['staff_recovery_mail', 'staff_recovery_tokens', 'organization_registrations', 'registration_mail', 'registration_tokens'];
const optional = new Set(['organization_settings','site_settings','settings_requests','invoices','invoice_payments','invoice_voids','crews','crew_memberships','report_exports','worker_imports','recordings','help_requests','publication_requests','publication_withdrawals','directory_reactivations','briefing_copies','briefing_archives']);
optional.add('draft_reviews');optional.add('briefing_review_requests');
optional.add('report_export_retries');
optional.add('preparation_requests');
optional.add('processing_retries');
optional.add('publication_report_audience');
optional.add('briefing_language_requests');
optional.add('pilot_inquiries');
optional.add('site_onboarding');optional.add('onboarding_requests');
optional.add('site_creations');
optional.add('site_access_controls');optional.add('site_access_requests');
optional.add('site_lifecycle');optional.add('site_lifecycle_requests');
optional.add('case_routing');
optional.add('case_messages');
optional.add('case_voice');
optional.add('clarification_action_receipts');
optional.add('clarification_creations');
optional.add('recording_notices');optional.add('recording_notice_requests');
optional.add('notification_reads');
optional.add('notification_events');optional.add('notification_event_reads');
optional.add('publication_schedules');
optional.add('assignment_reminders');
optional.add('draft_creations');
optional.add('source_audio_requests');
for(const table of ['retention_policies','retention_requests','recording_purges','source_audio_purges','source_audio_retries','worker_deletion_requests','worker_deletion_redactions','worker_deletion_pseudonyms','worker_deletion_completions'])optional.add(table);
for(const table of ['templates','template_versions','template_requests']) optional.add(table);
for(const table of ['glossary_terms','glossary_versions','glossary_requests']) optional.add(table);
for(const table of ['staff_access_revisions','staff_access_requests']) optional.add(table);
for(const table of ['staff_accounts','staff_account_memberships']) optional.add(table);
for(const table of ['staff_invitations','staff_invitation_tokens','staff_invitation_mail','staff_invitation_requests','staff_invitation_acceptances']) optional.add(table);
optional.add('instruction_compositions');optional.add('instruction_attachments');optional.add('assignment_completions');
optional.add('instruction_sends');optional.add('instruction_deliveries');optional.add('instruction_retries');optional.add('acknowledgments');
optional.add('worker_language_requests');
optional.add('organization_entitlements');optional.add('organization_entitlement_transitions');optional.add('organization_activation_requests');
optional.add('worker_credentials');optional.add('worker_setup_tokens');
optional.add('presentation_artifacts');optional.add('answer_presentation_bindings');

function snapshotRows(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name));
    if ([...present].some((table) => !tables.includes(table) && !omitted.includes(table) && !sourceOnlyAuth.includes(table))) throw new Error('Unsupported source schema');
    const result = {}; let total = 0;
    for (const table of tables) {
      if (!present.has(table)) {
        if (!optional.has(table)) throw new Error('Source schema is not current');
        result[table] = []; continue;
      }
      const fields = columns[table].split(' ');
      const actual = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
      if (table === 'workers') for (const field of ['name','language_selection_required','language_selected_at','language_selected_by','language_selection_request_id'])
        if (actual.includes(field)) fields.push(field);
      if (table === 'assignments' && actual.includes('language')) fields.push('language');
      if (table === 'sessions' && actual.includes('credential_revision')) fields.push('credential_revision');
      if (table === 'worker_imports' && actual.includes('filename_hash')) fields.push('filename_hash');
      if (table === 'site_settings' && actual.includes('generation_languages_json')) fields.push('generation_languages_json');
      if(table==='site_settings')for(const field of ['primary_contact_id','deputy_contact_id'])if(actual.includes(field))fields.push(field);
      if(table==='site_settings')for(const field of ['staff_interface_language','first_run_completed_at'])if(actual.includes(field))fields.push(field);
      if (table === 'draft_creations' && actual.includes('generation_languages_json')) fields.push('generation_languages_json');
      if(table==='report_exports' && actual.includes('filters_json'))fields.push('filters_json');
      if(table==='recordings')for(const field of ['presentation_id','presentation_language','presented_question'])if(actual.includes(field))fields.push(field);
      if(table==='presentation_artifacts' && actual.includes('choices_json'))fields.push('choices_json');
      if (actual.length !== fields.length || actual.some((field) => !fields.includes(field))) throw new Error('Unsupported source columns');
      result[table] = db.prepare(`SELECT ${fields.join(',')} FROM ${table} LIMIT 100001`).all();
      total += result[table].length;
      if (total > 100_000) throw new Error('Synthetic migration row limit exceeded');
    }
    const assignments = new Map(result.assignments.map((row) => [row.id, row]));
    const workers = new Map(result.workers.map((row) => [row.id,row]));
    for (const worker of result.workers) if (!isWorkerLanguage(worker.language)) throw new Error('Invalid source worker language');
    const publications = new Map(result.publications.map((row) => [row.id,row]));
    for (const row of result.assignments) {
      const worker=workers.get(row.worker_id);
      if (!worker || worker.org_id!==row.org_id || worker.site_id!==row.site_id) throw new Error('Source scope mismatch');
      row.language ||= worker.language;
      const publication=publications.get(row.publication_id);
      if (!publication || publication.org_id!==row.org_id || publication.site_id!==row.site_id) throw new Error('Source scope mismatch');
      const languages=JSON.parse(publication.snapshot_json).languages;
      if (!isWorkerLanguage(row.language) || !languages?.[row.language]) throw new Error('Source assignment language unavailable');
    }
    for (const table of ['attempts', 'clarifications']) for (const row of result[table]) {
      const assignment = assignments.get(row.assignment_id);
      if (!assignment || assignment.org_id !== row.org_id) throw new Error('Source scope mismatch');
      row.site_id = assignment.site_id;
    }
    const receiptKeys = new Set(result.submission_receipts.map((row) => `${row.assignment_id}\0${row.submission_id}`));
    for (const row of [...result.attempts, ...result.recordings.filter((row) => row.received_at)]) {
      if (!receiptKeys.has(`${row.assignment_id}\0${row.submission_id}`)) throw new Error('Missing source submission receipt');
    }
    for (const row of result.acknowledgments) {
      const assignment = assignments.get(row.assignment_id);
      if (!assignment || assignment.org_id !== row.org_id || assignment.site_id !== row.site_id || assignment.worker_id !== row.worker_id) throw new Error('Source scope mismatch');
    }
    const staffIds = new Set(result.staff.map((row) => row.id));
    for (const row of result.worker_language_requests) {
      const worker=workers.get(row.worker_id);
      if(!worker || worker.org_id!==row.org_id || worker.site_id!==row.site_id) throw new Error('Source scope mismatch');
      if(!isWorkerLanguage(row.current_language) || !isWorkerLanguage(row.requested_language)
        || row.current_language===row.requested_language) throw new Error('Invalid source language request');
      if(!['pending','approved','rejected'].includes(row.state) || typeof row.reason!=='string' || row.reason.length>500)
        throw new Error('Invalid source language request');
      const pending=row.state==='pending';
      if(pending ? (row.decided_at!=null || row.decided_by!=null || row.decision_note!=null)
        : (!row.decided_at || !row.decided_by || !staffIds.has(row.decided_by))) throw new Error('Invalid source language decision');
    }
    const briefings = new Map(result.briefings.map((row) => [row.id, row]));
    const sends = new Map(result.instruction_sends.map((row) => [row.request_id, row]));
    for (const row of result.instruction_sends) {
      const briefing = briefings.get(row.briefing_id);
      if (!briefing || briefing.org_id !== row.org_id || briefing.site_id !== row.site_id) throw new Error('Source scope mismatch');
      if (row.publication_id) {
        const publication = publications.get(row.publication_id);
        if (!publication || publication.org_id !== row.org_id || publication.site_id !== row.site_id || publication.briefing_id !== row.briefing_id) throw new Error('Source scope mismatch');
      }
      if (!['question','acknowledge'].includes(row.response_mode) || !['text','voice','both'].includes(row.delivery_mode)) throw new Error('Unsupported source instruction mode');
      if (!Number.isSafeInteger(row.delivered) || !Number.isSafeInteger(row.undelivered) || row.delivered < 0 || row.undelivered < 0 || row.delivered + row.undelivered !== row.audience_count) throw new Error('Invalid source delivery count');
    }
    for (const row of result.instruction_deliveries) {
      const send = sends.get(row.request_id);
      if (!send || send.org_id !== row.org_id || send.site_id !== row.site_id) throw new Error('Source scope mismatch');
      const worker = workers.get(row.worker_id);
      if (!worker || worker.org_id !== row.org_id || worker.site_id !== row.site_id) throw new Error('Source scope mismatch');
      if (!isWorkerLanguage(row.language) || !['preparing','available','blocked','failed','withdrawn'].includes(row.state)
        || !Number.isSafeInteger(row.attempts) || row.attempts < 0 || row.attempts > 3) throw new Error('Invalid source instruction delivery');
      if (row.state === 'available') {
        const assignment = assignments.get(row.assignment_id);
        if (!assignment || assignment.org_id !== row.org_id || assignment.site_id !== row.site_id
          || assignment.worker_id !== row.worker_id || assignment.publication_id !== send.publication_id
          || assignment.language !== row.language || typeof row.content_hash !== 'string') throw new Error('Source scope mismatch');
      } else if (row.assignment_id !== null || row.content_hash !== null) throw new Error('Invalid source instruction delivery');
      if (row.content_json !== null) {
        let content;
        try { content = JSON.parse(row.content_json); } catch { throw new Error('Invalid source instruction delivery content'); }
        if (!content || typeof content !== 'object' || Array.isArray(content) || row.state !== 'available') throw new Error('Invalid source instruction delivery content');
      }
    }
    for (const row of result.instruction_retries) {
      const send = sends.get(row.send_request_id);
      if (!send || send.org_id !== row.org_id || send.site_id !== row.site_id || !staffIds.has(row.requested_by)) throw new Error('Source scope mismatch');
      if (!Number.isSafeInteger(row.generation) || row.generation < 0) throw new Error('Invalid source instruction retry');
    }
    for (const row of result.submission_receipts) if (!Number.isSafeInteger(row.sequence) || row.sequence < 1) throw new Error('Invalid receipt sequence');
    const evidence = new Map(result.attempts.map((row) => [`${row.assignment_id}\0${row.submission_id}`, { ...row, kind: 'typed' }]));
    for (const row of result.recordings.filter((row) => row.received_at)) evidence.set(`${row.assignment_id}\0${row.submission_id}`, { ...row, kind: 'audio' });
    for (const row of result.submission_receipts) {
      const accepted = evidence.get(`${row.assignment_id}\0${row.submission_id}`);
      if (!accepted || accepted.kind !== row.kind || accepted.org_id !== row.org_id || accepted.received_at !== row.received_at) throw new Error('Source receipt evidence mismatch');
    }
    validateImportedCaseVoice(result);
    return result;
  } finally { db.close(); }
}

function valuesFor(table, row, now) {
  if(table==='case_voice')return normalizeImportedCaseVoice(row,now);
  const copy = { ...row };
  if(table==='attempts'){
    const value=JSON.parse(copy.reasons_json);
    if(!Array.isArray(value)){
      if(!value || !Array.isArray(value.reasons) || !Array.isArray(value.evidence))throw new Error('Invalid source assessment evidence');
      copy.reasons_json=JSON.stringify(value.reasons);
      copy.evidence_json=JSON.stringify(value.evidence);
    }
    else copy.evidence_json='[]';
  }
  if (['staff','workers','crews','staff_accounts'].includes(table)) {
    if (![0,1].includes(copy.active)) throw new Error('Invalid source active flag');
    copy.active = !!copy.active;
  }
  if(table==='workers') {
    copy.name ??= null;
    if (![undefined,0,1,false,true].includes(copy.language_selection_required)) throw new Error('Invalid source language selection flag');
    copy.language_selection_required = copy.language_selection_required===1 || copy.language_selection_required===true;
    copy.language_selected_at ??= null;copy.language_selected_by ??= null;copy.language_selection_request_id ??= null;
  }
  if(table==='case_routing') {
    if(![0,1].includes(copy.manual))throw Error('Invalid case routing flag');
    copy.manual=!!copy.manual;
  }
  if (['sessions','worker_grants','worker_setup_tokens'].includes(table)) copy.revoked_at ||= now;
  if(table==='staff_invitations') {copy.email_payload=null;if(copy.state==='pending') copy.state='expired';}
  if(table==='staff_invitation_tokens') copy.revoked_at ||= now;
  if(table==='staff_invitation_mail') {
    copy.payload=null;copy.lease_token=null;copy.lease_until=null;
    if(['queued','processing'].includes(copy.state)) copy.state='expired';
  }
  if (table === 'jobs' && copy.status === 'processing') { copy.status = 'queued'; copy.lease_until = null; }
  if(table==='pilot_inquiries') {
    // A database cutover must not replay a potentially delivered external email.
    if(['queued','processing'].includes(copy.state))copy.state='failed';
    copy.lease_token=null;copy.lease_until=null;
    if(copy.expires_at<=now){copy.state='expired';copy.content_json=null;copy.destination=null;}
  }
  if (table === 'recording_purges' && copy.status === 'processing') {copy.status='queued';copy.lease_token=null;copy.lease_until=null;copy.retry_at=now;}
  if (table === 'source_audio_purges' && copy.status === 'processing') {copy.status='queued';copy.lease_token=null;copy.lease_until=null;copy.retry_at=now;}
  if (table === 'recordings' && copy.status === 'processing') {
    copy.status = 'received'; copy.lease_token = null; copy.lease_until = null; copy.retry_at = now;
  }
  if(table==='recordings' && copy.status === 'storing') { copy.status = 'failed'; copy.error = 'Storage interrupted before migration'; }
  if(table==='recordings') {
    copy.presentation_id ??= null;copy.presentation_language ??= null;copy.presented_question ??= null;
    const attached=copy.presentation_id!==null || copy.presentation_language!==null || copy.presented_question!==null;
    if(attached && (copy.presentation_id===null || copy.presentation_language===null
      || typeof copy.presented_question!=='string' || !copy.presented_question.trim())) throw new Error('Invalid source recording presentation');
    if(attached && !isWorkerLanguage(copy.presentation_language)) throw new Error('Invalid source recording presentation');
  }
  if(table==='presentation_artifacts') {
    copy.choices_json ??= null;
    if(copy.choices_json!==null) {
      if(copy.status!=='ready' || copy.source_kind!=='instruction' || ['[Deleted]','[Expired]'].includes(copy.text))throw Error('Invalid source presentation choices');
      try {copy.choices_json=JSON.stringify(checkedPresentationChoices(JSON.parse(copy.choices_json)));}
      catch {throw Error('Invalid source presentation choices');}
    }
    if(!isWorkerLanguage(copy.original_language) || !isWorkerLanguage(copy.target_language)
      || copy.original_language===copy.target_language) throw new Error('Invalid source presentation language');
    if(copy.live!==null && copy.live!==undefined) {
      if(![0,1,false,true].includes(copy.live)) throw new Error('Invalid source presentation live flag');
      copy.live=copy.live===1 || copy.live===true;
    }
  }
  if(table==='answer_presentation_bindings' && !isWorkerLanguage(copy.presentation_language))
    throw new Error('Invalid source presentation language');
  if(table==='source_audio_requests') {
    if(copy.status==='processing')copy.status='received';
    copy.lease_token=null;copy.lease_until=null;
    copy.retry_at=null;
    if(copy.status==='storing')copy.error='Private upload requires recovery';
  }
  if (table === 'report_exports' && copy.status === 'processing') {
    copy.status = 'queued'; copy.lease_token = null; copy.lease_until = null;
  }
  if (['report_exports','worker_imports'].includes(table) && copy.expires_at <= now) {
    copy.status = 'expired';
    if (table === 'report_exports') { copy.snapshot_json = null; copy.csv = null; copy.checksum = null; copy.lease_token = null; copy.lease_until = null; copy.error = null; }
    else { copy.rows_json = null; copy.errors_json = null; }
  }
  return copy;
}

export async function importSqliteBackup(pool, { source, schema, requestId, dataClass, dryRun = true }) {
  schemaName(schema);
  if (schema === 'public' || dataClass !== 'synthetic' || !UUID.test(requestId) || typeof dryRun !== 'boolean') throw new Error('Synthetic migration requires an explicit isolated schema and UUID');
  const { databasePath, manifest } = await verifyLocalBackup(source);
  const snapshot = snapshotRows(databasePath);
  const counts = Object.fromEntries(tables.map((table) => [table, snapshot[table].length]));
  const client = await acquirePostgresClient(pool); let begun = false, discard = false;
  try {
    await client.query('BEGIN'); begun = true;
    await client.query("SELECT set_config('search_path',quote_ident($1)||',pg_catalog',true)", [schema]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`understood:migrations:${schema}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`understood:sqlite-import:${schema}`]);
    // Cover current and future ledgers, not only the tables SQLite knows how to import.
    const targetTables=(await client.query(`SELECT tablename,quote_ident(tablename) AS identifier FROM pg_tables
      WHERE schemaname=$1 AND tablename<>'schema_migrations' ORDER BY tablename`,[schema])).rows;
    const names=new Set(targetTables.map(row=>row.tablename));
    if([...tables,...omitted,'sqlite_import_runs'].some(name=>!names.has(name)))throw Error('Target schema is incomplete');
    await client.query(`LOCK TABLE ${targetTables.map(row=>row.identifier).join(',')} IN ACCESS EXCLUSIVE MODE`);
    const old = (await client.query('SELECT * FROM sqlite_import_runs WHERE id=$1', [requestId])).rows[0];
    if (old) {
      if (old.backup_id !== manifest.id || old.source_sha256 !== manifest.database.sha256 || old.data_class !== dataClass) throw new Error('Migration request ID conflict');
      await client.query('ROLLBACK'); begun = false;
      return { requestId, dryRun, duplicate: true, counts: old.counts_json, credentialsImported: false };
    }
    for (const table of targetTables) {
      if ((await client.query(`SELECT 1 FROM ${table.identifier} LIMIT 1`)).rows.length) throw new Error('Target schema must be empty');
    }
    const now = new Date().toISOString();
    if(snapshot.case_voice.length)await inspectCaseWorkflowRuntimeGuards(client,schema);
    for (const table of tables) {
      const fields = columns[table].split(' ');      if(table==='workers')fields.push('name','language_selection_required','language_selected_at','language_selected_by','language_selection_request_id');
      if (table === 'assignments') fields.push('language');
      if(table==='sessions')fields.push('credential_revision');
      if (['attempts','clarifications'].includes(table)) fields.push('site_id');
      if(table==='attempts')fields.push('evidence_json');
      if(table==='worker_imports')fields.push('filename_hash');
      if(table==='site_settings')fields.push('generation_languages_json','primary_contact_id','deputy_contact_id','staff_interface_language','first_run_completed_at');
      if(table==='draft_creations')fields.push('generation_languages_json');
      if(table==='report_exports')fields.push('filters_json');
      if(table==='recordings')fields.push('presentation_id','presentation_language','presented_question');
      if(table==='presentation_artifacts')fields.push('choices_json');
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(',');
      const sql = `INSERT INTO "${table}" (${fields.map((field) => `"${field}"`).join(',')}) ${table === 'submission_receipts' ? 'OVERRIDING SYSTEM VALUE ' : ''}VALUES (${placeholders})`;
      // Maintenance-only, empty-target import of validated history. Runtime roles
      // cannot ALTER, and rollback restores the guard even on insertion failure.
      if(table==='case_voice'&&snapshot[table].length)await client.query('ALTER TABLE case_voice DISABLE TRIGGER case_voice_guard');
      // Entitlement guards require the live revision sequence; the preserved history is already consistent.
      const entitlementHistory=['organization_entitlements','organization_entitlement_transitions','organization_activation_requests'].includes(table);
      if(entitlementHistory&&snapshot[table].length)await client.query(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      for (const row of snapshot[table]) {
        const copy = valuesFor(table, row, now);
        if(table==='site_settings')copy.generation_languages_json ??= '["en","ar","ur"]';
        if(table==='site_settings'){copy.primary_contact_id ??= null;copy.deputy_contact_id ??= null;}
        // Sites imported from pre-onboarding backups were already configured; nullable new registrations stay pending.
        if(table==='site_settings'){if(!Object.hasOwn(copy,'staff_interface_language'))copy.staff_interface_language='en';
          if(!Object.hasOwn(copy,'first_run_completed_at'))copy.first_run_completed_at=now;}
        if(table==='draft_creations')copy.generation_languages_json ??= null;
        if(table==='report_exports')copy.filters_json ??= '{"crewId":"","responseFrom":"","responseThrough":""}';
        await client.query(sql, fields.map((field) => copy[field]));
      }
      if(table==='case_voice'&&snapshot[table].length)await client.query('ALTER TABLE case_voice ENABLE TRIGGER case_voice_guard');
      if(entitlementHistory&&snapshot[table].length)await client.query(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
      const count = (await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0].n;
      if (count !== counts[table]) throw new Error('Migration count mismatch');
    }
    // The old local help API stored the worker's original text in notes while the case was open.
    // Preserve that known evidence separately before PostgreSQL resolution replaces private notes.
    const retainedHelp=new Set(snapshot.help_requests.map((row) => row.case_id));
    for (const row of snapshot.clarifications.filter((row) => !retainedHelp.has(row.id) && !row.attempt_id && row.reason==='Help requested' && row.status==='open')) {
      if (typeof row.notes!=='string' || row.notes.trim().length<3 || row.notes.length>500) throw new Error('Legacy help evidence is invalid');
      await client.query('INSERT INTO help_requests(case_id,org_id,site_id,assignment_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [row.id,row.org_id,row.site_id,row.assignment_id,row.notes.trim(),row.created_at]);
    }
    const maximum = snapshot.submission_receipts.reduce((max, row) => Math.max(max, row.sequence), 0);
    if (!Number.isSafeInteger(maximum + 1)) throw new Error('Receipt sequence exhausted');
    // Unlike setval(), ALTER's restart is transactional, including a dry-run rollback.
    await client.query(`ALTER TABLE submission_receipts ALTER COLUMN sequence RESTART WITH ${maximum + 1}`);
    await client.query('INSERT INTO sqlite_import_runs(id,backup_id,source_sha256,data_class,counts_json) VALUES ($1,$2,$3,$4,$5)',
      [requestId, manifest.id, manifest.database.sha256, dataClass, JSON.stringify(counts)]);
    for (const site of snapshot.sites) await client.query(`INSERT INTO audit(id,org_id,site_id,actor_type,actor_id,action,object_id,occurred_at)
      VALUES ($1,$2,$3,'system','sqlite-migration','sqlite.imported',$4,$5)`, [randomUUID(),site.org_id,site.id,requestId,now]);
    discard = true; await client.query(dryRun ? 'ROLLBACK' : 'COMMIT'); begun = false; discard = false;
    return { requestId, dryRun, duplicate: false, counts, credentialsImported: false };
  } catch (error) {
    if (begun) { try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = true; error.cause = rollbackError; } }
    throw error;
  } finally { client.release(discard || undefined); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let pool;
  try {
    const args = process.argv.slice(2), commit = args.includes('--commit');
    const options = {}; const flags = args.filter((arg) => arg !== '--commit');
    if (args.filter((arg) => arg === '--commit').length > 1 || flags.length !== 6) throw new Error('Invalid arguments');
    for (let i=0; i<flags.length; i+=2) {
      if (!['--synthetic-backup','--schema','--request-id'].includes(flags[i]) || options[flags[i]] || !flags[i+1]) throw new Error('Invalid arguments');
      options[flags[i]] = flags[i+1];
    }
    schemaName(options['--schema']);
    if (!/^understood_test_[a-z0-9_]+$/.test(options['--schema']) || !UUID.test(options['--request-id'])) throw new Error('Use an isolated understood_test_ schema');
    const url = new URL(process.env.UNDERSTOOD_POSTGRES_URL || '');
    if (!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname) || !/test/i.test(decodeURIComponent(url.pathname))) throw new Error('Use a disposable local test database');
    pool = await createPostgresPool();
    await runMigrations(pool, { schema: options['--schema'] });
    console.log(JSON.stringify(await importSqliteBackup(pool, { source: options['--synthetic-backup'], schema: options['--schema'], requestId: options['--request-id'], dataClass: 'synthetic', dryRun: !commit })));
  } catch { console.error('Synthetic SQLite migration failed. No source data changed. Check the verified backup, current migrations, empty isolated test schema and arguments.'); process.exitCode = 1; }
  finally { if (pool) await pool.end(); }
}
