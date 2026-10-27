import {processOneRecording} from './recording-worker.mjs';
import {withMultipleChoice} from './multiple-choice.mjs';
import { randomUUID } from 'node:crypto';
import { openDatabase, NOW, transaction } from './db.mjs';
import { syntheticPrepare } from './domain.mjs';
import { resolveAuthConfig } from './auth.mjs';
import { processOneExport } from './exports.mjs';
import { expireWorkerImports } from './worker-import.mjs';
import {processOneDeletionRedaction} from './deletion-redactions.mjs';
import {processOneDeletionPseudonym} from './deletion-pseudonyms.mjs';
import {processOneDeletionCompletion} from './deletion-completions.mjs';
import {ensureDraftReviewSchema,getDraftReview} from './draft-review.mjs';
import {checkedSyntheticReview,readySnapshot} from './briefing-input.mjs';
import {readGlossarySnapshot} from './glossary.mjs';
import {checkedSyntheticGlossary} from './glossary-input.mjs';
import {resolveMailConfig} from './auth-mail.mjs';
import {expireRecovery,processOneRecovery} from './account-recovery.mjs';
import {expireInvitations,processOneInvitation} from './invitations.mjs';
import {expireRegistrations,processOneRegistration} from './registration.mjs';
import {processOneAudioPurge} from './retention.mjs';
import {processOneSourceAudioCleanup} from './source-audio-cleanup.mjs';
import {processOneSchedule} from './schedules.mjs';
import {processOneReminder} from './reminders.mjs';
import {ensureSettingsSchema,readGenerationLanguages} from './settings.mjs';
import {ensureBriefingSchema} from './preparation.mjs';
import {ensureInstructionSchema} from './instruction-schema.mjs';
import {instructionSendForBriefing,syntheticInstructionPrepare} from './instruction-prep.mjs';
import {processOneInstructionSend} from './instructions.mjs';
import {processOneSourceAudio} from './source-audio-worker.mjs';
import {resolveSourceTranscription} from './ai/source-transcription-config.mjs';
import {processOnePilot} from './pilot.mjs';
import {pilotDestination} from './pilot-input.mjs';
import {expirePushSubscriptions,processOnePushDelivery,sweepOverdueAssignments} from './notification-events.mjs';
import {resolvePushAdapter} from './push-adapter.mjs';
import {processOneCaseEscalation} from './case-routing.mjs';
import {processOneCaseFollowup} from './case-followups.mjs';
import {resolveCaseFollowup} from './ai/case-followup-config.mjs';
import {ensureStaffCaseRecordingSchema} from './staff-case-recording-schema.mjs';
import {processOneStaffCaseRecordingPurge} from './staff-case-recordings.mjs';
import {audioStore} from './private-storage.mjs';
import {DEFAULT_AUDIO_ROOT} from './recordings.mjs';

