import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectWav } from '../server/audio.mjs';
import {verifySourceOriginal,MAX_SOURCE_ORIGINAL_BYTES} from '../server/private-storage.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function regularFile(path, limit = Infinity) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Backup file is invalid');
  return info;
}

async function digest(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}

function verifyDatabase(db) {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity failed');
}

function recordings(db) {
  const rows=[];
  if(hasTable(db,'recordings')){
    const live=hasTable(db,'recording_purges')?' AND NOT EXISTS(SELECT 1 FROM recording_purges p WHERE p.recording_id=r.id)':'';
    rows.push(...db.prepare(`SELECT r.id,r.sha256,r.bytes FROM recordings r WHERE r.received_at IS NOT NULL${live}`).all());
  }
  if(hasTable(db,'case_voice'))rows.push(...db.prepare(`SELECT v.id,v.sha256,v.bytes FROM case_voice v WHERE v.status='received' AND v.cleanup_state='active'
    AND NOT EXISTS(SELECT 1 FROM worker_deletion_requests d WHERE d.worker_id=v.worker_id)
    AND NOT EXISTS(SELECT 1 FROM clarifications c WHERE c.id=v.requested_case_id AND c.reason IN ('[Deleted]','[Expired]'))`).all());
  if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Duplicate private recording reference');
  return rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}

async function verifyAudio(path, row) {
  if (!UUID.test(row.id)) throw new Error('Invalid recording reference');
  await regularFile(path, 2_880_044);
  const info = inspectWav(await readFile(path));
  if (info.sha256 !== row.sha256 || info.bytes !== row.bytes) throw new Error('Recording integrity failed');
}

function sourceAudioRows(db) {
  if(!hasTable(db,'source_audio_requests'))return [];
  const live=hasTable(db,'source_audio_purges')?' AND NOT EXISTS(SELECT 1 FROM source_audio_purges p WHERE p.request_id=source_audio_requests.request_id)':'';
  return db.prepare(`SELECT id,sha256,bytes,original_id,original_sha256,original_bytes FROM source_audio_requests WHERE received_at IS NOT NULL${live} ORDER BY request_id`).all()
    .flatMap(row=>[{id:row.id,sha256:row.sha256,bytes:row.bytes,kind:'canonical',file:`private-audio/${row.id}.wav`},
      {id:row.original_id,sha256:row.original_sha256,bytes:row.original_bytes,kind:'original',file:`private-audio/${row.original_id}.source-original`}]);
}
async function verifySourceFile(path,row) {
  if(!UUID.test(row.id))throw Error('Invalid source audio reference');
  if(row.kind==='canonical')return verifyAudio(path,row);
  await regularFile(path,MAX_SOURCE_ORIGINAL_BYTES);
  verifySourceOriginal(row,await readFile(path));
}

async function newDirectory(destination) {
  const target = resolve(destination);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  if (resolve(await realpath(parent)).toLowerCase() !== parent.toLowerCase()) throw new Error('Destination must not use symbolic links');
  await mkdir(target, { mode: 0o700 });
  return target;
}

export async function backupLocal({ database, audioRoot, destination }) {
  const sourcePath = resolve(database), sourceAudio = resolve(audioRoot);
  await regularFile(sourcePath);
  if (resolve(await realpath(sourcePath)).toLowerCase() !== sourcePath.toLowerCase()) throw new Error('Database must not use symbolic links');
  const target = await newDirectory(destination);
  const databasePath = join(target, 'understood.sqlite');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, databasePath); } finally { source.close(); }
  const snapshot = new DatabaseSync(databasePath, { readOnly: true });
  let audio,sources;
  try { verifyDatabase(snapshot); audio = recordings(snapshot);sources=sourceAudioRows(snapshot); } finally { snapshot.close(); }
  if (audio.length+sources.length > 10_000) throw new Error('Local backup recording limit exceeded');
  if (audio.length+sources.length) {
    if (resolve(await realpath(sourceAudio)).toLowerCase() !== sourceAudio.toLowerCase()) throw new Error('Audio directory must not use symbolic links');
    await mkdir(join(target, 'private-audio'), { mode: 0o700 });
    for (const row of audio) {
      const input = join(sourceAudio, `${row.id}.wav`), output = join(target, 'private-audio', `${row.id}.wav`);
      await verifyAudio(input, row); await copyFile(input, output, constants.COPYFILE_EXCL); await verifyAudio(output, row);
    }
    for(const row of sources) {
      const input=join(sourceAudio,row.file.slice('private-audio/'.length)),output=join(target,row.file);
      await verifySourceFile(input,row);await copyFile(input,output,constants.COPYFILE_EXCL);await verifySourceFile(output,row);
    }
  }
  const manifest = { format: 'understood-local-backup-v1', id: randomUUID(), createdAt: new Date().toISOString(),
    database: { file: 'understood.sqlite', ...await digest(databasePath) },
    recordings: audio.map((row) => ({ ...row, file: `private-audio/${row.id}.wav` })),...(sources.length?{sourceAudio:sources}:{}) };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(manifestText) > 1_000_000) throw new Error('Local backup manifest limit exceeded');
  await writeFile(join(target, 'manifest.json'), manifestText, { flag: 'wx', mode: 0o600 });
  return { directory: target, recordings: audio.length,sourceAudioObjects:sources.length, manifestId: manifest.id };
}

