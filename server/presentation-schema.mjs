import {sqlLanguageList} from './languages.mjs';

const languageCheck=(column)=>`${column} IN (${sqlLanguageList()})`;

export function ensurePresentationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS presentation_artifacts (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id), worker_id TEXT NOT NULL REFERENCES workers(id),
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      publication_id TEXT NOT NULL REFERENCES publications(id),
      publication_version INTEGER NOT NULL CHECK(publication_version>0),
      source_kind TEXT NOT NULL CHECK(source_kind IN ('instruction','answer')),
      source_id TEXT NOT NULL DEFAULT '',
      original_language TEXT NOT NULL CHECK(${languageCheck('original_language')}),
      target_language TEXT NOT NULL CHECK(${languageCheck('target_language')}),
      source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
      status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
      title TEXT, text TEXT, question TEXT,
      provider TEXT, live INTEGER CHECK(live IN (0,1)),
      error_code TEXT, lease_token TEXT, lease_until TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ready_at TEXT,
      UNIQUE(assignment_id,source_kind,source_id,target_language),
      CHECK(target_language<>original_language),
      CHECK((source_kind='instruction' AND source_id='') OR (source_kind='answer' AND length(source_id)>=8)),
      CHECK(
        (status='pending' AND title IS NULL AND text IS NULL AND question IS NULL AND provider IS NULL AND live IS NULL AND error_code IS NULL AND ready_at IS NULL)
        OR (status='ready' AND text IS NOT NULL AND provider IS NOT NULL AND live IS NOT NULL AND error_code IS NULL AND ready_at IS NOT NULL
          AND (source_kind='answer' OR (source_kind='instruction' AND title IS NOT NULL)))
        OR (status='failed' AND title IS NULL AND text IS NULL AND question IS NULL AND provider IS NULL AND live IS NULL
          AND error_code IS NOT NULL AND ready_at IS NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_presentation_artifacts_scope ON presentation_artifacts(org_id,site_id,worker_id,assignment_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_presentation_artifacts_source ON presentation_artifacts(assignment_id,source_kind,source_id,target_language);

    CREATE TABLE IF NOT EXISTS answer_presentation_bindings (
      attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      assignment_id TEXT NOT NULL REFERENCES assignments(id),
      presentation_id TEXT NOT NULL REFERENCES presentation_artifacts(id),
      presentation_language TEXT NOT NULL CHECK(${languageCheck('presentation_language')}),
      presented_question TEXT NOT NULL CHECK(length(trim(presented_question))>0),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_answer_presentation_bindings_presentation ON answer_presentation_bindings(presentation_id);
  `);

  if(!db.prepare('PRAGMA table_info(presentation_artifacts)').all().some(column=>column.name==='choices_json'))db.exec('ALTER TABLE presentation_artifacts ADD COLUMN choices_json TEXT');

  const recordingColumns=new Set(db.prepare('PRAGMA table_info(recordings)').all().map(column=>column.name));
  if(recordingColumns.size){
    if(!recordingColumns.has('presentation_id'))db.exec('ALTER TABLE recordings ADD COLUMN presentation_id TEXT REFERENCES presentation_artifacts(id)');
    if(!recordingColumns.has('presentation_language'))db.exec('ALTER TABLE recordings ADD COLUMN presentation_language TEXT');
    if(!recordingColumns.has('presented_question'))db.exec('ALTER TABLE recordings ADD COLUMN presented_question TEXT');
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS presentation_artifacts_scope_insert BEFORE INSERT ON presentation_artifacts
      WHEN NOT EXISTS (
        SELECT 1 FROM assignments a
        JOIN publications p ON p.id=a.publication_id AND p.org_id=a.org_id AND p.site_id=a.site_id
        JOIN workers w ON w.id=a.worker_id AND w.org_id=a.org_id AND w.site_id=a.site_id
        WHERE a.id=NEW.assignment_id AND a.org_id=NEW.org_id AND a.site_id=NEW.site_id AND a.worker_id=NEW.worker_id
          AND p.id=NEW.publication_id AND p.version=NEW.publication_version)
      BEGIN SELECT RAISE(ABORT,'Presentation scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS presentation_artifacts_immutable BEFORE UPDATE ON presentation_artifacts
      WHEN NOT (
        OLD.status='ready' AND NEW.status='ready' AND OLD.text<>'[Deleted]' AND NEW.text='[Deleted]'
        AND NEW.id IS OLD.id AND NEW.org_id IS OLD.org_id AND NEW.site_id IS OLD.site_id
        AND NEW.worker_id IS OLD.worker_id AND NEW.assignment_id IS OLD.assignment_id
        AND NEW.publication_id IS OLD.publication_id AND NEW.publication_version IS OLD.publication_version
        AND NEW.source_kind IS OLD.source_kind AND NEW.source_id IS OLD.source_id
        AND NEW.original_language IS OLD.original_language AND NEW.target_language IS OLD.target_language
        AND NEW.source_hash IS OLD.source_hash AND NEW.created_at IS OLD.created_at
        AND NEW.title IS (CASE WHEN OLD.title IS NULL THEN NULL ELSE '[Deleted]' END)
        AND NEW.question IS (CASE WHEN OLD.question IS NULL THEN NULL ELSE '[Deleted]' END)
        AND NEW.provider IS OLD.provider AND NEW.live IS OLD.live AND NEW.error_code IS OLD.error_code
        AND NEW.ready_at IS OLD.ready_at AND NEW.lease_token IS OLD.lease_token AND NEW.lease_until IS OLD.lease_until
      )
      AND (
        NEW.id IS NOT OLD.id OR NEW.org_id IS NOT OLD.org_id OR NEW.site_id IS NOT OLD.site_id
        OR NEW.worker_id IS NOT OLD.worker_id OR NEW.assignment_id IS NOT OLD.assignment_id
        OR NEW.publication_id IS NOT OLD.publication_id OR NEW.publication_version IS NOT OLD.publication_version
        OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id
        OR NEW.original_language IS NOT OLD.original_language OR NEW.target_language IS NOT OLD.target_language
        OR NEW.source_hash IS NOT OLD.source_hash OR NEW.created_at IS NOT OLD.created_at
        OR NOT ((OLD.status='pending' AND NEW.status IN ('pending','ready','failed'))
          OR (OLD.status='ready' AND NEW.status='ready') OR (OLD.status='failed' AND NEW.status='failed'))
        OR (NEW.status='pending' AND (NEW.title IS NOT NULL OR NEW.text IS NOT NULL OR NEW.question IS NOT NULL
          OR NEW.provider IS NOT NULL OR NEW.live IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.ready_at IS NOT NULL))
        OR (NEW.status='ready' AND (NEW.text IS NULL OR NEW.provider IS NULL OR NEW.live IS NULL OR NEW.error_code IS NOT NULL
          OR NEW.ready_at IS NULL OR (NEW.source_kind='instruction' AND NEW.title IS NULL)))
        OR (NEW.status='failed' AND (NEW.title IS NOT NULL OR NEW.text IS NOT NULL OR NEW.question IS NOT NULL
          OR NEW.provider IS NOT NULL OR NEW.live IS NOT NULL OR NEW.error_code IS NULL OR NEW.ready_at IS NOT NULL))
        OR (OLD.status='ready' AND (NEW.title IS NOT OLD.title OR NEW.text IS NOT OLD.text OR NEW.question IS NOT OLD.question
          OR NEW.provider IS NOT OLD.provider OR NEW.live IS NOT OLD.live OR NEW.error_code IS NOT OLD.error_code OR NEW.ready_at IS NOT OLD.ready_at))
      )
      BEGIN SELECT RAISE(ABORT,'Presentation evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS presentation_artifacts_frozen_delete BEFORE DELETE ON presentation_artifacts
      BEGIN SELECT RAISE(ABORT,'Presentation evidence is immutable'); END;

    CREATE TRIGGER IF NOT EXISTS answer_presentation_bindings_scope_insert BEFORE INSERT ON answer_presentation_bindings
      WHEN NOT EXISTS (
        SELECT 1 FROM attempts t
        JOIN assignments a ON a.id=t.assignment_id AND a.org_id=t.org_id
        JOIN presentation_artifacts p ON p.id=NEW.presentation_id AND p.assignment_id=a.id
          AND p.org_id=a.org_id AND p.site_id=a.site_id AND p.worker_id=a.worker_id
        WHERE t.id=NEW.attempt_id AND t.org_id=NEW.org_id AND t.assignment_id=NEW.assignment_id
          AND a.site_id=NEW.site_id
          AND p.source_kind='instruction' AND p.status='ready'
          AND p.target_language=NEW.presentation_language AND p.question=NEW.presented_question)
      BEGIN SELECT RAISE(ABORT,'Presentation binding scope mismatch'); END;
    CREATE TRIGGER IF NOT EXISTS answer_presentation_bindings_frozen_update BEFORE UPDATE ON answer_presentation_bindings
      WHEN NOT (
        NEW.attempt_id IS OLD.attempt_id AND NEW.org_id IS OLD.org_id AND NEW.site_id IS OLD.site_id
        AND NEW.assignment_id IS OLD.assignment_id AND NEW.presentation_id IS OLD.presentation_id
        AND NEW.presentation_language IS OLD.presentation_language AND NEW.created_at IS OLD.created_at
        AND OLD.presented_question<>'[Deleted]' AND NEW.presented_question='[Deleted]'
      )
      BEGIN SELECT RAISE(ABORT,'Presentation binding is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS answer_presentation_bindings_frozen_delete BEFORE DELETE ON answer_presentation_bindings
      BEGIN SELECT RAISE(ABORT,'Presentation binding is immutable'); END;
  `);
  if(db.prepare('PRAGMA table_info(recordings)').all().length)db.exec(`
    CREATE TRIGGER IF NOT EXISTS recordings_presentation_immutable BEFORE UPDATE OF presentation_id,presentation_language,presented_question ON recordings
      WHEN NEW.presentation_id IS NOT OLD.presentation_id OR NEW.presentation_language IS NOT OLD.presentation_language
        OR (NEW.presented_question IS NOT OLD.presented_question
          AND NOT (OLD.presented_question IS NOT NULL
            AND OLD.presented_question NOT IN ('[Deleted]','[Expired]')
            AND NEW.presented_question IN ('[Deleted]','[Expired]')))
      BEGIN SELECT RAISE(ABORT,'Recording presentation provenance is immutable'); END;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS presentation_choices_insert BEFORE INSERT ON presentation_artifacts
      WHEN NEW.choices_json IS NOT NULL AND (NEW.status<>'ready' OR NEW.source_kind<>'instruction' OR NOT json_valid(NEW.choices_json) OR json_type(NEW.choices_json)<>'array' OR json_array_length(NEW.choices_json)<>4)
      BEGIN SELECT RAISE(ABORT,'Invalid presentation choices'); END;
    CREATE TRIGGER IF NOT EXISTS presentation_choices_update BEFORE UPDATE OF choices_json ON presentation_artifacts
      WHEN NEW.choices_json IS NOT OLD.choices_json AND NOT (
        (OLD.choices_json IS NULL AND NEW.choices_json IS NOT NULL AND NEW.status='ready' AND NEW.source_kind='instruction' AND NEW.text NOT IN ('[Deleted]','[Expired]') AND json_valid(NEW.choices_json) AND json_type(NEW.choices_json)='array' AND json_array_length(NEW.choices_json)=4)
        OR (NEW.choices_json IS NULL AND NEW.text IN ('[Deleted]','[Expired]')))
      BEGIN SELECT RAISE(ABORT,'Presentation choices are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS presentation_choices_redaction AFTER UPDATE OF text ON presentation_artifacts
      WHEN NEW.text IN ('[Deleted]','[Expired]') AND NEW.choices_json IS NOT NULL
      BEGIN UPDATE presentation_artifacts SET choices_json=NULL WHERE id=NEW.id; END;
  `);

}
