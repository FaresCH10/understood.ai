import {WORKER_LANGUAGE_CODES,sqlLanguageList} from './languages.mjs';

const tables=['site_settings','draft_creations','source_audio_requests'];
export const generationLanguageCheck=`generation_languages_json IS NULL OR
  (json_valid(generation_languages_json) AND json_type(generation_languages_json)='array'
   AND json_array_length(generation_languages_json) BETWEEN 1 AND ${WORKER_LANGUAGE_CODES.length}
   AND json_extract(generation_languages_json,'$[0]')='en')`;

export function guardGenerationLanguages(db,table){
  if(!tables.includes(table))throw Error('Invalid generation settings table');
  const rank=value=>`CASE ${value} ${WORKER_LANGUAGE_CODES.map((code,index)=>`WHEN '${code}' THEN ${index}`).join(' ')} ELSE 100 END`;
  for(const action of ['INSERT','UPDATE'])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_generation_locales_${action.toLowerCase()}
    BEFORE ${action} ON ${table} WHEN NEW.generation_languages_json IS NOT NULL AND (
      EXISTS(SELECT 1 FROM json_each(NEW.generation_languages_json) WHERE type<>'text' OR value NOT IN (${sqlLanguageList()}))
      OR (SELECT count(DISTINCT value) FROM json_each(NEW.generation_languages_json))<>json_array_length(NEW.generation_languages_json)
      OR EXISTS(SELECT 1 FROM json_each(NEW.generation_languages_json) a JOIN json_each(NEW.generation_languages_json) b
        ON a.key<b.key WHERE ${rank('a.value')}>${rank('b.value')}))
    BEGIN SELECT RAISE(ABORT,'Invalid generation languages'); END;`);
}

// Upgrade only the old four-value CHECK. Preserve every column, row, index and
// trigger, and verify the complete foreign-key graph before committing.
export function expandGenerationLanguageChecks(db){
  const legacy=/generation_languages_json\s+(?:IS NULL OR generation_languages_json\s+)?IN\s*\('[^)]*\)/i;
  const candidates=tables.filter(table=>legacy.test(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || ''));
  if(!candidates.length)return;
  const foreignKeys=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  const legacyAlter=db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table;
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE');
  try{
    for(const table of candidates){
      const original=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
      if(!original || !legacy.test(original))continue;
      const saved=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('trigger','index') AND sql IS NOT NULL ORDER BY type,name").all(table);
      const temporary=`${table}_generation_upgrade`;
      const definition=original.replace(legacy,generationLanguageCheck).replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\w+)/i,`CREATE TABLE "${temporary}"`);
      const columns=db.prepare(`PRAGMA table_info("${table}")`).all().map(column=>`"${column.name.replaceAll('"','""')}"`).join(',');
      db.exec(definition);
      db.exec(`INSERT INTO "${temporary}" (${columns}) SELECT ${columns} FROM "${table}"`);
      db.exec(`DROP TABLE "${table}"; ALTER TABLE "${temporary}" RENAME TO "${table}"`);
      for(const row of saved)db.exec(row.sql);
      guardGenerationLanguages(db,table);
    }
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Generation language upgrade broke foreign keys');
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{db.exec(`PRAGMA legacy_alter_table=${legacyAlter?1:0}; PRAGMA foreign_keys=${foreignKeys?1:0}`);}
}

// Draft language receipts store the selection inside request_json, so the
// column-level generation check above does not cover them.
export const briefingLanguageRequestCheck=`json_extract(request_json,'$.generationLanguages') IS NULL OR (
  json_valid(json_extract(request_json,'$.generationLanguages'))
  AND json_type(json_extract(request_json,'$.generationLanguages'))='array'
  AND json_array_length(json_extract(request_json,'$.generationLanguages')) BETWEEN 1 AND ${WORKER_LANGUAGE_CODES.length}
  AND json_extract(json_extract(request_json,'$.generationLanguages'),'$[0]')='en')`;

export function guardBriefingLanguageRequest(db){
  const rank=value=>`CASE ${value} ${WORKER_LANGUAGE_CODES.map((code,index)=>`WHEN '${code}' THEN ${index}`).join(' ')} ELSE 100 END`;
  const extracted=`json_extract(NEW.request_json,'$.generationLanguages')`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS briefing_language_request_locales
    BEFORE INSERT ON briefing_language_requests WHEN ${extracted} IS NOT NULL AND (
      NOT json_valid(${extracted}) OR json_type(${extracted})<>'array'
      OR EXISTS(SELECT 1 FROM json_each(${extracted}) WHERE type<>'text' OR value NOT IN (${sqlLanguageList()}))
      OR (SELECT count(DISTINCT value) FROM json_each(${extracted}))<>json_array_length(${extracted})
      OR EXISTS(SELECT 1 FROM json_each(${extracted}) a JOIN json_each(${extracted}) b
        ON a.key<b.key WHERE ${rank('a.value')}>${rank('b.value')}))
    BEGIN SELECT RAISE(ABORT,'Invalid generation languages'); END;`);
}

export function expandBriefingLanguageRequestCheck(db){
  const table='briefing_language_requests';
  const legacy=/json_extract\(request_json,'\$\.generationLanguages'\) IS NULL OR json_extract\(request_json,'\$\.generationLanguages'\) IN \('[^)]+\)/;
  const original=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '';
  if(!legacy.test(original))return;
  const foreignKeys=db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  const legacyAlter=db.prepare('PRAGMA legacy_alter_table').get().legacy_alter_table;
  db.exec('PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON; BEGIN IMMEDIATE');
  try{
    const saved=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('trigger','index') AND sql IS NOT NULL ORDER BY type,name").all(table);
    const temporary=`${table}_generation_upgrade`;
    const definition=original.replace(legacy,briefingLanguageRequestCheck).replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\w+)/i,`CREATE TABLE "${temporary}"`);
    const columns=db.prepare(`PRAGMA table_info("${table}")`).all().map(column=>`"${column.name.replaceAll('"','""')}"`).join(',');
    db.exec(definition);
    db.exec(`INSERT INTO "${temporary}" (${columns}) SELECT ${columns} FROM "${table}"`);
    db.exec(`DROP TABLE "${table}"; ALTER TABLE "${temporary}" RENAME TO "${table}"`);
    for(const row of saved)db.exec(row.sql);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Generation language upgrade broke foreign keys');
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{db.exec(`PRAGMA legacy_alter_table=${legacyAlter?1:0}; PRAGMA foreign_keys=${foreignKeys?1:0}`);}
}
