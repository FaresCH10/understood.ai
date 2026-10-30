import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPool, withTransaction } from './db.mjs';

const defaultDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
export const schemaName = (value) => {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid PostgreSQL schema name');
  return value;
};

async function migrationFiles(directory) {
  const names=(await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error('No PostgreSQL migrations found');
  const files=[];
  for (const name of names) {
    const source=await readFile(join(directory,name),'utf8');
    const sql=source.replace(/\r\n/g,'\n');
    const hash=value=>createHash('sha256').update(value).digest('hex');
    // Git checks out LF on Linux and may use CRLF on Windows. Keep accepting
    // historical checksums for either representation of exactly the same SQL.
    const checksum=hash(sql),checksums=new Set([checksum,hash(sql.replace(/\n/g,'\r\n')),hash(source)]);
    files.push({name,sql,checksum,checksums});
  }
  return files;
}

// Service startup checks the ledger without granting the runtime permission to apply DDL.
export async function verifyMigrations(pool,{schema='public',directory=defaultDirectory}={}) {
  schemaName(schema);
  const files=await migrationFiles(directory);
  return withTransaction(pool,async (client) => {
    await client.query('SET TRANSACTION READ ONLY');
    const exists=await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[schema]);
    if (!exists.rows.length) throw new Error('PostgreSQL schema does not exist');
    await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)",[schema]);
    const rows=(await client.query('SELECT version,checksum FROM schema_migrations')).rows;
    const previous=new Map(rows.map((row) => [row.version,row.checksum]));
    if (previous.size!==files.length) throw new Error('PostgreSQL schema migrations are not current');
    for (const file of files) if (!file.checksums.has(previous.get(file.name))) throw new Error('PostgreSQL schema migration verification failed');
    return {schema,migrations:files.length};
  });
}

export async function runMigrations(pool, { schema = 'public', directory = defaultDirectory } = {}) {
  schemaName(schema);
  const files=await migrationFiles(directory);
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`understood:migrations:${schema}`]);
    const exists = await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]);
    if (!exists.rows.length) throw new Error('PostgreSQL schema does not exist');
    await client.query("SELECT set_config('search_path', quote_ident($1) || ',pg_catalog', true)", [schema]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const previous = new Map((await client.query('SELECT version,checksum FROM schema_migrations')).rows
      .map((row) => [row.version, row.checksum]));
    const applied = [];
    for (const {name,sql,checksum,checksums} of files) {
      if (previous.has(name)) {
        if (!checksums.has(previous.get(name))) throw new Error(`Migration checksum mismatch: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)', [name, checksum]);
      applied.push(name);
    }
    return applied;
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pool = await createPostgresPool();
  try {
    const applied = await runMigrations(pool, { schema: process.env.UNDERSTOOD_POSTGRES_SCHEMA || 'public' });
    console.log(applied.length ? `Applied ${applied.join(', ')}` : 'PostgreSQL schema already current');
  } finally {
    await pool.end();
  }
}