function hasTable(db, name) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }

export async function verifyLocalBackup(source) {
  const root = resolve(source);
  if (resolve(await realpath(root)).toLowerCase() !== root.toLowerCase()) throw new Error('Backup must not use symbolic links');
  const manifestPath = join(root, 'manifest.json');
  await regularFile(manifestPath, 1_000_000);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.format !== 'understood-local-backup-v1' || !UUID.test(manifest.id) || manifest.database?.file !== 'understood.sqlite'
    || !Array.isArray(manifest.recordings) || manifest.recordings.length > 10_000
    || (manifest.sourceAudio!==undefined && (!Array.isArray(manifest.sourceAudio) || manifest.recordings.length+manifest.sourceAudio.length>10000))) throw new Error('Invalid backup manifest');
  const databasePath = join(root, 'understood.sqlite');
  await regularFile(databasePath);
  const hash = await digest(databasePath);
  if (hash.sha256 !== manifest.database.sha256 || hash.bytes !== manifest.database.bytes) throw new Error('Database checksum failed');
  const snapshot = new DatabaseSync(databasePath, { readOnly: true });
  let rows,sources;
  try { verifyDatabase(snapshot); rows = recordings(snapshot);sources=sourceAudioRows(snapshot); } finally { snapshot.close(); }
  if (rows.length !== manifest.recordings.length || rows.some((row, index) => {
    const entry = manifest.recordings[index];
    return entry.id !== row.id || entry.sha256 !== row.sha256 || entry.bytes !== row.bytes || entry.file !== `private-audio/${row.id}.wav`;
  })) throw new Error('Backup recording manifest mismatch');
  if(JSON.stringify(sources)!==JSON.stringify(manifest.sourceAudio ?? []))throw Error('Backup source audio manifest mismatch');
  if (rows.length+sources.length && resolve(await realpath(join(root, 'private-audio'))).toLowerCase() !== join(root, 'private-audio').toLowerCase()) throw new Error('Backup audio must not use symbolic links');
  for (const row of rows) await verifyAudio(join(root, 'private-audio', `${row.id}.wav`), row);
  for(const row of sources)await verifySourceFile(join(root,row.file),row);
  return { root, databasePath, manifest, rows,sources };
}