export function processOne(db) {
  ensureDraftReviewSchema(db);
  ensureBriefingSchema(db);
  ensureInstructionSchema(db);
  ensureSettingsSchema(db);
  const job = transaction(db, () => {
    const due = db.prepare(`SELECT * FROM jobs WHERE (status='queued' AND due_at <= ?) OR (status='processing' AND lease_until <= ?) ORDER BY due_at LIMIT 1`).get(NOW(), NOW());
    if (!due) return null;
    db.prepare('UPDATE jobs SET status=?, attempts=attempts+1, lease_until=? WHERE id=?').run('processing', new Date(Date.now() + 30_000).toISOString(), due.id);
    return due;
  });
  if (!job) return false;
  try {
    transaction(db, () => {
      const briefing = db.prepare('SELECT * FROM briefings WHERE id=? AND org_id=? AND site_id=?').get(job.briefing_id, job.org_id, job.site_id);
      if (!briefing || briefing.revision !== job.revision || briefing.state !== 'processing') {
        db.prepare('UPDATE jobs SET status=?,error=? WHERE id=?').run('failed', 'Obsolete draft revision', job.id);
        return;
      }
      const send=instructionSendForBriefing(db,briefing.id,job.org_id,job.site_id);
      const review=getDraftReview(db,briefing.id,job.org_id,job.site_id);
      if(review && review.revision!==job.revision) throw new Error('Obsolete draft review');
      let prepared = send
        ? syntheticInstructionPrepare(briefing,send)
        : checkedSyntheticGlossary(checkedSyntheticReview(syntheticPrepare(briefing.source),review),readGlossarySnapshot(db,job.org_id,job.site_id));
      if(prepared.languages?.en){prepared={...prepared,title:briefing.title,languages:{...prepared.languages,en:{...prepared.languages.en,title:briefing.title}}};}
      if(!send)prepared=withMultipleChoice(prepared,{preserveQuestions:true,preserveAskedFacts:true});
      const languages=readGenerationLanguages(db,job.org_id,job.site_id,['en','ar','ur'],job.briefing_id)
        .filter(language=>prepared.languages?.[language]);
      prepared.languages=Object.fromEntries(languages.map(language=>[language,prepared.languages[language]]));
      readySnapshot({...briefing,state:'ready',prepared_json:prepared},languages.map(language=>({language})),'synthetic',
        send ? {responseMode:send.response_mode,deliveryMode:send.delivery_mode} : undefined);
      db.prepare('UPDATE briefings SET prepared_json=?,state=?,updated_at=? WHERE id=?').run(JSON.stringify(prepared), 'ready', NOW(), briefing.id);
      db.prepare('UPDATE jobs SET status=?,lease_until=NULL,error=NULL WHERE id=?').run('ready', job.id);
      db.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), job.org_id, job.site_id, 'system', 'synthetic-worker', 'briefing.prepared', briefing.id, NOW());
    });
  } catch (error) {
    transaction(db, () => {
      db.prepare('UPDATE jobs SET status=?,lease_until=NULL,error=? WHERE id=?').run('failed', String(error.message).slice(0, 300), job.id);
      db.prepare('UPDATE briefings SET state=?,updated_at=? WHERE id=? AND revision=?').run('failed', NOW(), job.briefing_id, job.revision);
    });
  }
  return true;
}

if (process.argv[1]?.endsWith('worker.mjs')) {
  const config=resolveAuthConfig();
  const sourceAdapter=resolveSourceTranscription();
  const followupAdapter=resolveCaseFollowup();
  const pushAdapter=resolvePushAdapter();
  const mail=config.accessMode==='credential' ? resolveMailConfig({publicOrigin:config.publicOrigin,allowLocal:true}) : {available:false};
  const db = openDatabase();
  ensureStaffCaseRecordingSchema(db);
  const privateAudio=audioStore(DEFAULT_AUDIO_ROOT);
  const destination=pilotDestination();
  console.log('Synthetic processor started.');
  let ticking=false;
  setInterval(async () => {
    if(ticking) return;ticking=true;
    try {while(processOne(db)) {} for(let i=0;i<10 && processOneInstructionSend(db);i++) {} for(let i=0;i<5 && processOneSchedule(db);i++) {} for(let i=0;i<100 && processOneReminder(db);i++) {} while(processOneExport(db)) {} expireWorkerImports(db);expireRecovery(db);
      for(let i=0;i<5 && await processOneAudioPurge(db);i++) {}
      for(let i=0;i<5 && await processOneSourceAudioCleanup(db);i++) {}
      for(let i=0;i<5 && await processOneStaffCaseRecordingPurge(db,privateAudio);i++) {}
      for(let i=0;i<5 && await processOneSourceAudio(db,sourceAdapter);i++) {}
      for(let i=0;i<5 && await processOneRecording(db,null);i++) {}
      for(let i=0;i<5 && processOneCaseEscalation(db);i++) {}
      if(await processOneCaseFollowup(db,followupAdapter)) {}
      for(let i=0;i<5 && processOneDeletionRedaction(db);i++) {}
      for(let i=0;i<5 && processOneDeletionPseudonym(db);i++) {}
      for(let i=0;i<5 && await processOneDeletionCompletion(db);i++) {}
      for(let i=0;i<5 && await processOneRecovery(db,mail);i++) {}
      if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='staff_invitations'").get()) expireInvitations(db);
      for(let i=0;i<5 && await processOneInvitation(db,mail);i++) {}
      expireRegistrations(db);
      for(let i=0;i<5 && await processOneRegistration(db,mail);i++) {}
      for(let i=0;i<5 && processOnePilot(db,mail,{destination});i++) {}
      sweepOverdueAssignments(db);
      expirePushSubscriptions(db);
      for(let i=0;i<10 && await processOnePushDelivery(db,pushAdapter);i++) {}
    }catch {console.error('Worker operation unavailable.');}
    finally {ticking=false;}
  },750);
}
