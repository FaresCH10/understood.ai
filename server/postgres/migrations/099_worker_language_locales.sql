-- Worker identity language selection supports the full required locale set, including
-- both Punjabi scripts. Content-language JSON settings remain limited to languages the
-- current pipeline can actually produce; capability checks stay in application code.

ALTER TABLE workers DROP CONSTRAINT workers_language_check;
ALTER TABLE workers ADD CONSTRAINT workers_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE assignments DROP CONSTRAINT assignments_language_check;
ALTER TABLE assignments ADD CONSTRAINT assignments_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE worker_language_requests DROP CONSTRAINT worker_language_requests_current_language_check;
ALTER TABLE worker_language_requests ADD CONSTRAINT worker_language_requests_current_language_check CHECK (current_language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));
ALTER TABLE worker_language_requests DROP CONSTRAINT worker_language_requests_requested_language_check;
ALTER TABLE worker_language_requests ADD CONSTRAINT worker_language_requests_requested_language_check CHECK (requested_language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE case_messages DROP CONSTRAINT case_messages_language_check;
ALTER TABLE case_messages ADD CONSTRAINT case_messages_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE case_followups DROP CONSTRAINT case_followups_language_check;
ALTER TABLE case_followups ADD CONSTRAINT case_followups_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE case_followup_audio DROP CONSTRAINT case_followup_audio_language_check;
ALTER TABLE case_followup_audio ADD CONSTRAINT case_followup_audio_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE case_voice DROP CONSTRAINT case_voice_language_check;
ALTER TABLE case_voice ADD CONSTRAINT case_voice_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE generated_audio DROP CONSTRAINT generated_audio_language_check;
ALTER TABLE generated_audio ADD CONSTRAINT generated_audio_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE preparation_stage_events DROP CONSTRAINT preparation_stage_events_language_check;
ALTER TABLE preparation_stage_events ADD CONSTRAINT preparation_stage_events_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE provider_verifications DROP CONSTRAINT provider_verifications_language_check;
ALTER TABLE provider_verifications ADD CONSTRAINT provider_verifications_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));

ALTER TABLE provider_verification_jobs DROP CONSTRAINT provider_verification_jobs_language_check;
ALTER TABLE provider_verification_jobs ADD CONSTRAINT provider_verification_jobs_language_check CHECK (language IN
  ('en','ar','hi','ur','bn','ml','ta','te','ne','fil','si','ru','pa-Guru','pa-Arab','id'));