export async function restoreLocal({ source, destination }) {
  const { root, databasePath, manifest, rows,sources } = await verifyLocalBackup(source);
  const between = relative(root, resolve(destination));
  if (!between || (!between.startsWith('..') && !isAbsolute(between))) throw new Error('Restore destination must be outside the backup');
  const target = await newDirectory(destination);
  const targetDatabase = join(target, 'understood.sqlite');
  await copyFile(databasePath, targetDatabase, constants.COPYFILE_EXCL);
  const copiedHash = await digest(targetDatabase);
  if (copiedHash.sha256 !== manifest.database.sha256 || copiedHash.bytes !== manifest.database.bytes) throw new Error('Copied database checksum failed');
  await mkdir(join(target, 'private-audio'), { mode: 0o700 });
  for (const row of rows) {
    const output = join(target, 'private-audio', `${row.id}.wav`);
    await copyFile(join(root, 'private-audio', `${row.id}.wav`), output, constants.COPYFILE_EXCL);
    await verifyAudio(output, row);
  }
  for(const row of sources) {
    const output=join(target,row.file);await copyFile(join(root,row.file),output,constants.COPYFILE_EXCL);await verifySourceFile(output,row);
  }
  const restored = new DatabaseSync(join(target, 'understood.sqlite'));
  try {
    restored.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      restored.prepare('UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL').run(now);
      restored.prepare('UPDATE worker_grants SET revoked_at=? WHERE revoked_at IS NULL').run(now);
      if(hasTable(restored,'worker_setup_tokens')) restored.prepare('UPDATE worker_setup_tokens SET revoked_at=? WHERE revoked_at IS NULL').run(now);
      if(hasTable(restored,'worker_credentials')) restored.prepare('DELETE FROM worker_credentials').run();
      if(hasTable(restored,'staff_recovery_tokens')) restored.prepare('UPDATE staff_recovery_tokens SET revoked_at=? WHERE revoked_at IS NULL AND used_at IS NULL').run(now);
      if(hasTable(restored,'staff_recovery_mail')) restored.prepare("UPDATE staff_recovery_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing')").run();
      if(hasTable(restored,'staff_invitations')) restored.prepare("UPDATE staff_invitations SET state='expired',email_payload=NULL WHERE state='pending'").run();
      if(hasTable(restored,'staff_invitation_tokens')) restored.prepare('UPDATE staff_invitation_tokens SET revoked_at=? WHERE revoked_at IS NULL AND used_at IS NULL').run(now);
      if(hasTable(restored,'staff_invitation_mail')) {
        restored.prepare("UPDATE staff_invitation_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing')").run();
        restored.prepare('UPDATE staff_invitation_mail SET payload=NULL WHERE payload IS NOT NULL').run();
      }
      if(hasTable(restored,'organization_registrations')) restored.prepare("UPDATE organization_registrations SET state='expired',payload=NULL WHERE state='pending'").run();
      if(hasTable(restored,'registration_tokens')) restored.prepare('UPDATE registration_tokens SET revoked_at=? WHERE revoked_at IS NULL AND used_at IS NULL').run(now);
      if(hasTable(restored,'registration_mail')) {
        restored.prepare("UPDATE registration_mail SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL WHERE state IN ('queued','processing')").run();
        restored.prepare('UPDATE registration_mail SET payload=NULL WHERE payload IS NOT NULL').run();
      }
      restored.prepare("UPDATE jobs SET status='queued',lease_until=NULL WHERE status='processing'").run();
      if (hasTable(restored, 'recordings')) {
        restored.prepare("UPDATE recordings SET status='received',lease_token=NULL,lease_until=NULL,retry_at=? WHERE status='processing' AND received_at IS NOT NULL").run(now);
        restored.prepare("UPDATE recordings SET status='failed',error='Storage interrupted before receipt' WHERE status='storing'").run();
      }
      if(hasTable(restored,'source_audio_requests'))restored.prepare("UPDATE source_audio_requests SET status=CASE WHEN status='processing' THEN 'received' ELSE status END,lease_token=NULL,lease_until=NULL,retry_at=NULL WHERE status IN ('storing','processing')").run();
      if (hasTable(restored, 'report_exports')) restored.prepare("UPDATE report_exports SET status='queued',lease_token=NULL,lease_until=NULL WHERE status='processing'").run();
      if(hasTable(restored,'recording_purges'))restored.prepare("UPDATE recording_purges SET status='queued',lease_token=NULL,lease_until=NULL,retry_at=? WHERE status='processing'").run(now);
      if(hasTable(restored,'source_audio_purges'))restored.prepare("UPDATE source_audio_purges SET status='queued',lease_token=NULL,lease_until=NULL,retry_at=? WHERE status='processing'").run(now);
      for (const site of restored.prepare('SELECT id,org_id FROM sites').all()) {
        restored.prepare('INSERT INTO audit VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), site.org_id, site.id, 'system', 'local-restore', 'backup.restored', manifest.id, now);
      }
      verifyDatabase(restored); restored.exec('COMMIT');
    } catch (err) { restored.exec('ROLLBACK'); throw err; }
  } finally { restored.close(); }
  return { directory: target, recordings: rows.length,sourceAudioObjects:sources.length, manifestId: manifest.id, sessionsRevoked: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2);
  const allowed = mode === 'backup' ? ['--db', '--audio', '--to'] : mode === 'restore' ? ['--from', '--to'] : [];
  try {
    if (!allowed.length || args.length !== allowed.length * 2) throw new Error('Use backup --db PATH --audio PATH --to NEW_DIRECTORY or restore --from BACKUP_DIRECTORY --to NEW_DIRECTORY');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!allowed.includes(args[i]) || options[args[i]] || !args[i + 1]) throw new Error('Invalid arguments');
      options[args[i]] = args[i + 1];
    }
    const result = mode === 'backup' ? await backupLocal({ database: options['--db'], audioRoot: options['--audio'], destination: options['--to'] })
      : await restoreLocal({ source: options['--from'], destination: options['--to'] });
    console.log(JSON.stringify(result));
  } catch { console.error('Local backup/restore failed. Source data is unchanged; any incomplete new directory must not be used. Check arguments, destination, permissions and integrity.'); process.exitCode = 1; }
}
